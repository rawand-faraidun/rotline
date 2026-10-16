import type { Auth } from '@rotline/auth'
import { type Database, friendIds } from '@rotline/db'
import {
	IDLE_RELEASE_SECONDS,
	IDLE_WARNING_SECONDS,
	notify,
	type Seats,
	setPresence,
	type Valkey
} from '@rotline/state'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

export type QueueServices = { auth: Auth; db: Database; seats: Seats; valkey: Valkey; origin: string }

type QueueEnvVars = { Variables: { userId: string } }

/** Fixed-window rate limit in Valkey: at most `limit` calls per window per key. */
async function allow(valkey: Valkey, key: string, limit: number, windowMs: number): Promise<boolean> {
	const count = await valkey.incr(key)
	if (count === 1) await valkey.pexpire(key, windowMs)
	return count <= limit
}

/**
 * The queue's HTTP surface: tiny and cheap. Sessions are read from the signed cookie cache, so
 * a rush of waiting players costs Valkey round trips, not database queries.
 */
export function createQueueApp({ auth, db, seats, valkey, origin }: QueueServices) {
	/** Waiting players show as "in the queue" to their friends. */
	async function waiting(userId: string) {
		if (await setPresence(valkey, userId, { status: 'queue', detail: '' })) {
			await notify(valkey, await friendIds(db, userId), { type: 'presence', userId, status: 'queue', detail: '' })
		}
	}

	const app = new Hono<QueueEnvVars>().basePath('/api/queue')

	app.get('/health', c => c.json({ status: 'ok' }))

	app.use('*', async (c, next) => {
		if (c.req.method !== 'GET' && c.req.header('origin') !== undefined && c.req.header('origin') !== origin) {
			return c.json({ error: 'forbidden-origin' }, 403)
		}
		const session = await auth.api.getSession({ headers: c.req.raw.headers })
		if (!session) return c.json({ error: 'unauthenticated' }, 401)
		c.set('userId', session.user.id)
		await next()
	})

	const routes = app
		.post('/enter', async c => {
			const userId = c.get('userId')
			if (!(await allow(valkey, `rl:queue-enter:${userId}`, 20, 60_000))) return c.json({ error: 'slow-down' }, 429)
			const status = await seats.enter(userId)
			if (status.state === 'queued') await waiting(userId)
			return c.json(status, 200)
		})
		.get('/status', async c => {
			const userId = c.get('userId')
			if (!(await allow(valkey, `rl:queue-status:${userId}`, 2, 2_000))) return c.json({ error: 'slow-down' }, 429)
			const [status, capacity, counts] = await Promise.all([
				seats.status(userId),
				seats.effectiveCapacity(),
				seats.counts()
			])
			if (status.state === 'queued') await waiting(userId)
			return c.json({ ...status, capacity, online: counts.seats }, 200)
		})
		.post('/heartbeat', zValidator('json', z.object({ idleSeconds: z.number().min(0).max(86_400) })), async c => {
			const userId = c.get('userId')
			const { idleSeconds } = c.req.valid('json')
			if (idleSeconds >= IDLE_RELEASE_SECONDS) {
				await seats.release(userId)
				await notify(valkey, [userId], { type: 'seat', status: 'lost' })
				return c.json({ state: 'lost' as const, reason: 'idle' as const }, 200)
			}
			if (!(await seats.heartbeat(userId))) return c.json({ state: 'lost' as const, reason: 'expired' as const }, 200)
			return c.json({ state: idleSeconds >= IDLE_WARNING_SECONDS ? ('warning' as const) : ('ok' as const) }, 200)
		})
		.post('/leave', async c => {
			await seats.release(c.get('userId'))
			return c.json({ state: 'none' as const }, 200)
		})
	return routes
}

export type QueueApp = ReturnType<typeof createQueueApp>
