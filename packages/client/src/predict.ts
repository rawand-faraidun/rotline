import type { Build } from '@rotline/game-data'
import type { SelfState } from '@rotline/protocol'
import { clonePlayer, createPlayer, type Grid, type PlayerInput, type PlayerState, stepPlayer } from '@rotline/sim'

/** Corrections smaller than this are eased in over time instead of snapping. */
const SMOOTH_LIMIT = 0.5
/** How fast a visual correction fades, per second. */
const SMOOTH_RATE = 12

/**
 * Client-side prediction for the local player: inputs are applied immediately with the same
 * `stepPlayer` the server runs, kept until the server confirms them, and replayed on top of each
 * authoritative snapshot.
 */
export class Predictor {
	state: PlayerState
	readonly previous = { x: 0, y: 0 }
	/** inputs sent but not yet confirmed by a snapshot, oldest first */
	readonly pending: { input: PlayerInput; tick: number }[] = []
	/** visual offset left by the last correction; decays to zero */
	readonly offset = { x: 0, y: 0 }
	private baseTick = 0
	private readonly grid: Grid
	corrections = 0
	private started = false

	/** `build` comes from the welcome message, so prediction uses exactly the server's numbers. */
	constructor(grid: Grid, slot: number, build?: Build) {
		this.grid = grid
		this.state = createPlayer(slot, 0, 0, build)
	}

	/** Applies a new local input now. Returns true if it fired a shot. */
	apply(input: PlayerInput): boolean {
		const tick = this.baseTick + this.pending.length + 1
		this.pending.push({ input, tick })
		this.previous.x = this.state.x
		this.previous.y = this.state.y
		return stepPlayer(this.grid, this.state, input, tick)
	}

	/** Resets to the server's state for `lastSeq` at `tick`, then replays the unconfirmed inputs. */
	reconcile(self: SelfState, lastSeq: number, tick: number): void {
		while (this.pending.length > 0 && (this.pending[0]?.input.seq as number) <= lastSeq) this.pending.shift()
		const beforeX = this.state.x
		const beforeY = this.state.y
		const corrected = clonePlayer({ ...this.state, ...self, weapons: self.weapons, id: this.state.id, lastSeq })
		this.baseTick = tick
		for (const [index, entry] of this.pending.entries()) {
			entry.tick = tick + index + 1
			stepPlayer(this.grid, corrected, entry.input, entry.tick)
		}
		const dx = beforeX - corrected.x
		const dy = beforeY - corrected.y
		const error = Math.hypot(dx, dy)
		if (!this.started) {
			// the first snapshot places the player; nothing to correct
			this.started = true
			this.previous.x = corrected.x
			this.previous.y = corrected.y
			this.state = corrected
			return
		}
		if (error > 1e-4) this.corrections++
		if (error < SMOOTH_LIMIT) {
			this.offset.x += dx
			this.offset.y += dy
		} else {
			this.offset.x = 0
			this.offset.y = 0
		}
		this.previous.x += corrected.x - beforeX
		this.previous.y += corrected.y - beforeY
		this.state = corrected
	}

	/** Position to draw: between the last two ticks, plus the fading correction. */
	renderPosition(alpha: number, dtSeconds: number, out: { x: number; y: number }): void {
		const decay = Math.exp(-SMOOTH_RATE * dtSeconds)
		this.offset.x *= decay
		this.offset.y *= decay
		out.x = this.previous.x + (this.state.x - this.previous.x) * alpha + this.offset.x
		out.y = this.previous.y + (this.state.y - this.previous.y) * alpha + this.offset.y
	}
}
