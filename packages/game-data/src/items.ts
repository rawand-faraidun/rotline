import { economy, gear, weapons } from './data.ts'
import type { ArmourPiece, Perk } from './schema.ts'

export type ItemSlot = 'main' | 'pistol' | 'armour' | 'utility'

/** Something a player can own: a weapon, an armour or a utility. One form each; no rarity. */
export type ItemDef = {
	id: string
	name: string
	slot: ItemSlot
	tier: 0 | 1 | 2 | 3
	price: number
	/** armour only: where it is worn */
	piece?: ArmourPiece
}

const asTier = (tier: number) => tier as 0 | 1 | 2 | 3
const tierPrice = (tier: number) => economy.tierPrices[String(tier) as '0']

export const items: ItemDef[] = [
	...weapons.flatMap(weapon =>
		weapon.tier === null
			? []
			: [
					{
						id: weapon.id,
						name: weapon.name,
						slot: weapon.kind === 'pistol' ? ('pistol' as const) : ('main' as const),
						tier: asTier(weapon.tier),
						price: weapon.price ?? tierPrice(weapon.tier)
					}
				]
	),
	...gear.armour.map(armour => ({
		id: armour.id,
		name: armour.name,
		slot: 'armour' as const,
		piece: armour.piece,
		tier: asTier(armour.tier),
		price: armour.price ?? tierPrice(armour.tier)
	})),
	...gear.utility.map(utility => ({
		id: utility.id,
		name: utility.name,
		slot: 'utility' as const,
		tier: asTier(utility.tier),
		price: utility.price ?? tierPrice(utility.tier)
	}))
]

export const itemById = new Map(items.map(item => [item.id, item]))

export function item(id: string): ItemDef {
	const found = itemById.get(id)
	if (!found) throw new Error(`unknown item ${id}`)
	return found
}

/** Salvage to raise an item from `level - 1` to `level`: tierBase × growth^(level − 1), rounded. */
export function upgradeCost(id: string, level: number): number {
	const { tierBase, growth, roundTo } = economy.upgrade
	const base = tierBase[String(item(id).tier) as '0']
	return Math.round((base * growth ** (level - 1)) / roundTo) * roundTo
}

/** Salvage spent on upgrades to bring an item to `level`. */
export function upgradeTotal(id: string, level: number): number {
	let total = 0
	for (let n = 1; n <= level; n++) total += upgradeCost(id, n)
	return total
}

export const discardValue = (id: string): number => economy.discard[String(item(id).tier) as '0']

/** The two perks offered at `level` (5 and 10 by default), or null when that level has no choice. */
export function perkOptions(id: string, level: number): readonly [Perk, Perk] | null {
	const weapon = weapons.find(candidate => candidate.id === id)
	return weapon?.perks.find(entry => entry.level === level)?.options ?? null
}

/** Perk levels the item has reached, in order. */
export function perkLevelsReached(id: string, level: number): number[] {
	const weapon = weapons.find(candidate => candidate.id === id)
	if (!weapon) return []
	return weapon.perks.map(entry => entry.level).filter(perkLevel => perkLevel <= level)
}
