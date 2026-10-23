import { type Build, maps, starterBuild } from '@rotline/game-data'
import { Reader, readServerHeader, readSnapshot, SnapshotEncoder, Writer, ZombieTable } from '@rotline/protocol'
import { Button, createProps, Grid, type PlayerInput, World } from '@rotline/sim'
import { describe, expect, it } from 'vitest'
import { Interpolator } from '../src/interpolate.ts'
import { Predictor } from '../src/predict.ts'

const yard = maps.yard as NonNullable<typeof maps.yard>

function quietWorld() {
	return new World({
		seed: 5,
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

function snapshot(world: World, encoder: SnapshotEncoder, table: ZombieTable) {
	const r = new Reader(encoder.write(new Writer(), world))
	readServerHeader(r)
	return readSnapshot(r, table)
}

/** Runs 120 inputs through client prediction and the server with confirmations LAG ticks late. */
function predictAgainstServer(build: Build | undefined, buttonsAt: (seq: number) => number) {
	const world = quietWorld()
	world.addPlayer(1, build)
	const encoder = new SnapshotEncoder(1)
	const table = new ZombieTable()
	// the client's grid holds the map's props, as the game sets it up
	const grid = new Grid(yard)
	createProps(yard, grid)
	const predictor = new Predictor(grid, 1, build)
	const first = snapshot(world, encoder, table)
	predictor.reconcile(first.self, first.lastSeq, first.tick)

	const sent: PlayerInput[] = []
	const LAG = 4
	for (let seq = 1; seq <= 120; seq++) {
		const input: PlayerInput = {
			seq,
			moveX: Math.round(Math.sin(seq / 9) * 127),
			moveY: Math.round(Math.cos(seq / 13) * 127),
			aim: (seq * 997) & 0xffff,
			buttons: buttonsAt(seq),
			viewTick: 0,
			reach: 40
		}
		predictor.apply(input)
		sent.push(input)
		// the server applies inputs LAG ticks later, one per tick
		const arrived = sent[seq - 1 - LAG]
		if (arrived) {
			world.step(new Map([[1, arrived]]))
			const frame = snapshot(world, encoder, table)
			predictor.reconcile(frame.self, frame.lastSeq, frame.tick)
		}
	}
	expect(predictor.corrections).toBe(0)
	// catch the server up and compare
	for (const input of sent.slice(-LAG)) world.step(new Map([[1, input]]))
	const server = world.players.get(1)
	const frame = snapshot(world, encoder, table)
	predictor.reconcile(frame.self, frame.lastSeq, frame.tick)
	expect(predictor.state.x).toBe(server?.x)
	expect(predictor.state.y).toBe(server?.y)
	expect(predictor.state.weapons).toEqual(server?.weapons)
	expect(predictor.state.abilityReady).toEqual(server?.abilityReady)
	expect(predictor.state.utilityCharges).toEqual(server?.utilityCharges)
	expect(predictor.pending).toHaveLength(0)
}

describe('prediction', () => {
	it('matches the server exactly when inputs arrive one per tick, with a lagging confirmation', () => {
		predictAgainstServer(
			undefined,
			seq => (seq % 40 < 25 ? Button.fire : 0) | (seq === 70 ? Button.reload : 0) | (seq === 90 ? Button.slot3 : 0)
		)
	})

	it('predicts abilities that move or arm the player, and throws, exactly', () => {
		const build: Build = {
			...starterBuild('assault'),
			level: 30,
			skills: { 'adrenaline-burst': 1, 'slide-dash': 1, overwatch: 1 },
			abilities: ['adrenaline-burst', 'slide-dash', 'overwatch']
		}
		predictAgainstServer(
			build,
			seq =>
				(seq % 30 < 20 ? Button.fire : 0) |
				(seq === 10 ? Button.ability1 : 0) |
				(seq === 40 ? Button.ability2 : 0) |
				(seq === 60 ? Button.ability3 : 0) |
				(seq === 80 || seq === 100 ? Button.utility1 : 0)
		)
	})

	it('predicts the minigun', () => {
		const build: Build = {
			...starterBuild('heavy'),
			level: 30,
			skills: { 'minigun-spin-up': 1 },
			abilities: ['minigun-spin-up']
		}
		predictAgainstServer(build, seq => (seq % 30 < 25 ? Button.fire : 0) | (seq === 5 ? Button.ability1 : 0))
	})

	it('predicts Slide Dash and haste exactly when the server catches up or skips a tick', () => {
		const build: Build = {
			...starterBuild('assault'),
			level: 30,
			skills: { 'adrenaline-burst': 1, 'slide-dash': 1 },
			abilities: ['adrenaline-burst', 'slide-dash']
		}
		const world = quietWorld()
		world.addPlayer(1, build)
		const encoder = new SnapshotEncoder(1)
		const table = new ZombieTable()
		// the client's grid holds the map's props, as the game sets it up
		const grid = new Grid(yard)
		createProps(yard, grid)
		const predictor = new Predictor(grid, 1, build)
		const first = snapshot(world, encoder, table)
		predictor.reconcile(first.self, first.lastSeq, first.tick)
		const queue: PlayerInput[] = []
		// inputs arriving per server tick: late ones, then two at once
		const arrivals = [1, 1, 0, 2, 1, 0, 0, 3, 1, 1, 0, 2]
		let seq = 0
		for (let round = 0; round < 6; round++) {
			for (const count of arrivals) {
				for (let n = 0; n < 1; n++) {
					seq++
					const input: PlayerInput = {
						seq,
						moveX: 127,
						moveY: Math.round(Math.sin(seq / 7) * 127),
						aim: 0,
						buttons: seq === 3 ? Button.ability2 : seq === 20 ? Button.ability1 : seq === 40 ? Button.ability2 : 0,
						viewTick: 0,
						reach: 0
					}
					predictor.apply(input)
					queue.push(input)
				}
				// the server applies what has arrived: catch-up inputs first, then one in the step
				const ready = queue.splice(0, Math.min(count, queue.length))
				const state = world.players.get(1)
				if (!state) throw new Error()
				for (const extra of ready.slice(0, -1)) world.applyInput(state, extra)
				const last = ready[ready.length - 1]
				world.step(last ? new Map([[1, last]]) : new Map())
				const frame = snapshot(world, encoder, table)
				predictor.reconcile(frame.self, frame.lastSeq, frame.tick)
			}
		}
		expect(predictor.corrections).toBe(0)
	})

	it('eases small corrections and snaps big ones', () => {
		const predictor = new Predictor(new Grid(yard), 1)
		const world = quietWorld()
		world.addPlayer(1)
		const frame = snapshot(world, new SnapshotEncoder(1), new ZombieTable())
		predictor.reconcile(frame.self, 0, 0)
		predictor.reconcile(frame.self, 0, 0)
		predictor.reconcile({ ...frame.self, x: frame.self.x + 0.2 }, 0, 0)
		expect(predictor.offset.x).toBeCloseTo(-0.2, 5)
		const out = { x: 0, y: 0 }
		predictor.renderPosition(1, 1, out)
		expect(Math.abs(predictor.offset.x)).toBeLessThan(0.001)
		predictor.reconcile({ ...frame.self, x: frame.self.x + 5 }, 0, 0)
		expect(predictor.offset.x).toBe(0)
	})
})

describe('interpolation', () => {
	it('draws zombies between snapshots and estimates the server clock', () => {
		const table = new ZombieTable()
		const interpolator = new Interpolator()
		table.known[3] = 1
		table.x[3] = 10
		table.y[3] = 5
		interpolator.push(100, table, [], [], 1000)
		table.x[3] = 12
		interpolator.push(102, table, [], [], 1000 + (2 * 1000) / 30)
		expect(interpolator.sample(101)).toBe(true)
		expect(interpolator.view.count).toBe(1)
		expect(interpolator.view.index[0]).toBe(3)
		expect(interpolator.view.x[0]).toBeCloseTo(11, 4)
		const at = interpolator.renderTick(1000 + (2 * 1000) / 30 + interpolator.delayMs)
		expect(at).toBeCloseTo(102, 0)
	})

	it('drops zombies that were removed', () => {
		const table = new ZombieTable()
		const interpolator = new Interpolator()
		table.known[1] = 1
		interpolator.push(10, table, [], [], 0)
		table.known[1] = 0
		interpolator.push(12, table, [], [], 66)
		interpolator.sample(12)
		expect(interpolator.view.count).toBe(0)
	})
})
