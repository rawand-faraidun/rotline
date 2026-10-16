import {
	abilityById,
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
	/** tick at which each ability slot can be used again */
	abilityReady: [number, number, number]
	/** utility charges left this wave, per slot */
	utilityCharges: [number, number]
	/** no throws or placements before this tick */
	utilityReady: number
	/** Adrenaline Burst and Stim: faster movement (and fire) until this tick */
	hasteUntil: number
	hasteSpeed: number
	hasteFire: number
	/** Slide Dash: moving by (dashX, dashY) metres a tick until this tick */
	dashUntil: number
	dashX: number
	dashY: number
	/** Overwatch: shots left that pierce */
	overwatchShots: number
	/** Minigun Spin-up: firing the minigun until this tick */
	minigunUntil: number
	/** firing range: abilities have no cooldown and utilities no limit */
	free: boolean
	// server only (not predicted): capstones and buffs from teammates
	/** Second Wind: half damage until this tick */
	guardUntil: number
	/** Antidote Shot: immune to status effects until this tick */
	immuneUntil: number
	/** Last Rites has been used this mission */
	lastRitesUsed: boolean
	/** kills in the current chain (Momentum) and the tick of the last one */
	chain: number
	lastKillTick: number
}

/** What a step did, as bits: the world resolves shots, abilities and throws. */
export const Step = {
	fired: 1,
	ability1: 2,
	ability2: 4,
	ability3: 8,
	utility1: 16,
	utility2: 32,
	/** the shot pierces (Overwatch) */
	piercing: 64
} as const

/** Throws and placements are this far apart at least. */
const UTILITY_COOLDOWN_TICKS = TICK_RATE
const DASH_TICKS = 8

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
		lastSeq: 0,
		abilityReady: [0, 0, 0],
		utilityCharges: [stats.utilities[0]?.charges ?? 0, stats.utilities[1]?.charges ?? 0],
		utilityReady: 0,
		hasteUntil: 0,
		hasteSpeed: 0,
		hasteFire: 0,
		dashUntil: 0,
		dashX: 0,
		dashY: 0,
		overwatchShots: 0,
		minigunUntil: 0,
		free: false,
		guardUntil: 0,
		immuneUntil: 0,
		lastRitesUsed: false,
		chain: 0,
		lastKillTick: -1000
	}
}

/** Utility charges back to full (a new wave). */
export function refillUtilities(state: PlayerState): void {
	state.utilityCharges[0] = state.stats.utilities[0]?.charges ?? 0
	state.utilityCharges[1] = state.stats.utilities[1]?.charges ?? 0
}

export function clonePlayer(source: PlayerState): PlayerState {
	return {
		...source,
		weapons: [{ ...source.weapons[0] }, { ...source.weapons[1] }, { ...source.weapons[2] }],
		abilityReady: [...source.abilityReady],
		utilityCharges: [...source.utilityCharges]
	}
}

/** The held weapon's stats, with upgrades, perks and skills applied (the minigun while it lasts). */
export function activeWeapon(state: PlayerState, tick = -1): WeaponStats {
	if (tick >= 0 && tick < state.minigunUntil) return state.stats.minigun
	return state.stats.weapons[state.slot as 0 | 1 | 2]
}

const ABILITY_BUTTONS = [Button.ability1, Button.ability2, Button.ability3] as const
const ABILITY_STEPS = [Step.ability1, Step.ability2, Step.ability3] as const

/**
 * The part of an ability that moves or arms the player, so it is predicted exactly; everything
 * that touches zombies or teammates is resolved by the world.
 */
function startAbility(state: PlayerState, id: string, input: PlayerInput, tick: number): void {
	const params = abilityById.get(id)?.params ?? {}
	const seconds = (key: string) => Math.round((params[key] ?? 0) * TICK_RATE)
	switch (id) {
		case 'adrenaline-burst':
		case 'stim':
			state.hasteUntil = tick + seconds('durationSeconds')
			state.hasteSpeed = params.speed ?? 0
			state.hasteFire = params.fireRate ?? 0
			break
		case 'slide-dash': {
			let dx = input.moveX
			let dy = input.moveY
			if (dx === 0 && dy === 0) {
				dx = Math.cos(aimToAngle(input.aim))
				dy = Math.sin(aimToAngle(input.aim))
			}
			const length = Math.hypot(dx, dy)
			const step = (params.distance ?? 0) / DASH_TICKS
			state.dashX = (dx / length) * step
			state.dashY = (dy / length) * step
			state.dashUntil = tick + DASH_TICKS
			state.safeUntilTick = Math.max(state.safeUntilTick, tick + seconds('invulnerableSeconds'))
			break
		}
		case 'overwatch':
			state.overwatchShots = activeWeapon(state).magazine
			break
		case 'minigun-spin-up':
			state.minigunUntil = tick + seconds('durationSeconds')
			break
	}
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
export function stepPlayer(grid: Grid, state: PlayerState, input: PlayerInput, tick: number): number {
	state.lastSeq = input.seq
	if (!state.alive) {
		state.heldButtons = input.buttons
		return 0
	}
	let result = 0
	const pressed = input.buttons & ~state.heldButtons
	state.heldButtons = input.buttons

	// abilities and utilities (not while downed)
	if (!state.downed) {
		for (const slot of [0, 1, 2] as const) {
			const id = state.stats.abilities[slot]
			if (!id || !(pressed & ABILITY_BUTTONS[slot]) || tick < state.abilityReady[slot]) continue
			const cooldown = (abilityById.get(id)?.cooldownSeconds ?? 0) * state.stats.abilityCooldown
			state.abilityReady[slot] = state.free ? tick : tick + Math.round(cooldown * TICK_RATE)
			startAbility(state, id, input, tick)
			result |= ABILITY_STEPS[slot]
		}
		for (const slot of [0, 1] as const) {
			const button = slot === 0 ? Button.utility1 : Button.utility2
			if (!(pressed & button) || tick < state.utilityReady) continue
			if (!state.stats.utilities[slot] || (state.utilityCharges[slot] === 0 && !state.free)) continue
			if (!state.free) state.utilityCharges[slot] -= 1
			state.utilityReady = tick + UTILITY_COOLDOWN_TICKS
			result |= slot === 0 ? Step.utility1 : Step.utility2
		}
	}

	// movement: the stick is clamped to unit length so diagonals are not faster
	let mx = input.moveX / 127
	let my = input.moveY / 127
	const length = Math.hypot(mx, my)
	if (length > 1) {
		mx /= length
		my /= length
	}
	if (tick < state.dashUntil && !state.downed) {
		grid.moveCircle(state.x, state.y, state.dashX, state.dashY, playerDef.radius, position)
	} else {
		const haste = tick < state.hasteUntil ? state.hasteSpeed : 0
		const step = (state.downed ? DOWNED_SPEED : state.stats.speed * (1 + haste)) * DT
		grid.moveCircle(state.x, state.y, mx * step, my * step, playerDef.radius, position)
	}
	state.x = position.x
	state.y = position.y
	state.aim = input.aim

	// downed players only have the pistol
	if (state.downed) {
		if (state.slot !== 2) switchTo(state, 2, tick)
	} else if (pressed & Button.slot1) switchTo(state, 0, tick)
	else if (pressed & Button.slot2) switchTo(state, 1, tick)
	else if (pressed & Button.slot3) switchTo(state, 2, tick)
	else if (pressed & Button.swap) switchTo(state, state.previousSlot, tick)

	const fireRateScale = 1 + (tick < state.hasteUntil ? state.hasteFire : 0)

	// the minigun needs no ammunition and no reloads while it lasts
	if (tick < state.minigunUntil && !state.downed) {
		const minigun = state.stats.minigun
		if (!(input.buttons & Button.fire) || tick < state.nextFireTick) return result
		state.nextFireTick = Math.max(state.nextFireTick, tick) + (60 * TICK_RATE) / (minigun.fireRate * fireRateScale)
		return result | Step.fired
	}

	const weapon = activeWeapon(state)
	const held = state.weapons[state.slot as 0 | 1 | 2]

	if (state.reloadEndTick !== 0 && tick >= state.reloadEndTick) finishReload(state, tick, weapon)
	if (pressed & Button.reload) startReload(state, tick, weapon)

	const wantsFire = weapon.automatic ? (input.buttons & Button.fire) !== 0 : (pressed & Button.fire) !== 0
	if (!wantsFire) return result
	// a shell-by-shell reload stops as soon as the player fires with shells loaded
	if (state.reloadEndTick !== 0) {
		if (!weapon.reloadPerRound || held.mag === 0) return result
		state.reloadEndTick = 0
	}
	if (held.mag === 0) {
		startReload(state, tick, weapon)
		return result
	}
	if (tick < state.nextFireTick) return result
	held.mag -= 1
	state.nextFireTick = Math.max(state.nextFireTick, tick) + (60 * TICK_RATE) / (weapon.fireRate * fireRateScale)
	result |= Step.fired
	if (state.overwatchShots > 0) {
		state.overwatchShots -= 1
		result |= Step.piercing
	}
	return result
}

export function aimAngle(state: PlayerState): number {
	return aimToAngle(state.aim)
}
