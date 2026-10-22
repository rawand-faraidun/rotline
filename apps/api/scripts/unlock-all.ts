// Opens everything for one test account: `pnpm --filter @rotline/api unlock <email or player name>`
// (reads DATABASE_URL from .env). Every class at the top level with every skill at full rank (the
// account is marked unrestricted, which lifts the skill-points limit), every item owned, fully upgraded,
// with its perks chosen, and every mission done on every difficulty. Safe to run again.
import { createDatabase, Difficulty, ItemSource, Mastery, PlayerClass } from '@rotline/db'
import {
	abilitySlotsAtLevel,
	classes,
	economy,
	items,
	missions,
	perkOptions,
	skillTrees,
	unlockedAbilities,
	xpToNext
} from '@rotline/game-data'

const [who] = process.argv.slice(2)
if (!who) {
	process.stderr.write('usage: unlock <email or player name>\n')
	process.exit(1)
}
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const db = createDatabase(url)
const { maxLevel } = classes.progression
let topXp = 0
for (let level = 1; level < maxLevel; level++) topXp += xpToNext(level)
const maxUpgrade = economy.upgrade.maxLevel
/** a done mission needs a time: ten minutes */
const CLEAR_MS = 600_000

try {
	const user = await db.user.findFirst({ where: { email: who } })
	const player = user
		? await db.player.findUnique({ where: { userId: user.id } })
		: await db.player.findUnique({ where: { nameKey: who.toLowerCase() } })
	if (!player) throw new Error(`no player for ${who}`)
	const playerId = player.userId
	await db.$transaction(async tx => {
		await tx.player.update({ where: { userId: playerId }, data: { unrestricted: true } })
		for (const cls of Object.values(PlayerClass)) {
			await tx.classProgress.upsert({
				where: { playerId_class: { playerId, class: cls } },
				create: { playerId, class: cls, xp: BigInt(topXp) },
				update: { xp: BigInt(topXp) }
			})
			const nodes = skillTrees[cls].branches.flatMap(branch => branch.nodes)
			await tx.skillAllocation.deleteMany({ where: { playerId, class: cls } })
			await tx.skillAllocation.createMany({
				data: nodes.map(node => ({ playerId, class: cls, nodeId: node.id, rank: node.maxRank }))
			})
			// the abilities already chosen stay; the free slots fill with the first ones unlocked
			const chosen = (await tx.abilitySlot.findMany({ where: { playerId, class: cls }, orderBy: { slot: 'asc' } })).map(
				slot => slot.abilityId
			)
			const skills = Object.fromEntries(nodes.map(node => [node.id, node.maxRank]))
			const abilities = [...new Set([...chosen, ...unlockedAbilities(skills)])].slice(0, abilitySlotsAtLevel(maxLevel))
			await tx.abilitySlot.deleteMany({ where: { playerId, class: cls } })
			await tx.abilitySlot.createMany({
				data: abilities.map((abilityId, index) => ({ playerId, class: cls, slot: index + 1, abilityId }))
			})
		}
		for (const def of items) {
			// a weapon's perks: the first choice at each perk level
			const perks = economy.upgrade.perkLevels.flatMap(level => {
				const options = perkOptions(def.id, level)
				return options && level <= maxUpgrade ? [options[0].id] : []
			})
			await tx.inventoryItem.upsert({
				where: { playerId_itemId: { playerId, itemId: def.id } },
				create: { playerId, itemId: def.id, upgradeLevel: maxUpgrade, perks, source: ItemSource.shop },
				update: { upgradeLevel: maxUpgrade, perks }
			})
		}
		for (const mission of missions)
			for (const difficulty of Object.values(Difficulty)) {
				await tx.missionProgress.upsert({
					where: { playerId_missionId_difficulty: { playerId, missionId: mission.id, difficulty } },
					create: {
						playerId,
						missionId: mission.id,
						difficulty,
						completions: 1,
						bestTimeMs: CLEAR_MS,
						mastery: Mastery.gold
					},
					update: { mastery: Mastery.gold }
				})
				await tx.missionProgress.updateMany({
					where: { playerId, missionId: mission.id, difficulty, completions: 0 },
					data: { completions: 1, bestTimeMs: CLEAR_MS }
				})
			}
	})
	process.stdout.write(
		`${player.name}: every class at level ${maxLevel} with every skill, ${items.length} items at +${maxUpgrade}, ${missions.length} missions done on every difficulty\n`
	)
} finally {
	await db.$disconnect()
}
