/** Button bits carried in every input. */
export const Button = {
	fire: 1,
	reload: 2,
	slot1: 4,
	slot2: 8,
	slot3: 16,
	swap: 32,
	/** hold next to a downed teammate to revive them */
	interact: 64,
	ability1: 128,
	ability2: 256,
	ability3: 512,
	utility1: 1024,
	utility2: 2048
} as const

/** `reach` is in steps of this many metres: how far from the player the cursor is (for throws). */
export const REACH_STEP = 0.2

/**
 * One tick of player intent, already quantised exactly as it travels on the wire,
 * so the client predicts with the same numbers the server simulates.
 */
export type PlayerInput = {
	/** increments by one per tick of input */
	seq: number
	/** -127..127 */
	moveX: number
	/** -127..127 */
	moveY: number
	/** 0..65535 maps to 0..2π */
	aim: number
	buttons: number
	/** the server tick the client was displaying when this input was made, for lag compensation */
	viewTick: number
	/** distance from the player to the cursor, 0..255 in REACH_STEP metres; where grenades land */
	reach: number
}

export const EMPTY_INPUT: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0, viewTick: 0, reach: 0 }

const TAU = Math.PI * 2

export function angleToAim(angle: number): number {
	const turns = (((angle % TAU) + TAU) % TAU) / TAU
	return Math.round(turns * 65536) & 0xffff
}

export function aimToAngle(aim: number): number {
	return (aim / 65536) * TAU
}

export function quantiseAxis(value: number): number {
	return Math.max(-127, Math.min(127, Math.round(value * 127)))
}
