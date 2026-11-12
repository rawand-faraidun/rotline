import {
	achievements,
	currentBounty,
	currentChallenges,
	difficultyId,
	isSurvival,
	missionById,
	weekStart,
	zombies
} from '@rotline/game-data'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { settleAchievements } from '../lib/records.ts'

/** Places shown on a leaderboard (the player's own is added when they are lower down). */
const BOARD_SIZE = 20

const titleOf = (id: string | null) => (id ? (achievements.find(entry => entry.id === id)?.title ?? null) : null)

type BoardRow = {
	rank: number
	name: string
	avatarStyle: string
	avatarSeed: string
	title: string | null
	you: boolean
	/** Survival: rounds and score; missions: best time and best score */
	rounds?: number
	score: number
	timeMs: number
}

/**
 * The player's records: this rotation's challenges with their progress, achievements earned and
 * the title worn, the bestiary (kills by kind), and the leaderboards.
 */
export function recordRoutes({ db }: Services) {
	return new Hono<AppEnv>()
		.get('/records/challenges', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const active = currentChallenges(new Date())
			const rows = await db.challengeProgress.findMany({
				where: { playerId: user.id, challengeKey: { in: active.map(entry => entry.key) } }
			})
			const byKey = new Map(rows.map(row => [row.challengeKey, row]))
			return c.json(
				active.map(entry => ({
					key: entry.key,
					kind: entry.kind,
					text: entry.template.text,
					target: entry.template.target,
					reward: entry.reward,
					endsAt: entry.endsAt.toISOString(),
					progress: byKey.get(entry.key)?.progress ?? 0,
					done: byKey.get(entry.key)?.completedAt != null
				})),
				200
			)
		})
		.get('/records/bounty', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const bounty = currentBounty(new Date())
			const paid = await db.ledgerEntry.findUnique({
				where: { grantKey: `bounty:${user.id}:${bounty.key}` },
				select: { id: true }
			})
			return c.json(
				{
					key: bounty.key,
					zombie: bounty.bounty.zombie,
					title: bounty.bounty.title,
					mission: bounty.mission,
					difficulty: bounty.difficulty,
					reward: bounty.reward,
					endsAt: bounty.endsAt.toISOString(),
					done: paid !== null
				},
				200
			)
		})
		.get('/records/achievements', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			// anything the player's stats already reach is theirs (records kept before achievements existed)
			await settleAchievements(db, user.id)
			const [unlocked, stats, player] = await Promise.all([
				db.achievementUnlock.findMany({ where: { playerId: user.id } }),
				db.playerStat.findMany({
					where: { playerId: user.id, key: { in: [...new Set(achievements.map(entry => entry.stat))] } }
				}),
				db.player.findUnique({ where: { userId: user.id }, select: { titleId: true } })
			])
			const at = new Map(unlocked.map(entry => [entry.achievementId, entry.unlockedAt]))
			const value = new Map(stats.map(stat => [stat.key, Number(stat.value)]))
			return c.json(
				{
					title: player?.titleId ?? null,
					achievements: achievements.map(entry => ({
						id: entry.id,
						name: entry.name,
						description: entry.description,
						title: entry.title,
						target: entry.target,
						progress: Math.min(entry.target, value.get(entry.stat) ?? 0),
						unlockedAt: at.get(entry.id)?.toISOString() ?? null
					}))
				},
				200
			)
		})
		.put('/records/title', zValidator('json', z.object({ id: z.string().max(64).nullable() })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { id } = c.req.valid('json')
			// only a title the player has earned
			if (
				id !== null &&
				!(await db.achievementUnlock.findUnique({
					where: { playerId_achievementId: { playerId: user.id, achievementId: id } }
				}))
			)
				return c.json({ error: 'not-earned' as const }, 409)
			const result = await db.player.updateMany({ where: { userId: user.id }, data: { titleId: id } })
			if (result.count === 0) return c.json({ error: 'no-player' as const }, 404)
			return c.json({ title: titleOf(id) }, 200)
		})
		.get('/records/bestiary', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const stats = await db.playerStat.findMany({ where: { playerId: user.id, key: { startsWith: 'kill:' } } })
			const kills = new Map(stats.map(stat => [stat.key.slice(5), Number(stat.value)]))
			return c.json(
				zombies.filter(zombie => !zombie.dummy).map(zombie => ({ id: zombie.id, kills: kills.get(zombie.id) ?? 0 })),
				200
			)
		})
		.get(
			'/records/survival/:arena',
			zValidator('query', z.object({ period: z.enum(['all', 'week']).default('all') })),
			async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const arena = c.req.param('arena')
				if (!isSurvival(arena)) return c.json({ error: 'not-found' as const }, 404)
				const since = c.req.valid('query').period === 'week' ? weekStart(new Date()) : new Date(0)
				// each player's best run (most rounds, then most score), ranked
				const rows = await db.$queryRaw<
					{
						player_id: string
						rounds: number
						score: bigint
						time_ms: number
						place: bigint
						name: string
						avatar_style: string
						avatar_seed: string
						title_id: string | null
					}[]
				>`
					WITH best AS (
						SELECT DISTINCT ON (player_id) player_id, rounds, score, time_ms
						FROM survival_run
						WHERE arena = ${arena} AND created_at >= ${since}
						ORDER BY player_id, rounds DESC, score DESC, time_ms ASC
					), ranked AS (
						SELECT best.*, rank() OVER (ORDER BY rounds DESC, score DESC) AS place FROM best
					)
					SELECT ranked.*, p.name, p.avatar_style, p.avatar_seed, p.title_id
					FROM ranked JOIN player p ON p.user_id = ranked.player_id
					WHERE ranked.place <= ${BOARD_SIZE} OR ranked.player_id = ${user.id}::uuid
					ORDER BY ranked.place, p.name
					LIMIT ${BOARD_SIZE + 1}`
				return c.json(
					rows.map(
						(row): BoardRow => ({
							rank: Number(row.place),
							name: row.name,
							avatarStyle: row.avatar_style,
							avatarSeed: row.avatar_seed,
							title: titleOf(row.title_id),
							you: row.player_id === user.id,
							rounds: row.rounds,
							score: Number(row.score),
							timeMs: row.time_ms
						})
					),
					200
				)
			}
		)
		.get('/records/mission/:mission/:difficulty', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const mission = missionById(c.req.param('mission'))
			const difficulty = difficultyId.safeParse(c.req.param('difficulty'))
			if (!mission || !difficulty.success) return c.json({ error: 'not-found' as const }, 404)
			// the fastest completions, then the best score
			const rows = await db.$queryRaw<
				{
					player_id: string
					best_time_ms: number
					best_score: bigint
					place: bigint
					name: string
					avatar_style: string
					avatar_seed: string
					title_id: string | null
				}[]
			>`
				WITH ranked AS (
					SELECT player_id, best_time_ms, best_score,
						rank() OVER (ORDER BY best_time_ms ASC, best_score DESC) AS place
					FROM mission_progress
					WHERE mission_id = ${mission.id} AND difficulty = ${difficulty.data}::difficulty AND completions > 0
				)
				SELECT ranked.*, p.name, p.avatar_style, p.avatar_seed, p.title_id
				FROM ranked JOIN player p ON p.user_id = ranked.player_id
				WHERE ranked.place <= ${BOARD_SIZE} OR ranked.player_id = ${user.id}::uuid
				ORDER BY ranked.place, p.name
				LIMIT ${BOARD_SIZE + 1}`
			return c.json(
				rows.map(
					(row): BoardRow => ({
						rank: Number(row.place),
						name: row.name,
						avatarStyle: row.avatar_style,
						avatarSeed: row.avatar_seed,
						title: titleOf(row.title_id),
						you: row.player_id === user.id,
						score: Number(row.best_score),
						timeMs: row.best_time_ms
					})
				),
				200
			)
		})
}
