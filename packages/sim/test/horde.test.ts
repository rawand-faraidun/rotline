import {
	DAMAGE_TYPES,
	type MissionDef,
	missionById,
	missionMap,
	mutate,
	mutationStage,
	zombieIndex,
	zombies
} from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import {
	angleToAim,
	Button,
	createMission,
	enemyScale,
	Pace,
	type PlayerInput,
	PropState,
	pacing,
	STAMINA_MAX,
	StrikeKind,
	stepPlayer,
	TICK_RATE,
	WarnKind,
	World,
	ZombieAction
} from '../src/index.ts'
import { input, quietWorld, steps, sweep, yard } from './helpers.ts'

const zombieDef = (id: string) => zombies[zombieIndex(id)] as NonNullable<(typeof zombies)[number]>
/** a player who cannot be hurt and stands still: for watching a zombie at work */
function standing(world: World, x: number, y: number) {
	const player = world.addPlayer(1)
	player.x = x
	player.y = y
	return player
}
const eventsOf = (world: World, run: number, type: string) => {
	const seen: World['events'] = []
	for (let n = 0; n < run; n++) {
		world.step(new Map())
		seen.push(...world.events.filter(event => event.type === type))
	}
	return seen
}

describe('resistances and shields', () => {
	it('a Bulwark turns bullets from the front, not from behind, and never a blast', () => {
		const world = quietWorld()
		standing(world, 40, 30)
		const bulwark = world.spawnZombie(zombieIndex('bulwark'), { x: 30, y: 30 })
		// facing the player, east
		world.heading[bulwark] = 0
		const full = world.health[bulwark] as number
		world.damageZombie(bulwark, 100, 1, 'ballistic', true, 40, 30)
		const front = full - (world.health[bulwark] as number)
		expect(front).toBeCloseTo(100 * (1 - (zombieDef('bulwark').shield?.reduction ?? 0)), 5)
		const before = world.health[bulwark] as number
		world.damageZombie(bulwark, 100, 1, 'ballistic', true, 20, 30)
		expect(before - (world.health[bulwark] as number)).toBeCloseTo(100, 5)
		const beforeBlast = world.health[bulwark] as number
		world.damageZombie(bulwark, 100, 1, 'explosive', true, 40, 30)
		expect(beforeBlast - (world.health[bulwark] as number)).toBeCloseTo(100, 5)
	})

	it('a Cinder does not burn, and leaves fire behind it that hurts', () => {
		const world = quietWorld()
		const player = standing(world, 32, 24)
		const cinder = world.spawnZombie(zombieIndex('cinder'), { x: 20, y: 24 })
		const health = world.health[cinder] as number
		world.damageZombie(cinder, 500, 1, 'fire')
		expect(world.health[cinder]).toBe(health)
		steps(world, 3 * TICK_RATE)
		expect(world.pools.some(pool => pool.type === 'fire')).toBe(true)
		// stood in its fire, a player burns
		const pool = world.pools.filter(entry => entry.type === 'fire').at(-1)
		if (!pool) throw new Error('no fire')
		player.x = pool.x
		player.y = pool.y
		player.safeUntilTick = 0
		world.alive[cinder] = 0
		world.aliveCount--
		const before = player.health
		steps(world, 10)
		expect(player.health).toBeLessThan(before)
	})
})

describe('pools and thrown things', () => {
	it('a pool that downs the last player standing does not break the tick that wipes the squad', () => {
		const world = quietWorld()
		const player = world.addPlayer(1)
		player.health = 0.1
		world.addPool(player.x, player.y, 2, 50, 5, 'chemical')
		world.addPool(player.x, player.y, 2, 50, 5, 'fire')
		world.hazards.push({
			tick: world.tick,
			x: player.x,
			y: player.y,
			radius: 2,
			damage: 50,
			type: 'chemical',
			pool: null
		})
		expect(() => world.step(new Map())).not.toThrow()
		expect(player.downed || !player.alive).toBe(true)
		expect(world.pools.length).toBe(0)
	})
})

describe('the Retcher', () => {
	it('stands off and spits where the player stands; moving away from the mark is the answer', () => {
		const world = quietWorld()
		// the yard's open row at y 14
		const player = standing(world, 20, 14)
		world.spawnZombie(zombieIndex('retcher'), { x: 31, y: 14 })
		const warned = eventsOf(world, 6 * TICK_RATE, 'warn')
		const spit = warned.find(event => event.type === 'warn' && event.kind === WarnKind.spit)
		expect(spit).toBeDefined()
		expect(player.health).toBeLessThan(player.stats.maxHealth)
	})

	it('misses a player who walks out of the mark', () => {
		const world = quietWorld()
		const player = standing(world, 20, 14)
		const retcher = world.spawnZombie(zombieIndex('retcher'), { x: 31, y: 14 })
		world.specialAt[retcher] = 0
		// wait for the throw, then step aside before it lands
		for (let n = 0; n < 4 * TICK_RATE && world.hazards.length === 0; n++) world.step(new Map())
		expect(world.hazards.length).toBe(1)
		player.y += 4
		const before = player.health
		for (let n = 0; n < TICK_RATE && world.hazards.length > 0; n++) world.step(new Map())
		expect(world.hazards.length).toBe(0)
		expect(player.health).toBe(before)
		// what it left on the ground is acid
		expect(world.pools.some(pool => pool.type === 'chemical')).toBe(true)
	})
})

describe('the Delver', () => {
	it('goes under when far away, cannot be shot there, and bursts out under the player', () => {
		const world = quietWorld()
		const player = standing(world, 20, 14)
		const delver = world.spawnZombie(zombieIndex('delver'), { x: 32, y: 14 })
		world.specialAt[delver] = 0
		world.step(new Map())
		expect(world.under[delver]).toBe(1)
		const health = world.health[delver] as number
		world.damageZombie(delver, 100, 1)
		expect(world.health[delver]).toBe(health)
		// a shot straight at it passes over
		const fire = new Map<number, PlayerInput>([[1, input({ buttons: Button.fire, aim: angleToAim(0) })]])
		steps(world, 5, () => fire)
		expect(world.health[delver]).toBe(health)
		const struck = eventsOf(world, 8 * TICK_RATE, 'strike')
		expect(struck.some(event => event.type === 'strike' && event.kind === StrikeKind.erupt)).toBe(true)
		expect(world.under[delver]).toBe(0)
		expect(player.health).toBeLessThan(player.stats.maxHealth)
	})
})

describe('charges', () => {
	it('a Brute marks its lane, runs it, and is dazed when it runs into a wall', () => {
		const world = quietWorld()
		// the yard's short wall at x 22..24, y 22; the Brute south of it, the player against its south face
		const player = standing(world, 23.5, 23.5)
		const brute = world.spawnZombie(zombieIndex('brute'), { x: 23.5, y: 33 })
		world.specialAt[brute] = 0
		const warned = eventsOf(world, 2, 'warn')
		expect(warned.some(event => event.type === 'warn' && event.kind === WarnKind.charge)).toBe(true)
		expect(world.action[brute]).toBe(ZombieAction.chargeWindup)
		// sidestep the lane during the wind-up
		player.x = 27
		let dazed = false
		for (let n = 0; n < 5 * TICK_RATE && !dazed; n++) {
			world.step(new Map())
			dazed = world.action[brute] === ZombieAction.dazed
		}
		expect(dazed).toBe(true)
		expect(player.health).toBe(player.stats.maxHealth)
	})

	it('a charge that meets a player hurts them and throws them aside', () => {
		const world = quietWorld()
		const player = standing(world, 40, 14)
		const brute = world.spawnZombie(zombieIndex('brute'), { x: 30, y: 14 })
		world.specialAt[brute] = 0
		steps(world, 3 * TICK_RATE)
		expect(player.health).toBeLessThan(player.stats.maxHealth)
		expect(Math.abs(player.y - 14)).toBeGreaterThan(0.5)
	})

	it('a stun breaks the wind-up', () => {
		const world = quietWorld()
		standing(world, 40, 14)
		const brute = world.spawnZombie(zombieIndex('brute'), { x: 30, y: 14 })
		world.specialAt[brute] = 0
		world.step(new Map())
		expect(world.action[brute]).toBe(ZombieAction.chargeWindup)
		world.stunUntil[brute] = world.tick + TICK_RATE
		world.step(new Map())
		expect(world.action[brute]).toBe(ZombieAction.none)
	})
})

describe('The Warden', () => {
	it('is as tough as the squad is big', () => {
		const solo = quietWorld()
		solo.addPlayer(1)
		const one = solo.spawnZombie(zombieIndex('warden'), { x: 30, y: 30 })
		const squad = quietWorld()
		for (let id = 1; id <= 4; id++) squad.addPlayer(id)
		const four = squad.spawnZombie(zombieIndex('warden'), { x: 30, y: 30 })
		expect(solo.health[one]).toBeCloseTo((squad.health[four] as number) * 0.55, 5)
	})

	it('slams the ground round him, and steps into his phases as he is hurt', () => {
		const world = quietWorld()
		const player = standing(world, 31.5, 30)
		const warden = world.spawnZombie(zombieIndex('warden'), { x: 30, y: 30 })
		world.slamAt[warden] = 0
		world.specialAt[warden] = 1e6
		const warned = eventsOf(world, 2, 'warn')
		expect(warned.some(event => event.type === 'warn' && event.kind === WarnKind.slam)).toBe(true)
		steps(world, TICK_RATE)
		expect(player.health).toBeLessThan(player.stats.maxHealth)
		const max = world.maxHealth[warden] as number
		world.damageZombie(warden, max * 0.4, 1, 'explosive')
		expect(world.phase[warden]).toBe(1)
		expect(world.events.some(event => event.type === 'phase' && event.phase === 1)).toBe(true)
		// in his second phase he calls the line
		const before = world.aliveCount
		steps(world, 3 * TICK_RATE)
		expect(world.aliveCount).toBeGreaterThan(before)
		world.damageZombie(warden, max * 0.3, 1, 'explosive')
		expect(world.phase[warden]).toBe(2)
	})

	it('shrugs off stuns', () => {
		const world = quietWorld()
		standing(world, 45, 30)
		const warden = world.spawnZombie(zombieIndex('warden'), { x: 30, y: 30 })
		world.specialAt[warden] = 1e6
		world.slamAt[warden] = 1e6
		world.stunUntil[warden] = world.tick + 10 * TICK_RATE
		const x = world.x[warden] as number
		steps(world, TICK_RATE)
		expect(world.x[warden]).toBeGreaterThan(x)
	})
})

describe('the spawn director', () => {
	it('builds up, peaks and eases off, and eases off early for a squad in trouble', () => {
		const world = quietWorld()
		const player = world.addPlayer(1)
		const mission = createMission({ mission: sweep, difficulty: 'veteran' }, 0, 1, 1)
		const seen = new Set<number>()
		for (let n = 0; n < 200 * TICK_RATE; n++) {
			pacing(world, mission)
			seen.add(mission.pace)
			world.tick++
		}
		expect(seen).toEqual(new Set([Pace.build, Pace.peak, Pace.relief]))
		while (mission.pace !== Pace.peak) {
			pacing(world, mission)
			world.tick++
		}
		expect(pacing(world, mission).rate).toBeGreaterThan(1)
		player.downed = true
		pacing(world, mission)
		expect(mission.pace).toBe(Pace.relief)
	})
})

describe('sprinting', () => {
	it('is faster, spends stamina, stops the gun and comes back after a rest', () => {
		const world = quietWorld()
		const walker = world.addPlayer(1)
		const runner = world.addPlayer(2)
		walker.x = runner.x = 10
		walker.y = 20
		runner.y = 30
		const walk = input({ moveX: 127 })
		const run = input({ moveX: 127, buttons: Button.sprint })
		for (let tick = 1; tick <= TICK_RATE; tick++) {
			stepPlayer(world.grid, walker, walk, tick)
			stepPlayer(world.grid, runner, run, tick)
		}
		expect(runner.x - 10).toBeGreaterThan((walker.x - 10) * 1.2)
		expect(runner.stamina).toBeLessThan(STAMINA_MAX)
		// running flat out, nothing fires
		const mag = runner.weapons[0].mag
		stepPlayer(world.grid, runner, input({ moveX: 127, buttons: Button.sprint | Button.fire }), TICK_RATE + 1)
		expect(runner.sprinting).toBe(false)
		expect(runner.weapons[0].mag).toBeLessThanOrEqual(mag)
		// emptied, it stops, and a rest fills it again
		let tick = TICK_RATE + 2
		while (runner.stamina > 0 && tick < 10 * TICK_RATE) stepPlayer(world.grid, runner, run, tick++)
		expect(runner.stamina).toBe(0)
		stepPlayer(world.grid, runner, run, tick++)
		expect(runner.sprinting).toBe(false)
		for (const end = tick + 10 * TICK_RATE; tick < end; tick++) stepPlayer(world.grid, runner, input(), tick)
		expect(runner.stamina).toBe(STAMINA_MAX)
	})
})

describe('the Warden mission', () => {
	it('breaks the riot line, brings the Warden in, and opens the pad gate when he falls', () => {
		const def = missionById('warden') as MissionDef
		const world = new World({ seed: 5, map: missionMap(def), mission: { mission: def, difficulty: 'veteran' } })
		const player = world.addPlayer(1)
		player.safeUntilTick = 1e9
		const pad = world.propById.get('gate-pad')
		expect(pad?.state).toBe(PropState.locked)
		// the riot line: 35 kills
		for (let n = 0; n < 35; n++) {
			const index = world.spawnZombie(zombieIndex('drudge'), { x: 22.5, y: 40.5 })
			world.damageZombie(index, 1e9, 1)
		}
		steps(world, 3)
		expect(world.mission?.index).toBe(1)
		let warden = -1
		for (let i = 0; i < world.alive.length; i++)
			if (world.alive[i] === 1 && world.type[i] === zombieIndex('warden')) warden = i
		expect(warden).toBeGreaterThanOrEqual(0)
		// a solo Warden is 55 % as tough as a squad's (on top of the mission's enemy level)
		const scale = world.mission ? enemyScale(world.mission).health : 1
		expect(world.maxHealth[warden]).toBeCloseTo(zombieDef('warden').health * 0.55 * scale, 3)
		world.damageZombie(warden, 1e9, 1, 'explosive')
		steps(world, 3)
		expect(world.mission?.index).toBe(2)
		expect(pad?.state).not.toBe(PropState.locked)
	})
})

describe('The Gardener', () => {
	it('burns half again as fast, shrugs off gas, and goes under to reach a far player', () => {
		const world = quietWorld()
		standing(world, 20, 14)
		const gardener = world.spawnZombie(zombieIndex('gardener'), { x: 40, y: 14 })
		const max = world.maxHealth[gardener] as number
		world.damageZombie(gardener, 100, 1, 'fire')
		expect(max - (world.health[gardener] as number)).toBeCloseTo(150, 5)
		const before = world.health[gardener] as number
		world.damageZombie(gardener, 100, 1, 'chemical')
		expect(before - (world.health[gardener] as number)).toBeCloseTo(20, 5)
		world.specialAt[gardener] = 0
		world.step(new Map())
		expect(world.under[gardener]).toBe(1)
	})

	it('his mission: across the lake, the Gardener in the dome, then out through the main gate', () => {
		const def = missionById('gardener') as MissionDef
		const world = new World({ seed: 9, map: missionMap(def), mission: { mission: def, difficulty: 'veteran' } })
		const player = world.addPlayer(1)
		player.safeUntilTick = 1e9
		player.x = 54.5
		player.y = 44.5
		steps(world, 3)
		expect(world.mission?.index).toBe(1)
		let gardener = -1
		for (let i = 0; i < world.alive.length; i++)
			if (world.alive[i] === 1 && world.type[i] === zombieIndex('gardener')) gardener = i
		expect(gardener).toBeGreaterThanOrEqual(0)
		world.damageZombie(gardener, (world.maxHealth[gardener] as number) * 0.5, 1, 'explosive')
		expect(world.phase[gardener]).toBe(1)
		world.damageZombie(gardener, 1e9, 1, 'explosive')
		steps(world, 3)
		expect(world.mission?.index).toBe(2)
	})
})

describe('mutations', () => {
	it('take the stage from the zone and the difficulty, and give each kind its traits', () => {
		expect(mutationStage({ zone: 'ashgate', difficulty: 'veteran' })).toBe(0)
		expect(mutationStage({ zone: 'harrow', difficulty: 'veteran' })).toBe(1)
		expect(mutationStage({ zone: 'ashgate', difficulty: 'apocalypse', extra: 1 })).toBe(3)
		expect(mutationStage({ rounds: 17 })).toBe(2)
		const drudge = zombieDef('drudge')
		const mutated = mutate(drudge, 2)
		expect(mutated.health).toBeCloseTo(drudge.health * 1.24)
		// armoured, then toxic
		expect(mutated.resist?.ballistic).toBeCloseTo(0.2)
		expect(mutated.meleeType).toBe('chemical')
		// a kind's own resistance stays (a Cinder in fire), added ones stop at the cap
		expect(mutate(zombieDef('cinder'), 3).resist?.fire).toBe(1)
		expect(mutate(zombieDef('warden'), 3)).toBe(zombieDef('warden'))
	})

	it('Survival mutates further as the rounds go by, and says so', () => {
		const world = new World({
			seed: 2,
			map: yard,
			survival: true,
			waves: {
				firstWaveDelaySeconds: 0,
				breakSeconds: 0,
				spawnPerSecond: 1,
				maxAlive: 300,
				waves: [{ drudge: 0 }],
				growthPerWave: 1
			}
		})
		world.addPlayer(1).safeUntilTick = 1e9
		const seen: number[] = []
		for (let n = 0; n < 30 * 40 && world.mutation < 1; n++) {
			world.step(new Map())
			for (const event of world.events) if (event.type === 'mutation') seen.push(event.stage)
		}
		expect(world.mutation).toBe(1)
		expect(seen).toEqual([1])
	})

	it('a squad that leans on one damage type meets a strain hardened against it', () => {
		const world = quietWorld()
		;(world as unknown as { survival: boolean }).survival = true
		world.addPlayer(1)
		const fire = zombieIndex('drudge')
		const strains: number[] = []
		for (let n = 0; n < 30 * 20 && world.strains.length === 0; n++) {
			const index = world.spawnZombie(fire, { x: 30, y: 30 })
			world.damageZombie(index, 500, 1, 'fire')
			world.step(new Map())
			for (const event of world.events) if (event.type === 'strain') strains.push(event.damage)
		}
		expect(strains).toEqual([DAMAGE_TYPES.indexOf('fire')])
		// the strain shrugs off fire; anything else hurts as before
		let strained = -1
		for (let n = 0; n < 40 && strained < 0; n++) {
			const index = world.spawnZombie(fire, { x: 30, y: 30 })
			if (world.strain[index]) strained = index
		}
		expect(strained).toBeGreaterThanOrEqual(0)
		const full = world.health[strained] as number
		world.damageZombie(strained, 10, 1, 'fire')
		expect(full - (world.health[strained] as number)).toBeCloseTo(6.5, 5)
	})
})

describe('bounties', () => {
	it('turn up in the middle step, a while in, and are reported down once', () => {
		const mission = { ...sweep, spawn: { ...sweep.spawn, perSecond: 0 } }
		const world = new World({
			seed: 6,
			map: yard,
			mission: { mission, difficulty: 'veteran', bounty: 'old-ironjaw' }
		})
		const player = world.addPlayer(1)
		player.safeUntilTick = 1e9
		const ironjaw = zombieIndex('old-ironjaw')
		const present = () => {
			for (let i = 0; i < world.alive.length; i++) if (world.alive[i] === 1 && world.type[i] === ironjaw) return i
			return -1
		}
		// the sweep's steps run 0..5: the middle one is 2 (reach the north gate)
		if (world.mission) world.mission.index = 2
		steps(world, 2)
		expect(present()).toBe(-1)
		const seen: string[] = []
		for (let n = 0; n < 25 * TICK_RATE && present() < 0; n++) {
			world.step(new Map())
			for (const event of world.events) seen.push(event.type)
		}
		expect(seen).toContain('bounty')
		const index = present()
		expect(index).toBeGreaterThanOrEqual(0)
		world.damageZombie(index, 1e9, 1, 'explosive')
		expect(world.events.filter(event => event.type === 'bounty-down')).toHaveLength(1)
		expect(world.mission?.bountyDown).toBe(true)
	})
})
