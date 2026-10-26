import { type Database, ItemSource, PlayerClass } from '@rotline/db'
import {
	allSkillPoints,
	type Build,
	type ClassId,
	economy,
	fitSkills,
	type ItemRef,
	levelFromXp,
	pointsAtLevel,
	unlockedAbilities
} from '@rotline/game-data'
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
		data: [
			{
				playerId,
				main1: main[0],
				main2: main[1],
				pistol,
				armourHead: armour.head,
				armourTorso: armour.torso,
				armourVest: armour.vest,
				armourLegs: armour.legs,
				armourFeet: armour.feet,
				utility1: utility[0],
				utility2: utility[1]
			}
		],
		skipDuplicates: true
	})
}

/**
 * Brings saved skills in line with the current rules (when skill prices or points change): each
 * class's allocation is cut back until it fits, deepest ranks first, and abilities it no longer
 * unlocks leave their slots. The points come free again to spend. Nothing changes when it already fits.
 */
export async function fitSavedSkills(db: Database, playerId: string): Promise<void> {
	const player = await db.player.findUnique({
		where: { userId: playerId },
		select: { unrestricted: true, classes: true, skills: true, abilities: true }
	})
	if (!player) return
	for (const progress of player.classes) {
		const cls = progress.class as ClassId
		const rows = player.skills.filter(skill => skill.class === cls)
		if (rows.length === 0) continue
		const saved = Object.fromEntries(rows.map(row => [row.nodeId, row.rank]))
		const points = player.unrestricted ? allSkillPoints(cls) : pointsAtLevel(levelFromXp(Number(progress.xp)).level)
		const fitted = fitSkills(cls, saved, points)
		if (rows.every(row => fitted[row.nodeId] === row.rank)) continue
		const unlocked = new Set(unlockedAbilities(fitted))
		await db.$transaction(async tx => {
			for (const row of rows) {
				const rank = fitted[row.nodeId] ?? 0
				const where = { playerId_class_nodeId: { playerId, class: progress.class, nodeId: row.nodeId } }
				if (rank === 0) await tx.skillAllocation.delete({ where })
				else if (rank !== row.rank) await tx.skillAllocation.update({ where, data: { rank } })
			}
			const lost = player.abilities.filter(slot => slot.class === progress.class && !unlocked.has(slot.abilityId))
			for (const slot of lost)
				await tx.abilitySlot.deleteMany({ where: { playerId, class: progress.class, abilityId: slot.abilityId } })
		})
	}
}

/** The player's build for their active class: what the game ticket carries into a mission. */
export async function loadBuild(db: Database, playerId: string): Promise<Build | null> {
	await fitSavedSkills(db, playerId)
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
			armour: {
				head: optional(loadout.armourHead),
				torso: optional(loadout.armourTorso),
				vest: optional(loadout.armourVest),
				legs: optional(loadout.armourLegs),
				feet: optional(loadout.armourFeet)
			},
			utility: [optional(loadout.utility1), optional(loadout.utility2)]
		}
	}
}
