import { Redis } from 'ioredis'

export type Valkey = Redis

/** A Valkey connection. Commands queue while (re)connecting, so callers never see a half-open client. */
export function createValkey(url: string, name = 'rotline'): Valkey {
	return new Redis(url, { connectionName: name, maxRetriesPerRequest: 3 })
}
