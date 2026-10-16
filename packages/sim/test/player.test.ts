import { weapons } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { activeWeapon, Button, createPlayer, Grid, stepPlayer, TICK_RATE } from '../src/index.ts'
import { input, yard } from './helpers.ts'

const grid = new Grid(yard)

describe('movement', () => {
	it('moves at the class speed and clamps diagonals', () => {
		const player = createPlayer(1, 32, 24)
		for (let t = 0; t < TICK_RATE; t++) stepPlayer(grid, player, input({ moveX: 127 }), t)
		expect(player.x).toBeCloseTo(32 + 5.4, 3)

		const diagonal = createPlayer(2, 32, 24)
		for (let t = 0; t < TICK_RATE; t++) stepPlayer(grid, diagonal, input({ moveX: 127, moveY: 127 }), t)
		expect(Math.hypot(diagonal.x - 32, diagonal.y - 24)).toBeCloseTo(5.4, 3)
	})

	it('stops flush against walls and slides along them', () => {
		// the yard's outer wall is the cell column x = 0
		const player = createPlayer(1, 3, 24)
		for (let t = 0; t < 60; t++) stepPlayer(grid, player, input({ moveX: -127, moveY: 40 }), t)
		expect(player.x).toBeGreaterThanOrEqual(1 + 0.4 - 1e-3)
		expect(player.x).toBeLessThan(1.45)
		expect(player.y).toBeGreaterThan(24)
	})
})

describe('weapons', () => {
	it('starts with two main weapons and a pistol with unlimited reserve', () => {
		const player = createPlayer(1, 32, 24)
		const slots = player.weapons.map(weapon => (weapons[weapon.def]?.kind === 'pistol' ? 'pistol' : 'main'))
		expect(slots).toEqual(['main', 'main', 'pistol'])
		expect(player.weapons[2].reserve).toBe(-1)
	})

	it('fires at the weapon fire rate while the trigger is held', () => {
		const player = createPlayer(1, 32, 24)
		const def = activeWeapon(player)
		let shots = 0
		for (let t = 0; t < TICK_RATE; t++) if (stepPlayer(grid, player, input({ buttons: Button.fire }), t)) shots++
		expect(shots).toBe(Math.min(def.magazine, Math.round(def.fireRate / 60)))
	})

	it('needs a fresh press for semi-automatic weapons', () => {
		const player = createPlayer(1, 32, 24)
		stepPlayer(grid, player, input({ buttons: Button.slot3 }), 0)
		let shots = 0
		for (let t = 20; t < 60; t++) if (stepPlayer(grid, player, input({ buttons: Button.fire }), t)) shots++
		expect(shots).toBe(1)
	})

	it('reloads from carried ammunition and stops at an empty reserve', () => {
		const player = createPlayer(1, 32, 24)
		const def = activeWeapon(player)
		const held = player.weapons[0]
		held.mag = 0
		held.reserve = 10
		stepPlayer(grid, player, input({ buttons: Button.reload }), 0)
		const done = Math.round(def.reloadSeconds * TICK_RATE)
		stepPlayer(grid, player, input(), done - 1)
		expect(held.mag).toBe(0)
		stepPlayer(grid, player, input(), done)
		expect(held.mag).toBe(10)
		expect(held.reserve).toBe(0)

		held.mag = 0
		stepPlayer(grid, player, input({ buttons: Button.reload }), done + 1)
		expect(player.reloadEndTick).toBe(0)
	})

	it('never runs the pistol out of reserve', () => {
		const player = createPlayer(1, 32, 24)
		stepPlayer(grid, player, input({ buttons: Button.slot3 }), 0)
		const pistol = player.weapons[2]
		for (let round = 0; round < 5; round++) {
			pistol.mag = 0
			const t = 100 + round * 100
			stepPlayer(grid, player, input({ buttons: Button.reload }), t)
			stepPlayer(grid, player, input(), t + 60)
			expect(pistol.mag).toBe(weapons[pistol.def]?.magazine)
			expect(pistol.reserve).toBe(-1)
		}
	})

	it('reloads automatically when firing an empty magazine', () => {
		const player = createPlayer(1, 32, 24)
		player.weapons[0].mag = 0
		expect(stepPlayer(grid, player, input({ buttons: Button.fire }), 0)).toBe(0)
		expect(player.reloadEndTick).toBeGreaterThan(0)
	})

	it('cancels a reload and delays firing when switching weapons', () => {
		const player = createPlayer(1, 32, 24)
		player.weapons[0].mag = 3
		stepPlayer(grid, player, input({ buttons: Button.reload }), 0)
		stepPlayer(grid, player, input({ buttons: Button.slot2 }), 1)
		expect(player.slot).toBe(1)
		expect(player.reloadEndTick).toBe(0)
		expect(stepPlayer(grid, player, input({ buttons: Button.fire }), 2)).toBe(0)
		stepPlayer(grid, player, input({ buttons: Button.swap }), 30)
		expect(player.slot).toBe(0)
	})

	it('does nothing while dead', () => {
		const player = createPlayer(1, 32, 24)
		player.alive = false
		expect(stepPlayer(grid, player, input({ moveX: 127, buttons: Button.fire }), 0)).toBe(0)
		expect(player.x).toBe(32)
	})
})
