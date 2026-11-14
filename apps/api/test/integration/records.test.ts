import { challenges, currentBounty, currentChallenges } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { fitBounty, plausibleSurvival, plausibleTally } from '../../src/lib/records.ts'
import { grantReward } from '../../src/rewards.ts'
import { harness } from './helpers.ts'

const { db, valkey, call, enlist } = harness('records.rotline.test')

let reports = 0
const report = (userId: string, extra: Record<string, unknown>) => ({
	grantKey: `squad-00000000-0000-4000-8000-${String(++reports).padStart(12, '0')}:${userId}:abcdef01:${reports}`,
	userId,
	class: 'assault' as const,
	xp: 0,
	salvage: 0,
	kills: 0,
	...extra
})

describe('records', () => {
	it('keeps lifetime stats and the bestiary from reported kills', async () => {
		const player = await enlist('Rex')
		await grantReward(
			db,
			valkey,
			report(player.id, { kills: 12, tally: { kills: 12, 'kill:retcher': 2, 'kill:drudge': 10, 'weapon:rifle': 12 } })
		)
		await grantReward(db, valkey, report(player.id, { kills: 3, tally: { kills: 3, 'kill:drudge': 3 } }))
		const bestiary = (await (await call(player.jar, '/api/records/bestiary')).json()) as { id: string; kills: number }[]
		expect(bestiary.find(entry => entry.id === 'drudge')?.kills).toBe(13)
		expect(bestiary.find(entry => entry.id === 'retcher')?.kills).toBe(2)
		expect(bestiary.find(entry => entry.id === 'warden')?.kills).toBe(0)
		const kinds = await db.playerStat.findUnique({ where: { playerId_key: { playerId: player.id, key: 'bestiary' } } })
		expect(kinds?.value).toBe(2n)
	})

	it('pays a finished challenge once, through the ledger', async () => {
		const player = await enlist('Sol')
		const now = new Date()
		const daily = currentChallenges(now).find(entry => entry.kind === 'daily')
		if (!daily) throw new Error('no daily')
		const stat = daily.template.stat
		const tally = { [stat]: daily.template.target, kills: daily.template.target }
		const kills = daily.template.target
		// stats that only a finished mission may report come with its result
		const result = stat.startsWith('mission')
			? {
					missionId: 'landfall',
					difficulty: 'veteran',
					success: true,
					timeMs: 600_000,
					score: 0,
					downs: 0,
					squad: 1,
					optionalDone: 0
				}
			: undefined
		await grantReward(db, valkey, report(player.id, { kills, tally, ...(result ? { result } : {}) }), now)
		await grantReward(db, valkey, report(player.id, { kills, tally, ...(result ? { result } : {}) }), now)
		const list = (await (await call(player.jar, '/api/records/challenges')).json()) as {
			key: string
			done: boolean
			progress: number
		}[]
		const row = list.find(entry => entry.key === daily.key)
		expect(row?.done).toBe(true)
		expect(row?.progress).toBe(daily.template.target)
		// paid once (the same kills may finish another of today's challenges too: that one pays on its own)
		const paid = await db.ledgerEntry.findMany({ where: { playerId: player.id, reason: 'contract', refId: daily.key } })
		expect(paid).toHaveLength(1)
		expect(Number(paid[0]?.amount)).toBe(challenges.daily.reward)
	})

	it('unlocks achievements, and only an earned title can be worn', async () => {
		const player = await enlist('Tam')
		expect(
			(await call(player.jar, '/api/records/title', { method: 'PUT', body: JSON.stringify({ id: 'first-blood' }) }))
				.status
		).toBe(409)
		await grantReward(db, valkey, report(player.id, { kills: 1, tally: { kills: 1, 'kill:drudge': 1 } }))
		const { achievements } = (await (await call(player.jar, '/api/records/achievements')).json()) as {
			achievements: { id: string; unlockedAt: string | null; progress: number }[]
		}
		expect(achievements.find(entry => entry.id === 'first-blood')?.unlockedAt).not.toBeNull()
		expect(achievements.find(entry => entry.id === 'hundred')?.progress).toBe(1)
		const worn = await call(player.jar, '/api/records/title', {
			method: 'PUT',
			body: JSON.stringify({ id: 'first-blood' })
		})
		expect(worn.status).toBe(200)
		expect(((await worn.json()) as { title: string }).title).toBe('Fresh Meat')
	})

	it('awards what earlier play already earned (stats filled in from older records)', async () => {
		const player = await enlist('Ida')
		await db.playerStat.create({ data: { playerId: player.id, key: 'mission:yard-stand', value: 2n } })
		const { achievements } = (await (await call(player.jar, '/api/records/achievements')).json()) as {
			achievements: { id: string; unlockedAt: string | null }[]
		}
		expect(achievements.find(entry => entry.id === 'ashgate')?.unlockedAt).not.toBeNull()
		expect(achievements.find(entry => entry.id === 'harrow')?.unlockedAt).toBeNull()
	})

	it('counts a mission once per room, gold once per mission, and a Survival run once per room', async () => {
		const player = await enlist('Wyn')
		// fast, every optional objective, a big score, nobody down: gold
		const won = {
			missionId: 'landfall',
			difficulty: 'veteran',
			success: true,
			timeMs: 60_000,
			score: 10_000_000,
			downs: 0,
			squad: 1,
			optionalDone: 5
		}
		const tally = { missions: 1, 'missions:veteran': 1, 'mission:landfall': 1 }
		const stat = async (key: string) =>
			(await db.playerStat.findUnique({ where: { playerId_key: { playerId: player.id, key } } }))?.value ?? 0n
		// two reports from one room: the second carries no result, so its mission stats are dropped
		const room = 'squad-00000000-0000-4000-8000-00000000aaaa'
		const inRoom = (n: number, extra: Record<string, unknown>) => ({
			...report(player.id, extra),
			grantKey: `${room}:${player.id}:abcdef01:${n}`
		})
		await grantReward(db, valkey, inRoom(1, { tally, result: won }))
		await grantReward(db, valkey, inRoom(2, { tally, result: won }))
		expect(await stat('missions')).toBe(1n)
		expect(await stat('mission:landfall')).toBe(1n)
		expect(await stat('gold')).toBe(1n)
		// another room, the same mission: completions count again, gold does not
		await grantReward(db, valkey, report(player.id, { tally, result: won }))
		expect(await stat('missions')).toBe(2n)
		expect(await stat('gold')).toBe(1n)
		// the same Survival run sent twice from one room is entered once
		const run = { arena: 'survival-docks', rounds: 4, score: 1000, timeMs: 600_000, squad: 1 }
		await grantReward(db, valkey, inRoom(3, { survival: run }))
		await grantReward(db, valkey, inRoom(4, { survival: run }))
		expect(await db.survivalRun.count({ where: { playerId: player.id } })).toBe(1)
	})

	it('ranks Survival runs by rounds, then score, one line per player', async () => {
		const first = await enlist('Uli')
		const second = await enlist('Vic')
		const run = (rounds: number, score: number) => ({
			arena: 'survival-docks',
			rounds,
			score,
			timeMs: 900_000,
			squad: 1
		})
		await grantReward(db, valkey, report(first.id, { survival: run(8, 20_000) }))
		await grantReward(db, valkey, report(first.id, { survival: run(12, 30_000) }))
		await grantReward(db, valkey, report(second.id, { survival: run(12, 45_000) }))
		const board = (await (await call(first.jar, '/api/records/survival/survival-docks?period=week')).json()) as {
			name: string
			rank: number
			rounds: number
			you: boolean
		}[]
		const mine = board.filter(row => row.you)
		expect(mine).toHaveLength(1)
		expect(mine[0]?.rounds).toBe(12)
		const ranks = board.map(row => row.rank)
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
		expect((await call(first.jar, '/api/records/survival/nowhere')).status).toBe(404)
	})
})

describe('plausibility', () => {
	it('refuses tallies the reported play could not produce', () => {
		expect(plausibleTally({ kills: 5, 'kill:drudge': 5 }, 5, undefined)).toBe(true)
		expect(plausibleTally({ kills: 6 }, 5, undefined)).toBe(false)
		expect(plausibleTally({ kills: 5, 'kill:drudge': 9 }, 5, undefined)).toBe(false)
		expect(plausibleTally({ rounds: 40 }, 0, undefined)).toBe(false)
		expect(plausibleTally({ missions: 1 }, 0, undefined)).toBe(false)
		const won = { missionId: 'landfall', difficulty: 'veteran', success: true }
		expect(plausibleTally({ missions: 1, 'missions:veteran': 1, 'mission:landfall': 1 }, 0, won)).toBe(true)
		expect(plausibleTally({ 'mission:warden': 1 }, 0, won)).toBe(false)
		expect(plausibleTally({ 'missions:apocalypse': 1 }, 0, won)).toBe(false)
	})

	it('refuses Survival runs faster than the rounds allow', () => {
		expect(plausibleSurvival({ arena: 'survival', rounds: 10, score: 1000, timeMs: 600_000, squad: 1 })).toBe(true)
		expect(plausibleSurvival({ arena: 'survival', rounds: 100, score: 1000, timeMs: 60_000, squad: 1 })).toBe(false)
	})
})

describe('bounties', () => {
	it("pay this week's bounty once, and only from a room playing its mission", async () => {
		const player = await enlist('Jem')
		const now = new Date()
		const bounty = currentBounty(now)
		const key = `bounty:${bounty.bounty.id}`
		await grantReward(db, valkey, report(player.id, { tally: { [key]: 1 } }), now)
		await grantReward(db, valkey, report(player.id, { tally: { [key]: 1 } }), now)
		const paid = await db.ledgerEntry.findMany({ where: { playerId: player.id, refType: 'bounty' } })
		expect(paid).toHaveLength(1)
		expect(Number(paid[0]?.amount)).toBe(bounty.reward)
		const view = (await (await call(player.jar, '/api/records/bounty')).json()) as { done: boolean; mission: string }
		expect(view.done).toBe(true)
		expect(view.mission).toBe(bounty.mission)
		// the worker keeps a bounty only from a room recorded on the bounty's mission and difficulty
		expect(fitBounty({ [key]: 1, kills: 3 }, { id: bounty.mission, difficulty: bounty.difficulty }, now)).toEqual({
			[key]: 1,
			kills: 3
		})
		expect(fitBounty({ [key]: 1, kills: 3 }, { id: 'nowhere', difficulty: bounty.difficulty }, now)).toEqual({
			kills: 3
		})
		expect(fitBounty({ [key]: 1 }, 'survival', now)).toEqual({})
		// a mission that started last week still hunts last week's bounty
		const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
		const earlier = currentBounty(lastWeek)
		const recorded = { id: earlier.mission, difficulty: earlier.difficulty, startedAt: lastWeek }
		expect(fitBounty({ [`bounty:${earlier.bounty.id}`]: 1 }, recorded, now)).toEqual({
			[`bounty:${earlier.bounty.id}`]: 1
		})
	})
})
