import { zombieIndex } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import {
	BLEEDOUT_SECONDS,
	BLEEDOUT_STEP_SECONDS,
	Button,
	DOWNED_SPEED,
	type PlayerInput,
	REVIVE_SECONDS,
	TICK_RATE,
	type World
} from '../src/index.ts'
import { input, quietWorld, steps } from './helpers.ts'

function downPlayer(world: World, id: number) {
	const state = world.players.get(id)
	if (!state) throw new Error('no player')
	state.health = 1
	// a drudge next to them finishes the job on its next swing
	const zombie = world.spawnZombie(zombieIndex('drudge'), { x: state.x + 0.5, y: state.y })
	for (let i = 0; i < 90 && !state.downed && state.alive; i++) world.step(new Map())
	world.damageZombie(zombie, 1e6, 0)
	return state
}

function squad(): World {
	const world = quietWorld()
	for (let id = 1; id <= 3; id++) world.addPlayer(id)
	// spread them out so one zombie only reaches one player
	const positions = [
		[32, 24],
		[20, 30],
		[44, 30]
	]
	for (const [index, [x, y]] of positions.entries()) {
		const state = world.players.get(index + 1)
		if (state) {
			state.x = x as number
			state.y = y as number
		}
	}
	return world
}

describe('downed and revive', () => {
	it('downs a player at zero health in co-op instead of removing them, pistol only and crawling', () => {
		const world = squad()
		const state = downPlayer(world, 1)
		expect(state.downed).toBe(true)
		expect(state.alive).toBe(true)
		expect(state.slot).toBe(2)
		const startX = state.x
		steps(world, TICK_RATE, () => new Map<number, PlayerInput>([[1, input({ moveX: 127, buttons: Button.slot1 })]]))
		expect(state.x - startX).toBeCloseTo(DOWNED_SPEED, 1)
		expect(state.slot).toBe(2)
	})

	it('revives after a teammate holds interact next to them, with 30 % health', () => {
		const world = squad()
		const state = downPlayer(world, 1)
		const helper = world.players.get(2)
		if (!helper) throw new Error('no helper')
		helper.x = state.x + 1
		helper.y = state.y
		const hold = new Map<number, PlayerInput>([[2, input({ buttons: Button.interact })]])
		steps(world, Math.round(REVIVE_SECONDS * TICK_RATE) - 2, () => hold)
		expect(state.downed).toBe(true)
		expect(state.reviveProgress).toBeGreaterThan(0)
		steps(world, 3, () => hold)
		expect(state.downed).toBe(false)
		expect(state.health).toBe(30)
		expect(state.slot).toBe(0)
	})

	it('resets revive progress when the helper lets go or walks away', () => {
		const world = squad()
		const state = downPlayer(world, 1)
		const helper = world.players.get(2)
		if (!helper) throw new Error('no helper')
		helper.x = state.x + 1
		helper.y = state.y
		steps(world, 30, () => new Map([[2, input({ buttons: Button.interact })]]))
		steps(world, 1, () => new Map([[2, input()]]))
		expect(state.reviveProgress).toBe(0)
	})

	it('bleeds out when nobody helps; later downs bleed out faster', () => {
		const world = squad()
		const state = downPlayer(world, 1)
		const first = state.bleedoutTick - world.tick
		expect(first).toBeLessThanOrEqual(BLEEDOUT_SECONDS * TICK_RATE)
		steps(world, first + 1)
		expect(state.alive).toBe(false)
		expect(state.downed).toBe(false)

		// a later down in the same life is shorter
		const other = squad()
		const twice = downPlayer(other, 1)
		const helper = other.players.get(2)
		if (!helper) throw new Error('no helper')
		helper.x = twice.x + 1
		helper.y = twice.y
		steps(other, Math.round(REVIVE_SECONDS * TICK_RATE) + 1, () => new Map([[2, input({ buttons: Button.interact })]]))
		downPlayer(other, 1)
		expect(twice.bleedoutTick - other.tick).toBeLessThanOrEqual((BLEEDOUT_SECONDS - BLEEDOUT_STEP_SECONDS) * TICK_RATE)
	})

	it('makes zombies ignore downed players', () => {
		const world = squad()
		const state = downPlayer(world, 1)
		const zombie = world.spawnZombie(zombieIndex('drudge'), { x: state.x + 0.6, y: state.y })
		const before = state.bleedoutTick
		steps(world, 60)
		expect(state.downed).toBe(true)
		expect(state.bleedoutTick).toBe(before)
		expect(Math.hypot((world.x[zombie] as number) - state.x, (world.y[zombie] as number) - state.y)).toBeGreaterThan(
			0.6
		)
	})
})

describe('wipes', () => {
	it('restarts the wave when nobody is left standing', () => {
		const world = squad()
		world.spawnZombie(zombieIndex('drudge'), { x: 5, y: 5 })
		for (const id of [1, 2, 3]) downPlayer(world, id)
		let wiped = false
		for (let i = 0; i < 5 && !wiped; i++) {
			if (world.events.some(event => event.type === 'wipe')) wiped = true
			world.step(new Map())
		}
		const all = [...world.players.values()]
		expect(all.every(state => !state.alive && !state.downed)).toBe(true)
		expect(world.aliveCount).toBe(0)
		steps(world, TICK_RATE * 4)
		expect([...world.players.values()].every(state => state.alive && state.health === 100)).toBe(true)
	})

	it('treats going down solo as a wipe', () => {
		const world = quietWorld()
		world.addPlayer(1)
		const state = downPlayer(world, 1)
		expect(state.alive).toBe(false)
		expect(state.downed).toBe(false)
	})
})
