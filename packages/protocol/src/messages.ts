import { zombies as zombieDefs } from '@rotline/game-data'
import { MAX_ZOMBIES, type PlayerInput, type PlayerState, type SimEvent, type World } from '@rotline/sim'
import { ProtocolError, type Reader, type Writer } from './buffer.ts'

export const PROTOCOL_VERSION = 1

export const ClientMessage = { hello: 1, input: 2, pong: 3 } as const
export const ServerMessage = { welcome: 10, snapshot: 11, events: 12, ping: 13, kick: 14 } as const

export const KickReason = { badTicket: 1, roomFull: 2, protocol: 3, replaced: 4, shutdown: 5, idle: 6 } as const

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
export type ClientToServer = HelloMessage | InputMessage | PongMessage

export function writeHello(w: Writer, ticket: string): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ClientMessage.hello).u16(PROTOCOL_VERSION).string(ticket).finish()
}

/** Inputs oldest first; the server ignores ones it has already applied. */
export function writeInput(w: Writer, ackSnapshot: number, inputs: readonly PlayerInput[]): Uint8Array<ArrayBuffer> {
	w.reset().u8(ClientMessage.input).u32(ackSnapshot).u8(inputs.length)
	for (const input of inputs) {
		w.u32(input.seq).i8(input.moveX).i8(input.moveY).u16(input.aim).u8(input.buttons).u32(input.viewTick)
	}
	return w.finish()
}

export function writePong(w: Writer, time: number): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ClientMessage.pong).f64(time).finish()
}

export function readClientMessage(r: Reader): ClientToServer {
	const type = r.u8()
	switch (type) {
		case ClientMessage.hello:
			return { type: 'hello', version: r.u16(), ticket: r.string(2048) }
		case ClientMessage.input: {
			const ackSnapshot = r.u32()
			const count = r.u8()
			if (count > 16) throw new ProtocolError('too many inputs')
			const inputs: PlayerInput[] = []
			for (let i = 0; i < count; i++) {
				inputs.push({ seq: r.u32(), moveX: r.i8(), moveY: r.i8(), aim: r.u16(), buttons: r.u8(), viewTick: r.u32() })
			}
			return { type: 'input', ackSnapshot, inputs }
		}
		case ClientMessage.pong:
			return { type: 'pong', time: r.f64() }
		default:
			throw new ProtocolError(`unknown client message ${type}`)
	}
}

// --- server → client ---------------------------------------------------------------------------

export type WelcomeMessage = { type: 'welcome'; version: number; you: number; mapId: string; tick: number }

export function writeWelcome(w: Writer, you: number, mapId: string, tick: number): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ServerMessage.welcome).u16(PROTOCOL_VERSION).u8(you).string(mapId).u32(tick).finish()
}

export function writePing(w: Writer, time: number): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ServerMessage.ping).f64(time).finish()
}

export function writeKick(w: Writer, reason: number): Uint8Array<ArrayBuffer> {
	return w.reset().u8(ServerMessage.kick).u8(reason).finish()
}

/** Everything the client needs to reconcile its own player exactly. */
export type SelfState = Omit<PlayerState, 'id' | 'lastSeq'>

export type OtherPlayer = {
	id: number
	x: number
	y: number
	aim: number
	healthPercent: number
	alive: boolean
	slot: number
}

export type PoolState = { x: number; y: number; radius: number }

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
	others: OtherPlayer[]
	pools: PoolState[]
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
}

const Flag = { position: 1, facing: 2, health: 4, fresh: 8, absolute: 16, state: 32, removed: 0x80 } as const

const TAU = Math.PI * 2

/**
 * Builds snapshots for one connection. It remembers what it last sent for every zombie, so each
 * snapshot only carries what changed. This assumes every snapshot arrives (true on WebSocket);
 * an unreliable transport will need deltas against acknowledged snapshots instead.
 */
export class SnapshotEncoder {
	private readonly sentKnown = new Uint8Array(MAX_ZOMBIES)
	private readonly sentX = new Uint16Array(MAX_ZOMBIES)
	private readonly sentY = new Uint16Array(MAX_ZOMBIES)
	private readonly sentFacing = new Uint8Array(MAX_ZOMBIES)
	private readonly sentHealth = new Uint8Array(MAX_ZOMBIES)
	private readonly sentState = new Uint8Array(MAX_ZOMBIES)
	private readonly sentType = new Uint8Array(MAX_ZOMBIES)
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
			w.u8((s.alive ? 1 : 0) | (s.reloadEndTick !== 0 ? 2 : 0))
			w.u8(s.slot).u8(s.previousSlot).u32(s.respawnTick).u32(s.safeUntilTick)
			w.u32(s.reloadEndTick).f64(s.nextFireTick).u8(s.heldButtons)
			for (const weapon of s.weapons) w.u8(weapon.def).u16(weapon.mag).i16(weapon.reserve)
		}

		// everyone else, quantised
		w.u8(Math.max(0, world.players.size - (self ? 1 : 0)))
		for (const other of world.players.values()) {
			if (other.id === this.playerId) continue
			w.u8(other.id).u16(q(other.x)).u16(q(other.y)).u16(other.aim)
			w.u8(Math.round((other.health / 100) * 255))
			w.u8((other.alive ? 1 : 0) | (other.slot << 1))
		}

		// pools
		w.u8(Math.min(255, world.pools.length))
		for (const pool of world.pools.slice(0, 255))
			w.u16(q(pool.x))
				.u16(q(pool.y))
				.u8(Math.round(pool.radius * 10))

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
			const max = (zombieDefs[world.type[i] as number] as { health: number }).health
			const health = Math.max(1, Math.min(255, Math.round(((world.health[i] as number) / max) * 255)))
			const state = world.state[i] as number
			const fresh = this.sentKnown[i] === 0
			let flags = 0
			if (fresh || px !== this.sentX[i] || py !== this.sentY[i]) flags |= Flag.position
			if (fresh || facing !== this.sentFacing[i]) flags |= Flag.facing
			if (fresh || health !== this.sentHealth[i]) flags |= Flag.health
			if (fresh || state !== this.sentState[i]) flags |= Flag.state
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
			this.sentKnown[i] = 1
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
		const slot = r.u8()
		const previousSlot = r.u8()
		const respawnTick = r.u32()
		const safeUntilTick = r.u32()
		const reloadEndTick = r.u32()
		const nextFireTick = r.f64()
		const heldButtons = r.u8()
		const weapons = [0, 1, 2].map(() => ({ def: r.u8(), mag: r.u16(), reserve: r.i16() })) as SelfState['weapons']
		self = {
			x,
			y,
			aim,
			health,
			alive: (flags & 1) !== 0,
			slot,
			previousSlot,
			respawnTick,
			safeUntilTick,
			reloadEndTick,
			nextFireTick,
			heldButtons,
			weapons
		}
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
		others.push({ id: otherId, x, y, aim, healthPercent, alive: (flags & 1) !== 0, slot: flags >> 1 })
	}
	const pools: PoolState[] = []
	const poolCount = r.u8()
	for (let i = 0; i < poolCount; i++) pools.push({ x: dq(r.u16()), y: dq(r.u16()), radius: r.u8() / 10 })

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
	}
	return { id, tick, lastSeq, wave, kills, score, rttMs, self, others, pools }
}

const EMPTY_SELF: SelfState = {
	x: 0,
	y: 0,
	aim: 0,
	health: 0,
	alive: false,
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
	heldButtons: 0
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
	wave: 8
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
				break
			case 'kill':
				w.u16(event.zombie).u8(event.zombieType).u16(q(event.x)).u16(q(event.y)).u8(event.by)
				break
			case 'burst':
				w.u16(q(event.x))
					.u16(q(event.y))
					.u8(Math.round(event.radius * 10))
				break
			case 'player-hurt':
				w.u8(event.player).u16(Math.round(event.amount * 10))
				break
			case 'player-down':
			case 'player-up':
				w.u8(event.player)
				break
			case 'wave':
				w.u16(event.wave)
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
				events.push({ type: 'hit', zombie: r.u16(), x: dq(r.u16()), y: dq(r.u16()) })
				break
			case EventType.kill:
				events.push({ type: 'kill', zombie: r.u16(), zombieType: r.u8(), x: dq(r.u16()), y: dq(r.u16()), by: r.u8() })
				break
			case EventType.burst:
				events.push({ type: 'burst', x: dq(r.u16()), y: dq(r.u16()), radius: r.u8() / 10 })
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

/** Reads the type byte and simple messages; snapshots are read with readSnapshot by the caller. */
export function readServerHeader(r: Reader): ServerToClient {
	const type = r.u8()
	switch (type) {
		case ServerMessage.welcome:
			return { type: 'welcome', version: r.u16(), you: r.u8(), mapId: r.string(64), tick: r.u32() }
		case ServerMessage.snapshot:
			return { type: 'snapshot' }
		case ServerMessage.events:
			return { type: 'events', events: readEvents(r) }
		case ServerMessage.ping:
			return { type: 'ping', time: r.f64() }
		case ServerMessage.kick:
			return { type: 'kick', reason: r.u8() }
		default:
			throw new ProtocolError(`unknown server message ${type}`)
	}
}
