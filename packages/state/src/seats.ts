import type { Valkey } from './client.ts'

/**
 * Seats (concurrent players) and the queue. A seat is held by heartbeats; it is released after
 * SEAT_GRACE_MS without one (the reconnect grace period). When seats free up, the first players in
 * the queue get an admission pass valid for PASS_MS; a pass counts as a taken seat until used.
 */
export const DEFAULT_CAPACITY = 24
export const SEAT_GRACE_MS = 120_000
export const PASS_MS = 90_000
/** Lobby idling: a warning at 10 minutes, the seat is released at 12. */
export const IDLE_WARNING_SECONDS = 600
export const IDLE_RELEASE_SECONDS = 720
/** A queued player whose page has not checked in for this long (tab closed) leaves the line. */
export const QUEUE_STALE_MS = 30_000

export type SeatStatus =
	| { state: 'admitted' }
	| { state: 'pass'; expiresAt: number }
	| { state: 'queued'; position: number; total: number; estimateSeconds: number }
	| { state: 'none' }

// KEYS: seats (user → last heartbeat), passes (user → expiry), queue (user → join order),
// admissions (recent admission times), seen (queued user → last check-in)
const PURGE = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[2]))
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local stale = redis.call('ZRANGEBYSCORE', KEYS[5], '-inf', now - ${QUEUE_STALE_MS})
for _, gone in ipairs(stale) do redis.call('ZREM', KEYS[3], gone) end
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now - ${QUEUE_STALE_MS})
`

const ENTER = `${PURGE}
local user, capacity = ARGV[3], tonumber(ARGV[4])
if redis.call('ZSCORE', KEYS[1], user) then
  redis.call('ZADD', KEYS[1], now, user)
  return {'admitted', 0}
end
if redis.call('ZSCORE', KEYS[2], user) then
  redis.call('ZREM', KEYS[2], user)
  redis.call('ZREM', KEYS[3], user)
  redis.call('ZREM', KEYS[5], user)
  redis.call('ZADD', KEYS[1], now, user)
  redis.call('LPUSH', KEYS[4], now)
  redis.call('LTRIM', KEYS[4], 0, 29)
  return {'admitted', 0}
end
local used = redis.call('ZCARD', KEYS[1]) + redis.call('ZCARD', KEYS[2])
if used < capacity and redis.call('ZCARD', KEYS[3]) == 0 then
  redis.call('ZADD', KEYS[1], now, user)
  return {'admitted', 0}
end
if not redis.call('ZSCORE', KEYS[3], user) then
  -- a counter, not the clock: strictly first come, first served even within one millisecond
  redis.call('ZADD', KEYS[3], redis.call('INCR', KEYS[3] .. ':order'), user)
end
redis.call('ZADD', KEYS[5], now, user)
return {'queued', redis.call('ZRANK', KEYS[3], user) + 1}
`

/** Hands passes to the front of the queue while seats are free. Returns the users who got one. */
const ADMIT = `${PURGE}
local capacity, passMs = tonumber(ARGV[3]), tonumber(ARGV[4])
local free = capacity - redis.call('ZCARD', KEYS[1]) - redis.call('ZCARD', KEYS[2])
local admitted = {}
while free > 0 do
  local first = redis.call('ZPOPMIN', KEYS[3])
  if #first == 0 then break end
  redis.call('ZADD', KEYS[2], now + passMs, first[1])
  redis.call('ZREM', KEYS[5], first[1])
  table.insert(admitted, first[1])
  free = free - 1
end
return admitted
`

const HEARTBEAT = `
local now, user = tonumber(ARGV[1]), ARGV[2]
if redis.call('ZSCORE', KEYS[1], user) then
  redis.call('ZADD', KEYS[1], now, user)
  return 1
end
return 0
`

export class Seats {
	private readonly valkey: Valkey
	private readonly keys: [string, string, string, string, string]
	private readonly ns: string

	/** `namespace` keeps tests and parallel environments apart in one Valkey. */
	constructor(valkey: Valkey, namespace = '') {
		this.valkey = valkey
		this.ns = namespace
		this.keys = [
			`${namespace}seats`,
			`${namespace}passes`,
			`${namespace}queue`,
			`${namespace}queue:admissions`,
			`${namespace}queue:seen`
		]
	}

	private run(script: string, ...args: (string | number)[]): Promise<unknown> {
		return this.valkey.eval(script, this.keys.length, ...this.keys, ...args)
	}

	/** The configured capacity (admin setting mirrored here), defaulting to 24. */
	async capacity(): Promise<number> {
		const value = Number(await this.valkey.get(`${this.ns}config:capacity`))
		return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAPACITY
	}

	async setCapacity(capacity: number): Promise<void> {
		await this.valkey.set(`${this.ns}config:capacity`, String(capacity))
	}

	/** Capacity after automatic lowering for server health (set by the queue service). */
	async effectiveCapacity(): Promise<number> {
		const configured = await this.capacity()
		const effective = Number(await this.valkey.get(`${this.ns}queue:effective`))
		return Number.isFinite(effective) && effective > 0 ? Math.min(configured, effective) : configured
	}

	async setEffectiveCapacity(capacity: number | null): Promise<void> {
		if (capacity === null) await this.valkey.del(`${this.ns}queue:effective`)
		else await this.valkey.set(`${this.ns}queue:effective`, String(capacity), 'EX', 120)
	}

	/** Takes a seat if one is free (or the player holds a pass), otherwise joins the queue. */
	async enter(userId: string, now = Date.now()): Promise<SeatStatus> {
		const [state] = (await this.run(ENTER, now, SEAT_GRACE_MS, userId, await this.effectiveCapacity())) as [
			string,
			number
		]
		return state === 'admitted' ? { state: 'admitted' } : this.status(userId, now)
	}

	async status(userId: string, now = Date.now()): Promise<SeatStatus> {
		const [seat, pass, rank, total, admissions] = await this.valkey
			.multi()
			.zscore(this.keys[0], userId)
			.zscore(this.keys[1], userId)
			.zrank(this.keys[2], userId)
			.zcard(this.keys[2])
			.lrange(this.keys[3], '0', '-1')
			.exec()
			.then(
				replies =>
					(replies ?? []).map(reply => reply[1]) as [string | null, string | null, number | null, number, string[]]
			)
		if (seat !== null && now - Number(seat) < SEAT_GRACE_MS) return { state: 'admitted' }
		if (pass !== null && Number(pass) > now) return { state: 'pass', expiresAt: Number(pass) }
		if (rank === null) return { state: 'none' }
		// asking keeps the place in line
		await this.valkey.zadd(this.keys[4], 'XX', now, userId)
		// estimate from how fast seats turned over recently; one per minute until there is data
		const times = admissions.map(Number)
		const interval =
			times.length > 1 ? ((times[0] as number) - (times[times.length - 1] as number)) / (times.length - 1) : 60_000
		return {
			state: 'queued',
			position: rank + 1,
			total,
			estimateSeconds: Math.round(((rank + 1) * Math.max(interval, 5_000)) / 1000)
		}
	}

	/** Keeps a seat. Returns false when the player no longer holds one. */
	async heartbeat(userId: string, now = Date.now()): Promise<boolean> {
		return (await this.run(HEARTBEAT, now, userId)) === 1
	}

	async release(userId: string): Promise<void> {
		await this.valkey
			.multi()
			.zrem(this.keys[0], userId)
			.zrem(this.keys[1], userId)
			.zrem(this.keys[2], userId)
			.zrem(this.keys[4], userId)
			.exec()
	}

	/** Gives passes to the front of the queue while seats are free; returns who got one. */
	async admit(now = Date.now()): Promise<string[]> {
		return (await this.run(ADMIT, now, SEAT_GRACE_MS, await this.effectiveCapacity(), PASS_MS)) as string[]
	}

	async counts(now = Date.now()): Promise<{ seats: number; passes: number; queue: number }> {
		const replies = await this.valkey
			.multi()
			.zcount(this.keys[0], now - SEAT_GRACE_MS, '+inf')
			.zcount(this.keys[1], now, '+inf')
			.zcard(this.keys[2])
			.exec()
		const [seats, passes, queue] = (replies ?? []).map(reply => Number(reply[1]))
		return { seats: seats ?? 0, passes: passes ?? 0, queue: queue ?? 0 }
	}
}
