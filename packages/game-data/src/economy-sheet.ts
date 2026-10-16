import { abilities, economy, zombies } from './data.ts'
import { items, upgradeTotal } from './items.ts'

/**
 * The economy sheet: what everything costs and how many hours of play that is. Generated from the
 * same data the game uses (`pnpm --filter @rotline/game-data economy`), so it cannot drift; a test
 * fails if the committed `economy.csv` is out of date.
 */
export function economySheet(): string {
	const perHour = economy.estimate.salvagePerHour
	const hours = (salvage: number) => (salvage / perHour).toFixed(1)
	const rows: (string | number)[][] = [
		['section', 'id', 'name', 'tier', 'salvage', 'hours of play'],
		['assumption', 'salvage-per-hour', economy.estimate.note, '', perHour, '1.0']
	]
	for (const item of items) rows.push(['buy', item.id, item.name, item.tier, item.price, hours(item.price)])
	for (const item of items) {
		const total = upgradeTotal(item.id, economy.upgrade.maxLevel)
		rows.push([`upgrade 1-${economy.upgrade.maxLevel}`, item.id, item.name, item.tier, total, hours(total)])
	}
	rows.push(['respec', 'one-class', 'Respec one class', '', economy.respecPrice, hours(economy.respecPrice)])
	rows.push([
		'perk switch',
		'any',
		'Switch a perk',
		'',
		economy.upgrade.perkSwitchPrice,
		hours(economy.upgrade.perkSwitchPrice)
	])
	for (const zombie of zombies.filter(entry => !entry.dummy))
		rows.push(['earn per kill', zombie.id, zombie.name, '', zombie.salvage, ''])
	rows.push(['earn per wave', 'wave-clear', 'Wave cleared', '', economy.rewards.waveClear.salvage, ''])
	rows.push(['abilities', 'count', `${abilities.length} active abilities`, '', '', ''])
	return `${rows.map(row => row.map(cell => (String(cell).includes(',') ? `"${cell}"` : cell)).join(',')).join('\n')}\n`
}
