import { dataVersion, type MissionDef, maps, missionById, starterBuild, zombieIndex } from '@rotline/game-data'
import {
	aimToAngle,
	angleToAim,
	Button,
	MissionStatus,
	ObjectKind,
	type PlayerInput,
	PropState,
	quantiseAxis,
	type SimEvent,
	setPropState,
	World
} from '@rotline/sim'
import { describe, expect, it } from 'vitest'
import {
	INTEREST_RADIUS,
	KickReason,
	lookOf,
	PROTOCOL_VERSION,
	ProtocolError,
	Reader,
	readClientMessage,
	readServerHeader,
	readSnapshot,
	SnapshotEncoder,
	Writer,
	writeEvents,
	writeHello,
	writeInput,
	writeKick,
	writePause,
	writePing,
	writePong,
	writeResults,
	writeRoster,
	writeWelcome,
	ZombieStatus,
	ZombieTable
} from '../src/index.ts'

const yard = maps.yard as NonNullable<typeof maps.yard>

function quietWorld() {
	return new World({
		seed: 9,
		map: yard,
		waves: {
			firstWaveDelaySeconds: 1e6,
			breakSeconds: 1,
			spawnPerSecond: 1,
			maxAlive: 300,
			waves: [{ drudge: 0 }],
			growthPerWave: 1
		}
	})
}

describe('primitives', () => {
	it('round-trips every field type and grows when needed', () => {
		const w = new Writer(4)
		w.u8(250)
			.i8(-5)
			.u16(65000)
			.i16(-30000)
			.u32(4_000_000_000)
			.f32(1.5)
			.f64(Math.PI)
			.varint(300)
			.varint(2 ** 28)
			.string('hé')
		const r = new Reader(w.finish())
		expect([r.u8(), r.i8(), r.u16(), r.i16(), r.u32(), r.f32(), r.f64(), r.varint(), r.varint(), r.string()]).toEqual([
			250,
			-5,
			65000,
			-30000,
			4_000_000_000,
			1.5,
			Math.PI,
			300,
			2 ** 28,
			'hé'
		])
		expect(r.remaining).toBe(0)
	})

	it('throws ProtocolError on short, oversized or invalid data', () => {
		expect(() => new Reader(new Uint8Array([1])).u16()).toThrow(ProtocolError)
		expect(() => new Reader(new Writer().string('x'.repeat(10)).finish()).string(5)).toThrow(ProtocolError)
		expect(() => new Reader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0x01])).varint()).toThrow(ProtocolError)
		expect(() => new Reader(new Uint8Array([1, 0xc3])).string()).toThrow()
	})
})

describe('how players look', () => {
	it('names the class, the loadout guns and the armour worn in each place', () => {
		const build = starterBuild('medic')
		const look = lookOf(build)
		expect(look.classIndex).toBe(1)
		expect(look.weapons.every(index => index !== 255)).toBe(true)
		expect(look.armour.every(index => index !== 255)).toBe(true)
		// an empty place, and an item the data does not know, show as nothing
		const bare = lookOf({
			...build,
			loadout: {
				...build.loadout,
				main: [{ id: 'no-such-gun', level: 0, perks: [] }, build.loadout.main[1]],
				armour: { ...build.loadout.armour, head: null, vest: { id: 'no-such-vest', level: 0, perks: [] } }
			}
		})
		expect(bare.weapons[0]).toBe(255)
		expect(bare.armour[0]).toBe(255)
		expect(bare.armour[2]).toBe(255)
	})
})

describe('client messages', () => {
	it('round-trip hello, input and pong', () => {
		const w = new Writer()
		expect(readClientMessage(new Reader(writeHello(w, 'ticket.abc')))).toEqual({
			type: 'hello',
			version: PROTOCOL_VERSION,
			ticket: 'ticket.abc'
		})
		const inputs: PlayerInput[] = [
			{
				seq: 7,
				moveX: quantiseAxis(-1),
				moveY: quantiseAxis(0.5),
				aim: angleToAim(1),
				buttons: Button.fire | Button.reload | Button.ability3 | Button.utility2,
				viewTick: 99,
				reach: 60
			},
			{ seq: 8, moveX: 0, moveY: 127, aim: 65535, buttons: 0, viewTick: 100, reach: 0 }
		]
		expect(readClientMessage(new Reader(writeInput(w, 41, inputs)))).toEqual({ type: 'input', ackSnapshot: 41, inputs })
		expect(readClientMessage(new Reader(writePong(w, 123.5)))).toEqual({ type: 'pong', time: 123.5 })
		expect(readClientMessage(new Reader(writePause(w, true)))).toEqual({ type: 'pause', paused: true })
	})

	it('rejects unknown types and absurd input counts', () => {
		expect(() => readClientMessage(new Reader(new Uint8Array([99])))).toThrow(ProtocolError)
		expect(() => readClientMessage(new Reader(new Uint8Array([2, 0, 0, 0, 0, 200])))).toThrow(ProtocolError)
	})

	it('never crashes on random bytes except with ProtocolError or a decoding error', () => {
		let seed = 1
		for (let n = 0; n < 2000; n++) {
			const bytes = new Uint8Array(1 + (n % 40)).map(() => {
				seed = (seed * 1103515245 + 12345) & 0x7fffffff
				return seed & 0xff
			})
			try {
				readClientMessage(new Reader(bytes))
			} catch (error) {
				expect(error instanceof ProtocolError || error instanceof TypeError).toBe(true)
			}
		}
	})

	it('converts aim angles both ways', () => {
		expect(aimToAngle(angleToAim(Math.PI / 2))).toBeCloseTo(Math.PI / 2, 3)
		expect(angleToAim(-Math.PI / 2)).toBe(angleToAim((3 * Math.PI) / 2))
		expect(quantiseAxis(2)).toBe(127)
		expect(quantiseAxis(-2)).toBe(-127)
	})
})

describe('server messages', () => {
	it('round-trip welcome, ping and kick', () => {
		const w = new Writer()
		const build = { ...starterBuild('medic'), level: 3, skills: { 'medkit-drop': 1 }, abilities: ['medkit-drop'] }
		expect(readServerHeader(new Reader(writeWelcome(w, 2, 'yard', 500, build)))).toEqual({
			type: 'welcome',
			version: PROTOCOL_VERSION,
			you: 2,
			mapId: 'yard',
			tick: 500,
			build,
			missionId: '',
			difficulty: '',
			dataVersion
		})
		expect(readServerHeader(new Reader(writeWelcome(w, 1, 'yard', 0, build, 'yard-sweep', 'nightmare')))).toMatchObject(
			{
				missionId: 'yard-sweep',
				difficulty: 'nightmare'
			}
		)
		const results = {
			success: true,
			rounds: 0,
			timeMs: 400_000,
			score: 31_250,
			kills: 412,
			xp: 2900,
			salvage: 640,
			downs: 1,
			items: [4, 9],
			mastery: 2
		}
		expect(readServerHeader(new Reader(writeResults(w, results)))).toEqual({ type: 'results', ...results })
		const broken = writeWelcome(w, 2, 'yard', 500, { ...build, class: 'pirate' } as unknown as typeof build)
		expect(() => readServerHeader(new Reader(broken))).toThrow(ProtocolError)
		expect(readServerHeader(new Reader(writePing(w, 9.25)))).toEqual({ type: 'ping', time: 9.25 })
		expect(readServerHeader(new Reader(writeKick(w, KickReason.badTicket)))).toEqual({
			type: 'kick',
			reason: KickReason.badTicket
		})
		const entries = [
			{
				slot: 1,
				name: 'Rook',
				connected: true,
				classIndex: 0,
				weapons: [3, 4, 0] as const,
				armour: [0, 4, 7, 11, 14] as const
			},
			{
				slot: 2,
				name: 'Ghost',
				connected: false,
				classIndex: 2,
				weapons: [5, 255, 1] as const,
				armour: [255, 255, 255, 255, 255] as const
			}
		]
		expect(readServerHeader(new Reader(writeRoster(w, entries)))).toEqual({ type: 'roster', entries })
	})

	it('rejects unknown server messages and events', () => {
		expect(() => readServerHeader(new Reader(new Uint8Array([99])))).toThrow(ProtocolError)
		expect(() => readServerHeader(new Reader(new Uint8Array([12, 1, 0, 99])))).toThrow(ProtocolError)
	})

	it('round-trips every event type', () => {
		const events: SimEvent[] = [
			{ type: 'shot', player: 1, x: 10.5, y: 3.25, angle: 1, length: 12.5, weapon: 2 },
			{ type: 'hit', zombie: 17, x: 5, y: 6, amount: 12.5, by: 2 },
			{ type: 'ability', player: 2, ability: 4, x: 7, y: 8, angle: 0 },
			{ type: 'kill', zombie: 17, zombieType: 2, x: 5, y: 6, by: 1 },
			{ type: 'burst', x: 5, y: 6, radius: 3 },
			{ type: 'player-hurt', player: 1, amount: 12.5 },
			{ type: 'player-down', player: 1 },
			{ type: 'player-up', player: 1 },
			{ type: 'wave', wave: 4 },
			{ type: 'player-out', player: 2 },
			{ type: 'player-revived', player: 2, by: 3 },
			{ type: 'wipe', wave: 4 },
			{ type: 'cleared', wave: 3 },
			{ type: 'launch', id: 7, player: 1, x: 3, y: 4, angle: 0, speed: 25, weapon: 8 },
			{ type: 'explode', id: 7, x: 13, y: 4, radius: 3.5 },
			{ type: 'objective', index: 1, first: true },
			{ type: 'run-over', wave: 12 },
			{ type: 'prop', index: 300, state: 3 },
			{ type: 'failed', index: -1 },
			{ type: 'checkpoint', index: 1 },
			{ type: 'mission-complete' },
			{ type: 'item-found', player: 2, item: 11 },
			{ type: 'cache', player: 2, index: 1 },
			{ type: 'buff', player: 1, buff: 3 },
			{ type: 'threshold', player: 1, index: 0 }
		]
		const decoded = readServerHeader(new Reader(writeEvents(new Writer(), events)))
		expect(decoded.type).toBe('events')
		if (decoded.type !== 'events') return
		expect(decoded.events).toHaveLength(events.length)
		const shot = decoded.events[0]
		expect(shot?.type === 'shot' && shot.angle).toBeCloseTo(1, 3)
		expect(decoded.events.slice(1)).toEqual(events.slice(1))
	})
})

function decode(bytes: Uint8Array, table: ZombieTable) {
	const r = new Reader(bytes)
	expect(readServerHeader(r).type).toBe('snapshot')
	const frame = readSnapshot(r, table)
	expect(r.remaining).toBe(0)
	return frame
}

describe('snapshots', () => {
	it('carries the own player exactly, other players and zombies within 1/64 m', () => {
		const world = quietWorld()
		const me = world.addPlayer(1)
		const other = world.addPlayer(2)
		const zombie = world.spawnZombie(zombieIndex('bolter'), { x: me.x + 5.123, y: me.y - 2.9 })
		world.step(new Map([[1, { seq: 5, moveX: 127, moveY: 30, aim: 1234, buttons: 0, viewTick: 0, reach: 0 }]]))
		const table = new ZombieTable()
		const frame = decode(new SnapshotEncoder(1).write(new Writer(), world), table)
		expect(frame.lastSeq).toBe(5)
		expect(frame.tick).toBe(world.tick - 1)
		expect(frame.self.x).toBe(me.x)
		expect(frame.self.y).toBe(me.y)
		expect(frame.self.weapons).toEqual(me.weapons)
		expect(frame.others).toHaveLength(1)
		expect(frame.others[0]?.x).toBeCloseTo(other.x, 1)
		expect(table.known[zombie]).toBe(1)
		expect(table.type[zombie]).toBe(zombieIndex('bolter'))
		expect(Math.abs((table.x[zombie] as number) - (world.x[zombie] as number))).toBeLessThan(1 / 64)
	})

	it('carries downed teammates with their bleed-out time', () => {
		const world = quietWorld()
		world.addPlayer(1)
		const other = world.addPlayer(2)
		other.downed = true
		other.bleedoutTick = world.tick + 300
		const frame = decode(new SnapshotEncoder(1).write(new Writer(), world), new ZombieTable())
		expect(frame.others[0]?.downed).toBe(true)
		expect(frame.others[0]?.bleedoutSeconds).toBe(10)
	})

	it('encodes a snapshot for a player who has left the world', () => {
		const world = quietWorld()
		world.addPlayer(2)
		world.spawnZombie(zombieIndex('drudge'), { x: 3, y: 3 })
		const frame = decode(new SnapshotEncoder(1).write(new Writer(), world), new ZombieTable())
		expect(frame.lastSeq).toBe(0)
		expect(frame.others).toHaveLength(1)
	})

	it('rejects zombie indexes out of range and overlong rosters', () => {
		const world = quietWorld()
		world.addPlayer(1)
		const bytes = new SnapshotEncoder(1).write(new Writer(), world)
		// the zombie count is the last u16 when no zombies are sent: claim one with a huge index
		const tail = new Writer().u16(1).varint(1_000_000).u8(0).finish()
		const bad = new Uint8Array(bytes.length - 2 + tail.length)
		bad.set(bytes.subarray(0, bytes.length - 2))
		bad.set(tail, bytes.length - 2)
		const r = new Reader(bad)
		readServerHeader(r)
		expect(() => readSnapshot(r, new ZombieTable())).toThrow(ProtocolError)
		const roster = Array.from({ length: 9 }, (_, slot) => ({
			slot,
			name: 'x',
			connected: true,
			classIndex: 0,
			weapons: [0, 0, 0] as const,
			armour: [255, 255, 255, 255, 255] as const
		}))
		expect(() => readServerHeader(new Reader(writeRoster(new Writer(), roster)))).toThrow(ProtocolError)
	})

	it('carries objects, zombie statuses and the predicted ability state', () => {
		const world = quietWorld()
		const me = world.addPlayer(1)
		me.abilityReady = [10, 20, 30]
		me.utilityCharges = [2, 1]
		me.hasteSteps = 99
		me.hasteSpeed = 0.25
		me.dashX = 0.75
		me.minigunSteps = 77
		const zombie = world.spawnZombie(zombieIndex('drudge'), { x: me.x + 3, y: me.y })
		world.stunUntil[zombie] = 1000
		world.markUntil[zombie] = 1000
		world.slowUntil[zombie] = 1000
		world.poisonUntil[zombie] = 1000
		world.tauntUntil[zombie] = 1000
		world.burnUntil[zombie] = 1000
		world.addObject({
			kind: ObjectKind.barricade,
			owner: 1,
			x: 10,
			y: 12,
			radius: 2,
			angle: 1,
			untilTick: world.tick + 90,
			health: 150,
			maxHealth: 300,
			amount: 0,
			damageType: 'ballistic',
			cells: [41, 42],
			nextTick: 0,
			interval: 0,
			trigger: 0
		})
		const table = new ZombieTable()
		const frame = decode(new SnapshotEncoder(1).write(new Writer(), world), table)
		expect(frame.self).toMatchObject({
			abilityReady: [10, 20, 30],
			utilityCharges: [2, 1],
			hasteSteps: 99,
			dashX: 0.75,
			minigunSteps: 77
		})
		expect(frame.self.hasteSpeed).toBeCloseTo(0.25)
		expect(frame.objects).toHaveLength(1)
		expect(frame.objects[0]).toMatchObject({
			kind: ObjectKind.barricade,
			x: 10,
			y: 12,
			radius: 2,
			secondsLeft: 3,
			cells: [41, 42]
		})
		expect(frame.objects[0]?.health).toBeCloseTo(0.5, 1)
		expect(table.status[zombie]).toBe(
			ZombieStatus.stunned |
				ZombieStatus.slowed |
				ZombieStatus.marked |
				ZombieStatus.poisoned |
				ZombieStatus.taunted |
				ZombieStatus.burning
		)
	})

	it('sends only changes, removes dead zombies and stays in sync over many ticks', () => {
		const world = quietWorld()
		world.addPlayer(1)
		for (let i = 0; i < 60; i++)
			world.spawnZombie(zombieIndex('drudge'), { x: 4 + (i % 10) * 2, y: 4 + Math.floor(i / 10) * 2 })
		const encoder = new SnapshotEncoder(1)
		const w = new Writer()
		const table = new ZombieTable()
		const firstBytes = encoder.write(w, world)
		const first = firstBytes.length
		decode(firstBytes, table)
		const unchanged = encoder.write(w, world).length
		expect(unchanged).toBeLessThan(first / 4)

		for (let t = 0; t < 90; t++) {
			world.step(new Map())
			if (t === 30) world.damageZombie(0, 1e6, 1)
			decode(encoder.write(w, world), table)
		}
		expect(table.known[0]).toBe(0)
		for (let i = 1; i < 60; i++) {
			if (world.alive[i] !== 1) continue
			expect(table.known[i]).toBe(1)
			expect(Math.abs((table.x[i] as number) - (world.x[i] as number))).toBeLessThanOrEqual(1 / 128 + 1e-6)
			expect(Math.abs((table.y[i] as number) - (world.y[i] as number))).toBeLessThanOrEqual(1 / 128 + 1e-6)
		}
	})

	it('leaves out zombies beyond the interest radius', () => {
		const world = new World({
			seed: 1,
			map: { ...yard, width: 200, height: 48, walls: [] },
			waves: {
				firstWaveDelaySeconds: 1e6,
				breakSeconds: 1,
				spawnPerSecond: 1,
				maxAlive: 300,
				waves: [{ drudge: 0 }],
				growthPerWave: 1
			}
		})
		const me = world.addPlayer(1)
		const near = world.spawnZombie(0, { x: me.x + 5, y: me.y })
		const far = world.spawnZombie(0, { x: me.x + INTEREST_RADIUS + 20, y: me.y })
		const table = new ZombieTable()
		decode(new SnapshotEncoder(1).write(new Writer(), world), table)
		expect(table.known[near]).toBe(1)
		expect(table.known[far]).toBe(0)
	})
})

describe('missions in snapshots', () => {
	it('carries the objective, team buffs, the own score and chain, and buffs on the ground', () => {
		const mission = missionById('yard-sweep') as MissionDef
		const world = new World({
			seed: 2,
			map: yard,
			mission: { mission: { ...mission, spawn: { ...mission.spawn, perSecond: 0 } }, difficulty: 'nightmare' }
		})
		const me = world.addPlayer(1)
		world.addPlayer(2)
		for (let n = 0; n < 3; n++) world.damageZombie(world.spawnZombie(zombieIndex('drudge'), { x: 5, y: 5 }), 1e9, 1)
		me.openedCaches.push(1)
		world.doubleXpUntil = 60 * 30
		const zombie = world.spawnZombie(zombieIndex('drudge'), { x: me.x + 2, y: me.y })
		world.damageZombie(zombie, (world.maxHealth[zombie] as number) / 2, 0)
		world.addObject({
			kind: ObjectKind.buff,
			owner: 0,
			x: 20,
			y: 20,
			radius: 1.2,
			angle: 0,
			untilTick: 600,
			health: 0,
			maxHealth: 0,
			amount: 5,
			damageType: 'ballistic',
			cells: [],
			nextTick: 0,
			interval: 0,
			trigger: 0
		})
		world.step(new Map())
		const table = new ZombieTable()
		const frame = decode(new SnapshotEncoder(1).write(new Writer(), world), table)
		expect(frame.mission).toMatchObject({
			status: MissionStatus.active,
			objective: 0,
			progress: 3,
			goal: 40,
			doubleXpSeconds: 60,
			instakillSeconds: 0,
			score: 30,
			chain: 3,
			caches: 2,
			timeLeft: null
		})
		expect(frame.mission.chainLeft).toBeGreaterThan(0.9)
		expect(frame.objects.find(object => object.kind === ObjectKind.buff)?.variant).toBe(5)
		// health is relative to the scaled maximum, not the base one
		expect((table.health[zombie] as number) / 255).toBeCloseTo(0.5, 1)
		expect(frame.others[0]?.healthPercent).toBe(1)
	})
})

describe('props in snapshots', () => {
	it('sends every prop once, then only the ones that change, and the carrying flag', () => {
		const map = maps.substation as NonNullable<typeof maps.substation>
		const world = new World({ seed: 3, map })
		const me = world.addPlayer(1)
		const encoder = new SnapshotEncoder(1)
		const table = new ZombieTable()
		const first = decode(encoder.write(new Writer(), world), table)
		expect(first.props).toHaveLength(world.props.length)
		const second = decode(encoder.write(new Writer(), world), table)
		expect(second.props).toHaveLength(0)
		const door = world.propById.get('door-west')
		if (!door) throw new Error()
		setPropState(world.grid, door, PropState.closed)
		door.progress = 0.5
		me.carrying = true
		const third = decode(encoder.write(new Writer(), world), table)
		expect(third.props).toEqual([
			expect.objectContaining({ index: door.index, state: PropState.closed, progress: expect.closeTo(0.5, 1) })
		])
		expect(third.self.carrying).toBe(true)
		const turret = world.propById.get('turret-north')
		expect(first.props.find(prop => prop.index === turret?.index)?.powered).toBe(false)
	})
})
