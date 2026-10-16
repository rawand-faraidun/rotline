import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9-]+$/, 'ids are lowercase kebab-case')
const fraction = z.number().min(-1).max(5)

export const damageType = z.enum(['ballistic', 'explosive', 'fire', 'shock', 'chemical'])
export const classId = z.enum(['assault', 'medic', 'heavy'])
export const weaponKind = z.enum([
	'pistol',
	'smg',
	'rifle',
	'shotgun',
	'lmg',
	'sniper',
	'flamethrower',
	'launcher',
	'shock',
	'chemical',
	'minigun'
])
/** 0 = starter kit, 1–3 = price tiers */
export const tier = z.number().int().min(0).max(3)

/**
 * Everything a skill node, a perk or an upgrade can change. Percentages are fractions (0.05 = +5 %);
 * `pierce`, `pellets`, `chains`, `utilityCharges`, `armour`, `killHeal`, `bleedout` and `reviveTime`
 * are flat amounts.
 */
export const statKey = z.enum([
	// weapon stats
	'damage',
	'fireRate',
	'reloadSpeed',
	'magazine',
	'reserve',
	'spread',
	'range',
	'pierce',
	'pellets',
	'chains',
	'blastRadius',
	// player stats
	'maxHealth',
	'moveSpeed',
	'damageReduction',
	'resist',
	'armour',
	'armourPct',
	'killHeal',
	'healing',
	'healingReceived',
	'reviveTime',
	'revivedHealth',
	'bleedout',
	'abilityCooldown',
	'utilityCharges',
	'critDamage',
	'damageVsSlowed'
])

export const effectSchema = z.object({
	stat: statKey,
	value: z.number().min(-100).max(100),
	/** only weapons of these kinds */
	kinds: z.array(weaponKind).min(1).optional(),
	/** only this damage type (weapons dealing it, or resistance against it) */
	damageType: damageType.optional()
})

const behaviour = z.discriminatedUnion('type', [
	z.object({ type: z.literal('hitscan'), pierce: z.number().int().min(0).max(10) }),
	/** continuous: `damage` is per second, spread over `fireRate` shots a minute */
	z.object({ type: z.literal('cone'), angleDegrees: z.number().positive().max(120) }),
	z.object({
		type: z.literal('projectile'),
		speed: z.number().positive().max(100),
		blastRadius: z.number().positive()
	}),
	z.object({ type: z.literal('chain'), chains: z.number().int().min(0).max(10), chainRange: z.number().positive() })
])

export const perkSchema = z.object({ id, name: z.string().min(1), effects: z.array(effectSchema).min(1) })

export const weaponSchema = z
	.object({
		id,
		name: z.string().min(1),
		kind: weaponKind,
		/** null: not an inventory item (the minigun from a buff or ability) */
		tier: tier.nullable(),
		/** overrides the tier price */
		price: z.number().int().positive().optional(),
		damageType,
		damage: z.number().positive(),
		pellets: z.number().int().min(1),
		/** rounds per minute */
		fireRate: z.number().positive().max(3000),
		automatic: z.boolean(),
		magazine: z.number().int().min(1),
		/** carried ammunition beyond the magazine; null = unlimited (pistols only) */
		maxReserve: z.number().int().min(0).nullable(),
		reloadSeconds: z.number().positive(),
		/** shotguns load one shell per `reloadSeconds` */
		reloadPerRound: z.boolean(),
		spreadDegrees: z.number().min(0).max(45),
		range: z.number().positive().max(80),
		behaviour,
		perks: z.array(z.object({ level: z.number().int().positive(), options: z.tuple([perkSchema, perkSchema]) }))
	})
	.refine(weapon => (weapon.kind === 'pistol') === (weapon.maxReserve === null && weapon.tier !== null), {
		message: 'pistols have unlimited reserve ammunition (null); main weapons have a number',
		path: ['maxReserve']
	})

export const zombieSchema = z.object({
	id,
	name: z.string().min(1),
	health: z.number().positive(),
	/** metres per second */
	speed: z.number().positive().max(12),
	radius: z.number().positive().max(2),
	meleeDamage: z.number().min(0),
	meleeRange: z.number().positive(),
	meleeCooldownSeconds: z.number().positive(),
	score: z.number().int().min(0),
	/** class XP per kill */
	xp: z.number().min(0),
	/** Salvage per kill (fractions add up) */
	salvage: z.number().min(0),
	tint: z.string().regex(/^#[0-9a-f]{6}$/i),
	scale: z.number().positive().max(4),
	/** firing-range targets: never move or attack, never appear in waves, heal back to full */
	dummy: z.boolean().optional(),
	deathBurst: z
		.object({
			damage: z.number().min(0),
			radius: z.number().positive(),
			poolDamagePerSecond: z.number().min(0),
			poolRadius: z.number().positive(),
			poolSeconds: z.number().positive()
		})
		.nullable()
})

export const playerSchema = z.object({
	radius: z.number().positive(),
	respawnSeconds: z.number().min(0)
})

export const classesSchema = z.object({
	progression: z.object({
		maxLevel: z.number().int().min(2).max(100),
		xpBase: z.number().positive(),
		xpGrowth: z.number().min(1),
		pointsPerLevel: z.number().int().min(1),
		bonusPointLevels: z.array(z.number().int().min(2)),
		bonusPoints: z.number().int().min(1),
		healthPerLevel: fraction,
		pointsPerTier: z.number().int().min(1),
		abilitySlots: z.array(z.object({ level: z.number().int().min(1), slots: z.number().int().min(1).max(3) })).min(1)
	}),
	classes: z
		.array(
			z.object({
				id: classId,
				name: z.string().min(1),
				health: z.number().positive(),
				speed: z.number().positive().max(12),
				reviveSeconds: z.number().positive(),
				armourEffectiveness: z.number().positive()
			})
		)
		.length(3)
})

export const abilitySchema = z.object({
	id,
	name: z.string().min(1),
	class: classId,
	cooldownSeconds: z.number().positive(),
	params: z.record(z.string(), z.number())
})

export const skillNodeSchema = z
	.object({
		id,
		name: z.string().min(1),
		tier: z.number().int().min(1).max(5),
		maxRank: z.number().int().min(1).max(5),
		kind: z.enum(['passive', 'active', 'capstone']),
		/** values are per rank */
		effects: z.array(effectSchema),
		ability: id.optional(),
		special: id.optional()
	})
	.refine(node => (node.kind === 'active') === (node.ability !== undefined), {
		message: 'active nodes name an ability',
		path: ['ability']
	})
	.refine(node => (node.kind === 'capstone') === (node.special !== undefined), {
		message: 'capstones name a special rule',
		path: ['special']
	})
	.refine(node => node.kind !== 'passive' || node.effects.length > 0, { message: 'passives need effects' })

export const skillTreeSchema = z.object({
	class: classId,
	branches: z.array(z.object({ id, name: z.string().min(1), nodes: z.array(skillNodeSchema).min(1) })).length(3)
})

export const gearSchema = z.object({
	armour: z.array(
		z.object({
			id,
			name: z.string().min(1),
			tier,
			price: z.number().int().positive().optional(),
			armour: z.number().min(0),
			/** move speed change, fraction */
			speed: fraction,
			resist: z.partialRecord(damageType, z.number().min(0).max(0.9)),
			utilityCharges: z.number().int().min(0)
		})
	),
	utility: z.array(
		z.object({
			id,
			name: z.string().min(1),
			tier,
			price: z.number().int().positive().optional(),
			/** grenade: thrown, bursts where it lands; mine: placed, bursts when a zombie comes close;
			 * decoy: draws zombies to it; sentry: a small turret */
			type: z.enum(['grenade', 'mine', 'decoy', 'sentry']),
			/** per mission, refilled when a wave starts */
			charges: z.number().int().min(1),
			damageType,
			damage: z.number().min(0),
			radius: z.number().positive(),
			/** how long it lasts: a fire zone, a stun, a decoy, a sentry (0 = instant) */
			seconds: z.number().min(0)
		})
	)
})

const byTier = z.object({
	'0': z.number().int().min(0),
	'1': z.number().int(),
	'2': z.number().int(),
	'3': z.number().int()
})

export const economySchema = z.object({
	tierPrices: byTier,
	upgrade: z.object({
		maxLevel: z.number().int().min(1).max(20),
		tierBase: byTier,
		growth: z.number().min(1),
		roundTo: z.number().int().min(1),
		perkLevels: z.array(z.number().int().min(1)),
		perkSwitchPrice: z.number().int().min(0)
	}),
	discard: byTier,
	respecPrice: z.number().int().min(0),
	/** assumption behind the economy sheet's hours-of-play column */
	estimate: z.object({ salvagePerHour: z.number().positive(), note: z.string() }),
	rewards: z.object({
		waveClear: z.object({ xp: z.number().min(0), salvage: z.number().min(0) }),
		scorePerXp: z.number().positive()
	}),
	starter: z.object({
		items: z.array(id).min(1),
		loadout: z.object({
			main: z.tuple([id, id]),
			pistol: id,
			armour: id.nullable(),
			utility: z.tuple([id.nullable(), id.nullable()])
		})
	})
})

export const upgradesSchema = z.object({
	weapon: z.partialRecord(statKey, z.number()),
	armour: z.partialRecord(statKey, z.number()),
	utility: z.partialRecord(statKey, z.number())
})

const point = z.object({ x: z.number(), y: z.number() })
const rect = z.object({
	x: z.number().int(),
	y: z.number().int(),
	w: z.number().int().positive(),
	h: z.number().int().positive()
})

export const mapSchema = z.object({
	id,
	name: z.string(),
	width: z.number().int().positive().max(1000),
	height: z.number().int().positive().max(1000),
	walls: z.array(rect),
	playerSpawns: z.array(point).min(4),
	zombieSpawns: z.array(point).min(1)
})

export const wavesSchema = z.object({
	firstWaveDelaySeconds: z.number().min(0),
	breakSeconds: z.number().min(0),
	spawnPerSecond: z.number().positive(),
	maxAlive: z.number().int().positive().max(300),
	waves: z.array(z.record(id, z.number().int().min(0))).min(1),
	growthPerWave: z.number().min(1)
})

/** One equipped item as the game sees it: which item, its upgrade level and the perks chosen. */
export const itemRefSchema = z.object({
	id,
	level: z.number().int().min(0).max(20),
	perks: z.array(id).max(4)
})

/**
 * A player's build for one mission: carried in the signed game ticket, so the game server needs no
 * database, and repeated in the welcome message so the client predicts with the same numbers.
 */
export const buildSchema = z.object({
	class: classId,
	level: z.number().int().min(1).max(100),
	skills: z.record(id, z.number().int().min(1).max(5)),
	abilities: z.array(id).max(3),
	loadout: z.object({
		main: z.tuple([itemRefSchema, itemRefSchema]),
		pistol: itemRefSchema,
		armour: itemRefSchema.nullable(),
		utility: z.tuple([itemRefSchema.nullable(), itemRefSchema.nullable()])
	})
})

export type DamageType = z.infer<typeof damageType>
export type ClassId = z.infer<typeof classId>
export type WeaponKind = z.infer<typeof weaponKind>
export type StatKey = z.infer<typeof statKey>
export type Effect = z.infer<typeof effectSchema>
export type Perk = z.infer<typeof perkSchema>
export type WeaponDef = z.infer<typeof weaponSchema>
export type ZombieDef = z.infer<typeof zombieSchema>
export type PlayerDef = z.infer<typeof playerSchema>
export type ClassesDef = z.infer<typeof classesSchema>
export type ClassDef = ClassesDef['classes'][number]
export type AbilityDef = z.infer<typeof abilitySchema>
export type SkillNode = z.infer<typeof skillNodeSchema>
export type SkillTree = z.infer<typeof skillTreeSchema>
export type GearDef = z.infer<typeof gearSchema>
export type ArmourDef = GearDef['armour'][number]
export type UtilityDef = GearDef['utility'][number]
export type EconomyDef = z.infer<typeof economySchema>
export type MapDef = z.infer<typeof mapSchema>
export type WavesDef = z.infer<typeof wavesSchema>
export type ItemRef = z.infer<typeof itemRefSchema>
export type Build = z.infer<typeof buildSchema>
