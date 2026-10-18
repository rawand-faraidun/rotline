import { describe, expect, it } from 'vitest'
import { type Build, buildProblem, computeStats, damageTaken, starterBuild, weaponStats } from '../src/index.ts'

describe('weapon stats', () => {
	it('applies upgrade levels, including carried ammunition for main weapons', () => {
		const base = weaponStats({ id: 'k-71', level: 0, perks: [] })
		const maxed = weaponStats({ id: 'k-71', level: 10, perks: [] })
		expect(base.damage).toBe(24)
		expect(maxed.damage).toBeCloseTo(24 * 1.6)
		expect(maxed.maxReserve).toBe(Math.round(210 * 1.8))
		expect(maxed.magazine).toBe(Math.round(30 * 1.5))
		expect(maxed.reloadSeconds).toBeCloseTo(2.2 / 1.3)
	})

	it('keeps pistols unlimited at every level', () => {
		expect(weaponStats({ id: 'p9-service', level: 10, perks: [] }).maxReserve).toBeNull()
	})

	it('applies perks and only the skills that match the weapon', () => {
		const perk = weaponStats({ id: 'k-71', level: 5, perks: ['k71-extended-mag'] })
		expect(perk.magazine).toBe(Math.round(30 * (1 + 0.25 + 0.25)))
		const smgOnly = [{ stat: 'damage' as const, value: 0.5, kinds: ['smg' as const] }]
		expect(weaponStats({ id: 'vex-9', level: 0, perks: [] }, smgOnly).damage).toBe(21)
		expect(weaponStats({ id: 'k-71', level: 0, perks: [] }, smgOnly).damage).toBe(24)
	})

	it('spreads a cone weapon’s damage per second over its shots', () => {
		const kiln = weaponStats({ id: 'kiln', level: 0, perks: [] })
		expect(kiln.damage * (kiln.fireRate / 60)).toBeCloseTo(160)
	})
})

describe('player stats', () => {
	it('uses the class base and grows health 1 % per level', () => {
		expect(computeStats(starterBuild('heavy')).maxHealth).toBe(140)
		expect(computeStats({ ...starterBuild('assault'), level: 11 }).maxHealth).toBe(110)
		expect(computeStats(starterBuild('medic')).reviveSeconds).toBe(2.5)
	})

	it('adds passives by rank', () => {
		const build: Build = { ...starterBuild('assault'), level: 5, skills: { 'fleet-foot': 2, conditioning: 1 } }
		const stats = computeStats(build)
		expect(stats.speed).toBeCloseTo(5.4 * 1.08)
		expect(stats.maxHealth).toBe(Math.round(104 * 1.04))
	})

	it('reduces damage with armour and resistances', () => {
		const stats = computeStats(starterBuild('assault'))
		expect(stats.armour).toBe(20)
		expect(damageTaken(stats, 100, null)).toBeCloseTo(75)
		const hazmat = computeStats({
			...starterBuild('assault'),
			loadout: {
				...starterBuild().loadout,
				armour: { ...starterBuild().loadout.armour, torso: { id: 'hazmat-suit', level: 0, perks: [] } }
			}
		})
		// the suit replaces the shirt: 2 more armour, and a quarter less chemical damage
		expect(hazmat.armour).toBe(22)
		expect(damageTaken(hazmat, 100, 'chemical')).toBeCloseTo(100 * (1 - 22 / 82) * 0.75)
	})
})

describe('build checks', () => {
	it('accepts the starter build and rejects broken ones', () => {
		const ok = starterBuild()
		expect(buildProblem(ok)).toBeNull()
		// armour only goes where it is worn
		expect(
			buildProblem({
				...ok,
				loadout: { ...ok.loadout, armour: { ...ok.loadout.armour, head: { id: 'kevlar-vest', level: 0, perks: [] } } }
			})
		).toBe('slot')
		expect(buildProblem({ ...ok, skills: { 'medkit-drop': 1 } })).toBe('skills')
		expect(buildProblem({ ...ok, abilities: ['adrenaline-burst'] })).toBe('abilities')
		const swap = (main: Build['loadout']['main']) => ({ ...ok, loadout: { ...ok.loadout, main } })
		expect(buildProblem(swap([ok.loadout.main[0], ok.loadout.main[0]]))).toBe('duplicate')
		expect(buildProblem(swap([ok.loadout.pistol, ok.loadout.main[1]]))).toBe('slot')
		expect(buildProblem(swap([{ id: 'k-71', level: 2, perks: ['k71-hollow-points'] }, ok.loadout.main[0]]))).toBe(
			'perk'
		)
		expect(
			buildProblem(swap([{ id: 'k-71', level: 10, perks: ['k71-hollow-points', 'k71-ap-rounds'] }, ok.loadout.main[0]]))
		).toBeNull()
		expect(buildProblem(swap([{ id: 'nope', level: 0, perks: [] }, ok.loadout.main[0]]))).toBe('item')
	})
})
