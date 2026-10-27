import {
	buffs,
	type DifficultyDef,
	type DifficultyId,
	difficulties,
	difficultyDef,
	economy,
	items,
	type MissionDef,
	type ObjectiveDef,
	pathLength,
	propsDef,
	zombieIndex,
	zombies
} from '@rotline/game-data'
import { DT, MAX_ZOMBIES, TICK_RATE } from './constants.ts'
import { type PlayerState, refillUtilities } from './player.ts'
import { letGo, resetProp } from './prop-step.ts'
import { type Prop, PropState, setPropState } from './props.ts'
import { ObjectKind, type World } from './world.ts'

export type MissionSetup = { mission: MissionDef; difficulty: DifficultyId }

/** `failed`: the mission's clock ran out before the last step was done */
export const MissionStatus = { none: 0, active: 1, complete: 2, failed: 3 } as const

/** Where a mission stands: which objective, how far along, where the last checkpoint is. */
export type MissionState = {
	def: MissionDef
	difficulty: DifficultyDef
	/** current objective */
	index: number
	/** kills, or ticks spent in the area / survived */
	progress: number
	status: number
	startTick: number
	completedTick: number
	/** objective to restart from after a wipe, and where players come back */
	checkpointIndex: number
	checkpointX: number
	checkpointY: number
	/** downs across the squad (for mastery) */
	downs: number
	/** objectives up to here have paid out: one redone after a wipe pays nothing again */
	rewardedThrough: number
	/** kills since the mission started (optional kill objectives) */
	kills: number
	/** optional objectives done */
	optionalDone: number[]
	/** the objective `World.targetProps` was worked out for */
	targetsFor: number
	spawnAccumulator: number
	/** the objective whose start (radio, ambush, boss) has run; -1 makes the current one run again */
	startedFor: number
	/** zombies of the current ambush still to come in, and the types they are picked from */
	burst: number
	burstPool: { type: number; upTo: number }[]
	burstTotal: number
	/** composition as cumulative weights, for weighted picks */
	pool: { type: number; upTo: number }[]
	poolTotal: number
	/** gather: bit n set once item n has been picked up */
	picked: number
	/** capture: ticks of holding in each area (they fill to the objective's seconds) */
	areaTicks: number[]
	/** the tick the current objective started (or restarted): an escape's hazard moves from it */
	objectiveTick: number
	/** search: bit n set when spot n holds what is wanted, and once it has been found there */
	hits: number
	found: number
	/** hunt: marked zombies killed */
	huntKilled: number
	/** repair: bit n set once prop n is back to full health */
	repaired: number
	/** nests (by prop index) that have burst since they were last whole */
	spilled: Set<number>
	/** the tick a step's boss is due (0 when it has come or there is none) */
	bossTick: number
}

/** A player counts as playing (for objective score and drops) if they acted this recently. */
const ACTIVE_TICKS = Math.round(economy.rewards.activeSeconds * TICK_RATE)

/** Moved, aimed or fired recently: idle and disconnected players do not share in objectives or drops. */
export function isActive(world: World, state: PlayerState): boolean {
	return world.tick - state.lastActiveTick <= ACTIVE_TICKS
}

/** The kill chain's score multiplier (×1 to ×6). */
export function chainMultiplier(chain: number): number {
	let multiplier = 1
	for (const step of economy.score.multiplierSteps) if (chain >= step.chain) multiplier = step.multiplier
	return multiplier
}

/** The score at which threshold `index` (0-based) is reached: the listed ones, then every step. */
export function scoreThreshold(index: number): number {
	const list = economy.score.thresholds
	if (index < list.length) return list[index] as number
	return (list[list.length - 1] as number) + economy.score.thresholdStep * (index - list.length + 1)
}

export function createMission(setup: MissionSetup, startTick: number, spawnX: number, spawnY: number): MissionState {
	let total = 0
	const pool = Object.entries(setup.mission.spawn.composition).map(([id, weight]) => {
		total += weight
		return { type: zombieIndex(id), upTo: total }
	})
	return {
		def: setup.mission,
		difficulty: difficultyDef(setup.difficulty),
		index: nextStep(setup.mission, 0),
		progress: 0,
		status: MissionStatus.active,
		startTick,
		completedTick: 0,
		checkpointIndex: 0,
		checkpointX: spawnX,
		checkpointY: spawnY,
		downs: 0,
		rewardedThrough: 0,
		kills: 0,
		optionalDone: [],
		targetsFor: -1,
		spawnAccumulator: 0,
		startedFor: -1,
		burst: 0,
		burstPool: [],
		burstTotal: 0,
		pool,
		poolTotal: total,
		picked: 0,
		areaTicks: [],
		objectiveTick: startTick,
		hits: 0,
		found: 0,
		huntKilled: 0,
		repaired: 0,
		spilled: new Set(),
		bossTick: 0
	}
}

/** The first objective from `from` on that is a step (not optional); past the end when none is left. */
export function nextStep(def: MissionDef, from: number): number {
	let index = from
	while (index < def.objectives.length && def.objectives[index]?.optional) index++
	return index
}

export function currentObjective(mission: MissionState): ObjectiveDef | null {
	return mission.def.objectives[mission.index] ?? null
}

/** What finishing the current objective takes, in the units `progress` counts. */
export function objectiveGoal(objective: ObjectiveDef | null): number {
	if (!objective) return 0
	switch (objective.type) {
		case 'kill':
			return objective.count
		case 'reach':
			return 1
		case 'hold':
		case 'survive':
		case 'defend':
		case 'extract':
			return Math.round(objective.seconds * TICK_RATE)
		case 'interact':
		case 'destroy':
			return objective.props.length
		case 'rescue':
			return objective.survivors.length
		case 'retrieve':
			return 1
		case 'gather':
			return objective.count ?? objective.items.length
		case 'capture':
			return objective.areas.length * Math.round(objective.seconds * TICK_RATE)
		case 'escort':
			// metres along the path
			return Math.round(pathLength(objective.path))
		case 'escape':
			return 1
		case 'search':
			return objective.count ?? 1
		case 'hunt':
			return objective.targets.length
		case 'demolish':
			// planted, then the fuse burning down
			return 1 + Math.round(objective.seconds * TICK_RATE)
		case 'repair':
			return objective.props.length
		case 'deliver':
			return objective.items.length
	}
}

/** Kinds of prop that only exist for a step that uses them; a mission's others are hidden. */
const STEP_PROPS = new Set(['carry', 'survivor', 'vehicle', 'search', 'charge'])

/** The props each objective works with, by id. */
export function objectiveProps(objective: ObjectiveDef): readonly string[] {
	switch (objective.type) {
		case 'interact':
		case 'destroy':
		case 'search':
		case 'repair':
			return objective.props
		case 'defend':
		case 'escort':
		case 'demolish':
			return [objective.prop]
		case 'rescue':
			return objective.survivors
		case 'retrieve':
			return [objective.item]
		case 'deliver':
			return objective.items
		default:
			return []
	}
}

/**
 * Carried objects, survivors, vehicles, search spots and charges no step of this mission uses are
 * not there (a map serves several missions): hidden for good, and nothing works them.
 */
export function hideUnusedProps(props: readonly Prop[], def: MissionDef): void {
	const used = new Set(def.objectives.flatMap(objective => objectiveProps(objective)))
	for (const prop of props) {
		if (!STEP_PROPS.has(prop.def.kind) || used.has(prop.def.id)) continue
		prop.state = PropState.hidden
		prop.home.state = PropState.hidden
	}
}

/** Health and damage multipliers for zombies in this mission (difficulty and enemy level). */
export function enemyScale(mission: MissionState): { health: number; damage: number } {
	const levels = mission.def.enemyLevel - 1
	return {
		health: mission.difficulty.enemyHealth * (1 + difficulties.enemyLevel.health * levels),
		damage: mission.difficulty.enemyDamage * (1 + difficulties.enemyLevel.damage * levels)
	}
}

/** Someone standing and playing is in the area (an idle or disconnected character does not hold it). */
function anyoneIn(world: World, area: { x: number; y: number; radius: number }): boolean {
	for (const state of world.players.values()) {
		if (!state.alive || state.downed || !isActive(world, state)) continue
		if (Math.hypot(state.x - area.x, state.y - area.y) <= area.radius) return true
	}
	return false
}

function standing(world: World): boolean {
	for (const state of world.players.values()) if (state.alive && !state.downed) return true
	return false
}

/**
 * What zombies go for and what may be worked follow the current objective; worked out again when it
 * changes. Runs before players act each tick.
 */
export function updateTargets(world: World): void {
	const mission = world.mission
	if (!mission) return
	const objective = currentObjective(mission)
	if (!objective) return
	if (mission.targetsFor !== mission.index) {
		mission.targetsFor = mission.index
		// what the dead go for: survivors, what is defended or repaired, a vehicle, an armed charge
		const ids =
			objective.type === 'rescue'
				? objective.survivors
				: objective.type === 'defend' || objective.type === 'escort' || objective.type === 'demolish'
					? [objective.prop]
					: objective.type === 'interact' || objective.type === 'repair'
						? objective.props
						: []
		world.targetProps = ids.flatMap(id => world.propById.get(id) ?? [])
		// what may be worked now: this objective's props and any optional objective's
		const workable = new Set<Prop>(world.targetProps)
		for (const id of objectiveProps(objective)) {
			const prop = world.propById.get(id)
			if (prop) workable.add(prop)
		}
		for (const other of mission.def.objectives) {
			if (!other.optional || other.type !== 'interact') continue
			for (const id of other.props) {
				const prop = world.propById.get(id)
				if (prop) workable.add(prop)
			}
		}
		world.workableProps = workable
		// a defend target starts its defence whole
		if (objective.type === 'defend') {
			const prop = world.propById.get(objective.prop)
			if (prop && prop.state !== PropState.destroyed) prop.health = prop.maxHealth
		}
	}
}

/** Whole seconds left on a timed mission's clock, or null when the mission has no time limit. */
export function timeLeft(world: World, mission: MissionState): number | null {
	const limit = mission.def.timeLimitSeconds
	if (!limit) return null
	return Math.max(0, Math.ceil(limit - (world.tick - mission.startTick) / TICK_RATE))
}

/** The mission is lost (the clock ran out, or a player alone used their last life); what was earned is kept. */
export function failMission(world: World, mission: MissionState, reason: 'time' | 'lives' | 'wiped' = 'time'): void {
	mission.status = MissionStatus.failed
	jam(world, false)
	mission.completedTick = world.tick
	world.events.push({ type: 'mission-failed', reason })
	world.finish()
}

/** Spawns, objective progress and checkpoints; called once a tick while a mission runs. */
export function stepMission(world: World): void {
	const mission = world.mission
	if (!mission || mission.status !== MissionStatus.active) return
	// a timed mission whose clock runs out is lost (what was earned on the way is kept)
	if (timeLeft(world, mission) === 0) {
		failMission(world, mission)
		return
	}
	const objective = currentObjective(mission)
	if (!objective) return
	jam(world, objective.jammed === true)
	if (objective.boss && mission.startedFor === mission.index && mission.bossTick > 0 && world.tick >= mission.bossTick)
		spawnBoss(world, mission, objective.boss)

	// the spawn director: a steady stream, scaled by the objective, difficulty and squad size
	const squad = Math.max(1, Math.min(4, world.players.size))
	const squadScale = difficulties.squadEnemyCount[squad - 1] ?? 1
	const count = mission.difficulty.enemyCount * squadScale
	world.spawnSections = objective.sections ?? null
	if (mission.startedFor !== mission.index) startObjective(world, mission, objective, count)
	// an ambush pours in a few a tick, past the stream's cap (never past the engine's)
	for (let n = 0; n < 3 && mission.burst > 0 && world.aliveCount < MAX_ZOMBIES - 8; n++) {
		const roll = world.rng.next() * mission.burstTotal
		const pick = mission.burstPool.find(entry => roll < entry.upTo) ?? mission.burstPool[0]
		// no clear spawn point this tick: the rest of the ambush waits
		if (!pick || world.spawnZombie(pick.type) < 0) break
		mission.burst--
	}
	const maxAlive = Math.min(difficulties.maxAlive, Math.round(mission.def.spawn.maxAlive * count))
	// nothing spawns while the whole squad is down: they come back to the checkpoint, not into a horde
	if (standing(world)) {
		mission.spawnAccumulator += mission.def.spawn.perSecond * (objective.spawnScale ?? 1) * count * DT
		while (mission.spawnAccumulator >= 1 && world.aliveCount < maxAlive) {
			mission.spawnAccumulator -= 1
			const roll = world.rng.next() * mission.poolTotal
			const pick = mission.pool.find(entry => roll < entry.upTo) ?? mission.pool[0]
			if (pick && world.spawnZombie(pick.type) < 0) {
				mission.spawnAccumulator += 1
				break
			}
		}
		if (world.aliveCount >= maxAlive) mission.spawnAccumulator = Math.min(mission.spawnAccumulator, 1)
	}

	// nests that burst as they die: the current step's and the optional ones'
	for (const [index, other] of mission.def.objectives.entries()) {
		if (other.type === 'destroy' && other.burst && (other.optional || index === mission.index))
			burstNests(world, mission, other.props, other.burst)
	}

	switch (objective.type) {
		case 'reach':
			if (anyoneIn(world, objective.area)) mission.progress = 1
			break
		case 'hold':
			// the timer runs only while someone stands in the area
			if (anyoneIn(world, objective.area)) mission.progress++
			break
		case 'survive':
			// the clock stops while the whole squad is down (a wipe restarts it anyway)
			if (standing(world)) mission.progress++
			break
		case 'kill':
			// counted as kills happen
			break
		case 'interact':
			mission.progress = countDone(world, objective.props)
			break
		case 'defend':
			// losing the target fails the objective (World.propLost)
			if (standing(world)) mission.progress++
			break
		case 'rescue':
			mission.progress = deliverSurvivors(world, objective.survivors, objective.area)
			break
		case 'retrieve':
			mission.progress = deliverItem(world, objective.item, objective.area) ? 1 : 0
			break
		case 'gather':
			mission.progress = gather(world, mission, objective.items)
			break
		case 'capture':
			mission.progress = capture(world, mission, objective.areas, Math.round(objective.seconds * TICK_RATE))
			break
		case 'escort':
			mission.progress = escort(world, objective)
			break
		case 'escape':
			burnBehind(world, mission, objective.hazard)
			if (everyoneIn(world, objective.area)) mission.progress = 1
			break
		case 'search':
			mission.progress = search(world, mission, objective.props)
			break
		case 'hunt':
			mission.progress = mission.huntKilled
			break
		case 'demolish':
			mission.progress = demolish(world, objective)
			break
		case 'repair':
			mission.progress = repair(world, mission, objective.props)
			break
		case 'deliver':
			mission.progress = objective.items.filter(id => deliverItem(world, id, objective.area)).length
			break
		case 'destroy':
			mission.progress = countDestroyed(world, objective.props)
			break
		case 'extract':
			if (standing(world)) mission.progress++
			stepOptional(world, mission)
			if (everyoneIn(world, objective.area)) {
				completeObjective(world, mission, objective)
				return
			}
			if (mission.progress >= objectiveGoal(objective)) world.timeUp()
			return
	}
	// optional objectives first, so one done on the final tick still counts
	stepOptional(world, mission)
	if (mission.progress >= objectiveGoal(objective)) completeObjective(world, mission, objective)
}

/**
 * What happens the moment an objective starts (and again when it is restarted after a wipe): its
 * ambush is queued and its boss turns up. The radio line is the client's to show.
 */
function startObjective(world: World, mission: MissionState, objective: ObjectiveDef, count: number): void {
	mission.startedFor = mission.index
	mission.burst = 0
	mission.picked = 0
	mission.areaTicks = objective.type === 'capture' ? objective.areas.map(() => 0) : []
	mission.objectiveTick = world.tick
	mission.found = 0
	mission.hits = 0
	mission.huntKilled = 0
	mission.repaired = 0
	if (objective.type === 'search') {
		// which spots hold it: picked now, so nobody can know before the step (and anew after a wipe)
		const order = objective.props.map((_, index) => index)
		for (let i = order.length - 1; i > 0; i--) {
			const j = world.rng.int(i + 1)
			;[order[i], order[j]] = [order[j] as number, order[i] as number]
		}
		for (const index of order.slice(0, objective.count ?? 1)) mission.hits |= 1 << index
	}
	if (objective.type === 'hunt') {
		for (let i = 0; i < MAX_ZOMBIES; i++) world.hunted[i] = 0
		for (const target of objective.targets) {
			// where the mission puts it, unless someone stands right there: then it walks in from out of sight
			const clear = world.nearestPlayerDistance(target.at.x, target.at.y) > 10
			const type = zombieIndex(target.type)
			let index = world.spawnZombie(type, clear ? target.at : (world.pickSpawnPoint() ?? target.at))
			if (index < 0) index = world.spawnZombie(type, target.at)
			if (index < 0) continue
			world.hunted[index] = 1
			world.health[index] = (world.health[index] as number) * (target.health ?? 1)
			world.maxHealth[index] = world.health[index] as number
		}
	}
	if (objective.type === 'repair') {
		for (const id of objective.props) {
			const prop = world.propById.get(id)
			if (prop && prop.state !== PropState.destroyed) prop.health = prop.maxHealth * objective.from
		}
	}
	if (objective.ambush) {
		let total = 0
		const composition = objective.ambush.composition ?? mission.def.spawn.composition
		mission.burstPool = Object.entries(composition).map(([id, weight]) => {
			total += weight
			return { type: zombieIndex(id), upTo: total }
		})
		mission.burstTotal = total
		mission.burst = Math.max(1, Math.round(objective.ambush.count * count))
	}
	// the boss now, or a while into the step
	mission.bossTick = objective.boss ? world.tick + Math.round((objective.boss.afterSeconds ?? 0) * TICK_RATE) : 0
	if (objective.boss && mission.bossTick === world.tick) spawnBoss(world, mission, objective.boss)
}

/** The boss's own place, unless someone stands near it: then it walks in from out of sight. */
function spawnBoss(world: World, mission: MissionState, boss: NonNullable<ObjectiveDef['boss']>): void {
	mission.bossTick = 0
	const at = boss.at
	const clear = at && world.nearestPlayerDistance(at.x, at.y) > 12
	const type = zombieIndex(boss.type)
	if (world.spawnZombie(type, clear ? at : (world.pickSpawnPoint() ?? at)) < 0) world.spawnZombie(type, at)
}

/** A step jams the squad's kit, or lets it go. */
function jam(world: World, jammed: boolean): void {
	for (const state of world.players.values()) state.jammed = jammed
}

const bits = (value: number): number => {
	let count = 0
	for (let rest = value; rest; rest &= rest - 1) count++
	return count
}

/** Searched spots that held it are found (and shown as found). Returns how many are. */
function search(world: World, mission: MissionState, ids: readonly string[]): number {
	for (const [index, id] of ids.entries()) {
		const bit = 1 << index
		const prop = world.propById.get(id)
		if (!prop || prop.state !== PropState.done || mission.found & bit || !(mission.hits & bit)) continue
		mission.found |= bit
		prop.state = PropState.delivered
		world.events.push({ type: 'prop', index: prop.index, state: prop.state })
	}
	return bits(mission.found)
}

/**
 * A planted charge burns its fuse while the dead try to tear it off; then it goes up, killing what is
 * near, hurting anyone still inside, and taking the props it was set against with it.
 */
function demolish(world: World, objective: Extract<ObjectiveDef, { type: 'demolish' }>): number {
	const charge = world.propById.get(objective.prop)
	if (!charge) return 0
	const fuse = Math.round(objective.seconds * TICK_RATE)
	if (charge.state === PropState.done) return 1 + fuse
	if (charge.state !== PropState.active) return 0
	if (charge.untilTick === 0) charge.untilTick = world.tick + fuse
	if (world.tick < charge.untilTick) return 1 + fuse - (charge.untilTick - world.tick)
	charge.state = PropState.done
	world.events.push({ type: 'prop', index: charge.index, state: charge.state })
	world.blast(charge.x, charge.y, objective.radius, propsDef.charge.blastDamage, 'explosive', 0, {
		playerDamage: propsDef.charge.playerDamage
	})
	for (const id of objective.destroys ?? []) {
		const prop = world.propById.get(id)
		if (!prop || prop.state === PropState.destroyed) continue
		prop.health = 0
		setPropState(world.grid, prop, PropState.destroyed)
		world.events.push({ type: 'prop', index: prop.index, state: prop.state })
	}
	world.propsChanged = true
	return 1 + fuse
}

/** Props brought back to full health stay mended (and the dead lose interest). Returns how many are. */
function repair(world: World, mission: MissionState, ids: readonly string[]): number {
	for (const [index, id] of ids.entries()) {
		const bit = 1 << index
		const prop = world.propById.get(id)
		if (!prop || mission.repaired & bit || prop.health < prop.maxHealth - 1e-6) continue
		mission.repaired |= bit
		world.targetProps = world.targetProps.filter(other => other !== prop)
		world.events.push({ type: 'prop', index: prop.index, state: prop.state })
	}
	return bits(mission.repaired)
}

/** Nests torn open spill what was growing in them. */
function burstNests(world: World, mission: MissionState, ids: readonly string[], count: number): void {
	const crawler = zombieIndex('crawler')
	for (const id of ids) {
		const prop = world.propById.get(id)
		if (!prop) continue
		// a nest put back (a restart from a checkpoint) can burst again
		if (prop.state !== PropState.destroyed) {
			mission.spilled.delete(prop.index)
			continue
		}
		if (mission.spilled.has(prop.index)) continue
		mission.spilled.add(prop.index)
		for (let n = 0; n < count; n++) {
			const angle = (n / count) * Math.PI * 2
			const at = world.freeSpotNear(prop.x + Math.cos(angle) * 1.4, prop.y + Math.sin(angle) * 1.4, 0.4)
			world.spawnZombie(crawler, at)
		}
	}
}

/** Items lying where a standing player walks over them are picked up. Returns how many are. */
function gather(world: World, mission: MissionState, items: readonly { x: number; y: number }[]): number {
	for (const state of world.players.values()) {
		if (!state.alive || state.downed) continue
		for (const [index, item] of items.entries()) {
			if (mission.picked & (1 << index)) continue
			if (Math.hypot(state.x - item.x, state.y - item.y) > GATHER_REACH) continue
			mission.picked |= 1 << index
		}
	}
	return bits(mission.picked)
}

/**
 * Each area fills while a standing player is in it and drains (more slowly) while zombies hold it
 * and nobody does. Returns the ticks held across the areas.
 */
function capture(
	world: World,
	mission: MissionState,
	areas: readonly { x: number; y: number; radius: number }[],
	full: number
): number {
	let total = 0
	for (const [index, area] of areas.entries()) {
		let held = mission.areaTicks[index] ?? 0
		if (held < full) {
			if (anyoneIn(world, area)) held++
			else if (zombieIn(world, area)) held = Math.max(0, held - 0.5)
		}
		mission.areaTicks[index] = held
		total += Math.floor(held)
	}
	return total
}

function zombieIn(world: World, area: { x: number; y: number; radius: number }): boolean {
	for (let i = 0; i < MAX_ZOMBIES; i++) {
		if (!world.alive[i]) continue
		if (Math.hypot((world.x[i] as number) - area.x, (world.y[i] as number) - area.y) <= area.radius) return true
	}
	return false
}

/**
 * The vehicle drives along its path while a standing player is near it, at half speed with the dead
 * clawing at it. Its `progress` is the metres travelled; returns them.
 */
function escort(world: World, objective: Extract<ObjectiveDef, { type: 'escort' }>): number {
	const prop = world.propById.get(objective.prop)
	if (!prop || prop.state === PropState.destroyed) return 0
	let near = false
	for (const state of world.players.values()) {
		if (!state.alive || state.downed || !isActive(world, state)) continue
		if (Math.hypot(state.x - prop.x, state.y - prop.y) <= objective.radius) near = true
	}
	if (near) {
		let crowded = false
		for (let i = 0; i < MAX_ZOMBIES && !crowded; i++) {
			if (world.alive[i] && Math.hypot((world.x[i] as number) - prop.x, (world.y[i] as number) - prop.y) < 1.8)
				crowded = true
		}
		prop.progress += objective.speed * DT * (crowded ? (objective.stops ? 0 : 0.5) : 1)
	}
	// where that is along the path
	let left = prop.progress
	for (let i = 1; i < objective.path.length; i++) {
		const a = objective.path[i - 1] as { x: number; y: number }
		const b = objective.path[i] as { x: number; y: number }
		const leg = Math.hypot(b.x - a.x, b.y - a.y)
		if (left <= leg || i === objective.path.length - 1) {
			const t = leg > 0 ? Math.min(1, left / leg) : 1
			prop.x = a.x + (b.x - a.x) * t
			prop.y = a.y + (b.y - a.y) * t
			break
		}
		left -= leg
	}
	return Math.floor(prop.progress)
}

/**
 * The hazard's front: it waits `delaySeconds`, then sweeps from `from` toward `toward` (and on past
 * it). Anyone on the far side of the front from the way it moves (caught behind it) takes damage.
 */
export function hazardFront(
	hazard: Extract<ObjectiveDef, { type: 'escape' }>['hazard'],
	secondsSinceStart: number
): { x: number; y: number; dx: number; dy: number } {
	const length = Math.hypot(hazard.toward.x - hazard.from.x, hazard.toward.y - hazard.from.y) || 1
	const dx = (hazard.toward.x - hazard.from.x) / length
	const dy = (hazard.toward.y - hazard.from.y) / length
	const moved = Math.max(0, secondsSinceStart - hazard.delaySeconds) * hazard.speed
	return { x: hazard.from.x + dx * moved, y: hazard.from.y + dy * moved, dx, dy }
}

function burnBehind(
	world: World,
	mission: MissionState,
	hazard: Extract<ObjectiveDef, { type: 'escape' }>['hazard']
): void {
	const front = hazardFront(hazard, (world.tick - mission.objectiveTick) / TICK_RATE)
	for (const state of world.players.values()) {
		if (!state.alive || state.downed) continue
		// behind the front: on the side it came from
		if ((state.x - front.x) * front.dx + (state.y - front.y) * front.dy < 0)
			world.hurt(state, hazard.damagePerSecond * DT, hazard.kind === 'fire' ? 'fire' : 'chemical')
	}
	// the dead caught in it burn too
	for (let i = 0; i < MAX_ZOMBIES; i++) {
		if (!world.alive[i]) continue
		if (((world.x[i] as number) - front.x) * front.dx + ((world.y[i] as number) - front.y) * front.dy < -1)
			world.damageZombie(i, hazard.damagePerSecond * 2 * DT, 0, hazard.kind === 'fire' ? 'fire' : 'chemical')
	}
}

/** Nests among `ids` that have been destroyed. */
function countDestroyed(world: World, ids: readonly string[]): number {
	let done = 0
	for (const id of ids) if (world.propById.get(id)?.state === PropState.destroyed) done++
	return done
}

/** Generators or terminals among `ids` that have been worked. */
function countDone(world: World, ids: readonly string[]): number {
	let done = 0
	for (const id of ids) if (world.propById.get(id)?.state === PropState.done) done++
	return done
}

/**
 * Survivors who walked into the area are safe. Returns how far the rescue has got: every survivor
 * either safe or lost counts, as long as at least one is safe (losing them all fails it).
 */
function deliverSurvivors(
	world: World,
	ids: readonly string[],
	area: { x: number; y: number; radius: number }
): number {
	let safe = 0
	let lost = 0
	for (const id of ids) {
		const prop = world.propById.get(id)
		if (!prop) continue
		if (prop.state === PropState.following && Math.hypot(prop.x - area.x, prop.y - area.y) <= area.radius) {
			prop.state = PropState.delivered
			world.events.push({ type: 'prop', index: prop.index, state: prop.state })
		}
		if (prop.state === PropState.delivered) safe++
		if (prop.state === PropState.destroyed) lost++
	}
	return safe > 0 ? safe + lost : safe
}

/** The carried object reached the area: delivered, and its carrier's hands are free. */
function deliverItem(world: World, id: string, area: { x: number; y: number; radius: number }): boolean {
	const prop = world.propById.get(id)
	if (!prop) return false
	if (prop.state === PropState.delivered) return true
	if (prop.state !== PropState.carried || Math.hypot(prop.x - area.x, prop.y - area.y) > area.radius) return false
	const carrier = world.players.get(prop.with)
	if (carrier) letGo(carrier)
	prop.state = PropState.delivered
	prop.with = 0
	world.events.push({ type: 'prop', index: prop.index, state: prop.state })
	return true
}

const EXTRACT_IDLE_TICKS = Math.round(propsDef.extractIdleSeconds * TICK_RATE)
/** how near a player walks to an item to pick it up (metres) */
const GATHER_REACH = 1.1

/**
 * Everyone still standing and playing is inside the area (and there is at least one). Players who are
 * away, disconnected or idle do not hold the squad back.
 */
function everyoneIn(world: World, area: { x: number; y: number; radius: number }): boolean {
	let any = false
	for (const state of world.players.values()) {
		if (!state.alive || state.downed || state.away) continue
		if (world.tick - state.lastActiveTick > EXTRACT_IDLE_TICKS) continue
		if (Math.hypot(state.x - area.x, state.y - area.y) > area.radius) return false
		any = true
	}
	return any
}

/** Optional objectives run alongside the steps; each pays once when done. */
function stepOptional(world: World, mission: MissionState): void {
	if (mission.status !== MissionStatus.active) return
	const objectives = mission.def.objectives
	for (let index = 0; index < objectives.length; index++) {
		const objective = objectives[index] as ObjectiveDef
		if (!objective.optional || mission.optionalDone.includes(index)) continue
		const done =
			objective.type === 'kill'
				? mission.kills >= objective.count
				: objective.type === 'interact'
					? countDone(world, objective.props) >= objective.props.length
					: objective.type === 'destroy'
						? countDestroyed(world, objective.props) >= objective.props.length
						: false
		if (!done) continue
		mission.optionalDone.push(index)
		world.events.push({ type: 'objective', index, first: true })
		for (const state of world.players.values()) {
			if (isActive(world, state)) state.pendingScore += economy.rewards.optional.score
		}
	}
}

/** A kill by a player counts toward a kill objective; a marked one toward a hunt. */
export function countKill(world: World, type: number, hunted = false): void {
	const mission = world.mission
	if (!mission || mission.status !== MissionStatus.active) return
	mission.kills++
	if (hunted && currentObjective(mission)?.type === 'hunt') mission.huntKilled++
	const objective = currentObjective(mission)
	// a kill objective may count one kind only (put down the Brute)
	if (objective?.type === 'kill' && (!objective.of || zombieIndex(objective.of) === type)) mission.progress++
}

function completeObjective(world: World, mission: MissionState, objective: ObjectiveDef): void {
	// an objective redone after a wipe still has to be done, but pays (and scores) only the first time
	const first = mission.index >= mission.rewardedThrough
	if (first) mission.rewardedThrough = mission.index + 1
	world.events.push({ type: 'objective', index: mission.index, first })
	if (first) {
		for (const state of world.players.values()) {
			if (isActive(world, state)) state.pendingScore += economy.rewards.objective.score
		}
	}
	if (objective.checkpoint) {
		mission.checkpointIndex = mission.index + 1
		const centre = 'area' in objective ? objective.area : (objective.checkpointAt ?? averagePosition(world))
		mission.checkpointX = centre.x
		mission.checkpointY = centre.y
		world.events.push({ type: 'checkpoint', index: mission.index })
		// the out return, the downed get up, everyone at full health (below)
		// a checkpoint brings everyone back: the out return, the downed get up, all at full health
		for (const state of world.players.values()) {
			state.defibUsed = false
			refillUtilities(state)
			if (!state.alive) world.respawn(state)
			else {
				if (state.downed) state.slot = state.previousSlot === 2 ? 0 : state.previousSlot
				state.downed = false
				state.downs = 0
				state.reviveProgress = 0
				state.health = state.stats.maxHealth
			}
		}
	}
	operateGates(world, mission, mission.index)
	mission.index = nextStep(mission.def, mission.index + 1)
	mission.progress = 0
	if (mission.index >= mission.def.objectives.length) {
		mission.status = MissionStatus.complete
		jam(world, false)
		mission.completedTick = world.tick
		// the final objective always drops an item for every player taking part (never lost to the cap)
		for (const state of world.players.values()) if (isActive(world, state)) rollItem(world, state, true)
		world.events.push({ type: 'mission-complete' })
		world.finish()
	}
}

function averagePosition(world: World): { x: number; y: number } {
	let x = 0
	let y = 0
	let n = 0
	for (const state of world.players.values()) {
		if (!state.alive) continue
		x += state.x
		y += state.y
		n++
	}
	return n > 0 ? { x: x / n, y: y / n } : { x: world.mission?.checkpointX ?? 0, y: world.mission?.checkpointY ?? 0 }
}

/**
 * Gates this objective opens unlock; gates it closes shut behind the squad. Anyone still on the far
 * side is brought to the checkpoint, and zombies left there are gone.
 */
function operateGates(world: World, mission: MissionState, index: number): void {
	let side: { x: number; y: number } | null = null
	for (const [id, gate] of Object.entries(mission.def.gates ?? {})) {
		const prop = world.propById.get(id)
		if (!prop) continue
		if (gate.openOn === index) setPropState(world.grid, prop, PropState.open)
		else if (gate.closeOn === index) {
			setPropState(world.grid, prop, PropState.locked)
			side = gate.side ?? { x: mission.checkpointX, y: mission.checkpointY }
		} else continue
		world.propsChanged = true
		world.events.push({ type: 'prop', index: prop.index, state: prop.state })
	}
	if (side) world.gatherBehind(side.x, side.y)
}

/** Everyone down: back to the last checkpoint, with that objective started again. */
export function wipeMission(world: World, mission: MissionState): void {
	mission.index = nextStep(mission.def, mission.checkpointIndex)
	mission.progress = 0
	mission.spawnAccumulator = 0
	// the restarted objective's ambush and boss come again
	mission.startedFor = -1
	mission.burst = 0
	// what the objectives from the checkpoint on use goes back to how it was
	for (const [index, objective] of mission.def.objectives.entries()) {
		if (index < mission.checkpointIndex || objective.optional) continue
		for (const id of objectiveProps(objective)) {
			const prop = world.propById.get(id)
			if (prop) resetProp(world, prop)
		}
	}
	world.events.push({ type: 'wipe', wave: mission.index + 1 })
}

/**
 * Rolls an item of a tier weighted by difficulty; drops are per player and capped per mission, with
 * the last place kept for the guaranteed drop of the final objective. Loot has its own random
 * numbers, so nothing a player does in the fight steers it.
 */
export function rollItem(world: World, state: PlayerState, guaranteed = false): void {
	const cap = economy.drops.maxPerMission - (guaranteed ? 0 : 1)
	if (state.foundItems.length + state.itemsReported >= cap) return
	const weights = economy.drops.tierWeights[world.mission?.difficulty.id ?? 'veteran'] ?? [1, 0, 0]
	const total = weights[0] + weights[1] + weights[2]
	let roll = world.lootRng.next() * total
	let tier = 1
	for (const [index, weight] of weights.entries()) {
		if (roll < weight) {
			tier = index + 1
			break
		}
		roll -= weight
	}
	const choices = items.filter(item => item.tier === tier)
	const pick = choices[world.lootRng.int(choices.length)]
	if (!pick) return
	state.foundItems.push(pick.id)
	if (guaranteed) state.finalItem = pick.id
	world.events.push({ type: 'item-found', player: state.id, item: items.indexOf(pick) })
}

const BUFF_IDS = new Map(buffs.buffs.map((buff, index) => [buff.id, index]))

/** A standing player walking over a buff picks it up. */
export function pickUpBuffs(world: World): void {
	for (let o = world.objects.length - 1; o >= 0; o--) {
		const object = world.objects[o]
		if (object?.kind !== ObjectKind.buff) continue
		for (const state of world.players.values()) {
			if (!state.alive || state.downed) continue
			if (Math.hypot(state.x - object.x, state.y - object.y) > object.radius) continue
			world.removeObject(object)
			applyBuff(world, state, object.amount)
			break
		}
	}
}

export function applyBuff(world: World, picker: PlayerState, index: number): void {
	const buff = buffs.buffs[index]
	if (!buff) return
	world.events.push({ type: 'buff', player: picker.id, buff: index })
	const ticks = Math.round(buff.seconds * TICK_RATE)
	const param = (key: string) => buff.params[key] ?? 0
	switch (buff.id) {
		case 'screen-nuke':
			// everything near dies; elites lose a share of their health
			for (let i = 0; i < MAX_ZOMBIES; i++) {
				if (world.alive[i] === 0) continue
				const def = zombies[world.type[i] as number]
				if (!def || def.dummy) continue
				if (Math.hypot((world.x[i] as number) - picker.x, (world.y[i] as number) - picker.y) > param('radius')) continue
				const amount = def.elite
					? (world.maxHealth[i] as number) * param('eliteDamage')
					: (world.health[i] as number) + 1
				world.damageZombie(i, amount, picker.id, 'explosive', false)
			}
			break
		case 'max-ammo':
			for (const state of world.players.values()) {
				for (const slot of [0, 1] as const) {
					const weapon = state.stats.weapons[slot]
					state.weapons[slot].mag = weapon.magazine
					state.weapons[slot].reserve = weapon.maxReserve ?? -1
				}
			}
			break
		case 'double-xp':
			world.doubleXpUntil = world.tick + ticks
			break
		case 'instakill':
			world.instakillUntil = world.tick + ticks
			break
		case 'minigun':
			picker.minigunSteps = Math.max(picker.minigunSteps, ticks)
			break
		case 'speed-boost':
			// adds to a running Adrenaline Burst or Stim instead of cutting its fire-rate bonus
			for (const state of world.players.values()) {
				if (!state.alive) continue
				const running = state.hasteSteps > 0
				state.hasteSpeed = Math.max(running ? state.hasteSpeed : 0, param('speed'))
				state.hasteFire = running ? state.hasteFire : 0
				state.hasteSteps = Math.max(state.hasteSteps, ticks)
			}
			break
		case 'freeze-pulse':
			for (let i = 0; i < MAX_ZOMBIES; i++) {
				if (world.alive[i] === 0) continue
				if (Math.hypot((world.x[i] as number) - picker.x, (world.y[i] as number) - picker.y) > param('radius')) continue
				world.stunUntil[i] = Math.max(world.stunUntil[i] as number, world.tick + ticks)
			}
			break
		case 'sentry':
			world.addObject({
				kind: ObjectKind.sentry,
				owner: picker.id,
				x: picker.x,
				y: picker.y,
				radius: param('radius'),
				angle: 0,
				untilTick: world.tick + ticks,
				health: 0,
				maxHealth: 0,
				amount: param('damage'),
				damageType: 'ballistic',
				cells: [],
				nextTick: world.tick,
				interval: Math.max(1, Math.round(TICK_RATE / param('shotsPerSecond'))),
				trigger: 0
			})
			break
	}
}

export const buffIndex = (id: string): number => BUFF_IDS.get(id) ?? -1

/** Players holding interact next to a cache they have not opened yet get an item roll. */
export function openCaches(world: World, state: PlayerState, interacting: boolean): void {
	const mission = world.mission
	if (!mission || !interacting || !state.alive || state.downed) return
	for (const [index, cache] of mission.def.caches.entries()) {
		if (state.openedCaches.includes(index)) continue
		if (Math.hypot(state.x - cache.x, state.y - cache.y) > economy.drops.cacheRange) continue
		state.openedCaches.push(index)
		world.events.push({ type: 'cache', player: state.id, index })
		rollItem(world, state)
		maybeDropBuff(world, cache.x, cache.y + 1, buffs.drop.cacheChance)
	}
}

/** A kill (or a cache) may leave a buff on the ground; at most one every so often per squad. */
export function maybeDropBuff(world: World, x: number, y: number, chance: number = buffs.drop.chancePerKill): void {
	if (world.range || world.tick < world.nextBuffTick) return
	if (world.lootRng.next() >= chance) return
	const total = buffs.buffs.reduce((sum, buff) => sum + buff.weight, 0)
	let roll = world.lootRng.next() * total
	let chosen = 0
	for (const [index, buff] of buffs.buffs.entries()) {
		if (roll < buff.weight) {
			chosen = index
			break
		}
		roll -= buff.weight
	}
	world.nextBuffTick = world.tick + Math.round(buffs.drop.minIntervalSeconds * TICK_RATE)
	world.addObject({
		kind: ObjectKind.buff,
		owner: 0,
		x,
		y,
		radius: buffs.drop.pickupRadius,
		angle: 0,
		untilTick: world.tick + Math.round(buffs.drop.lifetimeSeconds * TICK_RATE),
		health: 0,
		maxHealth: 0,
		amount: chosen,
		damageType: 'ballistic',
		cells: [],
		nextTick: 0,
		interval: 0,
		trigger: 0
	})
}
