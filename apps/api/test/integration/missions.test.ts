import { createPublicKey } from 'node:crypto'
import { economy, items, Mastery, type MissionDef, missionById } from '@rotline/game-data'
import { claimPlayerRoom, recordRoomMission, releasePlayerRoom } from '@rotline/state'
import { loadPrivateKey, signMessage, verifyTicket } from '@rotline/ticket'
import { describe, expect, it } from 'vitest'
import { grantReward, plausibleResult, RewardWorker } from '../../src/rewards.ts'
import { harness } from './helpers.ts'

const { env, db, valkey, parties, seats, log, call, enlist } = harness('missions.rotline.test')

const sweep = missionById('yard-sweep') as MissionDef
const tierOne = items.filter(item => item.tier === 1).map(item => item.id)
const rewardKey = loadPrivateKey(process.env.GAME_REWARD_PRIVATE_KEY ?? '')

const result = (timeMs: number, score = 0, difficulty: 'veteran' | 'nightmare' = 'veteran') => ({
	missionId: sweep.id,
	difficulty,
	success: true,
	timeMs,
	score,
	downs: 0,
	squad: 1,
	optionalDone: 0
})

async function party(jar: Awaited<ReturnType<typeof enlist>>['jar'], path: string, body: unknown) {
	const response = await call(jar, `/api/party/${path}`, { method: 'POST', body: JSON.stringify(body) })
	return { status: response.status, body: (await response.json()) as { mission?: { id: string; difficulty: string } } }
}

describe('missions', () => {
	it('lets the leader choose the mission, which the squad tickets then carry', async () => {
		const host = await enlist('Ona')
		const guest = await enlist('Pim')
		const { code, mission } = (await (await call(host.jar, '/api/party')).json()) as {
			code: string
			mission: { id: string; difficulty: string }
		}
		expect(mission).toEqual({ id: 'yard-sweep', difficulty: 'veteran' })
		await party(guest.jar, 'join', { code })
		expect((await party(guest.jar, 'mission', { mission: 'yard-stand', difficulty: 'nightmare' })).status).toBe(403)
		expect((await party(host.jar, 'mission', { mission: 'nowhere', difficulty: 'nightmare' })).status).toBe(400)
		expect((await party(host.jar, 'mission', { mission: 'yard-stand', difficulty: 'godlike' })).status).toBe(400)
		const chosen = await party(host.jar, 'mission', { mission: 'yard-stand', difficulty: 'nightmare' })
		expect(chosen.body.mission).toEqual({ id: 'yard-stand', difficulty: 'nightmare' })

		await party(guest.jar, 'ready', { ready: true })
		await seats.enter(host.id)
		await party(host.jar, 'start', {})
		const response = await call(host.jar, '/api/game/ticket', { method: 'POST', body: '{}' })
		expect(response.status).toBe(200)
		const { ticket } = (await response.json()) as { ticket: string }
		const check = verifyTicket(createPublicKey(loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY)), ticket)
		expect(check.ok && check.payload.mission).toEqual({ id: 'yard-stand', difficulty: 'nightmare' })
		// fixed once started
		expect((await party(host.jar, 'mission', { mission: 'yard-sweep', difficulty: 'veteran' })).status).toBe(409)
		await parties.endMission((await parties.current(host.id)).id)
		await seats.release(host.id)
	})

	it('refuses a start for a mission the leader no longer sees, and lets a player abandon', async () => {
		const solo = await enlist('Uma')
		await seats.enter(solo.id)
		await party(solo.jar, 'mission', { mission: 'yard-stand', difficulty: 'veteran' })
		// the client still showed the default
		expect((await party(solo.jar, 'start', { seen: { mission: 'yard-sweep', difficulty: 'veteran' } })).status).toBe(
			409
		)
		const started = await party(solo.jar, 'start', { seen: { mission: 'yard-stand', difficulty: 'veteran' } })
		expect(started.status).toBe(200)
		expect((await parties.current(solo.id)).state).toBe('mission')
		// abandoning a mission of one ends it
		await party(solo.jar, 'abandon', {})
		expect((await parties.current(solo.id)).state).toBe('lobby')
		// while the game holds the player in another room, no new start or ticket
		await claimPlayerRoom(valkey, solo.id, `squad-${crypto.randomUUID()}`)
		expect((await party(solo.jar, 'start', {})).status).toBe(409)
		await releasePlayerRoom(valkey, solo.id)
		await seats.release(solo.id)
	})

	it('grants found items as unlocks or duplicates, at most a mission’s worth per room', async () => {
		const { id } = await enlist('Quin')
		const room = `squad-${crypto.randomUUID()}`
		const found = [tierOne[0] as string, tierOne[0] as string, tierOne[1] as string]
		const report = (n: number, list: string[]) => ({
			grantKey: `${room}:${id}:0a1b2c3d:${n}`,
			userId: id,
			class: 'assault' as const,
			xp: 0,
			salvage: 0,
			kills: 0,
			items: list
		})
		expect(await grantReward(db, null, report(0, found))).toBe(true)
		const inventory = await db.inventoryItem.findMany({ where: { playerId: id, source: 'drop' } })
		expect(inventory.map(item => item.itemId).sort()).toEqual([tierOne[0], tierOne[1]].sort())
		expect(inventory.every(item => item.upgradeLevel === 0)).toBe(true)
		const duplicates = await db.itemDuplicate.findMany({ where: { playerId: id } })
		expect(duplicates.map(duplicate => [duplicate.itemId, duplicate.matchId])).toEqual([[tierOne[0], room]])
		// a later report from the same room may only bring the total up to the cap
		const more = [tierOne[2] as string, tierOne[3] as string, tierOne[4] as string]
		expect(await grantReward(db, null, report(1, more))).toBe(true)
		const total =
			(await db.inventoryItem.count({ where: { playerId: id, source: 'drop' } })) +
			(await db.itemDuplicate.count({ where: { playerId: id } }))
		expect(total).toBe(economy.drops.maxPerMission)
	})

	it('records completions, best time and score and the best mastery, shown per mission', async () => {
		const { jar, id } = await enlist('Rua')
		const par = sweep.parTimeSeconds * 1000
		const report = (n: number, outcome: ReturnType<typeof result>) => ({
			grantKey: `squad-${crypto.randomUUID()}:${id}:0a1b2c3d:${n}`,
			userId: id,
			class: 'medic' as const,
			xp: 10,
			salvage: 10,
			kills: 1,
			result: outcome
		})
		await grantReward(db, null, report(0, result(par * 0.7, sweep.scoreTarget, 'nightmare')))
		await grantReward(db, null, report(1, result(par * 1.2, 100)))
		await grantReward(db, null, report(2, result(par * 0.9, 50, 'nightmare')))
		const list = (await (await call(jar, '/api/missions')).json()) as {
			id: string
			difficulties: {
				difficulty: string
				completions: number
				bestTimeMs: number
				bestScore: number
				mastery: number
			}[]
		}[]
		const records = list.find(entry => entry.id === sweep.id)?.difficulties ?? []
		expect(records.find(entry => entry.difficulty === 'nightmare')).toEqual({
			difficulty: 'nightmare',
			completions: 2,
			bestTimeMs: Math.round(par * 0.7),
			bestScore: sweep.scoreTarget,
			mastery: Mastery.gold
		})
		expect(records.find(entry => entry.difficulty === 'veteran')).toMatchObject({
			completions: 1,
			mastery: Mastery.bronze
		})
		expect(list.find(entry => entry.id === 'yard-stand')?.difficulties).toEqual([])
	})

	it('counts one mission result per room, however many reports carry one', async () => {
		const { id } = await enlist('Tam')
		const room = `squad-${crypto.randomUUID()}`
		const report = (n: number) => ({
			grantKey: `${room}:${id}:0a1b2c3d:${n}`,
			userId: id,
			class: 'medic' as const,
			xp: 10,
			salvage: 10,
			kills: 1,
			result: result(sweep.parTimeSeconds * 1000)
		})
		expect(await grantReward(db, null, report(0))).toBe(true)
		expect(await grantReward(db, null, report(1))).toBe(true)
		const record = await db.missionProgress.findFirst({ where: { playerId: id } })
		expect(record?.completions).toBe(1)
	})

	it('refuses mission results that cannot happen', async () => {
		expect(plausibleResult(result(sweep.parTimeSeconds * 1000))).toBe(true)
		// faster than the timed objectives, more score than the time allows, unknown optional objectives
		expect(plausibleResult(result(10_000))).toBe(false)
		expect(plausibleResult(result(200_000, 1e9))).toBe(false)
		expect(plausibleResult({ ...result(200_000), optionalDone: 1 })).toBe(false)

		const { id } = await enlist('Sol')
		const stream = `rewards-test-${crypto.randomUUID()}`
		const worker = new RewardWorker(db, valkey, env.VALKEY_URL, log, 'test', createPublicKey(rewardKey), stream)
		await worker.start()
		try {
			const base = { userId: id, class: 'heavy', xp: 5, salvage: 5, kills: 1 }
			const send = async (report: object) => {
				const text = JSON.stringify(report)
				await valkey.xadd(stream, '*', 'report', text, 'sig', signMessage(rewardKey, text))
			}
			const room = () => `squad-${crypto.randomUUID()}`
			const sweepRoom = room()
			const survivalRoom = room()
			const otherRoom = room()
			await recordRoomMission(valkey, sweepRoom, { id: sweep.id, difficulty: 'veteran' })
			await recordRoomMission(valkey, survivalRoom, null)
			await recordRoomMission(valkey, otherRoom, { id: 'yard-stand', difficulty: 'veteran' })
			// impossible: refused whole
			await send({ ...base, grantKey: `${sweepRoom}:${id}:0a1b2c3d:0`, result: result(1000) })
			await send({ ...base, grantKey: `${sweepRoom}:${id}:0a1b2c3d:1`, items: ['p9-service'] })
			// not what the room plays: paid, but without the items or the result
			await send({ ...base, grantKey: `${survivalRoom}:${id}:0a1b2c3d:0`, items: [tierOne[1]] })
			await send({ ...base, grantKey: `${otherRoom}:${id}:0a1b2c3d:0`, result: result(sweep.parTimeSeconds * 1000) })
			// fits
			await send({ ...base, grantKey: `${sweepRoom}:${id}:0a1b2c3d:2`, items: [tierOne[0]] })
			let grants = 0
			for (let i = 0; i < 50 && grants < 3; i++) {
				await new Promise(resolve => setTimeout(resolve, 100))
				grants = await db.rewardGrant.count({ where: { playerId: id } })
			}
			expect(grants).toBe(3)
			const owned = await db.inventoryItem.findMany({ where: { playerId: id, source: 'drop' } })
			expect(owned.map(item => item.itemId)).toEqual([tierOne[0]])
			expect(await db.missionProgress.count({ where: { playerId: id } })).toBe(0)
		} finally {
			await worker.stop()
			await valkey.del(stream)
		}
	})
})
