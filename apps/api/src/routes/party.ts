import { randomUUID } from 'node:crypto'
import { friendIds } from '@rotline/db'
import {
	buildProblem,
	campaign,
	type DifficultyId,
	difficultyId,
	levelFromXp,
	missionById,
	missions,
	SURVIVAL
} from '@rotline/game-data'
import {
	liveInstances,
	notify,
	type Party,
	PartyError,
	pickInstance,
	playerRoom,
	recordRoomMission,
	releasePlayerRoom,
	roomExists,
	setPresence
} from '@rotline/state'
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
/** The campaign's first mission: always open, the default until the leader chooses. */
const DEFAULT_MISSION = campaign.zones[0]?.missions[0] ?? missions[0]?.id ?? ''
/** After abandoning a mission, a new one can start this much later (restarts cannot farm objectives). */
const ABANDON_COOLDOWN_SECONDS = 30
const DEFAULT_DIFFICULTY: DifficultyId = 'veteran'
const MASTERY = ['none', 'bronze', 'silver', 'gold'] as const

/**
 * The stored values to compare a client's view against: a party that never chose has empty fields,
 * which the client saw as the defaults.
 */
function storedView(party: Party, seen: { mission: string; difficulty: string } | undefined) {
	if (!seen) return undefined
	if (party.mission === '' && party.difficulty === '') {
		const chosen = chosenMission(party)
		if (seen.mission === chosen.id && seen.difficulty === chosen.difficulty) return { mission: '', difficulty: '' }
	}
	return seen
}

/**
 * Missions a player may choose: every contract, and the campaign in order — a mission opens once the
 * one before it in its zone is done (any difficulty); a zone opens once the previous zone's last
 * mission is done.
 */
export async function openMissions(db: Services['db'], playerId: string): Promise<Set<string>> {
	const done = new Set(
		(
			await db.missionProgress.findMany({ where: { playerId, completions: { gt: 0 } }, select: { missionId: true } })
		).map(record => record.missionId)
	)
	const open = new Set<string>(campaign.contracts)
	let previous: string | null = null
	for (const zone of campaign.zones) {
		for (const id of zone.missions) {
			if (previous !== null && !done.has(previous)) return open
			open.add(id)
			previous = id
		}
	}
	return open
}

/** The party's mission and difficulty, or the defaults until the leader chooses. */
function chosenMission(party: Party): { id: string; difficulty: DifficultyId } {
	const id = party.mission === SURVIVAL || missionById(party.mission) ? party.mission : DEFAULT_MISSION
	const parsed = difficultyId.safeParse(party.difficulty)
	return { id, difficulty: parsed.success ? parsed.data : DEFAULT_DIFFICULTY }
}

const errorStatus = {
	'not-found': 404,
	full: 409,
	'in-mission': 409,
	'not-leader': 403,
	'not-ready': 409,
	'not-member': 404,
	changed: 409
} as const

/** What the client says it saw: a start or ready mark only counts for that mission and difficulty. */
const seenMission = z.object({ mission: z.string().max(64), difficulty: difficultyId }).optional()

export function partyRoutes(services: Services) {
	const { db, env, log, parties, seats, valkey, events } = services
	const key = loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY)
	// a direct address for the game connection, tried before the one through the site's proxy
	const direct = env.GAME_DIRECT_URL ?? null

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
			mission: chosenMission(party),
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
			// leave a mission for good: a squad of one ends it, a member of a bigger squad leaves the squad
			.post('/party/abandon', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const current = await parties.current(user.id)
				if (current.state !== 'mission') return c.json(await view(current, user.id), 200)
				await releasePlayerRoom(valkey, user.id, current.room)
				await valkey.set(`abandoned:${user.id}`, '1', 'EX', ABANDON_COOLDOWN_SECONDS)
				if (current.members.length === 1) {
					await parties.endMission(current.id)
					await changed(current.id)
					return c.json(await view((await parties.get(current.id)) ?? current, user.id), 200)
				}
				const { party, left } = await parties.leave(user.id)
				await changed(left)
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
			.post('/party/ready', zValidator('json', z.object({ ready: z.boolean(), seen: seenMission })), async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const { ready, seen } = c.req.valid('json')
				const party = await parties.setReady(user.id, ready, storedView(await parties.current(user.id), seen))
				await changed(party.id)
				return c.json(await view(party, user.id), 200)
			})
			// the leader picks what the squad plays next
			.post(
				'/party/mission',
				zValidator(
					'json',
					z.object({
						mission: z.string().refine(id => id === SURVIVAL || missionById(id) !== undefined, 'unknown mission'),
						difficulty: difficultyId
					})
				),
				async c => {
					const user = c.get('user')
					if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
					const { mission, difficulty } = c.req.valid('json')
					// only missions the leader has opened in the campaign (Survival is always open)
					if (mission !== SURVIVAL && !(await openMissions(db, user.id)).has(mission))
						return c.json({ error: 'locked' as const }, 409)
					const party = await parties.setMission(user.id, mission, difficulty)
					await changed(party.id)
					return c.json(await view(party, user.id), 200)
				}
			)
			.get('/missions', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const records = await db.missionProgress.findMany({ where: { playerId: user.id } })
				const open = await openMissions(db, user.id)
				return c.json(
					missions.map(mission => ({
						id: mission.id,
						open: open.has(mission.id),
						difficulties: records
							.filter(record => record.missionId === mission.id)
							.map(record => ({
								difficulty: record.difficulty,
								completions: record.completions,
								bestTimeMs: record.bestTimeMs,
								bestScore: Number(record.bestScore),
								mastery: MASTERY.indexOf(record.mastery)
							}))
					})),
					200
				)
			})
			.post('/party/start', zValidator('json', z.object({ seen: seenMission })), async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				// one squad room at a time: not while still playing in another, nor right after abandoning one
				if (await playerRoom(valkey, user.id)) return c.json({ error: 'elsewhere' as const }, 409)
				if (await valkey.exists(`abandoned:${user.id}`)) return c.json({ error: 'cooldown' as const }, 429)
				const instance = (await pickInstance(valkey)) ?? env.GAME_INSTANCE_ID
				const room = `squad-${randomUUID()}`
				const current = await parties.current(user.id)
				// a new leader may not have opened the mission the squad had chosen
				const wanted = chosenMission(current).id
				if (wanted !== SURVIVAL && !(await openMissions(db, user.id)).has(wanted))
					return c.json({ error: 'locked' as const }, 409)
				// the start goes ahead only for the mission checked above (or the one the client saw)
				const seen = c.req.valid('json').seen
				const party = await parties.start(
					user.id,
					room,
					instance,
					seen ? storedView(current, seen) : { mission: current.mission, difficulty: current.difficulty }
				)
				// the API's own record of what this room plays, checked against the room's reports
				const chosen = chosenMission(party)
				await recordRoomMission(valkey, room, chosen.id === SURVIVAL ? null : chosen)
				await changed(party.id)
				if (party.members.length > 1) await recordRecentPlayers(db, party.members)
				return c.json(await view(party, user.id), 200)
			})
			.post('/game/ticket', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const player = await db.player.findUnique({
					where: { userId: user.id },
					select: { name: true, unrestricted: true }
				})
				if (!player) return c.json({ error: 'no-player' as const }, 404)
				const party = await settle(await parties.current(user.id))
				if (party.state !== 'mission') return c.json({ error: 'no-mission' as const }, 409)
				const elsewhere = await playerRoom(valkey, user.id)
				if (elsewhere && elsewhere !== party.room) return c.json({ error: 'elsewhere' as const }, 409)
				// only players holding a seat may play; everyone else waits in the queue
				if ((await seats.status(user.id)).state !== 'admitted') return c.json({ error: 'no-seat' as const }, 403)
				await ensureStarterKit(db, user.id)
				const build = await loadBuild(db, user.id)
				const rules = { unlimited: player.unrestricted }
				if (!build || buildProblem(build, rules)) {
					log.error({ userId: user.id, problem: build && buildProblem(build, rules) }, 'invalid build')
					return c.json({ error: 'invalid-build' as const }, 409)
				}
				// the mission is fixed once the party has started (the leader can change it only in the lobby);
				// Survival is the endless-rounds mode: a ticket without a mission
				const chosen = chosenMission(party)
				const { ticket, payload } = signTicket(key, {
					sub: user.id,
					name: player.name,
					room: party.room,
					inst: party.instance,
					mode: 'squad',
					...(chosen.id === SURVIVAL ? {} : { mission: chosen }),
					build
				})
				return c.json(
					{
						ticket,
						room: payload.room,
						path: GAME_PATH,
						direct,
						expiresAt: payload.exp,
						mission: payload.mission ?? null
					},
					200
				)
			})
			// the firing range: a room of one, on the least busy game server, earning nothing
			.post('/game/range', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const player = await db.player.findUnique({
					where: { userId: user.id },
					select: { name: true, unrestricted: true }
				})
				if (!player) return c.json({ error: 'no-player' as const }, 404)
				if ((await seats.status(user.id)).state !== 'admitted') return c.json({ error: 'no-seat' as const }, 403)
				if ((await settle(await parties.current(user.id))).state === 'mission') {
					return c.json({ error: 'in-mission' as const }, 409)
				}
				await ensureStarterKit(db, user.id)
				const build = await loadBuild(db, user.id)
				if (!build || buildProblem(build, { unlimited: player.unrestricted }))
					return c.json({ error: 'invalid-build' as const }, 409)
				const { ticket, payload } = signTicket(key, {
					sub: user.id,
					name: player.name,
					room: `range-${user.id}`,
					inst: await rangeInstance(user.id),
					mode: 'range',
					build
				})
				return c.json({ ticket, room: payload.room, path: GAME_PATH, direct, expiresAt: payload.exp }, 200)
			})
			.get('/events', async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				// an open stream means the player is online: keep their presence fresh and tell friends when it changes
				const announce = async () => {
					await parties.touch(user.id)
					const party = await parties.current(user.id)
					const status = party.state === 'mission' ? 'mission' : 'lobby'
					const chosen = chosenMission(party).id
					const detail =
						party.state === 'mission' ? (chosen === SURVIVAL ? 'Survival' : (missionById(chosen)?.name ?? '')) : ''
					if (await setPresence(valkey, user.id, { status, detail })) {
						await notify(valkey, await friendIds(db, user.id), { type: 'presence', userId: user.id, status, detail })
					}
				}
				// proxies and the CDN must pass each event on at once, not buffer or compress the stream
				c.header('Cache-Control', 'no-cache, no-transform')
				c.header('X-Accel-Buffering', 'no')
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
