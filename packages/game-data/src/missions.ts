import { difficulties, economy, missionLayouts, propsDef } from './data.ts'
import type { DifficultyId, MissionDef } from './schema.ts'

export const Mastery = { none: 0, bronze: 1, silver: 2, gold: 3 } as const

/**
 * Survival: endless rounds, each harder than the last (a game mode of its own, not a mission), on a
 * map the leader picks from these. Chosen in the lobby like a mission; `SURVIVAL` is the first.
 */
export const SURVIVAL_ARENAS = [
	{ id: 'survival', map: 'oldtown' },
	{ id: 'survival-glasshouse', map: 'glasshouse' },
	{ id: 'survival-docks', map: 'docks' }
] as const
export type SurvivalId = (typeof SURVIVAL_ARENAS)[number]['id']
export const SURVIVAL: SurvivalId = 'survival'
export const SURVIVAL_MAP: string = SURVIVAL_ARENAS[0].map
export const isSurvival = (id: string | null | undefined): id is SurvivalId =>
	SURVIVAL_ARENAS.some(arena => arena.id === id)
/** The map of a Survival arena (the first for anything else). */
export const survivalMap = (id: string | null | undefined): string =>
	SURVIVAL_ARENAS.find(arena => arena.id === id)?.map ?? SURVIVAL_MAP

/**
 * The mission as it plays in this room: a contract with several maps runs on the one the room's id
 * picks (the id is random, so is the map, and the server, the API and every player agree on it).
 */
export function missionFor(id: string, room: string): MissionDef | undefined {
	const layouts = missionLayouts.get(id)
	if (!layouts) return undefined
	let hash = 0x811c9dc5
	for (let i = 0; i < room.length; i++) hash = Math.imul(hash ^ room.charCodeAt(i), 0x01000193)
	return layouts[(hash >>> 0) % layouts.length]
}

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
		if (objective.type === 'hold' || objective.type === 'survive' || objective.type === 'defend')
			seconds += objective.seconds
		// work that takes a hold: the longest of an objective's props (they can be worked side by side)
		if (objective.type === 'interact')
			seconds += Math.min(propsDef.terminal.holdSeconds, propsDef.generator.holdSeconds)
		if (objective.type === 'rescue') seconds += propsDef.survivor.freeSeconds
		if (objective.type === 'retrieve') seconds += propsDef.carry.pickupSeconds
	}
	return seconds
}
