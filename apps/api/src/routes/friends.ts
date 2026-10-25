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

const SEARCH_LIMIT = 20

/** A player code as typed or pasted ("a1b2-c3d4", "A1B2C3D4"), or null if it cannot be one. */
export function friendCode(text: string): string | null {
	const code = text.replace(/[\s-]/g, '').toUpperCase()
	return /^[0-9A-F]{8}$/.test(code) ? code : null
}

const requestBody = z.union([
	z.object({ name: z.string().trim().min(1).max(32) }),
	z.object({
		code: z
			.string()
			.trim()
			.max(16)
			.refine(text => friendCode(text) !== null, 'not a player code')
			.transform(text => friendCode(text) as string)
	})
])

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

	return (
		new Hono<AppEnv>()
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
				const [me, rows, blocks, recent] = await Promise.all([
					db.player.findUnique({ where: { userId: user.id }, select: { friendCode: true } }),
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
						code: me?.friendCode ?? '',
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
			.post('/friends/request', zValidator('json', requestBody), async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const body = c.req.valid('json')
				// a name, or a player code: what is typed into one box may be either (a name is tried first)
				const byName =
					'name' in body
						? await db.player.findUnique({ where: { nameKey: playerNameKey(body.name) }, select: { userId: true } })
						: null
				const code = 'code' in body ? body.code : friendCode(body.name)
				const other =
					byName ??
					(code ? await db.player.findUnique({ where: { friendCode: code }, select: { userId: true } }) : null)
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
			// players by part of their name or a name close to it (or by their code), with where each stands with you
			.get('/friends/search', zValidator('query', z.object({ q: z.string().trim().min(2).max(32) })), async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const raw = c.req.valid('query').q
				const query = playerNameKey(raw)
				const code = friendCode(raw)
				const rows = await db.$queryRaw<
					{
						user_id: string
						name: string
						avatar_style: string
						avatar_seed: string
						active_class: string
					}[]
				>`
				SELECT p.user_id, p.name, p.avatar_style, p.avatar_seed, p.active_class
				FROM player p
				WHERE p.user_id <> ${user.id}::uuid
					AND (p.name_key % ${query} OR p.name_key LIKE '%' || ${query} || '%' OR p.friend_code = ${code ?? ''})
					AND NOT EXISTS (
						SELECT 1 FROM block b
						WHERE (b.blocker_id = p.user_id AND b.blocked_id = ${user.id}::uuid)
							OR (b.blocker_id = ${user.id}::uuid AND b.blocked_id = p.user_id)
					)
				ORDER BY p.friend_code = ${code ?? ''} DESC, p.name_key = ${query} DESC,
					p.name_key LIKE ${query} || '%' DESC, similarity(p.name_key, ${query}) DESC, p.name_key
				LIMIT ${SEARCH_LIMIT}
			`
				const ids = rows.map(row => row.user_id)
				const links = await db.friendship.findMany({
					where: {
						OR: [
							{ playerA: user.id, playerB: { in: ids } },
							{ playerB: user.id, playerA: { in: ids } }
						]
					}
				})
				const relation = (id: string) => {
					const link = links.find(row => row.playerA === id || row.playerB === id)
					if (!link) return 'none' as const
					if (link.status === FriendshipStatus.accepted) return 'friend' as const
					return link.requestedBy === user.id ? ('outgoing' as const) : ('incoming' as const)
				}
				return c.json(
					{
						players: rows.map(row => ({
							id: row.user_id,
							name: row.name,
							avatarStyle: row.avatar_style,
							avatarSeed: row.avatar_seed,
							activeClass: row.active_class,
							relation: relation(row.user_id)
						}))
					},
					200
				)
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
	)
}
