import { createPublicKey } from 'node:crypto'
import { createAuth } from '@rotline/auth'
import { createDatabase } from '@rotline/db'
import { createValkey, PartyStore, Seats } from '@rotline/state'
import { loadPrivateKey, verifyTicket } from '@rotline/ticket'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.ts'
import { readEnv } from '../../src/env.ts'
import { EventHub } from '../../src/events.ts'

// Needs PostgreSQL (DATABASE_URL, migrated) and the OAuth mock (AUTH_TEST_PROVIDER_ISSUER).
const env = readEnv({ ...process.env, NODE_ENV: 'test' })
const db = createDatabase(env.DATABASE_URL)
const valkey = createValkey(env.VALKEY_URL, 'rotline-api-test')
const events = new EventHub(env.VALKEY_URL)
const seats = new Seats(valkey)
const app = createApp({
	env,
	db,
	auth: createAuth(env, db),
	log: pino({ level: 'silent' }),
	valkey,
	parties: new PartyStore(valkey),
	seats,
	events
})
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

async function userId(jar: Jar): Promise<string> {
	return ((await (await call(jar, '/api/me')).json()) as { user: { id: string } }).user.id
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

	it('forms a party by code, readies up, starts, and hands every member a ticket to the same room', async () => {
		const host = await signIn('frank')
		const guest = await signIn('gina')
		const outsider = await signIn('hank')
		for (const [jar, name] of [
			[host, 'Frank'],
			[guest, 'Gina'],
			[outsider, 'Hank']
		] as const) {
			await call(jar, '/api/player', {
				method: 'POST',
				body: JSON.stringify({ name: `${name}${run.slice(0, 6)}`, avatarStyle: 'pixelbot', avatarSeed: name })
			})
		}
		const hostParty = (await (await call(host, '/api/party')).json()) as { code: string; members: unknown[] }
		expect(hostParty.members).toHaveLength(1)
		expect((await call(host, '/api/game/ticket', { method: 'POST' })).status).toBe(409)

		const joined = await call(guest, '/api/party/join', {
			method: 'POST',
			body: JSON.stringify({ code: hostParty.code })
		})
		expect(joined.status).toBe(200)
		expect((await call(host, '/api/party/start', { method: 'POST' })).status).toBe(409)
		await call(guest, '/api/party/ready', { method: 'POST', body: JSON.stringify({ ready: true }) })
		const started = (await (await call(host, '/api/party/start', { method: 'POST' })).json()) as { state: string }
		expect(started.state).toBe('mission')

		// a ticket needs a seat
		expect((await call(host, '/api/game/ticket', { method: 'POST' })).status).toBe(403)
		for (const jar of [host, guest]) await seats.enter(await userId(jar))

		const publicKey = createPublicKey(loadPrivateKey(env.GAME_TICKET_PRIVATE_KEY))
		const rooms = new Set<string>()
		for (const jar of [host, guest]) {
			const body = (await (await call(jar, '/api/game/ticket', { method: 'POST' })).json()) as {
				ticket: string
				path: string
			}
			const check = verifyTicket(publicKey, body.ticket)
			expect(check.ok && check.payload.mode).toBe('squad')
			if (check.ok) rooms.add(check.payload.room)
			expect(body.path).toBe('/game')
		}
		expect(rooms.size).toBe(1)

		const late = await call(outsider, '/api/party/join', {
			method: 'POST',
			body: JSON.stringify({ code: hostParty.code })
		})
		expect(late.status).toBe(409)
		expect(await late.json()).toEqual({ error: 'in-mission' })
	})

	it('pushes party changes to members over the event stream', async () => {
		const host = await signIn('ivy')
		const guest = await signIn('jack')
		for (const [jar, name] of [
			[host, 'Ivy'],
			[guest, 'Jack']
		] as const) {
			await call(jar, '/api/player', {
				method: 'POST',
				body: JSON.stringify({ name: `${name}${run.slice(0, 6)}`, avatarStyle: 'lorelei', avatarSeed: name })
			})
		}
		const { code } = (await (await call(host, '/api/party')).json()) as { code: string }
		const stream = await call(host, '/api/events')
		const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
		const decoder = new TextDecoder()
		let text = ''
		const until = async (pattern: RegExp) => {
			while (!pattern.test(text)) {
				const { value, done } = await reader.read()
				if (done) break
				text += decoder.decode(value)
			}
		}
		await until(/event: hello/)
		await call(guest, '/api/party/join', { method: 'POST', body: JSON.stringify({ code }) })
		await until(/event: party/)
		expect(text).toMatch(/event: party/)
		await reader.cancel()
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

describe('friends', () => {
	async function enlist(name: string) {
		const jar = await signIn(name.toLowerCase())
		const playerName = `${name}${run.slice(0, 6)}`
		await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: playerName, avatarStyle: 'pixel-art', avatarSeed: name })
		})
		const me = (await (await call(jar, '/api/me')).json()) as { user: { id: string } }
		return { jar, name: playerName, id: me.user.id }
	}
	const list = async (jar: Jar) =>
		(await (await call(jar, '/api/friends')).json()) as {
			friends: { id: string; presence: { status: string } }[]
			incoming: { id: string }[]
			outgoing: { id: string }[]
			blocked: { id: string }[]
			recent: { id: string }[]
		}

	it('sends, accepts and removes a friend request by player name', async () => {
		const kim = await enlist('Kim')
		const lou = await enlist('Lou')
		expect(
			await (
				await call(kim.jar, '/api/friends/request', {
					method: 'POST',
					body: JSON.stringify({ name: lou.name.toLowerCase() })
				})
			).json()
		).toEqual({ status: 'requested' })
		expect((await list(kim.jar)).outgoing.map(entry => entry.id)).toEqual([lou.id])
		expect((await list(lou.jar)).incoming.map(entry => entry.id)).toEqual([kim.id])
		await call(lou.jar, '/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: kim.id }) })
		expect((await list(kim.jar)).friends.map(entry => entry.id)).toEqual([lou.id])
		await call(kim.jar, '/api/friends/remove', { method: 'POST', body: JSON.stringify({ userId: lou.id }) })
		expect((await list(lou.jar)).friends).toEqual([])
	})

	it('accepts automatically when both send a request', async () => {
		const max = await enlist('Max')
		const ned = await enlist('Ned')
		await call(max.jar, '/api/friends/request', { method: 'POST', body: JSON.stringify({ name: ned.name }) })
		expect(
			await (
				await call(ned.jar, '/api/friends/request', { method: 'POST', body: JSON.stringify({ name: max.name }) })
			).json()
		).toEqual({ status: 'friends' })
	})

	it('hides blocked players: requests fail like an unknown name', async () => {
		const oli = await enlist('Oli')
		const pam = await enlist('Pam')
		await call(oli.jar, '/api/friends/block', { method: 'POST', body: JSON.stringify({ userId: pam.id }) })
		const response = await call(pam.jar, '/api/friends/request', {
			method: 'POST',
			body: JSON.stringify({ name: oli.name })
		})
		expect(response.status).toBe(404)
		expect((await list(oli.jar)).blocked.map(entry => entry.id)).toEqual([pam.id])
	})

	it("lets friends join each other's squad and remembers squad mates as recent players", async () => {
		const quinn = await enlist('Quinn')
		const ray = await enlist('Ray')
		const sam = await enlist('Sam')
		await call(quinn.jar, '/api/friends/request', { method: 'POST', body: JSON.stringify({ name: ray.name }) })
		await call(ray.jar, '/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: quinn.id }) })
		expect(
			(await call(ray.jar, '/api/friends/join', { method: 'POST', body: JSON.stringify({ userId: quinn.id }) })).status
		).toBe(200)
		// a stranger cannot use the friend route
		expect(
			(await call(sam.jar, '/api/friends/join', { method: 'POST', body: JSON.stringify({ userId: quinn.id }) })).status
		).toBe(403)
		const { code } = (await (await call(quinn.jar, '/api/party')).json()) as { code: string }
		await call(sam.jar, '/api/party/join', { method: 'POST', body: JSON.stringify({ code }) })
		await call(ray.jar, '/api/party/ready', { method: 'POST', body: JSON.stringify({ ready: true }) })
		await call(sam.jar, '/api/party/ready', { method: 'POST', body: JSON.stringify({ ready: true }) })
		expect((await call(quinn.jar, '/api/party/start', { method: 'POST' })).status).toBe(200)
		// Sam is a recent player for Quinn (Ray is a friend, so not listed again)
		expect((await list(quinn.jar)).recent.map(entry => entry.id)).toEqual([sam.id])
	})
})

describe('admin settings', () => {
	it('lets only admins change the player capacity, and keeps it in the database', async () => {
		const jar = await signIn('olga')
		await call(jar, '/api/player', {
			method: 'POST',
			body: JSON.stringify({ name: `Olga${run.slice(0, 6)}`, avatarStyle: 'pixelbot', avatarSeed: 'olga' })
		})
		const before = await seats.capacity()
		const body = JSON.stringify({ capacity: 30 })
		expect((await call(jar, '/api/admin/capacity', { method: 'PUT', body })).status).toBe(403)
		await db.player.update({ where: { userId: await userId(jar) }, data: { isAdmin: true } })
		try {
			expect((await call(jar, '/api/admin/capacity', { method: 'PUT', body })).status).toBe(200)
			expect(await seats.capacity()).toBe(30)
			const row = await db.adminSetting.findUnique({ where: { key: 'capacity' } })
			expect(row?.value).toBe(30)
			const settings = (await (await call(jar, '/api/admin/settings')).json()) as { capacity: number }
			expect(settings.capacity).toBe(30)
		} finally {
			await db.adminSetting.deleteMany({ where: { key: 'capacity' } })
			await seats.setCapacity(before)
		}
	})
})
