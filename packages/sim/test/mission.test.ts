import { buffs, economy, items, type MissionDef, missionById, zombieIndex, zombies } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import {
	applyBuff,
	Button,
	buffIndex,
	chainMultiplier,
	MissionStatus,
	ObjectKind,
	scoreThreshold,
	TICK_RATE,
	World
} from '../src/index.ts'
import { input, steps, yard } from './helpers.ts'

const sweep = missionById('yard-sweep') as MissionDef

/** A mission with no spawning unless a test asks for it. */
function missionWorld(def: Partial<MissionDef> = {}, difficulty: 'recruit' | 'veteran' | 'nightmare' = 'veteran') {
	const mission: MissionDef = { ...sweep, spawn: { ...sweep.spawn, perSecond: 0 }, ...def }
	return new World({ seed: 3, map: yard, mission: { mission, difficulty } })
}

const drudge = zombieIndex('drudge')

function kill(world: World, by: number, count = 1) {
	for (let n = 0; n < count; n++) {
		const index = world.spawnZombie(drudge, { x: 10, y: 10 })
		world.damageZombie(index, 1e9, by)
	}
}

describe('mission objectives', () => {
	it('counts kills toward a kill objective, then moves on to the next with score for everyone', () => {
		const world = missionWorld()
		const state = world.addPlayer(1)
		kill(world, 1, 39)
		world.step(new Map())
		expect(world.mission?.index).toBe(0)
		expect(world.mission?.progress).toBe(39)
		kill(world, 1)
		world.step(new Map())
		expect(world.mission?.index).toBe(1)
		expect(world.events.some(event => event.type === 'objective' && event.index === 0)).toBe(true)
		// objective score is held until a checkpoint (the room settles it)
		expect(state.pendingScore).toBe(economy.rewards.objective.score)
	})

	it('completes a reach objective when someone stands in the area, saving a checkpoint there', () => {
		const world = missionWorld({ objectives: [sweep.objectives[2], sweep.objectives[5]] as MissionDef['objectives'] })
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		// b bled out earlier and is waiting; a is hurt and has used a grenade
		b.alive = false
		b.respawnTick = Number.MAX_SAFE_INTEGER
		a.health = 10
		a.utilityCharges[0] = 0
		a.x = 32
		a.y = 5
		world.step(new Map())
		expect(world.events.some(event => event.type === 'checkpoint')).toBe(true)
		expect(world.mission?.checkpointIndex).toBe(1)
		expect(b.alive).toBe(true)
		expect(Math.hypot(b.x - 32, b.y - 4)).toBeLessThan(2)
		expect(a.health).toBe(a.stats.maxHealth)
		expect(a.utilityCharges[0]).toBe(a.stats.utilities[0]?.charges)
	})

	it('runs a hold timer only while someone is inside the area', () => {
		const world = missionWorld({ objectives: [sweep.objectives[3]] as MissionDef['objectives'] })
		const state = world.addPlayer(1)
		state.x = 10
		state.y = 30
		steps(world, TICK_RATE)
		expect(world.mission?.progress).toBe(0)
		state.x = 32
		state.y = 4
		steps(world, TICK_RATE)
		expect(world.mission?.progress).toBe(TICK_RATE)
	})

	it('finishes after the last objective with an item for every player', () => {
		const world = missionWorld({
			objectives: [{ type: 'survive', label: 'Wait', seconds: 1 }]
		})
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		steps(world, TICK_RATE + 1)
		expect(world.mission?.status).toBe(MissionStatus.complete)
		expect(world.mission?.completedTick).toBeGreaterThan(0)
		expect(a.foundItems).toHaveLength(1)
		expect(b.foundItems).toHaveLength(1)
		expect(items.find(item => item.id === a.foundItems[0])?.tier).toBeGreaterThan(0)
		// nothing more happens once complete
		const tick = world.mission?.completedTick
		steps(world, 5)
		expect(world.mission?.completedTick).toBe(tick)
	})

	it('restarts from the last checkpoint after a wipe', () => {
		const world = missionWorld({
			objectives: [
				{ type: 'survive', label: 'One', seconds: 0.1, checkpoint: true },
				{ type: 'kill', label: 'Two', count: 50 },
				{ type: 'kill', label: 'Three', count: 50 }
			]
		})
		const state = world.addPlayer(1)
		steps(world, 5)
		expect(world.mission?.index).toBe(1)
		kill(world, 1, 3)
		state.health = 1
		world.spawnZombie(drudge, { x: state.x + 0.5, y: state.y })
		for (let i = 0; i < 90 && state.alive; i++) world.step(new Map())
		expect(world.events.some(event => event.type === 'wipe')).toBe(true)
		expect(world.mission?.index).toBe(1)
		expect(world.mission?.progress).toBe(0)
		expect(world.mission?.downs).toBe(1)
		steps(world, 10 * TICK_RATE)
		expect(state.alive).toBe(true)
		expect(state.health).toBe(state.stats.maxHealth)
	})
})

describe('mission difficulty and spawning', () => {
	it('scales zombie health and damage by difficulty and enemy level', () => {
		const easy = missionWorld({}, 'recruit')
		const hard = missionWorld({ enemyLevel: 3 }, 'nightmare')
		const def = zombies[drudge] as (typeof zombies)[number]
		const a = easy.spawnZombie(drudge, { x: 10, y: 10 })
		const b = hard.spawnZombie(drudge, { x: 10, y: 10 })
		expect(easy.health[a]).toBeCloseTo(def.health * 0.8)
		expect(hard.health[b]).toBeCloseTo(def.health * 1.5 * 1.12)
		expect(hard.maxHealth[b]).toBeCloseTo(hard.health[b] as number)
		const player = hard.addPlayer(1)
		const before = player.health
		hard.spawnZombie(drudge, { x: player.x + 0.5, y: player.y })
		for (let i = 0; i < 30 && player.health === before; i++) hard.step(new Map())
		expect(before - player.health).toBeGreaterThan(0)
	})

	it('spawns a steady stream scaled for a solo player, up to the alive cap', () => {
		// the stream alone: no nests, ambushes or bosses
		const plain: MissionDef = {
			...sweep,
			objectives: sweep.objectives
				.filter(objective => objective.type !== 'destroy')
				.map(({ ambush: _ambush, boss: _boss, ...objective }) => objective) as MissionDef['objectives']
		}
		const world = new World({ seed: 1, map: yard, mission: { mission: plain, difficulty: 'veteran' } })
		world.addPlayer(1)
		steps(world, 10 * TICK_RATE)
		// 1.6 a second at half strength for one player
		expect(world.aliveCount).toBeGreaterThanOrEqual(7)
		expect(world.aliveCount).toBeLessThanOrEqual(9)
		steps(world, 120 * TICK_RATE)
		expect(world.aliveCount).toBeLessThanOrEqual(Math.round(sweep.spawn.maxAlive * 0.5))
	})
})

describe('score and multiplier', () => {
	it('multiplies kill score by the chain', () => {
		expect(chainMultiplier(0)).toBe(1)
		expect(chainMultiplier(9)).toBe(1)
		expect(chainMultiplier(10)).toBe(2)
		expect(chainMultiplier(250)).toBe(6)
		const world = missionWorld()
		const state = world.addPlayer(1)
		kill(world, 1, 10)
		const drudgeScore = (zombies[drudge] as (typeof zombies)[number]).score
		expect(state.score).toBe(drudgeScore * 9 + drudgeScore * 2)
	})

	it('pays thresholds with a heal, then every step after the listed ones', () => {
		expect(scoreThreshold(0)).toBe(25_000)
		expect(scoreThreshold(2)).toBe(150_000)
		expect(scoreThreshold(3)).toBe(300_000)
		const world = missionWorld()
		const state = world.addPlayer(1)
		state.health = 10
		world.addScore(state, 80_000)
		expect(state.thresholds).toBe(2)
		expect(world.events.filter(event => event.type === 'threshold')).toHaveLength(2)
		expect(state.health).toBeCloseTo(Math.min(state.stats.maxHealth, 10 + 2 * 0.3 * state.stats.maxHealth))
	})

	it('loses the chain when downed', () => {
		const world = missionWorld()
		const a = world.addPlayer(1)
		world.addPlayer(2).x = 50
		kill(world, 1, 5)
		expect(a.chain).toBe(5)
		a.health = 1
		world.spawnZombie(drudge, { x: a.x + 0.5, y: a.y })
		for (let i = 0; i < 90 && !a.downed; i++) world.step(new Map())
		expect(a.chain).toBe(0)
	})
})

describe('buffs', () => {
	it('drops buffs from kills at most once per interval, and picks them up on contact', () => {
		const world = missionWorld()
		const state = world.addPlayer(1)
		world.tick = 100 * TICK_RATE
		for (let n = 0; n < 2000 && !world.objects.some(object => object.kind === ObjectKind.buff); n++) kill(world, 1)
		const dropped = world.objects.filter(object => object.kind === ObjectKind.buff)
		expect(dropped).toHaveLength(1)
		kill(world, 1, 500)
		expect(world.objects.filter(object => object.kind === ObjectKind.buff)).toHaveLength(1)
		const buff = dropped[0] as (typeof dropped)[number]
		state.x = buff.x
		state.y = buff.y
		world.step(new Map())
		expect(world.objects.some(object => object.kind === ObjectKind.buff)).toBe(false)
		expect(world.events.some(event => event.type === 'buff' && event.player === 1)).toBe(true)
	})

	it('applies each buff', () => {
		const world = missionWorld()
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		const near = world.spawnZombie(drudge, { x: a.x + 3, y: a.y })
		applyBuff(world, a, buffIndex('screen-nuke'))
		expect(world.alive[near]).toBe(0)

		a.weapons[0].reserve = 0
		b.weapons[1].mag = 0
		applyBuff(world, a, buffIndex('max-ammo'))
		expect(a.weapons[0].reserve).toBe(a.stats.weapons[0].maxReserve)
		expect(b.weapons[1].mag).toBe(b.stats.weapons[1].magazine)

		applyBuff(world, a, buffIndex('double-xp'))
		expect(world.doubleXpUntil).toBeGreaterThan(world.tick)

		applyBuff(world, a, buffIndex('instakill'))
		const tough = world.spawnZombie(zombieIndex('swell'), { x: 40, y: 40 })
		world.damageZombie(tough, 1, 1)
		expect(world.alive[tough]).toBe(0)

		applyBuff(world, a, buffIndex('minigun'))
		expect(a.minigunSteps).toBe(20 * TICK_RATE)
		expect(b.minigunSteps).toBe(0)

		applyBuff(world, b, buffIndex('speed-boost'))
		expect(a.hasteSteps).toBe(15 * TICK_RATE)
		expect(b.hasteSpeed).toBeCloseTo(0.3)

		const frozen = world.spawnZombie(drudge, { x: a.x + 5, y: a.y })
		applyBuff(world, a, buffIndex('freeze-pulse'))
		expect(world.stunUntil[frozen]).toBe(world.tick + 6 * TICK_RATE)

		applyBuff(world, a, buffIndex('sentry'))
		expect(world.objects.some(object => object.kind === ObjectKind.sentry && object.owner === 1)).toBe(true)
		expect(buffs.buffs).toHaveLength(8)
	})
})

describe('item drops', () => {
	it('opens a cache once per player while holding interact next to it', () => {
		const world = missionWorld()
		const a = world.addPlayer(1)
		const cache = sweep.caches[0] as { x: number; y: number }
		a.x = cache.x
		a.y = cache.y + 0.5
		const hold = () => new Map([[1, input({ buttons: Button.interact })]])
		steps(world, 3, hold)
		expect(a.openedCaches).toEqual([0])
		expect(a.foundItems).toHaveLength(1)
	})

	it('caps drops per mission per player', () => {
		const world = missionWorld({
			caches: Array.from({ length: 8 }, (_, n) => ({ x: 30 + n * 0.1, y: 30 }))
		})
		const a = world.addPlayer(1)
		a.x = 30.3
		a.y = 30
		world.step(new Map([[1, input({ buttons: Button.interact })]]))
		expect(a.openedCaches).toHaveLength(8)
		// one place is kept for the final objective's guaranteed drop
		expect(a.foundItems).toHaveLength(economy.drops.maxPerMission - 1)
	})

	it('gives the final drop only to players taking part, never lost to the cap', () => {
		const world = missionWorld({ objectives: [{ type: 'survive', label: 'Wait', seconds: 1 }] })
		const a = world.addPlayer(1)
		const idle = world.addPlayer(2)
		a.foundItems.push('x', 'y', 'z')
		// idle last touched the controls long ago
		idle.lastActiveTick = -100 * TICK_RATE
		steps(world, 3 * TICK_RATE, () => new Map([[1, input({ moveX: (world.tick % 2) * 50 })]]))
		expect(world.mission?.status).toBe(MissionStatus.complete)
		expect(a.foundItems).toHaveLength(economy.drops.maxPerMission)
		expect(idle.foundItems).toHaveLength(0)
	})
})

describe('fair payouts', () => {
	it('pays an objective once, even when it is redone after a wipe', () => {
		const world = missionWorld({
			objectives: [
				{ type: 'kill', label: 'One', count: 2 },
				{ type: 'kill', label: 'Two', count: 50 }
			]
		})
		const state = world.addPlayer(1)
		kill(world, 1, 2)
		world.step(new Map())
		const firstScore = state.score
		expect(world.events.find(event => event.type === 'objective')).toMatchObject({ first: true })
		// a solo down is a wipe: back to objective one (no checkpoint yet)
		state.health = 1
		world.spawnZombie(drudge, { x: state.x + 0.5, y: state.y })
		for (let i = 0; i < 90 && state.alive; i++) world.step(new Map())
		expect(world.mission?.index).toBe(0)
		steps(world, 10 * TICK_RATE)
		kill(world, 1, 2)
		world.step(new Map())
		expect(world.events.find(event => event.type === 'objective')).toMatchObject({ first: false })
		// only the kills scored, not the objective again
		expect(state.score - firstScore).toBeLessThan(economy.rewards.objective.score)
		expect(state.pendingScore).toBe(economy.rewards.objective.score)
	})

	it('spawns nothing while the whole squad is down', () => {
		const world = new World({ seed: 1, map: yard, mission: { mission: sweep, difficulty: 'veteran' } })
		const state = world.addPlayer(1)
		state.alive = false
		state.respawnTick = Number.MAX_SAFE_INTEGER
		steps(world, 5 * TICK_RATE)
		expect(world.aliveCount).toBe(0)
	})

	it('stands still once the mission is complete: no zombies, no damage, no score', () => {
		const world = missionWorld({ objectives: [{ type: 'survive', label: 'Wait', seconds: 0.1 }] })
		const state = world.addPlayer(1)
		world.spawnZombie(drudge, { x: 10, y: 10 })
		steps(world, 5)
		expect(world.finished).toBe(true)
		expect(world.aliveCount).toBe(0)
		const score = state.score
		world.addScore(state, 500)
		expect(state.score).toBe(score)
		const health = state.health
		world.spawnZombie(drudge, { x: state.x + 0.5, y: state.y })
		steps(world, 60)
		expect(state.health).toBe(health)
	})

	it('joins a mission under way at the last checkpoint', () => {
		const world = missionWorld({ objectives: [sweep.objectives[2], sweep.objectives[5]] as MissionDef['objectives'] })
		const a = world.addPlayer(1)
		a.x = 32
		a.y = 5
		world.step(new Map())
		const late = world.addPlayer(2)
		expect(Math.hypot(late.x - 32, late.y - 4)).toBeLessThan(2)
	})
})

describe('survival', () => {
	it('ends the run when the squad is wiped, after the rounds survived', () => {
		const world = new World({
			seed: 4,
			map: yard,
			survival: true,
			waves: {
				firstWaveDelaySeconds: 1e6,
				breakSeconds: 1,
				spawnPerSecond: 1,
				maxAlive: 300,
				waves: [{ drudge: 0 }],
				growthPerWave: 1
			}
		})
		const state = world.addPlayer(1)
		kill(world, 1, 3)
		expect(state.score).toBeGreaterThan(0)
		state.health = 1
		world.spawnZombie(drudge, { x: state.x + 0.5, y: state.y })
		for (let i = 0; i < 90 && state.alive; i++) world.step(new Map())
		expect(world.events.some(event => event.type === 'run-over')).toBe(true)
		expect(world.finished).toBe(true)
		steps(world, 10 * TICK_RATE)
		expect(state.alive).toBe(false)
	})
})
