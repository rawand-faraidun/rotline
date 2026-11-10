import { describe, expect, it } from 'vitest'
import { harness } from './helpers.ts'

const { db, call, enlist } = harness('quick.rotline.test')

type View = { id: string; open: boolean; members: { id: string }[] }

async function post(jar: Awaited<ReturnType<typeof enlist>>['jar'], path: string, body: unknown = {}) {
	const response = await call(jar, `/api/party/${path}`, { method: 'POST', body: JSON.stringify(body) })
	return { status: response.status, body: (await response.json()) as { joined?: boolean; party?: View } & View }
}

describe('quick play', () => {
	it('opens the squad of someone with nobody to join, and puts the next player in it', async () => {
		const first = await enlist('Wes')
		const second = await enlist('Xan')
		// close any squad an earlier run left open
		await post(first.jar, 'open', { open: false })
		const alone = await post(first.jar, 'quick')
		expect(alone.status).toBe(200)
		const waiting = alone.body.party as View
		expect(waiting.open).toBe(true)
		const joined = await post(second.jar, 'quick')
		expect(joined.body.joined).toBe(true)
		expect(joined.body.party?.id).toBe(waiting.id)
		expect(joined.body.party?.members.map(member => member.id).sort()).toEqual([first.id, second.id].sort())
		// someone already in a squad cannot use it
		expect((await post(second.jar, 'quick')).status).toBe(409)
		await post(second.jar, 'leave')
		await post(first.jar, 'open', { open: false })
	})

	it('never puts a player in with someone either of them blocks, nor into a closed squad', async () => {
		const host = await enlist('Yul')
		const blocked = await enlist('Zed')
		const shut = await enlist('Ada')
		await post(host.jar, 'open', { open: true })
		await db.block.create({ data: { blockerId: host.id, blockedId: blocked.id } })
		const tried = await post(blocked.jar, 'quick')
		expect(tried.body.party?.members.some(member => member.id === host.id)).toBe(false)
		// a squad the leader closes again is not offered
		await post(host.jar, 'open', { open: false })
		await post(blocked.jar, 'open', { open: false })
		const other = await post(shut.jar, 'quick')
		expect(other.body.party?.members.some(member => member.id === host.id)).toBe(false)
		expect((await post(blocked.jar, 'open', { open: true })).status).toBe(200)
		const leader = await post(shut.jar, 'leave')
		expect(leader.status).toBe(200)
		await post(blocked.jar, 'open', { open: false })
		await post(shut.jar, 'open', { open: false })
	})
})
