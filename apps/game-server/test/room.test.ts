import { economy, starterBuild, zombieIndex, zombies } from '@rotline/game-data'
import { RangeAction } from '@rotline/protocol'
import { angleToAim, Button } from '@rotline/sim'
import { describe, expect, it } from 'vitest'
import { type Connection, Room } from '../src/room.ts'

const connection = (): Connection => ({ send: () => true, close: () => {} })

let seq = 0
/** Player `slot` shoots a one-health zombie placed right in front of them. */
function shootOne(room: Room, userId: string, slot: number, type: number) {
	const player = room.world.players.get(slot)
	if (!player) throw new Error('no player')
	const index = room.world.spawnZombie(type, { x: player.x + 2, y: player.y })
	room.world.health[index] = 1
	room.receiveInputs(userId, [
		{ seq: ++seq, moveX: 0, moveY: 0, aim: angleToAim(0), buttons: Button.fire, viewTick: room.world.tick, reach: 0 }
	])
	room.tick(Date.now())
	room.receiveInputs(userId, [
		{ seq: ++seq, moveX: 0, moveY: 0, aim: angleToAim(0), buttons: 0, viewTick: 0, reach: 0 }
	])
	room.tick(Date.now())
	expect(room.world.alive[index]).toBe(0)
}

describe('room rewards', () => {
	it('credits kills to the killer and reports XP and Salvage with fractions carried over', () => {
		const reports: { grantKey: string; xp: number; salvage: number; kills: number; class: string }[] = []
		const room = new Room('room-1', 'squad', 1, 0, report => reports.push(report))
		room.join('user-a', 'A', starterBuild('medic'), connection())
		room.join('user-b', 'B', starterBuild(), connection())
		const drudge = zombieIndex('drudge')
		const def = zombies[drudge]
		if (!def) throw new Error()
		for (let n = 0; n < 3; n++) shootOne(room, 'user-a', 1, drudge)
		room.reportAll()
		expect(reports).toHaveLength(1)
		const xp = 3 * def.xp + (3 * def.score) / economy.rewards.scorePerXp
		expect(reports[0]).toMatchObject({
			grantKey: expect.stringMatching(/^room-1:user-a:[0-9a-f]{8}:0$/),
			class: 'medic',
			xp: Math.floor(xp),
			salvage: Math.floor(3 * def.salvage),
			kills: 3
		})
		// half a Salvage was left over; one more kill makes it whole
		shootOne(room, 'user-a', 1, drudge)
		room.reportAll()
		expect(reports[1]).toMatchObject({
			grantKey: expect.stringMatching(/^room-1:user-a:[0-9a-f]{8}:1$/),
			salvage: 1,
			kills: 1
		})
	})

	it('pays a cleared wave to players who played it, not to idle ones', () => {
		const reports: { userId: string; xp: number; salvage: number }[] = []
		const room = new Room('room-2', 'squad', 1, 0, report => reports.push(report))
		room.join('user-a', 'A', starterBuild(), connection())
		room.join('user-b', 'B', starterBuild(), connection())
		// a moves now and then; b never touches the controls
		let seq = 0
		for (let i = 0; i < 30 * 120 && reports.length === 0; i++) {
			if (i % 30 === 0) {
				room.receiveInputs('user-a', [{ seq: ++seq, moveX: 50, moveY: 0, aim: 0, buttons: 0, viewTick: 0, reach: 0 }])
			}
			for (let z = 0; z < 300; z++) if (room.world.alive[z]) room.world.damageZombie(z, 1e6, 0)
			room.tick(Date.now())
		}
		expect(reports).toHaveLength(1)
		expect(reports[0]).toMatchObject({
			userId: 'user-a',
			xp: economy.rewards.waveClear.xp,
			salvage: economy.rewards.waveClear.salvage
		})
	})
})

describe('room input handling', () => {
	it('lets a reconnecting player move again with inputs numbered from 1', () => {
		const room = new Room('room-r', 'squad', 1, 0)
		room.join('user-a', 'A', starterBuild(), connection())
		const input = (n: number) => ({ seq: n, moveX: 127, moveY: 0, aim: 0, buttons: 0, viewTick: 0, reach: 0 })
		for (let n = 1; n <= 10; n++) {
			room.receiveInputs('user-a', [input(n)])
			room.tick(Date.now())
		}
		room.join('user-a', 'A', starterBuild(), connection())
		const player = room.world.players.get(1)
		const before = player?.x ?? 0
		room.receiveInputs('user-a', [input(1)])
		room.tick(Date.now())
		expect(player?.x).toBeGreaterThan(before)
		expect(player?.lastSeq).toBe(1)
	})

	it('credits kills made by catch-up inputs', () => {
		const reports: { kills: number }[] = []
		const room = new Room('room-c', 'squad', 1, 0, report => reports.push(report))
		room.join('user-a', 'A', starterBuild(), connection())
		const player = room.world.players.get(1)
		if (!player) throw new Error()
		const target = room.world.spawnZombie(zombieIndex('drudge'), { x: player.x + 2, y: player.y })
		room.world.health[target] = 1
		// a backlog after a stall: the first input (which fires) is applied as a catch-up input
		const inputs = Array.from({ length: 6 }, (_, k) => ({
			seq: k + 1,
			moveX: 0,
			moveY: 0,
			aim: angleToAim(0),
			buttons: k === 0 ? Button.fire : 0,
			viewTick: room.world.tick,
			reach: 0
		}))
		room.receiveInputs('user-a', inputs)
		room.tick(Date.now())
		expect(room.world.alive[target]).toBe(0)
		room.reportAll()
		expect(reports[0]?.kills).toBe(1)
	})

	it('limits firing-range spawning by rate and by count', () => {
		const room = new Room('range-1', 'range', 1, 0)
		room.join('user-a', 'A', starterBuild(), connection())
		const drudge = zombieIndex('drudge')
		const start = room.world.aliveCount
		for (let n = 0; n < 50; n++) room.rangeCommand(RangeAction.spawn, drudge, 20, 1000)
		// a burst of six commands, five zombies each
		expect(room.world.aliveCount - start).toBe(30)
		for (let t = 0; t < 100; t++) room.rangeCommand(RangeAction.spawn, drudge, 5, 2000 + t * 1000)
		expect(room.world.aliveCount - start).toBe(60)
	})
})
