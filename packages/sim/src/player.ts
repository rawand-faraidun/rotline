import {
	abilityById,
	type Build,
	combat,
	computeStats,
	type PlayerStats,
	player as playerDef,
	propsDef,
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
	// Timed effects count the player's own steps, not server ticks: prediction applies inputs one
	// step at a time, while the server may run two in one tick or none after a stall.
	/** Adrenaline Burst and Stim: steps of faster movement (and fire) left */
	hasteSteps: number
	hasteSpeed: number
	hasteFire: number
	/** Slide Dash: steps left moving by (dashX, dashY) metres a step */
	dashSteps: number
	dashX: number
	dashY: number
	/** Overwatch: shots left that pierce */
	overwatchShots: number
	/** Minigun Spin-up: steps left firing the minigun */
	minigunSteps: number
	/** firing range: abilities have no cooldown and utilities no limit */
	free: boolean
	/** carrying a mission object: slower (predicted, so the server's word arrives in snapshots) */
	carrying: boolean
	// server only (not predicted): capstones and buffs from teammates
	/** Second Wind: half damage until this tick */
	guardUntil: number
	/** Antidote Shot: immune to status effects until this tick */
	immuneUntil: number
	/** Last Rites has been used this mission */
	lastRitesUsed: boolean
	/** the Defibrillator has been used this wave (once per checkpoint, once those exist) */
	defibUsed: boolean
	/** kills in the current chain (Momentum) and the tick of the last one */
	chain: number
	lastKillTick: number
	// missions (server only)
	/** score this mission (kills times the chain multiplier, objectives) and score thresholds passed */
	score: number
	/** score spent at ammo stations (it still counts for rewards; only what is left can be spent) */
	scoreSpent: number
	thresholds: number
	/** items found and not yet reported, and how many were reported (drops are capped per mission) */
	foundItems: string[]
	itemsReported: number
	/** objective score not yet counted: the room adds it at the next checkpoint for those who took part */
	pendingScore: number
	/** the final objective's guaranteed item, if this player got one (withheld from non-participants) */
	finalItem: string | null
	/** caches this player has opened (each opens once per player) */
	openedCaches: number[]
	/** score earned while Double XP ran: its XP counts again */
	doubledScore: number
	/** the last tick this player moved, aimed or pressed anything */
	lastActiveTick: number
	/** disconnected (the room sets it): extraction does not wait for them */
	away: boolean
	/** ticks interact has been held in a row */
	interactTicks: number
	/** interact presses since the world last looked (counted per input, so a quick tap is never lost) */
	interactPresses: number
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
	piercing: 64,
	/** the shot came from the minigun */
	minigun: 128
} as const

/** Throws and placements are this far apart at least. */
const UTILITY_COOLDOWN_TICKS = Math.round(combat.throwIntervalSeconds * TICK_RATE)
const RANGE_COOLDOWN_TICKS = Math.round(combat.rangeCooldownSeconds * TICK_RATE)

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
		hasteSteps: 0,
		hasteSpeed: 0,
		hasteFire: 0,
		dashSteps: 0,
		dashX: 0,
		dashY: 0,
		overwatchShots: 0,
		minigunSteps: 0,
		free: false,
		carrying: false,
		guardUntil: 0,
		immuneUntil: 0,
		lastRitesUsed: false,
		defibUsed: false,
		chain: 0,
		lastKillTick: -1000,
		score: 0,
		scoreSpent: 0,
		thresholds: 0,
		foundItems: [],
		itemsReported: 0,
		openedCaches: [],
		pendingScore: 0,
		finalItem: null,
		doubledScore: 0,
		lastActiveTick: 0,
		away: false,
		interactTicks: 0,
		interactPresses: 0
	}
}

const pushed = { x: 0, y: 0 }

/**
 * Bodies do not pass through each other: a player overlapping a zombie is pushed out (sliding along
 * walls). The server runs it against the zombies as they are; the client against the zombies it draws,
 * so prediction stays close and the server's word settles any difference.
 */
export function separateFromZombies(
	grid: Grid,
	state: PlayerState,
	count: number,
	zombieX: ArrayLike<number>,
	zombieY: ArrayLike<number>,
	zombieRadius: (index: number) => number,
	alive?: ArrayLike<number>
): void {
	if (!state.alive) return
	const r = playerDef.radius
	for (let i = 0; i < count; i++) {
		if (alive && alive[i] === 0) continue
		const dx = state.x - (zombieX[i] as number)
		const dy = state.y - (zombieY[i] as number)
		const reach = r + zombieRadius(i) * 0.85
		if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue
		const d = Math.hypot(dx, dy)
		if (d >= reach) continue
		const nx = d > 1e-6 ? dx / d : 1
		const ny = d > 1e-6 ? dy / d : 0
		grid.moveCircle(state.x, state.y, nx * (reach - d), ny * (reach - d), r, pushed)
		state.x = pushed.x
		state.y = pushed.y
	}
}

/** Utility charges back to full and once-a-wave abilities ready again (a new wave or a checkpoint). */
export function refillUtilities(state: PlayerState): void {
	state.defibUsed = false
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

/** The held weapon's stats, with upgrades, perks and skills applied; `minigun` for minigun shots. */
export function activeWeapon(state: PlayerState, minigun = false): WeaponStats {
	if (minigun) return state.stats.minigun
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
			state.hasteSteps = seconds('durationSeconds')
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
			const steps = Math.max(1, seconds('dashSeconds'))
			const step = (params.distance ?? 0) / steps
			state.dashX = (dx / length) * step
			state.dashY = (dy / length) * step
			state.dashSteps = steps
			state.safeUntilTick = Math.max(state.safeUntilTick, tick + seconds('invulnerableSeconds'))
			break
		}
		case 'overwatch':
			state.overwatchShots = activeWeapon(state).magazine
			break
		case 'minigun-spin-up':
			state.minigunSteps = seconds('durationSeconds')
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
	if (pressed & Button.interact) state.interactPresses++

	// abilities fire while their key is held and they are ready (a press right at the end of a
	// cooldown is not lost if client and server disagree by a tick); utilities need a fresh press
	if (!state.downed) {
		const ready = state.abilityReady
		for (let slot = 0; slot < 3; slot++) {
			const id = state.stats.abilities[slot]
			if (!id || !(input.buttons & (ABILITY_BUTTONS[slot] as number)) || tick < (ready[slot] as number)) continue
			const cooldown = (abilityById.get(id)?.cooldownSeconds ?? 0) * state.stats.abilityCooldown
			ready[slot] = tick + (state.free ? RANGE_COOLDOWN_TICKS : Math.round(cooldown * TICK_RATE))
			startAbility(state, id, input, tick)
			result |= ABILITY_STEPS[slot] as number
		}
		for (let slot = 0; slot < 2; slot++) {
			const button = slot === 0 ? Button.utility1 : Button.utility2
			if (!(pressed & button) || tick < state.utilityReady) continue
			if (!state.stats.utilities[slot] || (state.utilityCharges[slot] === 0 && !state.free)) continue
			if (!state.free) state.utilityCharges[slot] = (state.utilityCharges[slot] as number) - 1
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
	if (state.dashSteps > 0 && !state.downed) {
		grid.moveCircle(state.x, state.y, state.dashX, state.dashY, playerDef.radius, position)
	} else {
		const haste = state.hasteSteps > 0 ? state.hasteSpeed : 0
		const carry = state.carrying ? propsDef.carry.speedMultiplier : 1
		const step = (state.downed ? DOWNED_SPEED : state.stats.speed * (1 + haste) * carry) * DT
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

	const fireRateScale = 1 + (state.hasteSteps > 0 ? state.hasteFire : 0)
	const minigunActive = state.minigunSteps > 0
	countDown(state)

	// the minigun needs no ammunition and no reloads while it lasts
	if (minigunActive && !state.downed) {
		const minigun = state.stats.minigun
		if (!(input.buttons & Button.fire) || tick < state.nextFireTick) return result
		state.nextFireTick = Math.max(state.nextFireTick, tick) + (60 * TICK_RATE) / (minigun.fireRate * fireRateScale)
		return result | Step.fired | Step.minigun
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

/** One step of each timed effect has been used. */
function countDown(state: PlayerState): void {
	if (state.hasteSteps > 0) state.hasteSteps--
	if (state.dashSteps > 0) state.dashSteps--
	if (state.minigunSteps > 0) state.minigunSteps--
}

export function aimAngle(state: PlayerState): number {
	return aimToAngle(state.aim)
}
