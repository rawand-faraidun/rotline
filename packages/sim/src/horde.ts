import { type DamageType, player as playerDef, type ZombieDef, zombieIndex, zombies } from '@rotline/game-data'
import { DT, MAX_ZOMBIES, TICK_RATE } from './constants.ts'
import type { PlayerState } from './player.ts'
import type { World } from './world.ts'

/**
 * What a zombie with an attack of its own is doing. Ordinary zombies stay at `none` and simply walk
 * and claw; the others wind up (and say so on the ground), then spit, charge, slam or surface.
 */
export const ZombieAction = {
	none: 0,
	/** rearing back before it spits */
	spit: 1,
	/** head down, the lane it will run marked on the ground */
	chargeWindup: 2,
	charging: 3,
	/** ran into a wall: it stands there stunned, its guard down */
	dazed: 4,
	/** arm raised: the ring round it is about to come down */
	slam: 5,
	/** under the ground: nothing can touch it */
	under: 6,
	/** about to burst out of the ground where it stopped */
	erupt: 7
} as const

/** What `stepSpecial` tells the mover to do with the zombie this tick. */
export const Special = {
	/** walk and claw as usual */
	none: 0,
	/** stand where it is (no walking, no clawing) */
	hold: 1,
	/** it moved itself this tick (a charge) */
	self: 2,
	/** under the ground: it follows the flow at its burrowing speed, through the horde, and claws no one */
	under: 3
} as const

/** The warning a client draws before an attack lands, by kind. */
export const WarnKind = { spit: 1, charge: 2, slam: 3, erupt: 4, lob: 5 } as const
/** What a client draws when an attack lands. */
export const StrikeKind = { acid: 1, fire: 2, slam: 3, erupt: 4, crash: 5, dig: 6 } as const

/** Something thrown by a zombie, in the air until `tick`, landing on (x, y). */
export type Hazard = {
	tick: number
	x: number
	y: number
	radius: number
	damage: number
	type: DamageType
	pool: { damagePerSecond: number; radius: number; seconds: number } | null
}

const ticks = (seconds: number) => Math.max(1, Math.round(seconds * TICK_RATE))
/** a burrower held up this long under the ground surfaces where it is */
const STUCK_UNDER_TICKS = Math.round(1.5 * TICK_RATE)

/** Types that need `stepSpecial` at all (most of the horde does not). */
export const HAS_SPECIAL = zombies.map(
	def => !!(def.ranged || def.charge || def.slam || def.burrow || def.trail || def.shield || def.phases)
)
/** Types whose facing is kept by the simulation (shields, charges): drawn the way they guard. */
export const KEEPS_HEADING = zombies.map(def => !!(def.shield || def.charge))

/** The phase a boss is in, or null before its first. */
function phaseOf(world: World, i: number, def: ZombieDef): NonNullable<ZombieDef['phases']>[number] | null {
	const phase = world.phase[i] as number
	return phase > 0 ? (def.phases?.[phase - 1] ?? null) : null
}

/** Speed at this phase, times the zombie's own. */
export function phaseSpeed(world: World, i: number, def: ZombieDef): number {
	return phaseOf(world, i, def)?.speed ?? 1
}

const cooldown = (world: World, i: number, def: ZombieDef, seconds: number) =>
	ticks(seconds * (phaseOf(world, i, def)?.cooldowns ?? 1))

function angleDiff(a: number, b: number): number {
	let d = Math.abs(a - b) % (Math.PI * 2)
	if (d > Math.PI) d = Math.PI * 2 - d
	return d
}

/** Turns a guarded zombie's heading toward `angle`, no faster than its turn rate. */
function turnToward(world: World, i: number, def: ZombieDef, angle: number): void {
	const rate = ((def.shield?.turnDegreesPerSecond ?? 360) * Math.PI) / 180
	const current = world.heading[i] as number
	let delta = angle - current
	while (delta > Math.PI) delta -= Math.PI * 2
	while (delta < -Math.PI) delta += Math.PI * 2
	const step = rate * DT * phaseSpeed(world, i, def)
	world.heading[i] = current + Math.max(-step, Math.min(step, delta))
}

/** The share of a hit from (fromX, fromY) that a shield lets through. */
export function shieldShare(world: World, i: number, def: ZombieDef, type: DamageType, fromX: number, fromY: number) {
	const shield = def.shield
	if (!shield?.types.includes(type) || world.action[i] === ZombieAction.dazed) return 1
	const angle = Math.atan2(fromY - (world.y[i] as number), fromX - (world.x[i] as number))
	return angleDiff(angle, world.heading[i] as number) <= (shield.arcDegrees * Math.PI) / 360 ? 1 - shield.reduction : 1
}

/** A boss passed into its next phase as it was hurt: it says so, and its new tricks start soon. */
export function checkPhase(world: World, i: number, def: ZombieDef): void {
	const phases = def.phases
	if (!phases) return
	const share = (world.health[i] as number) / (world.maxHealth[i] as number)
	while ((world.phase[i] as number) < phases.length && share < (phases[world.phase[i] as number]?.below ?? 0)) {
		world.phase[i] = (world.phase[i] as number) + 1
		world.summonAt[i] = world.tick + ticks(2)
		world.lobAt[i] = world.tick + ticks(3)
		world.events.push({
			type: 'phase',
			zombie: i,
			zombieType: world.type[i] as number,
			phase: world.phase[i] as number
		})
	}
}

/** Players knocked back from (x, y) by `distance` metres, or sideways off a lane when `side` is set. */
function shove(world: World, state: PlayerState, fromX: number, fromY: number, distance: number): void {
	if (distance <= 0) return
	const dx = state.x - fromX
	const dy = state.y - fromY
	const d = Math.hypot(dx, dy) || 1
	const out = { x: 0, y: 0 }
	world.grid.moveCircle(state.x, state.y, (dx / d) * distance, (dy / d) * distance, playerDef.radius, out)
	state.x = out.x
	state.y = out.y
}

/** A blow over a circle: full damage in the middle, half at the edge, and a shove outwards. */
function strikePlayers(
	world: World,
	x: number,
	y: number,
	radius: number,
	damage: number,
	type: DamageType | null,
	push: number
) {
	for (const state of world.players.values()) {
		if (!state.alive || state.downed) continue
		const d = Math.hypot(state.x - x, state.y - y)
		if (d > radius + playerDef.radius) continue
		world.hurt(state, damage * world.damageScale * (1 - 0.5 * Math.min(1, d / radius)), type)
		shove(world, state, x, y, push)
	}
}

/** Throws something that lands on (tx, ty) after its flight; the ground there is marked meanwhile. */
export function throwAt(
	world: World,
	x: number,
	y: number,
	tx: number,
	ty: number,
	lob: NonNullable<ZombieDef['ranged']> | NonNullable<NonNullable<ZombieDef['phases']>[number]['lob']>
): void {
	world.hazards.push({
		tick: world.tick + ticks(lob.flightSeconds),
		x: tx,
		y: ty,
		radius: lob.radius,
		damage: lob.damage * world.damageScale,
		type: lob.type,
		pool: lob.pool ?? null
	})
	world.events.push({
		type: 'warn',
		kind: WarnKind.spit,
		x,
		y,
		tx,
		ty,
		radius: lob.radius,
		seconds: lob.flightSeconds
	})
}

/** Thrown things that land this tick: they hurt whoever is under them and may leave a pool. */
export function landHazards(world: World): void {
	for (let h = world.hazards.length - 1; h >= 0; h--) {
		// what lands can down the last player standing, and the wipe clears the air
		const hazard = world.hazards[h]
		if (!hazard || world.tick < hazard.tick) continue
		world.hazards.splice(h, 1)
		world.events.push({
			type: 'strike',
			kind: hazard.type === 'fire' ? StrikeKind.fire : StrikeKind.acid,
			x: hazard.x,
			y: hazard.y,
			radius: hazard.radius
		})
		// the pool first: if the blast downs the last player, the wipe clears it with the rest
		if (hazard.pool)
			world.addPool(
				hazard.x,
				hazard.y,
				hazard.pool.radius,
				hazard.pool.damagePerSecond * world.damageScale,
				hazard.pool.seconds,
				hazard.type
			)
		for (const state of world.players.values()) {
			if (!state.alive || state.downed) continue
			const d = Math.hypot(state.x - hazard.x, state.y - hazard.y)
			if (d <= hazard.radius + playerDef.radius)
				world.hurt(state, hazard.damage * (1 - 0.5 * Math.min(1, d / hazard.radius)), hazard.type)
		}
	}
}

/** Picks a type from weighted composition with the room's rng. */
function pick(world: World, composition: Record<string, number>): number {
	let total = 0
	for (const weight of Object.values(composition)) total += weight
	let roll = world.rng.next() * total
	for (const [id, weight] of Object.entries(composition)) {
		roll -= weight
		if (roll < 0) return zombieIndex(id)
	}
	return zombieIndex(Object.keys(composition)[0] as string)
}

/** A boss's phase tricks: calling others in, and lobbing at every player. */
function bossTricks(world: World, i: number, def: ZombieDef): void {
	const phase = phaseOf(world, i, def)
	if (!phase) return
	const tick = world.tick
	const x = world.x[i] as number
	const y = world.y[i] as number
	if (phase.summon && tick >= (world.summonAt[i] as number)) {
		world.summonAt[i] = tick + ticks(phase.summon.everySeconds)
		world.events.push({ type: 'scream', x, y })
		for (let n = 0; n < phase.summon.count && world.aliveCount < MAX_ZOMBIES - 8; n++)
			world.spawnZombie(pick(world, phase.summon.composition))
	}
	if (phase.lob && tick >= (world.lobAt[i] as number)) {
		world.lobAt[i] = tick + ticks(phase.lob.everySeconds)
		for (const state of world.players.values())
			if (state.alive && !state.downed) throwAt(world, x, y, state.x, state.y, phase.lob)
	}
}

/**
 * The attacks of zombies that have their own: spitting, shields, burrowing, charges, slams,
 * burning trails and a boss's phases. Runs before the zombie walks; what it returns (see `Special`)
 * tells the mover what is left to do this tick. `target` is the player it is after (if any).
 */
export function stepSpecial(
	world: World,
	i: number,
	def: ZombieDef,
	target: PlayerState | null,
	distance: number
): number {
	const tick = world.tick
	const x = world.x[i] as number
	const y = world.y[i] as number
	const stunned = (world.stunUntil[i] as number) > tick && !def.unstoppable
	bossTricks(world, i, def)
	if (def.trail && world.under[i] === 0 && tick >= (world.trailAt[i] as number)) {
		world.trailAt[i] = tick + ticks(def.trail.everySeconds)
		world.addPool(
			x,
			y,
			def.trail.radius,
			def.trail.damagePerSecond * world.damageScale,
			def.trail.seconds,
			def.trail.type
		)
	}
	// a guard turns (slowly) toward whoever it is after
	if (def.shield && target && world.action[i] === ZombieAction.none)
		turnToward(world, i, def, Math.atan2(target.y - y, target.x - x))

	switch (world.action[i]) {
		case ZombieAction.spit: {
			const ranged = def.ranged
			if (!ranged || stunned || !target) return cancel(world, i, def)
			if (tick < (world.actionUntil[i] as number)) return Special.hold
			world.action[i] = ZombieAction.none
			world.specialAt[i] = tick + cooldown(world, i, def, ranged.cooldownSeconds)
			if (distance <= ranged.range * 1.2) throwAt(world, x, y, target.x, target.y, ranged)
			return Special.hold
		}
		case ZombieAction.chargeWindup:
			if (stunned) return cancel(world, i, def)
			if (tick >= (world.actionUntil[i] as number)) {
				world.action[i] = ZombieAction.charging
				world.charged[i] = 0
				// long enough to run the lane at full speed, and a little over
				const lane = Math.hypot((world.actionX[i] as number) - x, (world.actionY[i] as number) - y)
				world.actionUntil[i] = tick + ticks(lane / ((def.charge?.speed ?? 1) * phaseSpeed(world, i, def)) + 0.5)
			}
			return Special.hold
		case ZombieAction.charging:
			return runCharge(world, i, def)
		case ZombieAction.dazed:
			if (tick >= (world.actionUntil[i] as number)) world.action[i] = ZombieAction.none
			return Special.hold
		case ZombieAction.slam: {
			const slam = def.slam
			if (!slam) return cancel(world, i, def)
			if (tick < (world.actionUntil[i] as number)) return Special.hold
			world.action[i] = ZombieAction.none
			world.slamAt[i] = tick + cooldown(world, i, def, slam.cooldownSeconds)
			world.events.push({ type: 'strike', kind: StrikeKind.slam, x, y, radius: slam.radius })
			strikePlayers(world, x, y, slam.radius, slam.damage, null, 1.4)
			return Special.hold
		}
		case ZombieAction.under: {
			const burrow = def.burrow
			if (!burrow) return cancel(world, i, def)
			// it comes up under its target, or where it can get no further (a door, a barricade: it
			// claws nothing while it is under the ground)
			const stuck = (world.stuckTicks[i] as number) > STUCK_UNDER_TICKS
			if ((target && distance <= burrow.surfaceRange + playerDef.radius) || stuck) {
				world.stuckTicks[i] = 0
				world.action[i] = ZombieAction.erupt
				world.actionUntil[i] = tick + ticks(burrow.eruptSeconds)
				world.events.push({
					type: 'warn',
					kind: WarnKind.erupt,
					x,
					y,
					tx: x,
					ty: y,
					radius: burrow.radius,
					seconds: burrow.eruptSeconds
				})
				return Special.hold
			}
			return Special.under
		}
		case ZombieAction.erupt: {
			const burrow = def.burrow
			if (!burrow) return cancel(world, i, def)
			if (tick < (world.actionUntil[i] as number)) return Special.hold
			world.action[i] = ZombieAction.none
			world.under[i] = 0
			world.specialAt[i] = tick + ticks(burrow.aboveSeconds)
			world.events.push({ type: 'strike', kind: StrikeKind.erupt, x, y, radius: burrow.radius })
			strikePlayers(world, x, y, burrow.radius, burrow.damage, null, 1.2)
			return Special.hold
		}
	}

	// nothing under way: start something?
	if (stunned || !target) return Special.none
	if (def.burrow && tick >= (world.specialAt[i] as number) && distance > def.burrow.fromRange) {
		world.action[i] = ZombieAction.under
		world.under[i] = 1
		world.events.push({ type: 'strike', kind: StrikeKind.dig, x, y, radius: def.radius * 2 })
		return Special.under
	}
	if (def.slam && distance <= def.slam.range && tick >= (world.slamAt[i] as number)) {
		world.action[i] = ZombieAction.slam
		world.actionUntil[i] = tick + ticks(def.slam.windupSeconds)
		world.events.push({
			type: 'warn',
			kind: WarnKind.slam,
			x,
			y,
			tx: x,
			ty: y,
			radius: def.slam.radius,
			seconds: def.slam.windupSeconds
		})
		return Special.hold
	}
	const charge = def.charge
	if (
		charge &&
		tick >= (world.specialAt[i] as number) &&
		distance >= charge.minRange &&
		distance <= charge.maxRange &&
		world.clearLine(x, y, target.x, target.y, distance)
	) {
		const angle = Math.atan2(target.y - y, target.x - x)
		const dirX = Math.cos(angle)
		const dirY = Math.sin(angle)
		// it runs through where they stand and on; a wall in the way ends the run
		const lane = Math.min(
			distance + charge.overshoot,
			world.grid.rayToWall(x, y, dirX, dirY, distance + charge.overshoot)
		)
		world.action[i] = ZombieAction.chargeWindup
		world.actionUntil[i] = tick + ticks(charge.windupSeconds)
		world.actionX[i] = x + dirX * lane
		world.actionY[i] = y + dirY * lane
		world.heading[i] = angle
		world.events.push({
			type: 'warn',
			kind: WarnKind.charge,
			x,
			y,
			tx: x + dirX * lane,
			ty: y + dirY * lane,
			radius: def.radius + playerDef.radius,
			seconds: charge.windupSeconds
		})
		return Special.hold
	}
	const ranged = def.ranged
	if (ranged && distance <= ranged.range && world.clearLine(x, y, target.x, target.y, distance)) {
		if (tick >= (world.specialAt[i] as number)) {
			world.action[i] = ZombieAction.spit
			world.actionUntil[i] = tick + ticks(ranged.windupSeconds)
			return Special.hold
		}
		// in sight and near enough: it stands its ground and waits to spit again
		if (distance <= ranged.holdRange) return Special.hold
	}
	return Special.none
}

/** Something broke a wind-up (a stun): it starts over later. */
function cancel(world: World, i: number, def: ZombieDef): number {
	const wasUnder = world.under[i] === 1
	world.action[i] = wasUnder ? ZombieAction.under : ZombieAction.none
	const again = def.charge?.cooldownSeconds ?? def.ranged?.cooldownSeconds ?? 2
	world.specialAt[i] = world.tick + cooldown(world, i, def, again / 2)
	return wasUnder ? Special.under : Special.hold
}

/** A charging zombie runs its lane, throwing aside whoever it meets; a wall stops it, dazed. */
function runCharge(world: World, i: number, def: ZombieDef): number {
	const charge = def.charge
	if (!charge) return cancel(world, i, def)
	const x = world.x[i] as number
	const y = world.y[i] as number
	const ex = world.actionX[i] as number
	const ey = world.actionY[i] as number
	const left = Math.hypot(ex - x, ey - y)
	const speed = charge.speed * phaseSpeed(world, i, def)
	const step = Math.min(left, speed * DT)
	const dirX = left > 1e-6 ? (ex - x) / left : Math.cos(world.heading[i] as number)
	const dirY = left > 1e-6 ? (ey - y) / left : Math.sin(world.heading[i] as number)
	const out = { x: 0, y: 0 }
	world.grid.moveCircle(x, y, dirX * step, dirY * step, def.radius * 0.8, out)
	world.x[i] = out.x
	world.y[i] = out.y
	world.vx[i] = dirX * speed
	world.vy[i] = dirY * speed
	const moved = Math.hypot(out.x - x, out.y - y)
	// whoever is in its way is hit once and thrown off the lane
	for (const state of world.players.values()) {
		const bit = 1 << (state.id & 7)
		if (!state.alive || state.downed || ((world.charged[i] as number) & bit) !== 0) continue
		if (Math.hypot(state.x - out.x, state.y - out.y) > def.radius + playerDef.radius + 0.25) continue
		world.charged[i] = (world.charged[i] as number) | bit
		world.hurt(state, charge.damage * world.damageScale, null)
		// aside, to whichever side of the lane they stood
		const side = (state.x - out.x) * -dirY + (state.y - out.y) * dirX >= 0 ? 1 : -1
		shove(world, state, out.x + dirY * side, out.y - dirX * side, charge.knockback)
	}
	const blocked = step > 0.02 && moved < step * 0.5
	if (blocked) {
		world.action[i] = ZombieAction.dazed
		world.actionUntil[i] = world.tick + ticks(charge.stunSeconds)
		world.specialAt[i] = world.tick + cooldown(world, i, def, charge.cooldownSeconds)
		world.events.push({ type: 'strike', kind: StrikeKind.crash, x: out.x, y: out.y, radius: def.radius * 2 })
		return Special.self
	}
	if (left - moved < 0.05 || world.tick >= (world.actionUntil[i] as number)) {
		world.action[i] = ZombieAction.none
		world.specialAt[i] = world.tick + cooldown(world, i, def, charge.cooldownSeconds)
	}
	return Special.self
}
