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
	zombieIndex,
	zombies
} from '@rotline/game-data'
import { DT, MAX_ZOMBIES, TICK_RATE } from './constants.ts'
import { type PlayerState, refillUtilities } from './player.ts'
import { ObjectKind, type World } from './world.ts'

export type MissionSetup = { mission: MissionDef; difficulty: DifficultyId }

export const MissionStatus = { none: 0, active: 1, complete: 2 } as const

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
	spawnAccumulator: number
	/** composition as cumulative weights, for weighted picks */
	pool: { type: number; upTo: number }[]
	poolTotal: number
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
		index: 0,
		progress: 0,
		status: MissionStatus.active,
		startTick,
		completedTick: 0,
		checkpointIndex: 0,
		checkpointX: spawnX,
		checkpointY: spawnY,
		downs: 0,
		rewardedThrough: 0,
		spawnAccumulator: 0,
		pool,
		poolTotal: total
	}
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
			return Math.round(objective.seconds * TICK_RATE)
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

/** Spawns, objective progress and checkpoints; called once a tick while a mission runs. */
export function stepMission(world: World): void {
	const mission = world.mission
	if (!mission || mission.status !== MissionStatus.active) return
	const objective = currentObjective(mission)
	if (!objective) return

	// the spawn director: a steady stream, scaled by the objective, difficulty and squad size
	const squad = Math.max(1, Math.min(4, world.players.size))
	const squadScale = difficulties.squadEnemyCount[squad - 1] ?? 1
	const count = mission.difficulty.enemyCount * squadScale
	const maxAlive = Math.min(difficulties.maxAlive, Math.round(mission.def.spawn.maxAlive * count))
	// nothing spawns while the whole squad is down: they come back to the checkpoint, not into a horde
	if (standing(world)) {
		mission.spawnAccumulator += mission.def.spawn.perSecond * (objective.spawnScale ?? 1) * count * DT
		while (mission.spawnAccumulator >= 1 && world.aliveCount < maxAlive) {
			mission.spawnAccumulator -= 1
			const roll = world.rng.next() * mission.poolTotal
			const pick = mission.pool.find(entry => roll < entry.upTo) ?? mission.pool[0]
			if (pick) world.spawnZombie(pick.type)
		}
		if (world.aliveCount >= maxAlive) mission.spawnAccumulator = Math.min(mission.spawnAccumulator, 1)
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
	}
	if (mission.progress >= objectiveGoal(objective)) completeObjective(world, mission, objective)
}

/** A kill by a player counts toward a kill objective. */
export function countKill(world: World): void {
	const mission = world.mission
	if (!mission || mission.status !== MissionStatus.active) return
	if (currentObjective(mission)?.type === 'kill') mission.progress++
}

function completeObjective(world: World, mission: MissionState, objective: ObjectiveDef): void {
	// an objective redone after a wipe still has to be done, but pays (and scores) only the first time
	const first = mission.index >= mission.rewardedThrough
	if (first) mission.rewardedThrough = mission.index + 1
	world.events.push({ type: 'objective', index: mission.index, first })
	if (first) {
		for (const state of world.players.values()) {
			if (isActive(world, state)) world.addScore(state, economy.rewards.objective.score)
		}
	}
	if (objective.checkpoint) {
		mission.checkpointIndex = mission.index + 1
		const centre = 'area' in objective ? objective.area : averagePosition(world)
		mission.checkpointX = centre.x
		mission.checkpointY = centre.y
		world.events.push({ type: 'checkpoint', index: mission.index })
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
	mission.index++
	mission.progress = 0
	if (mission.index >= mission.def.objectives.length) {
		mission.status = MissionStatus.complete
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

/** Everyone down: back to the last checkpoint, with that objective started again. */
export function wipeMission(world: World, mission: MissionState): void {
	mission.index = mission.checkpointIndex
	mission.progress = 0
	mission.spawnAccumulator = 0
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
