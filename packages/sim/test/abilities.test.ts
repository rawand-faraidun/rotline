import { type Build, type ClassId, maps, starterBuild, zombieIndex } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { angleToAim, Button, ObjectKind, type PlayerInput, REACH_STEP, TICK_RATE, World } from '../src/index.ts'
import { input, quietWorld, steps } from './helpers.ts'

/** A build with abilities equipped; the world does not check skill points, the API does. */
function withAbilities(cls: ClassId, abilities: string[], specials: string[] = []): Build {
	const skills = Object.fromEntries([...abilities, ...specials].map(id => [id, 1]))
	return { ...starterBuild(cls), level: 30, skills, abilities }
}

function arena(build: Build): World {
	const world = quietWorld()
	const player = world.addPlayer(1, build)
	player.x = 32
	player.y = 24
	return world
}

const drudge = zombieIndex('drudge')
const swell = zombieIndex('swell')
let seq = 0
const press = (buttons: number, extra: Partial<PlayerInput> = {}) =>
	new Map([[1, input({ seq: ++seq, buttons, aim: angleToAim(0), viewTick: 1e9, ...extra })]])
const idle = () => new Map([[1, input({ seq: ++seq, aim: angleToAim(0) })]])
const player = (world: World) => world.players.get(1) as NonNullable<ReturnType<World['players']['get']>>

describe('abilities', () => {
	it('Adrenaline Burst speeds the player up, then waits for its cooldown', () => {
		const world = arena(withAbilities('assault', ['adrenaline-burst']))
		world.step(press(Button.ability1, { moveX: 127 }))
		const start = player(world).x
		steps(world, TICK_RATE, () => new Map([[1, input({ seq: ++seq, moveX: 127 })]]))
		expect(player(world).x - start).toBeCloseTo(5.4 * 1.3, 0)
		const ready = player(world).abilityReady[0]
		expect(ready).toBeGreaterThan(world.tick + 30 * TICK_RATE)
		world.step(press(0))
		world.step(press(Button.ability1))
		expect(player(world).abilityReady[0]).toBe(ready)
	})

	it('Slide Dash covers 6 m in a quarter of a second', () => {
		const world = arena(withAbilities('assault', ['slide-dash']))
		world.step(press(Button.ability1, { moveX: 127 }))
		steps(world, 8, () => new Map([[1, input({ seq: ++seq, moveX: 127 })]]))
		expect(player(world).x - 32).toBeGreaterThan(5.5)
	})

	it('Overwatch makes the next magazine pierce', () => {
		const world = arena(withAbilities('assault', ['overwatch']))
		world.step(press(Button.ability1))
		const zombies = [36, 38, 40].map(x => world.spawnZombie(swell, { x, y: 24 }))
		world.step(press(Button.fire))
		expect(zombies.every(index => (world.health[index] as number) < 150)).toBe(true)
	})

	it('Minigun Spin-up fires without touching the magazine', () => {
		const world = arena(withAbilities('heavy', ['minigun-spin-up']))
		world.step(press(Button.ability1))
		const mag = player(world).weapons[0].mag
		steps(world, TICK_RATE, () => press(Button.fire))
		expect(player(world).weapons[0].mag).toBe(mag)
	})

	it('Shock Pulse stuns and hurts zombies around the Heavy', () => {
		const world = arena(withAbilities('heavy', ['shock-pulse']))
		const near = world.spawnZombie(swell, { x: 35, y: 24 })
		const far = world.spawnZombie(swell, { x: 45, y: 24 })
		world.step(press(Button.ability1))
		expect(world.health[near]).toBeLessThan(150)
		expect(world.health[far]).toBe(150)
		const x = world.x[near] as number
		steps(world, TICK_RATE)
		expect(world.x[near]).toBeCloseTo(x, 5)
	})

	it('Mortar Shot marks the spot, then lands where the player aims', () => {
		const world = arena(withAbilities('heavy', ['mortar-shot']))
		const target = world.spawnZombie(swell, { x: 44, y: 24 })
		world.stunUntil[target] = 1e6
		world.step(press(Button.ability1, { reach: Math.round(12 / REACH_STEP) }))
		expect(world.objects.some(object => object.kind === ObjectKind.marker)).toBe(true)
		steps(world, Math.round(1.3 * TICK_RATE))
		expect(world.objects.some(object => object.kind === ObjectKind.marker)).toBe(false)
		expect(world.alive[target]).toBe(0)
	})

	it('Medkit Drop heals 60 over five seconds', () => {
		const world = arena(withAbilities('medic', ['medkit-drop']))
		player(world).health = 20
		world.step(press(Button.ability1))
		steps(world, 6 * TICK_RATE)
		expect(player(world).health).toBeCloseTo(80, 0)
	})

	it('Deploy Barricade walls off cells that zombies must break', () => {
		const world = arena(withAbilities('heavy', ['deploy-barricade']))
		world.step(press(Button.ability1))
		const barricade = world.objects.find(object => object.kind === ObjectKind.barricade)
		expect(barricade?.cells.length).toBeGreaterThan(3)
		expect(barricade?.cells.every(cell => world.grid.walls[cell] === 2)).toBe(true)
		// a crowd on the far side tears it down
		for (const y of [22.5, 24, 25.5]) world.spawnZombie(drudge, { x: 34.8, y })
		player(world).safeUntilTick = 1e9
		steps(world, 60 * TICK_RATE)
		expect(world.objects.some(object => object.kind === ObjectKind.barricade)).toBe(false)
		expect(barricade?.cells.every(cell => world.grid.walls[cell] === 0)).toBe(true)
	})

	it('Taunt pulls zombies onto the Heavy', () => {
		const world = quietWorld()
		const heavy = world.addPlayer(1, withAbilities('heavy', ['taunt']))
		const other = world.addPlayer(2)
		heavy.x = 32
		heavy.y = 24
		other.x = 40
		other.y = 24
		heavy.safeUntilTick = other.safeUntilTick = 1e9
		const zombie = world.spawnZombie(drudge, { x: 38, y: 24 })
		world.step(press(Button.ability1))
		steps(world, 3 * TICK_RATE)
		expect(world.x[zombie]).toBeLessThan(36)
	})

	it('Mark Target makes a zombie take 40 % more damage', () => {
		const world = arena(withAbilities('assault', ['mark-target']))
		const zombie = world.spawnZombie(swell, { x: 40, y: 24 })
		world.step(press(Button.ability1))
		world.damageZombie(zombie, 10, 1)
		expect(world.health[zombie]).toBeCloseTo(136)
	})

	it('the Defibrillator revives a teammate 7 m away', () => {
		const world = quietWorld()
		const medic = world.addPlayer(1, withAbilities('medic', ['defibrillator']))
		const downed = world.addPlayer(2)
		world.addPlayer(3)
		medic.x = 32
		medic.y = 24
		downed.x = 39
		downed.y = 24
		downed.health = 0
		downed.downed = true
		downed.bleedoutTick = 1e6
		world.step(press(Button.ability1))
		expect(downed.downed).toBe(false)
	})
})

describe('utilities', () => {
	it('throws a frag grenade where the player aims and spends a charge', () => {
		const world = arena(starterBuild())
		const zombie = world.spawnZombie(drudge, { x: 40, y: 24 })
		world.stunUntil[zombie] = 1e6
		expect(player(world).utilityCharges[0]).toBe(3)
		world.step(press(Button.utility1, { reach: Math.round(8 / REACH_STEP) }))
		expect(player(world).utilityCharges[0]).toBe(2)
		steps(world, TICK_RATE)
		expect(world.alive[zombie]).toBe(0)
	})

	it('places a mine that waits for a zombie, and a sentry that shoots', () => {
		const build = starterBuild()
		const world = arena({
			...build,
			loadout: {
				...build.loadout,
				utility: [
					{ id: 'sticky-mines', level: 0, perks: [] },
					{ id: 'mini-sentry', level: 0, perks: [] }
				]
			}
		})
		world.step(press(Button.utility1))
		steps(world, TICK_RATE + 1)
		const zombie = world.spawnZombie(drudge, { x: 33, y: 24 })
		world.step(idle())
		expect(world.alive[zombie]).toBe(0)
		expect(world.objects.some(object => object.kind === ObjectKind.mine)).toBe(false)

		world.step(press(Button.utility2))
		const target = world.spawnZombie(swell, { x: 40, y: 24 })
		world.stunUntil[target] = 1e6
		steps(world, TICK_RATE)
		expect(world.health[target]).toBeLessThan(150)
	})
})

describe('capstones', () => {
	it('Last Rites leaves 1 health once per mission', () => {
		const world = arena(withAbilities('medic', [], ['last-rites']))
		const medic = player(world)
		medic.health = 5
		world.spawnZombie(drudge, { x: 32.9, y: 24 })
		for (let i = 0; i < 60 && medic.health === 5; i++) world.step(new Map())
		expect(medic.health).toBe(1)
		expect(medic.downed).toBe(false)
	})

	it('Executioner deals half again to badly hurt zombies', () => {
		const world = arena(withAbilities('assault', [], ['executioner']))
		const zombie = world.spawnZombie(swell, { x: 40, y: 24 })
		world.health[zombie] = 30
		world.damageZombie(zombie, 10, 1)
		expect(world.health[zombie]).toBe(15)
	})
})

describe('firing range', () => {
	it('has no cooldowns and dummies that never die and heal back', () => {
		const world = new World({ seed: 1, map: maps.range as NonNullable<typeof maps.range>, range: true })
		world.addPlayer(1, withAbilities('heavy', ['shock-pulse']))
		const dummy = world.spawnZombie(zombieIndex('target-dummy'), { x: 20, y: 15 })
		world.step(press(Button.ability1))
		world.step(press(0))
		world.step(press(Button.ability1))
		expect(player(world).abilityReady[0]).toBeLessThanOrEqual(world.tick)
		world.damageZombie(dummy, 1e6, 1)
		expect(world.alive[dummy]).toBe(1)
		world.damageZombie(dummy, 500, 1)
		steps(world, 4 * TICK_RATE)
		expect(world.health[dummy]).toBe(2000)
		expect(world.wave).toBe(0)
	})
})
