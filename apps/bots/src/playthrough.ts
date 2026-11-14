// Plays a mission through on a running game server, as one headless player with a scripted mind:
// it walks to the objective, fights from range, refills at an ammo station, sidesteps every attack
// the server warns about, and logs each step, boss phase, down and the result.
// node src/playthrough.ts --mission warden --difficulty recruit [--url ws://localhost:3200/game]
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import {
	type Build,
	type DifficultyId,
	missionById,
	missionMap,
	starterBuild,
	weapons,
	zombies
} from '@rotline/game-data'
import {
	Reader,
	readServerHeader,
	readSnapshot,
	type SnapshotFrame,
	Writer,
	writeHello,
	writeInput,
	writePong,
	ZombieTable
} from '@rotline/protocol'
import { angleToAim, Button, type PlayerInput, quantiseAxis, TICK_RATE, WarnKind } from '@rotline/sim'
import { loadPrivateKey, signTicket } from '@rotline/ticket'
import WebSocket from 'ws'

const { values } = parseArgs({
	options: {
		url: { type: 'string', default: 'ws://localhost:3200/game' },
		mission: { type: 'string', default: 'warden' },
		difficulty: { type: 'string', default: 'recruit' },
		instance: { type: 'string', default: process.env.GAME_INSTANCE_ID ?? 'local-1' },
		minutes: { type: 'string', default: '15' },
		players: { type: 'string', default: '1' }
	}
})
const found = missionById(values.mission)
if (!found) throw new Error(`no mission ${values.mission}`)
const mission = found
const map = missionMap(mission)
const privateKey = process.env.GAME_TICKET_PRIVATE_KEY
if (!privateKey) throw new Error('GAME_TICKET_PRIVATE_KEY is required (the bot signs its own ticket)')

// a veteran's kit: a grenade launcher (blasts go round shields), a machine gun, a heavy pistol
const base = starterBuild('assault')
const build: Build = {
	...base,
	level: 50,
	loadout: {
		...base.loadout,
		main: [
			{ id: 'thumper', level: 10, perks: [] },
			{ id: 'mower', level: 10, perks: [] }
		],
		pistol: { id: 'halcyon-45', level: 10, perks: [] }
	}
}
const room = `squad-${randomUUID()}`
const ticketFor = (name: string) =>
	signTicket(loadPrivateKey(privateKey), {
		sub: randomUUID(),
		name,
		room,
		inst: values.instance,
		mode: 'squad',
		mission: { id: mission.id, difficulty: values.difficulty as DifficultyId },
		build
	}).ticket

const started = Date.now()
const say = (text: string) =>
	process.stdout.write(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${text}\n`)
/** any of the bosses */
const BOSSES = new Set(zombies.flatMap((zombie, index) => (zombie.boss || zombie.elite ? [index] : [])))
/** where to fall back to: the mission's first checkpoint or area (the open ground it fights on) */
const centre = (() => {
	for (const step of mission.objectives) {
		if (step.checkpointAt) return step.checkpointAt
		if ('area' in step) return step.area
	}
	return map.playerSpawns[0] ?? { x: 0, y: 0 }
})()

/** One player in the room; only the first (`lead`) logs. */
function play(name: string, lead: boolean): void {
	const log = (text: string) => lead && say(text)
	const socket = new WebSocket(values.url)
	socket.binaryType = 'arraybuffer'
	const writer = new Writer(256)
	const table = new ZombieTable()
	let frame: SnapshotFrame | null = null
	let seq = 0
	const recent: PlayerInput[] = []
	/** sidestepping a warned attack: which way, and until when (ms) */
	let dodge = { x: 0, y: 0, until: 0 }
	let objective = -1
	let done = false
	const ammo = map.props?.find(prop => prop.kind === 'ammo')

	socket.on('open', () => socket.send(writeHello(writer, ticketFor(name))))
	socket.on('close', () => {
		if (!lead) return
		if (!done) log('connection closed')
		process.exit(done ? 0 : 1)
	})
	socket.on('message', (data: ArrayBuffer) => {
		const reader = new Reader(new Uint8Array(data))
		const message = readServerHeader(reader)
		if (message.type === 'welcome') {
			log(`in ${mission.name} on ${values.difficulty}, map ${message.mapId}`)
			setInterval(tick, 1000 / TICK_RATE)
		} else if (message.type === 'ping') socket.send(writePong(writer, message.time))
		else if (message.type === 'kick') log(`kicked: ${message.reason}`)
		else if (message.type === 'snapshot') {
			frame = readSnapshot(reader, table)
			const index = frame.mission.objective
			if (index !== objective) {
				objective = index
				const step = mission.objectives[index]
				if (step) log(`step ${index + 1}: ${step.label}`)
			}
		} else if (message.type === 'events') {
			for (const event of message.events) {
				if (event.type === 'warn' && frame) {
					const me = frame.self
					// away from the ring, or off the lane, for a second
					let near = Math.hypot(me.x - event.tx, me.y - event.ty) < event.radius + 1.2
					let ax = me.x - event.tx
					let ay = me.y - event.ty
					if (event.kind === WarnKind.charge) {
						const lx = event.tx - event.x
						const ly = event.ty - event.y
						const length = Math.hypot(lx, ly) || 1
						const along = ((me.x - event.x) * lx + (me.y - event.y) * ly) / length
						const across = ((me.x - event.x) * -ly + (me.y - event.y) * lx) / length
						near = along > -1 && along < length + 1 && Math.abs(across) < event.radius + 1.5
						ax = (-ly / length) * (across >= 0 ? 1 : -1)
						ay = (lx / length) * (across >= 0 ? 1 : -1)
					}
					if (near) {
						const d = Math.hypot(ax, ay) || 1
						dodge = { x: ax / d, y: ay / d, until: Date.now() + 1100 }
					}
					if (process.env.DEBUG)
						log(
							`warned: ${['', 'spit', 'charge', 'slam', 'erupt', 'lob'][event.kind]} ${Math.hypot(me.x - event.tx, me.y - event.ty).toFixed(1)} m away, ${near ? 'dodging' : 'clear'}`
						)
				} else if (event.type === 'player-hurt' && event.amount >= 15 && process.env.DEBUG)
					log(`hit for ${event.amount.toFixed(0)}, ${Date.now() < dodge.until ? 'while dodging' : 'standing'}`)
				else if (event.type === 'phase')
					log(`boss phase ${event.phase}: ${zombies[event.zombieType]?.phases?.[event.phase - 1]?.name}`)
				else if (event.type === 'player-down') log('down')
				else if (event.type === 'checkpoint') log('checkpoint')
				else if (event.type === 'failed') log('objective failed: back to the checkpoint')
				else if (event.type === 'mission-complete') log('MISSION COMPLETE')
				else if (event.type === 'mission-failed') log(`MISSION FAILED (${event.reason})`)
				else if (event.type === 'kill' && zombies[event.zombieType]?.boss)
					log(`${zombies[event.zombieType]?.name} is down`)
			}
		} else if (message.type === 'results') {
			log(
				`results: ${message.success ? 'success' : 'failure'}, ${(message.timeMs / 1000).toFixed(0)} s, ${message.kills} kills, score ${message.score}, ${message.downs} downs, mastery ${message.mastery}`
			)
			done = true
			if (lead) setTimeout(() => process.exit(message.success ? 0 : 2), 500)
		}
	})

	function tick(): void {
		if (!frame || socket.readyState !== WebSocket.OPEN) return
		const me = frame.self
		const step = mission?.objectives[frame.mission.objective]
		// the nearest zombie above ground, and the boss when it is in view
		let target = -1
		let best = Number.POSITIVE_INFINITY
		let boss = -1
		for (let i = 0; i < table.known.length; i++) {
			if (table.known[i] !== 1 || table.state[i] === 5) continue
			const d = Math.hypot((table.x[i] as number) - me.x, (table.y[i] as number) - me.y)
			if (BOSSES.has(table.type[i] as number)) boss = i
			if (d < best) {
				best = d
				target = i
			}
		}
		const aimAt =
			boss >= 0 && Math.hypot((table.x[boss] as number) - me.x, (table.y[boss] as number) - me.y) < 24 && best > 3
				? boss
				: target
		let mx = 0
		let my = 0
		let buttons = 0
		const go = (x: number, y: number) => {
			const d = Math.hypot(x - me.x, y - me.y) || 1
			mx = (x - me.x) / d
			my = (y - me.y) / d
		}
		const held = me.weapons[me.slot as 0 | 1 | 2]
		const dry =
			me.weapons[0].reserve === 0 && me.weapons[0].mag === 0 && me.weapons[1].reserve === 0 && me.weapons[1].mag === 0
		if (Date.now() < dodge.until) {
			mx = dodge.x
			my = dodge.y
			buttons |= Button.sprint
		} else if (dry && ammo && frame.mission.spendable >= 500) {
			// out of everything but the pistol: to the ammo station, and hold E there
			go(ammo.x + 1, ammo.y + 1.5)
			if (Math.hypot(ammo.x + 1 - me.x, ammo.y + 1.5 - me.y) < 1.2) buttons |= Button.interact
		} else if (step && 'area' in step && (step.type === 'reach' || step.type === 'extract' || step.type === 'hold')) {
			go(step.area.x, step.area.y)
			if (best < 2.5) buttons |= Button.sprint
		} else if (
			(boss >= 0 && Math.hypot((table.x[boss] as number) - me.x, (table.y[boss] as number) - me.y) < 8) ||
			(target >= 0 && best < 7)
		) {
			// keep the boss at a distance first, then the horde at arm's length, drifting back toward the
			// open middle of the square (and sprinting when the boss is close)
			const from =
				boss >= 0 && Math.hypot((table.x[boss] as number) - me.x, (table.y[boss] as number) - me.y) < 8 ? boss : target
			if (from === boss) buttons |= Button.sprint
			const away = { x: me.x - (table.x[from] as number), y: me.y - (table.y[from] as number) }
			const d = Math.hypot(away.x, away.y) || 1
			mx = away.x / d + (centre.x - me.x) * 0.06
			my = away.y / d + (centre.y - me.y) * 0.06
		}
		// a semi-automatic gun fires once a press: press and let go in turn
		const automatic = weapons[held.def]?.automatic ?? true
		if (aimAt >= 0 && best < 26 && !(buttons & Button.sprint) && (automatic || seq % 2 === 0)) buttons |= Button.fire
		// the launcher first, the machine gun when it runs dry, reloads when empty
		if (me.weapons[0].reserve === 0 && me.weapons[0].mag === 0 && me.slot === 0) buttons |= Button.slot2
		else if (held.mag === 0 && held.reserve !== 0) buttons |= Button.reload
		const aim =
			aimAt >= 0 ? angleToAim(Math.atan2((table.y[aimAt] as number) - me.y, (table.x[aimAt] as number) - me.x)) : me.aim
		const reach = aimAt >= 0 ? Math.min(255, Math.round(Math.min(best, 14) / 0.2)) : 0
		if (process.env.DEBUG && lead && seq % 150 === 0 && boss < 0)
			for (let i = 0; i < table.known.length; i++)
				if (table.known[i] === 1 && BOSSES.has(table.type[i] as number))
					log(
						`boss ${(((table.health[i] as number) / 255) * 100).toFixed(0)} % health, state ${table.state[i]}, ${Math.hypot((table.x[i] as number) - me.x, (table.y[i] as number) - me.y).toFixed(1)} m`
					)
		if (process.env.DEBUG && lead && seq % 150 === 0 && boss >= 0)
			log(
				`boss ${(((table.health[boss] as number) / 255) * 100).toFixed(0)} % health, state ${table.state[boss]}, ${Math.hypot((table.x[boss] as number) - me.x, (table.y[boss] as number) - me.y).toFixed(1)} m`
			)
		if (process.env.DEBUG === '2' && seq % 30 === 0)
			log(
				`hp ${me.health.toFixed(0)} at ${me.x.toFixed(1)},${me.y.toFixed(1)} slot ${me.slot} mag ${held.mag}/${held.reserve} nearest ${best.toFixed(1)} buttons ${buttons} move ${mx.toFixed(2)},${my.toFixed(2)}`
			)
		seq++
		const input: PlayerInput = {
			seq,
			moveX: quantiseAxis(mx),
			moveY: quantiseAxis(my),
			aim,
			buttons,
			viewTick: Math.max(0, frame.tick - 3),
			reach
		}
		recent.push(input)
		if (recent.length > 3) recent.shift()
		socket.send(writeInput(writer, 0, recent))
	}
}

for (let n = 0; n < Number(values.players); n++) play(`Playthrough ${n + 1}`, n === 0)

setTimeout(() => {
	say('out of time')
	process.exit(3)
}, Number(values.minutes) * 60_000)
