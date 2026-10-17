import { difficulties, economy } from './data.ts'
import type { DifficultyId, MissionDef } from './schema.ts'

export const Mastery = { none: 0, bronze: 1, silver: 2, gold: 3 } as const

/**
 * Survival: endless rounds on one map, each harder than the last (a game mode of its own, not a
 * mission). Chosen in the lobby like a mission; its full rules and leaderboard come with milestone 7.
 */
export const SURVIVAL = 'survival'
export const SURVIVAL_MAP = 'yard'

export type MissionResult = {
	difficulty: DifficultyId
	success: boolean
	timeMs: number
	/** the squad's total score: the target scales with the zombies a squad of this size faces */
	score: number
	/** downs across the squad */
	downs: number
	/** players in the squad at the end (1 to 4) */
	squad: number
	/** optional objectives done (none exist before milestone 5b) */
	optionalDone: number
}

/** How many optional objectives a mission has. */
export const optionalCount = (mission: MissionDef): number =>
	mission.objectives.filter(objective => objective.optional).length

/**
 * Mission mastery (game design 18), from Veteran up: bronze for completing, silver under par with
 * an optional objective, gold under 80 % of par with every optional objective, the score target
 * and at most one down. A mission without optional objectives asks for none.
 */
export function masteryFor(mission: MissionDef, result: MissionResult): number {
	if (!result.success || result.difficulty === 'recruit') return Mastery.none
	const par = mission.parTimeSeconds * 1000
	const optional = optionalCount(mission)
	const squad = Math.max(1, Math.min(4, result.squad))
	const target = mission.scoreTarget * (difficulties.squadEnemyCount[squad - 1] ?? 1)
	const gold =
		result.timeMs <= par * economy.mastery.goldParShare &&
		result.optionalDone >= optional &&
		result.score >= target &&
		result.downs <= economy.mastery.goldMaxDowns
	if (gold) return Mastery.gold
	if (result.timeMs <= par && result.optionalDone >= Math.min(1, optional)) return Mastery.silver
	return Mastery.bronze
}

/** The fastest a mission can possibly be finished: its timed objectives back to back. */
export function minimumSeconds(mission: MissionDef): number {
	let seconds = 0
	for (const objective of mission.objectives) {
		if (objective.optional) continue
		if (objective.type === 'hold' || objective.type === 'survive') seconds += objective.seconds
	}
	return seconds
}
