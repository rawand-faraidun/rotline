import { type Build, economy, maps, zombies } from '@rotline/game-data'
import { SnapshotEncoder, Writer, writeEvents, writePing, writeRoster, writeWelcome } from '@rotline/protocol'
import { type PlayerInput, type SimEvent, World } from '@rotline/sim'

/** Snapshots go out every SNAPSHOT_EVERY ticks (15 Hz at 30 Hz ticks). */
export const SNAPSHOT_EVERY = 2
/** Inputs buffered beyond this are dropped (oldest first), so a client cannot bank up movement. */
/** Inputs buffered for a player; about a second, enough to ride out a TCP stall. */
const MAX_QUEUED_INPUTS = 30
/** Beyond this backlog the player is caught up with two inputs per tick. */
const CATCH_UP_BACKLOG = 3
/** Input rate limit (token bucket): the normal rate plus room for one stall's burst. */
const INPUT_RATE = 30
const INPUT_BURST = 24
/** Seconds a disconnected player keeps their place in the room. */
export const RECONNECT_GRACE_SECONDS = 120

export type Connection = {
	send(bytes: Uint8Array): boolean
	close(): void
}

/** What a player earned since their last report, flushed at each wave cleared and when they leave. */
type Earnings = { xp: number; salvage: number; score: number; kills: number; reports: number }

export type RewardSink = (report: {
	grantKey: string
	userId: string
	class: Build['class']
	xp: number
	salvage: number
	kills: number
}) => void

type Member = {
	userId: string
	name: string
	slot: number
	build: Build
	earnings: Earnings
	connection: Connection | null
	encoder: SnapshotEncoder
	queue: PlayerInput[]
	lastQueuedSeq: number
	disconnectedAt: number
	inputTokens: number
	tokensAt: number
	rtt: number
}

/** One mission instance: a World plus the players connected to it. */
export class Room {
	readonly id: string
	readonly world: World
	readonly mode: 'squad'
	readonly capacity: number
	private readonly members = new Map<string, Member>()
	private readonly writer = new Writer(16384)
	private pendingEvents: SimEvent[] = []
	private readonly inputs = new Map<number, PlayerInput>()
	emptySince = 0
	private readonly onReward: RewardSink

	constructor(id: string, mode: 'squad', seed: number, flowPhase: number, onReward: RewardSink = () => {}) {
		this.id = id
		this.onReward = onReward
		this.mode = mode
		this.capacity = 4
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
	/** A reconnecting player keeps their character and the build they started with. */
	join(userId: string, name: string, build: Build, connection: Connection): { ok: true; slot: number } | { ok: false } {
		let member = this.members.get(userId)
		if (!member) {
			if (this.members.size >= this.capacity) return { ok: false }
			const used = new Set([...this.members.values()].map(existing => existing.slot))
			let slot = 1
			while (used.has(slot)) slot++
			this.world.addPlayer(slot, build)
			member = {
				userId,
				name,
				slot,
				build,
				earnings: { xp: 0, salvage: 0, score: 0, kills: 0, reports: 0 },
				connection: null,
				encoder: new SnapshotEncoder(slot),
				queue: [],
				lastQueuedSeq: 0,
				disconnectedAt: 0,
				inputTokens: INPUT_BURST,
				tokensAt: 0,
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
		connection.send(writeWelcome(this.writer, member.slot, this.world.map.id, this.world.tick, member.build))
		this.broadcastRoster()
		return { ok: true, slot: member.slot }
	}

	leave(userId: string, connection: Connection, now: number): void {
		const member = this.members.get(userId)
		if (!member || member.connection !== connection) return
		member.connection = null
		member.disconnectedAt = now
		this.broadcastRoster()
	}

	private broadcastRoster(): void {
		const roster = writeRoster(
			this.writer,
			[...this.members.values()].map(member => ({
				slot: member.slot,
				name: member.name,
				connected: member.connection !== null
			}))
		)
		for (const member of this.members.values()) member.connection?.send(roster)
	}

	receiveInputs(userId: string, inputs: readonly PlayerInput[]): void {
		const member = this.members.get(userId)
		if (!member) return
		// a client may not send inputs faster than the tick rate for long (no banking speed)
		const now = performance.now()
		if (member.tokensAt > 0) {
			member.inputTokens = Math.min(INPUT_BURST, member.inputTokens + ((now - member.tokensAt) / 1000) * INPUT_RATE)
		}
		member.tokensAt = now
		for (const input of inputs) {
			if (input.seq <= member.lastQueuedSeq) continue
			if (member.inputTokens < 1) break
			member.inputTokens -= 1
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
			// at most one input per tick; a player whose input is late simply waits this tick
			if (member.queue.length > CATCH_UP_BACKLOG) {
				const state = this.world.players.get(member.slot)
				const extra = member.queue.shift()
				if (state && extra) this.world.applyInput(state, extra)
			}
			const next = member.queue.shift()
			if (next) this.inputs.set(member.slot, next)
		}
		this.world.step(this.inputs)
		for (const event of this.world.events) {
			this.pendingEvents.push(event)
			if (event.type === 'kill') this.credit(event.by, event.zombieType)
			// a new wave means the last one was cleared: everyone still here is paid and reported
			else if (event.type === 'wave' && event.wave > 1) {
				for (const member of this.members.values()) {
					member.earnings.xp += economy.rewards.waveClear.xp
					member.earnings.salvage += economy.rewards.waveClear.salvage
					this.report(member)
				}
			}
		}

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
				this.report(member)
				this.world.removePlayer(member.slot)
				this.members.delete(userId)
				this.broadcastRoster()
			}
		}
		if (this.members.size === 0 && this.emptySince === 0) this.emptySince = now
		if (this.members.size > 0) this.emptySince = 0
	}

	private credit(slot: number, zombieType: number): void {
		const zombie = zombies[zombieType]
		if (!zombie) return
		for (const member of this.members.values()) {
			if (member.slot !== slot) continue
			member.earnings.xp += zombie.xp
			member.earnings.salvage += zombie.salvage
			member.earnings.score += zombie.score
			member.earnings.kills++
		}
	}

	/** Sends what a member earned since the last report; fractions carry over to the next one. */
	private report(member: Member): void {
		const earnings = member.earnings
		const xpTotal = earnings.xp + earnings.score / economy.rewards.scorePerXp
		const xp = Math.floor(xpTotal)
		const salvage = Math.floor(earnings.salvage)
		if (xp === 0 && salvage === 0 && earnings.kills === 0) return
		this.onReward({
			grantKey: `${this.id}:${member.userId}:${earnings.reports}`,
			userId: member.userId,
			class: member.build.class,
			xp,
			salvage,
			kills: earnings.kills
		})
		earnings.reports++
		earnings.xp = xpTotal - xp
		earnings.salvage -= salvage
		earnings.score = 0
		earnings.kills = 0
	}

	/** Reports everyone's earnings (the room is closing or the server is shutting down). */
	reportAll(): void {
		for (const member of this.members.values()) this.report(member)
	}

	closeAll(): void {
		for (const member of this.members.values()) member.connection?.close()
	}
}
