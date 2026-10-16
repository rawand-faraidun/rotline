import type { Auth } from '@rotline/auth'
import type { Database } from '@rotline/db'
import { createValkey, Seats, userChannel } from '@rotline/state'
import { afterAll, describe, expect, it } from 'vitest'
import { createQueueApp } from '../../src/app.ts'

// Needs Valkey (VALKEY_URL). Sessions are faked: sign-in itself is covered by the API tests.
const valkey = createValkey(process.env.VALKEY_URL ?? 'redis://localhost:6379', 'rotline-queue-test')
const seats = new Seats(valkey, `test:${crypto.randomUUID().slice(0, 8)}:`)
const origin = 'http://localhost:4321'
const auth = {
	api: {
		getSession: async ({ headers }: { headers: Headers }) => {
			const id = headers.get('x-test-user')
			return id ? { user: { id } } : null
		}
	}
} as unknown as Auth
// nobody here has friends
const db = { friendship: { findMany: async () => [] } } as unknown as Database
const app = createQueueApp({ auth, db, seats, valkey, origin })

async function call(user: string | null, path: string, body?: unknown) {
	const headers = new Headers({ origin })
	if (user) headers.set('x-test-user', user)
	if (body) headers.set('content-type', 'application/json')
	const response = await app.request(`/api/queue${path}`, {
		method: body || path !== '/status' ? 'POST' : 'GET',
		headers,
		...(body ? { body: JSON.stringify(body) } : {})
	})
	return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

const user = (name: string) => `${name}-${crypto.randomUUID()}`

afterAll(async () => {
	await valkey.quit()
})

describe('queue service', () => {
	it('refuses players without a session', async () => {
		expect((await call(null, '/enter')).status).toBe(401)
	})

	it('admits while seats are free, queues the rest, and hands the first in line a pass when a seat frees', async () => {
		await seats.setCapacity(2)
		const [a, b, c, d] = [user('a'), user('b'), user('c'), user('d')]
		expect((await call(a, '/enter')).body.state).toBe('admitted')
		expect((await call(b, '/enter')).body.state).toBe('admitted')
		const third = await call(c, '/enter')
		expect(third.body).toMatchObject({ state: 'queued', position: 1, total: 1 })
		expect((await call(d, '/enter')).body).toMatchObject({ state: 'queued', position: 2, total: 2 })

		// nothing frees, nothing is admitted
		expect(await seats.admit()).toEqual([])

		const events = createValkey(process.env.VALKEY_URL ?? 'redis://localhost:6379', 'rotline-queue-test-sub')
		await events.subscribe(userChannel(c))
		const message = new Promise<string>(resolve => events.on('message', (_channel, text) => resolve(text)))

		await call(a, '/leave')
		const admitted = await seats.admit()
		expect(admitted).toEqual([c])
		const { notify } = await import('@rotline/state')
		await notify(valkey, admitted, { type: 'seat', status: 'admitted' })
		expect(JSON.parse(await message)).toEqual({ type: 'seat', status: 'admitted' })
		await events.quit()

		const status = await call(c, '/status')
		expect(status.body.state).toBe('pass')
		expect((await call(d, '/status')).body).toMatchObject({ state: 'queued', position: 1 })
		// a pass holds the seat: a newcomer still queues behind d
		expect((await call(user('e'), '/enter')).body).toMatchObject({ state: 'queued', position: 2 })
		expect((await call(c, '/enter')).body.state).toBe('admitted')
	})

	it('keeps seats with heartbeats, warns idle players and then releases their seat', async () => {
		await seats.setCapacity(10)
		const a = user('idle')
		await call(a, '/enter')
		// the earlier test left people in line; they (and a) are let in first
		await seats.admit()
		expect((await call(a, '/enter')).body.state).toBe('admitted')
		expect((await call(a, '/heartbeat', { idleSeconds: 5 })).body.state).toBe('ok')
		expect((await call(a, '/heartbeat', { idleSeconds: 650 })).body.state).toBe('warning')
		expect((await call(a, '/heartbeat', { idleSeconds: 730 })).body).toEqual({ state: 'lost', reason: 'idle' })
		expect((await call(a, '/status')).body.state).toBe('none')
		expect((await call(a, '/heartbeat', { idleSeconds: 0 })).body).toEqual({ state: 'lost', reason: 'expired' })
	})

	it('refuses state changes from other origins', async () => {
		const response = await app.request('/api/queue/enter', {
			method: 'POST',
			headers: { origin: 'https://evil.example', 'x-test-user': user('x') }
		})
		expect(response.status).toBe(403)
	})
})
