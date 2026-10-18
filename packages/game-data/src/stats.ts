import { classDef, classes, combat, economy, gear, skillNodes, upgrades, weaponIndex, weapons } from './data.ts'
import { itemById, perkOptions } from './items.ts'
import { validateAbilities, validateSkills } from './progression.ts'
import type {
	Build,
	ClassId,
	DamageType,
	Effect,
	ItemRef,
	StatKey,
	UtilityDef,
	WeaponDef,
	WeaponKind
} from './schema.ts'
import { ARMOUR_PIECES } from './schema.ts'

export type WeaponBehaviour = WeaponDef['behaviour']

/** A weapon with upgrades, perks and skills applied: the numbers the simulation uses. */
export type WeaponStats = {
	id: string
	/** index into `weapons` */
	index: number
	name: string
	kind: WeaponKind
	damageType: DamageType
	/** per shot and per pellet; a cone weapon's damage per second is spread over its shots */
	damage: number
	pellets: number
	fireRate: number
	automatic: boolean
	magazine: number
	/** null: unlimited (pistols) */
	maxReserve: number | null
	reloadSeconds: number
	reloadPerRound: boolean
	spreadDegrees: number
	range: number
	behaviour: WeaponBehaviour
}

export type PlayerStats = {
	class: ClassId
	level: number
	maxHealth: number
	speed: number
	reviveSeconds: number
	armour: number
	/** share of incoming damage removed after armour, 0..0.5 */
	damageReduction: number
	resist: Record<DamageType, number>
	killHeal: number
	healing: number
	healingReceived: number
	/** share of max health a revived player gets back */
	revivedHealth: number
	bleedoutBonusSeconds: number
	/** cooldown multiplier, e.g. 0.84 */
	abilityCooldown: number
	critDamage: number
	damageVsSlowed: number
	/** damage multiplier for abilities and utilities, by damage type (skills without a weapon filter) */
	damageByType: Record<DamageType, number>
	blastRadius: number
	weapons: [WeaponStats, WeaponStats, WeaponStats]
	/** the minigun from Minigun Spin-up (and later the buff), with skills applied */
	minigun: WeaponStats
	/** utility items in the two slots, with their charges for a wave; null when empty */
	utilities: [UtilityStats | null, UtilityStats | null]
	abilities: string[]
	specials: string[]
}

const WEAPON_STATS = new Set<StatKey>([
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
	'blastRadius'
])

function appliesTo(effect: Effect, weapon: WeaponDef): boolean {
	return (
		(!effect.kinds || effect.kinds.includes(weapon.kind)) &&
		(!effect.damageType || effect.damageType === weapon.damageType)
	)
}

/** A weapon at an upgrade level with perks, plus whichever skill effects apply to it. */
export function weaponStats(ref: ItemRef, skillEffects: readonly Effect[] = []): WeaponStats {
	const index = weaponIndex(ref.id)
	const def = weapons[index] as WeaponDef
	const sum: Partial<Record<StatKey, number>> = {}
	const add = (stat: StatKey, value: number) => {
		sum[stat] = (sum[stat] ?? 0) + value
	}
	for (const [stat, perLevel] of Object.entries(upgrades.weapon) as [StatKey, number][]) add(stat, perLevel * ref.level)
	for (const perkId of ref.perks) {
		const perk = def.perks.flatMap(entry => entry.options).find(option => option.id === perkId)
		for (const effect of perk?.effects ?? []) add(effect.stat, effect.value)
	}
	for (const effect of skillEffects)
		if (WEAPON_STATS.has(effect.stat) && appliesTo(effect, def)) add(effect.stat, effect.value)
	const pct = (stat: StatKey) => 1 + (sum[stat] ?? 0)
	const flat = (stat: StatKey) => Math.round(sum[stat] ?? 0)

	const fireRate = def.fireRate * pct('fireRate')
	const behaviour: WeaponBehaviour =
		def.behaviour.type === 'hitscan'
			? { type: 'hitscan', pierce: def.behaviour.pierce + flat('pierce') }
			: def.behaviour.type === 'chain'
				? { ...def.behaviour, chains: def.behaviour.chains + flat('chains') }
				: def.behaviour.type === 'projectile'
					? { ...def.behaviour, blastRadius: def.behaviour.blastRadius * pct('blastRadius') }
					: { ...def.behaviour, angleDegrees: def.behaviour.angleDegrees * Math.max(0.2, pct('spread')) }
	const perShot = def.behaviour.type === 'cone' ? (def.damage * 60) / def.fireRate : def.damage
	return {
		id: def.id,
		index,
		name: def.name,
		kind: def.kind,
		damageType: def.damageType,
		damage: perShot * pct('damage'),
		pellets: def.pellets + flat('pellets'),
		fireRate,
		automatic: def.automatic,
		magazine: Math.max(1, Math.round(def.magazine * pct('magazine'))),
		maxReserve: def.maxReserve === null ? null : Math.round(def.maxReserve * pct('reserve')),
		reloadSeconds: def.reloadSeconds / Math.max(0.2, pct('reloadSpeed')),
		reloadPerRound: def.reloadPerRound,
		spreadDegrees: def.spreadDegrees * Math.max(0.2, pct('spread')),
		range: def.range * pct('range'),
		behaviour
	}
}

export type UtilityStats = {
	id: string
	type: UtilityDef['type']
	charges: number
	throwRange: number
	armSeconds: number
	triggerRadius: number
	shotsPerSecond: number
	damageType: DamageType
	damage: number
	radius: number
	seconds: number
}

/** A utility at its upgrade level; skills add charges and blast radius. */
function utilityStats(ref: ItemRef | null, effects: readonly Effect[], extraCharges: number): UtilityStats | null {
	if (!ref) return null
	const def = gear.utility.find(entry => entry.id === ref.id)
	if (!def) return null
	const sum = (stat: StatKey) => effects.filter(effect => effect.stat === stat).reduce((total, e) => total + e.value, 0)
	return {
		id: def.id,
		type: def.type,
		charges: def.charges + Math.round(sum('utilityCharges')) + extraCharges,
		damageType: def.damageType,
		damage: def.damage * (1 + (upgrades.utility.damage ?? 0) * ref.level),
		radius:
			def.radius *
			(1 + (upgrades.utility.blastRadius ?? 0) * ref.level + (def.type === 'grenade' ? sum('blastRadius') : 0)),
		seconds: def.seconds,
		throwRange: def.throwRange ?? 0,
		armSeconds: def.armSeconds ?? 0,
		triggerRadius: def.triggerRadius ?? 0,
		shotsPerSecond: def.shotsPerSecond ?? 0
	}
}

/** Skill effects of an allocation, each multiplied by its rank. */
export function skillEffects(skills: Readonly<Record<string, number>>): Effect[] {
	const result: Effect[] = []
	for (const [id, rank] of Object.entries(skills)) {
		for (const effect of skillNodes.get(id)?.node.effects ?? []) result.push({ ...effect, value: effect.value * rank })
	}
	return result
}

/** Everything the simulation needs about a player, computed from their build. */
export function computeStats(build: Build): PlayerStats {
	const cls = classDef(build.class)
	const effects = skillEffects(build.skills)
	const total = (stat: StatKey, filter?: (effect: Effect) => boolean) =>
		effects.filter(effect => effect.stat === stat && (!filter || filter(effect))).reduce((sum, e) => sum + e.value, 0)

	// every worn piece adds its armour (with its upgrades), speed, resistances and utility charges
	const pieces = ARMOUR_PIECES.flatMap(piece => {
		const ref = build.loadout.armour[piece]
		const def = ref ? gear.armour.find(entry => entry.id === ref.id) : undefined
		return def && ref ? [{ def, level: ref.level }] : []
	})
	const armourBase = pieces.reduce(
		(sum, { def, level }) => sum + def.armour * (1 + (upgrades.armour.armour ?? 0) * level),
		0
	)
	const armourSpeed = pieces.reduce((sum, { def }) => sum + def.speed, 0)
	const armourCharges = pieces.reduce((sum, { def }) => sum + def.utilityCharges, 0)
	const resist = {} as Record<DamageType, number>
	for (const type of ['ballistic', 'explosive', 'fire', 'shock', 'chemical'] as const) {
		resist[type] = Math.min(
			combat.resistCap,
			pieces.reduce((sum, { def }) => sum + (def.resist[type] ?? 0), 0) +
				total('resist', effect => effect.damageType === type)
		)
	}

	const healthScale = 1 + classes.progression.healthPerLevel * (build.level - 1)
	return {
		class: build.class,
		level: build.level,
		maxHealth: Math.round(cls.health * healthScale * (1 + total('maxHealth'))),
		speed: cls.speed * (1 + total('moveSpeed') + armourSpeed),
		reviveSeconds: Math.max(combat.reviveFloorSeconds, cls.reviveSeconds + total('reviveTime')),
		armour: (armourBase + total('armour')) * (1 + total('armourPct')) * cls.armourEffectiveness,
		damageReduction: Math.min(combat.damageReductionCap, total('damageReduction')),
		resist,
		killHeal: total('killHeal'),
		healing: 1 + total('healing'),
		healingReceived: 1 + total('healingReceived'),
		revivedHealth: Math.min(1, combat.revivedHealth + total('revivedHealth')),
		bleedoutBonusSeconds: total('bleedout'),
		abilityCooldown: Math.max(combat.cooldownFloor, 1 + total('abilityCooldown')),
		critDamage: total('critDamage'),
		damageByType: Object.fromEntries(
			(['ballistic', 'explosive', 'fire', 'shock', 'chemical'] as const).map(type => [
				type,
				1 + total('damage', effect => !effect.kinds && (!effect.damageType || effect.damageType === type))
			])
		) as Record<DamageType, number>,
		damageVsSlowed: total('damageVsSlowed'),
		blastRadius: 1 + total('blastRadius'),
		weapons: [
			weaponStats(build.loadout.main[0], effects),
			weaponStats(build.loadout.main[1], effects),
			weaponStats(build.loadout.pistol, effects)
		],
		minigun: weaponStats({ id: 'minigun', level: 0, perks: [] }, effects),
		utilities: [
			utilityStats(build.loadout.utility[0], effects, armourCharges),
			utilityStats(build.loadout.utility[1], effects, armourCharges)
		],
		abilities: [...build.abilities],
		specials: Object.keys(build.skills).flatMap(id => skillNodes.get(id)?.node.special ?? [])
	}
}

/** Damage after armour, damage reduction and resistance. Melee has no damage type. */
export function damageTaken(stats: PlayerStats, amount: number, type: DamageType | null): number {
	const armour = stats.armour / (stats.armour + combat.armourConstant)
	const resist = type ? stats.resist[type] : 0
	return amount * (1 - armour) * (1 - stats.damageReduction) * (1 - resist)
}

const starterRef = (id: string): ItemRef => ({ id, level: 0, perks: [] })

/** The starter kit at level 1 with no skills: new accounts, bots and tests. */
export function starterBuild(classId: ClassId = 'assault'): Build {
	const loadout = economy.starter.loadout
	return {
		class: classId,
		level: 1,
		skills: {},
		abilities: [],
		loadout: {
			main: [starterRef(loadout.main[0]), starterRef(loadout.main[1])],
			pistol: starterRef(loadout.pistol),
			armour: {
				head: loadout.armour.head ? starterRef(loadout.armour.head) : null,
				torso: loadout.armour.torso ? starterRef(loadout.armour.torso) : null,
				vest: loadout.armour.vest ? starterRef(loadout.armour.vest) : null,
				legs: loadout.armour.legs ? starterRef(loadout.armour.legs) : null,
				feet: loadout.armour.feet ? starterRef(loadout.armour.feet) : null
			},
			utility: [
				loadout.utility[0] ? starterRef(loadout.utility[0]) : null,
				loadout.utility[1] ? starterRef(loadout.utility[1]) : null
			]
		}
	}
}

export type BuildProblem = 'skills' | 'abilities' | 'item' | 'slot' | 'level' | 'perk' | 'duplicate'

/** Checks a build against the rules before it is signed into a ticket. */
export function buildProblem(build: Build): BuildProblem | null {
	if (validateSkills(build.class, build.skills, build.level)) return 'skills'
	if (!validateAbilities(build.skills, build.level, build.abilities)) return 'abilities'
	const { main, pistol, armour, utility } = build.loadout
	const slots: [ItemRef | null, string][] = [
		[main[0], 'main'],
		[main[1], 'main'],
		[pistol, 'pistol'],
		...ARMOUR_PIECES.map(piece => [armour[piece], 'armour'] as [ItemRef | null, string]),
		[utility[0], 'utility'],
		[utility[1], 'utility']
	]
	if (main[0].id === main[1].id) return 'duplicate'
	if (utility[0] && utility[1] && utility[0].id === utility[1].id) return 'duplicate'
	// each armour piece in its own place
	for (const piece of ARMOUR_PIECES) {
		const ref = armour[piece]
		if (ref && itemById.get(ref.id)?.piece !== piece) return 'slot'
	}
	for (const [ref, slot] of slots) {
		if (!ref) continue
		const def = itemById.get(ref.id)
		if (!def) return 'item'
		if (def.slot !== slot) return 'slot'
		if (ref.level > economy.upgrade.maxLevel) return 'level'
		const levels = new Set<number>()
		for (const perkId of ref.perks) {
			const level = economy.upgrade.perkLevels.find(perkLevel =>
				perkOptions(ref.id, perkLevel)?.some(option => option.id === perkId)
			)
			if (level === undefined || level > ref.level || levels.has(level)) return 'perk'
			levels.add(level)
		}
	}
	return null
}
