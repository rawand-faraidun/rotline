import type { OtherPlayer, PoolState, ZombieTable } from '@rotline/protocol'
import { MAX_ZOMBIES, TICK_RATE } from '@rotline/sim'

const TICK_MS = 1000 / TICK_RATE
const BUFFER = 32

type Frame = {
	tick: number
	known: Uint8Array
	type: Uint8Array
	x: Float32Array
	y: Float32Array
	facing: Uint8Array
	health: Uint8Array
	state: Uint8Array
	others: OtherPlayer[]
	pools: PoolState[]
}

export type ZombieView = {
	count: number
	index: Int32Array
	type: Uint8Array
	x: Float32Array
	y: Float32Array
	facing: Float32Array
	health: Uint8Array
	state: Uint8Array
}

/**
 * Keeps recent snapshots and draws remote things (zombies, other players) slightly in the past,
 * between the two snapshots around the render time. The delay adapts to network jitter.
 */
export class Interpolator {
	private readonly frames: Frame[] = []
	private offset = Number.NaN
	private jitter = 0
	delayMs = 100
	readonly view: ZombieView = {
		count: 0,
		index: new Int32Array(MAX_ZOMBIES),
		type: new Uint8Array(MAX_ZOMBIES),
		x: new Float32Array(MAX_ZOMBIES),
		y: new Float32Array(MAX_ZOMBIES),
		facing: new Float32Array(MAX_ZOMBIES),
		health: new Uint8Array(MAX_ZOMBIES),
		state: new Uint8Array(MAX_ZOMBIES)
	}
	others: OtherPlayer[] = []
	pools: PoolState[] = []

	push(tick: number, table: ZombieTable, others: OtherPlayer[], pools: PoolState[], receivedAt: number): void {
		const frame = this.frames.length >= BUFFER ? (this.frames.shift() as Frame) : this.newFrame()
		frame.tick = tick
		frame.known.set(table.known)
		frame.type.set(table.type)
		frame.x.set(table.x)
		frame.y.set(table.y)
		frame.facing.set(table.facing)
		frame.health.set(table.health)
		frame.state.set(table.state)
		frame.others = others
		frame.pools = pools
		this.frames.push(frame)

		// clock: local time at which `tick` happened on the server, smoothed
		const sample = receivedAt - tick * TICK_MS
		if (Number.isNaN(this.offset)) this.offset = sample
		const deviation = sample - this.offset
		this.jitter = this.jitter * 0.9 + Math.abs(deviation) * 0.1
		// follow quickly when packets come early (less delay), slowly when late
		this.offset += deviation * (deviation < 0 ? 0.2 : 0.02)
		this.delayMs = Math.max(TICK_MS * 2, Math.min(250, TICK_MS * 2 + this.jitter * 2.5))
	}

	/** The fractional server tick to draw now. */
	renderTick(now: number): number {
		if (Number.isNaN(this.offset)) return 0
		return (now - this.offset - this.delayMs) / TICK_MS
	}

	/** Fills `view` with zombies at `tick`; returns false until there is anything to draw. */
	sample(tick: number): boolean {
		const frames = this.frames
		if (frames.length === 0) return false
		let a = frames[0] as Frame
		let b = a
		for (let i = frames.length - 1; i >= 0; i--) {
			const frame = frames[i] as Frame
			if (frame.tick <= tick) {
				a = frame
				b = frames[i + 1] ?? frame
				break
			}
		}
		const span = b.tick - a.tick
		// hold at the newest snapshot rather than guessing far ahead
		const alpha = span > 0 ? Math.max(0, Math.min(1, (tick - a.tick) / span)) : 0
		const view = this.view
		let count = 0
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			const inA = a.known[i] === 1
			const inB = b.known[i] === 1 && b.type[i] === a.type[i]
			if (!inA && !(b.known[i] === 1 && alpha > 0.5)) continue
			const from = inA ? a : b
			const to = inA && inB ? b : from
			view.index[count] = i
			view.type[count] = from.type[i] as number
			view.x[count] = (from.x[i] as number) + ((to.x[i] as number) - (from.x[i] as number)) * alpha
			view.y[count] = (from.y[i] as number) + ((to.y[i] as number) - (from.y[i] as number)) * alpha
			const fa = ((from.facing[i] as number) / 256) * Math.PI * 2
			let fb = ((to.facing[i] as number) / 256) * Math.PI * 2
			if (fb - fa > Math.PI) fb -= Math.PI * 2
			if (fa - fb > Math.PI) fb += Math.PI * 2
			view.facing[count] = fa + (fb - fa) * alpha
			view.health[count] = to.health[i] as number
			view.state[count] = to.state[i] as number
			count++
		}
		view.count = count
		this.pools = b.pools
		this.others = (alpha < 0.5 ? a : b).others.map(player => {
			const before = a.others.find(other => other.id === player.id)
			const after = b.others.find(other => other.id === player.id)
			if (!before || !after) return player
			return { ...after, x: before.x + (after.x - before.x) * alpha, y: before.y + (after.y - before.y) * alpha }
		})
		return true
	}

	private newFrame(): Frame {
		return {
			tick: 0,
			known: new Uint8Array(MAX_ZOMBIES),
			type: new Uint8Array(MAX_ZOMBIES),
			x: new Float32Array(MAX_ZOMBIES),
			y: new Float32Array(MAX_ZOMBIES),
			facing: new Uint8Array(MAX_ZOMBIES),
			health: new Uint8Array(MAX_ZOMBIES),
			state: new Uint8Array(MAX_ZOMBIES),
			others: [],
			pools: []
		}
	}
}
