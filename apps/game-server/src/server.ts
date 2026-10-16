import { createRequire } from 'node:module'
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
import { announceInstance, createValkey, publishReward, touchRoom, type Valkey } from '@rotline/state'
import { loadPublicKey, NonceStore, verifyTicket } from '@rotline/ticket'
import type { Logger } from 'pino'
import type { GameEnv } from './env.ts'
import { type Connection, Room } from './room.ts'
import type { TemplatedApp, us_listen_socket, WebSocket } from 'uWebSockets.js'

// uWebSockets.js 20.71's ESM wrapper points at a file the package does not ship, so load the CommonJS build
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
}

export type TickStats = { count: number; total: number; max: number; late: number }

export class GameServer {
	readonly rooms = new Map<string, Room>()
	readonly stats: TickStats = { count: 0, total: 0, max: 0, late: 0 }
	private readonly app: TemplatedApp
	private listenSocket: us_listen_socket | null = null
	private readonly nonces = new NonceStore()
	private readonly publicKey
	private readonly writer = new Writer(64)
	private timer: ReturnType<typeof setTimeout> | null = null
	private nextTickAt = 0
	private roomSeed = 1
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
						connection: null
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
	private async announce(): Promise<void> {
		if (!this.valkey) return
		try {
			const now = Date.now()
			for (const room of this.rooms.values()) await touchRoom(this.valkey, room.id, room.playerCount)
			if (now - this.announced >= 5000 || this.draining) {
				this.announced = now
				await announceInstance(this.valkey, {
					id: this.env.GAME_INSTANCE_ID,
					rooms: this.rooms.size,
					players: this.playerCount(),
					draining: this.draining,
					tickMaxMs: Number(this.windowMax.toFixed(2))
				})
				this.windowMax = 0
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
		if (!data.userId) {
			if (message.type !== 'hello') {
				this.kick(socket, KickReason.protocol)
				return
			}
			if (message.version !== PROTOCOL_VERSION) {
				this.kick(socket, KickReason.protocol)
				return
			}
			this.hello(socket, message.ticket)
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
	}

	private hello(socket: WebSocket<SocketData>, ticket: string): void {
		const data = socket.getUserData()
		const check = verifyTicket(this.publicKey, ticket)
		if (!check.ok) {
			this.log.info({ reason: check.reason }, 'ticket refused')
			this.kick(socket, KickReason.badTicket)
			return
		}
		const { payload } = check
		if (payload.inst !== this.env.GAME_INSTANCE_ID || !this.nonces.claim(payload.nonce, payload.exp)) {
			this.kick(socket, KickReason.badTicket)
			return
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
			room = new Room(payload.room, payload.mode, this.roomSeed++, this.rooms.size, report => {
				if (!this.valkey) return
				publishReward(this.valkey, report).catch(error =>
					this.log.error({ err: error, grantKey: report.grantKey }, 'reward report failed')
				)
			})
			this.rooms.set(payload.room, room)
			this.log.info({ room: room.id, mode: room.mode }, 'room created')
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
			if (room.emptySince > 0 && wall - room.emptySince > EMPTY_ROOM_MS) {
				room.reportAll()
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
