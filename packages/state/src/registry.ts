import type { Valkey } from './client.ts'

/** Game-server instances announce themselves here; the API places rooms on the least busy one. */
export type InstanceInfo = { id: string; rooms: number; players: number; draining: boolean; updated: number }

const INSTANCE_TTL_SECONDS = 15
const ROOM_TTL_SECONDS = 10
const instanceKey = (id: string) => `game:instance:${id}`
const roomKey = (id: string) => `game:room:${id}`

export async function announceInstance(valkey: Valkey, info: Omit<InstanceInfo, 'updated'>): Promise<void> {
	await valkey
		.multi()
		.hset(instanceKey(info.id), { ...info, draining: info.draining ? '1' : '0', updated: Date.now() })
		.expire(instanceKey(info.id), INSTANCE_TTL_SECONDS)
		.sadd('game:instances', info.id)
		.exec()
}

export async function liveInstances(valkey: Valkey): Promise<InstanceInfo[]> {
	const ids = await valkey.smembers('game:instances')
	const live: InstanceInfo[] = []
	for (const id of ids) {
		const raw = await valkey.hgetall(instanceKey(id))
		if (!raw.id) {
			await valkey.srem('game:instances', id)
			continue
		}
		live.push({
			id: raw.id,
			rooms: Number(raw.rooms),
			players: Number(raw.players),
			draining: raw.draining === '1',
			updated: Number(raw.updated)
		})
	}
	return live
}

/** The accepting instance with the fewest players, or null if none is running. */
export async function pickInstance(valkey: Valkey): Promise<string | null> {
	const accepting = (await liveInstances(valkey)).filter(instance => !instance.draining)
	accepting.sort((a, b) => a.players - b.players || a.id.localeCompare(b.id))
	return accepting[0]?.id ?? null
}

/** Rooms refresh this every second while they exist; it expires shortly after a room closes. */
export async function touchRoom(valkey: Valkey, roomId: string, players: number): Promise<void> {
	await valkey.set(roomKey(roomId), String(players), 'EX', ROOM_TTL_SECONDS)
}

export async function roomExists(valkey: Valkey, roomId: string): Promise<boolean> {
	return (await valkey.exists(roomKey(roomId))) === 1
}
