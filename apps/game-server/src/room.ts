import { maps } from '@rotline/game-data'
import { SnapshotEncoder, Writer, writeEvents, writePing, writeWelcome } from '@rotline/protocol'
import { EMPTY_INPUT, type PlayerInput, type SimEvent, World } from '@rotline/sim'

/** Snapshots go out every SNAPSHOT_EVERY ticks (15 Hz at 30 Hz ticks). */
export const SNAPSHOT_EVERY = 2
/** Inputs buffered beyond this are dropped (oldest first), so a client cannot bank up movement. */
const MAX_QUEUED_INPUTS = 6
/** Seconds a disconnected player keeps their place in the room. */
export const RECONNECT_GRACE_SECONDS = 120

export type Connection = {
	send(bytes: Uint8Array): boolean
	close(): void
}

type Member = {
	userId: string
	name: string
	slot: number
	connection: Connection | null
	encoder: SnapshotEncoder
	queue: PlayerInput[]
	lastQueuedSeq: number
	lastInput: PlayerInput
	disconnectedAt: number
	rtt: number
}

/** One mission instance: a World plus the players connected to it. */
export class Room {
	readonly id: string
	readonly world: World
	readonly mode: 'solo'
	readonly capacity: number
	private readonly members = new Map<string, Member>()
	private readonly writer = new Writer(16384)
	private pendingEvents: SimEvent[] = []
	private readonly inputs = new Map<number, PlayerInput>()
	emptySince = 0

	constructor(id: string, mode: 'solo', seed: number, flowPhase: number) {
		this.id = id
		this.mode = mode
		this.capacity = mode === 'solo' ? 1 : 4
		this.world = new World({ seed, map: maps.yard as NonNullable<typeof maps.yard>, flowPhase })
	}

	get playerCount(): number {
		return this.members.size
	}

	get connectedCount(): number {
		let count = 0
		for (const member of this.members.values()) if (member.connection) count++
		return count
	}

	/** Attaches a connection for a player, reusing their character if they are reconnecting. */
	join(userId: string, name: string, connection: Connection): { ok: true; slot: number } | { ok: false } {
		let member = this.members.get(userId)
		if (!member) {
			if (this.members.size >= this.capacity) return { ok: false }
			const used = new Set([...this.members.values()].map(existing => existing.slot))
			let slot = 1
			while (used.has(slot)) slot++
			this.world.addPlayer(slot)
			member = {
				userId,
				name,
				slot,
				connection: null,
				encoder: new SnapshotEncoder(slot),
				queue: [],
				lastQueuedSeq: 0,
				lastInput: { ...EMPTY_INPUT },
				disconnectedAt: 0,
				rtt: 0
			}
			this.members.set(userId, member)
		} else {
			member.connection?.close()
			// a fresh encoder makes the next snapshot complete for the new connection
			member.encoder = new SnapshotEncoder(member.slot)
			member.queue = []
		}
		member.connection = connection
		member.disconnectedAt = 0
		connection.send(writeWelcome(this.writer, member.slot, this.world.map.id, this.world.tick))
		return { ok: true, slot: member.slot }
	}

	leave(userId: string, connection: Connection, now: number): void {
		const member = this.members.get(userId)
		if (!member || member.connection !== connection) return
		member.connection = null
		member.disconnectedAt = now
	}

	receiveInputs(userId: string, inputs: readonly PlayerInput[]): void {
		const member = this.members.get(userId)
		if (!member) return
		for (const input of inputs) {
			if (input.seq <= member.lastQueuedSeq) continue
			member.lastQueuedSeq = input.seq
			member.queue.push(input)
		}
		while (member.queue.length > MAX_QUEUED_INPUTS) member.queue.shift()
	}

	receivePong(userId: string, sentAt: number, now: number): void {
		const member = this.members.get(userId)
		if (member) member.rtt = now - sentAt
	}

	/** Advances the simulation by one tick and sends what changed. */
	tick(now: number): void {
		this.inputs.clear()
		for (const member of this.members.values()) {
			// one input per tick; if none arrived in time, repeat the last one
			const next = member.queue.shift()
			if (next) member.lastInput = next
			this.inputs.set(member.slot, member.lastInput)
		}
		this.world.step(this.inputs)
		for (const event of this.world.events) this.pendingEvents.push(event)

		if (this.world.tick % SNAPSHOT_EVERY === 0) {
			const events = this.pendingEvents.length > 0 ? writeEvents(this.writer, this.pendingEvents) : null
			for (const member of this.members.values()) {
				if (!member.connection) continue
				if (events) member.connection.send(events)
				member.connection.send(member.encoder.write(this.writer, this.world, member.rtt))
			}
			this.pendingEvents = []
		}
		if (this.world.tick % 30 === 0) {
			const ping = writePing(this.writer, now)
			for (const member of this.members.values()) member.connection?.send(ping)
		}

		// drop players whose grace period ran out
		for (const [userId, member] of this.members) {
			if (
				!member.connection &&
				member.disconnectedAt > 0 &&
				now - member.disconnectedAt > RECONNECT_GRACE_SECONDS * 1000
			) {
				this.world.removePlayer(member.slot)
				this.members.delete(userId)
			}
		}
		if (this.members.size === 0 && this.emptySince === 0) this.emptySince = now
		if (this.members.size > 0) this.emptySince = 0
	}

	closeAll(): void {
		for (const member of this.members.values()) member.connection?.close()
	}
}
