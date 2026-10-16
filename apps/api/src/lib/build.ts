import { type Database, ItemSource, PlayerClass } from '@rotline/db'
import { type Build, type ClassId, economy, type ItemRef, levelFromXp } from '@rotline/game-data'
import type { Tx } from './ledger.ts'

/** Gives a new player the three classes, the starter kit and a loadout, in the caller's transaction. */
export async function grantStarterKit(tx: Tx, playerId: string): Promise<void> {
	await tx.classProgress.createMany({
		data: Object.values(PlayerClass).map(cls => ({ playerId, class: cls })),
		skipDuplicates: true
	})
	await tx.inventoryItem.createMany({
		data: economy.starter.items.map(itemId => ({ playerId, itemId, source: ItemSource.starter })),
		skipDuplicates: true
	})
	const { main, pistol, armour, utility } = economy.starter.loadout
	await tx.loadout.createMany({
		data: [{ playerId, main1: main[0], main2: main[1], pistol, armour, utility1: utility[0], utility2: utility[1] }],
		skipDuplicates: true
	})
}

/** The player's build for their active class: what the game ticket carries into a mission. */
export async function loadBuild(db: Database, playerId: string): Promise<Build | null> {
	const player = await db.player.findUnique({
		where: { userId: playerId },
		include: { classes: true, skills: true, abilities: true, inventory: true, loadout: true }
	})
	if (!player?.loadout) return null
	const cls = player.activeClass as ClassId
	const progress = player.classes.find(entry => entry.class === cls)
	const owned = new Map(player.inventory.map(item => [item.itemId, item]))
	const ref = (id: string): ItemRef => {
		const item = owned.get(id)
		return { id, level: item?.upgradeLevel ?? 0, perks: item?.perks ?? [] }
	}
	const optional = (id: string | null) => (id ? ref(id) : null)
	const { loadout } = player
	return {
		class: cls,
		level: levelFromXp(Number(progress?.xp ?? 0)).level,
		skills: Object.fromEntries(
			player.skills.filter(skill => skill.class === cls).map(skill => [skill.nodeId, skill.rank])
		),
		abilities: player.abilities
			.filter(slot => slot.class === cls)
			.sort((a, b) => a.slot - b.slot)
			.map(slot => slot.abilityId),
		loadout: {
			main: [ref(loadout.main1), ref(loadout.main2)],
			pistol: ref(loadout.pistol),
			armour: optional(loadout.armour),
			utility: [optional(loadout.utility1), optional(loadout.utility2)]
		}
	}
}
