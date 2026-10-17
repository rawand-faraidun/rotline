import { describe, expect, it } from 'vitest'
import { Mastery, type MissionDef, masteryFor, minimumSeconds, missionById, missions } from '../src/index.ts'

const full = missionById('yard-sweep') as MissionDef
/** Yard Sweep without its optional objective */
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
		expect(minimumSeconds(sweep)).toBe(85)
		for (const mission of missions) expect(minimumSeconds(mission)).toBeLessThan(mission.parTimeSeconds)
	})
})
