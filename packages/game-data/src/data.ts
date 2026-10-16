import { z } from 'zod'
import abilitiesData from '../data/abilities.json' with { type: 'json' }
import classesData from '../data/classes.json' with { type: 'json' }
import economyData from '../data/economy.json' with { type: 'json' }
import gearData from '../data/gear.json' with { type: 'json' }
import yardData from '../data/maps/yard.json' with { type: 'json' }
import playerData from '../data/player.json' with { type: 'json' }
import assaultTree from '../data/skills/assault.json' with { type: 'json' }
import heavyTree from '../data/skills/heavy.json' with { type: 'json' }
import medicTree from '../data/skills/medic.json' with { type: 'json' }
import upgradesData from '../data/upgrades.json' with { type: 'json' }
import wavesData from '../data/waves.json' with { type: 'json' }
import weaponsData from '../data/weapons.json' with { type: 'json' }
import zombiesData from '../data/zombies.json' with { type: 'json' }
import {
	abilitySchema,
	type ClassId,
	classesSchema,
	economySchema,
	gearSchema,
	type MapDef,
	mapSchema,
	playerSchema,
	type SkillNode,
	type SkillTree,
	skillTreeSchema,
	upgradesSchema,
	wavesSchema,
	weaponSchema,
	zombieSchema
} from './schema.ts'

function parse<T>(name: string, schema: z.ZodType<T>, data: unknown): T {
	const result = schema.safeParse(data)
	if (!result.success) throw new Error(`game data ${name} is invalid:\n${z.prettifyError(result.error)}`)
	return result.data
}

function uniqueById<T extends { id: string }>(name: string, list: T[]): T[] {
	const seen = new Set<string>()
	for (const item of list) {
		if (seen.has(item.id)) throw new Error(`game data ${name}: duplicate id ${item.id}`)
		seen.add(item.id)
	}
	return list
}

function check(condition: boolean, message: string): void {
	if (!condition) throw new Error(`game data: ${message}`)
}

export const weapons = uniqueById('weapons', parse('weapons', z.array(weaponSchema), weaponsData))
export const zombies = uniqueById('zombies', parse('zombies', z.array(zombieSchema), zombiesData))
export const player = parse('player', playerSchema, playerData)
export const waves = parse('waves', wavesSchema, wavesData)
export const maps: Record<string, MapDef> = { yard: parse('maps/yard', mapSchema, yardData) }
export const classes = parse('classes', classesSchema, classesData)
export const abilities = uniqueById('abilities', parse('abilities', z.array(abilitySchema), abilitiesData))
export const gear = parse('gear', gearSchema, gearData)
export const economy = parse('economy', economySchema, economyData)
export const upgrades = parse('upgrades', upgradesSchema, upgradesData)
export const skillTrees: Record<ClassId, SkillTree> = {
	assault: parse('skills/assault', skillTreeSchema, assaultTree),
	medic: parse('skills/medic', skillTreeSchema, medicTree),
	heavy: parse('skills/heavy', skillTreeSchema, heavyTree)
}

/** Every skill node by id, with where it sits. Node ids are unique across all classes. */
export const skillNodes = new Map<string, { node: SkillNode; class: ClassId; branch: string }>()

// --- cross references ---------------------------------------------------------------------------

for (const [index, wave] of waves.waves.entries()) {
	for (const key of Object.keys(wave)) {
		check(
			zombies.some(zombie => zombie.id === key),
			`waves[${index}]: unknown zombie ${key}`
		)
	}
}
for (const weapon of weapons) {
	for (const { level } of weapon.perks) {
		check(economy.upgrade.perkLevels.includes(level), `weapon ${weapon.id}: perks at level ${level}, not a perk level`)
	}
}
uniqueById('items', [...weapons.filter(weapon => weapon.tier !== null), ...gear.armour, ...gear.utility])
uniqueById(
	'perks',
	weapons.flatMap(weapon => weapon.perks.flatMap(perk => perk.options))
)
for (const [classKey, tree] of Object.entries(skillTrees) as [ClassId, SkillTree][]) {
	check(tree.class === classKey, `skills/${classKey}: class field says ${tree.class}`)
	for (const branch of tree.branches) {
		check(
			branch.nodes.filter(node => node.kind === 'capstone').length === 1,
			`skills/${classKey}/${branch.id}: one capstone per branch`
		)
		for (const node of branch.nodes) {
			check(!skillNodes.has(node.id), `skills: duplicate node id ${node.id}`)
			skillNodes.set(node.id, { node, class: classKey, branch: branch.id })
			if (node.ability) {
				const ability = abilities.find(candidate => candidate.id === node.ability)
				check(
					ability?.class === classKey,
					`skills/${classKey}: ${node.id} names ability ${node.ability} of another class`
				)
			}
			if (node.kind === 'capstone') check(node.tier === 5, `skills/${classKey}: capstone ${node.id} must be tier 5`)
		}
	}
}
for (const ability of abilities) {
	check(
		[...skillNodes.values()].some(entry => entry.node.ability === ability.id),
		`ability ${ability.id} has no skill node`
	)
}
check(
	classes.classes.map(entry => entry.id).join() === 'assault,medic,heavy',
	'classes: assault, medic, heavy in order'
)

export const weaponIndex = (id: string): number => {
	const index = weapons.findIndex(weapon => weapon.id === id)
	if (index < 0) throw new Error(`unknown weapon ${id}`)
	return index
}

export const zombieIndex = (id: string): number => {
	const index = zombies.findIndex(zombie => zombie.id === id)
	if (index < 0) throw new Error(`unknown zombie ${id}`)
	return index
}

export const classDef = (id: ClassId) =>
	classes.classes.find(entry => entry.id === id) as (typeof classes.classes)[number]
