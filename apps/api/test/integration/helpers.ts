import { createAuth } from '@rotline/auth'
import { createDatabase } from '@rotline/db'
import { createValkey, PartyStore, Seats } from '@rotline/state'
import { pino } from 'pino'
import { afterAll, beforeAll, expect } from 'vitest'
import { createApp } from '../../src/app.ts'
import { readEnv } from '../../src/env.ts'
import { EventHub } from '../../src/events.ts'

export type Jar = Map<string, string>

/**
 * The API with real services for one test file. Needs PostgreSQL (DATABASE_URL, migrated), Valkey
 * and the OAuth mock (AUTH_TEST_PROVIDER_ISSUER). Users of `domain` are removed before and after.
 */
export function harness(domain: string) {
	const env = readEnv({ ...process.env, NODE_ENV: 'test' })
	const db = createDatabase(env.DATABASE_URL)
	const valkey = createValkey(env.VALKEY_URL, 'rotline-api-test')
	const events = new EventHub(env.VALKEY_URL)
	const seats = new Seats(valkey)
	const parties = new PartyStore(valkey)
	const log = pino({ level: 'silent' })
	const app = createApp({ env, db, auth: createAuth(env, db), log, valkey, parties, seats, events })
	const origin = env.PUBLIC_ORIGIN
	// unique per run: the mock provider uses the username as the account id
	const run = crypto.randomUUID().slice(0, 8)

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

	async function userId(jar: Jar): Promise<string> {
		return ((await (await call(jar, '/api/me')).json()) as { user: { id: string } }).user.id
	}

	/** Signs in and enlists a player; returns the jar and the user id. */
	async function enlist(name: string): Promise<{ jar: Jar; id: string }> {
		const jar = await signIn(name.toLowerCase())
		const created = await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: `${name}${run.slice(0, 6)}`, avatarStyle: 'pixelbot', avatarSeed: name })
		})
		expect(created.status).toBe(201)
		return { jar, id: await userId(jar) }
	}

	beforeAll(async () => {
		await db.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } })
	})

	afterAll(async () => {
		await db.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } })
		await db.$disconnect()
		await valkey.quit()
		await events.close()
	})

	return { env, db, valkey, seats, parties, log, app, origin, run, domain, call, cookieHeader, signIn, userId, enlist }
}
