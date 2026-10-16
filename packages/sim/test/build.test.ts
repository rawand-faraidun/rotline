import { type Build, type ItemRef, starterBuild, zombieIndex } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { angleToAim, Button, type PlayerInput, TICK_RATE, type World } from '../src/index.ts'
import { input, quietWorld, steps } from './helpers.ts'

const ref = (id: string, level = 0, perks: string[] = []): ItemRef => ({ id, level, perks })

function withMain(id: string, level = 0, perks: string[] = []): Build {
	const build = starterBuild()
	return { ...build, loadout: { ...build.loadout, main: [ref(id, level, perks), build.loadout.main[1]] } }
}

/** One player at (32, 24) facing +x with the given build. */
function arena(build: Build = starterBuild()): { world: World; fire: Map<number, PlayerInput> } {
	const world = quietWorld()
	const player = world.addPlayer(1, build)
	player.x = 32
	player.y = 24
	return { world, fire: new Map([[1, input({ buttons: Button.fire, aim: angleToAim(0) })]]) }
}

const drudge = zombieIndex('drudge')
const swell = zombieIndex('swell')

describe('builds in the simulation', () => {
	it('uses the class: Heavy has more health and moves slower than Assault', () => {
		const world = quietWorld()
		const assault = world.addPlayer(1, starterBuild('assault'))
		const heavy = world.addPlayer(2, starterBuild('heavy'))
		expect(heavy.health).toBe(140)
		assault.x = heavy.x = 32
		assault.y = 20
		heavy.y = 28
		const move = new Map([
			[1, input({ moveX: 127 })],
			[2, input({ moveX: 127 })]
		])
		steps(world, TICK_RATE, () => move)
		expect(assault.x - 32).toBeCloseTo(5.4, 1)
		expect(heavy.x - 32).toBeCloseTo(4.4, 1)
	})

	it('uses upgraded magazines and carried ammunition', () => {
		const { world } = arena(withMain('k-71', 10))
		const player = world.players.get(1)
		expect(player?.weapons[0].mag).toBe(45)
		expect(player?.weapons[0].reserve).toBe(378)
	})

	it('reduces melee damage with armour', () => {
		const { world } = arena()
		const player = world.players.get(1)
		if (!player) throw new Error()
		world.spawnZombie(drudge, { x: 32.9, y: 24 })
		for (let i = 0; i < 60 && player.health === 100; i++) world.step(new Map())
		// a Drudge hits for 10; 20 armour takes a quarter of that
		expect(100 - player.health).toBeCloseTo(7.5)
	})

	it('fires every pellet of a shotgun and reloads it shell by shell', () => {
		const { world, fire } = arena(withMain('breacher-12'))
		world.step(fire)
		expect(world.events.filter(event => event.type === 'shot')).toHaveLength(8)
		const player = world.players.get(1)
		if (!player) throw new Error()
		player.weapons[0].mag = 0
		const reload = new Map([[1, input({ seq: 2, buttons: Button.reload })]])
		world.step(reload)
		steps(world, Math.round(0.5 * TICK_RATE) + 1)
		// one shell after half a second, still loading
		world.step(new Map([[1, input({ seq: 3 })]]))
		expect(player.weapons[0].mag).toBe(1)
		expect(player.reloadEndTick).not.toBe(0)
	})

	it('pierces with the sniper rifle', () => {
		const { world, fire } = arena(withMain('longstride'))
		const zombies = [36, 38, 40, 42, 44].map(x => world.spawnZombie(drudge, { x, y: 24 }))
		world.step(fire)
		// pierces three: the first four die, the fifth is untouched
		expect(zombies.map(index => world.alive[index])).toEqual([0, 0, 0, 0, 1])
	})

	it('burns everything in the flamethrower’s cone and nothing outside it', () => {
		const { world, fire } = arena(withMain('kiln'))
		const inside = world.spawnZombie(drudge, { x: 36, y: 24.5 })
		const outside = world.spawnZombie(drudge, { x: 32, y: 28 })
		steps(world, TICK_RATE, () => fire)
		expect(world.alive[inside]).toBe(0)
		expect(world.alive[outside]).toBe(1)
	})

	it('launches a grenade that explodes on the first zombie and hurts its neighbours', () => {
		const { world, fire } = arena(withMain('thumper'))
		const target = world.spawnZombie(swell, { x: 42, y: 24 })
		const neighbour = world.spawnZombie(drudge, { x: 43.5, y: 25 })
		world.step(fire)
		expect(world.events.some(event => event.type === 'launch')).toBe(true)
		const explosions: number[] = []
		for (let i = 0; i < TICK_RATE && explosions.length === 0; i++) {
			world.step(new Map())
			for (const event of world.events) if (event.type === 'explode') explosions.push(event.x)
		}
		expect(explosions[0]).toBeGreaterThan(40)
		expect(world.health[target]).toBeLessThan(150)
		expect(world.alive[neighbour]).toBe(0)
	})

	it('chains lightning to the nearest zombies', () => {
		const { world, fire } = arena(withMain('arclight'))
		const zombies = [38, 41, 44, 47, 52].map(x => world.spawnZombie(swell, { x, y: 24 + (x % 2) * 2 }))
		world.step(fire)
		const hurt = zombies.map(index => (world.health[index] as number) < 150)
		// the first hit plus three jumps of at most 5 m; the last is 5 m beyond the fourth
		expect(hurt).toEqual([true, true, true, true, false])
	})

	it('lets a Medic revive faster than the default', () => {
		const run = (reviver: Build) => {
			const world = quietWorld()
			const downed = world.addPlayer(1)
			const helper = world.addPlayer(2, reviver)
			const third = world.addPlayer(3)
			downed.x = helper.x = 32
			downed.y = 24
			helper.y = 25
			third.x = 10
			downed.health = 0
			downed.downed = true
			downed.bleedoutTick = 1e6
			let ticks = 0
			const hold = new Map([[2, input({ buttons: Button.interact })]])
			while (downed.downed && ticks < 10 * TICK_RATE) {
				world.step(hold)
				ticks++
			}
			return ticks / TICK_RATE
		}
		expect(run(starterBuild('assault'))).toBeCloseTo(4, 1)
		expect(run(starterBuild('medic'))).toBeCloseTo(2.5, 1)
	})

	it('heals on kills with Second Breath', () => {
		const build: Build = {
			...starterBuild('assault'),
			level: 10,
			skills: { 'adrenaline-burst': 1, 'fleet-foot': 2, 'quick-hands': 1, 'steady-aim': 1, 'second-breath': 1 }
		}
		const { world, fire } = arena(build)
		const player = world.players.get(1)
		if (!player) throw new Error()
		player.health = 50
		world.spawnZombie(drudge, { x: 37, y: 24 })
		steps(world, TICK_RATE, () => fire)
		expect(player.health).toBe(51)
	})
})
