import { randomUUID } from 'node:crypto'
import { EXTRAPOLATE_TICKS, Interpolator, Predictor } from '@rotline/client/headless'
import { maps } from '@rotline/game-data'
import {
	INPUT_REDUNDANCY,
	Reader,
	readServerHeader,
	readSnapshot,
	Writer,
	writeHello,
	writeInput,
	writePong,
	ZombieTable
} from '@rotline/protocol'
import { angleToAim, Button, Grid, type PlayerInput, quantiseAxis, TICK_RATE } from '@rotline/sim'
import WebSocket from 'ws'

const TICK_MS = 1000 / TICK_RATE

export type BotStats = {
	snapshots: number
	/** gaps between snapshot arrivals, ms */
	gaps: number[]
	/** snapshots that arrived more than 100 ms later than their tick implies */
	late: number
	/** prediction corrections and the biggest one, metres */
	corrections: number
	maxCorrection: number
	/** frames where the render time ran past the newest snapshot (the buffer ran dry) */
	starved: number
	frames: number
	/** sum of the interpolation delay over frames, ms */
	delaySum: number
	rttMs: number[]
	kicked: number | null
}

/**
 * A headless player: real protocol, real prediction and interpolation, scripted inputs.
 * Moves in a wandering circle, aims at the nearest zombie and fires, reloads when empty.
 */
export class Bot {
	readonly stats: BotStats = {
		snapshots: 0,
		gaps: [],
		late: 0,
		corrections: 0,
		maxCorrection: 0,
		starved: 0,
		frames: 0,
		delaySum: 0,
		rttMs: [],
		kicked: null
	}
	private readonly socket: WebSocket
	private readonly writer = new Writer(256)
	private readonly table = new ZombieTable()
	private readonly interpolator = new Interpolator()
	private predictor: Predictor | null = null
	private readonly grid = new Grid(maps.yard as NonNullable<typeof maps.yard>)
	private seq = 0
	private lastArrival = 0
	private newestTick = 0
	private clockOffset = Number.NaN
	private readonly recent: PlayerInput[] = []
	private readonly timers: ReturnType<typeof setInterval>[] = []
	private readonly phase = Math.random() * Math.PI * 2

	constructor(url: string, ticket: string) {
		this.socket = new WebSocket(url)
		this.socket.binaryType = 'arraybuffer'
		this.socket.on('open', () => this.socket.send(writeHello(this.writer, ticket)))
		this.socket.on('message', (data: ArrayBuffer) => this.receive(new Uint8Array(data)))
		this.socket.on('error', () => {})
	}

	private receive(bytes: Uint8Array): void {
		const now = performance.now()
		const reader = new Reader(bytes)
		const message = readServerHeader(reader)
		if (message.type === 'welcome') {
			this.predictor = new Predictor(this.grid, message.you)
			this.timers.push(setInterval(() => this.tick(), TICK_MS))
			this.timers.push(setInterval(() => this.frame(), 1000 / 60))
		} else if (message.type === 'ping') {
			this.socket.send(writePong(this.writer, message.time))
		} else if (message.type === 'kick') {
			this.stats.kicked = message.reason
		} else if (message.type === 'snapshot') {
			const frame = readSnapshot(reader, this.table)
			this.stats.snapshots++
			if (this.lastArrival) this.stats.gaps.push(now - this.lastArrival)
			this.lastArrival = now
			// lateness against the best (earliest) arrival seen for the tick clock
			const sample = now - frame.tick * TICK_MS
			if (Number.isNaN(this.clockOffset) || sample < this.clockOffset) this.clockOffset = sample
			if (sample - this.clockOffset > 100) this.stats.late++
			this.newestTick = frame.tick
			this.interpolator.push(frame.tick, this.table, frame.others, frame.pools, now)
			if (frame.rttMs > 0) this.stats.rttMs.push(frame.rttMs)
			if (this.predictor) {
				const before = this.predictor.corrections
				const x = this.predictor.state.x
				const y = this.predictor.state.y
				this.predictor.reconcile(frame.self, frame.lastSeq, frame.tick)
				if (this.predictor.corrections > before) {
					this.stats.corrections++
					this.stats.maxCorrection = Math.max(
						this.stats.maxCorrection,
						Math.hypot(x - this.predictor.state.x, y - this.predictor.state.y)
					)
				}
			}
		}
	}

	private tick(): void {
		const predictor = this.predictor
		if (!predictor || this.socket.readyState !== WebSocket.OPEN) return
		const t = performance.now() / 1000
		const state = predictor.state
		// aim at the nearest zombie we know of
		let aim = state.aim
		let best = Number.POSITIVE_INFINITY
		const view = this.interpolator.view
		for (let n = 0; n < view.count; n++) {
			const d = Math.hypot((view.x[n] as number) - state.x, (view.y[n] as number) - state.y)
			if (d < best) {
				best = d
				aim = angleToAim(Math.atan2((view.y[n] as number) - state.y, (view.x[n] as number) - state.x))
			}
		}
		const held = state.weapons[state.slot as 0 | 1 | 2]
		let buttons = best < 25 ? Button.fire : 0
		if (held.mag === 0) buttons = held.reserve === 0 ? Button.slot3 : Button.reload
		this.seq++
		const input: PlayerInput = {
			seq: this.seq,
			moveX: quantiseAxis(Math.cos(t * 0.7 + this.phase) * 0.8),
			moveY: quantiseAxis(Math.sin(t * 0.9 + this.phase) * 0.8),
			aim,
			buttons,
			viewTick: Math.max(0, Math.floor(this.interpolator.renderTick(performance.now())))
		}
		predictor.apply(input)
		this.recent.push(input)
		if (this.recent.length > INPUT_REDUNDANCY) this.recent.shift()
		this.socket.send(writeInput(this.writer, 0, this.recent))
	}

	private frame(): void {
		const renderTick = this.interpolator.renderTick(performance.now())
		if (renderTick <= 0) return
		this.stats.frames++
		this.stats.delaySum += this.interpolator.delayMs
		// starved: even short extrapolation is not enough, so remote things visibly stop
		if (renderTick > this.newestTick + EXTRAPOLATE_TICKS) this.stats.starved++
		this.interpolator.sample(renderTick)
	}

	close(): void {
		for (const timer of this.timers) clearInterval(timer)
		this.socket.close()
	}
}

export const botName = () => `bot-${randomUUID().slice(0, 6)}`
