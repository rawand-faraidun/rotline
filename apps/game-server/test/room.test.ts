import { difficultyDef, economy, items, starterBuild, zombieIndex, zombies } from '@rotline/game-data'
import { KickReason, RangeAction, Reader, readServerHeader } from '@rotline/protocol'
import { angleToAim, Button, PropState } from '@rotline/sim'
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

describe('mission rooms', () => {
	type Report = Parameters<ConstructorParameters<typeof Room>[4] & {}>[0]
	const tierOne = items.find(item => item.tier === 1)?.id ?? ''

	function missionRoom(reports: Report[], sent: Uint8Array[] = []) {
		const room = new Room('squad-m', 'squad', 1, 0, report => reports.push(report), {
			id: 'yard-sweep',
			difficulty: 'nightmare'
		})
		room.join('user-a', 'A', starterBuild(), { send: bytes => sent.push(bytes) > 0, close: () => {} })
		room.join('user-b', 'B', starterBuild(), connection())
		// b never touches the controls (and joined long enough ago to count as idle)
		const b = room.world.players.get(2)
		if (b) b.lastActiveTick = -1e6
		return room
	}

	/** user-a nudges the stick so they count as playing; zombies are cleared every tick. */
	function play(room: Room, ticks: number) {
		for (let i = 0; i < ticks; i++) {
			room.receiveInputs('user-a', [
				{ seq: ++seq, moveX: 0, moveY: 0, aim: 0, buttons: Button.reload, viewTick: 0, reach: 0 }
			])
			for (let z = 0; z < 300; z++) if (room.world.alive[z]) room.world.alive[z] = 0
			room.world.aliveCount = 0
			room.tick(Date.now())
		}
	}

	it('pays objectives scaled by difficulty to those who played, and saves items at checkpoints', () => {
		const reports: Report[] = []
		const room = missionRoom(reports)
		const mission = room.world.mission
		const a = room.world.players.get(1)
		if (!mission || !a) throw new Error('no mission')
		expect(room.world.map.id).toBe('yard')
		a.foundItems.push(tierOne)
		mission.progress = 40
		play(room, 2)
		expect(mission.index).toBe(1)
		expect(reports).toHaveLength(0)
		// the nests burnt out: a checkpoint, which reports everything including the item
		for (const id of ['nest-sheds-west', 'nest-sheds-east', 'nest-centre']) {
			const nest = room.world.propById.get(id)
			if (nest) nest.state = PropState.destroyed
		}
		play(room, 2)
		expect(mission.checkpointIndex).toBe(2)
		const forA = reports.filter(report => report.userId === 'user-a')
		expect(forA).toHaveLength(1)
		expect(forA[0]?.items).toEqual([tierOne])
		const scale = difficultyDef('nightmare').rewards
		// two objectives, plus the Salvage their score is worth
		const a2 = room.world.players.get(1)
		expect(forA[0]?.salvage).toBe(
			Math.floor((economy.rewards.objective.salvage * 2 + (a2?.score ?? 0) / economy.rewards.scorePerSalvage) * scale)
		)
		expect(forA[0]?.xp).toBeGreaterThanOrEqual(Math.floor(economy.rewards.objective.xp * scale * 2))
		expect(a.itemsReported).toBe(1)
		// b never played: no objective pay (only the objective score turned into XP)
		const forB = reports.filter(report => report.userId === 'user-b')
		expect(forB.every(report => report.salvage === 0 && !report.items)).toBe(true)
	})

	it('finishes with completion rewards, a result for mastery and a results screen', () => {
		const reports: Report[] = []
		const sent: Uint8Array[] = []
		const room = missionRoom(reports, sent)
		const mission = room.world.mission
		if (!mission) throw new Error('no mission')
		mission.index = mission.def.objectives.length - 1
		mission.progress = 40 * 30 - 1
		play(room, 3)
		expect(room.completedAt).toBeGreaterThan(0)
		expect(room.missionComplete).toBe(true)
		const final = reports.find(report => report.userId === 'user-a' && report.result)
		expect(final?.result).toMatchObject({ missionId: 'yard-sweep', difficulty: 'nightmare', success: true })
		expect(final?.items).toHaveLength(1)
		expect(reports.some(report => report.userId === 'user-b' && report.result)).toBe(false)
		const results = sent.map(bytes => readServerHeader(new Reader(bytes))).find(message => message.type === 'results')
		expect(results).toMatchObject({ type: 'results', success: true, items: [expect.any(Number)] })
		if (results?.type === 'results') {
			expect(results.salvage).toBeGreaterThanOrEqual(Math.floor(economy.rewards.completion.salvage * 1.35))
		}
		// the room says why it closes
		room.closeAll(KickReason.complete)
		expect(readServerHeader(new Reader(sent.at(-1) as Uint8Array))).toEqual({
			type: 'kick',
			reason: KickReason.complete
		})
	})

	it('ignores an unknown mission and runs waves', () => {
		const room = new Room('squad-x', 'squad', 1, 0, () => {}, { id: 'nowhere', difficulty: 'veteran' })
		expect(room.missionRoom).toBeNull()
		expect(room.world.mission).toBeNull()
	})
})

describe('room lifecycle', () => {
	type Report = Parameters<ConstructorParameters<typeof Room>[4] & {}>[0]
	const decode = (sent: Uint8Array[]) => sent.map(bytes => readServerHeader(new Reader(bytes)))

	it('ends a Survival run on a wipe with the rounds survived', () => {
		const sent: Uint8Array[] = []
		const room = new Room('squad-s', 'squad', 1, 0)
		room.join('user-a', 'A', starterBuild(), { send: bytes => sent.push(bytes) > 0, close: () => {} })
		expect(room.world.survival).toBe(true)
		const a = room.world.players.get(1)
		if (!a) throw new Error()
		a.health = 1
		room.world.spawnZombie(zombieIndex('drudge'), { x: a.x + 0.5, y: a.y })
		for (let i = 0; i < 120 && room.completedAt === 0; i++) room.tick(Date.now())
		for (let i = 0; i < 4; i++) room.tick(Date.now())
		expect(room.completedAt).toBeGreaterThan(0)
		expect(decode(sent).find(message => message.type === 'results')).toMatchObject({ success: false, rounds: 0 })
	})

	it('pauses a room of one, not a squad', () => {
		const room = new Room('squad-p', 'squad', 1, 0)
		room.join('user-a', 'A', starterBuild(), connection())
		room.pause('user-a', true, 1000)
		const tick = room.world.tick
		room.tick(1100)
		expect(room.world.tick).toBe(tick)
		room.pause('user-a', false, 1200)
		room.tick(1300)
		expect(room.world.tick).toBe(tick + 1)
		room.join('user-b', 'B', starterBuild(), connection())
		room.pause('user-a', true, 1400)
		expect(room.paused).toBe(false)
	})

	it('comes out of a pause when the player comes back (a reload or a return to the range)', () => {
		const room = new Room('range-u', 'range', 1, 0)
		room.join('user-a', 'A', starterBuild(), connection())
		room.pause('user-a', true, 1000)
		expect(room.paused).toBe(true)
		room.join('user-a', 'A', starterBuild(), connection())
		expect(room.paused).toBe(false)
		const tick = room.world.tick
		room.tick(1100)
		expect(room.world.tick).toBe(tick + 1)
	})

	it('tells only the finder about a drop, and splits a report too large for one', () => {
		const reports: Report[] = []
		const sentA: Uint8Array[] = []
		const sentB: Uint8Array[] = []
		const room = new Room('squad-d', 'squad', 1, 0, report => reports.push(report), {
			id: 'yard-sweep',
			difficulty: 'veteran'
		})
		room.join('user-a', 'A', starterBuild(), { send: bytes => sentA.push(bytes) > 0, close: () => {} })
		room.join('user-b', 'B', starterBuild(), { send: bytes => sentB.push(bytes) > 0, close: () => {} })
		room.world.events = []
		const a = room.world.players.get(1)
		if (!a) throw new Error()
		const cache = room.world.mission?.def.caches[0] as { x: number; y: number }
		a.x = cache.x
		a.y = cache.y
		room.receiveInputs('user-a', [
			{ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: Button.interact, viewTick: 0, reach: 0 }
		])
		room.tick(Date.now())
		room.tick(Date.now())
		const events = (sent: Uint8Array[]) =>
			decode(sent).flatMap(message => (message.type === 'events' ? message.events : []))
		expect(events(sentA).some(event => event.type === 'item-found')).toBe(true)
		expect(events(sentB).some(event => event.type === 'item-found')).toBe(false)
		// a huge score: the report is split into parts each within the cap
		a.score += economy.rewards.maxPerReport.xp * economy.rewards.scorePerXp * 2.5
		room.reportAll()
		const forA = reports.filter(report => report.userId === 'user-a')
		expect(forA.length).toBeGreaterThanOrEqual(3)
		expect(forA.every(report => report.xp <= economy.rewards.maxPerReport.xp)).toBe(true)
		expect(new Set(forA.map(report => report.grantKey)).size).toBe(forA.length)
	})
})
