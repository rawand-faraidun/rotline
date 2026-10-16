import type { Valkey } from './client.ts'

/** Fixed-window rate limit in Valkey: at most `limit` calls per window per key, shared by every instance. */
export async function allow(valkey: Valkey, key: string, limit: number, windowMs: number): Promise<boolean> {
	const count = await valkey.incr(key)
	if (count === 1) await valkey.pexpire(key, windowMs)
	return count <= limit
}
