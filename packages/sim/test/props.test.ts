import { type MapDef, type MissionDef, maps, missionById, propsDef, zombieIndex } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { Button, damageProp, type PlayerInput, PropState, TICK_RATE, World } from '../src/index.ts'
import { input, steps } from './helpers.ts'

const drudge = zombieIndex('drudge')

/** A small walled room with the props a test needs. */
function room(props: NonNullable<MapDef['props']>): MapDef {
	return {
		id: 'test-room',
		name: 'Test room',
		width: 30,
		height: 20,
		walls: [
			{ x: 0, y: 0, w: 30, h: 1 },
			{ x: 0, y: 19, w: 30, h: 1 },
			{ x: 0, y: 0, w: 1, h: 20 },
			{ x: 29, y: 0, w: 1, h: 20 },
			// a wall across the middle with a 3-cell doorway at y 9..11
			{ x: 15, y: 1, w: 1, h: 8 },
			{ x: 15, y: 12, w: 1, h: 7 }
		],
		playerSpawns: [
			{ x: 5, y: 10 },
			{ x: 5, y: 11 },
			{ x: 6, y: 10 },
			{ x: 6, y: 11 }
		],
		zombieSpawns: [
			{ x: 26, y: 10, section: 1 },
			{ x: 3, y: 3, section: 0 }
		],
		props
	}
}

const quiet = {
	firstWaveDelaySeconds: 1e6,
	breakSeconds: 1,
	spawnPerSecond: 1,
	maxAlive: 300,
	waves: [{ drudge: 0 }],
	growthPerWave: 1
}

const hold = (id = 1, buttons = Button.interact) => new Map<number, PlayerInput>([[id, input({ buttons })]])

describe('props', () => {
	it('sells a full reserve at an ammo station for score, never on credit', () => {
		const world = new World({
			seed: 1,
			map: room([{ id: 'ammo', kind: 'ammo', x: 7, y: 10, w: 2, h: 1 }]),
			waves: quiet
		})
		const player = world.addPlayer(1)
		player.x = 6.4
		player.y = 10.5
		const rifle = player.weapons[1]
		const max = player.stats.weapons[1].maxReserve as number
		rifle.reserve = 3
		const holdFor = (seconds: number) => steps(world, Math.ceil(seconds * TICK_RATE) + 1, () => hold())
		// no score yet: holding does nothing (this room has no mission, where it would be free: pretend it scores)
		Object.defineProperty(world, 'scoring', { get: () => true })
		holdFor(propsDef.ammo.holdSeconds)
		expect(rifle.reserve).toBe(3)
		// enough score: one hold refills every gun and the price is spent, the score itself kept
		player.score = propsDef.ammo.price + 100
		holdFor(propsDef.ammo.holdSeconds)
		expect(rifle.reserve).toBe(max)
		expect(player.scoreSpent).toBe(propsDef.ammo.price)
		expect(player.score).toBe(propsDef.ammo.price + 100)
		// full again, and only 100 left to spend: nothing more to buy
		rifle.reserve = 0
		holdFor(propsDef.ammo.holdSeconds)
		expect(rifle.reserve).toBe(0)
	})

	it('blocks with cover until it is shot apart, and barrels go off', () => {
		const world = new World({
			seed: 1,
			map: room([
				{ id: 'crate', kind: 'crate', x: 10, y: 10 },
				{ id: 'barrel', kind: 'barrel', x: 20, y: 10 }
			]),
			waves: quiet
		})
		expect(world.grid.isWall(10.5, 10.5)).toBe(true)
		const crate = world.propById.get('crate')
		const barrel = world.propById.get('barrel')
		if (!crate || !barrel) throw new Error()
		const player = world.addPlayer(1)
		player.x = 5
		player.y = 10.5
		// aim east at the crate and fire until it breaks
		for (let i = 0; i < 300 && crate.state !== PropState.destroyed; i++) {
			world.step(new Map([[1, input({ seq: i + 1, aim: 0, buttons: Button.fire })]]))
		}
		expect(crate.state).toBe(PropState.destroyed)
		expect(world.grid.isWall(10.5, 10.5)).toBe(false)
		// a zombie next to the barrel dies when it is blown up
		const zombie = world.spawnZombie(drudge, { x: 21.5, y: 12 })
		world.blast(20.5, 10.5, 1, 100, 'explosive', 1)
		expect(barrel.state).toBe(PropState.destroyed)
		expect(world.alive[zombie]).toBe(0)
	})

	it('opens and closes doors with a press, welds them with a hold, and zombies break them', () => {
		const world = new World({
			seed: 1,
			map: room([{ id: 'door', kind: 'door', x: 15, y: 9, w: 1, h: 3 }]),
			waves: quiet
		})
		const door = world.propById.get('door')
		if (!door) throw new Error()
		expect(door.state).toBe(PropState.open)
		const player = world.addPlayer(1)
		player.x = 13.6
		player.y = 10.5
		world.step(hold())
		expect(door.state).toBe(PropState.closed)
		expect(world.grid.isWall(15.5, 10.5)).toBe(true)
		// keep holding: welded once the door has swung shut and the weld time has passed
		steps(world, Math.round((propsDef.door.toggleSeconds + propsDef.door.weldSeconds) * TICK_RATE) + 4, () => hold())
		expect(door.state).toBe(PropState.welded)
		world.step(new Map())
		// a press does nothing to a welded door
		world.step(hold())
		expect(door.state).toBe(PropState.welded)
		// a zombie on the far side claws through
		// let go (holding on would mend the door as fast as it is clawed)
		world.step(new Map([[1, input()]]))
		world.spawnZombie(drudge, { x: 16.6, y: 10.5 })
		steps(world, 70 * TICK_RATE)
		expect(door.state).toBe(PropState.destroyed)
		expect(world.grid.isWall(15.5, 10.5)).toBe(false)
	})

	it('powers turrets from their generator and sets off traps', () => {
		const world = new World({
			seed: 1,
			map: room([
				{ id: 'generator', kind: 'generator', x: 5, y: 5, w: 2, h: 2 },
				{ id: 'turret', kind: 'turret', x: 10, y: 15, powerBy: 'generator' },
				{ id: 'trap', kind: 'trap', x: 22, y: 5 }
			]),
			waves: quiet
		})
		const generator = world.propById.get('generator')
		const turret = world.propById.get('turret')
		const trap = world.propById.get('trap')
		if (!generator || !turret || !trap) throw new Error()
		const player = world.addPlayer(1)
		player.x = 6
		player.y = 7.8
		const target = world.spawnZombie(drudge, { x: 12, y: 15.5 })
		world.stunUntil[target] = 1e6
		steps(world, 10)
		expect(turret.powered).toBe(false)
		expect(world.alive[target]).toBe(1)
		steps(world, Math.round(propsDef.generator.holdSeconds * TICK_RATE) + 2, () => hold())
		// it runs up first, then it is on
		expect(generator.state).toBe(PropState.active)
		// running up: its progress climbs for everyone to see, and is cleared once it is on
		steps(world, Math.round((propsDef.generator.startSeconds * TICK_RATE) / 2))
		expect(generator.progress).toBeGreaterThan(0.4)
		expect(generator.progress).toBeLessThan(0.6)
		steps(world, Math.round((propsDef.generator.startSeconds * TICK_RATE) / 2) + 1)
		expect(generator.progress).toBe(0)
		expect(generator.state).toBe(PropState.done)
		steps(world, 3 * TICK_RATE)
		expect(turret.powered).toBe(true)
		expect(world.alive[target]).toBe(0)
		// the trap
		player.x = 22
		player.y = 6.5
		const victim = world.spawnZombie(drudge, { x: 23, y: 5 })
		world.stunUntil[victim] = 1e6
		// let go of interact first: a press is a new hold
		world.step(new Map([[1, input()]]))
		world.step(hold())
		expect(trap.state).toBe(PropState.active)
		steps(world, 2 * TICK_RATE)
		expect(world.alive[victim]).toBe(0)
		steps(world, Math.round(propsDef.trap.activeSeconds * TICK_RATE))
		expect(trap.state).toBe(PropState.idle)
		// cooling down: a press does nothing yet
		world.step(new Map([[1, input()]]))
		world.step(hold())
		expect(trap.state).toBe(PropState.idle)
	})

	it('frees a survivor who then follows, and lets one player carry an object (slower)', () => {
		const world = new World({
			seed: 1,
			map: room([
				{ id: 'survivor', kind: 'survivor', x: 8, y: 10 },
				{ id: 'box', kind: 'carry', x: 5, y: 14 }
			]),
			waves: quiet
		})
		const survivor = world.propById.get('survivor')
		const box = world.propById.get('box')
		if (!survivor || !box) throw new Error()
		const player = world.addPlayer(1)
		player.x = 7
		player.y = 10
		steps(world, Math.round(propsDef.survivor.freeSeconds * TICK_RATE) + 2, () => hold())
		expect(survivor.state).toBe(PropState.following)
		// walk away east: the survivor comes along
		steps(world, 2 * TICK_RATE, () => new Map([[1, input({ moveX: 127 })]]))
		expect(survivor.x).toBeGreaterThan(9)
		// pick up the box
		player.x = 5
		player.y = 13
		world.step(new Map())
		steps(world, Math.round(propsDef.carry.pickupSeconds * TICK_RATE) + 2, () => hold())
		expect(box.state).toBe(PropState.carried)
		expect(player.carrying).toBe(true)
		const before = player.x
		world.step(new Map([[1, input({ moveX: 127 })]]))
		const carriedStep = player.x - before
		expect(carriedStep).toBeLessThan(player.stats.speed / TICK_RATE)
		expect(box.x).toBeCloseTo(player.x)
		// going down drops it
		player.downed = true
		world.step(new Map())
		expect(box.state).toBe(PropState.idle)
		expect(player.carrying).toBe(false)
	})

	it('lets revive win over props when a teammate is down', () => {
		const world = new World({
			seed: 1,
			map: room([{ id: 'generator', kind: 'generator', x: 5, y: 5, w: 2, h: 2 }]),
			waves: quiet
		})
		const generator = world.propById.get('generator')
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		a.x = 6
		a.y = 7.8
		b.x = 6.5
		b.y = 8
		b.downed = true
		b.bleedoutTick = 1e6
		steps(world, 10, () => hold())
		expect(generator?.progress).toBe(0)
	})
})

describe('campaign objectives', () => {
	function mission(map: MapDef, def: Partial<MissionDef>): World {
		const base = missionById('landfall') as MissionDef
		return new World({
			seed: 2,
			map,
			mission: {
				mission: { ...base, map: map.id, caches: [], gates: {}, spawn: { ...base.spawn, perSecond: 0 }, ...def },
				difficulty: 'veteran'
			}
		})
	}

	it('works generators for an interact objective and pays optional objectives once', () => {
		const map = room([
			{ id: 'g1', kind: 'generator', x: 5, y: 5, w: 1, h: 1 },
			{ id: 'g2', kind: 'generator', x: 8, y: 5, w: 1, h: 1 }
		])
		const world = mission(map, {
			objectives: [
				{ type: 'interact', label: 'Power', props: ['g1', 'g2'] },
				{ type: 'survive', label: 'Wait', seconds: 30 },
				{ type: 'kill', label: 'Optional', count: 3, optional: true }
			]
		})
		const player = world.addPlayer(1)
		const work = (x: number) => {
			player.x = x
			player.y = 6.8
			steps(world, Math.round(propsDef.generator.holdSeconds * TICK_RATE) + 2, () => hold())
		}
		work(5.5)
		steps(world, Math.round(propsDef.generator.startSeconds * TICK_RATE) + 1)
		expect(world.mission?.progress).toBe(1)
		work(8.5)
		steps(world, Math.round(propsDef.generator.startSeconds * TICK_RATE) + 2)
		expect(world.mission?.index).toBe(1)
		for (let n = 0; n < 3; n++) world.damageZombie(world.spawnZombie(drudge, { x: 20, y: 5 }), 1e9, 1)
		world.step(new Map())
		expect(world.mission?.optionalDone).toEqual([2])
		expect(world.events.filter(event => event.type === 'objective' && event.index === 2)).toHaveLength(1)
	})

	it('fails a defend objective when the target falls, back to the checkpoint with it restored', () => {
		const map = room([{ id: 'core', kind: 'defend', x: 20, y: 10, w: 2, h: 2, health: 50 }])
		const world = mission(map, {
			objectives: [
				{ type: 'reach', label: 'Go', area: { x: 6, y: 10, radius: 3 }, checkpoint: true },
				{ type: 'defend', label: 'Defend', prop: 'core', seconds: 30 }
			]
		})
		world.addPlayer(1)
		world.step(new Map())
		expect(world.mission?.index).toBe(1)
		const core = world.propById.get('core')
		if (!core) throw new Error()
		world.spawnZombie(drudge, { x: 23, y: 10.5 })
		let failed = false
		for (let i = 0; i < 60 * TICK_RATE && !failed; i++) {
			world.step(new Map())
			failed = world.events.some(event => event.type === 'failed')
		}
		expect(failed).toBe(true)
		expect(core.state).toBe(PropState.idle)
		expect(core.health).toBe(50)
		expect(world.mission?.index).toBe(1)
	})

	it('rescues survivors who reach the area, and extraction needs everyone before the time runs out', () => {
		const map = room([{ id: 's1', kind: 'survivor', x: 8, y: 10 }])
		const world = mission(map, {
			objectives: [
				{ type: 'rescue', label: 'Rescue', survivors: ['s1'], area: { x: 22, y: 10, radius: 3 } },
				{ type: 'extract', label: 'Out', area: { x: 4, y: 4, radius: 2 }, seconds: 3 }
			]
		})
		const player = world.addPlayer(1)
		player.x = 7
		player.y = 10
		steps(world, Math.round(propsDef.survivor.freeSeconds * TICK_RATE) + 2, () => hold())
		const survivor = world.propById.get('s1')
		expect(survivor?.state).toBe(PropState.following)
		for (let i = 0; i < 20 * TICK_RATE && world.mission?.index === 0; i++) {
			world.step(new Map([[1, input({ moveX: player.x < 22 ? 127 : 0 })]]))
		}
		expect(survivor?.state).toBe(PropState.delivered)
		expect(world.mission?.index).toBe(1)
		// standing still far from the pad: the time runs out and the squad goes back
		let failed = false
		for (let i = 0; i < 4 * TICK_RATE && !failed; i++) {
			world.step(new Map())
			failed = world.events.some(event => event.type === 'failed')
		}
		expect(failed).toBe(true)
	})

	it('opens a gate on an objective, closes it behind, and brings stragglers through', () => {
		const map = room([{ id: 'gate', kind: 'door', x: 15, y: 9, w: 1, h: 3, locked: true }])
		const world = mission(map, {
			gates: { gate: { openOn: 0, closeOn: 1 } },
			objectives: [
				{ type: 'reach', label: 'One', area: { x: 6, y: 10, radius: 3 } },
				{ type: 'reach', label: 'Two', area: { x: 22, y: 10, radius: 3 }, checkpoint: true },
				{ type: 'survive', label: 'Three', seconds: 60 }
			]
		})
		const gate = world.propById.get('gate')
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		expect(world.grid.isWall(15.5, 10.5)).toBe(true)
		world.step(new Map())
		expect(gate?.state).toBe(PropState.open)
		expect(world.grid.isWall(15.5, 10.5)).toBe(false)
		a.x = 22
		a.y = 10
		b.x = 5
		b.y = 10
		world.step(new Map())
		expect(gate?.state).toBe(PropState.locked)
		expect(b.x).toBeGreaterThan(16)
	})

	it('spawns only in the sections an objective names', () => {
		const map = room([])
		const world = mission(map, {
			spawn: { perSecond: 5, maxAlive: 50, composition: { drudge: 1 } },
			objectives: [{ type: 'survive', label: 'Wait', seconds: 60, sections: [1] }]
		})
		world.addPlayer(1)
		steps(world, 3 * TICK_RATE)
		for (let i = 0; i < 300; i++) if (world.alive[i] === 1) expect(world.x[i]).toBeGreaterThan(15)
		expect(maps.landfall?.props?.some(prop => prop.id === 'gate-crash')).toBe(true)
	})
})

describe('more prop rules', () => {
	it('will not close a door on someone standing in it, and locked gates take no damage', () => {
		const world = new World({
			seed: 1,
			map: room([
				{ id: 'door', kind: 'door', x: 15, y: 9, w: 1, h: 3 },
				{ id: 'gate', kind: 'door', x: 20, y: 5, w: 1, h: 1, locked: true }
			]),
			waves: quiet
		})
		const door = world.propById.get('door')
		const gate = world.propById.get('gate')
		if (!door || !gate) throw new Error()
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		a.x = 14
		a.y = 10.5
		b.x = 15.5
		b.y = 10.5
		world.step(hold())
		expect(door.state).toBe(PropState.open)
		damageProp(world, gate, 1e6, 0)
		expect(gate.state).toBe(PropState.locked)
		// an open door takes no damage either
		damageProp(world, door, 1e6, 0)
		expect(door.state).toBe(PropState.open)
	})

	it('hurts players near an exploding barrel and lets a survivor follow someone else when their leader falls', () => {
		const world = new World({
			seed: 1,
			map: room([
				{ id: 'barrel', kind: 'barrel', x: 8, y: 4 },
				{ id: 'survivor', kind: 'survivor', x: 8, y: 14 }
			]),
			waves: quiet
		})
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		a.x = 8.5
		a.y = 6
		b.x = 20
		b.y = 14
		const health = a.health
		const barrel = world.propById.get('barrel')
		if (!barrel) throw new Error()
		damageProp(world, barrel, 1e6, 0)
		expect(a.health).toBeLessThan(health)
		const survivor = world.propById.get('survivor')
		if (!survivor) throw new Error()
		survivor.state = PropState.following
		survivor.with = 1
		a.downed = true
		a.bleedoutTick = 1e6
		steps(world, 5)
		expect(survivor.with).toBe(2)
		expect(survivor.x).toBeGreaterThan(8)
	})

	it('lets go of partial holds: a weld starts over, a generator keeps its work', () => {
		const world = new World({
			seed: 1,
			map: room([
				{ id: 'door', kind: 'door', x: 15, y: 9, w: 1, h: 3, closed: true },
				{ id: 'generator', kind: 'generator', x: 5, y: 5 }
			]),
			waves: quiet
		})
		const door = world.propById.get('door')
		const generator = world.propById.get('generator')
		if (!door || !generator) throw new Error()
		const player = world.addPlayer(1)
		player.x = 13.6
		player.y = 10.5
		// the first press opens it; once it has swung, close it again and start welding
		world.step(hold())
		steps(world, Math.round(propsDef.door.toggleSeconds * TICK_RATE) + 1, () => new Map([[1, input()]]))
		world.step(hold())
		steps(world, Math.round(propsDef.door.toggleSeconds * TICK_RATE) + 10, () => hold())
		expect(door.progress).toBeGreaterThan(0)
		world.step(new Map([[1, input()]]))
		expect(door.progress).toBe(0)
		player.x = 5.5
		player.y = 6.9
		steps(world, 10, () => hold())
		const work = generator.progress
		expect(work).toBeGreaterThan(0)
		world.step(new Map([[1, input()]]))
		expect(generator.progress).toBe(work)
	})
})

describe('more objectives', () => {
	function mission(map: MapDef, def: Partial<MissionDef>): World {
		const base = missionById('landfall') as MissionDef
		return new World({
			seed: 2,
			map,
			mission: {
				mission: { ...base, map: map.id, caches: [], gates: {}, spawn: { ...base.spawn, perSecond: 0 }, ...def },
				difficulty: 'veteran'
			}
		})
	}

	it('carries an object to an area, then extracts once everyone is on the pad', () => {
		const map = room([{ id: 'box', kind: 'carry', x: 6, y: 13 }])
		const world = mission(map, {
			objectives: [
				{ type: 'retrieve', label: 'Bring it', item: 'box', area: { x: 10, y: 13, radius: 1.5 } },
				{ type: 'extract', label: 'Out', area: { x: 10, y: 13, radius: 3 }, seconds: 30 },
				{ type: 'interact', label: 'Optional', props: ['box'], optional: true }
			].map(objective => objective as MissionDef['objectives'][number])
		})
		const player = world.addPlayer(1)
		player.x = 6
		player.y = 12
		steps(world, Math.round(propsDef.carry.pickupSeconds * TICK_RATE) + 2, () => hold())
		for (let i = 0; i < 5 * TICK_RATE && world.mission?.index === 0; i++) {
			world.step(new Map([[1, input({ moveX: player.x < 10 ? 127 : 0 })]]))
		}
		expect(world.propById.get('box')?.state).toBe(PropState.delivered)
		expect(player.carrying).toBe(false)
		steps(world, 3)
		expect(world.mission?.status).toBe(2)
	})
})

describe('review fixes', () => {
	function mission(map: MapDef, def: Partial<MissionDef>): World {
		const base = missionById('landfall') as MissionDef
		return new World({
			seed: 2,
			map,
			mission: {
				mission: { ...base, map: map.id, caches: [], gates: {}, spawn: { ...base.spawn, perSecond: 0 }, ...def },
				difficulty: 'veteran'
			}
		})
	}

	it('mends a damaged defend target with a hold, and works nothing through a wall', () => {
		const world = new World({
			seed: 1,
			map: room([
				{ id: 'core', kind: 'defend', x: 10, y: 10, w: 2, h: 2, health: 400 },
				{ id: 'terminal', kind: 'terminal', x: 16, y: 5 }
			]),
			waves: quiet
		})
		const core = world.propById.get('core')
		const terminal = world.propById.get('terminal')
		if (!core || !terminal) throw new Error()
		core.health = 100
		const player = world.addPlayer(1)
		player.x = 9.4
		player.y = 11
		steps(world, TICK_RATE, () => hold())
		expect(core.health).toBeGreaterThan(100 + propsDef.repairPerSecond * 0.9)
		// the terminal is just past the wall at x = 15: from x = 14.5 it is in reach but not in sight
		player.x = 14.4
		player.y = 5.5
		steps(world, 10, () => hold())
		expect(terminal.progress).toBe(0)
	})

	it('stops a generator that is broken while it runs up, and only lets objective props be worked on their step', () => {
		const map = room([
			{ id: 'g1', kind: 'generator', x: 5, y: 5 },
			{ id: 't1', kind: 'terminal', x: 8, y: 5 }
		])
		const world = mission(map, {
			objectives: [
				{ type: 'interact', label: 'Power', props: ['g1'] },
				{ type: 'interact', label: 'Hack', props: ['t1'] }
			]
		})
		const player = world.addPlayer(1)
		const g1 = world.propById.get('g1')
		const t1 = world.propById.get('t1')
		if (!g1 || !t1) throw new Error()
		// the terminal belongs to the next step: no work on it yet
		player.x = 8.5
		player.y = 6.8
		steps(world, 10, () => hold())
		expect(t1.progress).toBe(0)
		player.x = 5.5
		steps(world, Math.round(propsDef.generator.holdSeconds * TICK_RATE) + 2, () => hold())
		expect(g1.state).toBe(PropState.active)
		damageProp(world, g1, 1e6, 0)
		expect(g1.state).toBe(PropState.idle)
	})

	it('fails a rescue only when every survivor is lost', () => {
		const map = room([
			{ id: 's1', kind: 'survivor', x: 8, y: 10 },
			{ id: 's2', kind: 'survivor', x: 8, y: 14 }
		])
		const world = mission(map, {
			objectives: [
				{ type: 'rescue', label: 'Rescue', survivors: ['s1', 's2'], area: { x: 22, y: 10, radius: 3 } },
				{ type: 'survive', label: 'Wait', seconds: 60 }
			]
		})
		world.addPlayer(1)
		world.step(new Map())
		const s1 = world.propById.get('s1')
		const s2 = world.propById.get('s2')
		if (!s1 || !s2) throw new Error()
		damageProp(world, s1, 1e6, 0)
		expect(world.events.some(event => event.type === 'failed')).toBe(false)
		// the other walks to safety: the rescue is done with one saved
		s2.state = PropState.following
		s2.x = 22
		s2.y = 10
		world.step(new Map())
		expect(world.mission?.index).toBe(1)
	})

	it('does not wait at the extraction for players who are away or idle', () => {
		const map = room([])
		const world = mission(map, {
			objectives: [{ type: 'extract', label: 'Out', area: { x: 5, y: 10, radius: 3 }, seconds: 30 }]
		})
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		a.x = 5
		a.y = 10
		b.x = 25
		b.y = 10
		b.away = true
		world.step(new Map([[1, input({ aim: 100 })]]))
		expect(world.mission?.status).toBe(2)
	})

	it('brings survivors, stragglers caught in the gate and loose objects through when a gate closes', () => {
		const map = room([
			{ id: 'gate', kind: 'door', x: 15, y: 9, w: 1, h: 3, locked: true },
			{ id: 's1', kind: 'survivor', x: 5, y: 14 }
		])
		const world = mission(map, {
			gates: { gate: { openOn: 0, closeOn: 1, side: { x: 22, y: 10 } } },
			objectives: [
				{ type: 'reach', label: 'One', area: { x: 6, y: 10, radius: 3 } },
				{ type: 'reach', label: 'Two', area: { x: 22, y: 10, radius: 3 } },
				{ type: 'survive', label: 'Three', seconds: 60 }
			]
		})
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		world.step(new Map())
		const s1 = world.propById.get('s1')
		if (!s1) throw new Error()
		s1.state = PropState.following
		s1.with = 2
		a.x = 22
		a.y = 10
		// b stands in the doorway itself
		b.x = 15.2
		b.y = 10.5
		const zombie = world.spawnZombie(drudge, { x: 15.5, y: 9.6 })
		world.step(new Map())
		expect(b.x).toBeGreaterThan(16)
		expect(world.grid.circleHitsWall(b.x, b.y, 0.4)).toBe(false)
		expect(s1.x).toBeGreaterThan(16)
		expect(world.alive[zombie]).toBe(0)
		expect(world.freeSpotNear(15.5, 10.5, 0.4).x).not.toBe(15.5)
	})

	it('hurts only the player who set a barrel off', () => {
		const world = new World({ seed: 1, map: room([{ id: 'barrel', kind: 'barrel', x: 8, y: 4 }]), waves: quiet })
		const a = world.addPlayer(1)
		const b = world.addPlayer(2)
		a.x = 8.5
		a.y = 6
		b.x = 9
		b.y = 6
		const barrel = world.propById.get('barrel')
		if (!barrel) throw new Error()
		damageProp(world, barrel, 1e6, 1)
		expect(a.health).toBeLessThan(a.stats.maxHealth)
		expect(b.health).toBe(b.stats.maxHealth)
	})

	it('runs set pieces: an ambush and a boss when an objective starts, nests to destroy, screamers that call', () => {
		const base = missionById('yard-sweep') as MissionDef
		const map = room([
			{ id: 'n1', kind: 'nest', x: 20, y: 4 },
			{ id: 'n2', kind: 'nest', x: 20, y: 15 }
		])
		const world = new World({
			seed: 4,
			map,
			mission: {
				mission: {
					...base,
					map: map.id,
					caches: [],
					gates: {},
					spawn: { ...base.spawn, perSecond: 0 },
					objectives: [
						{
							type: 'destroy',
							label: 'Burn the nests',
							props: ['n1', 'n2'],
							ambush: { count: 6, composition: { crawler: 1 } },
							boss: { type: 'brute', at: { x: 25, y: 10 } }
						},
						{ type: 'survive', label: 'Wait', seconds: 60 }
					]
				},
				difficulty: 'veteran'
			}
		})
		const player = world.addPlayer(1)
		player.x = 18
		player.y = 9
		world.step(new Map())
		// the boss is there at once; the ambush pours in a few a tick
		const brute = zombieIndex('brute')
		const crawler = zombieIndex('crawler')
		const count = (type: number) => {
			let n = 0
			for (let i = 0; i < world.alive.length; i++) if (world.alive[i] && world.type[i] === type) n++
			return n
		}
		expect(count(brute)).toBe(1)
		steps(world, 10)
		// (scaled by difficulty and squad size, like the stream)
		expect(count(crawler)).toBeGreaterThan(0)
		expect(world.mission?.burst).toBe(0)
		// nests wake for players nearby and send zombies out
		const before = world.aliveCount
		steps(world, Math.round(propsDef.nest.spawnEverySeconds * TICK_RATE) + 2)
		expect(world.aliveCount).toBeGreaterThan(before)
		// destroying both nests completes the objective
		for (const id of ['n1', 'n2']) {
			const nest = world.propById.get(id)
			if (!nest) throw new Error()
			damageProp(world, nest, 1e6, 1)
			expect(nest.state).toBe(PropState.destroyed)
		}
		world.step(new Map())
		expect(world.mission?.index).toBe(1)
		// a screamer near players calls others in
		const screamer = world.spawnZombie(zombieIndex('screamer'), { x: 19, y: 9 })
		world.callAt[screamer] = world.tick + 1
		const alive = world.aliveCount
		steps(world, 3)
		expect(world.events.some(event => event.type === 'scream') || world.aliveCount > alive).toBe(true)
	})
})
