import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createValkey, PARTY_AWAY_MS, PARTY_SIZE, PartyError, PartyStore } from '../src/index.ts'

// Needs Valkey (VALKEY_URL).
const valkey = createValkey(process.env.VALKEY_URL ?? 'redis://localhost:6379', 'rotline-test')
const parties = new PartyStore(valkey)
afterAll(() => valkey.quit())

const user = () => randomUUID()

describe('parties', () => {
	it('gives every player a party of one with a code', async () => {
		const me = user()
		const party = await parties.current(me)
		expect(party.members).toEqual([me])
		expect(party.leader).toBe(me)
		expect(party.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
		expect((await parties.current(me)).id).toBe(party.id)
	})

	it('creates one party when several requests ask at once', async () => {
		const me = user()
		const results = await Promise.all(Array.from({ length: 8 }, () => parties.current(me)))
		expect(new Set(results.map(party => party.id)).size).toBe(1)
		expect(new Set(results.map(party => party.code)).size).toBe(1)
		expect((await parties.current(me)).id).toBe(results[0]?.id)
	})

	it('joins by code, case-insensitively, and the old party of one disappears', async () => {
		const host = user()
		const guest = user()
		const hostParty = await parties.current(host)
		const guestParty = await parties.current(guest)
		const { party, left } = await parties.join(guest, hostParty.code.toLowerCase())
		expect(party.members).toEqual([host, guest])
		expect(left).toBe(guestParty.id)
		expect(await parties.get(guestParty.id)).toBeNull()
		expect(await parties.byCode(guestParty.code)).toBeNull()
	})

	it('refuses a fifth member and unknown codes', async () => {
		const host = user()
		const { code } = await parties.current(host)
		for (let i = 1; i < PARTY_SIZE; i++) await parties.join(user(), code)
		await expect(parties.join(user(), code)).rejects.toEqual(new PartyError('full'))
		await expect(parties.join(user(), 'ZZZZZZ')).rejects.toEqual(new PartyError('not-found'))
	})

	it('hands leadership on when the leader leaves', async () => {
		const host = user()
		const guest = user()
		const { code, id } = await parties.current(host)
		await parties.join(guest, code)
		const { party: own } = await parties.leave(host)
		expect(own.members).toEqual([host])
		expect((await parties.get(id))?.leader).toBe(guest)
	})

	it('only lets the leader kick, start, and only once everyone is ready', async () => {
		const host = user()
		const guest = user()
		const { code } = await parties.current(host)
		await parties.join(guest, code)
		await expect(parties.start(guest, 'room', 'local-1')).rejects.toEqual(new PartyError('not-leader'))
		await expect(parties.start(host, 'room', 'local-1')).rejects.toEqual(new PartyError('not-ready'))
		await parties.setReady(guest, true)
		const started = await parties.start(host, 'room-1', 'local-1')
		expect(started).toMatchObject({ state: 'mission', room: 'room-1', instance: 'local-1' })
		await expect(parties.join(user(), code)).rejects.toEqual(new PartyError('in-mission'))
		await parties.endMission(started.id)
		const back = await parties.get(started.id)
		expect(back).toMatchObject({ state: 'lobby', room: '', ready: [] })
		const kicked = await parties.kick(host, guest)
		expect(kicked.members).toEqual([host])
		expect((await parties.current(guest)).members).toEqual([guest])
	})

	it('lets only the leader choose the mission, in the lobby, clearing ready marks when it changes', async () => {
		const host = user()
		const guest = user()
		const { code } = await parties.current(host)
		await parties.join(guest, code)
		await parties.setReady(guest, true)
		await expect(parties.setMission(guest, 'yard-stand', 'nightmare')).rejects.toEqual(new PartyError('not-leader'))
		const chosen = await parties.setMission(host, 'yard-stand', 'nightmare')
		expect(chosen).toMatchObject({ mission: 'yard-stand', difficulty: 'nightmare', ready: [] })
		await parties.setReady(guest, true)
		// choosing the same again keeps the marks
		expect((await parties.setMission(host, 'yard-stand', 'nightmare')).ready).toEqual([guest])
		const started = await parties.start(host, 'room-m', 'local-1')
		await expect(parties.setMission(host, 'yard-sweep', 'veteran')).rejects.toEqual(new PartyError('in-mission'))
		expect((await parties.get(started.id))?.mission).toBe('yard-stand')
	})

	it('keeps the party consistent when many players join at once', async () => {
		const host = user()
		const { code, id } = await parties.current(host)
		const results = await Promise.allSettled(Array.from({ length: 10 }, () => parties.join(user(), code)))
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(PARTY_SIZE - 1)
		expect((await parties.get(id))?.members).toHaveLength(PARTY_SIZE)
	})

	it('takes players away for a while out of their squad, and closes a squad left empty', async () => {
		// timestamps far in the past, so only this test's players are old enough to sweep
		const t = 1_000 + Math.floor(Math.random() * 1_000)
		const host = user()
		const guest = user()
		const loner = user()
		const squad = await parties.current(host)
		await parties.join(guest, squad.code)
		const solo = await parties.current(loner)
		await parties.touch(host, t)
		await parties.touch(loner, t)
		await parties.touch(guest, t + PARTY_AWAY_MS)
		// another instance holding the lock skips the sweep
		const removed = await parties.sweep(PARTY_AWAY_MS, t + PARTY_AWAY_MS + 1)
		expect(removed).toEqual(
			expect.arrayContaining([
				{ userId: host, partyId: squad.id },
				{ userId: loner, partyId: solo.id }
			])
		)
		expect(removed.some(entry => entry.userId === guest)).toBe(false)
		const left = await parties.get(squad.id)
		expect(left?.members).toEqual([guest])
		expect(left?.leader).toBe(guest)
		expect(await parties.get(solo.id)).toBeNull()
		expect(await parties.byCode(solo.code)).toBeNull()
	})

	it('leaves squads in a mission alone, and the away time restarts when the mission ends', async () => {
		const t = 3_000 + Math.floor(Math.random() * 1_000)
		const host = user()
		const party = await parties.current(host)
		await parties.start(host, 'room', 'instance')
		await parties.touch(host, t)
		expect(await parties.sweep(PARTY_AWAY_MS, t + PARTY_AWAY_MS + 1)).not.toContainEqual({
			userId: host,
			partyId: party.id
		})
		await parties.endMission(party.id, t + PARTY_AWAY_MS)
		expect(await parties.sweep(PARTY_AWAY_MS, t + PARTY_AWAY_MS + 1)).not.toContainEqual({
			userId: host,
			partyId: party.id
		})
		expect((await parties.get(party.id))?.members).toEqual([host])
	})
})
