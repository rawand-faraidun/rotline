import { randomUUID } from 'node:crypto'
import { loadPrivateKey, signTicket } from '@rotline/ticket'
import { Hono } from 'hono'
import type { AppEnv, Services } from '../context.ts'

/** Path the browser connects to for the game (same origin; the reverse proxy routes it). */
export const GAME_PATH = '/game'

export function gameRoutes({ db, env }: Services) {
	const key = loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY)

	return new Hono<AppEnv>().post('/game/solo', async c => {
		const user = c.get('user')
		if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
		const player = await db.player.findUnique({ where: { userId: user.id }, select: { name: true } })
		if (!player) return c.json({ error: 'no-player' as const }, 404)
		const { ticket, payload } = signTicket(key, {
			sub: user.id,
			name: player.name,
			room: `solo-${randomUUID()}`,
			inst: env.GAME_INSTANCE_ID,
			mode: 'solo'
		})
		return c.json({ ticket, room: payload.room, path: GAME_PATH, expiresAt: payload.exp }, 200)
	})
}
