import { maps } from '@rotline/game-data'
import { Reader, readServerHeader, readSnapshot, SnapshotEncoder, Writer, ZombieTable } from '@rotline/protocol'
import { Button, Grid, type PlayerInput, World } from '@rotline/sim'
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

describe('prediction', () => {
	it('matches the server exactly when inputs arrive one per tick, with a lagging confirmation', () => {
		const world = quietWorld()
		world.addPlayer(1)
		const encoder = new SnapshotEncoder(1)
		const table = new ZombieTable()
		const predictor = new Predictor(new Grid(yard), 1)
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
				buttons: (seq % 40 < 25 ? Button.fire : 0) | (seq === 70 ? Button.reload : 0) | (seq === 90 ? Button.slot3 : 0),
				viewTick: 0
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
		expect(predictor.pending).toHaveLength(0)
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
