import {
	abilityById,
	type Build,
	combat,
	type DamageType,
	damageTaken,
	type MapDef,
	player as playerDef,
	specialParams,
	type WavesDef,
	type WeaponStats,
	waves as wavesDef,
	type ZombieDef,
	zombies as zombieDefs,
	zombieIndex
} from '@rotline/game-data'
import { stepObjects, useAbility, useUtility } from './abilities.ts'
import {
	BLEEDOUT_MIN_SECONDS,
	BLEEDOUT_SECONDS,
	BLEEDOUT_STEP_SECONDS,
	DT,
	FLOW_EVERY,
	HASH_CELL,
	HISTORY_TICKS,
	MAX_REWIND_TICKS,
	MAX_ZOMBIES,
	NEVER,
	RESPAWN_SAFE_SECONDS,
	REVIVE_COMPLETE,
	REVIVE_RANGE,
	TICK_RATE
} from './constants.ts'
import { Grid } from './grid.ts'
import { Button, type PlayerInput } from './input.ts'
import { activeWeapon, createPlayer, type PlayerState, refillUtilities, Step, stepPlayer } from './player.ts'
import { Rng } from './rng.ts'

export type SimEvent =
	| { type: 'shot'; player: number; x: number; y: number; angle: number; length: number; weapon: number }
	| { type: 'hit'; zombie: number; x: number; y: number; amount: number; by: number }
	| { type: 'kill'; zombie: number; zombieType: number; x: number; y: number; by: number }
	| { type: 'burst'; x: number; y: number; radius: number }
	| { type: 'launch'; id: number; player: number; x: number; y: number; angle: number; speed: number; weapon: number }
	| { type: 'explode'; id: number; x: number; y: number; radius: number }
	| { type: 'player-hurt'; player: number; amount: number }
	| { type: 'player-down'; player: number }
	| { type: 'player-out'; player: number }
	| { type: 'player-revived'; player: number; by: number }
	| { type: 'player-up'; player: number }
	| { type: 'wipe'; wave: number }
	| { type: 'wave'; wave: number }
	| { type: 'cleared'; wave: number }
	/** someone used an ability (index into game-data abilities), for its sound and flash */
	| { type: 'ability'; player: number; ability: number; x: number; y: number; angle: number }

export type Pool = { x: number; y: number; radius: number; damagePerTick: number; untilTick: number }

/** A grenade or rocket in flight; explodes on the first zombie or wall it meets, or at its range. */
export type Projectile = {
	id: number
	owner: number
	x: number
	y: number
	dirX: number
	dirY: number
	speed: number
	travelled: number
	range: number
	damage: number
	radius: number
	damageType: DamageType
	/** thrown: flies over zombies and lands at its range, then runs `land` */
	lob: boolean
	land: ((world: World, x: number, y: number) => void) | null
}

/** Things abilities and utilities leave in the world, sent to clients in every snapshot. */
export const ObjectKind = {
	heal: 1,
	toxin: 2,
	fire: 3,
	barricade: 4,
	mine: 5,
	decoy: 6,
	sentry: 7,
	/** where a mortar shell is about to land */
	marker: 8
} as const

export type WorldObject = {
	id: number
	kind: number
	owner: number
	x: number
	y: number
	radius: number
	angle: number
	untilTick: number
	health: number
	maxHealth: number
	/** healing or damage per tick for zones, damage per shot for sentries and mines */
	amount: number
	damageType: DamageType
	/** barricade cells in the grid */
	cells: number[]
	/** sentry: next shot; mine: armed from this tick */
	nextTick: number
	/** sentry: ticks between shots */
	interval: number
	/** mine: a zombie this close sets it off */
	trigger: number
}

/** A blast waiting to go off (mortar shells, bombardment, bomblets). */
export type PendingBlast = {
	tick: number
	x: number
	y: number
	radius: number
	damage: number
	type: DamageType
	owner: number
	stunTicks: number
	/** marker object to remove when it lands */
	marker: number
}

export type BlastOptions = { stunTicks?: number; knockback?: number }

/** Explosions deal full damage at the centre and half at the edge. */
const EDGE_DAMAGE = 0.5
/** metres per second of a thrown grenade */
const LOB_SPEED = 16
/** weapon index in launch and shot events for thrown things and fragments */
export const THROWN = 255
/** extra zombies an Overwatch shot passes through */
const OVERWATCH_PIERCE = abilityById.get('overwatch')?.params.pierce ?? 0
const CHAIN_TICKS = combat.chainSeconds * TICK_RATE
// capstone numbers, from the skill data
const MOMENTUM = specialParams('momentum')
const EXECUTIONER = specialParams('executioner')
const SECOND_WIND = specialParams('second-wind')
const SUPPRESSION = specialParams('suppression')
const AFTERSHOCK = specialParams('aftershock')
const SHRAPNEL = specialParams('shrapnel')
const CONTAGION = specialParams('contagion')
const LAST_RITES = specialParams('last-rites')
const p = (params: Record<string, number>, key: string) => params[key] ?? 0
const ABILITY_BITS = [Step.ability1, Step.ability2, Step.ability3] as const
/** at most this many zombies are collected along one ray (pierce limit + 1) */
const MAX_RAY_HITS = 12

/** Zombie animation state, sent to clients. */
export const ZombieState = { moving: 0, attacking: 1 } as const

const DX = [1, -1, 0, 0, 1, 1, -1, -1]
const DY = [0, 0, 1, -1, 1, -1, 1, -1]
const UNREACHED = 0xffff

type Spawning = { wave: number; queue: number[]; accumulator: number; nextWaveTick: number }

/** `range`: the firing range (no waves, no cooldowns, dummies). */
export type WorldOptions = { seed: number; map: MapDef; waves?: WavesDef; flowPhase?: number; range?: boolean }

/**
 * One room's authoritative simulation. Zombies live in typed arrays (structure of arrays) so a
 * tick allocates nothing; players are plain objects because there are at most four.
 */
export class World {
	readonly grid: Grid
	readonly map: MapDef
	readonly rng: Rng
	tick = 0
	readonly players = new Map<number, PlayerState>()

	// zombies, indexed by entity slot
	readonly alive = new Uint8Array(MAX_ZOMBIES)
	readonly type = new Uint8Array(MAX_ZOMBIES)
	readonly x = new Float64Array(MAX_ZOMBIES)
	readonly y = new Float64Array(MAX_ZOMBIES)
	readonly vx = new Float64Array(MAX_ZOMBIES)
	readonly vy = new Float64Array(MAX_ZOMBIES)
	readonly health = new Float64Array(MAX_ZOMBIES)
	readonly cooldown = new Uint16Array(MAX_ZOMBIES)
	readonly state = new Uint8Array(MAX_ZOMBIES)
	// statuses: until which tick each lasts
	readonly stunUntil = new Uint32Array(MAX_ZOMBIES)
	readonly slowUntil = new Uint32Array(MAX_ZOMBIES)
	readonly slowAmount = new Float32Array(MAX_ZOMBIES)
	readonly markUntil = new Uint32Array(MAX_ZOMBIES)
	readonly markAmount = new Float32Array(MAX_ZOMBIES)
	readonly poisonUntil = new Uint32Array(MAX_ZOMBIES)
	readonly poisonPerTick = new Float32Array(MAX_ZOMBIES)
	readonly poisonBy = new Uint8Array(MAX_ZOMBIES)
	/** taunted toward a player (1..4) or, with 0, toward (tauntX, tauntY) */
	readonly tauntUntil = new Uint32Array(MAX_ZOMBIES)
	readonly tauntTarget = new Uint8Array(MAX_ZOMBIES)
	readonly tauntX = new Float32Array(MAX_ZOMBIES)
	readonly tauntY = new Float32Array(MAX_ZOMBIES)
	readonly lastHitTick = new Uint32Array(MAX_ZOMBIES)
	aliveCount = 0
	kills = 0
	score = 0

	// lag compensation: positions for the last HISTORY_TICKS ticks
	private readonly historyX = new Float64Array(HISTORY_TICKS * MAX_ZOMBIES)
	private readonly historyY = new Float64Array(HISTORY_TICKS * MAX_ZOMBIES)
	private readonly historyAlive = new Uint8Array(HISTORY_TICKS * MAX_ZOMBIES)

	// pathing and neighbours
	private readonly distance: Uint16Array
	private readonly flow: Int8Array
	private readonly queue: Int32Array
	private readonly hashWidth: number
	private readonly hashStart: Int32Array
	private readonly hashItems = new Int32Array(MAX_ZOMBIES)
	private readonly hashCell = new Int32Array(MAX_ZOMBIES)
	private readonly flowPhase: number

	readonly pools: Pool[] = []
	readonly projectiles: Projectile[] = []
	readonly objects: WorldObject[] = []
	readonly pendingBlasts: PendingBlast[] = []
	readonly range: boolean
	private readonly dummyResetTicks: number
	private nextProjectileId = 1
	private nextObjectId = 1
	private readonly rayHits = new Int32Array(MAX_RAY_HITS)
	private readonly rayDistances = new Float64Array(MAX_RAY_HITS)
	private rayCount = 0
	events: SimEvent[] = []
	private readonly wavesDef: WavesDef
	private readonly spawning: Spawning

	constructor(options: WorldOptions) {
		this.map = options.map
		this.grid = new Grid(options.map)
		this.rng = new Rng(options.seed)
		this.wavesDef = options.waves ?? wavesDef
		this.range = options.range ?? false
		this.dummyResetTicks = Math.round((options.map.range?.resetSeconds ?? 3) * TICK_RATE)
		this.flowPhase = (options.flowPhase ?? 0) % FLOW_EVERY
		const cells = this.grid.width * this.grid.height
		this.distance = new Uint16Array(cells)
		this.flow = new Int8Array(cells)
		this.queue = new Int32Array(Math.max(cells, MAX_ZOMBIES))
		this.hashWidth = Math.ceil(Math.max(this.grid.width, this.grid.height) / HASH_CELL)
		this.hashStart = new Int32Array(this.hashWidth * this.hashWidth + 1)
		this.spawning = {
			wave: 0,
			queue: [],
			accumulator: 0,
			nextWaveTick: Math.round(this.wavesDef.firstWaveDelaySeconds * TICK_RATE)
		}
	}

	addPlayer(id: number, build?: Build): PlayerState {
		const spawn = this.map.playerSpawns[this.players.size % this.map.playerSpawns.length] ?? this.map.playerSpawns[0]
		const state = createPlayer(id, spawn?.x ?? 1, spawn?.y ?? 1, build)
		state.free = this.range
		this.players.set(id, state)
		return state
	}

	removePlayer(id: number): void {
		this.players.delete(id)
	}

	get wave(): number {
		return this.spawning.wave
	}

	/**
	 * Advances one tick. `inputs` holds this tick's input per player. A player without an input this
	 * tick does nothing: replaying an old input would move them twice and desync client prediction.
	 */
	step(inputs: ReadonlyMap<number, PlayerInput>, keepEvents = false): void {
		// the server keeps the events of catch-up inputs it applied just before this step
		if (!keepEvents) this.events = []
		for (const state of this.players.values()) {
			if (!state.alive && this.tick >= state.respawnTick) this.respawn(state)
			const input = inputs.get(state.id)
			if (input) this.applyInput(state, input)
		}
		this.revives()
		this.moveProjectiles()
		this.blasts()
		stepObjects(this)
		this.statuses()
		if (!this.range) this.direct()
		if (this.tick % FLOW_EVERY === this.flowPhase) this.buildFlow()
		this.buildHash()
		this.moveZombies()
		this.applyPools()
		this.recordHistory()
		this.tick++
	}

	// --- players ---------------------------------------------------------------------------

	/**
	 * Applies one input to one player at the current tick. `step` calls it once per player; the
	 * server may call it for an extra queued input to catch a player up after a network stall.
	 */
	applyInput(state: PlayerState, input: PlayerInput): void {
		const result = stepPlayer(this.grid, state, input, this.tick)
		if (result === 0) return
		if (result & Step.fired) {
			this.fire(state, input.viewTick, (result & Step.piercing) !== 0, (result & Step.minigun) !== 0)
		}
		for (let slot = 0; slot < 3; slot++) {
			const id = state.stats.abilities[slot]
			if (!(result & (ABILITY_BITS[slot] as number)) || !id) continue
			// an ability with nothing to act on (no downed teammate in reach) gives its cooldown back
			if (!useAbility(this, state, id, input)) state.abilityReady[slot] = this.tick
		}
		if (result & Step.utility1) useUtility(this, state, 0, input)
		if (result & Step.utility2) useUtility(this, state, 1, input)
	}

	private respawn(state: PlayerState): void {
		const spawn = this.map.playerSpawns[(state.id - 1) % this.map.playerSpawns.length] ?? this.map.playerSpawns[0]
		state.alive = true
		state.downed = false
		state.downs = 0
		state.reviveProgress = 0
		state.health = state.stats.maxHealth
		state.x = spawn?.x ?? 1
		state.y = spawn?.y ?? 1
		state.reloadEndTick = 0
		state.safeUntilTick = this.tick + Math.round(RESPAWN_SAFE_SECONDS * TICK_RATE)
		this.events.push({ type: 'player-up', player: state.id })
	}

	/** Players who can still fight: in the world and not downed. */
	private standing(): number {
		let count = 0
		for (const state of this.players.values()) if (state.alive && !state.downed) count++
		return count
	}

	/** Damage to a player after armour, damage reduction and resistance; melee has no damage type. */
	private hurt(state: PlayerState, raw: number, type: DamageType | null): void {
		if (!state.alive || state.downed || raw <= 0 || this.tick < state.safeUntilTick) return
		// in the firing range nobody goes down: health simply comes back
		if (this.range && damageTaken(state.stats, raw, type) >= state.health) {
			state.health = state.stats.maxHealth
			return
		}
		const guarded = this.tick < state.guardUntil ? p(SECOND_WIND, 'damageTaken') : 1
		const amount = damageTaken(state.stats, raw, type) * guarded
		state.health = Math.max(0, state.health - amount)
		this.events.push({ type: 'player-hurt', player: state.id, amount })
		// Last Rites: once per mission, a lethal hit leaves 1 health
		if (state.health <= 0 && !state.lastRitesUsed && state.stats.specials.includes('last-rites')) {
			state.lastRitesUsed = true
			state.health = p(LAST_RITES, 'health') || 1
		}
		if (state.health > 0) return
		// zero health: downed, bleeding out, until a teammate revives them; the kill chain is lost
		state.downed = true
		state.chain = 0
		state.reviveProgress = 0
		const seconds =
			Math.max(BLEEDOUT_MIN_SECONDS, BLEEDOUT_SECONDS - BLEEDOUT_STEP_SECONDS * state.downs) +
			state.stats.bleedoutBonusSeconds
		state.bleedoutTick = this.tick + Math.round(seconds * TICK_RATE)
		state.downs++
		if (state.slot !== 2) {
			state.previousSlot = state.slot
			state.slot = 2
			state.reloadEndTick = 0
		}
		this.events.push({ type: 'player-down', player: state.id })
		// nobody left standing (always the case solo): the squad restarts the wave
		if (this.standing() === 0) this.wipe()
	}

	/** Revives in progress, and bleed-outs. Runs after everyone's input for the tick. */
	private revives(): void {
		for (const downed of this.players.values()) {
			if (!downed.alive || !downed.downed) continue
			if (this.tick >= downed.bleedoutTick) {
				downed.downed = false
				downed.alive = false
				downed.reviveProgress = 0
				// back with the next wave (or the next checkpoint, once missions have them)
				downed.respawnTick = NEVER
				this.events.push({ type: 'player-out', player: downed.id })
				if (this.standing() === 0) this.wipe()
				continue
			}
			let reviver: PlayerState | null = null
			for (const other of this.players.values()) {
				if (other === downed || !other.alive || other.downed || (other.heldButtons & Button.interact) === 0) continue
				if (Math.hypot(other.x - downed.x, other.y - downed.y) <= REVIVE_RANGE) {
					reviver = other
					break
				}
			}
			if (!reviver) {
				downed.reviveProgress = 0
				continue
			}
			// each reviver works at their own speed (Medics are faster)
			downed.reviveProgress += REVIVE_COMPLETE / (reviver.stats.reviveSeconds * TICK_RATE)
			if (downed.reviveProgress >= REVIVE_COMPLETE - 1e-6) this.revive(downed, reviver)
		}
	}

	/** Brings a downed player back up (held revive or the Defibrillator). */
	revive(downed: PlayerState, reviver: PlayerState): void {
		downed.downed = false
		downed.reviveProgress = 0
		downed.health = downed.stats.maxHealth * downed.stats.revivedHealth
		downed.slot = downed.previousSlot === 2 ? 0 : downed.previousSlot
		// Second Wind: the reviver's capstone shields the revived player for a moment
		if (reviver.stats.specials.includes('second-wind')) {
			downed.guardUntil = this.tick + Math.round(p(SECOND_WIND, 'seconds') * TICK_RATE)
		}
		this.events.push({ type: 'player-revived', player: downed.id, by: reviver.id })
	}

	/** Heals a player; the healer's healing bonus and the target's healing received both count. */
	heal(target: PlayerState, amount: number, healer: PlayerState | null): void {
		if (!target.alive || target.downed || amount <= 0) return
		const scaled = amount * (healer?.stats.healing ?? 1) * target.stats.healingReceived
		target.health = Math.min(target.stats.maxHealth, target.health + scaled)
	}

	/** Everyone is down or out: clear the board and restart the current wave. */
	private wipe(): void {
		const delay = Math.round(playerDef.respawnSeconds * TICK_RATE)
		for (const state of this.players.values()) {
			state.alive = false
			state.downed = false
			state.reviveProgress = 0
			state.respawnTick = this.tick + delay
		}
		for (let i = 0; i < MAX_ZOMBIES; i++) this.alive[i] = 0
		this.aliveCount = 0
		this.pools.length = 0
		this.projectiles.length = 0
		this.pendingBlasts.length = 0
		for (const object of [...this.objects]) this.removeObject(object)
		this.spawning.queue.length = 0
		this.spawning.accumulator = 0
		this.spawning.nextWaveTick = this.tick + delay + Math.round(this.wavesDef.breakSeconds * TICK_RATE)
		this.events.push({ type: 'wipe', wave: this.spawning.wave + 1 })
	}

	// --- shooting --------------------------------------------------------------------------

	private fire(state: PlayerState, viewTick: number, piercing: boolean, minigun: boolean): void {
		const weapon = activeWeapon(state, minigun)
		const rewound = Math.max(this.tick - MAX_REWIND_TICKS, Math.min(this.tick, viewTick))
		const base = (state.aim / 65536) * Math.PI * 2
		const spread = (weapon.spreadDegrees * Math.PI) / 180
		const behaviour = weapon.behaviour
		if (behaviour.type === 'cone') {
			this.fireCone(state, weapon, base, behaviour.angleDegrees, rewound)
			return
		}
		for (let pellet = 0; pellet < weapon.pellets; pellet++) {
			const angle = base + (this.rng.next() - 0.5) * spread
			const dirX = Math.cos(angle)
			const dirY = Math.sin(angle)
			if (behaviour.type === 'projectile') {
				// skill bonuses to blast radius are already in the weapon's stats
				this.launch(state, weapon, angle, behaviour.speed, behaviour.blastRadius)
				continue
			}
			const wall = this.grid.rayToWall(state.x, state.y, dirX, dirY, weapon.range)
			const pierce = (behaviour.type === 'hitscan' ? behaviour.pierce : 0) + (piercing ? OVERWATCH_PIERCE : 0)
			this.raycastZombies(state.x, state.y, dirX, dirY, wall, rewound, pierce + 1)
			const last = this.rayCount > 0 && this.rayCount > pierce ? (this.rayDistances[this.rayCount - 1] as number) : wall
			this.events.push({
				type: 'shot',
				player: state.id,
				x: state.x,
				y: state.y,
				angle,
				length: last,
				weapon: weapon.index
			})
			for (let k = 0; k < this.rayCount; k++) {
				this.damageZombie(this.rayHits[k] as number, weapon.damage, state.id, weapon.damageType)
			}
			if (behaviour.type === 'chain' && this.rayCount > 0) {
				this.chain(state, weapon, this.rayHits[0] as number, behaviour.chains, behaviour.chainRange)
			}
		}
	}

	/** A flamethrower or sprayer: every zombie in the cone and in sight takes this shot's damage. */
	private fireCone(state: PlayerState, weapon: WeaponStats, aim: number, angleDegrees: number, atTick: number): void {
		const half = (angleDegrees * Math.PI) / 360
		const slot = (atTick % HISTORY_TICKS) * MAX_ZOMBIES
		const useHistory = atTick < this.tick && this.tick - atTick < HISTORY_TICKS
		this.events.push({
			type: 'shot',
			player: state.id,
			x: state.x,
			y: state.y,
			angle: aim,
			length: weapon.range,
			weapon: weapon.index
		})
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) continue
			if (useHistory && this.historyAlive[slot + i] === 0) continue
			const zx = useHistory ? (this.historyX[slot + i] as number) : (this.x[i] as number)
			const zy = useHistory ? (this.historyY[slot + i] as number) : (this.y[i] as number)
			const dx = zx - state.x
			const dy = zy - state.y
			const distance = Math.hypot(dx, dy)
			const radius = (zombieDefs[this.type[i] as number] as ZombieDef).radius
			if (distance > weapon.range + radius || distance < 1e-6) continue
			let off = Math.abs(Math.atan2(dy, dx) - aim) % (Math.PI * 2)
			if (off > Math.PI) off = Math.PI * 2 - off
			if (off > half + Math.atan2(radius, distance)) continue
			if (this.grid.rayToWall(state.x, state.y, dx / distance, dy / distance, distance) < distance - radius) continue
			this.damageZombie(i, weapon.damage, state.id, weapon.damageType)
		}
	}

	/** Lightning jumps from the first zombie hit to the nearest unhit zombie, `chains` times. */
	private chain(state: PlayerState, weapon: WeaponStats, first: number, chains: number, range: number): void {
		let from = first
		const hit = this.rayHits
		hit[0] = first
		let count = 1
		for (let jump = 0; jump < chains && count < MAX_RAY_HITS; jump++) {
			const fx = this.x[from] as number
			const fy = this.y[from] as number
			let best = -1
			let bestDistance = range
			for (let i = 0; i < MAX_ZOMBIES; i++) {
				if (this.alive[i] === 0) continue
				let seen = false
				for (let k = 0; k < count; k++) if (hit[k] === i) seen = true
				if (seen) continue
				const d = Math.hypot((this.x[i] as number) - fx, (this.y[i] as number) - fy)
				if (d < bestDistance) {
					bestDistance = d
					best = i
				}
			}
			if (best < 0) break
			const tx = this.x[best] as number
			const ty = this.y[best] as number
			this.events.push({
				type: 'shot',
				player: state.id,
				x: fx,
				y: fy,
				angle: Math.atan2(ty - fy, tx - fx),
				length: bestDistance,
				weapon: weapon.index
			})
			this.damageZombie(best, weapon.damage, state.id, weapon.damageType)
			hit[count++] = best
			from = best
		}
	}

	private launch(state: PlayerState, weapon: WeaponStats, angle: number, speed: number, radius: number): void {
		const id = this.nextProjectileId++
		this.projectiles.push({
			id,
			owner: state.id,
			x: state.x,
			y: state.y,
			dirX: Math.cos(angle),
			dirY: Math.sin(angle),
			speed,
			travelled: 0,
			range: weapon.range,
			damage: weapon.damage,
			radius,
			damageType: weapon.damageType,
			lob: false,
			land: null
		})
		this.events.push({
			type: 'launch',
			id,
			player: state.id,
			x: state.x,
			y: state.y,
			angle,
			speed,
			weapon: weapon.index
		})
	}

	/** Throws something that flies over zombies and lands at (tx, ty) or the first wall; then `land` runs. */
	lob(owner: PlayerState, tx: number, ty: number, land: (world: World, x: number, y: number) => void): void {
		const dx = tx - owner.x
		const dy = ty - owner.y
		const distance = Math.max(0.5, Math.hypot(dx, dy))
		const id = this.nextProjectileId++
		const angle = Math.atan2(dy, dx)
		this.projectiles.push({
			id,
			owner: owner.id,
			x: owner.x,
			y: owner.y,
			dirX: dx / distance,
			dirY: dy / distance,
			speed: LOB_SPEED,
			travelled: 0,
			range: distance,
			damage: 0,
			radius: 0,
			damageType: 'explosive',
			lob: true,
			land
		})
		this.events.push({
			type: 'launch',
			id,
			player: owner.id,
			x: owner.x,
			y: owner.y,
			angle,
			speed: LOB_SPEED,
			weapon: THROWN
		})
	}

	private moveProjectiles(): void {
		for (let p = this.projectiles.length - 1; p >= 0; p--) {
			const shot = this.projectiles[p] as Projectile
			const step = Math.min(shot.speed * DT, shot.range - shot.travelled)
			const wall = this.grid.rayToWall(shot.x, shot.y, shot.dirX, shot.dirY, step)
			if (shot.lob) this.rayCount = 0
			else this.raycastZombies(shot.x, shot.y, shot.dirX, shot.dirY, wall, this.tick, 1)
			const reach = this.rayCount > 0 ? (this.rayDistances[0] as number) : wall
			shot.x += shot.dirX * reach
			shot.y += shot.dirY * reach
			shot.travelled += reach
			if (this.rayCount > 0 || wall < step || shot.travelled >= shot.range - 1e-6) {
				this.projectiles.splice(p, 1)
				this.explode(shot)
			}
		}
	}

	private explode(shot: Projectile): void {
		if (shot.lob) {
			// the thrown object vanishes; what it does on landing draws its own effects
			this.events.push({ type: 'explode', id: shot.id, x: shot.x, y: shot.y, radius: 0 })
			shot.land?.(this, shot.x, shot.y)
			return
		}
		this.blast(shot.x, shot.y, shot.radius, shot.damage, shot.damageType, shot.owner, {}, shot.id)
	}

	/**
	 * An explosion or pulse: damage falls from full at the centre to half at the edge. Optional stun
	 * and knock-back. Never hurts players (there is no friendly fire yet).
	 */
	blast(
		x: number,
		y: number,
		radius: number,
		damage: number,
		type: DamageType,
		owner: number,
		options: BlastOptions = {},
		id = 0
	): void {
		this.events.push({ type: 'explode', id, x, y, radius })
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) continue
			const zx = this.x[i] as number
			const zy = this.y[i] as number
			const d = Math.hypot(zx - x, zy - y)
			if (d >= radius) continue
			if (damage > 0) this.damageZombie(i, damage * (1 - (1 - EDGE_DAMAGE) * (d / radius)), owner, type)
			if (this.alive[i] === 0) continue
			if (options.stunTicks) this.stunUntil[i] = Math.max(this.stunUntil[i] as number, this.tick + options.stunTicks)
			if (options.knockback && d > 1e-6) {
				const push = options.knockback * (1 - d / radius)
				this.grid.moveCircle(zx, zy, ((zx - x) / d) * push, ((zy - y) / d) * push, 0.3, this.moved)
				this.x[i] = this.moved.x
				this.y[i] = this.moved.y
			}
		}
	}

	/** Mortar shells, bombardment and bomblets: blasts that go off at a later tick. */
	private blasts(): void {
		for (let b = this.pendingBlasts.length - 1; b >= 0; b--) {
			const pending = this.pendingBlasts[b] as PendingBlast
			if (this.tick < pending.tick) continue
			this.pendingBlasts.splice(b, 1)
			const marker = this.objects.find(object => object.id === pending.marker)
			if (marker) this.removeObject(marker)
			this.blast(pending.x, pending.y, pending.radius, pending.damage, pending.type, pending.owner, {
				stunTicks: pending.stunTicks
			})
		}
	}

	/** Adds a zone, barricade, mine, decoy, sentry or marker; a player's oldest goes past the cap. */
	addObject(object: Omit<WorldObject, 'id'>): WorldObject {
		let owned = 0
		let oldest: WorldObject | null = null
		for (const existing of this.objects) {
			if (existing.owner !== object.owner || existing.kind === ObjectKind.marker) continue
			owned++
			oldest ??= existing
		}
		if (oldest && owned >= combat.maxObjectsPerPlayer && object.kind !== ObjectKind.marker) this.removeObject(oldest)
		const added = { ...object, id: this.nextObjectId++ }
		this.objects.push(added)
		return added
	}

	removeObject(object: WorldObject): void {
		const index = this.objects.indexOf(object)
		if (index < 0) return
		this.objects.splice(index, 1)
		for (const cell of object.cells) if (this.grid.walls[cell] === 2) this.grid.walls[cell] = 0
	}

	/** Poison ticks, dummies healing back, chains running out. */
	private statuses(): void {
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) continue
			if ((this.poisonUntil[i] as number) > this.tick) {
				this.damageZombie(i, this.poisonPerTick[i] as number, this.poisonBy[i] as number, 'chemical', false)
			}
			if (this.alive[i] === 0) continue
			const def = zombieDefs[this.type[i] as number] as ZombieDef
			if (def.dummy && this.tick - (this.lastHitTick[i] as number) > this.dummyResetTicks) {
				this.health[i] = def.health
			}
		}
		for (const state of this.players.values()) {
			if (state.chain > 0 && this.tick - state.lastKillTick > CHAIN_TICKS) state.chain = 0
		}
	}

	/** Zombies within `radius` of (x, y) chase `player` (or the point, with 0) for a while. */
	taunt(x: number, y: number, radius: number, ticks: number, player: number): void {
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0 || (zombieDefs[this.type[i] as number] as ZombieDef).dummy) continue
			if (Math.hypot((this.x[i] as number) - x, (this.y[i] as number) - y) > radius) continue
			this.tauntUntil[i] = this.tick + ticks
			this.tauntTarget[i] = player
			this.tauntX[i] = x
			this.tauntY[i] = y
		}
	}

	/** The nearest zombie on a ray, or -1 (Mark Target, Shrapnel). Sets `rayDistances[0]`. */
	zombieOnRay(ox: number, oy: number, angle: number, maxDistance: number): number {
		const dirX = Math.cos(angle)
		const dirY = Math.sin(angle)
		const wall = this.grid.rayToWall(ox, oy, dirX, dirY, maxDistance)
		this.raycastZombies(ox, oy, dirX, dirY, wall, this.tick, 1)
		return this.rayCount > 0 ? (this.rayHits[0] as number) : -1
	}

	/**
	 * The nearest `limit` zombies hit by the ray, nearest first, tested against positions as the
	 * shooter saw them. Results are in `rayHits`/`rayDistances`, `rayCount` long.
	 */
	private raycastZombies(
		ox: number,
		oy: number,
		dirX: number,
		dirY: number,
		maxDistance: number,
		atTick: number,
		limit: number
	): void {
		const slot = (atTick % HISTORY_TICKS) * MAX_ZOMBIES
		const useHistory = atTick < this.tick && this.tick - atTick < HISTORY_TICKS
		const keep = Math.min(limit, MAX_RAY_HITS)
		let count = 0
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) continue
			if (useHistory && this.historyAlive[slot + i] === 0) continue
			const zx = useHistory ? (this.historyX[slot + i] as number) : (this.x[i] as number)
			const zy = useHistory ? (this.historyY[slot + i] as number) : (this.y[i] as number)
			const qx = zx - ox
			const qy = zy - oy
			const along = qx * dirX + qy * dirY
			if (along < 0 || along > maxDistance) continue
			if (count === keep && along >= (this.rayDistances[count - 1] as number)) continue
			const px = qx - dirX * along
			const py = qy - dirY * along
			const radius = (zombieDefs[this.type[i] as number] as ZombieDef).radius
			if (px * px + py * py >= radius * radius) continue
			// insert in distance order, dropping the farthest when full
			let k = count < keep ? count++ : keep - 1
			while (k > 0 && (this.rayDistances[k - 1] as number) > along) {
				this.rayDistances[k] = this.rayDistances[k - 1] as number
				this.rayHits[k] = this.rayHits[k - 1] as number
				k--
			}
			this.rayDistances[k] = along
			this.rayHits[k] = i
		}
		this.rayCount = count
	}

	/**
	 * Damage to a zombie from player `by` (0 for no one). Applies the attacker's capstones and the
	 * zombie's mark; `direct` is false for damage over time, which builds no chains or fragments.
	 */
	damageZombie(index: number, amount: number, by: number, type: DamageType = 'ballistic', direct = true): void {
		if (this.alive[index] === 0) return
		const def = zombieDefs[this.type[index] as number] as ZombieDef
		const attacker = this.players.get(by)
		let scaled = amount
		if (attacker) {
			const specials = attacker.stats.specials
			if (specials.includes('momentum')) {
				scaled *= 1 + Math.min(p(MOMENTUM, 'max'), p(MOMENTUM, 'perKill') * attacker.chain)
			}
			if (
				specials.includes('executioner') &&
				(this.health[index] as number) < def.health * p(EXECUTIONER, 'healthBelow')
			) {
				scaled *= p(EXECUTIONER, 'multiplier')
			}
			if ((this.slowUntil[index] as number) > this.tick) scaled *= 1 + attacker.stats.damageVsSlowed
		}
		if ((this.markUntil[index] as number) > this.tick) scaled *= 1 + (this.markAmount[index] as number)
		this.health[index] = (this.health[index] as number) - scaled
		this.lastHitTick[index] = this.tick
		if (direct) {
			this.events.push({
				type: 'hit',
				zombie: index,
				x: this.x[index] as number,
				y: this.y[index] as number,
				amount: scaled,
				by
			})
		}
		if ((this.health[index] as number) > 0) {
			if (attacker && direct) this.afterHit(index, attacker, type)
			return
		}
		// dummies never die
		if (def.dummy) {
			this.health[index] = def.health
			return
		}
		const x = this.x[index] as number
		const y = this.y[index] as number
		this.alive[index] = 0
		this.aliveCount--
		this.kills++
		this.score += def.score
		this.events.push({ type: 'kill', zombie: index, zombieType: this.type[index] as number, x, y, by })
		if (attacker) {
			attacker.chain = this.tick - attacker.lastKillTick <= CHAIN_TICKS ? attacker.chain + 1 : 1
			attacker.lastKillTick = this.tick
			if (attacker.alive && !attacker.downed && attacker.stats.killHeal > 0) {
				this.heal(attacker, attacker.stats.killHeal, null)
			}
			if (direct) this.afterKill(x, y, attacker, type)
		}
		if (def.deathBurst) this.burst(x, y, def.deathBurst, by)
	}

	/** Suppression and Aftershock slow the zombies that survive a hit. */
	private afterHit(index: number, attacker: PlayerState, type: DamageType): void {
		const specials = attacker.stats.specials
		if (type === 'ballistic' && specials.includes('suppression')) {
			this.slow(index, p(SUPPRESSION, 'slow'), Math.round(p(SUPPRESSION, 'seconds') * TICK_RATE))
		}
		if (type === 'explosive' && specials.includes('aftershock')) {
			this.slow(index, p(AFTERSHOCK, 'slow'), Math.round(p(AFTERSHOCK, 'seconds') * TICK_RATE))
		}
	}

	/** Shrapnel and Contagion: some kills spread. */
	private afterKill(x: number, y: number, attacker: PlayerState, type: DamageType): void {
		const specials = attacker.stats.specials
		if (type === 'explosive' && specials.includes('shrapnel')) {
			const range = p(SHRAPNEL, 'range')
			for (let n = 0; n < p(SHRAPNEL, 'fragments'); n++) {
				const angle = this.rng.next() * Math.PI * 2
				const target = this.zombieOnRay(x, y, angle, range)
				const length =
					target >= 0
						? (this.rayDistances[0] as number)
						: this.grid.rayToWall(x, y, Math.cos(angle), Math.sin(angle), range)
				this.events.push({ type: 'shot', player: 0, x, y, angle, length, weapon: THROWN })
				if (target >= 0) this.damageZombie(target, p(SHRAPNEL, 'damage'), attacker.id, 'explosive', false)
			}
		}
		if (type === 'chemical' && specials.includes('contagion')) {
			for (let i = 0; i < MAX_ZOMBIES; i++) {
				if (this.alive[i] === 0) continue
				if (Math.hypot((this.x[i] as number) - x, (this.y[i] as number) - y) > p(CONTAGION, 'radius')) continue
				this.poison(i, p(CONTAGION, 'damagePerSecond'), Math.round(p(CONTAGION, 'seconds') * TICK_RATE), attacker.id)
			}
		}
	}

	slow(index: number, amount: number, ticks: number): void {
		if ((this.slowUntil[index] as number) <= this.tick || amount >= (this.slowAmount[index] as number)) {
			this.slowAmount[index] = amount
		}
		this.slowUntil[index] = Math.max(this.slowUntil[index] as number, this.tick + ticks)
	}

	poison(index: number, perSecond: number, ticks: number, by: number): void {
		const current = (this.poisonUntil[index] as number) > this.tick ? (this.poisonPerTick[index] as number) : 0
		this.poisonPerTick[index] = Math.max(perSecond * DT, current)
		this.poisonUntil[index] = Math.max(this.poisonUntil[index] as number, this.tick + ticks)
		this.poisonBy[index] = by
	}

	mark(index: number, amount: number, ticks: number): void {
		this.markAmount[index] = amount
		this.markUntil[index] = this.tick + ticks
	}

	private burst(x: number, y: number, burst: NonNullable<ZombieDef['deathBurst']>, by: number): void {
		this.events.push({ type: 'burst', x, y, radius: burst.radius })
		for (const state of this.players.values()) {
			const d = Math.hypot(state.x - x, state.y - y)
			if (d < burst.radius) this.hurt(state, burst.damage * (1 - d / burst.radius), 'chemical')
		}
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) continue
			const d = Math.hypot((this.x[i] as number) - x, (this.y[i] as number) - y)
			if (d < burst.radius) this.damageZombie(i, burst.damage * 2 * (1 - d / burst.radius), by)
		}
		this.pools.push({
			x,
			y,
			radius: burst.poolRadius,
			damagePerTick: burst.poolDamagePerSecond * DT,
			untilTick: this.tick + Math.round(burst.poolSeconds * TICK_RATE)
		})
	}

	private applyPools(): void {
		for (let i = this.pools.length - 1; i >= 0; i--) {
			const pool = this.pools[i] as Pool
			if (this.tick >= pool.untilTick) {
				this.pools.splice(i, 1)
				continue
			}
			for (const state of this.players.values()) {
				const dx = state.x - pool.x
				const dy = state.y - pool.y
				if (dx * dx + dy * dy < pool.radius * pool.radius) this.hurt(state, pool.damagePerTick, 'chemical')
			}
		}
	}

	// --- spawning ----------------------------------------------------------------------------

	private waveCounts(wave: number): Record<string, number> {
		const list = this.wavesDef.waves
		const last = list[list.length - 1] as Record<string, number>
		if (wave < list.length) return list[wave] as Record<string, number>
		const growth = this.wavesDef.growthPerWave ** (wave - list.length + 1)
		return Object.fromEntries(Object.entries(last).map(([key, count]) => [key, Math.round(count * growth)]))
	}

	/** The wave director: queues each wave's zombies, releases them at a steady rate, then rests. */
	private direct(): void {
		const spawning = this.spawning
		if (this.players.size === 0) return
		if (spawning.queue.length === 0 && this.aliveCount === 0 && this.tick >= spawning.nextWaveTick) {
			if (spawning.nextWaveTick >= 0) {
				const counts = this.waveCounts(spawning.wave)
				for (const [key, count] of Object.entries(counts)) {
					for (let n = 0; n < count; n++) spawning.queue.push(zombieIndex(key))
				}
				// shuffle so types arrive mixed (Fisher–Yates with the room's rng)
				for (let i = spawning.queue.length - 1; i > 0; i--) {
					const j = this.rng.int(i + 1)
					const swap = spawning.queue[i] as number
					spawning.queue[i] = spawning.queue[j] as number
					spawning.queue[j] = swap
				}
				this.events.push({ type: 'wave', wave: spawning.wave + 1 })
				for (const state of this.players.values()) refillUtilities(state)
				spawning.nextWaveTick = -1
				for (const state of this.players.values())
					if (!state.alive && state.respawnTick === NEVER) state.respawnTick = this.tick
			}
		}
		if (spawning.queue.length > 0) {
			spawning.accumulator += this.wavesDef.spawnPerSecond * DT
			while (spawning.accumulator >= 1 && spawning.queue.length > 0 && this.aliveCount < this.wavesDef.maxAlive) {
				spawning.accumulator -= 1
				this.spawnZombie(spawning.queue.pop() as number)
			}
			if (spawning.queue.length === 0) spawning.accumulator = 0
		} else if (spawning.nextWaveTick < 0 && this.aliveCount === 0) {
			// the wave is cleared: rewards are paid on this, never on a wave restarted after a wipe
			this.events.push({ type: 'cleared', wave: spawning.wave + 1 })
			spawning.wave++
			spawning.nextWaveTick = this.tick + Math.round(this.wavesDef.breakSeconds * TICK_RATE)
		}
	}

	spawnZombie(typeIndex: number, at?: { x: number; y: number }): number {
		let index = -1
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) {
				index = i
				break
			}
		}
		if (index < 0) return -1
		const point = at ?? this.pickSpawnPoint()
		const def = zombieDefs[typeIndex] as ZombieDef
		this.alive[index] = 1
		this.type[index] = typeIndex
		this.x[index] = point.x
		this.y[index] = point.y
		this.vx[index] = 0
		this.vy[index] = 0
		this.health[index] = def.health
		this.cooldown[index] = 0
		this.state[index] = ZombieState.moving
		this.stunUntil[index] = 0
		this.slowUntil[index] = 0
		this.markUntil[index] = 0
		this.poisonUntil[index] = 0
		this.tauntUntil[index] = 0
		this.lastHitTick[index] = this.tick
		this.aliveCount++
		return index
	}

	private pickSpawnPoint(): { x: number; y: number } {
		const points = this.map.zombieSpawns
		// prefer points away from every player, so zombies do not appear on top of anyone
		for (let attempt = 0; attempt < 8; attempt++) {
			const point = points[this.rng.int(points.length)] as { x: number; y: number }
			let far = true
			for (const state of this.players.values()) {
				if (Math.hypot(state.x - point.x, state.y - point.y) < 12) far = false
			}
			if (far || attempt === 7) {
				const x = point.x + (this.rng.next() - 0.5) * 1.5
				const y = point.y + (this.rng.next() - 0.5) * 1.5
				return this.grid.isWall(x, y) ? point : { x, y }
			}
		}
		return points[0] as { x: number; y: number }
	}

	// --- movement ----------------------------------------------------------------------------

	/** One flow field toward the nearest living player, shared by every zombie (multi-source BFS). */
	private buildFlow(): void {
		const { width, height, walls } = this.grid
		const distance = this.distance
		distance.fill(UNREACHED)
		let head = 0
		let tail = 0
		for (const state of this.players.values()) {
			if (!state.alive || state.downed) continue
			const c = Math.floor(state.y) * width + Math.floor(state.x)
			if (c >= 0 && c < distance.length && distance[c] !== 0) {
				distance[c] = 0
				this.queue[tail++] = c
			}
		}
		while (head < tail) {
			const c = this.queue[head++] as number
			const cx = c % width
			const cy = (c - cx) / width
			const next = (distance[c] as number) + 1
			for (let d = 0; d < 4; d++) {
				const nx = cx + (DX[d] as number)
				const ny = cy + (DY[d] as number)
				if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
				const n = ny * width + nx
				if (walls[n] !== 0 || (distance[n] as number) <= next) continue
				distance[n] = next
				this.queue[tail++] = n
			}
		}
		for (let c = 0; c < distance.length; c++) {
			if (walls[c] !== 0) continue
			const cx = c % width
			const cy = (c - cx) / width
			let best = distance[c] as number
			let bestDir = -1
			for (let d = 0; d < 8; d++) {
				const nx = cx + (DX[d] as number)
				const ny = cy + (DY[d] as number)
				if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
				const n = ny * width + nx
				if (walls[n] !== 0) continue
				if (d >= 4 && (walls[cy * width + nx] !== 0 || walls[ny * width + cx] !== 0)) continue
				if ((distance[n] as number) < best) {
					best = distance[n] as number
					bestDir = d
				}
			}
			this.flow[c] = bestDir
		}
	}

	private buildHash(): void {
		const start = this.hashStart
		start.fill(0)
		const w = this.hashWidth
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) {
				this.hashCell[i] = -1
				continue
			}
			const h = Math.floor((this.y[i] as number) / HASH_CELL) * w + Math.floor((this.x[i] as number) / HASH_CELL)
			this.hashCell[i] = h
			start[h + 1] = (start[h + 1] as number) + 1
		}
		for (let h = 0; h < w * w; h++) start[h + 1] = (start[h + 1] as number) + (start[h] as number)
		const cursor = this.queue
		for (let h = 0; h < w * w; h++) cursor[h] = start[h] as number
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			const h = this.hashCell[i] as number
			if (h < 0) continue
			this.hashItems[cursor[h] as number] = i
			cursor[h] = (cursor[h] as number) + 1
		}
	}

	private readonly moved = { x: 0, y: 0 }

	private moveZombies(): void {
		const { width } = this.grid
		const w = this.hashWidth
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 0) continue
			const def = zombieDefs[this.type[i] as number] as ZombieDef
			// firing-range dummies stand still
			if (def.dummy) continue
			const x = this.x[i] as number
			const y = this.y[i] as number
			const stunned = (this.stunUntil[i] as number) > this.tick

			// target: the nearest living player, or whoever taunted it
			let target: PlayerState | null = null
			let targetDistance = Number.POSITIVE_INFINITY
			for (const state of this.players.values()) {
				if (!state.alive || state.downed) continue
				const d = Math.hypot(state.x - x, state.y - y)
				if (d < targetDistance) {
					targetDistance = d
					target = state
				}
			}
			const taunted = (this.tauntUntil[i] as number) > this.tick
			const taunter = taunted ? this.players.get(this.tauntTarget[i] as number) : undefined
			if (taunter?.alive && !taunter.downed) {
				target = taunter
				targetDistance = Math.hypot(taunter.x - x, taunter.y - y)
			}

			let wantX = 0
			let wantY = 0
			const reach = def.radius + playerDef.radius + def.meleeRange
			const decoy = taunted && (this.tauntTarget[i] as number) === 0
			const toDecoy = decoy ? Math.hypot((this.tauntX[i] as number) - x, (this.tauntY[i] as number) - y) : 0
			if (decoy && toDecoy > 0.8 && !(target && targetDistance < reach)) {
				wantX = ((this.tauntX[i] as number) - x) / toDecoy
				wantY = ((this.tauntY[i] as number) - y) / toDecoy
			} else if (target && (targetDistance < 3 || taunter === target)) {
				// close in directly once near
				wantX = (target.x - x) / targetDistance
				wantY = (target.y - y) / targetDistance
			} else {
				const dir = this.flow[Math.floor(y) * width + Math.floor(x)] as number
				if (dir >= 0) {
					const scale = dir >= 4 ? Math.SQRT1_2 : 1
					wantX = (DX[dir] as number) * scale
					wantY = (DY[dir] as number) * scale
				}
			}
			const slowed = (this.slowUntil[i] as number) > this.tick ? 1 - (this.slowAmount[i] as number) : 1
			const speed = stunned || (target && targetDistance < reach) ? 0 : def.speed * slowed
			let ax = wantX * speed
			let ay = wantY * speed

			// separation from neighbours in the 3x3 hash block
			const hx = Math.floor(x / HASH_CELL)
			const hy = Math.floor(y / HASH_CELL)
			for (let oy = -1; oy <= 1; oy++) {
				const yy = hy + oy
				if (yy < 0 || yy >= w) continue
				for (let ox = -1; ox <= 1; ox++) {
					const xx = hx + ox
					if (xx < 0 || xx >= w) continue
					const h = yy * w + xx
					const end = this.hashStart[h + 1] as number
					for (let k = this.hashStart[h] as number; k < end; k++) {
						const j = this.hashItems[k] as number
						if (j === i) continue
						const other = zombieDefs[this.type[j] as number] as ZombieDef
						const minimum = def.radius + other.radius
						const ddx = x - (this.x[j] as number)
						const ddy = y - (this.y[j] as number)
						const d2 = ddx * ddx + ddy * ddy
						if (d2 < minimum * minimum && d2 > 1e-9) {
							const d = Math.sqrt(d2)
							const push = ((minimum - d) / d) * 4
							ax += ddx * push
							ay += ddy * push
						}
					}
				}
			}

			const vx = (this.vx[i] as number) * 0.75 + ax * 0.25
			const vy = (this.vy[i] as number) * 0.75 + ay * 0.25
			this.vx[i] = vx
			this.vy[i] = vy
			this.grid.moveCircle(x, y, vx * DT, vy * DT, def.radius * 0.8, this.moved)
			this.x[i] = this.moved.x
			this.y[i] = this.moved.y

			// melee
			const cooldown = this.cooldown[i] as number
			if (cooldown > 0) this.cooldown[i] = cooldown - 1
			this.state[i] = ZombieState.moving
			if (stunned) continue
			if (target && Math.hypot(target.x - this.moved.x, target.y - this.moved.y) < reach) {
				this.state[i] = ZombieState.attacking
				if (this.cooldown[i] === 0) {
					this.hurt(target, def.meleeDamage, null)
					this.cooldown[i] = Math.round(def.meleeCooldownSeconds * TICK_RATE)
				}
			} else if (this.cooldown[i] === 0 && this.objects.length > 0) {
				this.attackBarricade(i, def)
			}
		}
	}

	/** A zombie next to a barricade claws at it; at zero health the barricade falls. */
	private attackBarricade(i: number, def: ZombieDef): void {
		const x = this.x[i] as number
		const y = this.y[i] as number
		const width = this.grid.width
		for (const object of this.objects) {
			if (object.kind !== ObjectKind.barricade) continue
			const near = object.cells.some(cell => {
				const cx = (cell % width) + 0.5
				const cy = Math.floor(cell / width) + 0.5
				return Math.hypot(cx - x, cy - y) < def.radius + 0.7 + def.meleeRange
			})
			if (!near) continue
			this.state[i] = ZombieState.attacking
			object.health -= def.meleeDamage
			this.cooldown[i] = Math.round(def.meleeCooldownSeconds * TICK_RATE)
			if (object.health <= 0) {
				this.events.push({ type: 'explode', id: 0, x: object.x, y: object.y, radius: 0 })
				this.removeObject(object)
			}
			return
		}
	}

	private recordHistory(): void {
		const slot = (this.tick % HISTORY_TICKS) * MAX_ZOMBIES
		this.historyX.set(this.x, slot)
		this.historyY.set(this.y, slot)
		this.historyAlive.set(this.alive, slot)
	}

	/** Facing angle of a zombie from its velocity. */
	facing(index: number): number {
		return Math.atan2(this.vy[index] as number, this.vx[index] as number)
	}

	/** A number that changes if anything in the simulation differs; for determinism tests. */
	checksum(): number {
		let sum = this.tick + this.kills * 7 + this.rng.state / 4294967296
		for (let i = 0; i < MAX_ZOMBIES; i++) {
			if (this.alive[i] === 1) sum += (this.x[i] as number) * 3 + (this.y[i] as number) * 5 + (this.health[i] as number)
		}
		for (const state of this.players.values()) sum += state.x + state.y + state.health
		return sum
	}
}
