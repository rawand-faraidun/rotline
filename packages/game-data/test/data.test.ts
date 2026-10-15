import { describe, expect, it } from 'vitest'
import { maps, player, waves, weaponSchema, weapons, zombies } from '../src/index.ts'

describe('game data', () => {
	it('loads and validates every file', () => {
		expect(weapons.length).toBeGreaterThanOrEqual(3)
		expect(zombies.map(zombie => zombie.id)).toEqual(['drudge', 'bolter', 'swell'])
		expect(maps.yard?.playerSpawns.length).toBe(4)
		expect(waves.waves.length).toBeGreaterThan(0)
	})

	it('gives pistols unlimited reserve and main weapons a carried maximum', () => {
		for (const weapon of weapons) {
			if (weapon.slot === 'pistol') expect(weapon.maxReserve).toBeNull()
			else expect(weapon.maxReserve).toBeGreaterThan(0)
		}
	})

	it('rejects a pistol with limited reserve', () => {
		const pistol = weapons.find(weapon => weapon.slot === 'pistol')
		expect(weaponSchema.safeParse({ ...pistol, maxReserve: 60 }).success).toBe(false)
	})

	it('starts players with two main weapons and a pistol', () => {
		const slots = [...player.loadout.main, player.loadout.pistol].map(
			id => weapons.find(weapon => weapon.id === id)?.slot
		)
		expect(slots).toEqual(['main', 'main', 'pistol'])
	})

	it('keeps every spawn point inside the map and off walls', () => {
		for (const map of Object.values(maps)) {
			for (const point of [...map.playerSpawns, ...map.zombieSpawns]) {
				expect(point.x).toBeGreaterThan(0)
				expect(point.y).toBeGreaterThan(0)
				expect(point.x).toBeLessThan(map.width)
				expect(point.y).toBeLessThan(map.height)
				const blocked = map.walls.some(
					wall => point.x >= wall.x && point.x < wall.x + wall.w && point.y >= wall.y && point.y < wall.y + wall.h
				)
				expect(blocked).toBe(false)
			}
		}
	})
})
