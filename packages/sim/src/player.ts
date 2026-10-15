import { player as playerDef, type WeaponDef, weaponIndex, weapons } from '@rotline/game-data'
import { DT, SWITCH_SECONDS, TICK_RATE } from './constants.ts'
import type { Grid } from './grid.ts'
import { aimToAngle, Button, type PlayerInput } from './input.ts'

export type WeaponState = {
	/** index into game-data weapons */
	def: number
	mag: number
	/** -1 means unlimited (pistols) */
	reserve: number
}

export type PlayerState = {
	id: number
	x: number
	y: number
	/** facing, 0..65535 */
	aim: number
	health: number
	alive: boolean
	respawnTick: number
	/** no damage before this tick (after respawning) */
	safeUntilTick: number
	/** 0 and 1 are main weapons, 2 is the pistol */
	slot: number
	previousSlot: number
	weapons: [WeaponState, WeaponState, WeaponState]
	/** tick at which a reload finishes; 0 when not reloading */
	reloadEndTick: number
	/** fractional tick at which the next shot may fire */
	nextFireTick: number
	/** buttons held on the previous input, for semi-automatic weapons and edge-triggered keys */
	heldButtons: number
	lastSeq: number
}

function weaponState(id: string): WeaponState {
	const def = weaponIndex(id)
	const weapon = weapons[def] as WeaponDef
	return { def, mag: weapon.magazine, reserve: weapon.maxReserve ?? -1 }
}

export function createPlayer(id: number, x: number, y: number): PlayerState {
	const [mainA, mainB] = playerDef.loadout.main
	return {
		id,
		x,
		y,
		aim: 0,
		health: playerDef.health,
		alive: true,
		respawnTick: 0,
		safeUntilTick: 0,
		slot: 0,
		previousSlot: 1,
		weapons: [weaponState(mainA), weaponState(mainB), weaponState(playerDef.loadout.pistol)],
		reloadEndTick: 0,
		nextFireTick: 0,
		heldButtons: 0,
		lastSeq: 0
	}
}

export function clonePlayer(source: PlayerState): PlayerState {
	return {
		...source,
		weapons: [{ ...source.weapons[0] }, { ...source.weapons[1] }, { ...source.weapons[2] }]
	}
}

export function activeWeapon(state: PlayerState): WeaponDef {
	return weapons[state.weapons[state.slot as 0 | 1 | 2].def] as WeaponDef
}

const position = { x: 0, y: 0 }

function startReload(state: PlayerState, tick: number, def: WeaponDef): void {
	const held = state.weapons[state.slot as 0 | 1 | 2]
	if (state.reloadEndTick !== 0 || held.mag >= def.magazine || held.reserve === 0) return
	state.reloadEndTick = tick + Math.round(def.reloadSeconds * TICK_RATE)
}

function finishReload(state: PlayerState, def: WeaponDef): void {
	const held = state.weapons[state.slot as 0 | 1 | 2]
	const missing = def.magazine - held.mag
	const taken = held.reserve < 0 ? missing : Math.min(missing, held.reserve)
	held.mag += taken
	if (held.reserve >= 0) held.reserve -= taken
	state.reloadEndTick = 0
}

function switchTo(state: PlayerState, slot: number, tick: number): void {
	if (slot === state.slot) return
	state.previousSlot = state.slot
	state.slot = slot
	state.reloadEndTick = 0
	state.nextFireTick = Math.max(state.nextFireTick, tick + SWITCH_SECONDS * TICK_RATE)
}

/**
 * Applies one input to one player: movement, weapon switching, reloading and firing.
 * Shared by the server and by client prediction, so it must stay deterministic.
 * Returns true when the player fires this tick; the caller resolves what the shot hits.
 */
export function stepPlayer(grid: Grid, state: PlayerState, input: PlayerInput, tick: number): boolean {
	state.lastSeq = input.seq
	if (!state.alive) {
		state.heldButtons = input.buttons
		return false
	}

	// movement: the stick is clamped to unit length so diagonals are not faster
	let mx = input.moveX / 127
	let my = input.moveY / 127
	const length = Math.hypot(mx, my)
	if (length > 1) {
		mx /= length
		my /= length
	}
	const step = playerDef.speed * DT
	grid.moveCircle(state.x, state.y, mx * step, my * step, playerDef.radius, position)
	state.x = position.x
	state.y = position.y
	state.aim = input.aim

	const pressed = input.buttons & ~state.heldButtons
	state.heldButtons = input.buttons

	if (pressed & Button.slot1) switchTo(state, 0, tick)
	else if (pressed & Button.slot2) switchTo(state, 1, tick)
	else if (pressed & Button.slot3) switchTo(state, 2, tick)
	else if (pressed & Button.swap) switchTo(state, state.previousSlot, tick)

	const def = activeWeapon(state)
	const held = state.weapons[state.slot as 0 | 1 | 2]

	if (state.reloadEndTick !== 0 && tick >= state.reloadEndTick) finishReload(state, def)
	if (pressed & Button.reload) startReload(state, tick, def)

	const wantsFire = def.automatic ? (input.buttons & Button.fire) !== 0 : (pressed & Button.fire) !== 0
	if (!wantsFire || state.reloadEndTick !== 0) return false
	if (held.mag === 0) {
		startReload(state, tick, def)
		return false
	}
	if (tick < state.nextFireTick) return false
	held.mag -= 1
	state.nextFireTick = Math.max(state.nextFireTick, tick) + (60 * TICK_RATE) / def.fireRate
	return true
}

export function aimAngle(state: PlayerState): number {
	return aimToAngle(state.aim)
}
