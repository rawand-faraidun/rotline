import type { Valkey } from './client.ts'

export type PresenceStatus = 'lobby' | 'mission' | 'queue' | 'range' | 'offline'
export type Presence = { status: PresenceStatus; detail: string }

/** Presence expires unless refreshed; a player who closes every tab goes offline within this time. */
const PRESENCE_TTL_SECONDS = 75
const presenceKey = (userId: string) => `presence:${userId}`

/** Sets presence and returns true when it changed (so friends need to hear about it). */
export async function setPresence(valkey: Valkey, userId: string, presence: Presence): Promise<boolean> {
	const key = presenceKey(userId)
	const [[, previous]] = (await valkey
		.multi()
		.hgetall(key)
		.hset(key, presence)
		.expire(key, PRESENCE_TTL_SECONDS)
		.exec()) as [[Error | null, Record<string, string>]]
	return previous?.status !== presence.status || previous?.detail !== presence.detail
}

export async function clearPresence(valkey: Valkey, userId: string): Promise<void> {
	await valkey.del(presenceKey(userId))
}

export async function getPresence(valkey: Valkey, userIds: readonly string[]): Promise<Map<string, Presence>> {
	const result = new Map<string, Presence>()
	if (userIds.length === 0) return result
	const pipeline = valkey.pipeline()
	for (const id of userIds) pipeline.hgetall(presenceKey(id))
	const replies = (await pipeline.exec()) ?? []
	for (const [index, id] of userIds.entries()) {
		const value = replies[index]?.[1] as Record<string, string> | undefined
		result.set(
			id,
			value?.status
				? { status: value.status as PresenceStatus, detail: value.detail ?? '' }
				: { status: 'offline', detail: '' }
		)
	}
	return result
}
