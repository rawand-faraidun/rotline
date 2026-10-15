import { createPublicKey } from 'node:crypto'
import { createDatabase } from '@rotline/db'
import { loadPrivateKey, verifyTicket } from '@rotline/ticket'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createAuth } from '../../src/auth.ts'
import { readEnv } from '../../src/env.ts'

// Needs PostgreSQL (DATABASE_URL, migrated) and the OAuth mock (AUTH_TEST_PROVIDER_ISSUER).
const env = readEnv({ ...process.env, NODE_ENV: 'test' })
const db = createDatabase(env.DATABASE_URL)
const app = createApp({ env, db, auth: createAuth(env, db), log: pino({ level: 'silent' }) })
const origin = env.PUBLIC_ORIGIN
const domain = 'integration.rotline.test'
// unique per run: the mock provider uses the username as the account id
const run = crypto.randomUUID().slice(0, 8)

type Jar = Map<string, string>

function remember(jar: Jar, response: Response) {
	for (const line of response.headers.getSetCookie()) {
		const [pair] = line.split(';')
		const [name, ...value] = (pair ?? '').split('=')
		if (name) jar.set(name.trim(), value.join('='))
	}
}

const cookieHeader = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')

async function call(jar: Jar, path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers)
	headers.set('cookie', cookieHeader(jar))
	headers.set('origin', origin)
	if (init.body) headers.set('content-type', 'application/json')
	const response = await app.request(path, { ...init, headers })
	remember(jar, response)
	return response
}

/** Runs the real OAuth code flow against the mock provider and returns a signed-in cookie jar. */
async function signIn(name: string): Promise<Jar> {
	const username = `${name}-${run}`
	const jar: Jar = new Map()
	const start = await call(jar, '/api/auth/sign-in/social', {
		method: 'POST',
		body: JSON.stringify({ provider: 'test', callbackURL: `${origin}/play` })
	})
	const { url } = (await start.json()) as { url: string }
	const login = await fetch(url, {
		method: 'POST',
		redirect: 'manual',
		body: new URLSearchParams({
			username,
			claims: JSON.stringify({ email: `${username}@${domain}`, email_verified: true })
		})
	})
	const callback = new URL(login.headers.get('location') ?? '')
	const done = await call(jar, `${callback.pathname}${callback.search}`)
	expect(done.status).toBe(302)
	return jar
}

beforeAll(async () => {
	await db.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } })
})

afterAll(async () => {
	await db.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } })
	await db.$disconnect()
})

describe('sign-in and player creation', () => {
	it('signs in, stores no name, photo or provider tokens, and creates a player', async () => {
		const jar = await signIn('alice')

		const me = await call(jar, '/api/me')
		expect(me.status).toBe(200)
		expect(await me.json()).toMatchObject({ user: { email: `alice-${run}@${domain}` }, player: null })

		const user = await db.user.findUniqueOrThrow({
			where: { email: `alice-${run}@${domain}` },
			include: { accounts: true }
		})
		expect(user.name).toBe('')
		expect(user.image).toBeNull()
		expect(user.accounts[0]).toMatchObject({ providerId: 'test', accessToken: null, refreshToken: null, idToken: null })

		const created = await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: `Rook${run.slice(0, 6)}`, avatarStyle: 'pixel-art', avatarSeed: 'seed-1' })
		})
		expect(created.status).toBe(201)

		const again = await call(jar, '/api/me')
		expect(await again.json()).toMatchObject({
			player: { name: `Rook${run.slice(0, 6)}`, salvage: 0, activeClass: 'assault' }
		})
	})

	it('refuses a second player for the same account', async () => {
		const jar = await signIn('alice')
		const response = await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: `Other${run.slice(0, 6)}`, avatarStyle: 'lorelei', avatarSeed: 'seed-4' })
		})
		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({ error: 'already-exists' })
	})

	it('refuses a second player with the same name in another case', async () => {
		const jar = await signIn('bob')
		const response = await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: `rook${run.slice(0, 6)}`, avatarStyle: 'lorelei', avatarSeed: 'seed-2' })
		})
		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({ error: 'invalid-name', problem: 'taken' })
	})

	it('refuses offensive and reserved names', async () => {
		const jar = await signIn('carol')
		const response = await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: 'RotlineAdmin', avatarStyle: 'lorelei', avatarSeed: 'seed-3' })
		})
		expect(response.status).toBe(422)
	})

	it('issues a signed solo game ticket only to players', async () => {
		const jar = await signIn('erin')
		const before = await call(jar, '/api/game/solo', { method: 'POST' })
		expect(before.status).toBe(404)
		await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: `Erin${run.slice(0, 6)}`, avatarStyle: 'pixelbot', avatarSeed: 'e' })
		})
		const response = await call(jar, '/api/game/solo', { method: 'POST' })
		expect(response.status).toBe(200)
		const body = (await response.json()) as { ticket: string; room: string; path: string }
		const publicKey = createPublicKey(loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY))
		const check = verifyTicket(publicKey, body.ticket)
		expect(check.ok && check.payload).toMatchObject({
			room: body.room,
			mode: 'solo',
			inst: env.GAME_INSTANCE_ID,
			name: `Erin${run.slice(0, 6)}`
		})
		expect(body.path).toBe('/game')
	})

	it('rejects requests without a session', async () => {
		const response = await app.request('/api/me')
		expect(response.status).toBe(401)
	})

	it('rejects state-changing requests from another origin', async () => {
		const jar = await signIn('dave')
		const response = await app.request('/api/player', {
			method: 'POST',
			headers: { cookie: cookieHeader(jar), origin: 'https://evil.example', 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Dave', avatarStyle: 'lorelei', avatarSeed: 'x' })
		})
		expect(response.status).toBe(403)
	})
})
