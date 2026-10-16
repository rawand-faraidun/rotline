import { economy, starterBuild, zombieIndex, zombies } from '@rotline/game-data'
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

	it('pays everyone for a cleared wave', () => {
		const reports: { userId: string; xp: number; salvage: number }[] = []
		const room = new Room('room-2', 'squad', 1, 0, report => reports.push(report))
		room.join('user-a', 'A', starterBuild(), connection())
		// run until the second wave starts (the first is cleared by killing everything as it spawns)
		for (let i = 0; i < 30 * 120 && reports.length === 0; i++) {
			for (let z = 0; z < 300; z++) if (room.world.alive[z]) room.world.damageZombie(z, 1e6, 0)
			room.tick(Date.now())
		}
		expect(reports[0]).toMatchObject({
			userId: 'user-a',
			xp: economy.rewards.waveClear.xp,
			salvage: economy.rewards.waveClear.salvage
		})
	})
})
