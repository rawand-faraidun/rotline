import { buildProblem, economy, upgradeCost, xpToNext } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { loadBuild } from '../../src/lib/build.ts'
import { grantReward, RewardWorker } from '../../src/rewards.ts'
import type { ProgressView } from '../../src/routes/progress.ts'
import { harness, type Jar } from './helpers.ts'

const { env, db, valkey, parties, log, call, enlist } = harness('progression.rotline.test')

const progress = async (jar: Jar) => (await (await call(jar, '/api/progress')).json()) as ProgressView

async function post(jar: Jar, path: string, body: unknown, method = 'POST') {
	const response = await call(jar, `/api/progress/${path}`, { method, body: JSON.stringify(body) })
	return { status: response.status, body: (await response.json()) as ProgressView & { error?: string } }
}

let grants = 0
/** Pays a player as a game server would, through the same grant path. */
async function pay(id: string, xp: number, salvage: number, cls: 'assault' | 'medic' | 'heavy' = 'assault') {
	return grantReward(db, null, { grantKey: `test:${id}:${grants++}`, userId: id, class: cls, xp, salvage, kills: 0 })
}

const xpForLevel = (level: number) => {
	let total = 0
	for (let n = 1; n < level; n++) total += xpToNext(n)
	return total
}

describe('progression', () => {
	it('gives a new player the starter kit and three classes at level 1', async () => {
		const { jar } = await enlist('Ash')
		const view = await progress(jar)
		expect(view.salvage).toBe(0)
		expect(view.activeClass).toBe('assault')
		expect(view.inventory.map(item => item.itemId).sort()).toEqual([...economy.starter.items].sort())
		expect(view.loadout).toEqual({
			main1: 'vex-9',
			main2: 'k-71',
			pistol: 'p9-service',
			armour: 'kevlar-vest',
			utility1: 'frag-grenades',
			utility2: null
		})
		for (const cls of ['assault', 'medic', 'heavy'] as const) {
			expect(view.classes[cls]).toMatchObject({ xp: 0, level: 1, points: 1, spent: 0 })
		}
	})

	it('levels classes separately from rewards, and grants each report once', async () => {
		const { jar, id } = await enlist('Bea')
		const report = {
			grantKey: `once:${id}`,
			userId: id,
			class: 'medic' as const,
			xp: xpForLevel(5),
			salvage: 120,
			kills: 3
		}
		expect(await grantReward(db, null, report)).toBe(true)
		expect(await grantReward(db, null, report)).toBe(false)
		const view = await progress(jar)
		expect(view.classes.medic.level).toBe(5)
		expect(view.classes.assault.level).toBe(1)
		expect(view.salvage).toBe(120)
		const ledger = (await (await call(jar, '/api/progress/ledger')).json()) as {
			amount: number
			balanceAfter: number
		}[]
		expect(ledger).toEqual([expect.objectContaining({ amount: 120, balanceAfter: 120, reason: 'mission' })])
	})

	it('spends skill points by the tier rules, equips abilities and respecs for Salvage', async () => {
		const { jar, id } = await enlist('Cal')
		expect((await post(jar, 'skills', { nodeId: 'adrenaline-burst' })).status).toBe(200)
		expect((await post(jar, 'skills', { nodeId: 'fleet-foot' })).body.error).toBe('points')
		// each class has its own points: the Medic's first point is still free
		const medic = await post(jar, 'skills', { nodeId: 'medkit-drop' })
		expect(medic.body.classes.medic.skills).toEqual({ 'medkit-drop': 1 })
		expect(medic.body.classes.assault.spent).toBe(1)
		await pay(id, xpForLevel(10), 0)
		for (const node of ['fleet-foot', 'fleet-foot', 'quick-hands', 'steady-aim']) {
			expect((await post(jar, 'skills', { nodeId: node })).status).toBe(200)
		}
		expect((await post(jar, 'skills', { nodeId: 'fleet-foot' })).body.error).toBe('rank')
		expect((await post(jar, 'skills', { nodeId: 'slide-dash' })).body.error).toBe('tier-locked')
		expect((await post(jar, 'skills', { nodeId: 'run-and-gun' })).status).toBe(200)

		const equip = await post(jar, 'abilities', { class: 'assault', abilities: ['adrenaline-burst'] }, 'PUT')
		expect(equip.body.classes.assault.abilities).toEqual(['adrenaline-burst'])
		expect((await post(jar, 'abilities', { class: 'assault', abilities: ['slide-dash'] }, 'PUT')).status).toBe(409)

		const build = await loadBuild(db, id)
		expect(build && buildProblem(build)).toBeNull()
		expect(build?.skills).toMatchObject({ 'fleet-foot': 2, 'run-and-gun': 1 })
		expect(build?.abilities).toEqual(['adrenaline-burst'])

		expect((await post(jar, 'respec', { class: 'assault' })).body.error).toBe('not-enough-salvage')
		await pay(id, 0, 3000)
		const respec = await post(jar, 'respec', { class: 'assault' })
		expect(respec.status).toBe(200)
		expect(respec.body.salvage).toBe(3000 - economy.respecPrice)
		expect(respec.body.classes.assault).toMatchObject({ spent: 0, skills: {}, abilities: [] })
	})

	it('sells items at fixed prices, upgrades them and switches perks for a fee', async () => {
		const { jar, id } = await enlist('Dex')
		expect((await post(jar, 'buy', { itemId: 'breacher-12' })).body.error).toBe('not-enough-salvage')
		await pay(id, 0, 30000)
		const bought = await post(jar, 'buy', { itemId: 'breacher-12' })
		expect(bought.body.salvage).toBe(24000)
		expect((await post(jar, 'buy', { itemId: 'breacher-12' })).body.error).toBe('owned')
		expect(await db.purchase.count({ where: { playerId: id, sku: 'breacher-12' } })).toBe(1)

		let salvage = 24000
		for (let level = 1; level <= 5; level++) {
			const upgraded = await post(jar, 'upgrade', { itemId: 'breacher-12' })
			salvage -= upgradeCost('breacher-12', level)
			expect(upgraded.body.salvage).toBe(salvage)
		}
		expect(
			(await post(jar, 'perk', { itemId: 'breacher-12', level: 10, perkId: 'breacher-slam-fire' })).body.error
		).toBe('level-too-low')
		const first = await post(jar, 'perk', { itemId: 'breacher-12', level: 5, perkId: 'breacher-tight-choke' })
		expect(first.body.salvage).toBe(salvage)
		const switched = await post(jar, 'perk', { itemId: 'breacher-12', level: 5, perkId: 'breacher-extra-pellets' })
		expect(switched.body.salvage).toBe(salvage - economy.upgrade.perkSwitchPrice)
		expect(switched.body.inventory.find(item => item.itemId === 'breacher-12')).toMatchObject({
			level: 5,
			perks: ['breacher-extra-pellets']
		})
	})

	it('equips only owned items in the right slots', async () => {
		const { jar, id } = await enlist('Eli')
		const loadout = {
			main1: 'k-71',
			main2: 'vex-9',
			pistol: 'p9-service',
			armour: null,
			utility1: null,
			utility2: null
		}
		expect((await post(jar, 'loadout', loadout, 'PUT')).body.loadout).toEqual(loadout)
		expect((await post(jar, 'loadout', { ...loadout, main1: 'mower' }, 'PUT')).body.error).toBe('not-owned')
		expect((await post(jar, 'loadout', { ...loadout, main1: 'p9-service' }, 'PUT')).body.error).toBe('wrong-slot')
		expect((await post(jar, 'loadout', { ...loadout, main1: 'vex-9' }, 'PUT')).body.error).toBe('duplicate')
		await pay(id, 0, 0)
	})

	it('guards discards: never the last pistol or mains, and confirms equipped or upgraded items', async () => {
		const { jar, id } = await enlist('Fay')
		expect((await post(jar, 'discard', { itemId: 'p9-service' })).body.error).toBe('last-pistol')
		expect((await post(jar, 'discard', { itemId: 'vex-9' })).body.error).toBe('last-mains')
		await pay(id, 0, 6000)
		await post(jar, 'buy', { itemId: 'breacher-12' })
		const ask = await post(jar, 'discard', { itemId: 'vex-9' })
		expect(ask.body).toMatchObject({ error: 'needs-confirmation', equipped: true, level: 0, value: 300 })
		const done = await post(jar, 'discard', { itemId: 'vex-9', confirm: true })
		expect(done.status).toBe(200)
		expect(done.body.salvage).toBe(300)
		// the equipped slot took the spare main weapon
		expect(done.body.loadout.main1).toBe('breacher-12')
		expect(done.body.inventory.some(item => item.itemId === 'vex-9')).toBe(false)

		const duplicate = await db.itemDuplicate.create({ data: { playerId: id, itemId: 'k-71' } })
		const sold = await post(jar, 'discard-duplicate', { id: duplicate.id })
		expect(sold.body.salvage).toBe(600)
		expect(sold.body.duplicates).toEqual([])
	})

	it('keeps the build fixed during a mission', async () => {
		const { jar, id } = await enlist('Gus')
		await parties.start(id, `room-${id}`, 'test-instance')
		try {
			expect((await post(jar, 'class', { class: 'heavy' })).body.error).toBe('in-mission')
			expect((await post(jar, 'skills', { nodeId: 'adrenaline-burst' })).body.error).toBe('in-mission')
		} finally {
			await parties.endMission((await parties.current(id)).id)
		}
		expect((await post(jar, 'class', { class: 'heavy' })).body.activeClass).toBe('heavy')
		expect((await loadBuild(db, id))?.class).toBe('heavy')
	})

	it('never rewrites the ledger', async () => {
		const { id } = await enlist('Hal')
		await pay(id, 0, 50)
		await expect(db.$executeRaw`UPDATE ledger_entry SET amount = 1000 WHERE player_id = ${id}::uuid`).rejects.toThrow(
			/append-only/
		)
		await expect(db.$executeRaw`DELETE FROM ledger_entry WHERE player_id = ${id}::uuid`).rejects.toThrow(/append-only/)
	})

	it('turns reward reports from the stream into XP and Salvage', async () => {
		const { jar, id } = await enlist('Ivo')
		const stream = `rewards-test-${crypto.randomUUID()}`
		const worker = new RewardWorker(db, valkey, env.VALKEY_URL, log, 'test', stream)
		await worker.start()
		try {
			const report = { grantKey: `stream:${id}`, userId: id, class: 'heavy', xp: 250, salvage: 40, kills: 12 }
			await valkey.xadd(stream, '*', 'report', JSON.stringify(report))
			await valkey.xadd(stream, '*', 'report', JSON.stringify(report))
			let view = await progress(jar)
			for (let i = 0; i < 50 && view.salvage === 0; i++) {
				await new Promise(resolve => setTimeout(resolve, 100))
				view = await progress(jar)
			}
			expect(view.salvage).toBe(40)
			expect(view.classes.heavy.xp).toBe(250)
		} finally {
			await worker.stop()
			await valkey.del(stream)
		}
	})
})
