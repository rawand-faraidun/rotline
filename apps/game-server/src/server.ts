import { randomInt } from 'node:crypto'
import { createRequire } from 'node:module'
import { missionById } from '@rotline/game-data'
import {
	KickReason,
	PROTOCOL_VERSION,
	ProtocolError,
	Reader,
	readClientMessage,
	Writer,
	writeKick
} from '@rotline/protocol'
import { DT } from '@rotline/sim'
import {
	announceInstance,
	claimPlayerRoom,
	createValkey,
	dropRoom,
	publishReward,
	releasePlayerRoom,
	touchRoom,
	type Valkey
} from '@rotline/state'
import { loadPrivateKey, loadPublicKey, NonceStore, signMessage, verifyTicket } from '@rotline/ticket'
import type { Logger } from 'pino'
import type { GameEnv } from './env.ts'
import { type Connection, RESULTS_SECONDS, Room } from './room.ts'
import type { TemplatedApp, us_listen_socket, WebSocket } from 'uWebSockets.js'

// uWebSockets.js 20.71's ESM wrapper points at a file the package does not ship, so load the CommonJS build
/** A tick over this (ms) eats into the 33 ms a tick has at 30 a second. */
const SLOW_TICK_MS = 20
const uws = createRequire(import.meta.url)('uWebSockets.js') as typeof import('uWebSockets.js')

/** A client must say hello within this many milliseconds. */
const HELLO_TIMEOUT_MS = 5000
/** Close connections that cannot keep up rather than buffering without limit. */
const MAX_BUFFERED_BYTES = 1 << 20
/** Rooms with nobody left are closed after this long. */
const EMPTY_ROOM_MS = 30_000
/** Messages a socket may send per second (and in a burst); inputs come at 30 a second. */
const MESSAGE_RATE = 120
const MESSAGE_BURST = 60
/** Dropped messages in a row before the socket is closed. */
const MAX_DROPPED = 300
/** A closed room's id is refused this long, so no late ticket can start it again. */
const CLOSED_ROOM_MS = 5 * 60_000
/** At most this many ticks are run back to back to catch up after a stall. */
const MAX_CATCH_UP = 3

type SocketData = {
	/** message rate limit (token bucket) and how many were dropped in a row */
	tokens: number
	tokensAt: number
	dropped: number
	userId: string | null
	roomId: string | null
	helloTimer: ReturnType<typeof setTimeout> | null
	connection: Connection | null
	/** the ticket is being checked (an await on Valkey); messages meanwhile are ignored */
	admitting: boolean
	closed: boolean
}

export type TickStats = { count: number; total: number; max: number; late: number }

export class GameServer {
	readonly rooms = new Map<string, Room>()
	readonly stats: TickStats = { count: 0, total: 0, max: 0, late: 0 }
	private readonly app: TemplatedApp
	private listenSocket: us_listen_socket | null = null
	private readonly nonces = new NonceStore()
	private readonly rewardKey: ReturnType<typeof loadPrivateKey> | null
	private readonly publicKey
	private readonly writer = new Writer(64)
	private timer: ReturnType<typeof setTimeout> | null = null
	private nextTickAt = 0
	/** ids of rooms that have closed, until when they stay refused */
	private readonly closedRooms = new Map<string, number>()
	/** finished rooms already taken out of the registry */
	private readonly dropped = new Set<string>()
	private readonly env: GameEnv
	private readonly valkey: Valkey | null
	private registryTimer: ReturnType<typeof setInterval> | null = null
	private draining = false
	/** called once a draining server has no rooms left */
	onDrained: (() => void) | null = null
	private readonly log: Logger

	constructor(env: GameEnv, log: Logger) {
		this.env = env
		this.log = log
		this.publicKey = loadPublicKey(env.GAME_TICKET_PUBLIC_KEY)
		this.rewardKey = env.GAME_REWARD_PRIVATE_KEY ? loadPrivateKey(env.GAME_REWARD_PRIVATE_KEY) : null
		if (!this.rewardKey) log.warn('GAME_REWARD_PRIVATE_KEY is not set: rewards will not be reported')
		this.valkey = env.VALKEY_URL ? createValkey(env.VALKEY_URL, `rotline-game-${env.GAME_INSTANCE_ID}`) : null
		this.app = uws.App()
		this.app.get('/health', response => {
			response.writeHeader('content-type', 'application/json').end(
				JSON.stringify({
					status: 'ok',
					instance: env.GAME_INSTANCE_ID,
					rooms: this.rooms.size,
					players: this.playerCount()
				})
			)
		})
		this.app.get('/metrics', response => {
			response.writeHeader('content-type', 'text/plain; version=0.0.4').end(this.metrics())
		})
		this.app.ws<SocketData>('/game', {
			compression: uws.DISABLED,
			maxPayloadLength: 8192,
			idleTimeout: 30,
			sendPingsAutomatically: true,
			upgrade: (response, request, context) => {
				response.upgrade<SocketData>(
					{
						tokens: MESSAGE_BURST,
						tokensAt: performance.now(),
						dropped: 0,
						userId: null,
						roomId: null,
						helloTimer: null,
						connection: null,
						admitting: false,
						closed: false
					},
					request.getHeader('sec-websocket-key'),
					request.getHeader('sec-websocket-protocol'),
					request.getHeader('sec-websocket-extensions'),
					context
				)
			},
			open: socket => {
				const data = socket.getUserData()
				data.helloTimer = setTimeout(() => this.kick(socket, KickReason.protocol), HELLO_TIMEOUT_MS)
			},
			message: (socket, message, isBinary) => {
				if (!isBinary) {
					this.kick(socket, KickReason.protocol)
					return
				}
				// every message costs a token: a client flooding the server is cut off, not served
				const data = socket.getUserData()
				const now = performance.now()
				data.tokens = Math.min(MESSAGE_BURST, data.tokens + ((now - data.tokensAt) / 1000) * MESSAGE_RATE)
				data.tokensAt = now
				if (data.tokens < 1) {
					if (++data.dropped > MAX_DROPPED) this.kick(socket, KickReason.protocol)
					return
				}
				data.tokens -= 1
				data.dropped = 0
				try {
					this.onMessage(socket, new Uint8Array(message))
				} catch (error) {
					if (error instanceof ProtocolError || error instanceof TypeError) {
						this.kick(socket, KickReason.protocol)
						return
					}
					throw error
				}
			},
			close: socket => {
				const data = socket.getUserData()
				data.closed = true
				if (data.helloTimer) clearTimeout(data.helloTimer)
				const room = data.roomId ? this.rooms.get(data.roomId) : undefined
				if (data.connection) {
					const closing = data.connection
					// mark closed first: uWS forbids touching a socket after it closes
					closing.close = () => {}
					closing.send = () => false
					if (room && data.userId) room.leave(data.userId, closing, Date.now())
				}
				data.connection = null
			}
		})
	}

	listen(port = this.env.GAME_PORT): Promise<number> {
		return new Promise((resolve, reject) => {
			this.app.listen(port, socket => {
				if (!socket) return reject(new Error(`could not listen on port ${port}`))
				this.listenSocket = socket
				this.nextTickAt = performance.now()
				this.schedule()
				if (this.valkey) {
					void this.announce()
					this.registryTimer = setInterval(() => void this.announce(), 1000)
				}
				resolve(uws.us_socket_local_port(socket))
			})
		})
	}

	/** Takes no new rooms; current missions carry on until they end. */
	drain(): void {
		this.draining = true
		void this.announce()
	}

	/** Tells the registry this instance is alive and which rooms exist (every second). */
	private announced = 0
	/** slowest tick since the last announcement */
	private windowMax = 0
	/** ticks since the last announcement, and how many of them ran over SLOW_TICK_MS */
	private windowTicks = 0
	private windowSlow = 0
	private async announce(): Promise<void> {
		if (!this.valkey) return
		const now = Date.now()
		for (const [id, until] of this.closedRooms) if (until <= now) this.closedRooms.delete(id)
		try {
			for (const room of this.rooms.values()) {
				// a finished room leaves the registry at once, so its squad is back in the lobby
				if (room.completedAt > 0) {
					if (!this.dropped.has(room.id)) {
						this.dropped.add(room.id)
						await dropRoom(this.valkey, room.id)
						// its players are free to start something else right away
						for (const userId of room.userIds()) await releasePlayerRoom(this.valkey, userId, room.id)
					}
					continue
				}
				await touchRoom(this.valkey, room.id, room.playerCount)
				// one squad room per player: whoever has meanwhile joined another room is let go here
				if (room.mode !== 'squad') continue
				for (const userId of room.connectedUsers()) {
					if (!(await claimPlayerRoom(this.valkey, userId, room.id)))
						room.disconnect(userId, KickReason.elsewhere, Date.now())
				}
			}
			if (now - this.announced >= 5000 || this.draining) {
				this.announced = now
				await announceInstance(this.valkey, {
					id: this.env.GAME_INSTANCE_ID,
					rooms: this.rooms.size,
					players: this.playerCount(),
					draining: this.draining,
					tickMaxMs: Number(this.windowMax.toFixed(2)),
					tickSlowShare: this.windowTicks > 0 ? Number((this.windowSlow / this.windowTicks).toFixed(3)) : 0
				})
				this.windowMax = 0
				this.windowTicks = 0
				this.windowSlow = 0
			}
		} catch (error) {
			this.log.warn({ err: error }, 'registry update failed')
		}
	}

	close(): void {
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
		if (this.registryTimer) clearInterval(this.registryTimer)
		this.registryTimer = null
		// report what everyone earned before the connection to Valkey closes
		for (const room of this.rooms.values()) room.reportAll()
		void this.valkey?.quit()
		for (const room of this.rooms.values()) room.closeAll()
		if (this.listenSocket) uws.us_listen_socket_close(this.listenSocket)
		this.listenSocket = null
	}

	playerCount(): number {
		let count = 0
		for (const room of this.rooms.values()) count += room.connectedCount
		return count
	}

	private onMessage(socket: WebSocket<SocketData>, bytes: Uint8Array): void {
		const data = socket.getUserData()
		const message = readClientMessage(new Reader(bytes))
		if (data.admitting) return
		if (!data.userId) {
			if (message.type !== 'hello') {
				this.kick(socket, KickReason.protocol)
				return
			}
			if (message.version !== PROTOCOL_VERSION) {
				this.kick(socket, KickReason.protocol)
				return
			}
			void this.hello(socket, message.ticket)
			return
		}
		const room = data.roomId ? this.rooms.get(data.roomId) : undefined
		if (!room) {
			this.kick(socket, KickReason.shutdown)
			return
		}
		if (message.type === 'input') room.receiveInputs(data.userId, message.inputs)
		else if (message.type === 'pong') room.receivePong(data.userId, message.time, Date.now())
		else if (message.type === 'range') room.rangeCommand(message.action, message.zombieType, message.count)
		else if (message.type === 'pause') room.pause(data.userId, message.paused, Date.now())
	}

	private async hello(socket: WebSocket<SocketData>, ticket: string): Promise<void> {
		const data = socket.getUserData()
		const check = verifyTicket(this.publicKey, ticket)
		if (!check.ok) {
			this.log.info({ reason: check.reason }, 'ticket refused')
			this.kick(socket, KickReason.badTicket)
			return
		}
		const { payload } = check
		if (payload.inst !== this.env.GAME_INSTANCE_ID || !this.nonces.claim(payload.nonce, payload.exp)) {
			this.log.info({ room: payload.room }, 'ticket for another server or already used')
			this.kick(socket, KickReason.badTicket)
			return
		}
		// a room that has closed never starts again from a late ticket
		if ((this.closedRooms.get(payload.room) ?? 0) > Date.now()) {
			this.log.info({ room: payload.room }, 'ticket for a closed room')
			this.kick(socket, KickReason.badTicket)
			return
		}
		const mission = payload.mode === 'squad' ? (payload.mission ?? null) : null
		// a squad holds a place in one room at a time
		if (payload.mode === 'squad' && this.valkey) {
			data.admitting = true
			const claimed = await claimPlayerRoom(this.valkey, payload.sub, payload.room).catch(() => true)
			data.admitting = false
			if (data.closed) return
			if (!claimed) {
				this.kick(socket, KickReason.elsewhere)
				return
			}
		}
		let room = this.rooms.get(payload.room)
		if (!room) {
			const ranges = [...this.rooms.values()].filter(existing => existing.mode === 'range').length
			const full =
				this.rooms.size >= this.env.GAME_MAX_ROOMS ||
				(payload.mode === 'range' && ranges >= this.env.GAME_MAX_RANGE_ROOMS)
			if (this.draining || full) {
				this.kick(socket, KickReason.roomFull)
				return
			}
			// a mission this server does not know (game data out of step) is refused before any room exists
			if (mission && !missionById(mission.id)) {
				this.log.error({ room: payload.room, mission: mission.id }, 'ticket names an unknown mission')
				this.kick(socket, KickReason.badTicket)
				return
			}
			room = new Room(
				payload.room,
				payload.mode,
				randomInt(2 ** 31),
				this.rooms.size,
				report => {
					if (!this.valkey || !this.rewardKey) return
					const key = this.rewardKey
					publishReward(this.valkey, report, text => signMessage(key, text)).catch(error =>
						this.log.error({ err: error, grantKey: report.grantKey }, 'reward report failed')
					)
				},
				mission,
				randomInt(2 ** 31)
			)
			this.rooms.set(payload.room, room)
			this.log.info({ room: room.id, mode: room.mode, mission: room.missionRoom }, 'room created')
		}
		// every ticket to a room names the same mode and mission it was created with; once it is
		// finished only its own players may come back (to see the results)
		if (
			room.mode !== payload.mode ||
			room.missionRoom?.id !== mission?.id ||
			room.missionRoom?.difficulty !== mission?.difficulty ||
			(room.completedAt > 0 && !room.has(payload.sub))
		) {
			this.kick(socket, KickReason.badTicket)
			return
		}
		let open = true
		const connection: Connection = {
			send: bytes => {
				if (!open) return false
				if (socket.getBufferedAmount() > MAX_BUFFERED_BYTES) {
					connection.close()
					return false
				}
				return socket.send(bytes, true) !== 2
			},
			close: () => {
				if (!open) return
				open = false
				socket.end()
			}
		}
		const joined = room.join(payload.sub, payload.name, payload.build, connection)
		if (!joined.ok) {
			this.kick(socket, KickReason.roomFull)
			return
		}
		if (data.helloTimer) clearTimeout(data.helloTimer)
		data.helloTimer = null
		data.userId = payload.sub
		data.roomId = room.id
		data.connection = connection
		this.log.info({ room: room.id, slot: joined.slot }, 'player joined')
	}

	private kick(socket: WebSocket<SocketData>, reason: number): void {
		try {
			socket.send(writeKick(this.writer, reason), true)
			socket.end(1008)
		} catch {
			// already closed
		}
	}

	/** Fixed-rate loop: keeps the game clock steady and catches up after short stalls. */
	private schedule(): void {
		const step = DT * 1000
		const run = () => {
			const now = performance.now()
			let ran = 0
			while (now >= this.nextTickAt && ran < MAX_CATCH_UP) {
				this.tickAll()
				this.nextTickAt += step
				ran++
			}
			if (now - this.nextTickAt > step * MAX_CATCH_UP) {
				// too far behind: drop the backlog rather than fast-forwarding the game
				this.stats.late++
				this.nextTickAt = now + step
			}
			this.timer = setTimeout(run, Math.max(0, this.nextTickAt - performance.now()))
		}
		this.timer = setTimeout(run, 0)
	}

	private tickAll(): void {
		const started = performance.now()
		const wall = Date.now()
		for (const [id, room] of this.rooms) {
			room.tick(wall)
			const finished = room.completedAt > 0 && wall - room.completedAt > RESULTS_SECONDS * 1000
			if (finished || (room.emptySince > 0 && wall - room.emptySince > EMPTY_ROOM_MS)) {
				room.reportAll()
				if (finished) room.closeAll(KickReason.complete)
				// a squad's room never starts again from a late ticket; the firing range is the same room
				// id every visit and earns nothing, so it may open again at once
				if (room.mode !== 'range') this.closedRooms.set(id, wall + CLOSED_ROOM_MS)
				this.dropped.delete(id)
				if (this.valkey && room.mode === 'squad') {
					for (const userId of room.userIds()) void releasePlayerRoom(this.valkey, userId, id).catch(() => {})
				}
				for (const flagged of room.suspicious()) this.log.warn({ room: id, ...flagged }, 'unusually accurate player')
				this.rooms.delete(id)
				this.log.info({ room: id }, 'room closed')
				if (this.draining && this.rooms.size === 0) this.onDrained?.()
			}
		}
		const took = performance.now() - started
		this.stats.count++
		this.stats.total += took
		if (took > this.stats.max) this.stats.max = took
		if (took > this.windowMax) this.windowMax = took
		this.windowTicks++
		if (took > SLOW_TICK_MS) this.windowSlow++
	}

	private metrics(): string {
		const { count, total, max, late } = this.stats
		return [
			'# TYPE rotline_game_rooms gauge',
			`rotline_game_rooms ${this.rooms.size}`,
			'# TYPE rotline_game_players gauge',
			`rotline_game_players ${this.playerCount()}`,
			'# TYPE rotline_game_ticks_total counter',
			`rotline_game_ticks_total ${count}`,
			'# TYPE rotline_game_tick_seconds_sum counter',
			`rotline_game_tick_seconds_sum ${(total / 1000).toFixed(6)}`,
			'# TYPE rotline_game_tick_seconds_max gauge',
			`rotline_game_tick_seconds_max ${(max / 1000).toFixed(6)}`,
			'# TYPE rotline_game_late_ticks_total counter',
			`rotline_game_late_ticks_total ${late}`,
			''
		].join('\n')
	}
}
