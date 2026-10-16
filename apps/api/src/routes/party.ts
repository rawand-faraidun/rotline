import { randomUUID } from 'node:crypto'
import { friendIds } from '@rotline/db'
import { buildProblem, levelFromXp } from '@rotline/game-data'
import { liveInstances, notify, type Party, PartyError, pickInstance, roomExists, setPresence } from '@rotline/state'
import { loadPrivateKey, signTicket } from '@rotline/ticket'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { loadBuild } from '../lib/build.ts'
import { recordRecentPlayers } from './friends.ts'
import { ensureStarterKit } from './progress.ts'

/** Path the browser connects to for the game (same origin; the reverse proxy routes it). */
export const GAME_PATH = '/game'
/** A mission whose room never appeared (nobody connected) is given up after this long. */
const ROOM_START_GRACE_MS = 30_000
const HEARTBEAT_MS = 20_000
/** How long a player's firing range stays on the same game server. */
const RANGE_STICKY_SECONDS = 15 * 60

const errorStatus = {
	'not-found': 404,
	full: 409,
	'in-mission': 409,
	'not-leader': 403,
	'not-ready': 409,
	'not-member': 404
} as const

export function partyRoutes(services: Services) {
	const { db, env, log, parties, seats, valkey, events } = services
	const key = loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY)

	/**
	 * The game server holding a player's firing range: the same one each time while it is alive, so
	 * one player cannot open a range room on every instance.
	 */
	async function rangeInstance(userId: string): Promise<string> {
		const assigned = await valkey.get(`range:${userId}`)
		const live = await liveInstances(valkey)
		const instance =
			(assigned && live.some(entry => entry.id === assigned && !entry.draining) ? assigned : null) ??
			(await pickInstance(valkey)) ??
			env.GAME_INSTANCE_ID
		await valkey.set(`range:${userId}`, instance, 'EX', RANGE_STICKY_SECONDS)
		return instance
	}

	/** Parties stuck "in mission" after their room closed go back to the lobby. */
	async function settle(party: Party): Promise<Party> {
		if (party.state !== 'mission') return party
		if (Date.now() - party.startedAt < ROOM_START_GRACE_MS) return party
		if (await roomExists(valkey, party.room)) return party
		await parties.endMission(party.id)
		return { ...party, state: 'lobby', room: '', instance: '', startedAt: 0, ready: [] }
	}

	async function view(party: Party, you: string) {
		const players = await db.player.findMany({
			where: { userId: { in: party.members } },
			select: {
				userId: true,
				name: true,
				avatarStyle: true,
				avatarSeed: true,
				activeClass: true,
				classes: { select: { class: true, xp: true } }
			}
		})
		const byId = new Map(players.map(player => [player.userId, player]))
		const members = party.members.flatMap(id => {
			const player = byId.get(id)
			if (!player) return []
			return [
				{
					id,
					name: player.name,
					avatarStyle: player.avatarStyle,
					avatarSeed: player.avatarSeed,
					activeClass: player.activeClass,
					level: levelFromXp(Number(player.classes.find(entry => entry.class === player.activeClass)?.xp ?? 0)).level,
					ready: id === party.leader || party.ready.includes(id),
					leader: id === party.leader
				}
			]
		})
		return {
			id: party.id,
			code: party.code,
			state: party.state,
			you,
			leader: party.leader,
			members,
			canStart: party.leader === you && party.state === 'lobby' && members.every(member => member.ready)
		}
	}

	async function changed(...partyIds: (string | null)[]) {
		const userIds = new Set<string>()
		for (const id of partyIds) {
			if (!id) continue
			const party = await parties.get(id)
			for (const member of party?.members ?? []) userIds.add(member)
		}
		await notify(valkey, userIds, { type: 'party' })
	}

	return (
		new Hono<AppEnv>()
			.use('/party/*', async (c, next) => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const player = await db.player.findUnique({ where: { userId: user.id }, select: { userId: true } })
				if (!player) return c.json({ error: 'no-player' as const }, 404)
				await next()
			})
			.onError((error, c) => {
				if (error instanceof PartyError) return c.json({ error: error.code }, errorStatus[error.code])
				throw error
			})
			.get('/party', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const party = await settle(await parties.current(user.id))
				return c.json(await view(party, user.id), 200)
			})
			.post('/party/join', zValidator('json', z.object({ code: z.string().trim().length(6) })), async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const { party, left } = await parties.join(user.id, c.req.valid('json').code)
				await changed(party.id, left)
				return c.json(await view(party, user.id), 200)
			})
			.post('/party/leave', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const { party, left } = await parties.leave(user.id)
				await changed(left)
				return c.json(await view(party, user.id), 200)
			})
			.post('/party/kick', zValidator('json', z.object({ userId: z.uuid() })), async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const { userId } = c.req.valid('json')
				const party = await parties.kick(user.id, userId)
				await changed(party.id)
				await notify(valkey, [userId], { type: 'party' })
				return c.json(await view(party, user.id), 200)
			})
			.post('/party/ready', zValidator('json', z.object({ ready: z.boolean() })), async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const party = await parties.setReady(user.id, c.req.valid('json').ready)
				await changed(party.id)
				return c.json(await view(party, user.id), 200)
			})
			.post('/party/start', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const instance = (await pickInstance(valkey)) ?? env.GAME_INSTANCE_ID
				const party = await parties.start(user.id, `squad-${randomUUID()}`, instance)
				await changed(party.id)
				if (party.members.length > 1) await recordRecentPlayers(db, party.members)
				return c.json(await view(party, user.id), 200)
			})
			.post('/game/ticket', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const player = await db.player.findUnique({ where: { userId: user.id }, select: { name: true } })
				if (!player) return c.json({ error: 'no-player' as const }, 404)
				const party = await settle(await parties.current(user.id))
				if (party.state !== 'mission') return c.json({ error: 'no-mission' as const }, 409)
				// only players holding a seat may play; everyone else waits in the queue
				if ((await seats.status(user.id)).state !== 'admitted') return c.json({ error: 'no-seat' as const }, 403)
				await ensureStarterKit(db, user.id)
				const build = await loadBuild(db, user.id)
				if (!build || buildProblem(build)) {
					log.error({ userId: user.id, problem: build && buildProblem(build) }, 'invalid build')
					return c.json({ error: 'invalid-build' as const }, 409)
				}
				const { ticket, payload } = signTicket(key, {
					sub: user.id,
					name: player.name,
					room: party.room,
					inst: party.instance,
					mode: 'squad',
					build
				})
				return c.json({ ticket, room: payload.room, path: GAME_PATH, expiresAt: payload.exp }, 200)
			})
			// the firing range: a room of one, on the least busy game server, earning nothing
			.post('/game/range', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const player = await db.player.findUnique({ where: { userId: user.id }, select: { name: true } })
				if (!player) return c.json({ error: 'no-player' as const }, 404)
				if ((await seats.status(user.id)).state !== 'admitted') return c.json({ error: 'no-seat' as const }, 403)
				if ((await settle(await parties.current(user.id))).state === 'mission') {
					return c.json({ error: 'in-mission' as const }, 409)
				}
				await ensureStarterKit(db, user.id)
				const build = await loadBuild(db, user.id)
				if (!build || buildProblem(build)) return c.json({ error: 'invalid-build' as const }, 409)
				const { ticket, payload } = signTicket(key, {
					sub: user.id,
					name: player.name,
					room: `range-${user.id}`,
					inst: await rangeInstance(user.id),
					mode: 'range',
					build
				})
				return c.json({ ticket, room: payload.room, path: GAME_PATH, expiresAt: payload.exp }, 200)
			})
			.get('/events', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				// an open stream means the player is online: keep their presence fresh and tell friends when it changes
				const announce = async () => {
					const party = await parties.current(user.id)
					const status = party.state === 'mission' ? 'mission' : 'lobby'
					const detail = party.state === 'mission' ? 'The Yard' : ''
					if (await setPresence(valkey, user.id, { status, detail })) {
						await notify(valkey, await friendIds(db, user.id), { type: 'presence', userId: user.id, status, detail })
					}
				}
				return streamSSE(c, async stream => {
					const unsubscribe = await events.subscribe(user.id, event => {
						void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
						// a squad change may change what friends see (lobby or in a mission)
						if (event.type === 'party') void announce()
					})
					stream.onAbort(() => {
						void unsubscribe()
						// let presence lapse soon unless another tab keeps it alive
						void valkey.expire(`presence:${user.id}`, 20)
					})
					await stream.writeSSE({ event: 'hello', data: '{}' })
					await announce()
					while (!stream.aborted) {
						await stream.sleep(HEARTBEAT_MS)
						if (stream.aborted) break
						await stream.write(': keep-alive\n\n')
						await announce()
					}
				})
			})
	)
}
