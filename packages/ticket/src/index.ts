import { createPrivateKey, createPublicKey, type KeyObject, randomBytes, sign, verify } from 'node:crypto'
import { buildSchema } from '@rotline/game-data'
import { z } from 'zod'

/**
 * Game connection tickets: the API signs a short-lived, single-use ticket with Ed25519 and the
 * game server verifies it with the public key, without calling the database.
 * Format: base64url(JSON payload) "." base64url(signature).
 */
export const ticketPayload = z.object({
	/** player (user) id */
	sub: z.uuid(),
	name: z.string().min(1).max(32),
	room: z.string().min(1).max(64),
	/** game-server instance the ticket is for */
	inst: z.string().min(1).max(64),
	/** squads hold up to four players; a player alone is a squad of one */
	/** a squad mission, or the firing range (alone, no rewards) */
	mode: z.enum(['squad', 'range']),
	/** class, level, skills and loadout: the game server needs no database */
	build: buildSchema,
	/** expiry, unix seconds */
	exp: z.number().int().positive(),
	/** random, single use */
	nonce: z.string().min(16).max(64)
})

export type TicketPayload = z.infer<typeof ticketPayload>

export const TICKET_SECONDS = 30
/** a full skill tree and loadout fit comfortably */
export const MAX_TICKET_LENGTH = 4096

export function loadPrivateKey(base64Der: string): KeyObject {
	return createPrivateKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'pkcs8' })
}

export function loadPublicKey(base64Der: string): KeyObject {
	return createPublicKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'spki' })
}

export function signTicket(
	key: KeyObject,
	claims: Omit<TicketPayload, 'exp' | 'nonce'>,
	now = Date.now()
): { ticket: string; payload: TicketPayload } {
	const payload: TicketPayload = {
		...claims,
		exp: Math.floor(now / 1000) + TICKET_SECONDS,
		nonce: randomBytes(16).toString('base64url')
	}
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
	const signature = sign(null, Buffer.from(body), key).toString('base64url')
	return { ticket: `${body}.${signature}`, payload }
}

export type TicketCheck =
	| { ok: true; payload: TicketPayload }
	| { ok: false; reason: 'malformed' | 'signature' | 'expired' }

/** Checks shape, signature and expiry. Single use is enforced by the caller (it owns the nonce store). */
export function verifyTicket(key: KeyObject, ticket: string, now = Date.now()): TicketCheck {
	const [body, signature, extra] = ticket.split('.')
	if (!body || !signature || extra !== undefined || ticket.length > MAX_TICKET_LENGTH)
		return { ok: false, reason: 'malformed' }
	let valid = false
	try {
		valid = verify(null, Buffer.from(body), key, Buffer.from(signature, 'base64url'))
	} catch {
		return { ok: false, reason: 'malformed' }
	}
	if (!valid) return { ok: false, reason: 'signature' }
	let parsed: unknown
	try {
		parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
	} catch {
		return { ok: false, reason: 'malformed' }
	}
	const result = ticketPayload.safeParse(parsed)
	if (!result.success) return { ok: false, reason: 'malformed' }
	if (result.data.exp * 1000 < now) return { ok: false, reason: 'expired' }
	return { ok: true, payload: result.data }
}

/** Remembers used nonces until their ticket would have expired anyway. */
export class NonceStore {
	private readonly used = new Map<string, number>()

	/** Returns false if the nonce was already used. */
	claim(nonce: string, exp: number, now = Date.now()): boolean {
		if (this.used.size > 1000) this.sweep(now)
		if (this.used.has(nonce)) return false
		this.used.set(nonce, exp)
		return true
	}

	private sweep(now: number): void {
		for (const [nonce, exp] of this.used) if (exp * 1000 < now) this.used.delete(nonce)
	}
}
