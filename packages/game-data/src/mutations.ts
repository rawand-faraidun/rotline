import { campaign, mutations, zombies } from './data.ts'
import type { DamageType, DifficultyId, ZombieDef } from './schema.ts'

export const MAX_MUTATION_STAGE = mutations.maxStage

/** The damage types in a fixed order: a strain is stored as its type's index here, plus one. */
export const DAMAGE_TYPES = ['ballistic', 'explosive', 'fire', 'shock', 'chemical'] as const satisfies DamageType[]

/**
 * How far the horde has mutated: the zone (Harrow is a stage on from Ashgate; a fourth zone would
 * be two), the difficulty (Nightmare one, Apocalypse two) and, in Survival, the rounds survived,
 * whichever is furthest; Hardened adds a stage. At most `maxStage`. The numbers are in mutations.json.
 */
export function mutationStage(setting: {
	zone?: string | null
	difficulty?: DifficultyId | null
	/** mutation stages the modifiers add */
	extra?: number
	/** Survival: rounds survived so far */
	rounds?: number
}): number {
	const zone = campaign.zones.findIndex(entry => entry.id === setting.zone)
	const zones = mutations.byZone
	const byZone = zone < 0 ? 0 : (zones[Math.min(zone, zones.length - 1)] ?? 0)
	const byDifficulty = setting.difficulty ? (mutations.byDifficulty[setting.difficulty] ?? 0) : 0
	const byRounds = setting.rounds === undefined ? 0 : Math.floor(setting.rounds / mutations.survivalRoundsPerStage)
	return Math.min(MAX_MUTATION_STAGE, Math.max(byZone, byDifficulty, byRounds) + (setting.extra ?? 0))
}

/** The traits a kind has at a stage (the first `stage` of its list). */
export function traitsAt(def: ZombieDef, stage: number) {
	return (def.mutations ?? []).slice(0, stage).flatMap(id => mutations.traits.find(trait => trait.id === id) ?? [])
}

/** A kind as it is at a stage: tougher, harder-hitting, and with its traits. Its size never changes. */
export function mutate(def: ZombieDef, stage: number): ZombieDef {
	if (stage <= 0 || def.dummy || def.boss) return def
	const resist = { ...def.resist }
	let speed = def.speed
	let meleeDamage = def.meleeDamage * (1 + mutations.perStage.damage * stage)
	let meleeType = def.meleeType
	let regen = def.regen ?? 0
	let deathBurst = def.deathBurst
	for (const trait of traitsAt(def, stage)) {
		// added resistance stops at the cap; a kind's own may be higher (a Cinder in fire)
		for (const [type, share] of Object.entries(trait.resist ?? {}) as [DamageType, number][])
			resist[type] = Math.max(resist[type] ?? 0, Math.min(mutations.maxResist, (resist[type] ?? 0) + share))
		speed *= trait.speed ?? 1
		meleeDamage *= trait.melee ?? 1
		meleeType = trait.meleeType ?? meleeType
		regen = Math.max(regen, trait.regen ?? 0)
		deathBurst = deathBurst ?? trait.deathBurst ?? null
	}
	return {
		...def,
		health: def.health * (1 + mutations.perStage.health * stage),
		speed: Math.min(mutations.maxSpeed, speed),
		meleeDamage,
		...(meleeType ? { meleeType } : {}),
		...(regen > 0 ? { regen } : {}),
		resist,
		deathBurst
	}
}

const byStage = new Map<number, ZombieDef[]>()
/** Every kind at a stage (worked out once per stage). */
export function mutatedZombies(stage: number): ZombieDef[] {
	let list = byStage.get(stage)
	if (!list) {
		list = zombies.map(def => mutate(def, stage))
		byStage.set(stage, list)
	}
	return list
}
