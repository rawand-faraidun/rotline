import { LedgerReason } from '@rotline/db'
import {
	achievements,
	currentChallenges,
	economy,
	isSurvival,
	missionById,
	SURVIVAL_ARENAS,
	statKeyId,
	waves,
	weapons,
	zombies
} from '@rotline/game-data'
import { z } from 'zod'
import { changeSalvage, type Tx } from './ledger.ts'

/** Keys the API works out itself: no report may set them. */
const DERIVED = new Set(['bestiary', 'challenges'])
const KINDS = new Set<string>(weapons.map(weapon => weapon.kind))
/** The most of each a single report can plausibly carry (reports go out at every wave and checkpoint). */
const PER_REPORT: Record<string, number> = { rounds: 5, revives: 60, objectives: 20, elites: 60 }
/** Stats only a finished mission's report may carry, and only for that mission. */
const RESULT_KEYS = /^(missions|missions:.+|mission:.+|clean-missions|gold)$/

/** A known stat: its zombie, weapon kind or mission exists. */
function known(key: string): boolean {
	if (DERIVED.has(key)) return false
	const [head, tail = ''] = key.split(':')
	if (head === 'kill') return zombies.some(zombie => zombie.id === tail && !zombie.dummy)
	if (head === 'weapon') return KINDS.has(tail)
	if (head === 'mission') return missionById(tail) !== undefined
	return true
}

export const tallySchema = z
	.record(statKeyId, z.number().int().min(0).max(100_000))
	.refine(tally => Object.keys(tally).length <= 64 && Object.keys(tally).every(known), 'unknown stat')

export const survivalSchema = z.object({
	arena: z.string().refine(isSurvival, 'not a Survival arena'),
	rounds: z.number().int().min(0).max(10_000),
	score: z.number().int().min(0),
	timeMs: z
		.number()
		.int()
		.positive()
		.max(24 * 60 * 60 * 1000),
	squad: z.number().int().min(1).max(4)
})

export type Tally = z.infer<typeof tallySchema>
export type SurvivalRecord = z.infer<typeof survivalSchema>

/**
 * A report's tally could really have come from the play it reports: no more kills than it pays for,
 * no more of anything than a stretch between two reports allows, and mission completions only with
 * that mission's own successful result.
 */
export function plausibleTally(
	tally: Tally,
	kills: number,
	result: { missionId: string; difficulty: string; success: boolean } | undefined
): boolean {
	const counted = tally.kills ?? 0
	if (counted > kills) return false
	let byType = 0
	let byWeapon = 0
	for (const [key, value] of Object.entries(tally)) {
		if (key.startsWith('kill:')) byType += value
		if (key.startsWith('weapon:')) byWeapon += value
		const most = PER_REPORT[key]
		if (most !== undefined && value > most) return false
		if (RESULT_KEYS.test(key)) {
			if (!result?.success || value > 1) return false
			if (key.startsWith('missions:') && key !== `missions:${result.difficulty}`) return false
			if (key.startsWith('mission:') && key !== `mission:${result.missionId}`) return false
		}
	}
	return byType <= counted && byWeapon <= counted && (tally.elites ?? 0) <= counted
}

/**
 * A Survival run that could have happened: each round takes at least its break between rounds, and
 * no more score than that time can earn.
 */
export function plausibleSurvival(run: SurvivalRecord): boolean {
	const seconds = run.timeMs / 1000
	return (
		run.rounds <= seconds / Math.max(1, waves.breakSeconds) + 1 &&
		run.score <= seconds * economy.rewards.maxScorePerSecond * run.squad &&
		SURVIVAL_ARENAS.some(arena => arena.id === run.arena)
	)
}

/** Adds to (or sets) a player's stat. */
async function addStat(tx: Tx, playerId: string, key: string, value: number, set = false): Promise<void> {
	await tx.playerStat.upsert({
		where: { playerId_key: { playerId, key } },
		create: { playerId, key, value: BigInt(value) },
		update: { value: set ? BigInt(value) : { increment: BigInt(value) } }
	})
}

/**
 * Unlocks every achievement the player's stats already reach (stats filled in from records kept
 * before achievements existed, or a target lowered in game data). Returns the ids newly earned.
 */
export async function settleAchievements(tx: Tx, playerId: string, now = new Date()): Promise<string[]> {
	const [stats, unlocked] = await Promise.all([
		tx.playerStat.findMany({ where: { playerId, key: { in: [...new Set(achievements.map(entry => entry.stat))] } } }),
		tx.achievementUnlock.findMany({ where: { playerId }, select: { achievementId: true } })
	])
	const value = new Map(stats.map(stat => [stat.key, stat.value]))
	const have = new Set(unlocked.map(entry => entry.achievementId))
	const earned = achievements.filter(
		entry => !have.has(entry.id) && (value.get(entry.stat) ?? 0n) >= BigInt(entry.target)
	)
	if (earned.length > 0)
		await tx.achievementUnlock.createMany({
			data: earned.map(entry => ({ playerId, achievementId: entry.id, unlockedAt: now })),
			skipDuplicates: true
		})
	return earned.map(entry => entry.id)
}

/**
 * What a report's tally and Survival run change, in the grant's transaction (the caller has locked
 * the player): lifetime stats, the bestiary count, progress on this rotation's challenges (paying
 * the ones finished, once each, through the ledger), achievements reached, and the run itself.
 * Returns the achievements and challenges newly done, for the player to be told.
 */
export async function applyRecords(
	tx: Tx,
	playerId: string,
	tally: Tally,
	survival: SurvivalRecord | undefined,
	now: Date
): Promise<{ achievements: string[]; challenges: string[] }> {
	const entries = Object.entries(tally).filter(([, value]) => value > 0)
	for (const [key, value] of entries) await addStat(tx, playerId, key, value)

	// the bestiary: how many kinds this player has killed
	if (entries.some(([key]) => key.startsWith('kill:'))) {
		const kinds = await tx.playerStat.count({ where: { playerId, key: { startsWith: 'kill:' }, value: { gt: 0 } } })
		await addStat(tx, playerId, 'bestiary', kinds, true)
	}

	const done: string[] = []
	for (const challenge of currentChallenges(now)) {
		const amount = tally[challenge.template.stat]
		if (!amount) continue
		const where = { playerId_challengeKey: { playerId, challengeKey: challenge.key } }
		const current = await tx.challengeProgress.findUnique({ where })
		if (current?.completedAt) continue
		const progress = Math.min(challenge.template.target, (current?.progress ?? 0) + amount)
		const finished = progress >= challenge.template.target
		await tx.challengeProgress.upsert({
			where,
			create: { playerId, challengeKey: challenge.key, progress, completedAt: finished ? now : null },
			update: { progress, completedAt: finished ? now : null }
		})
		if (!finished) continue
		// paid once: the grant key is the player's and the rotation's
		await changeSalvage(
			tx,
			playerId,
			challenge.reward,
			LedgerReason.contract,
			{ type: 'challenge', id: challenge.key },
			`challenge:${playerId}:${challenge.key}`
		)
		done.push(challenge.key)
	}
	if (done.length > 0) await addStat(tx, playerId, 'challenges', done.length)

	const earned: string[] = []
	const touched = new Set([...entries.map(([key]) => key), 'bestiary', 'challenges'])
	const candidates = achievements.filter(achievement => touched.has(achievement.stat))
	if (candidates.length > 0) {
		const [stats, unlocked] = await Promise.all([
			tx.playerStat.findMany({ where: { playerId, key: { in: candidates.map(entry => entry.stat) } } }),
			tx.achievementUnlock.findMany({ where: { playerId }, select: { achievementId: true } })
		])
		const value = new Map(stats.map(stat => [stat.key, stat.value]))
		const have = new Set(unlocked.map(entry => entry.achievementId))
		for (const achievement of candidates) {
			if (have.has(achievement.id) || (value.get(achievement.stat) ?? 0n) < BigInt(achievement.target)) continue
			await tx.achievementUnlock.create({ data: { playerId, achievementId: achievement.id, unlockedAt: now } })
			earned.push(achievement.id)
		}
	}

	if (survival)
		await tx.survivalRun.create({
			data: {
				playerId,
				arena: survival.arena,
				rounds: survival.rounds,
				score: BigInt(survival.score),
				timeMs: survival.timeMs,
				squad: survival.squad,
				createdAt: now
			}
		})
	return { achievements: earned, challenges: done }
}
