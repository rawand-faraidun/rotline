import { describe, expect, it } from 'vitest'
import {
	abilitySlotsAtLevel,
	allocationProblem,
	allSkillPoints,
	discardValue,
	levelFromXp,
	perkLevelsReached,
	perkOptions,
	pointsAtLevel,
	skillTrees,
	unlockedAbilities,
	upgradeCost,
	upgradeTotal,
	validateAbilities,
	validateSkills,
	xpToNext
} from '../src/index.ts'

describe('class levels', () => {
	it('follows the XP curve: 1,000 for level 2, about 2,500 at 10, about 24,000 at 30', () => {
		expect(xpToNext(1)).toBe(1000)
		expect(xpToNext(9)).toBe(2476)
		expect(xpToNext(29)).toBe(23884)
		expect(levelFromXp(0)).toEqual({ level: 1, into: 0, next: 1000 })
		expect(levelFromXp(999).level).toBe(1)
		expect(levelFromXp(1000)).toEqual({ level: 2, into: 0, next: 1120 })
		expect(levelFromXp(1e12)).toMatchObject({ level: 50, next: null })
	})

	it('grants one point per level and two at every tenth: 55 at level 50', () => {
		expect(pointsAtLevel(1)).toBe(1)
		expect(pointsAtLevel(9)).toBe(9)
		expect(pointsAtLevel(10)).toBe(11)
		expect(pointsAtLevel(50)).toBe(55)
	})

	it('opens a third ability slot at level 20', () => {
		expect(abilitySlotsAtLevel(1)).toBe(2)
		expect(abilitySlotsAtLevel(19)).toBe(2)
		expect(abilitySlotsAtLevel(20)).toBe(3)
	})
})

describe('skill allocation', () => {
	const tierOne = { 'adrenaline-burst': 1, 'fleet-foot': 2, 'quick-hands': 1, 'steady-aim': 1 }

	it('accepts tier 1 nodes and rejects other classes, unknown nodes and too many ranks', () => {
		expect(validateSkills('assault', { 'adrenaline-burst': 1 }, 1)).toBeNull()
		expect(validateSkills('medic', { 'adrenaline-burst': 1 }, 1)).toBe('wrong-class')
		expect(validateSkills('assault', { nope: 1 }, 1)).toBe('unknown-node')
		expect(validateSkills('assault', { 'adrenaline-burst': 2 }, 5)).toBe('rank')
	})

	it('needs the points from levels', () => {
		expect(validateSkills('assault', tierOne, 4)).toBe('points')
		expect(validateSkills('assault', tierOne, 5)).toBeNull()
	})

	it('lets an unrestricted test account hold the whole tree at any level', () => {
		const everything = Object.fromEntries(
			skillTrees.assault.branches.flatMap(branch => branch.nodes.map(node => [node.id, node.maxRank]))
		)
		expect(validateSkills('assault', everything, 50)).toBe('points')
		expect(validateSkills('assault', everything, 1, allSkillPoints('assault'))).toBeNull()
	})

	it('opens tier 2 after five points in tier 1', () => {
		expect(allocationProblem('assault', { 'adrenaline-burst': 1 }, 10, 'run-and-gun')).toBe('tier-locked')
		expect(allocationProblem('assault', tierOne, 10, 'run-and-gun')).toBeNull()
	})

	it('unlocks actives from nodes and checks the equipped abilities', () => {
		expect(unlockedAbilities(tierOne)).toEqual(['adrenaline-burst'])
		expect(validateAbilities(tierOne, 5, ['adrenaline-burst'])).toBe(true)
		expect(validateAbilities(tierOne, 5, ['slide-dash'])).toBe(false)
		expect(validateAbilities(tierOne, 5, ['adrenaline-burst', 'adrenaline-burst'])).toBe(false)
	})
})

describe('prices', () => {
	it('prices upgrades by tier: ten levels cost 50,280, 87,960 and 138,230', () => {
		expect(upgradeTotal('breacher-12', 10)).toBe(50280)
		expect(upgradeTotal('longstride', 10)).toBe(87960)
		expect(upgradeTotal('mower', 10)).toBe(138230)
		expect(upgradeCost('mower', 1)).toBe(1980)
	})

	it('pays a fixed amount for discards by tier', () => {
		expect(discardValue('k-71')).toBe(300)
		expect(discardValue('breacher-12')).toBe(600)
		expect(discardValue('mower')).toBe(2400)
	})

	it('offers two perks at levels 5 and 10', () => {
		expect(perkOptions('k-71', 5)?.map(perk => perk.id)).toEqual(['k71-extended-mag', 'k71-hollow-points'])
		expect(perkOptions('k-71', 4)).toBeNull()
		expect(perkOptions('kevlar-vest', 5)).toBeNull()
		expect(perkLevelsReached('k-71', 7)).toEqual([5])
	})
})
