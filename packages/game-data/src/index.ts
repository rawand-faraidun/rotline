import { z } from 'zod'
import yardData from '../data/maps/yard.json' with { type: 'json' }
import playerData from '../data/player.json' with { type: 'json' }
import wavesData from '../data/waves.json' with { type: 'json' }
import weaponsData from '../data/weapons.json' with { type: 'json' }
import zombiesData from '../data/zombies.json' with { type: 'json' }
import { type MapDef, mapSchema, playerSchema, wavesSchema, weaponSchema, zombieSchema } from './schema.ts'

export * from './schema.ts'

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

export const weapons = uniqueById('weapons', parse('weapons', z.array(weaponSchema), weaponsData))
export const zombies = uniqueById('zombies', parse('zombies', z.array(zombieSchema), zombiesData))
export const player = parse('player', playerSchema, playerData)
export const waves = parse('waves', wavesSchema, wavesData)
export const maps: Record<string, MapDef> = { yard: parse('maps/yard', mapSchema, yardData) }

// cross references
for (const ref of [...player.loadout.main, player.loadout.pistol]) {
	if (!weapons.some(weapon => weapon.id === ref)) throw new Error(`game data player: unknown weapon ${ref}`)
}
for (const [index, wave] of waves.waves.entries()) {
	for (const key of Object.keys(wave)) {
		if (!zombies.some(zombie => zombie.id === key)) throw new Error(`game data waves[${index}]: unknown zombie ${key}`)
	}
}

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
