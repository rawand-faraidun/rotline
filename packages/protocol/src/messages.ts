import { ARMOUR_PIECES, type Build, buildSchema, classes, dataVersion, gear, weapons } from '@rotline/game-data'
import {
	CHAIN_TICKS,
	currentObjective,
	MAX_ZOMBIES,
	MissionStatus,
	ObjectKind,
	objectiveGoal,
	type PlayerInput,
	type PlayerState,
	type Pool,
	REVIVE_COMPLETE,
	type SimEvent,
	TICK_RATE,
	timeLeft,
	type World,
	type WorldObject
} from '@rotline/sim'
import { ProtocolError, type Reader, type Writer } from './buffer.ts'

/** a mission clock's "no time limit" */
const NO_LIMIT = 0xffff
const nullableSeconds = (value: number) => (value === NO_LIMIT ? null : value)

export const PROTOCOL_VERSION = 9

export const ClientMessage = { hello: 1, input: 2, pong: 3, range: 4, pause: 5 } as const

/** Firing-range controls: spawn zombies of a type, or clear them away. */
export const RangeAction = { spawn: 1, clear: 2 } as const
export const ServerMessage = {
	welcome: 10,
	snapshot: 11,
	events: 12,
	ping: 13,
	kick: 14,
	roster: 15,
	results: 16
} as const

export const KickReason = {
	badTicket: 1,
	roomFull: 2,
	protocol: 3,
	replaced: 4,
	shutdown: 5,
	idle: 6,
	/** the mission is over and the results have been shown */
	complete: 7,
	/** the player is in another squad room already */
	elsewhere: 8
} as const

/** Positions travel in 1/64 m steps. */
const POSITION_SCALE = 64
/** Inputs carry the last few inputs so one lost packet loses nothing. */
export const INPUT_REDUNDANCY = 3
/** Players beyond this distance are still sent; zombies beyond it are not. */
export const INTEREST_RADIUS = 40

const q = (metres: number) => Math.max(0, Math.min(0xffff, Math.round(metres * POSITION_SCALE)))
const dq = (value: number) => value / POSITION_SCALE

// --- client → server ---------------------------------------------------------------------------

export type HelloMessage = { type: 'hello'; version: number; ticket: string }
export type InputMessage = { type: 'input'; ackSnapshot: number; inputs: PlayerInput[] }
export type PongMessage = { type: 'pong'; time: number }
export type RangeMessage = { type: 'range'; action: number; zombieType: number; count: number }
/** The pause menu opened or closed; only a room of one actually stops. */
export type PauseMessage = { type: 'pause'; paused: boolean }
export type ClientToServer = HelloMessage | InputMessage | PongMessage | RangeMessage | PauseMessage

export function writeHello(w: Writer, ticket: string): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ClientMessage.hello).u16(PROTOCOL_VERSION).string(ticket).finish()
}

/** Inputs oldest first; the server ignores ones it has already applied. */
export function writeInput(w: Writer, ackSnapshot: number, inputs: readonly PlayerInput[]): Uint8Array<ArrayBuffer> {
	w.reset().u8(ClientMessage.input).u32(ackSnapshot).u8(inputs.length)
	for (const input of inputs) {
		w.u32(input.seq).i8(input.moveX).i8(input.moveY).u16(input.aim).u16(input.buttons).u32(input.viewTick)
		w.u8(Math.max(0, Math.min(255, Math.round(input.reach))))
	}
	return w.finish()
}

export function writeRange(w: Writer, action: number, zombieType = 0, count = 1): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ClientMessage.range).u8(action).u8(zombieType).u8(count).finish()
}

export function writePause(w: Writer, paused: boolean): Uint8Array<ArrayBuffer> {
	return w
		.reset()
		.u8(ClientMessage.pause)
		.u8(paused ? 1 : 0)
		.finish()
}

export function writePong(w: Writer, time: number): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ClientMessage.pong).f64(time).finish()
}

export function readClientMessage(r: Reader): ClientToServer {
	const type = r.u8()
	switch (type) {
		case ClientMessage.hello:
			return { type: 'hello', version: r.u16(), ticket: r.string(4096) }
		case ClientMessage.input: {
			const ackSnapshot = r.u32()
			const count = r.u8()
			if (count > 16) throw new ProtocolError('too many inputs')
			const inputs: PlayerInput[] = []
			for (let i = 0; i < count; i++) {
				inputs.push({
					seq: r.u32(),
					moveX: r.i8(),
					moveY: r.i8(),
					aim: r.u16(),
					buttons: r.u16(),
					viewTick: r.u32(),
					reach: r.u8()
				})
			}
			return { type: 'input', ackSnapshot, inputs }
		}
		case ClientMessage.pong:
			return { type: 'pong', time: r.f64() }
		case ClientMessage.range: {
			const action = r.u8()
			const zombieType = r.u8()
			const count = r.u8()
			if (count > 20) throw new ProtocolError('too many zombies')
			return { type: 'range', action, zombieType, count }
		}
		case ClientMessage.pause:
			return { type: 'pause', paused: r.u8() === 1 }
		default:
			throw new ProtocolError(`unknown client message ${type}`)
	}
}

// --- server → client ---------------------------------------------------------------------------

/**
 * `build` is the player's own build, so client prediction uses exactly the server's numbers;
 * `missionId` and `difficulty` are empty outside missions (the firing range, wave rooms).
 */
export type WelcomeMessage = {
	type: 'welcome'
	version: number
	you: number
	mapId: string
	tick: number
	build: Build
	missionId: string
	difficulty: string
	/** a fingerprint of the game data: a client built from other data must reload */
	dataVersion: number
}

export function writeWelcome(
	w: Writer,
	you: number,
	mapId: string,
	tick: number,
	build: Build,
	missionId = '',
	difficulty = ''
): Uint8Array<ArrayBuffer> {
	return w
		.reset()
		.u8(ServerMessage.welcome)
		.u16(PROTOCOL_VERSION)
		.u8(you)
		.string(mapId)
		.u32(tick)
		.string(JSON.stringify(build))
		.string(missionId)
		.string(difficulty)
		.u32(dataVersion)
		.finish()
}

/** A player's own results, sent once when the mission is complete or the Survival run is over. */
export type ResultsMessage = {
	type: 'results'
	success: boolean
	/** Survival: rounds survived (0 for missions) */
	rounds: number
	timeMs: number
	score: number
	kills: number
	xp: number
	salvage: number
	downs: number
	/** indices into game-data items */
	items: number[]
	/** 0 none, 1 bronze, 2 silver, 3 gold */
	mastery: number
}

export function writeResults(w: Writer, results: Omit<ResultsMessage, 'type'>): Uint8Array<ArrayBuffer> {
	w.reset()
		.u8(ServerMessage.results)
		.u8(results.success ? 1 : 0)
		.u16(Math.min(0xffff, results.rounds))
		.u32(Math.min(0xffffffff, Math.round(results.timeMs)))
	w.u32(Math.min(0xffffffff, Math.round(results.score)))
		.u32(results.kills)
		.u32(Math.floor(results.xp))
		.u32(Math.floor(results.salvage))
	w.u16(Math.min(0xffff, results.downs)).u8(Math.min(255, results.items.length))
	for (const item of results.items.slice(0, 255)) w.u8(item)
	return w.u8(results.mastery).finish()
}

function readBuild(text: string): Build {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		throw new ProtocolError('welcome build is not JSON')
	}
	const result = buildSchema.safeParse(parsed)
	if (!result.success) throw new ProtocolError('welcome build is invalid')
	return result.data
}

export type RosterEntry = {
	slot: number
	name: string
	connected: boolean
	/** index into the class list, so teammates are drawn as their class */
	classIndex: number
	/** weapon indexes of main 1, main 2 and the pistol (255: none), for the gun in their hands */
	weapons: readonly [number, number, number]
	/** armour indexes worn on head, torso, vest, legs and feet (255: none), for how they look */
	armour: readonly [number, number, number, number, number]
}

/** How a player looks to the others: their class and the weapons in their loadout. */
export function lookOf(build: Build): Pick<RosterEntry, 'classIndex' | 'weapons' | 'armour'> {
	const weapon = (id: string) => {
		const index = weapons.findIndex(entry => entry.id === id)
		return index < 0 ? 255 : index
	}
	const { main, pistol } = build.loadout
	return {
		classIndex: Math.max(
			0,
			classes.classes.findIndex(entry => entry.id === build.class)
		),
		weapons: [weapon(main[0].id), weapon(main[1].id), weapon(pistol.id)],
		armour: ARMOUR_PIECES.map(piece => {
			const ref = build.loadout.armour[piece]
			const index = ref ? gear.armour.findIndex(entry => entry.id === ref.id) : -1
			return index < 0 ? 255 : index
		}) as unknown as RosterEntry['armour']
	}
}

/** Who is in the room, by player slot; sent whenever someone joins, leaves or reconnects. */
export function writeRoster(w: Writer, entries: readonly RosterEntry[]): Uint8Array<ArrayBuffer> {
	w.reset().u8(ServerMessage.roster).u8(entries.length)
	for (const entry of entries) {
		w.u8(entry.slot)
			.u8(entry.connected ? 1 : 0)
			.string(entry.name)
			.u8(entry.classIndex)
			.u8(entry.weapons[0])
			.u8(entry.weapons[1])
			.u8(entry.weapons[2])
		for (const piece of entry.armour) w.u8(piece)
	}
	return w.finish()
}

export function writePing(w: Writer, time: number): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ServerMessage.ping).f64(time).finish()
}

export function writeKick(w: Writer, reason: number): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ServerMessage.kick).u8(reason).finish()
}

/** Everything the client needs to reconcile its own player exactly. */
/** Everything client prediction needs about its own player (server-only fields stay out). */
export type SelfState = Omit<
	PlayerState,
	| 'id'
	| 'lastSeq'
	| 'stats'
	| 'guardUntil'
	| 'immuneUntil'
	| 'lastRitesUsed'
	| 'defibUsed'
	| 'chain'
	| 'lastKillTick'
	| 'score'
	| 'thresholds'
	| 'foundItems'
	| 'itemsReported'
	| 'openedCaches'
	| 'finalItem'
	| 'pendingScore'
	| 'doubledScore'
	| 'lastActiveTick'
	| 'interactTicks'
	| 'interactPresses'
	| 'away'
>

/** Where the mission stands, and this player's own score and kill chain. */
export type MissionFrame = {
	/** MissionStatus: 0 when the room runs no mission */
	status: number
	objective: number
	progress: number
	goal: number
	doubleXpSeconds: number
	instakillSeconds: number
	score: number
	chain: number
	/** 0..1 of the chain timer left */
	chainLeft: number
	/** bit n: this player has opened cache n */
	caches: number
	/** whole seconds left on a timed mission's clock; null without a time limit */
	timeLeft: number | null
}

export type OtherPlayer = {
	id: number
	x: number
	y: number
	aim: number
	healthPercent: number
	alive: boolean
	downed: boolean
	slot: number
	/** seconds until a downed player bleeds out */
	bleedoutSeconds: number
	/** 0..1 */
	revive: number
}

export type PoolState = { x: number; y: number; radius: number }

/** A zone, barricade, mine, decoy, sentry or mortar marker, as clients see it. */
export type ObjectState = {
	id: number
	kind: number
	x: number
	y: number
	radius: number
	angle: number
	/** 0..1 for barricades */
	health: number
	secondsLeft: number
	/** buffs on the ground: the buff's index in game-data buffs */
	variant: number
	/** barricades: the grid cells they wall off */
	cells: number[]
}

/** Zombie status bits, for drawing (stunned zombies sparkle, marked ones glow red, ...). */
export const ZombieStatus = { stunned: 1, slowed: 2, marked: 4, poisoned: 8, taunted: 16 } as const

/** The decoded non-zombie part of a snapshot; zombies are applied straight into a ZombieTable. */
export type SnapshotFrame = {
	id: number
	tick: number
	lastSeq: number
	wave: number
	kills: number
	score: number
	/** round trip measured by the server, in milliseconds */
	rttMs: number
	self: SelfState
	mission: MissionFrame
	others: OtherPlayer[]
	pools: PoolState[]
	objects: ObjectState[]
	/** map props that changed since the last snapshot (all of them in the first) */
	props: PropUpdate[]
}

/** A map prop's state as clients see it: what it is doing, its health and hold progress, where it is. */
export type PropUpdate = {
	index: number
	state: number
	/** 0..1 of its maximum */
	health: number
	/** 0..1 of a hold interaction */
	progress: number
	powered: boolean
	/** a trap still cooling down */
	cooling: boolean
	/** survivors and carried objects move; the rest stay where the map put them */
	x: number
	y: number
}

/** Client-side copy of every zombie the server has told this client about. */
export class ZombieTable {
	readonly known = new Uint8Array(MAX_ZOMBIES)
	readonly type = new Uint8Array(MAX_ZOMBIES)
	readonly x = new Float32Array(MAX_ZOMBIES)
	readonly y = new Float32Array(MAX_ZOMBIES)
	/** 0..255 */
	readonly facing = new Uint8Array(MAX_ZOMBIES)
	/** 0..255 of max health */
	readonly health = new Uint8Array(MAX_ZOMBIES)
	readonly state = new Uint8Array(MAX_ZOMBIES)
	/** ZombieStatus bits */
	readonly status = new Uint8Array(MAX_ZOMBIES)
}

const Flag = {
	position: 1,
	facing: 2,
	health: 4,
	fresh: 8,
	absolute: 16,
	state: 32,
	status: 64,
	removed: 0x80
} as const

const TAU = Math.PI * 2

/**
 * Builds snapshots for one connection. It remembers what it last sent for every zombie, so each
 * snapshot only carries what changed. This assumes every snapshot arrives (true on WebSocket);
 * an unreliable transport will need deltas against acknowledged snapshots instead.
 */
export class SnapshotEncoder {
	private readonly sentKnown = new Uint8Array(MAX_ZOMBIES)
	private readonly sentStatus = new Uint8Array(MAX_ZOMBIES)
	private readonly sentX = new Uint16Array(MAX_ZOMBIES)
	private readonly sentY = new Uint16Array(MAX_ZOMBIES)
	private readonly sentFacing = new Uint8Array(MAX_ZOMBIES)
	private readonly sentHealth = new Uint8Array(MAX_ZOMBIES)
	private readonly sentState = new Uint8Array(MAX_ZOMBIES)
	private readonly sentType = new Uint8Array(MAX_ZOMBIES)
	// what each map prop looked like in the last snapshot (255 state: never sent)
	private sentPropState = new Uint8Array(0)
	private sentPropHealth = new Uint8Array(0)
	private sentPropProgress = new Uint8Array(0)
	private sentPropX = new Uint16Array(0)
	private sentPropY = new Uint16Array(0)
	private nextId = 1

	readonly playerId: number

	constructor(playerId: number) {
		this.playerId = playerId
	}

	/** `rttMs` is the server's latest round-trip measurement for this connection, shown in the HUD. */
	write(w: Writer, world: World, rttMs = 0): Uint8Array<ArrayBuffer> {
		const self = world.players.get(this.playerId)
		w.reset()
			.u8(ServerMessage.snapshot)
			.u32(this.nextId++)
			.u32(world.tick - 1)
		w.u32(self?.lastSeq ?? 0)
			.u16(world.wave)
			.u32(world.kills)
			.u32(world.score)
			.u16(Math.min(0xffff, Math.round(rttMs)))

		// own player, at full precision for reconciliation
		{
			const s = self ?? EMPTY_SELF
			w.f64(s.x).f64(s.y).u16(s.aim).f32(s.health)
			w.u8(
				(s.alive ? 1 : 0) |
					(s.reloadEndTick !== 0 ? 2 : 0) |
					(s.downed ? 4 : 0) |
					(s.free ? 8 : 0) |
					(s.carrying ? 16 : 0)
			)
			w.u32(s.bleedoutTick).u8(s.downs).u16(Math.round(s.reviveProgress))
			w.u8(s.slot).u8(s.previousSlot).u32(s.respawnTick).u32(s.safeUntilTick)
			w.u32(s.reloadEndTick).f64(s.nextFireTick).u16(s.heldButtons)
			for (const weapon of s.weapons) w.u8(weapon.def).u16(weapon.mag).i16(weapon.reserve)
			for (const ready of s.abilityReady) w.u32(ready)
			w.u8(s.utilityCharges[0]).u8(s.utilityCharges[1]).u32(s.utilityReady)
			w.u16(s.hasteSteps).f64(s.hasteSpeed).f64(s.hasteFire)
			w.u16(s.dashSteps).f64(s.dashX).f64(s.dashY)
			w.u16(s.overwatchShots).u16(s.minigunSteps)
		}

		// the mission, and this player's score and chain
		{
			const mission = world.mission
			w.u8(mission?.status ?? MissionStatus.none)
			w.u8(mission?.index ?? 0)
				.u32(mission?.progress ?? 0)
				.u32(mission ? objectiveGoal(currentObjective(mission)) : 0)
			w.u8(secondsUntil(world, world.doubleXpUntil)).u8(secondsUntil(world, world.instakillUntil))
			// a chain whose timer ran out is gone, even before the server notices on the next kill
			const chainLeft = self && self.chain > 0 ? Math.max(0, CHAIN_TICKS - (world.tick - self.lastKillTick)) : 0
			w.u32(Math.min(0xffffffff, Math.floor(self?.score ?? 0)))
				.u16(chainLeft > 0 ? Math.min(0xffff, self?.chain ?? 0) : 0)
				.u8(Math.round((chainLeft / CHAIN_TICKS) * 255))
			let caches = 0
			if (self) for (const index of self.openedCaches) if (index < 16) caches |= 1 << index
			w.u16(caches)
			const left = mission ? timeLeft(world, mission) : null
			w.u16(left === null ? NO_LIMIT : Math.min(NO_LIMIT - 1, left))
		}

		// everyone else, quantised
		w.u8(Math.max(0, world.players.size - (self ? 1 : 0)))
		for (const other of world.players.values()) {
			if (other.id === this.playerId) continue
			w.u8(other.id).u16(q(other.x)).u16(q(other.y)).u16(other.aim)
			w.u8(Math.max(0, Math.min(255, Math.round((other.health / other.stats.maxHealth) * 255))))
			w.u8((other.alive ? 1 : 0) | (other.downed ? 2 : 0) | (other.slot << 2))
			w.u8(other.downed ? Math.max(0, Math.min(255, Math.ceil((other.bleedoutTick - world.tick) / TICK_RATE))) : 0)
			w.u8(Math.min(255, Math.round((other.reviveProgress / REVIVE_COMPLETE) * 255)))
		}

		// pools
		const poolCount = Math.min(255, world.pools.length)
		w.u8(poolCount)
		for (let n = 0; n < poolCount; n++) {
			const pool = world.pools[n] as Pool
			w.u16(q(pool.x))
				.u16(q(pool.y))
				.u8(Math.round(pool.radius * 10))
		}

		// map props: only what changed since the last snapshot
		this.writeProps(w, world)

		// zones, barricades, mines, decoys, sentries, markers: few, all sent every time
		const objectCount = Math.min(255, world.objects.length)
		w.u8(objectCount)
		for (let o = 0; o < objectCount; o++) {
			const object = world.objects[o] as WorldObject
			w.u32(object.id).u8(object.kind).u16(q(object.x)).u16(q(object.y))
			w.u8(Math.min(255, Math.round(object.radius * 10)))
			w.u16(Math.round(((((object.angle % TAU) + TAU) % TAU) / TAU) * 65536) & 0xffff)
			w.u8(
				object.maxHealth > 0 ? Math.max(0, Math.min(255, Math.round((object.health / object.maxHealth) * 255))) : 255
			)
			w.u8(Math.max(0, Math.min(255, Math.ceil((object.untilTick - world.tick) / TICK_RATE))))
			w.u8(object.kind === ObjectKind.buff ? object.amount : 0)
			// barricades carry their exact cells: the client's grid must match the server's
			const cells = Math.min(255, object.cells.length)
			w.u8(cells)
			for (let c = 0; c < cells; c++) w.u16(object.cells[c] as number)
		}

		// zombies: deltas within the interest radius
		const cx = self?.x ?? 0
		const cy = self?.y ?? 0
		const countAt = w.offset
		w.u16(0)
		let count = 0
		let lastId = 0
		const radius2 = INTEREST_RADIUS * INTEREST_RADIUS
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			const alive = world.alive[i] === 1
			const zx = world.x[i] as number
			const zy = world.y[i] as number
			const visible = alive && (zx - cx) * (zx - cx) + (zy - cy) * (zy - cy) < radius2
			// a slot reused by a new zombie of another type counts as removed then fresh
			const replaced = visible && this.sentKnown[i] === 1 && this.sentType[i] !== world.type[i]
			if (!visible || replaced) {
				if (this.sentKnown[i] === 1) {
					w.varint(i - lastId).u8(Flag.removed)
					lastId = i
					count++
					this.sentKnown[i] = 0
				}
				if (!visible) continue
			}
			const px = q(zx)
			const py = q(zy)
			const facing = Math.round(((((world.facing(i) % TAU) + TAU) % TAU) / TAU) * 256) & 0xff
			const max = world.maxHealth[i] as number
			const health = Math.max(1, Math.min(255, Math.round(((world.health[i] as number) / max) * 255)))
			const state = world.state[i] as number
			const status = zombieStatus(world, i)
			const fresh = this.sentKnown[i] === 0
			let flags = 0
			if (fresh || px !== this.sentX[i] || py !== this.sentY[i]) flags |= Flag.position
			if (fresh || facing !== this.sentFacing[i]) flags |= Flag.facing
			if (fresh || health !== this.sentHealth[i]) flags |= Flag.health
			if (fresh || state !== this.sentState[i]) flags |= Flag.state
			if (status !== this.sentStatus[i] || (fresh && status !== 0)) flags |= Flag.status
			if (fresh) flags |= Flag.fresh
			if (flags === 0) continue
			w.varint(i - lastId)
			lastId = i
			count++
			const flagsAt = w.offset
			w.u8(flags)
			if (flags & Flag.fresh) w.u8(world.type[i] as number)
			if (flags & Flag.position) {
				const dx = px - (this.sentX[i] as number)
				const dy = py - (this.sentY[i] as number)
				if (!fresh && dx >= -127 && dx <= 127 && dy >= -127 && dy <= 127) {
					w.i8(dx).i8(dy)
				} else {
					w.patchU8(flagsAt, flags | Flag.absolute)
					w.u16(px).u16(py)
				}
			}
			if (flags & Flag.facing) w.u8(facing)
			if (flags & Flag.health) w.u8(health)
			if (flags & Flag.state) w.u8(state)
			if (flags & Flag.status) w.u8(status)
			this.sentKnown[i] = 1
			this.sentStatus[i] = status
			this.sentType[i] = world.type[i] as number
			this.sentX[i] = px
			this.sentY[i] = py
			this.sentFacing[i] = facing
			this.sentHealth[i] = health
			this.sentState[i] = state
		}
		const end = w.offset
		w.offset = countAt
		w.u16(count)
		w.offset = end
		return w.finish()
	}

	/** Map props whose state, health, progress or position changed since the last snapshot. */
	private writeProps(w: Writer, world: World): void {
		const props = world.props
		if (this.sentPropState.length !== props.length) {
			this.sentPropState = new Uint8Array(props.length).fill(255)
			this.sentPropHealth = new Uint8Array(props.length)
			this.sentPropProgress = new Uint8Array(props.length)
			this.sentPropX = new Uint16Array(props.length)
			this.sentPropY = new Uint16Array(props.length)
		}
		const countAt = w.offset
		w.u16(0)
		let count = 0
		for (const prop of props) {
			const i = prop.index
			const health =
				prop.maxHealth > 0 ? Math.max(0, Math.min(255, Math.round((prop.health / prop.maxHealth) * 255))) : 255
			const progress = Math.round(prop.progress * 255)
			// state, plus powered (turrets and lights) and cooling down (traps) as flag bits
			const cooling = prop.def.kind === 'trap' && world.tick < prop.readyTick
			const state = prop.state | (prop.powered ? 0x80 : 0) | (cooling ? 0x40 : 0)
			const px = q(prop.x)
			const py = q(prop.y)
			if (
				state === this.sentPropState[i] &&
				health === this.sentPropHealth[i] &&
				progress === this.sentPropProgress[i] &&
				px === this.sentPropX[i] &&
				py === this.sentPropY[i]
			)
				continue
			w.u16(i).u8(state).u8(health).u8(progress).u16(px).u16(py)
			this.sentPropState[i] = state
			this.sentPropHealth[i] = health
			this.sentPropProgress[i] = progress
			this.sentPropX[i] = px
			this.sentPropY[i] = py
			count++
		}
		const end = w.offset
		w.offset = countAt
		w.u16(count)
		w.offset = end
	}
}

/** Reads a snapshot (after its type byte), applying zombie changes to `table`. */
export function readSnapshot(r: Reader, table: ZombieTable): SnapshotFrame {
	const id = r.u32()
	const tick = r.u32()
	const lastSeq = r.u32()
	const wave = r.u16()
	const kills = r.u32()
	const score = r.u32()
	const rttMs = r.u16()
	let self: SelfState
	{
		const x = r.f64()
		const y = r.f64()
		const aim = r.u16()
		const health = r.f32()
		const flags = r.u8()
		const bleedoutTick = r.u32()
		const downs = r.u8()
		const reviveProgress = r.u16()
		const slot = r.u8()
		const previousSlot = r.u8()
		const respawnTick = r.u32()
		const safeUntilTick = r.u32()
		const reloadEndTick = r.u32()
		const nextFireTick = r.f64()
		const heldButtons = r.u16()
		const weapons = [0, 1, 2].map(() => ({ def: r.u8(), mag: r.u16(), reserve: r.i16() })) as SelfState['weapons']
		const abilityReady: SelfState['abilityReady'] = [r.u32(), r.u32(), r.u32()]
		const utilityCharges: SelfState['utilityCharges'] = [r.u8(), r.u8()]
		const utilityReady = r.u32()
		const hasteSteps = r.u16()
		const hasteSpeed = r.f64()
		const hasteFire = r.f64()
		const dashSteps = r.u16()
		const dashX = r.f64()
		const dashY = r.f64()
		const overwatchShots = r.u16()
		const minigunSteps = r.u16()
		self = {
			x,
			y,
			aim,
			health,
			alive: (flags & 1) !== 0,
			downed: (flags & 4) !== 0,
			bleedoutTick,
			downs,
			reviveProgress,
			slot,
			previousSlot,
			respawnTick,
			safeUntilTick,
			reloadEndTick,
			nextFireTick,
			heldButtons,
			weapons,
			abilityReady,
			utilityCharges,
			utilityReady,
			hasteSteps,
			hasteSpeed,
			hasteFire,
			dashSteps,
			dashX,
			dashY,
			overwatchShots,
			minigunSteps,
			free: (flags & 8) !== 0,
			carrying: (flags & 16) !== 0
		}
	}
	const mission: MissionFrame = {
		status: r.u8(),
		objective: r.u8(),
		progress: r.u32(),
		goal: r.u32(),
		doubleXpSeconds: r.u8(),
		instakillSeconds: r.u8(),
		score: r.u32(),
		chain: r.u16(),
		chainLeft: r.u8() / 255,
		caches: r.u16(),
		timeLeft: nullableSeconds(r.u16())
	}
	const others: OtherPlayer[] = []
	const otherCount = r.u8()
	for (let i = 0; i < otherCount; i++) {
		const otherId = r.u8()
		const x = dq(r.u16())
		const y = dq(r.u16())
		const aim = r.u16()
		const healthPercent = r.u8() / 255
		const flags = r.u8()
		const bleedoutSeconds = r.u8()
		const revive = r.u8() / 255
		others.push({
			id: otherId,
			x,
			y,
			aim,
			healthPercent,
			alive: (flags & 1) !== 0,
			downed: (flags & 2) !== 0,
			slot: flags >> 2,
			bleedoutSeconds,
			revive
		})
	}
	const pools: PoolState[] = []
	const poolCount = r.u8()
	for (let i = 0; i < poolCount; i++) pools.push({ x: dq(r.u16()), y: dq(r.u16()), radius: r.u8() / 10 })
	const props: PropUpdate[] = []
	const propCount = r.u16()
	if (propCount > 4096) throw new ProtocolError('too many props')
	for (let i = 0; i < propCount; i++) {
		const index = r.u16()
		const state = r.u8()
		props.push({
			index,
			state: state & 0x3f,
			powered: (state & 0x80) !== 0,
			cooling: (state & 0x40) !== 0,
			health: r.u8() / 255,
			progress: r.u8() / 255,
			x: dq(r.u16()),
			y: dq(r.u16())
		})
	}
	const objects: ObjectState[] = []
	const objectCount = r.u8()
	for (let i = 0; i < objectCount; i++) {
		const object: ObjectState = {
			id: r.u32(),
			kind: r.u8(),
			x: dq(r.u16()),
			y: dq(r.u16()),
			radius: r.u8() / 10,
			angle: (r.u16() / 65536) * TAU,
			health: r.u8() / 255,
			secondsLeft: r.u8(),
			variant: r.u8(),
			cells: []
		}
		const cellCount = r.u8()
		for (let c = 0; c < cellCount; c++) object.cells.push(r.u16())
		objects.push(object)
	}

	const count = r.u16()
	let index = 0
	for (let n = 0; n < count; n++) {
		index += r.varint()
		if (index >= MAX_ZOMBIES) throw new ProtocolError('zombie index out of range')
		const flags = r.u8()
		if (flags & Flag.removed) {
			table.known[index] = 0
			continue
		}
		if (flags & Flag.fresh) {
			table.known[index] = 1
			table.type[index] = r.u8()
		}
		if (flags & Flag.position) {
			if (flags & Flag.absolute) {
				table.x[index] = dq(r.u16())
				table.y[index] = dq(r.u16())
			} else {
				table.x[index] = (table.x[index] as number) + dq(r.i8())
				table.y[index] = (table.y[index] as number) + dq(r.i8())
			}
		}
		if (flags & Flag.facing) table.facing[index] = r.u8()
		if (flags & Flag.health) table.health[index] = r.u8()
		if (flags & Flag.state) table.state[index] = r.u8()
		if (flags & Flag.status) table.status[index] = r.u8()
		else if (flags & Flag.fresh) table.status[index] = 0
	}
	return { id, tick, lastSeq, wave, kills, score, rttMs, self, mission, others, pools, objects, props }
}

const EMPTY_SELF: SelfState = {
	x: 0,
	y: 0,
	aim: 0,
	health: 0,
	alive: false,
	downed: false,
	bleedoutTick: 0,
	downs: 0,
	reviveProgress: 0,
	respawnTick: 0,
	safeUntilTick: 0,
	slot: 0,
	previousSlot: 1,
	weapons: [
		{ def: 0, mag: 0, reserve: 0 },
		{ def: 0, mag: 0, reserve: 0 },
		{ def: 0, mag: 0, reserve: 0 }
	],
	reloadEndTick: 0,
	nextFireTick: 0,
	heldButtons: 0,
	abilityReady: [0, 0, 0],
	utilityCharges: [0, 0],
	utilityReady: 0,
	hasteSteps: 0,
	hasteSpeed: 0,
	hasteFire: 0,
	dashSteps: 0,
	dashX: 0,
	dashY: 0,
	overwatchShots: 0,
	minigunSteps: 0,
	free: false,
	carrying: false
}

const secondsUntil = (world: World, until: number) =>
	Math.max(0, Math.min(255, Math.ceil((until - world.tick) / TICK_RATE)))

function zombieStatus(world: World, i: number): number {
	const tick = world.tick
	return (
		((world.stunUntil[i] as number) > tick ? ZombieStatus.stunned : 0) |
		((world.slowUntil[i] as number) > tick ? ZombieStatus.slowed : 0) |
		((world.markUntil[i] as number) > tick ? ZombieStatus.marked : 0) |
		((world.poisonUntil[i] as number) > tick ? ZombieStatus.poisoned : 0) |
		((world.tauntUntil[i] as number) > tick ? ZombieStatus.taunted : 0)
	)
}

// --- events ------------------------------------------------------------------------------------

const EventType = {
	shot: 1,
	hit: 2,
	kill: 3,
	burst: 4,
	'player-hurt': 5,
	'player-down': 6,
	'player-up': 7,
	wave: 8,
	'player-out': 9,
	'player-revived': 10,
	wipe: 11,
	launch: 12,
	explode: 13,
	ability: 14,
	cleared: 15,
	objective: 16,
	checkpoint: 17,
	'mission-complete': 18,
	'mission-failed': 27,
	'item-found': 19,
	cache: 20,
	buff: 21,
	threshold: 22,
	'run-over': 23,
	prop: 24,
	failed: 25,
	scream: 26
} as const

export function writeEvents(w: Writer, events: readonly SimEvent[]): Uint8Array<ArrayBuffer> {
	w.reset().u8(ServerMessage.events).u16(events.length)
	for (const event of events) {
		w.u8(EventType[event.type])
		switch (event.type) {
			case 'shot':
				w.u8(event.player).u16(q(event.x)).u16(q(event.y))
				w.u16(Math.round(((((event.angle % TAU) + TAU) % TAU) / TAU) * 65536) & 0xffff)
				w.u16(q(event.length)).u8(event.weapon)
				break
			case 'hit':
				w.u16(event.zombie).u16(q(event.x)).u16(q(event.y))
				w.u16(Math.min(0xffff, Math.round(event.amount * 10))).u8(event.by)
				break
			case 'ability':
				w.u8(event.player).u8(event.ability).u16(q(event.x)).u16(q(event.y))
				w.u16(Math.round(((((event.angle % TAU) + TAU) % TAU) / TAU) * 65536) & 0xffff)
				break
			case 'kill':
				w.u16(event.zombie).u8(event.zombieType).u16(q(event.x)).u16(q(event.y)).u8(event.by)
				break
			case 'scream':
				w.u16(q(event.x)).u16(q(event.y))
				break
			case 'burst':
				w.u16(q(event.x))
					.u16(q(event.y))
					.u8(Math.round(event.radius * 10))
				break
			case 'launch':
				w.u16(event.id & 0xffff)
					.u8(event.player)
					.u16(q(event.x))
					.u16(q(event.y))
				w.u16(Math.round(((((event.angle % TAU) + TAU) % TAU) / TAU) * 65536) & 0xffff)
				w.u8(Math.min(255, Math.round(event.speed))).u8(event.weapon)
				break
			case 'explode':
				w.u16(event.id & 0xffff)
					.u16(q(event.x))
					.u16(q(event.y))
					.u8(Math.min(255, Math.round(event.radius * 10)))
				break
			case 'player-hurt':
				w.u8(event.player).u16(Math.round(event.amount * 10))
				break
			case 'player-down':
			case 'player-up':
			case 'player-out':
				w.u8(event.player)
				break
			case 'player-revived':
				w.u8(event.player).u8(event.by)
				break
			case 'wave':
			case 'wipe':
			case 'cleared':
				w.u16(event.wave)
				break
			case 'objective':
				w.u8(event.index).u8(event.first ? 1 : 0)
				break
			case 'checkpoint':
				w.u8(event.index)
				break
			case 'run-over':
				w.u16(event.wave)
				break
			case 'prop':
				w.u16(event.index).u8(event.state)
				break
			case 'failed':
				w.i16(event.index)
				break
			case 'mission-complete':
			case 'mission-failed':
				break
			case 'item-found':
				w.u8(event.player).u8(event.item)
				break
			case 'cache':
			case 'threshold':
				w.u8(event.player).u8(event.index)
				break
			case 'buff':
				w.u8(event.player).u8(event.buff)
				break
		}
	}
	return w.finish()
}

export function readEvents(r: Reader): SimEvent[] {
	const count = r.u16()
	const events: SimEvent[] = []
	for (let i = 0; i < count; i++) {
		const type = r.u8()
		switch (type) {
			case EventType.shot:
				events.push({
					type: 'shot',
					player: r.u8(),
					x: dq(r.u16()),
					y: dq(r.u16()),
					angle: (r.u16() / 65536) * TAU,
					length: dq(r.u16()),
					weapon: r.u8()
				})
				break
			case EventType.hit:
				events.push({ type: 'hit', zombie: r.u16(), x: dq(r.u16()), y: dq(r.u16()), amount: r.u16() / 10, by: r.u8() })
				break
			case EventType.ability:
				events.push({
					type: 'ability',
					player: r.u8(),
					ability: r.u8(),
					x: dq(r.u16()),
					y: dq(r.u16()),
					angle: (r.u16() / 65536) * TAU
				})
				break
			case EventType.kill:
				events.push({ type: 'kill', zombie: r.u16(), zombieType: r.u8(), x: dq(r.u16()), y: dq(r.u16()), by: r.u8() })
				break
			case EventType.scream:
				events.push({ type: 'scream', x: dq(r.u16()), y: dq(r.u16()) })
				break
			case EventType.burst:
				events.push({ type: 'burst', x: dq(r.u16()), y: dq(r.u16()), radius: r.u8() / 10 })
				break
			case EventType.launch:
				events.push({
					type: 'launch',
					id: r.u16(),
					player: r.u8(),
					x: dq(r.u16()),
					y: dq(r.u16()),
					angle: (r.u16() / 65536) * TAU,
					speed: r.u8(),
					weapon: r.u8()
				})
				break
			case EventType.explode:
				events.push({ type: 'explode', id: r.u16(), x: dq(r.u16()), y: dq(r.u16()), radius: r.u8() / 10 })
				break
			case EventType['player-hurt']:
				events.push({ type: 'player-hurt', player: r.u8(), amount: r.u16() / 10 })
				break
			case EventType['player-down']:
				events.push({ type: 'player-down', player: r.u8() })
				break
			case EventType['player-up']:
				events.push({ type: 'player-up', player: r.u8() })
				break
			case EventType.wave:
				events.push({ type: 'wave', wave: r.u16() })
				break
			case EventType['player-out']:
				events.push({ type: 'player-out', player: r.u8() })
				break
			case EventType['player-revived']:
				events.push({ type: 'player-revived', player: r.u8(), by: r.u8() })
				break
			case EventType.wipe:
				events.push({ type: 'wipe', wave: r.u16() })
				break
			case EventType.cleared:
				events.push({ type: 'cleared', wave: r.u16() })
				break
			case EventType.objective:
				events.push({ type: 'objective', index: r.u8(), first: r.u8() === 1 })
				break
			case EventType['run-over']:
				events.push({ type: 'run-over', wave: r.u16() })
				break
			case EventType.prop:
				events.push({ type: 'prop', index: r.u16(), state: r.u8() })
				break
			case EventType.failed:
				events.push({ type: 'failed', index: r.i16() })
				break
			case EventType.checkpoint:
				events.push({ type: 'checkpoint', index: r.u8() })
				break
			case EventType['mission-complete']:
				events.push({ type: 'mission-complete' })
				break
			case EventType['mission-failed']:
				events.push({ type: 'mission-failed' })
				break
			case EventType['item-found']:
				events.push({ type: 'item-found', player: r.u8(), item: r.u8() })
				break
			case EventType.cache:
				events.push({ type: 'cache', player: r.u8(), index: r.u8() })
				break
			case EventType.buff:
				events.push({ type: 'buff', player: r.u8(), buff: r.u8() })
				break
			case EventType.threshold:
				events.push({ type: 'threshold', player: r.u8(), index: r.u8() })
				break
			default:
				throw new ProtocolError(`unknown event ${type}`)
		}
	}
	return events
}

export type ServerToClient =
	| WelcomeMessage
	| { type: 'snapshot' }
	| { type: 'events'; events: SimEvent[] }
	| { type: 'ping'; time: number }
	| { type: 'kick'; reason: number }
	| { type: 'roster'; entries: RosterEntry[] }
	| ResultsMessage

/** Reads the type byte and simple messages; snapshots are read with readSnapshot by the caller. */
export function readServerHeader(r: Reader): ServerToClient {
	const type = r.u8()
	switch (type) {
		case ServerMessage.welcome:
			return {
				type: 'welcome',
				version: r.u16(),
				you: r.u8(),
				mapId: r.string(64),
				tick: r.u32(),
				build: readBuild(r.string(4096)),
				missionId: r.string(64),
				difficulty: r.string(32),
				dataVersion: r.u32()
			}
		case ServerMessage.snapshot:
			return { type: 'snapshot' }
		case ServerMessage.events:
			return { type: 'events', events: readEvents(r) }
		case ServerMessage.ping:
			return { type: 'ping', time: r.f64() }
		case ServerMessage.kick:
			return { type: 'kick', reason: r.u8() }
		case ServerMessage.roster: {
			const count = r.u8()
			if (count > 8) throw new ProtocolError('roster too long')
			const entries: RosterEntry[] = []
			for (let i = 0; i < count; i++)
				entries.push({
					slot: r.u8(),
					connected: r.u8() === 1,
					name: r.string(64),
					classIndex: r.u8(),
					weapons: [r.u8(), r.u8(), r.u8()],
					armour: [r.u8(), r.u8(), r.u8(), r.u8(), r.u8()]
				})
			return { type: 'roster', entries }
		}
		case ServerMessage.results: {
			const success = r.u8() === 1
			const rounds = r.u16()
			const timeMs = r.u32()
			const score = r.u32()
			const kills = r.u32()
			const xp = r.u32()
			const salvage = r.u32()
			const downs = r.u16()
			const count = r.u8()
			const items: number[] = []
			for (let i = 0; i < count; i++) items.push(r.u8())
			return { type: 'results', success, rounds, timeMs, score, kills, xp, salvage, downs, items, mastery: r.u8() }
		}
		default:
			throw new ProtocolError(`unknown server message ${type}`)
	}
}
