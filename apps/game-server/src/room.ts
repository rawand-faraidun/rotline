import { randomUUID } from 'node:crypto'
import {
	type Build,
	buffs,
	type DifficultyId,
	difficultyDef,
	economy,
	type MapDef,
	type MissionDef,
	maps,
	masteryFor,
	missionById,
	SURVIVAL_MAP,
	zombieIndex,
	zombies
} from '@rotline/game-data'
import {
	RangeAction,
	SnapshotEncoder,
	Writer,
	writeEvents,
	writeKick,
	writePing,
	writeResults,
	writeRoster,
	writeWelcome
} from '@rotline/protocol'
import { DT, MissionStatus, type PlayerInput, type SimEvent, TICK_RATE, World } from '@rotline/sim'
import { itemIndex } from './items.ts'

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
/** Accuracy worth logging: this share of hits over at least this many shots. */
const SUSPICION_ACCURACY = 0.97
const SUSPICION_MIN_SHOTS = 300
/** Firing-range commands per second (and burst), so one client cannot flood the room. */
const RANGE_COMMAND_RATE = 4
const RANGE_COMMAND_BURST = 6
/** The firing range does not hold a place for long: there is nothing to come back to. */
const RANGE_GRACE_SECONDS = 10
/** Seconds a disconnected player keeps their place in the room. */
export const RECONNECT_GRACE_SECONDS = 120

export type Connection = {
	send(bytes: Uint8Array): boolean
	close(): void
}

/** After a mission is complete (or a Survival run is over) the room stays open this long, then closes. */
export const RESULTS_SECONDS = 20
/** A room of one may stay paused this long; then the game simply goes on. */
const MAX_PAUSE_MS = 10 * 60 * 1000
const ACTIVE_TICKS = Math.round(economy.rewards.activeSeconds * TICK_RATE)
const DOUBLE_XP = buffs.buffs.find(buff => buff.id === 'double-xp')?.params.xp ?? 1

/**
 * What a player earned since their last report, flushed at each wave cleared or checkpoint and
 * when they leave. XP and Salvage are already scaled by the difficulty's reward multiplier.
 */
type Earnings = {
	xp: number
	salvage: number
	/** objective pay waiting for the next checkpoint (or the end): an abandoned mission pays none of it */
	pendingXp: number
	pendingSalvage: number
	/** the simulation's score (and the part of it earned under Double XP) already turned into XP and Salvage */
	scoreReported: number
	doubledReported: number
	kills: number
	reports: number
	/** moved, aimed or fired since the last cleared wave or objective: idle players are not paid for it */
	active: boolean
	/** ticks connected and playing: results, completion and the final item need a share of the mission */
	activeTicks: number
	/** exactly what the reports granted, for the results screen */
	reportedXp: number
	reportedSalvage: number
	totalKills: number
	/** for spotting aim assistance: shots fired and zombies hit by this player's shots */
	shots: number
	hits: number
	/** unique per membership, so a player who leaves and rejoins (or a restarted server) never reuses a grant key */
	nonce: string
}

export type MissionRoom = { id: string; difficulty: DifficultyId }

export type MissionResult = {
	missionId: string
	difficulty: DifficultyId
	success: boolean
	timeMs: number
	/** the squad's total score */
	score: number
	downs: number
	squad: number
	optionalDone: number
}

export type RewardSink = (report: {
	grantKey: string
	userId: string
	class: Build['class']
	xp: number
	salvage: number
	kills: number
	/** item ids found since the last checkpoint */
	items?: string[]
	/** a finished mission, for best times and mastery */
	result?: MissionResult
}) => void

type Member = {
	userId: string
	name: string
	slot: number
	build: Build
	earnings: Earnings
	connection: Connection | null
	encoder: SnapshotEncoder
	/** items (indices) already reported this mission, for the results screen */
	reportedItems: number[]
	/** this player's own events (their drops), sent only to them */
	privateEvents: SimEvent[]
	/** the results screen, kept so a player reconnecting during the results still sees it */
	results: Uint8Array | null
	resultsSent: boolean
	queue: PlayerInput[]
	lastQueuedSeq: number
	disconnectedAt: number
	inputTokens: number
	tokensAt: number
	rtt: number
}

/** One mission, Survival run or firing range: a World plus the players connected to it. */
export class Room {
	readonly id: string
	readonly world: World
	readonly mode: 'squad' | 'range'
	readonly capacity: number
	private readonly members = new Map<string, Member>()
	private readonly writer = new Writer(16384)
	private pendingEvents: SimEvent[] = []
	private readonly inputs = new Map<number, PlayerInput>()
	emptySince = 0
	/** wall-clock time the mission was completed or the run ended (0 before); the room closes RESULTS_SECONDS later */
	completedAt = 0
	/** a room of one can be paused from the pause menu */
	private pausedAt = 0
	/** something paid the players who played this tick; their "played" marks are cleared after it */
	private paidThisTick = false
	private readonly onReward: RewardSink
	/** the mission and difficulty every ticket to this room must name; null for Survival and the range */
	readonly missionRoom: MissionRoom | null
	private readonly missionDef: MissionDef | null
	/** the difficulty's reward multiplier */
	private readonly rewardScale: number
	private readonly startTick: number

	constructor(
		id: string,
		mode: 'squad' | 'range',
		seed: number,
		flowPhase: number,
		onReward: RewardSink = () => {},
		mission: MissionRoom | null = null,
		lootSeed = seed
	) {
		this.id = id
		this.onReward = onReward
		this.mode = mode
		const range = mode === 'range'
		// the firing range is solo and earns nothing
		this.capacity = range ? 1 : 4
		this.missionDef = !range && mission ? (missionById(mission.id) ?? null) : null
		this.missionRoom = this.missionDef && mission ? mission : null
		this.rewardScale = this.missionRoom ? difficultyDef(this.missionRoom.difficulty).rewards : 1
		const map = (range ? maps.range : maps[this.missionDef?.map ?? SURVIVAL_MAP]) as NonNullable<typeof maps.yard>
		this.world = new World({
			seed,
			lootSeed,
			map,
			flowPhase,
			range,
			// a squad room without a mission is Survival: endless rounds, the run ends on a wipe
			survival: !range && !this.missionRoom,
			...(this.missionDef && this.missionRoom
				? { mission: { mission: this.missionDef, difficulty: this.missionRoom.difficulty } }
				: {})
		})
		this.startTick = this.world.tick
		this.rangeRules = map.range ?? null
		for (const spot of this.rangeRules?.dummies ?? []) this.world.spawnZombie(zombieIndex('target-dummy'), spot)
	}

	private readonly rangeRules: MapDef['range'] | null
	/** firing-range commands: a few a second at most */
	private rangeTokens = RANGE_COMMAND_BURST
	private rangeTokensAt = 0

	/** Firing-range controls from the player: spawn zombies they want to practise on, or clear them. */
	rangeCommand(action: number, zombieType: number, count: number, now = performance.now()): void {
		const rules = this.rangeRules
		if (this.mode !== 'range' || !rules) return
		this.rangeTokens = Math.min(
			RANGE_COMMAND_BURST,
			this.rangeTokens + ((now - this.rangeTokensAt) / 1000) * RANGE_COMMAND_RATE
		)
		this.rangeTokensAt = now
		if (this.rangeTokens < 1) return
		this.rangeTokens -= 1
		if (action === RangeAction.clear) {
			for (let i = 0; i < this.world.alive.length; i++) {
				if (this.world.alive[i] === 1 && !zombies[this.world.type[i] as number]?.dummy) {
					this.world.alive[i] = 0
					this.world.aliveCount--
				}
			}
			return
		}
		const def = zombies[zombieType]
		if (action !== RangeAction.spawn || !def || def.dummy) return
		const dummies = rules.dummies.length
		const room = Math.max(0, rules.maxZombies + dummies - this.world.aliveCount)
		for (let n = 0; n < Math.min(count, rules.spawnPerCommand, room); n++) this.world.spawnZombie(zombieType)
	}

	get playerCount(): number {
		return this.members.size
	}

	get connectedCount(): number {
		let count = 0
		for (const member of this.members.values()) if (member.connection) count++
		return count
	}

	/** Is this player in the room (connected or within their grace period)? */
	has(userId: string): boolean {
		return this.members.has(userId)
	}

	/** Everyone in the room, connected or not. */
	userIds(): string[] {
		return [...this.members.keys()]
	}

	/** Connected players' ids, for the one-room-at-a-time claim. */
	connectedUsers(): string[] {
		return [...this.members.values()].filter(member => member.connection).map(member => member.userId)
	}

	/** Disconnects a player (they joined another room). Their character stays for the grace period. */
	disconnect(userId: string, reason: number, now: number): void {
		const member = this.members.get(userId)
		const connection = member?.connection
		if (!member || !connection) return
		connection.send(writeKick(this.writer, reason))
		connection.close()
		this.leave(userId, connection, now)
	}

	/**
	 * The pause menu: a room of one really stops (up to MAX_PAUSE_MS); with others in the room the
	 * game goes on behind the menu.
	 */
	pause(userId: string, paused: boolean, now: number): void {
		if (!this.members.has(userId)) return
		if (!paused) {
			this.pausedAt = 0
			return
		}
		if (this.members.size === 1 && this.completedAt === 0) this.pausedAt = now
	}

	get paused(): boolean {
		return this.pausedAt > 0
	}

	/** Attaches a connection for a player; a reconnecting player keeps their character and build. */
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
				earnings: {
					xp: 0,
					salvage: 0,
					pendingXp: 0,
					pendingSalvage: 0,
					scoreReported: 0,
					doubledReported: 0,
					kills: 0,
					reports: 0,
					active: false,
					activeTicks: 0,
					reportedXp: 0,
					reportedSalvage: 0,
					totalKills: 0,
					shots: 0,
					hits: 0,
					nonce: randomUUID().slice(0, 8)
				},
				connection: null,
				encoder: new SnapshotEncoder(slot),
				reportedItems: [],
				privateEvents: [],
				results: null,
				resultsSent: false,
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
			// the new connection numbers its inputs from 1 again
			member.lastQueuedSeq = 0
			const state = this.world.players.get(member.slot)
			if (state) {
				state.lastSeq = 0
				state.heldButtons = 0
			}
			// the firing range always uses the build the player arrives with
			if (this.mode === 'range') {
				this.world.removePlayer(member.slot)
				this.world.addPlayer(member.slot, build)
				member.build = build
			}
		}
		member.connection = connection
		member.disconnectedAt = 0
		const joined = this.world.players.get(member.slot)
		if (joined) joined.away = false
		connection.send(
			writeWelcome(
				this.writer,
				member.slot,
				this.world.map.id,
				this.world.tick,
				member.build,
				this.missionRoom?.id ?? '',
				this.missionRoom?.difficulty ?? ''
			)
		)
		// back during the results: the results screen again
		if (member.results) {
			connection.send(member.results)
			member.resultsSent = true
		}
		this.broadcastRoster()
		return { ok: true, slot: member.slot }
	}

	leave(userId: string, connection: Connection, now: number): void {
		const member = this.members.get(userId)
		if (!member || member.connection !== connection) return
		member.connection = null
		member.disconnectedAt = now
		// an absent character holds nothing down and does not hold up the extraction
		const state = this.world.players.get(member.slot)
		if (state) {
			state.heldButtons = 0
			state.interactTicks = 0
			state.away = true
		}
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
			if (input.moveX !== 0 || input.moveY !== 0 || input.buttons !== 0) member.earnings.active = true
		}
		while (member.queue.length > MAX_QUEUED_INPUTS) member.queue.shift()
	}

	receivePong(userId: string, sentAt: number, now: number): void {
		const member = this.members.get(userId)
		if (member) member.rtt = now - sentAt
	}

	/** Advances the simulation by one tick and sends what changed. */
	tick(now: number): void {
		if (this.pausedAt > 0) {
			// paused: nothing moves; the connection is kept alive, inputs sent meanwhile are dropped
			if (now - this.pausedAt > MAX_PAUSE_MS || this.members.size !== 1) this.pausedAt = 0
			else {
				for (const member of this.members.values()) member.queue.length = 0
				if (Math.floor(now / 1000) !== Math.floor((now - DT * 1000) / 1000)) {
					const ping = writePing(this.writer, now)
					for (const member of this.members.values()) member.connection?.send(ping)
				}
				return
			}
		}
		this.inputs.clear()
		// events of catch-up inputs (applied before the step) must reach players and rewards too
		this.world.events = []
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
		// participation: connected and playing (counted before the step that may end the mission)
		if (!this.world.finished) {
			for (const member of this.members.values()) {
				const state = this.world.players.get(member.slot)
				if (member.connection && state && this.world.tick - state.lastActiveTick <= ACTIVE_TICKS)
					member.earnings.activeTicks++
			}
		}
		this.world.step(this.inputs, true)
		for (const event of this.world.events) {
			// a player's drops are theirs: only they hear about them
			if (event.type === 'item-found' || event.type === 'cache') {
				for (const member of this.members.values()) if (member.slot === event.player) member.privateEvents.push(event)
				continue
			}
			this.pendingEvents.push(event)
			if (event.type === 'kill') this.credit(event.by, event.zombieType)
			else if (event.type === 'shot' && event.player > 0) this.count(event.player, 'shots')
			else if (event.type === 'hit' && event.by > 0) this.count(event.by, 'hits')
			// a cleared wave pays everyone connected who played it (not on a restart after a wipe,
			// not the absent, not someone standing idle while the others play)
			else if (event.type === 'cleared') this.payAll(economy.rewards.waveClear, 'now')
			// objectives pay like waves, the first time only; checkpoints save what was earned and found
			else if (event.type === 'objective' && event.first)
				this.payAll(
					this.missionDef?.objectives[event.index]?.optional ? economy.rewards.optional : economy.rewards.objective,
					'pending'
				)
			else if (event.type === 'checkpoint') {
				this.settlePending()
				for (const member of this.members.values()) this.report(member, true)
			} else if (event.type === 'threshold') this.paySalvage(event.player, economy.score.thresholdSalvage)
			else if (event.type === 'mission-complete') this.complete(now)
			else if (event.type === 'run-over') this.runOver(now, event.wave)
		}
		// several payments in one tick (an optional and a step objective) all reach the same players
		if (this.paidThisTick) {
			this.paidThisTick = false
			for (const member of this.members.values()) member.earnings.active = false
		}

		if (this.world.tick % SNAPSHOT_EVERY === 0) {
			const events = this.pendingEvents.length > 0 ? writeEvents(this.writer, this.pendingEvents) : null
			for (const member of this.members.values()) {
				if (!member.connection) continue
				if (events) member.connection.send(events)
				if (member.privateEvents.length > 0) {
					member.connection.send(writeEvents(this.writer, member.privateEvents))
					member.privateEvents = []
				}
				member.connection.send(member.encoder.write(this.writer, this.world, member.rtt))
				// the results go after the events that led to them
				if (member.results && !member.resultsSent) {
					member.connection.send(member.results)
					member.resultsSent = true
				}
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
				now - member.disconnectedAt > (this.mode === 'range' ? RANGE_GRACE_SECONDS : RECONNECT_GRACE_SECONDS) * 1000
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

	/**
	 * Pays everyone connected who played since the last payment (not the absent, not someone
	 * standing idle while the others play); `report` flushes it at once (waves).
	 */
	/**
	 * Pays everyone connected who played since the last payment (not the absent, not someone
	 * standing idle while the others play). Waves are reported at once; objectives wait in a pending
	 * bucket that the next checkpoint or the mission's end pays to those who took part.
	 */
	private payAll(amounts: { xp: number; salvage: number }, mode: 'now' | 'pending'): void {
		const doubled = this.world.tick < this.world.doubleXpUntil ? DOUBLE_XP : 1
		for (const member of this.members.values()) {
			if (!member.connection || !member.earnings.active) continue
			const xp = amounts.xp * doubled * this.rewardScale
			const salvage = amounts.salvage * this.rewardScale
			if (mode === 'pending') {
				member.earnings.pendingXp += xp
				member.earnings.pendingSalvage += salvage
				continue
			}
			this.add(member, xp, salvage)
			this.report(member)
		}
		this.paidThisTick = true
	}

	/** At a checkpoint or the end: pending objective pay goes to those who took part; the rest is dropped. */
	private settlePending(): void {
		for (const member of this.members.values()) {
			const earnings = member.earnings
			const state = this.world.players.get(member.slot)
			if (this.tookPart(member)) {
				this.add(member, earnings.pendingXp, earnings.pendingSalvage)
				// objective score counts now too (and may pass a score threshold)
				if (state) this.world.addScore(state, state.pendingScore, true)
			}
			if (state) state.pendingScore = 0
			earnings.pendingXp = 0
			earnings.pendingSalvage = 0
		}
	}

	private paySalvage(slot: number, salvage: number): void {
		for (const member of this.members.values())
			if (member.slot === slot) this.add(member, 0, salvage * this.rewardScale)
	}

	private add(member: Member, xp: number, salvage: number): void {
		member.earnings.xp += xp
		member.earnings.salvage += salvage
	}

	private credit(slot: number, zombieType: number): void {
		const zombie = zombies[zombieType]
		if (!zombie || this.world.finished) return
		// Double XP multiplies the class XP earned (kills here; objectives and score likewise)
		const xp = zombie.xp * (this.world.tick < this.world.doubleXpUntil ? DOUBLE_XP : 1)
		for (const member of this.members.values()) {
			if (member.slot !== slot) continue
			this.add(member, xp * this.rewardScale, zombie.salvage * this.rewardScale)
			member.earnings.kills++
			member.earnings.totalKills++
		}
	}

	/** Played enough of the mission or run to count: connected and active for the required share of it. */
	private tookPart(member: Member): boolean {
		const elapsed = Math.max(1, this.world.tick - this.startTick)
		return member.earnings.activeTicks >= elapsed * economy.rewards.minParticipation
	}

	/**
	 * The last objective is done: completion rewards and the result for everyone who took part
	 * (connected now or not), everything reported, and each player's results screen (sent after this
	 * tick's events). The room closes RESULTS_SECONDS later.
	 */
	private complete(now: number): void {
		const mission = this.world.mission
		const def = this.missionDef
		const room = this.missionRoom
		if (!mission || !def || !room || this.completedAt > 0) return
		this.completedAt = now
		const timeMs = ((mission.completedTick - mission.startTick) * DT * 1000) | 0
		this.settlePending()
		let squadScore = 0
		for (const state of this.world.players.values()) squadScore += Math.floor(state.score)
		const result: MissionResult = {
			missionId: room.id,
			difficulty: room.difficulty,
			success: true,
			timeMs,
			score: squadScore,
			downs: mission.downs,
			squad: this.world.players.size,
			optionalDone: mission.optionalDone.length
		}
		const mastery = masteryFor(def, result)
		for (const member of this.members.values()) {
			const state = this.world.players.get(member.slot)
			const counts = this.tookPart(member)
			// someone who did not take part keeps what they earned and found, but no result, completion or final item
			if (!counts && state?.finalItem) {
				const at = state.foundItems.lastIndexOf(state.finalItem)
				if (at >= 0) state.foundItems.splice(at, 1)
			}
			if (counts) {
				const reward = economy.rewards.completion
				const doubled = this.world.tick < this.world.doubleXpUntil ? DOUBLE_XP : 1
				this.add(member, reward.xp * doubled * this.rewardScale, reward.salvage * this.rewardScale)
			}
			this.report(member, true, counts ? result : undefined)
			member.results = writeResults(this.writer, {
				success: true,
				rounds: 0,
				timeMs,
				score: Math.floor(state?.score ?? 0),
				kills: member.earnings.totalKills,
				xp: member.earnings.reportedXp,
				salvage: member.earnings.reportedSalvage,
				downs: mission.downs,
				items: member.reportedItems,
				mastery: counts ? mastery : 0
			})
			member.resultsSent = false
		}
	}

	/** Survival: the squad was wiped; everything is reported and the results show the rounds survived. */
	private runOver(now: number, rounds: number): void {
		if (this.completedAt > 0) return
		this.completedAt = now
		const timeMs = ((this.world.tick - this.startTick) * DT * 1000) | 0
		for (const member of this.members.values()) {
			const state = this.world.players.get(member.slot)
			this.report(member)
			member.results = writeResults(this.writer, {
				success: false,
				rounds,
				timeMs,
				score: Math.floor(state?.score ?? 0),
				kills: member.earnings.totalKills,
				xp: member.earnings.reportedXp,
				salvage: member.earnings.reportedSalvage,
				downs: 0,
				items: [],
				mastery: 0
			})
			member.resultsSent = false
		}
	}

	get missionComplete(): boolean {
		return this.world.mission?.status === MissionStatus.complete
	}

	private count(slot: number, field: 'shots' | 'hits'): void {
		for (const member of this.members.values()) if (member.slot === slot) member.earnings[field]++
	}

	/**
	 * Players whose shots almost never miss over many shots are worth a look (aim assistance). This
	 * only logs; nothing is taken away automatically.
	 */
	suspicious(): { userId: string; shots: number; hits: number }[] {
		const flagged: { userId: string; shots: number; hits: number }[] = []
		for (const member of this.members.values()) {
			const { shots, hits } = member.earnings
			if (shots >= SUSPICION_MIN_SHOTS && hits / shots >= SUSPICION_ACCURACY)
				flagged.push({ userId: member.userId, shots, hits })
		}
		return flagged
	}

	/**
	 * Sends what a member earned since the last report; fractions carry over to the next one. Score
	 * turns into XP and Salvage here. Items found travel only with `withItems` (checkpoints and the
	 * mission's end), as the rules say. A report larger than one report may carry is split, the items
	 * and the result going with the last part.
	 */
	private report(member: Member, withItems = false, result?: MissionResult): void {
		if (this.mode === 'range') return
		const earnings = member.earnings
		const state = this.world.players.get(member.slot)
		if (state) {
			const score = state.score - earnings.scoreReported
			const doubled = state.doubledScore - earnings.doubledReported
			earnings.scoreReported = state.score
			earnings.doubledReported = state.doubledScore
			earnings.xp += ((score + doubled * (DOUBLE_XP - 1)) * this.rewardScale) / economy.rewards.scorePerXp
			earnings.salvage += (score * this.rewardScale) / economy.rewards.scorePerSalvage
		}
		let xp = Math.floor(earnings.xp)
		let salvage = Math.floor(earnings.salvage)
		const items = withItems && state ? state.foundItems.splice(0) : []
		if (state) state.itemsReported += items.length
		member.reportedItems.push(...items.map(itemIndex))
		if (xp === 0 && salvage === 0 && earnings.kills === 0 && items.length === 0 && !result) return
		const cap = economy.rewards.maxPerReport
		do {
			const partXp = Math.min(xp, cap.xp)
			const partSalvage = Math.min(salvage, cap.salvage)
			const last = partXp === xp && partSalvage === salvage
			this.onReward({
				grantKey: `${this.id}:${member.userId}:${earnings.nonce}:${earnings.reports}`,
				userId: member.userId,
				class: member.build.class,
				xp: partXp,
				salvage: partSalvage,
				kills: last ? earnings.kills : 0,
				...(last && items.length > 0 ? { items } : {}),
				...(last && result ? { result } : {})
			})
			earnings.reports++
			earnings.reportedXp += partXp
			earnings.reportedSalvage += partSalvage
			earnings.xp -= partXp
			earnings.salvage -= partSalvage
			xp -= partXp
			salvage -= partSalvage
		} while (xp > 0 || salvage > 0)
		earnings.kills = 0
	}

	/** Reports everyone's earnings (the room is closing or the server is shutting down). */
	reportAll(): void {
		for (const member of this.members.values()) this.report(member)
	}

	/** Closes every connection, telling clients why first when there is a reason to give. */
	closeAll(reason?: number): void {
		const kick = reason ? writeKick(this.writer, reason) : null
		for (const member of this.members.values()) {
			if (kick) member.connection?.send(kick)
			member.connection?.close()
		}
	}
}
