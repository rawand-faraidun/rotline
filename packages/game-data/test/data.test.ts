import { describe, expect, it } from 'vitest'
import {
	abilities,
	economy,
	items,
	maps,
	skillNodes,
	skillTrees,
	starterBuild,
	waves,
	weaponSchema,
	weapons,
	zombies
} from '../src/index.ts'

describe('game data', () => {
	it('loads and validates every file', () => {
		expect(weapons.length).toBe(12)
		expect(zombies.filter(zombie => !zombie.dummy).map(zombie => zombie.id)).toEqual(['drudge', 'bolter', 'swell'])
		expect(maps.range?.playerSpawns.length).toBe(4)
		expect(maps.yard?.playerSpawns.length).toBe(4)
		expect(waves.waves.length).toBeGreaterThan(0)
		expect(abilities).toHaveLength(18)
	})

	it('gives pistols unlimited reserve and main weapons a carried maximum', () => {
		for (const weapon of weapons) {
			if (weapon.kind === 'pistol') expect(weapon.maxReserve).toBeNull()
			else if (weapon.tier !== null) expect(weapon.maxReserve).toBeGreaterThan(0)
		}
	})

	it('rejects a pistol with limited reserve', () => {
		const pistol = weapons.find(weapon => weapon.kind === 'pistol')
		expect(weaponSchema.safeParse({ ...pistol, maxReserve: 60 }).success).toBe(false)
	})

	it('has one form of every item at a fixed whole price (no rarity, nothing random)', () => {
		expect(new Set(items.map(item => item.id)).size).toBe(items.length)
		for (const item of items) {
			expect(Number.isInteger(item.price)).toBe(true)
			expect(item.price).toBeGreaterThan(0)
		}
	})

	it('starts players with two main weapons, a pistol, armour and a utility they own', () => {
		const { loadout } = economy.starter
		const slotOf = (id: string) => items.find(item => item.id === id)?.slot
		expect([...loadout.main, loadout.pistol].map(slotOf)).toEqual(['main', 'main', 'pistol'])
		const pieceOf = (id: string) => items.find(item => item.id === id)?.piece
		for (const [piece, id] of Object.entries(loadout.armour)) if (id) expect(pieceOf(id)).toBe(piece)
		expect(slotOf(loadout.utility[0] ?? '')).toBe('utility')
		const owned = new Set(economy.starter.items)
		for (const id of [...loadout.main, loadout.pistol, ...Object.values(loadout.armour), ...loadout.utility]) {
			if (id) expect(owned.has(id)).toBe(true)
		}
		expect(starterBuild().loadout.pistol.id).toBe('p9-service')
	})

	it('has three branches of 22 nodes per class with two actives and one capstone each', () => {
		for (const tree of Object.values(skillTrees)) {
			for (const branch of tree.branches) {
				expect(branch.nodes).toHaveLength(22)
				expect(branch.nodes.filter(node => node.kind === 'active')).toHaveLength(2)
				expect(branch.nodes.filter(node => node.kind === 'capstone')).toHaveLength(1)
			}
		}
		expect(skillNodes.size).toBe(9 * 22)
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

describe('economy sheet', () => {
	it('is up to date with the data (run `pnpm --filter @rotline/game-data economy`)', async () => {
		const { readFileSync } = await import('node:fs')
		const { economySheet } = await import('../src/economy-sheet.ts')
		expect(readFileSync(new URL('../economy.csv', import.meta.url), 'utf8')).toBe(economySheet())
	})
})
