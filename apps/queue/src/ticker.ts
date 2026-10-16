import { liveInstances, notify, type Seats, type Valkey } from '@rotline/state'
import type { Logger } from 'pino'

/** Ticks above this (p99 over the last few seconds) count as an unhealthy game server. */
const SLOW_TICK_MS = 10
const LOCK_KEY = 'queue:ticker'

/**
 * Once a second, exactly one queue process (holding a short Valkey lock) hands admission passes to
 * the front of the queue, and adjusts the effective capacity: while any game server ticks slowly it
 * drops by 10 % a minute (never below half), then recovers by one seat a minute.
 */
export function startTicker(valkey: Valkey, seats: Seats, log: Logger, instanceId: string): () => void {
	let effective: number | null = null
	let lastAdjust = 0
	const tick = async () => {
		const owned =
			(await valkey.set(LOCK_KEY, instanceId, 'PX', 1500, 'NX')) === 'OK' || (await valkey.get(LOCK_KEY)) === instanceId
		if (!owned) return
		await valkey.pexpire(LOCK_KEY, 1500)

		const now = Date.now()
		if (now - lastAdjust >= 60_000) {
			lastAdjust = now
			const capacity = await seats.capacity()
			const slow = (await liveInstances(valkey)).some(instance => instance.tickMaxMs > SLOW_TICK_MS)
			const current = effective ?? capacity
			const next = slow
				? Math.max(Math.ceil(capacity / 2), current - Math.ceil(capacity * 0.1))
				: Math.min(capacity, current + 1)
			if (next !== current) log.warn({ capacity, effective: next, slow }, 'effective capacity changed')
			effective = next >= capacity ? null : next
			await seats.setEffectiveCapacity(effective)
		}

		const admitted = await seats.admit(now)
		if (admitted.length > 0) {
			log.info({ admitted: admitted.length }, 'admission passes issued')
			await notify(valkey, admitted, { type: 'seat', status: 'admitted' })
		}
	}
	const timer = setInterval(() => {
		tick().catch(error => log.error({ err: error }, 'queue tick failed'))
	}, 1000)
	return () => clearInterval(timer)
}
