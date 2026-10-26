import { z } from 'zod'
import abilitiesData from '../data/abilities.json' with { type: 'json' }
import buffsData from '../data/buffs.json' with { type: 'json' }
import campaignData from '../data/campaign.json' with { type: 'json' }
import classesData from '../data/classes.json' with { type: 'json' }
import difficultiesData from '../data/difficulties.json' with { type: 'json' }
import economyData from '../data/economy.json' with { type: 'json' }
import gearData from '../data/gear.json' with { type: 'json' }
import airfieldData from '../data/maps/airfield.json' with { type: 'json' }
import compoundData from '../data/maps/compound.json' with { type: 'json' }
import crossroadsData from '../data/maps/crossroads.json' with { type: 'json' }
import depotData from '../data/maps/depot.json' with { type: 'json' }
import docksData from '../data/maps/docks.json' with { type: 'json' }
import elmcloseData from '../data/maps/elmclose.json' with { type: 'json' }
import glasshouseData from '../data/maps/glasshouse.json' with { type: 'json' }
import hospitalData from '../data/maps/hospital.json' with { type: 'json' }
import landfallData from '../data/maps/landfall.json' with { type: 'json' }
import mansionData from '../data/maps/mansion.json' with { type: 'json' }
import metroData from '../data/maps/metro.json' with { type: 'json' }
import motorpoolData from '../data/maps/motorpool.json' with { type: 'json' }
import oldtownData from '../data/maps/oldtown.json' with { type: 'json' }
import powerplantData from '../data/maps/powerplant.json' with { type: 'json' }
import railyardData from '../data/maps/railyard.json' with { type: 'json' }
import rangeData from '../data/maps/range.json' with { type: 'json' }
import supermarketData from '../data/maps/supermarket.json' with { type: 'json' }
import yardData from '../data/maps/yard.json' with { type: 'json' }
import missionsData from '../data/missions.json' with { type: 'json' }
import playerData from '../data/player.json' with { type: 'json' }
import propsData from '../data/props.json' with { type: 'json' }
import assaultTree from '../data/skills/assault.json' with { type: 'json' }
import heavyTree from '../data/skills/heavy.json' with { type: 'json' }
import medicTree from '../data/skills/medic.json' with { type: 'json' }
import upgradesData from '../data/upgrades.json' with { type: 'json' }
import wavesData from '../data/waves.json' with { type: 'json' }
import weaponsData from '../data/weapons.json' with { type: 'json' }
import zombiesData from '../data/zombies.json' with { type: 'json' }
import { fromLayout, type MapSource } from './layout.ts'
import {
	abilitySchema,
	buffsSchema,
	type ClassId,
	campaignSchema,
	classesSchema,
	type DifficultyDef,
	type DifficultyId,
	difficultiesSchema,
	economySchema,
	gearSchema,
	type MapDef,
	type MissionDef,
	mapSchema,
	missionSchema,
	playerSchema,
	propsDataSchema,
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
/** A map file: rectangles (`walls`) or a drawing (`layout`), checked either way. */
const loadMap = (name: string, data: unknown): MapDef =>
	parse(
		`maps/${name}`,
		mapSchema,
		data && typeof data === 'object' && 'layout' in data ? fromLayout(data as MapSource) : data
	)
export const maps: Record<string, MapDef> = {
	yard: loadMap('yard', yardData),
	range: loadMap('range', rangeData),
	landfall: loadMap('landfall', landfallData),
	railyard: loadMap('railyard', railyardData),
	powerplant: loadMap('powerplant', powerplantData),
	motorpool: loadMap('motorpool', motorpoolData),
	depot: loadMap('depot', depotData),
	crossroads: loadMap('crossroads', crossroadsData),
	airfield: loadMap('airfield', airfieldData),
	supermarket: loadMap('supermarket', supermarketData),
	hospital: loadMap('hospital', hospitalData),
	mansion: loadMap('mansion', mansionData),
	metro: loadMap('metro', metroData),
	compound: loadMap('compound', compoundData),
	oldtown: loadMap('oldtown', oldtownData),
	glasshouse: loadMap('glasshouse', glasshouseData),
	docks: loadMap('docks', docksData),
	elmclose: loadMap('elmclose', elmcloseData)
}
export const propsDef = parse('props', propsDataSchema, propsData)
export const campaign = parse('campaign', campaignSchema, campaignData)
export const classes = parse('classes', classesSchema, classesData)
export const abilities = uniqueById('abilities', parse('abilities', z.array(abilitySchema), abilitiesData))
export const abilityById = new Map(abilities.map(ability => [ability.id, ability]))
export const gear = parse('gear', gearSchema, gearData)
export const economy = parse('economy', economySchema, economyData)
export const upgrades = parse('upgrades', upgradesSchema, upgradesData)
export const difficulties = parse('difficulties', difficultiesSchema, difficultiesData)
export const buffs = parse('buffs', buffsSchema, buffsData)
export const missions = uniqueById('missions', parse('missions', z.array(missionSchema), missionsData))
/**
 * Each mission on each of its maps: the mission as written first, then its variants (contracts run
 * on several maps). A variant keeps the mission's id, rules and rewards; only the place changes.
 */
export const missionLayouts: ReadonlyMap<string, readonly MissionDef[]> = new Map(
	missions.map(mission => {
		const { variants, ...base } = mission
		// parsed data holds no keys set to undefined, so a variant's fields simply replace the mission's
		const layouts = [mission, ...(variants ?? []).map(variant => ({ ...base, ...variant }) as MissionDef)]
		return [mission.id, layouts] as const
	})
)
const layouts = [...missionLayouts.values()].flat()
const laidOut = new WeakMap<MissionDef, MapDef>()
/** The map a mission (or one of its variants) plays on, with the props the mission lays on it. */
export function missionMap(mission: MissionDef): MapDef {
	let map = laidOut.get(mission)
	if (!map) {
		const base = maps[mission.map] as MapDef
		map = mission.props?.length ? { ...base, props: [...(base.props ?? []), ...mission.props] } : base
		laidOut.set(mission, map)
	}
	return map
}
uniqueById('buffs', buffs.buffs)
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
			zombies.some(zombie => zombie.id === key && !zombie.dummy),
			`waves[${index}]: unknown zombie ${key}`
		)
	}
}
if (waves.boss) {
	const type = waves.boss.type
	check(
		zombies.some(zombie => zombie.id === type && zombie.elite === true),
		`waves: the boss ${type} is not an elite`
	)
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
// discards never pay more than buying costs
for (const tierKey of ['0', '1', '2', '3'] as const) {
	check(
		economy.discard[tierKey] < economy.tierPrices[tierKey],
		`economy: discard for tier ${tierKey} must be below its price`
	)
}
check(maps.range?.range !== undefined, 'maps/range: needs its range section')
for (const layout of layouts) check(maps[layout.map] !== undefined, `missions/${layout.id}: unknown map ${layout.map}`)
for (const mission of layouts) {
	const map = missionMap(mission)
	for (const key of Object.keys(mission.spawn.composition)) {
		check(
			zombies.some(zombie => zombie.id === key && !zombie.dummy),
			`missions/${mission.id}: unknown zombie ${key}`
		)
	}
	const inside = (x: number, y: number) => x > 0 && y > 0 && x < (map?.width ?? 0) && y < (map?.height ?? 0)
	for (const cache of mission.caches) check(inside(cache.x, cache.y), `missions/${mission.id}: cache outside the map`)
	const propIds = new Map((map?.props ?? []).map(prop => [prop.id, prop.kind]))
	const sections = new Set((map?.zombieSpawns ?? []).map(spawn => spawn.section ?? 0))
	const needs = (id: string, kinds: string[], what: string) =>
		check(
			kinds.includes(propIds.get(id) ?? ''),
			`missions/${mission.id}: ${what} ${id} is not a ${kinds.join(' or ')} on ${mission.map}`
		)
	const required = mission.objectives.filter(objective => !objective.optional)
	check(required.length > 0, `missions/${mission.id}: needs at least one objective that is not optional`)
	for (const objective of mission.objectives) {
		if ('area' in objective)
			check(inside(objective.area.x, objective.area.y), `missions/${mission.id}: area outside the map`)
		for (const section of objective.sections ?? [])
			check(sections.has(section), `missions/${mission.id}: no zombie spawns in section ${section}`)
		if (objective.type === 'interact') for (const id of objective.props) needs(id, ['generator', 'terminal'], 'prop')
		if (objective.type === 'destroy') for (const id of objective.props) needs(id, ['nest'], 'nest')
		if (objective.type === 'defend') needs(objective.prop, ['defend'], 'prop')
		const known = (id: string) => zombies.some(zombie => zombie.id === id && !zombie.dummy)
		if (objective.type === 'kill' && objective.of)
			check(known(objective.of), `missions/${mission.id}: kill objective names unknown zombie ${objective.of}`)
		for (const id of Object.keys(objective.ambush?.composition ?? {}))
			check(known(id), `missions/${mission.id}: ambush names unknown zombie ${id}`)
		if (objective.boss) {
			check(
				zombies.find(zombie => zombie.id === objective.boss?.type)?.elite === true,
				`missions/${mission.id}: boss ${objective.boss.type} is not an elite`
			)
			if (objective.boss.at)
				check(inside(objective.boss.at.x, objective.boss.at.y), `missions/${mission.id}: boss outside the map`)
		}
		if (objective.type === 'rescue') for (const id of objective.survivors) needs(id, ['survivor'], 'survivor')
		if (objective.type === 'retrieve') needs(objective.item, ['carry'], 'item')
		if (objective.optional)
			check(
				objective.type === 'kill' || objective.type === 'interact',
				`missions/${mission.id}: optional objectives are kill or interact`
			)
	}
	for (const [id, gate] of Object.entries(mission.gates ?? {})) {
		check(
			map?.props?.find(prop => prop.id === id)?.locked === true,
			`missions/${mission.id}: gate ${id} is not a locked door`
		)
		const step = (index: number | undefined) =>
			index === undefined || (mission.objectives[index] !== undefined && !mission.objectives[index]?.optional)
		check(
			step(gate.openOn) && step(gate.closeOn),
			`missions/${mission.id}: gate ${id} names an objective that is not a step`
		)
		check(
			gate.closeOn === undefined || gate.closeOn > gate.openOn,
			`missions/${mission.id}: gate ${id} closes before it opens`
		)
	}
}
/** The map's walls (and blockers) and blocking props as cells: 1 wall, 2 prop; for checking positions in the data. */
function occupancy(map: MapDef): Uint8Array {
	const cells = new Uint8Array(map.width * map.height)
	for (const wall of [...map.walls, ...(map.blockers ?? [])]) {
		for (let y = wall.y; y < wall.y + wall.h; y++) {
			for (let x = wall.x; x < wall.x + wall.w; x++) {
				if (x >= 0 && y >= 0 && x < map.width && y < map.height) cells[y * map.width + x] = 1
			}
		}
	}
	return cells
}
/**
 * Every step of a mission can be done: from where the squad starts it (the spawn or the last
 * checkpoint), with the gates as earlier steps left them, its area, props and checkpoint are reachable.
 * Map walls and locked gates block; doors and cover can be opened or broken, so they do not.
 */
function checkReachable(mission: MissionDef, map: MapDef): void {
	const walls = occupancy(map)
	const gateCells = new Map<string, number[]>()
	for (const prop of map.props ?? []) {
		if (!prop.locked) continue
		const cells: number[] = []
		for (let y = prop.y; y < prop.y + (prop.h ?? 1); y++)
			for (let x = prop.x; x < prop.x + (prop.w ?? 1); x++) cells.push(y * map.width + x)
		gateCells.set(prop.id, cells)
	}
	const propAt = new Map((map.props ?? []).map(prop => [prop.id, prop]))
	let start: { x: number; y: number } = map.playerSpawns[0] ?? { x: 1, y: 1 }
	for (const [index, objective] of mission.objectives.entries()) {
		if (objective.optional) continue
		const blocked = new Uint8Array(walls)
		for (const [id, cells] of gateCells) {
			const gate = mission.gates?.[id]
			const open = gate !== undefined && gate.openOn < index && (gate.closeOn === undefined || gate.closeOn >= index)
			if (!open) for (const cell of cells) blocked[cell] = 1
		}
		const reached = new Uint8Array(walls.length)
		const first = Math.floor(start.y) * map.width + Math.floor(start.x)
		const queue = [first]
		reached[first] = 1
		while (queue.length > 0) {
			const c = queue.pop() as number
			const cx = c % map.width
			const cy = (c - cx) / map.width
			for (const [dx, dy] of NEIGHBOURS) {
				const nx = cx + dx
				const ny = cy + dy
				if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue
				const n = ny * map.width + nx
				if (reached[n] || blocked[n] === 1) continue
				reached[n] = 1
				queue.push(n)
			}
		}
		const at = (point: { x: number; y: number }) => reached[Math.floor(point.y) * map.width + Math.floor(point.x)] === 1
		// a prop is worked from beside it
		const near = (id: string) => {
			const prop = propAt.get(id)
			if (!prop) return false
			for (let y = Math.floor(prop.y) - 1; y <= Math.floor(prop.y) + (prop.h ?? 1); y++)
				for (let x = Math.floor(prop.x) - 1; x <= Math.floor(prop.x) + (prop.w ?? 1); x++)
					if (x >= 0 && y >= 0 && x < map.width && y < map.height && reached[y * map.width + x]) return true
			return false
		}
		const where = `missions/${mission.id}: objective ${index}`
		if ('area' in objective) check(at(objective.area), `${where}'s area cannot be reached`)
		if (objective.type === 'interact' || objective.type === 'destroy')
			for (const id of objective.props) check(near(id), `${where}: ${id} cannot be reached`)
		if (objective.type === 'defend') check(near(objective.prop), `${where}: ${objective.prop} cannot be reached`)
		if (objective.type === 'rescue')
			for (const id of objective.survivors) check(near(id), `${where}: ${id} cannot be reached`)
		if (objective.type === 'retrieve') check(near(objective.item), `${where}: ${objective.item} cannot be reached`)
		if (objective.checkpoint) {
			const point = 'area' in objective ? objective.area : objective.checkpointAt
			if (point) start = point
		}
	}
}
const NEIGHBOURS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
] as const

const ON_CELLS = new Set([
	'barrel',
	'crate',
	'sandbags',
	'weakwall',
	'door',
	'generator',
	'terminal',
	'turret',
	'defend',
	'nest'
])
/** Checks where a map's props stand, and returns its cells with the props marked. */
function placeProps(name: string, map: MapDef): Uint8Array {
	const ids = new Set<string>()
	const cells = occupancy(map)
	check((map.props?.length ?? 0) <= 4096, `maps/${name}: at most 4096 props`)
	for (const prop of map.props ?? []) {
		check(!ids.has(prop.id), `maps/${name}: duplicate prop ${prop.id}`)
		ids.add(prop.id)
		check(
			prop.x >= 0 && prop.y >= 0 && prop.x < map.width && prop.y < map.height,
			`maps/${name}: prop ${prop.id} outside the map`
		)
		if (ON_CELLS.has(prop.kind)) {
			const w = prop.w ?? 1
			const h = prop.h ?? 1
			check(
				Number.isInteger(prop.x) && Number.isInteger(prop.y) && prop.x + w <= map.width && prop.y + h <= map.height,
				`maps/${name}: prop ${prop.id} must sit on whole cells inside the map`
			)
			for (let y = prop.y; y < prop.y + h; y++) {
				for (let x = prop.x; x < prop.x + w; x++) {
					const cell = y * map.width + x
					check(cells[cell] === 0, `maps/${name}: prop ${prop.id} overlaps a wall or another prop at ${x}, ${y}`)
					cells[cell] = 2
				}
			}
		} else {
			check(
				cells[Math.floor(prop.y) * map.width + Math.floor(prop.x)] === 0,
				`maps/${name}: prop ${prop.id} stands in a wall`
			)
		}
		if (prop.powerBy)
			check(
				map.props?.some(other => other.id === prop.powerBy && other.kind === 'generator') === true,
				`maps/${name}: ${prop.id} is powered by ${prop.powerBy}, which is not a generator`
			)
		if (prop.locked) check(prop.kind === 'door', `maps/${name}: only doors can be locked`)
	}
	return cells
}
const occupied = new Map<MapDef, Uint8Array>()
for (const [name, map] of Object.entries(maps)) occupied.set(map, placeProps(name, map))
for (const mission of layouts) {
	const map = missionMap(mission)
	let cells = occupied.get(map)
	if (!cells) {
		cells = placeProps(`${mission.map} (with ${mission.id}'s props)`, map)
		occupied.set(map, cells)
	}
	const floor = (point: { x: number; y: number }, what: string) =>
		check(
			cells[Math.floor(point.y) * map.width + Math.floor(point.x)] === 0,
			`missions/${mission.id}: ${what} is not on open floor`
		)
	for (const [index, cache] of mission.caches.entries()) floor(cache, `cache ${index}`)
	for (const [index, objective] of mission.objectives.entries()) {
		if ('area' in objective) floor(objective.area, `objective ${index}'s area`)
		if (objective.checkpointAt) floor(objective.checkpointAt, `objective ${index}'s checkpoint`)
		check(
			!objective.checkpoint || 'area' in objective || objective.checkpointAt !== undefined,
			`missions/${mission.id}: objective ${index} saves a checkpoint, so it needs an area or checkpointAt`
		)
	}
	checkReachable(mission, map)
	for (const [id, gate] of Object.entries(mission.gates ?? {})) {
		check(
			gate.closeOn === undefined || gate.side !== undefined,
			`missions/${mission.id}: gate ${id} closes, so it needs a side`
		)
		if (gate.side) floor(gate.side, `gate ${id}'s side`)
	}
}
{
	const listed = [...campaign.zones.flatMap(zone => zone.missions), ...(campaign.contracts ?? [])]
	check(new Set(listed).size === listed.length, 'campaign: a mission is listed twice')
	for (const id of listed)
		check(
			missions.some(mission => mission.id === id),
			`campaign: unknown mission ${id}`
		)
	for (const mission of missions)
		check(listed.includes(mission.id), `campaign: mission ${mission.id} is in no zone and is no contract`)
}
for (const tier of difficulties.tiers) {
	check(economy.drops.tierWeights[tier.id] !== undefined, `economy: drop weights for ${tier.id}`)
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

/** A capstone's numbers by its special id (e.g. 'momentum'). */
export function specialParams(special: string): Record<string, number> {
	for (const entry of skillNodes.values()) if (entry.node.special === special) return entry.node.params ?? {}
	return {}
}

export const combat = classes.combat

export const difficultyDef = (id: DifficultyId) => difficulties.tiers.find(entry => entry.id === id) as DifficultyDef

export const missionById = (id: string) => missions.find(mission => mission.id === id)

export const classDef = (id: ClassId) =>
	classes.classes.find(entry => entry.id === id) as (typeof classes.classes)[number]

/**
 * A fingerprint of the data the game server and the client must agree on (maps, props, missions,
 * zombies, weapons): FNV-1a over their JSON. A client built from other data reloads.
 */
export const dataVersion = (() => {
	const text = JSON.stringify([maps, propsDef, missions, zombies, weapons, campaign])
	let hash = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash
})()
