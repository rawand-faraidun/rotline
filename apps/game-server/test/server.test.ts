import { generateKeyPairSync, randomUUID } from 'node:crypto'
import {
	KickReason,
	Reader,
	readServerHeader,
	readSnapshot,
	type SnapshotFrame,
	Writer,
	writeHello,
	writeInput,
	ZombieTable
} from '@rotline/protocol'
import { type PlayerInput, quantiseAxis } from '@rotline/sim'
import { signTicket } from '@rotline/ticket'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { readGameEnv } from '../src/env.ts'
import { GameServer } from '../src/server.ts'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const env = readGameEnv({ GAME_TICKET_PUBLIC_KEY: publicKey, GAME_INSTANCE_ID: 'test-1', NODE_ENV: 'test' })
const server = new GameServer(env, pino({ level: 'silent' }))
let port = 0

beforeAll(async () => {
	port = await server.listen(0)
})
afterAll(() => server.close())

function ticket(overrides: Partial<{ sub: string; room: string; inst: string }> = {}) {
	return signTicket(keys.privateKey, {
		sub: randomUUID(),
		name: 'Tester',
		room: `solo-${randomUUID()}`,
		inst: 'test-1',
		mode: 'solo',
		...overrides
	}).ticket
}

type Client = {
	socket: WebSocket
	snapshots: SnapshotFrame[]
	kicks: number[]
	welcome: number | null
	table: ZombieTable
	closed: Promise<void>
}

function connect(ticketValue: string): Promise<Client> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/game`)
		socket.binaryType = 'arraybuffer'
		const client: Client = {
			socket,
			snapshots: [],
			kicks: [],
			welcome: null,
			table: new ZombieTable(),
			closed: new Promise(done => socket.on('close', () => done()))
		}
		socket.on('message', (data: ArrayBuffer) => {
			const r = new Reader(new Uint8Array(data))
			const header = readServerHeader(r)
			if (header.type === 'welcome') client.welcome = header.you
			if (header.type === 'kick') client.kicks.push(header.reason)
			if (header.type === 'snapshot') client.snapshots.push(readSnapshot(r, client.table))
		})
		socket.on('open', () => {
			socket.send(writeHello(new Writer(), ticketValue))
			resolve(client)
		})
		socket.on('error', reject)
	})
}

const wait = (ms: number) => new Promise(done => setTimeout(done, ms))

async function until(check: () => boolean, ms = 3000) {
	const started = Date.now()
	while (!check()) {
		if (Date.now() - started > ms) throw new Error('timed out')
		await wait(20)
	}
}

describe('game server', () => {
	it('welcomes a player with a valid ticket and streams snapshots', async () => {
		const client = await connect(ticket())
		await until(() => client.snapshots.length >= 3)
		expect(client.welcome).toBe(1)
		const ticks = client.snapshots.map(snapshot => snapshot.tick)
		expect(ticks[1]).toBeGreaterThan(ticks[0] as number)
		client.socket.close()
	})

	it('applies inputs: the player moves', async () => {
		const client = await connect(ticket())
		await until(() => client.snapshots.length >= 1)
		const startX = client.snapshots.at(-1)?.self.x as number
		const w = new Writer()
		const inputs: PlayerInput[] = []
		for (let seq = 1; seq <= 30; seq++) {
			inputs.push({ seq, moveX: quantiseAxis(1), moveY: 0, aim: 0, buttons: 0, viewTick: 0 })
			client.socket.send(writeInput(w, 0, inputs.slice(-3)))
			await wait(33)
		}
		await until(() => (client.snapshots.at(-1)?.lastSeq ?? 0) >= 30)
		expect((client.snapshots.at(-1)?.self.x as number) - startX).toBeGreaterThan(4)
		client.socket.close()
	})

	it('refuses forged, reused and wrong-instance tickets', async () => {
		const good = ticket()
		const first = await connect(good)
		await until(() => first.welcome !== null)
		const reused = await connect(good)
		await reused.closed
		expect(reused.kicks).toEqual([KickReason.badTicket])

		const wrong = await connect(ticket({ inst: 'other-instance' }))
		await wrong.closed
		expect(wrong.kicks).toEqual([KickReason.badTicket])

		const forged = await connect(`${good.split('.')[0]}.AAAA`)
		await forged.closed
		expect(forged.kicks).toEqual([KickReason.badTicket])
		first.socket.close()
	})

	it('kicks clients that send garbage', async () => {
		const client = await connect(ticket())
		await until(() => client.welcome !== null)
		client.socket.send(new Uint8Array([200, 1, 2]))
		await client.closed
		expect(client.kicks).toEqual([KickReason.protocol])
	})

	it('lets a player reconnect to the same character', async () => {
		const sub = randomUUID()
		const room = `solo-${randomUUID()}`
		const first = await connect(ticket({ sub, room }))
		await until(() => first.snapshots.length >= 1)
		first.socket.close()
		await first.closed
		const again = await connect(ticket({ sub, room }))
		await until(() => again.snapshots.length >= 1)
		expect(again.welcome).toBe(1)
		expect(server.rooms.get(room)?.playerCount).toBe(1)
		again.socket.close()
	})

	it('serves health and metrics', async () => {
		const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
			status: string
			instance: string
		}
		expect(health).toMatchObject({ status: 'ok', instance: 'test-1' })
		expect(await (await fetch(`http://127.0.0.1:${port}/metrics`)).text()).toMatch(/rotline_game_ticks_total \d+/)
	})
})
