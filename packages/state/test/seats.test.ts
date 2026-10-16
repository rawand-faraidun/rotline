import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createValkey, PASS_MS, QUEUE_STALE_MS, SEAT_GRACE_MS, Seats } from '../src/index.ts'

const valkey = createValkey(process.env.VALKEY_URL ?? 'redis://localhost:6379', 'rotline-test')
afterAll(() => valkey.quit())

async function seats(capacity: number) {
	const store = new Seats(valkey, `test:${randomUUID()}:`)
	await store.setCapacity(capacity)
	return store
}
const user = () => randomUUID()

describe('seats and queue', () => {
	it('admits up to the capacity, then queues in order', async () => {
		const store = await seats(2)
		const [a, b, c, d] = [user(), user(), user(), user()]
		expect(await store.enter(a)).toEqual({ state: 'admitted' })
		expect(await store.enter(b)).toEqual({ state: 'admitted' })
		expect(await store.enter(c)).toMatchObject({ state: 'queued', position: 1, total: 1 })
		expect(await store.enter(d)).toMatchObject({ state: 'queued', position: 2, total: 2 })
		// entering again keeps your place
		expect(await store.enter(c)).toMatchObject({ state: 'queued', position: 1 })
	})

	it('gives the next player a pass when a seat frees, and the pass becomes a seat', async () => {
		const store = await seats(1)
		const [a, b, c] = [user(), user(), user()]
		await store.enter(a)
		await store.enter(b)
		await store.enter(c)
		expect(await store.admit()).toEqual([])
		await store.release(a)
		expect(await store.admit()).toEqual([b])
		expect(await store.status(b)).toMatchObject({ state: 'pass' })
		// the pass holds the seat: nobody else gets in meanwhile
		expect(await store.enter(user())).toMatchObject({ state: 'queued' })
		expect(await store.enter(b)).toEqual({ state: 'admitted' })
		expect(await store.status(c)).toMatchObject({ state: 'queued', position: 1 })
	})

	it('lets an unused pass expire and frees seats without heartbeats after the grace period', async () => {
		const store = await seats(1)
		const [a, b, c] = [user(), user(), user()]
		const now = Date.now()
		await store.enter(a, now)
		await store.enter(b, now)
		await store.enter(c, now + 1)
		// a stops sending heartbeats; b and c keep their queue pages open
		const later = now + SEAT_GRACE_MS + 1000
		for (const waiting of [b, c]) await store.status(waiting, later - 1000)
		expect(await store.admit(later)).toEqual([b])
		// b never uses the pass
		await store.status(c, later + PASS_MS)
		expect(await store.admit(later + PASS_MS + 1000)).toEqual([c])
		expect(await store.status(b, later + PASS_MS + 1000)).toEqual({ state: 'none' })
	})

	it('keeps a seat with heartbeats and reports a lost one', async () => {
		const store = await seats(1)
		const a = user()
		await store.enter(a)
		expect(await store.heartbeat(a)).toBe(true)
		await store.release(a)
		expect(await store.heartbeat(a)).toBe(false)
	})

	it('respects a lowered effective capacity', async () => {
		const store = await seats(3)
		await store.setEffectiveCapacity(1)
		expect(await store.effectiveCapacity()).toBe(1)
		expect(await store.enter(user())).toEqual({ state: 'admitted' })
		expect(await store.enter(user())).toMatchObject({ state: 'queued' })
		await store.setEffectiveCapacity(null)
		expect(await store.effectiveCapacity()).toBe(3)
	})

	it('drops queued players whose page stopped checking in', async () => {
		const store = await seats(1)
		const [a, b, c] = [user(), user(), user()]
		const now = Date.now()
		await store.enter(a, now)
		await store.enter(b, now)
		await store.enter(c, now)
		// c keeps asking, b closed the tab
		await store.status(c, now + QUEUE_STALE_MS - 1000)
		await store.release(a)
		expect(await store.admit(now + QUEUE_STALE_MS + 1000)).toEqual([c])
		expect(await store.status(b, now + QUEUE_STALE_MS + 1000)).toEqual({ state: 'none' })
	})
})
