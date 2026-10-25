import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9-]+$/, 'ids are lowercase kebab-case')
const fraction = z.number().min(-1).max(5)

export const damageType = z.enum(['ballistic', 'explosive', 'fire', 'shock', 'chemical'])
export const classId = z.enum(['assault', 'medic', 'heavy'])
/** The five places armour is worn. */
export const armourPiece = z.enum(['head', 'torso', 'vest', 'legs', 'feet'])

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
		/** how it feels: its sounds (a recorded group or a made-up sound, at `rate`) and the camera kick per shot in metres */
		sound: z.object({ shot: id, reload: id, rate: z.number().positive().max(3), recoil: z.number().min(0).max(2) }),
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
	/** elites may drop an item when killed, and take only part of a screen nuke */
	elite: z.boolean().optional(),
	/** a screamer: while alive and near players, calls a burst of others every so often */
	call: z
		.object({
			everySeconds: z.number().positive(),
			count: z.number().int().positive().max(30),
			range: z.number().positive(),
			composition: z.record(id, z.number().positive())
		})
		.optional(),
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
	respawnSeconds: z.number().min(0),
	/** playing alone, a run is lost at this many deaths (a death sends you back to the checkpoint or round) */
	soloLives: z.number().int().min(1)
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
	/** combat rules that are not per class */
	combat: z.object({
		/** share of max health a revived player gets back, before skills */
		revivedHealth: z.number().positive().max(1),
		resistCap: z.number().min(0).max(0.95),
		reviveFloorSeconds: z.number().positive(),
		damageReductionCap: z.number().min(0).max(0.9),
		cooldownFloor: z.number().positive().max(1),
		/** damage taken = damage × (1 − armour / (armour + armourConstant)) */
		armourConstant: z.number().positive(),
		throwIntervalSeconds: z.number().min(0),
		/** a kill within this long of the last one extends the kill chain */
		chainSeconds: z.number().positive(),
		/** zones, mines, decoys, sentries and barricades one player can have at once (the oldest goes) */
		maxObjectsPerPlayer: z.number().int().min(1),
		/** abilities in the firing range */
		rangeCooldownSeconds: z.number().min(0)
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
		special: id.optional(),
		/** a capstone's numbers */
		params: z.record(z.string(), z.number()).optional()
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
			/** where it is worn: each piece has its own loadout slot */
			piece: armourPiece,
			tier,
			price: z.number().int().positive().optional(),
			armour: z.number().min(0),
			/** move speed change, fraction */
			speed: fraction,
			resist: z.partialRecord(damageType, z.number().min(0).max(0.9)),
			utilityCharges: z.number().int().min(0),
			/** how it looks on the soldier: a piece model in soldier.glb and a colour */
			look: z.object({
				model: z.string().min(1),
				tint: z
					.string()
					.regex(/^#[0-9a-f]{6}$/i)
					.optional()
			})
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
			seconds: z.number().min(0),
			/** grenades and decoys: how far they can be thrown */
			throwRange: z.number().positive().optional(),
			/** mines: armed after this long, triggered by a zombie this close */
			armSeconds: z.number().min(0).optional(),
			triggerRadius: z.number().positive().optional(),
			/** sentries */
			shotsPerSecond: z.number().positive().optional()
		})
	)
})

const positiveByTier = z.object({
	'0': z.number().int().positive(),
	'1': z.number().int().positive(),
	'2': z.number().int().positive(),
	'3': z.number().int().positive()
})
const byTier = z.object({
	'0': z.number().int().min(0),
	'1': z.number().int().min(0),
	'2': z.number().int().min(0),
	'3': z.number().int().min(0)
})

export const economySchema = z.object({
	tierPrices: positiveByTier,
	upgrade: z.object({
		maxLevel: z.number().int().min(1).max(20),
		tierBase: positiveByTier,
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
		scorePerXp: z.number().positive(),
		/** the most one report from a game server may grant; anything above is refused and logged */
		maxPerReport: z.object({ xp: z.number().int().positive(), salvage: z.number().int().positive() }),
		/** per objective completed, and for finishing a mission (both times the difficulty's reward scale) */
		objective: z.object({ xp: z.number().min(0), salvage: z.number().min(0), score: z.number().int().min(0) }),
		completion: z.object({ xp: z.number().min(0), salvage: z.number().min(0) }),
		/** per optional objective done (times the difficulty's reward scale) */
		optional: z.object({ xp: z.number().min(0), salvage: z.number().min(0), score: z.number().int().min(0) }),
		/** score also pays Salvage: one per this many points (times the difficulty's reward scale) */
		scorePerSalvage: z.number().positive(),
		/** no mission can score faster than this (the API refuses results above it) */
		maxScorePerSecond: z.number().positive(),
		/** a player counts as playing if they moved, aimed or fired within this many seconds */
		activeSeconds: z.number().positive(),
		/** share of the mission a player must have been playing for its result, completion reward and final item */
		minParticipation: z.number().min(0).max(1)
	}),
	/** mission mastery: gold needs a time under this share of par and at most this many squad downs */
	mastery: z.object({ goldParShare: z.number().positive().max(1), goldMaxDowns: z.number().int().min(0) }),
	/** the kill chain sets a score multiplier; score thresholds pay Salvage and heal */
	score: z.object({
		multiplierSteps: z.array(z.object({ chain: z.number().int().min(0), multiplier: z.number().positive() })).min(1),
		thresholds: z.array(z.number().int().positive()).min(1),
		thresholdStep: z.number().int().positive(),
		thresholdSalvage: z.number().int().min(0),
		thresholdHeal: z.number().min(0).max(1)
	}),
	/** item drops in missions: chance per elite kill, tier weights by difficulty, a cap per mission */
	drops: z.object({
		eliteChance: z.number().min(0).max(1),
		/** metres from a cache within which holding interact opens it */
		cacheRange: z.number().positive(),
		tierWeights: z.record(z.string(), z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)])),
		maxPerMission: z.number().int().min(0)
	}),
	starter: z.object({
		items: z.array(id).min(1),
		loadout: z.object({
			main: z.tuple([id, id]),
			pistol: id,
			armour: z.object({
				head: id.nullable(),
				torso: id.nullable(),
				vest: id.nullable(),
				legs: id.nullable(),
				feet: id.nullable()
			}),
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

export const propKindId = z.enum([
	'barrel',
	'crate',
	'sandbags',
	'door',
	'generator',
	'terminal',
	'turret',
	'floodlight',
	'trap',
	'survivor',
	'carry',
	'defend',
	'nest',
	'ammo'
])

/**
 * A map prop. Barrels, cover, doors, generators, terminals, turrets and defend targets stand on
 * cells (x, y the top-left cell, w × h cells); the others stand on a point.
 */
export const mapPropSchema = z.object({
	id,
	kind: propKindId,
	x: z.number(),
	y: z.number(),
	w: z.number().int().positive().max(16).optional(),
	h: z.number().int().positive().max(16).optional(),
	/** doors: start closed */
	closed: z.boolean().optional(),
	/** doors: a mission gate, closed and locked until a mission opens it */
	locked: z.boolean().optional(),
	/** defend targets: their health (default from props data) */
	health: z.number().positive().optional(),
	/** turrets and floodlights: the generator that powers them */
	powerBy: id.optional()
})

const zombieSpawn = point.extend({
	/** which part of the map this spawn belongs to; objectives choose the parts that spawn */
	section: z.number().int().min(0).max(9).optional()
})

/**
 * Scenery placed on a map: a model from the scenery set at a spot (metres), turned (degrees about
 * x, y, z) and scaled; `fire` sets it burning. Drawing only: whatever should block is drawn into the
 * layout as blockers under it.
 */
export const decorSchema = z.object({
	model: id,
	x: z.number(),
	y: z.number(),
	rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
	scale: z.number().positive().max(20).optional(),
	fire: z.number().positive().max(4).optional()
})

export const mapSchema = z.object({
	id,
	name: z.string(),
	width: z.number().int().positive().max(1000),
	height: z.number().int().positive().max(1000),
	walls: z.array(rect),
	/** cells that block like walls but are not drawn (under scenery: wrecks, cars, barriers) */
	blockers: z.array(rect).optional(),
	decor: z.array(decorSchema).max(2000).optional(),
	playerSpawns: z.array(point).min(4),
	zombieSpawns: z.array(zombieSpawn).min(1),
	props: z.array(mapPropSchema).max(4096).optional(),
	/** how the place looks: the ground, the walls and the light (drawing only, no effect on play) */
	look: z
		.object({
			ground: z.enum(['asphalt', 'concrete', 'dirt', 'grass']),
			walls: z.enum(['brick', 'stone', 'metal', 'wall-concrete']),
			light: z.enum(['dusk', 'overcast', 'night'])
		})
		.optional(),
	/** firing-range maps: where dummies stand, how fast they heal, how many zombies may be spawned */
	range: z
		.object({
			dummies: z.array(point).min(1),
			resetSeconds: z.number().positive(),
			maxZombies: z.number().int().positive().max(300),
			spawnPerCommand: z.number().int().positive().max(20)
		})
		.optional()
})

export const wavesSchema = z.object({
	firstWaveDelaySeconds: z.number().min(0),
	breakSeconds: z.number().min(0),
	spawnPerSecond: z.number().positive(),
	maxAlive: z.number().int().positive().max(300),
	waves: z.array(z.record(id, z.number().int().min(0))).min(1),
	growthPerWave: z.number().min(1),
	/** every `every`th wave brings bosses of this type too: one, and one more for each further 2 × `every` waves */
	boss: z.object({ every: z.number().int().positive(), type: id }).optional()
})

export const difficultyId = z.enum(['recruit', 'veteran', 'nightmare', 'apocalypse'])

export const difficultiesSchema = z.object({
	tiers: z
		.array(
			z.object({
				id: difficultyId,
				name: z.string().min(1),
				enemyHealth: z.number().positive(),
				enemyDamage: z.number().positive(),
				enemyCount: z.number().positive(),
				rewards: z.number().positive()
			})
		)
		.length(4),
	/** enemy count by squad size (1 to 4 players) */
	squadEnemyCount: z.tuple([
		z.number().positive(),
		z.number().positive(),
		z.number().positive(),
		z.number().positive()
	]),
	/** per enemy level above 1 */
	enemyLevel: z.object({ health: z.number().min(0), damage: z.number().min(0) }),
	/** zombies alive at once, whatever the difficulty and squad size */
	maxAlive: z.number().int().positive().max(300)
})

export const buffsSchema = z.object({
	drop: z.object({
		chancePerKill: z.number().min(0).max(1),
		/** higher from elites and from opening a cache */
		eliteChance: z.number().min(0).max(1),
		cacheChance: z.number().min(0).max(1),
		minIntervalSeconds: z.number().min(0),
		pickupRadius: z.number().positive(),
		lifetimeSeconds: z.number().positive()
	}),
	buffs: z.array(
		z.object({
			id,
			name: z.string().min(1),
			/** applies to the whole squad, whoever picks it up */
			team: z.boolean(),
			seconds: z.number().min(0),
			weight: z.number().positive(),
			params: z.record(z.string(), z.number())
		})
	)
})

const area = z.object({ x: z.number(), y: z.number(), radius: z.number().positive() })
const objectiveBase = {
	label: z.string().min(1),
	/** a checkpoint is saved when this objective is done */
	checkpoint: z.boolean().optional(),
	/** where players come back after a checkpoint (objectives with an area use its centre) */
	checkpointAt: point.optional(),
	/** spawn rate while this objective runs, times the mission's */
	spawnScale: z.number().positive().optional(),
	/** map sections whose zombie spawns are used while this objective runs (default: all) */
	sections: z.array(z.number().int().min(0).max(9)).min(1).optional(),
	/** optional objectives run alongside the others, pay extra and count toward mastery */
	optional: z.boolean().optional(),
	/** what the radio says when this objective starts and when it is done */
	radio: z
		.object({
			speaker: z.string().min(1),
			start: z.string().min(1).optional(),
			done: z.string().min(1).optional()
		})
		.optional(),
	/** a burst of zombies the moment the objective starts (again after a wipe), on top of the stream */
	ambush: z
		.object({
			count: z.number().int().positive().max(120),
			/** types and weights (default: the mission's composition) */
			composition: z.record(id, z.number().positive()).optional()
		})
		.optional(),
	/** an elite who turns up when the objective starts: its type, and where (default: a spawn point) */
	boss: z.object({ type: id, at: point.optional() }).optional()
}

export const objectiveSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('kill'),
		count: z.number().int().positive(),
		/** only kills of this kind count */
		of: id.optional(),
		...objectiveBase
	}),
	z.object({ type: z.literal('reach'), area, ...objectiveBase }),
	z.object({ type: z.literal('hold'), area, seconds: z.number().positive(), ...objectiveBase }),
	z.object({ type: z.literal('survive'), seconds: z.number().positive(), ...objectiveBase }),
	/** work every listed generator or terminal (hold interact) */
	z.object({ type: z.literal('interact'), props: z.array(id).min(1), ...objectiveBase }),
	/** keep a defend target standing for a while */
	z.object({ type: z.literal('defend'), prop: id, seconds: z.number().positive(), ...objectiveBase }),
	/** free survivors and bring them to an area */
	z.object({ type: z.literal('rescue'), survivors: z.array(id).min(1), area, ...objectiveBase }),
	/** carry an object to an area */
	z.object({ type: z.literal('retrieve'), item: id, area, ...objectiveBase }),
	/** destroy every listed nest (nests keep spawning until they are gone) */
	z.object({ type: z.literal('destroy'), props: z.array(id).min(1), ...objectiveBase }),
	/** everyone standing reaches an area before the time runs out */
	z.object({ type: z.literal('extract'), area, seconds: z.number().positive(), ...objectiveBase })
])

export const missionSchema = z.object({
	id,
	name: z.string().min(1),
	zone: id,
	map: id,
	description: z.string().min(1),
	/** read before deploying: the situation, in a few short paragraphs */
	briefing: z.array(z.string().min(1)).max(6).optional(),
	/** what the radio says when the squad gets out */
	debrief: z.string().min(1).optional(),
	parTimeSeconds: z.number().positive(),
	/** a run against the clock: the mission is lost when this runs out (seconds from the start) */
	timeLimitSeconds: z.number().int().positive().max(3600).optional(),
	/**
	 * A squad member who bleeds out comes back after `seconds`, plus `step` more for each earlier
	 * time, up to `maxSeconds` (for runs with no checkpoint to wait for, like contracts). Without it,
	 * they wait for the next checkpoint.
	 */
	respawn: z
		.object({ seconds: z.number().positive(), step: z.number().min(0), maxSeconds: z.number().positive() })
		.optional(),
	scoreTarget: z.number().int().positive(),
	enemyLevel: z.number().int().min(1).max(60),
	recommendedLevel: z.number().int().min(1).max(50),
	spawn: z.object({
		perSecond: z.number().positive(),
		maxAlive: z.number().int().positive().max(300),
		composition: z.record(id, z.number().positive())
	}),
	/** hidden caches: open with interact for an item drop */
	caches: z.array(z.object({ x: z.number(), y: z.number() })).max(16),
	/** locked doors this mission opens (and closes behind the squad) when an objective is done */
	gates: z
		.record(
			id,
			z.object({
				openOn: z.number().int().min(0),
				closeOn: z.number().int().min(0).optional(),
				/** a point on the side the squad goes on to: whoever is left behind is brought here */
				side: point.optional()
			})
		)
		.optional(),
	objectives: z.array(objectiveSchema).min(1)
})

/** The campaign: zones in order, each with its missions in order. */
export const campaignSchema = z.object({
	zones: z
		.array(
			z.object({
				id,
				name: z.string().min(1),
				description: z.string().min(1),
				missions: z.array(id).min(1)
			})
		)
		.min(1),
	/** contracts: short runs outside the campaign, every one open from the start */
	contracts: z.array(id).optional()
})

/** Interactive map props: their numbers. */
export const propsDataSchema = z.object({
	barrel: z.object({
		health: z.number().positive(),
		radius: z.number().positive(),
		blastDamage: z.number().min(0),
		blastRadius: z.number().positive(),
		playerDamageShare: z.number().min(0).max(1)
	}),
	crate: z.object({ health: z.number().positive() }),
	sandbags: z.object({ health: z.number().positive() }),
	door: z.object({
		weldSeconds: z.number().positive(),
		weldedHealth: z.number().positive(),
		closedHealth: z.number().positive(),
		toggleSeconds: z.number().min(0)
	}),
	/** a generator: a hold starts it, then it runs up (zombies come for it) until it is on */
	generator: z.object({
		holdSeconds: z.number().positive(),
		startSeconds: z.number().min(0),
		health: z.number().positive()
	}),
	terminal: z.object({ holdSeconds: z.number().positive() }),
	turret: z.object({
		damage: z.number().positive(),
		shotsPerSecond: z.number().positive(),
		range: z.number().positive(),
		damageType
	}),
	trap: z.object({
		radius: z.number().positive(),
		damagePerSecond: z.number().positive(),
		activeSeconds: z.number().positive(),
		cooldownSeconds: z.number().min(0),
		damageType
	}),
	survivor: z.object({
		health: z.number().positive(),
		speed: z.number().positive(),
		followDistance: z.number().positive(),
		freeSeconds: z.number().positive(),
		radius: z.number().positive(),
		/** a survivor stuck out of reach this long catches up with the one they follow */
		stuckSeconds: z.number().positive()
	}),
	carry: z.object({ speedMultiplier: z.number().positive().max(1), pickupSeconds: z.number().positive() }),
	defend: z.object({ health: z.number().positive() }),
	/** an ammo station: a hold refills the reserve ammo of a player's guns for `price` score */
	ammo: z.object({ holdSeconds: z.number().positive(), price: z.number().int().min(0) }),
	/** a nest: shoot or blow it up; until then it sends zombies out while players are near */
	nest: z.object({
		health: z.number().positive(),
		spawnEverySeconds: z.number().positive(),
		/** players within this distance wake it */
		wakeRange: z.number().positive(),
		composition: z.record(id, z.number().positive())
	}),
	interactRange: z.number().positive(),
	/** holding interact on a damaged defend target or welded door mends it this fast */
	repairPerSecond: z.number().positive(),
	/** extraction waits only for players who acted this recently (not the idle or disconnected) */
	extractIdleSeconds: z.number().positive()
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
		armour: z.object({
			head: itemRefSchema.nullable(),
			torso: itemRefSchema.nullable(),
			vest: itemRefSchema.nullable(),
			legs: itemRefSchema.nullable(),
			feet: itemRefSchema.nullable()
		}),
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
export type ArmourPiece = z.infer<typeof armourPiece>
/** the armour slots in loadout order */
export const ARMOUR_PIECES = ['head', 'torso', 'vest', 'legs', 'feet'] as const satisfies readonly ArmourPiece[]
export type UtilityDef = GearDef['utility'][number]
export type EconomyDef = z.infer<typeof economySchema>
export type MapDef = z.infer<typeof mapSchema>
export type MapProp = z.infer<typeof mapPropSchema>
export type PropKindId = z.infer<typeof propKindId>
export type PropsData = z.infer<typeof propsDataSchema>
export type CampaignDef = z.infer<typeof campaignSchema>
export type WavesDef = z.infer<typeof wavesSchema>
export type ItemRef = z.infer<typeof itemRefSchema>
export type DifficultyId = z.infer<typeof difficultyId>
export type DifficultiesDef = z.infer<typeof difficultiesSchema>
export type DifficultyDef = DifficultiesDef['tiers'][number]
export type BuffsDef = z.infer<typeof buffsSchema>
export type BuffDef = BuffsDef['buffs'][number]
export type ObjectiveDef = z.infer<typeof objectiveSchema>
export type MissionDef = z.infer<typeof missionSchema>
export type Build = z.infer<typeof buildSchema>
