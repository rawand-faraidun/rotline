import { type Database, FriendshipStatus, friendIds } from '@rotline/db'
import { getPresence, notify, PartyError } from '@rotline/state'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { playerNameKey } from '../lib/player-name.ts'

const RECENT_LIMIT = 50

/** Friendships are stored once per pair, smaller id first. */
export function pair(a: string, b: string): { playerA: string; playerB: string } {
	return a < b ? { playerA: a, playerB: b } : { playerA: b, playerB: a }
}

/** Remembers everyone in a squad as each other's recent players, keeping the newest 50. */
export async function recordRecentPlayers(db: Database, members: readonly string[]): Promise<void> {
	const now = new Date()
	for (const playerId of members) {
		for (const otherId of members) {
			if (playerId === otherId) continue
			await db.recentPlayer.upsert({
				where: { playerId_otherId: { playerId, otherId } },
				create: { playerId, otherId, playedAt: now },
				update: { playedAt: now }
			})
		}
		const stale = await db.recentPlayer.findMany({
			where: { playerId },
			orderBy: { playedAt: 'desc' },
			skip: RECENT_LIMIT,
			select: { otherId: true }
		})
		if (stale.length > 0)
			await db.recentPlayer.deleteMany({ where: { playerId, otherId: { in: stale.map(row => row.otherId) } } })
	}
}

const target = z.object({ userId: z.uuid() })

export function friendRoutes(services: Services) {
	const { db, valkey, parties } = services

	const profile = { userId: true, name: true, avatarStyle: true, avatarSeed: true, activeClass: true } as const

	async function isBlocked(a: string, b: string): Promise<boolean> {
		return (
			(await db.block.count({
				where: {
					OR: [
						{ blockerId: a, blockedId: b },
						{ blockerId: b, blockedId: a }
					]
				}
			})) > 0
		)
	}

	return new Hono<AppEnv>()
		.use('/friends/*', async (c, next) => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const player = await db.player.findUnique({ where: { userId: user.id }, select: { userId: true } })
			if (!player) return c.json({ error: 'no-player' as const }, 404)
			await next()
		})
		.get('/friends', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const [rows, blocks, recent] = await Promise.all([
				db.friendship.findMany({
					where: { OR: [{ playerA: user.id }, { playerB: user.id }] },
					include: { a: { select: profile }, b: { select: profile } }
				}),
				db.block.findMany({ where: { blockerId: user.id }, include: { blocked: { select: profile } } }),
				db.recentPlayer.findMany({
					where: { playerId: user.id },
					orderBy: { playedAt: 'desc' },
					take: 20,
					include: { other: { select: profile } }
				})
			])
			const others = rows.map(row => ({ row, other: row.playerA === user.id ? row.b : row.a }))
			const presence = await getPresence(
				valkey,
				others.filter(entry => entry.row.status === FriendshipStatus.accepted).map(entry => entry.other.userId)
			)
			const card = (player: {
				userId: string
				name: string
				avatarStyle: string
				avatarSeed: string
				activeClass: string
			}) => ({
				id: player.userId,
				name: player.name,
				avatarStyle: player.avatarStyle,
				avatarSeed: player.avatarSeed,
				activeClass: player.activeClass
			})
			const friendSet = new Set(others.map(entry => entry.other.userId))
			return c.json(
				{
					friends: others
						.filter(entry => entry.row.status === FriendshipStatus.accepted)
						.map(entry => ({
							...card(entry.other),
							presence: presence.get(entry.other.userId) ?? { status: 'offline', detail: '' }
						}))
						.sort(
							(x, y) =>
								Number(x.presence.status === 'offline') - Number(y.presence.status === 'offline') ||
								x.name.localeCompare(y.name)
						),
					incoming: others
						.filter(entry => entry.row.status === FriendshipStatus.pending && entry.row.requestedBy !== user.id)
						.map(entry => card(entry.other)),
					outgoing: others
						.filter(entry => entry.row.status === FriendshipStatus.pending && entry.row.requestedBy === user.id)
						.map(entry => card(entry.other)),
					blocked: blocks.map(row => card(row.blocked)),
					recent: recent
						.filter(row => !friendSet.has(row.otherId))
						.map(row => ({ ...card(row.other), playedAt: row.playedAt }))
				},
				200
			)
		})
		.post('/friends/request', zValidator('json', z.object({ name: z.string().trim().min(1).max(32) })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const other = await db.player.findUnique({
				where: { nameKey: playerNameKey(c.req.valid('json').name) },
				select: { userId: true }
			})
			// blocked looks the same as unknown, so blocking is not revealed
			if (!other || other.userId === user.id || (await isBlocked(user.id, other.userId))) {
				return c.json({ error: 'not-found' as const }, 404)
			}
			const key = pair(user.id, other.userId)
			const existing = await db.friendship.findUnique({ where: { playerA_playerB: key } })
			if (existing?.status === FriendshipStatus.accepted) return c.json({ status: 'friends' as const }, 200)
			if (existing && existing.requestedBy !== user.id) {
				// they already asked: accept
				await db.friendship.update({
					where: { playerA_playerB: key },
					data: { status: FriendshipStatus.accepted, acceptedAt: new Date() }
				})
				await notify(valkey, [user.id, other.userId], { type: 'friends' })
				return c.json({ status: 'friends' as const }, 200)
			}
			if (!existing) {
				await db.friendship.create({ data: { ...key, status: FriendshipStatus.pending, requestedBy: user.id } })
			}
			await notify(valkey, [user.id, other.userId], { type: 'friends' })
			return c.json({ status: 'requested' as const }, 200)
		})
		.post('/friends/accept', zValidator('json', target), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { userId } = c.req.valid('json')
			const key = pair(user.id, userId)
			const updated = await db.friendship.updateMany({
				where: { ...key, status: FriendshipStatus.pending, requestedBy: userId },
				data: { status: FriendshipStatus.accepted, acceptedAt: new Date() }
			})
			if (updated.count === 0) return c.json({ error: 'not-found' as const }, 404)
			await notify(valkey, [user.id, userId], { type: 'friends' })
			return c.json({ status: 'friends' as const }, 200)
		})
		.post('/friends/remove', zValidator('json', target), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { userId } = c.req.valid('json')
			// also declines a request or cancels one you sent
			await db.friendship.deleteMany({ where: pair(user.id, userId) })
			await notify(valkey, [user.id, userId], { type: 'friends' })
			return c.json({ status: 'removed' as const }, 200)
		})
		.post('/friends/block', zValidator('json', target), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { userId } = c.req.valid('json')
			if (userId === user.id) return c.json({ error: 'not-found' as const }, 404)
			await db.$transaction([
				db.friendship.deleteMany({ where: pair(user.id, userId) }),
				db.block.upsert({
					where: { blockerId_blockedId: { blockerId: user.id, blockedId: userId } },
					create: { blockerId: user.id, blockedId: userId },
					update: {}
				})
			])
			await notify(valkey, [user.id, userId], { type: 'friends' })
			return c.json({ status: 'blocked' as const }, 200)
		})
		.post('/friends/unblock', zValidator('json', target), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			await db.block.deleteMany({ where: { blockerId: user.id, blockedId: c.req.valid('json').userId } })
			await notify(valkey, [user.id], { type: 'friends' })
			return c.json({ status: 'unblocked' as const }, 200)
		})
		.post('/friends/invite', zValidator('json', target), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { userId } = c.req.valid('json')
			if (!(await friendIds(db, user.id)).includes(userId)) return c.json({ error: 'not-friends' as const }, 403)
			const [party, me] = await Promise.all([
				parties.current(user.id),
				db.player.findUnique({ where: { userId: user.id }, select: { name: true } })
			])
			await notify(valkey, [userId], { type: 'invite', from: me?.name ?? '', code: party.code })
			return c.json({ status: 'invited' as const }, 200)
		})
		.post('/friends/join', zValidator('json', target), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { userId } = c.req.valid('json')
			if (!(await friendIds(db, user.id)).includes(userId)) return c.json({ error: 'not-friends' as const }, 403)
			const theirs = await parties.current(userId)
			try {
				const { party, left } = await parties.join(user.id, theirs.code)
				const members = new Set([...party.members])
				if (left) for (const member of (await parties.get(left))?.members ?? []) members.add(member)
				await notify(valkey, members, { type: 'party' })
				return c.json({ status: 'joined' as const }, 200)
			} catch (error) {
				if (error instanceof PartyError) return c.json({ error: error.code }, 409)
				throw error
			}
		})
}
