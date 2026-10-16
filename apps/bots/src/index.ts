// Headless bot players for network and load tests.
// node src/index.ts --url ws://localhost:3200/game --rooms 2 --players 4 --seconds 60
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { loadPrivateKey, signTicket } from '@rotline/ticket'
import { Bot, botName } from './bot.ts'

const { values } = parseArgs({
	options: {
		url: { type: 'string', default: 'ws://localhost:3200/game' },
		rooms: { type: 'string', default: '1' },
		players: { type: 'string', default: '4' },
		seconds: { type: 'string', default: '60' },
		instance: { type: 'string', default: process.env.GAME_INSTANCE_ID ?? 'local-1' },
		label: { type: 'string', default: '' }
	}
})

const privateKey = process.env.GAME_TICKET_PRIVATE_KEY
if (!privateKey) throw new Error('GAME_TICKET_PRIVATE_KEY is required (bots sign their own tickets)')
const key = loadPrivateKey(privateKey)

const bots: Bot[] = []
for (let r = 0; r < Number(values.rooms); r++) {
	const room = `bots-${randomUUID()}`
	for (let p = 0; p < Number(values.players); p++) {
		const { ticket } = signTicket(key, {
			sub: randomUUID(),
			name: botName(),
			room,
			inst: values.instance,
			mode: 'squad'
		})
		bots.push(new Bot(values.url, ticket))
	}
}

await new Promise(resolve => setTimeout(resolve, Number(values.seconds) * 1000))
for (const bot of bots) bot.close()

const all = bots.map(bot => bot.stats)
const gaps = all.flatMap(stats => stats.gaps).sort((a, b) => a - b)
const rtts = all.flatMap(stats => stats.rttMs).sort((a, b) => a - b)
const pct = (list: number[], q: number) =>
	list.length ? (list[Math.min(list.length - 1, Math.floor(q * list.length))] as number) : 0
const sum = (pick: (stats: (typeof all)[number]) => number) => all.reduce((total, stats) => total + pick(stats), 0)
const report = {
	label: values.label,
	bots: bots.length,
	seconds: Number(values.seconds),
	snapshots: sum(stats => stats.snapshots),
	snapshotGapMs: {
		p50: pct(gaps, 0.5).toFixed(0),
		p95: pct(gaps, 0.95).toFixed(0),
		p99: pct(gaps, 0.99).toFixed(0),
		max: pct(gaps, 1).toFixed(0)
	},
	lateOver100msPercent: (
		(sum(stats => stats.late) /
			Math.max(
				1,
				sum(stats => stats.snapshots)
			)) *
		100
	).toFixed(2),
	starvedFramesPercent: (
		(sum(stats => stats.starved) /
			Math.max(
				1,
				sum(stats => stats.frames)
			)) *
		100
	).toFixed(2),
	interpolationDelayMs: (
		sum(stats => stats.delaySum) /
		Math.max(
			1,
			sum(stats => stats.frames)
		)
	).toFixed(0),
	predictionCorrections: sum(stats => stats.corrections),
	maxCorrectionMetres: Math.max(0, ...all.map(stats => stats.maxCorrection)).toFixed(3),
	rttMs: { p50: pct(rtts, 0.5), p95: pct(rtts, 0.95) },
	kicked: all.filter(stats => stats.kicked !== null).length
}
process.stdout.write(`${JSON.stringify(report)}\n`)
