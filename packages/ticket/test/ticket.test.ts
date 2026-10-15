import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NonceStore, signTicket, TICKET_SECONDS, verifyTicket } from '../src/index.ts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const other = generateKeyPairSync('ed25519')
const claims = {
	sub: '01a13c3a-0f29-7637-91eb-a321f3559b51',
	name: 'Rook',
	room: 'solo-1',
	inst: 'local-1',
	mode: 'solo' as const
}

describe('tickets', () => {
	it('verifies a fresh ticket', () => {
		const { ticket, payload } = signTicket(privateKey, claims)
		expect(verifyTicket(publicKey, ticket)).toEqual({ ok: true, payload })
	})

	it('rejects tampering, wrong keys, expiry and junk', () => {
		const { ticket } = signTicket(privateKey, claims)
		const [body, signature] = ticket.split('.') as [string, string]
		const forged = Buffer.from(JSON.stringify({ ...claims, room: 'other', exp: 9e9, nonce: 'x'.repeat(20) })).toString(
			'base64url'
		)
		expect(verifyTicket(publicKey, `${forged}.${signature}`)).toEqual({ ok: false, reason: 'signature' })
		expect(verifyTicket(other.publicKey, ticket)).toEqual({ ok: false, reason: 'signature' })
		expect(verifyTicket(publicKey, ticket, Date.now() + (TICKET_SECONDS + 2) * 1000)).toEqual({
			ok: false,
			reason: 'expired'
		})
		expect(verifyTicket(publicKey, 'nope').ok).toBe(false)
		expect(verifyTicket(publicKey, `${body}.${signature}.extra`).ok).toBe(false)
		expect(verifyTicket(publicKey, `${body}.!!!`).ok).toBe(false)
	})

	it('allows each nonce once', () => {
		const store = new NonceStore()
		const { payload } = signTicket(privateKey, claims)
		expect(store.claim(payload.nonce, payload.exp)).toBe(true)
		expect(store.claim(payload.nonce, payload.exp)).toBe(false)
	})
})
