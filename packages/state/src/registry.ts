import type { Valkey } from './client.ts'

/** Game-server instances announce themselves here; the API places rooms on the least busy one. */
export type InstanceInfo = {
	id: string
	rooms: number
	players: number
	draining: boolean
	/** slowest tick since the last announcement, ms */
	tickMaxMs: number
	updated: number
}

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
			tickMaxMs: Number(raw.tickMaxMs ?? 0),
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

/** A player is in one squad room at a time; game servers hold this while the player is connected. */
const PLAYER_ROOM_SECONDS = 30
const playerRoomKey = (userId: string) => `game:player-room:${userId}`

/**
 * Claims (or refreshes) the player's place in `roomId`. Returns false when the player holds a place
 * in another room: one account cannot play two squad rooms at once.
 */
export async function claimPlayerRoom(valkey: Valkey, userId: string, roomId: string): Promise<boolean> {
	return (await valkey.eval(CLAIM, 0, playerRoomKey(userId), roomId, PLAYER_ROOM_SECONDS)) === 1
}

/** The squad room the player is connected to, if any. */
export async function playerRoom(valkey: Valkey, userId: string): Promise<string | null> {
	return valkey.get(playerRoomKey(userId))
}

/** Gives the place up (the player left that room for good). Only removes it if it names `roomId`. */
export async function releasePlayerRoom(valkey: Valkey, userId: string, roomId?: string): Promise<void> {
	if (!roomId) {
		await valkey.del(playerRoomKey(userId))
		return
	}
	await valkey.eval(RELEASE, 0, playerRoomKey(userId), roomId)
}

/** Forgets a room at once (it finished), so the squad goes back to the lobby without waiting. */
export async function dropRoom(valkey: Valkey, roomId: string): Promise<void> {
	await valkey.del(roomKey(roomId))
}

/** The mission and difficulty a squad room was started with, as the API recorded it. */
const roomMissionKey = (roomId: string) => `game:room-mission:${roomId}`
const ROOM_MISSION_SECONDS = 8 * 60 * 60

export async function recordRoomMission(
	valkey: Valkey,
	roomId: string,
	mission: { id: string; difficulty: string } | null
): Promise<void> {
	await valkey.set(
		roomMissionKey(roomId),
		mission ? `${mission.id}:${mission.difficulty}` : 'survival',
		'EX',
		ROOM_MISSION_SECONDS
	)
}

export async function roomMission(
	valkey: Valkey,
	roomId: string
): Promise<{ id: string; difficulty: string } | 'survival' | null> {
	const value = await valkey.get(roomMissionKey(roomId))
	if (!value) return null
	if (value === 'survival') return 'survival'
	const [id = '', difficulty = ''] = value.split(':')
	return { id, difficulty }
}

const CLAIM = `
local current = redis.call('GET', ARGV[1])
if current and current ~= ARGV[2] then return 0 end
redis.call('SET', ARGV[1], ARGV[2], 'EX', ARGV[3])
return 1
`

const RELEASE = `
if redis.call('GET', ARGV[1]) == ARGV[2] then redis.call('DEL', ARGV[1]) end
return 1
`
