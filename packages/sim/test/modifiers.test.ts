import { modifierBonus, propsDef, zombieIndex, zombies } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { World } from '../src/index.ts'
import { ammoPrice } from '../src/prop-step.ts'
import { sweep, yard } from './helpers.ts'

const world = (modifiers: string[]) =>
	new World({
		seed: 4,
		map: yard,
		mission: { mission: { ...sweep, spawn: { ...sweep.spawn, perSecond: 0 } }, difficulty: 'veteran', modifiers }
	})

describe('mission modifiers', () => {
	it('make zombies tougher and players frailer, and dearer ammunition', () => {
		const plain = world([])
		const hard = world(['hardened', 'fragile', 'scarce'])
		const a = plain.addPlayer(1)
		const b = hard.addPlayer(1)
		expect(b.stats.maxHealth).toBe(Math.round(a.stats.maxHealth * 0.7))
		expect(b.health).toBe(b.stats.maxHealth)
		const drudge = zombieIndex('drudge')
		const one = plain.spawnZombie(drudge, { x: 10, y: 10 })
		const two = hard.spawnZombie(drudge, { x: 10, y: 10 })
		expect(hard.health[two]).toBeCloseTo((plain.health[one] as number) * 1.3, 5)
		expect(ammoPrice(hard)).toBe(propsDef.ammo.price * 2)
		expect((zombies[drudge]?.health ?? 0) > 0).toBe(true)
	})

	it('One life: alone, the first death loses the mission', () => {
		const solo = world(['one-life'])
		solo.addPlayer(1)
		expect(solo.livesLeft).toBe(1)
	})

	it('pay a bonus that adds up to a cap', () => {
		expect(modifierBonus([])).toBe(0)
		expect(modifierBonus(['swarm'])).toBeCloseTo(0.15)
		expect(modifierBonus(['swarm', 'hardened', 'fragile', 'scarce', 'blackout', 'one-life'])).toBe(0.6)
		expect(modifierBonus(['nonsense'])).toBe(0)
	})
})
