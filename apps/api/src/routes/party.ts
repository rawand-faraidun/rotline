import { randomUUID } from 'node:crypto'
import { notify, type Party, PartyError, pickInstance, roomExists } from '@rotline/state'
import { loadPrivateKey, signTicket } from '@rotline/ticket'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'

/** Path the browser connects to for the game (same origin; the reverse proxy routes it). */
export const GAME_PATH = '/game'
/** A mission whose room never appeared (nobody connected) is given up after this long. */
const ROOM_START_GRACE_MS = 30_000
const HEARTBEAT_MS = 20_000

const errorStatus = {
	'not-found': 404,
	full: 409,
	'in-mission': 409,
	'not-leader': 403,
	'not-ready': 409,
	'not-member': 404
} as const

export function partyRoutes(services: Services) {
	const { db, env, parties, valkey, events } = services
	const key = loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY)

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
			select: { userId: true, name: true, avatarStyle: true, avatarSeed: true, activeClass: true }
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

	return new Hono<AppEnv>()
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
			return c.json(await view(party, user.id), 200)
		})
		.post('/game/ticket', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const player = await db.player.findUnique({ where: { userId: user.id }, select: { name: true } })
			if (!player) return c.json({ error: 'no-player' as const }, 404)
			const party = await settle(await parties.current(user.id))
			if (party.state !== 'mission') return c.json({ error: 'no-mission' as const }, 409)
			const { ticket, payload } = signTicket(key, {
				sub: user.id,
				name: player.name,
				room: party.room,
				inst: party.instance,
				mode: 'squad'
			})
			return c.json({ ticket, room: payload.room, path: GAME_PATH, expiresAt: payload.exp }, 200)
		})
		.get('/events', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			return streamSSE(c, async stream => {
				const unsubscribe = await events.subscribe(user.id, event => {
					void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
				})
				stream.onAbort(() => void unsubscribe())
				await stream.writeSSE({ event: 'hello', data: '{}' })
				while (!stream.aborted) {
					await stream.sleep(HEARTBEAT_MS)
					if (!stream.aborted) await stream.write(': keep-alive\n\n')
				}
			})
		})
}
