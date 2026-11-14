import { createPublicKey } from 'node:crypto'
import { loadPrivateKey, verifyTicket } from '@rotline/ticket'
import { describe, expect, it } from 'vitest'
import { harness } from './helpers.ts'

const { env, parties, seats, call, enlist } = harness('modifiers.rotline.test')

type View = {
	mission: { id: string; difficulty: string; modifiers: string[] }
	members: { id: string; ready: boolean }[]
}

async function post(jar: Awaited<ReturnType<typeof enlist>>['jar'], path: string, body: unknown = {}) {
	const response = await call(jar, `/api/party/${path}`, { method: 'POST', body: JSON.stringify(body) })
	return { status: response.status, body: (await response.json()) as View }
}

describe('mission modifiers', () => {
	it('are kept in game order, clear ready marks when changed, and travel in the signed ticket', async () => {
		const host = await enlist('Bea')
		const guest = await enlist('Cal')
		const { code } = (await (await call(host.jar, '/api/party')).json()) as { code: string }
		await post(guest.jar, 'join', { code })
		const set = await post(host.jar, 'mission', {
			mission: 'landfall',
			difficulty: 'veteran',
			modifiers: ['blackout', 'swarm', 'swarm', 'nonsense']
		})
		expect(set.body.mission.modifiers).toEqual(['swarm', 'blackout'])
		const seen = { mission: 'landfall', difficulty: 'veteran', modifiers: ['swarm', 'blackout'] }
		expect((await post(guest.jar, 'ready', { ready: true, seen })).status).toBe(200)
		// the leader changes them: the guest agreed to something else
		await post(host.jar, 'mission', { mission: 'landfall', difficulty: 'veteran', modifiers: ['swarm'] })
		const after = (await (await call(host.jar, '/api/party')).json()) as View
		expect(after.members.find(member => member.id === guest.id)?.ready).toBe(false)
		// a ready mark for the old set is refused
		expect((await post(guest.jar, 'ready', { ready: true, seen })).status).toBe(409)
		await post(guest.jar, 'ready', { ready: true, seen: { ...seen, modifiers: ['swarm'] } })
		await seats.enter(host.id)
		expect((await post(host.jar, 'start', { seen: { ...seen, modifiers: ['swarm'] } })).status).toBe(200)
		const response = await call(host.jar, '/api/game/ticket', { method: 'POST', body: '{}' })
		const { ticket } = (await response.json()) as { ticket: string }
		const check = verifyTicket(createPublicKey(loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY)), ticket)
		expect(check.ok && check.payload.mission).toEqual({ id: 'landfall', difficulty: 'veteran', modifiers: ['swarm'] })
		await parties.endMission((await parties.current(host.id)).id)
		await seats.release(host.id)
	})

	it('are never kept for Survival', async () => {
		const solo = await enlist('Dov')
		const set = await post(solo.jar, 'mission', { mission: 'survival', difficulty: 'veteran', modifiers: ['swarm'] })
		expect(set.body.mission.modifiers).toEqual([])
	})
})
