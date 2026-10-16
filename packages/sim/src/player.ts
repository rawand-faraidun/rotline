import {
	type Build,
	computeStats,
	type PlayerStats,
	player as playerDef,
	starterBuild,
	type WeaponStats
} from '@rotline/game-data'
import { DOWNED_SPEED, DT, SWITCH_SECONDS, TICK_RATE } from './constants.ts'
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
	/** class, level, skills and gear turned into numbers; fixed for the mission */
	stats: PlayerStats
	x: number
	y: number
	/** facing, 0..65535 */
	aim: number
	health: number
	/** false while out of the fight (bled out, or after a wipe) until respawning */
	alive: boolean
	/** at zero health in co-op: crawling with the pistol until revived or bled out */
	downed: boolean
	/** tick at which a downed player bleeds out */
	bleedoutTick: number
	/** downs since the last respawn; each one shortens the next bleed-out */
	downs: number
	/** revive progress while downed, 0..REVIVE_COMPLETE */
	reviveProgress: number
	respawnTick: number
	/** no damage before this tick (after respawning) */
	safeUntilTick: number
	/** 0 and 1 are main weapons, 2 is the pistol */
	slot: number
	previousSlot: number
	weapons: [WeaponState, WeaponState, WeaponState]
	/** tick at which a reload (or the next shell of a shell-by-shell reload) finishes; 0 when not reloading */
	reloadEndTick: number
	/** fractional tick at which the next shot may fire */
	nextFireTick: number
	/** buttons held on the previous input, for semi-automatic weapons and edge-triggered keys */
	heldButtons: number
	lastSeq: number
}

const fullWeapon = (weapon: WeaponStats): WeaponState => ({
	def: weapon.index,
	mag: weapon.magazine,
	reserve: weapon.maxReserve ?? -1
})

export function createPlayer(id: number, x: number, y: number, build: Build = starterBuild()): PlayerState {
	const stats = computeStats(build)
	return {
		id,
		stats,
		x,
		y,
		aim: 0,
		health: stats.maxHealth,
		alive: true,
		downed: false,
		bleedoutTick: 0,
		downs: 0,
		reviveProgress: 0,
		respawnTick: 0,
		safeUntilTick: 0,
		slot: 0,
		previousSlot: 1,
		weapons: [fullWeapon(stats.weapons[0]), fullWeapon(stats.weapons[1]), fullWeapon(stats.weapons[2])],
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

/** The held weapon's stats, with upgrades, perks and skills applied. */
export function activeWeapon(state: PlayerState): WeaponStats {
	return state.stats.weapons[state.slot as 0 | 1 | 2]
}

const position = { x: 0, y: 0 }

const reloadTicks = (weapon: WeaponStats) => Math.round(weapon.reloadSeconds * TICK_RATE)

function startReload(state: PlayerState, tick: number, weapon: WeaponStats): void {
	const held = state.weapons[state.slot as 0 | 1 | 2]
	if (state.reloadEndTick !== 0 || held.mag >= weapon.magazine || held.reserve === 0) return
	state.reloadEndTick = tick + reloadTicks(weapon)
}

function finishReload(state: PlayerState, tick: number, weapon: WeaponStats): void {
	const held = state.weapons[state.slot as 0 | 1 | 2]
	const missing = weapon.magazine - held.mag
	const wanted = weapon.reloadPerRound ? Math.min(1, missing) : missing
	const taken = held.reserve < 0 ? wanted : Math.min(wanted, held.reserve)
	held.mag += taken
	if (held.reserve >= 0) held.reserve -= taken
	// shotguns keep loading shell by shell until full or out of shells
	const more = weapon.reloadPerRound && held.mag < weapon.magazine && held.reserve !== 0
	state.reloadEndTick = more ? tick + reloadTicks(weapon) : 0
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
	const step = (state.downed ? DOWNED_SPEED : state.stats.speed) * DT
	grid.moveCircle(state.x, state.y, mx * step, my * step, playerDef.radius, position)
	state.x = position.x
	state.y = position.y
	state.aim = input.aim

	const pressed = input.buttons & ~state.heldButtons
	state.heldButtons = input.buttons

	// downed players only have the pistol
	if (state.downed) {
		if (state.slot !== 2) switchTo(state, 2, tick)
	} else if (pressed & Button.slot1) switchTo(state, 0, tick)
	else if (pressed & Button.slot2) switchTo(state, 1, tick)
	else if (pressed & Button.slot3) switchTo(state, 2, tick)
	else if (pressed & Button.swap) switchTo(state, state.previousSlot, tick)

	const weapon = activeWeapon(state)
	const held = state.weapons[state.slot as 0 | 1 | 2]

	if (state.reloadEndTick !== 0 && tick >= state.reloadEndTick) finishReload(state, tick, weapon)
	if (pressed & Button.reload) startReload(state, tick, weapon)

	const wantsFire = weapon.automatic ? (input.buttons & Button.fire) !== 0 : (pressed & Button.fire) !== 0
	if (!wantsFire) return false
	// a shell-by-shell reload stops as soon as the player fires with shells loaded
	if (state.reloadEndTick !== 0) {
		if (!weapon.reloadPerRound || held.mag === 0) return false
		state.reloadEndTick = 0
	}
	if (held.mag === 0) {
		startReload(state, tick, weapon)
		return false
	}
	if (tick < state.nextFireTick) return false
	held.mag -= 1
	state.nextFireTick = Math.max(state.nextFireTick, tick) + (60 * TICK_RATE) / weapon.fireRate
	return true
}

export function aimAngle(state: PlayerState): number {
	return aimToAngle(state.aim)
}
