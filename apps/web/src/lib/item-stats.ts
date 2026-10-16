import { gear, item, upgrades, weaponStats, weapons } from '@rotline/game-data'
import { en, format } from '../i18n/en.ts'
import { oneDecimal } from './describe.ts'

const names = en.app.armory.statNames
const units = en.app.armory.units

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export type StatRow = { key: string; label: string; value: string }

/** The numbers worth showing for an item at an upgrade level, with its perks. */
export function itemStatRows(id: string, level: number, perks: readonly string[]): StatRow[] {
	const slot = item(id).slot
	if (slot === 'main' || slot === 'pistol') {
		const stats = weaponStats({ id, level, perks: [...perks] })
		const def = weapons.find(weapon => weapon.id === id)
		const cone = stats.behaviour.type === 'cone'
		const damage = cone
			? format(units.perSecond, { value: oneDecimal((stats.damage * stats.fireRate) / 60) })
			: stats.pellets > 1
				? `${oneDecimal(stats.damage)} × ${stats.pellets}`
				: oneDecimal(stats.damage)
		return [
			{ key: 'damage', label: names.damage, value: damage },
			...(cone || !def
				? []
				: [
						{
							key: 'fireRate',
							label: names.fireRate,
							value: format(units.rpm, { value: String(Math.round(stats.fireRate)) })
						}
					]),
			{ key: 'magazine', label: names.magazine, value: String(stats.magazine) },
			{
				key: 'reserve',
				label: names.reserve,
				value: stats.maxReserve === null ? en.app.progression.unlimited : String(stats.maxReserve)
			},
			{ key: 'reload', label: names.reload, value: format(units.seconds, { value: oneDecimal(stats.reloadSeconds) }) },
			{ key: 'range', label: names.range, value: format(units.metres, { value: oneDecimal(stats.range) }) }
		]
	}
	if (slot === 'armour') {
		const armour = gear.armour.find(entry => entry.id === id)
		if (!armour) return []
		const rows: StatRow[] = [
			{
				key: 'armour',
				label: names.armour,
				value: oneDecimal(armour.armour * (1 + (upgrades.armour.armour ?? 0) * level))
			}
		]
		if (armour.speed !== 0)
			rows.push({ key: 'speed', label: names.speed, value: `${Math.round(armour.speed * 100)} %` })
		for (const [type, share] of Object.entries(armour.resist)) {
			rows.push({
				key: `resist-${type}`,
				label: format(names.resist, {
					type: capitalise(en.app.progression.damageTypes[type as keyof typeof en.app.progression.damageTypes])
				}),
				value: `${Math.round((share ?? 0) * 100)} %`
			})
		}
		if (armour.utilityCharges > 0)
			rows.push({ key: 'charges', label: names.charges, value: `+${armour.utilityCharges}` })
		return rows
	}
	const utility = gear.utility.find(entry => entry.id === id)
	if (!utility) return []
	return [
		{ key: 'charges', label: names.charges, value: String(utility.charges) },
		{
			key: 'damage',
			label: names.damage,
			value: oneDecimal(utility.damage * (1 + (upgrades.utility.damage ?? 0) * level))
		},
		{
			key: 'radius',
			label: names.radius,
			value: format(units.metres, {
				value: oneDecimal(utility.radius * (1 + (upgrades.utility.blastRadius ?? 0) * level))
			})
		}
	]
}
