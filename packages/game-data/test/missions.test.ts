import { describe, expect, it } from 'vitest'
import {
	isSurvival,
	Mastery,
	type MissionDef,
	maps,
	masteryFor,
	minimumSeconds,
	missionById,
	missionFor,
	missionLayouts,
	missionMap,
	missions,
	SURVIVAL_ARENAS,
	survivalMap
} from '../src/index.ts'

const full = missionById('yard-sweep') as MissionDef
/** Rail Yard without its optional objective */
const sweep: MissionDef = { ...full, objectives: full.objectives.filter(objective => !objective.optional) }
const par = sweep.parTimeSeconds * 1000
const result = {
	difficulty: 'veteran' as const,
	success: true,
	timeMs: par,
	score: 0,
	downs: 5,
	squad: 1,
	optionalDone: 0
}

describe('mission mastery', () => {
	it('rates completions from Veteran up', () => {
		expect(masteryFor(sweep, { ...result, success: false })).toBe(Mastery.none)
		expect(masteryFor(sweep, { ...result, difficulty: 'recruit' })).toBe(Mastery.none)
		expect(masteryFor(sweep, { ...result, timeMs: par + 1 })).toBe(Mastery.bronze)
		expect(masteryFor(sweep, result)).toBe(Mastery.silver)
		const fast = { ...result, timeMs: par * 0.8, score: sweep.scoreTarget * 0.5, downs: 1 }
		expect(masteryFor(sweep, fast)).toBe(Mastery.gold)
		expect(masteryFor(sweep, { ...fast, downs: 2 })).toBe(Mastery.silver)
		expect(masteryFor(sweep, { ...fast, score: sweep.scoreTarget * 0.5 - 1 })).toBe(Mastery.silver)
		// four players face twice the zombies of one, so their total must be higher
		expect(masteryFor(sweep, { ...fast, squad: 4 })).toBe(Mastery.silver)
		expect(masteryFor(sweep, { ...fast, squad: 4, score: sweep.scoreTarget })).toBe(Mastery.gold)
	})

	it('asks for optional objectives when a mission has them', () => {
		const withOptional: MissionDef = {
			...sweep,
			objectives: [...sweep.objectives, { type: 'kill', label: 'Extra', count: 5, optional: true }]
		}
		expect(masteryFor(withOptional, result)).toBe(Mastery.bronze)
		expect(masteryFor(withOptional, { ...result, optionalDone: 1 })).toBe(Mastery.silver)
		expect(minimumSeconds(withOptional)).toBe(minimumSeconds(sweep))
	})

	it('knows the fastest possible time of every mission', () => {
		expect(minimumSeconds(sweep)).toBe(71)
		for (const mission of missions) expect(minimumSeconds(mission)).toBeLessThan(mission.parTimeSeconds)
	})
})

describe('maps for each run', () => {
	it('gives a contract one of its maps per room, the same one every time, and spreads rooms over all of them', () => {
		const layouts = missionLayouts.get('hotspot') ?? []
		expect(layouts.length).toBeGreaterThan(1)
		expect(missionFor('hotspot', 'squad-a')).toBe(missionFor('hotspot', 'squad-a'))
		const seen = new Set<string>()
		for (let i = 0; i < 400; i++) seen.add(missionFor('hotspot', `squad-${i}`)?.map ?? '')
		expect([...seen].sort()).toEqual(layouts.map(layout => layout.map).sort())
		// a variant keeps the mission's id and rules, only the place changes
		for (const layout of layouts) {
			expect(layout.id).toBe('hotspot')
			expect(layout.timeLimitSeconds).toBe(missionById('hotspot')?.timeLimitSeconds)
		}
		expect(missionFor('nope', 'squad-a')).toBeUndefined()
	})

	it("lays a variant's own props on its map, leaving the map itself as it is", () => {
		const docks = missionLayouts.get('supply-run')?.find(layout => layout.map === 'docks') as MissionDef
		expect(missionMap(docks).props?.some(prop => prop.id === 'crate-pier')).toBe(true)
		expect(maps.docks?.props?.some(prop => prop.id === 'crate-pier')).toBe(false)
	})

	it('offers Survival on several maps, the first by default', () => {
		expect(SURVIVAL_ARENAS.length).toBeGreaterThanOrEqual(3)
		for (const arena of SURVIVAL_ARENAS) {
			expect(isSurvival(arena.id)).toBe(true)
			expect(maps[survivalMap(arena.id)]).toBeDefined()
		}
		expect(isSurvival('hotspot')).toBe(false)
		expect(survivalMap(undefined)).toBe(SURVIVAL_ARENAS[0].map)
	})
})
