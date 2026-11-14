import { missionLayouts, missionMap, modifiers } from './data.ts'
import type { MissionDef, ModifierDef } from './schema.ts'
import type { PlayerStats } from './stats.ts'

/** the zone contracts are in */
const CONTRACTS = 'contracts'

/** The modifiers by id, in the order the data lists them (unknown ids are dropped). */
export function modifierDefs(ids: readonly string[]): ModifierDef[] {
	return modifiers.modifiers.filter(entry => ids.includes(entry.id))
}

/** The ids, known and in the data's order, without repeats: how a choice of modifiers is stored. */
export function normaliseModifiers(ids: readonly string[]): string[] {
	return modifierDefs(ids).map(entry => entry.id)
}

/** Whether a modifier changes anything on this mission (on every map it can be played on). */
export function modifierApplies(modifier: ModifierDef, mission: MissionDef): boolean {
	const not = modifier.notFor
	if (!not) return true
	if (not.contracts && mission.zone === CONTRACTS) return false
	const lights = not.lights
	if (lights) {
		const layouts = missionLayouts.get(mission.id) ?? [mission]
		if (layouts.every(layout => lights.includes(missionMap(layout).look?.light ?? 'day'))) return false
	}
	return true
}

/**
 * The modifiers as they play on this mission: known, in the data's order, without the ones that
 * change nothing there (no Blackout on a map that is dark already). The API stores this, and the
 * server plays and pays only these.
 */
export function applicableModifiers(ids: readonly string[], mission: MissionDef | undefined): string[] {
	return modifierDefs(ids)
		.filter(entry => !mission || modifierApplies(entry, mission))
		.map(entry => entry.id)
}

/** Extra rewards for these modifiers, as a share (0.35 = 35 % more), at most the cap. */
export function modifierBonus(ids: readonly string[]): number {
	return Math.min(
		modifiers.maxBonus,
		modifierDefs(ids).reduce((sum, entry) => sum + entry.bonus, 0)
	)
}

/** What the modifiers do, multiplied (and flags set) together. */
export function modifierEffects(ids: readonly string[]) {
	const effects = {
		enemyCount: 1,
		enemyHealth: 1,
		playerHealth: 1,
		ammoPrice: 1,
		noMaxAmmo: false,
		dark: false,
		soloLives: null as number | null,
		bleedout: 0,
		/** mutation stages added (Hardened) */
		mutation: 0
	}
	for (const { effects: one } of modifierDefs(ids)) {
		effects.enemyCount *= one.enemyCount ?? 1
		effects.enemyHealth *= one.enemyHealth ?? 1
		effects.playerHealth *= one.playerHealth ?? 1
		effects.ammoPrice *= one.ammoPrice ?? 1
		effects.noMaxAmmo ||= one.noMaxAmmo === 1
		effects.dark ||= one.dark === 1
		if (one.soloLives !== undefined) effects.soloLives = Math.min(effects.soloLives ?? one.soloLives, one.soloLives)
		effects.bleedout += one.bleedout ?? 0
		effects.mutation += one.mutation ?? 0
	}
	return effects
}

export type ModifierEffects = ReturnType<typeof modifierEffects>

/** A player's numbers under the modifiers (less health when Fragile, a shorter bleed-out with One life). */
export function modifiedStats(stats: PlayerStats, ids: readonly string[]): PlayerStats {
	if (ids.length === 0) return stats
	const effects = modifierEffects(ids)
	return {
		...stats,
		maxHealth: Math.max(1, Math.round(stats.maxHealth * effects.playerHealth)),
		bleedoutBonusSeconds: stats.bleedoutBonusSeconds + effects.bleedout
	}
}
