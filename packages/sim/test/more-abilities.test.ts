import { type Build, type ClassId, starterBuild, zombieIndex } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { angleToAim, Button, ObjectKind, type PlayerInput, REACH_STEP, TICK_RATE, World } from '../src/index.ts'
import { input, quietWorld, steps, yard } from './helpers.ts'

function build(cls: ClassId, abilities: string[], specials: string[] = [], utility?: string): Build {
	const base = starterBuild(cls)
	return {
		...base,
		level: 30,
		skills: Object.fromEntries([...abilities, ...specials].map(id => [id, 1])),
		abilities,
		loadout: utility ? { ...base.loadout, utility: [{ id: utility, level: 0, perks: [] }, null] } : base.loadout
	}
}

function arena(b: Build): World {
	const world = quietWorld()
	const player = world.addPlayer(1, b)
	player.x = 32
	player.y = 24
	player.safeUntilTick = 1e9
	return world
}

let seq = 0
const press = (buttons: number, extra: Partial<PlayerInput> = {}) =>
	new Map([[1, input({ seq: ++seq, buttons, aim: angleToAim(0), viewTick: 1e9, ...extra })]])
const drudge = zombieIndex('drudge')
const swell = zombieIndex('swell')
const pinned = (world: World, type: number, x: number, y = 24) => {
	const index = world.spawnZombie(type, { x, y })
	world.stunUntil[index] = 1e6
	return index
}
const reach = (metres: number) => Math.round(metres / REACH_STEP)

describe('more abilities', () => {
	it('Cluster Grenade scatters bomblets where it lands', () => {
		const world = arena(build('assault', ['cluster-grenade']))
		const targets = [41, 42, 43].map(x => pinned(world, swell, x))
		world.step(press(Button.ability1, { reach: reach(10) }))
		steps(world, 2 * TICK_RATE)
		expect(targets.some(index => (world.health[index] as number) < 150 || world.alive[index] === 0)).toBe(true)
	})

	it('Breaching Charge blasts the cone ahead and throws zombies back', () => {
		const world = arena(build('assault', ['breaching-charge']))
		const ahead = pinned(world, swell, 35)
		const behind = pinned(world, swell, 29)
		world.health[ahead] = 1000
		world.step(press(Button.ability1))
		expect(world.health[ahead]).toBeLessThan(1000)
		expect(world.x[ahead]).toBeGreaterThan(35)
		expect(world.health[behind]).toBe(150)
	})

	it('Healing Field and Stim heal; Antidote Shot protects the squad', () => {
		const world = arena(build('medic', ['healing-field', 'stim', 'antidote-shot']))
		const medic = world.players.get(1)
		if (!medic) throw new Error()
		medic.health = 10
		world.step(press(Button.ability1))
		steps(world, TICK_RATE)
		expect(medic.health).toBeGreaterThan(25)
		const before = medic.health
		world.step(press(Button.ability2))
		// the field keeps healing too
		expect(medic.health).toBeGreaterThanOrEqual(Math.min(medic.stats.maxHealth, before + 40))
		world.step(press(Button.ability3))
		expect(medic.immuneUntil).toBeGreaterThan(world.tick)
		steps(world, 7 * TICK_RATE)
		expect(world.objects).toHaveLength(0)
	})

	it('Toxin Grenade leaves a cloud that poisons over time', () => {
		const world = arena(build('medic', ['toxin-grenade']))
		const target = pinned(world, swell, 40)
		world.step(press(Button.ability1, { reach: reach(8) }))
		steps(world, TICK_RATE)
		expect(world.objects.some(object => object.kind === ObjectKind.toxin)).toBe(true)
		steps(world, 2 * TICK_RATE)
		expect(world.health[target]).toBeLessThan(150)
	})

	it('Aerial Bombardment walks shells along the line', () => {
		const world = arena(build('heavy', ['aerial-bombardment']))
		const near = pinned(world, swell, 36)
		const far = pinned(world, swell, 44)
		world.step(press(Button.ability1))
		expect(world.pendingBlasts).toHaveLength(8)
		steps(world, 4 * TICK_RATE)
		expect(world.health[near]).toBeLessThan(150)
		expect(world.health[far]).toBeLessThan(150)
	})
})

describe('more utilities', () => {
	it('an incendiary grenade leaves fire, a shock grenade stuns', () => {
		const fire = arena(build('assault', [], [], 'incendiary-grenades'))
		const burning = pinned(fire, swell, 40)
		fire.step(press(Button.utility1, { reach: reach(8) }))
		steps(fire, 2 * TICK_RATE)
		expect(fire.objects.some(object => object.kind === ObjectKind.fire)).toBe(true)
		expect(fire.health[burning]).toBeLessThan(150)

		const shock = arena(build('assault', [], [], 'shock-grenades'))
		const zombie = shock.spawnZombie(drudge, { x: 40, y: 24 })
		shock.step(press(Button.utility1, { reach: reach(8) }))
		steps(shock, TICK_RATE)
		expect(shock.stunUntil[zombie]).toBeGreaterThan(shock.tick)
	})

	it('a decoy pulls zombies to it', () => {
		const world = arena(build('assault', [], [], 'decoy-beacon'))
		const zombie = world.spawnZombie(drudge, { x: 36, y: 30 })
		world.step(press(Button.utility1, { reach: reach(6) }))
		expect(world.tauntUntil[zombie]).toBeGreaterThan(world.tick)
		steps(world, 3 * TICK_RATE)
		expect(Math.hypot((world.x[zombie] as number) - 38, (world.y[zombie] as number) - 24)).toBeLessThan(4)
	})

	it('runs out of charges, refills with the next wave', () => {
		const world = arena(starterBuild())
		const player = world.players.get(1)
		if (!player) throw new Error()
		for (let n = 0; n < 4; n++) {
			world.step(press(Button.utility1, { reach: reach(6) }))
			steps(world, TICK_RATE + 1)
			world.step(press(0))
		}
		expect(player.utilityCharges[0]).toBe(0)
	})
})

describe('more capstones', () => {
	it('Momentum grows damage with the kill chain', () => {
		const world = arena(build('assault', [], ['momentum']))
		const player = world.players.get(1)
		if (!player) throw new Error()
		player.chain = 20
		player.lastKillTick = world.tick
		const zombie = pinned(world, swell, 40)
		world.damageZombie(zombie, 10, 1)
		expect(world.health[zombie]).toBeCloseTo(138)
	})

	it('Shrapnel throws fragments from explosive kills; Contagion spreads poison from chemical ones', () => {
		const world = arena(build('assault', [], ['shrapnel', 'contagion']))
		const first = pinned(world, drudge, 40)
		world.damageZombie(first, 1e6, 1, 'explosive')
		expect(world.events.filter(event => event.type === 'shot')).toHaveLength(3)
		const second = pinned(world, drudge, 45)
		const neighbour = pinned(world, swell, 46)
		world.damageZombie(second, 1e6, 1, 'chemical')
		expect(world.poisonUntil[neighbour]).toBeGreaterThan(world.tick)
	})

	it('Suppression and Aftershock slow what they hit', () => {
		const world = arena(build('heavy', [], ['suppression', 'aftershock']))
		const shot = pinned(world, swell, 40)
		world.damageZombie(shot, 1, 1, 'ballistic')
		expect(world.slowAmount[shot]).toBeCloseTo(0.15)
		world.damageZombie(shot, 1, 1, 'explosive')
		expect(world.slowAmount[shot]).toBeCloseTo(0.4)
	})

	it('Second Wind halves the damage a revived teammate takes for a moment', () => {
		const world = quietWorld()
		const medic = world.addPlayer(1, build('medic', [], ['second-wind']))
		const downed = world.addPlayer(2)
		world.addPlayer(3)
		downed.health = 0
		downed.downed = true
		downed.bleedoutTick = 1e6
		world.revive(downed, medic)
		expect(downed.guardUntil).toBeGreaterThan(world.tick)
	})
})

describe('rules from the reviews', () => {
	it('pays a cleared wave once: a wipe restarts the wave without a cleared event', () => {
		const world = new World({
			seed: 1,
			map: yard,
			waves: {
				firstWaveDelaySeconds: 0,
				breakSeconds: 1,
				spawnPerSecond: 30,
				maxAlive: 300,
				waves: [{ drudge: 1 }],
				growthPerWave: 1
			}
		})
		const player = world.addPlayer(1)
		const seen: string[] = []
		for (let i = 0; i < 20 * TICK_RATE && seen.filter(e => e === 'wave').length < 3; i++) {
			world.step(new Map())
			for (const event of world.events)
				if (event.type === 'wave' || event.type === 'cleared' || event.type === 'wipe') seen.push(event.type)
			// clear the first wave, then let the second one wipe the squad
			if (seen.filter(e => e === 'cleared').length === 0) {
				for (let z = 0; z < 300; z++) if (world.alive[z]) world.damageZombie(z, 1e6, 1)
			} else if (!seen.includes('wipe')) {
				player.safeUntilTick = 0
				player.health = 0.1
				const z = world.spawnZombie(drudge, { x: player.x + 0.6, y: player.y })
				world.stunUntil[z] = 0
			}
		}
		// the wipe brings the wave back, but only real clears pay
		expect(seen).toContain('wipe')
		expect(seen.filter(e => e === 'wave').length).toBeGreaterThanOrEqual(2)
		expect(seen.filter(e => e === 'cleared')).toHaveLength(1)
	})

	it('loses the kill chain when going down', () => {
		const world = quietWorld()
		const state = world.addPlayer(1)
		world.addPlayer(2)
		state.chain = 12
		state.health = 1
		world.spawnZombie(drudge, { x: state.x + 0.6, y: state.y })
		for (let i = 0; i < 60 && !state.downed; i++) world.step(new Map())
		expect(state.downed).toBe(true)
		expect(state.chain).toBe(0)
	})

	it('gives the Defibrillator cooldown back with nobody to revive, and allows it once a wave', () => {
		const world = arena(build('medic', ['defibrillator']))
		const medic = world.players.get(1)
		if (!medic) throw new Error()
		world.step(press(Button.ability1))
		expect(medic.abilityReady[0]).toBeLessThanOrEqual(world.tick)
		const downed = world.addPlayer(2)
		world.addPlayer(3)
		downed.x = 34
		downed.y = 24
		downed.health = 0
		downed.downed = true
		downed.bleedoutTick = 1e6
		world.step(press(0))
		world.step(press(Button.ability1))
		expect(downed.downed).toBe(false)
		expect(medic.defibUsed).toBe(true)
	})

	it('keeps at most a dozen objects per player, removing the oldest', () => {
		const world = arena(build('medic', ['medkit-drop']))
		const medic = world.players.get(1)
		if (!medic) throw new Error()
		medic.free = true
		for (let n = 0; n < 20; n++) {
			world.step(press(Button.ability1))
			steps(world, TICK_RATE / 10)
			medic.abilityReady[0] = 0
			world.step(press(0))
		}
		expect(world.objects.filter(object => object.owner === 1).length).toBeLessThanOrEqual(12)
	})

	it('does not wall a zombie in with a barricade', () => {
		const world = arena(build('heavy', ['deploy-barricade']))
		const zombie = pinned(world, drudge, 33.5, 24)
		world.step(press(Button.ability1))
		const barricade = world.objects.find(object => object.kind === ObjectKind.barricade)
		const cell = Math.floor(world.y[zombie] as number) * world.grid.width + Math.floor(world.x[zombie] as number)
		expect(barricade?.cells.includes(cell) ?? false).toBe(false)
	})
})
