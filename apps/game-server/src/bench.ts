// Tick cost of full rooms: 4 players firing and moving, the horde at its cap. `pnpm bench [rooms] [ticks]`
import { maps, zombieIndex } from '@rotline/game-data'
import { SnapshotEncoder, Writer } from '@rotline/protocol'
import { angleToAim, Button, MAX_ZOMBIES, type PlayerInput, World } from '@rotline/sim'

const rooms = Number(process.argv[2] ?? 8)
const ticks = Number(process.argv[3] ?? 900)
const yard = maps.yard as NonNullable<typeof maps.yard>
const types = ['drudge', 'bolter', 'swell'].map(zombieIndex)

const worlds = Array.from({ length: rooms }, (_, r) => {
	const world = new World({ seed: r + 1, map: yard, flowPhase: r })
	for (let p = 1; p <= 4; p++) world.addPlayer(p)
	return world
})
const encoders = worlds.map(() => [1, 2, 3, 4].map(id => new SnapshotEncoder(id)))
const writer = new Writer(65536)
let bytes = 0

function refill(world: World) {
	while (world.aliveCount < MAX_ZOMBIES) {
		const spawn = yard.zombieSpawns[world.aliveCount % yard.zombieSpawns.length] as { x: number; y: number }
		world.spawnZombie(types[world.aliveCount % 3] as number, { x: spawn.x + (world.aliveCount % 7) * 0.3, y: spawn.y })
	}
}

const times: number[] = []
for (let t = 0; t < ticks; t++) {
	const inputs = new Map<number, PlayerInput>()
	for (let p = 1; p <= 4; p++) {
		inputs.set(p, {
			seq: t,
			moveX: Math.round(Math.sin(t / 30 + p) * 127),
			moveY: Math.round(Math.cos(t / 40 + p) * 127),
			aim: angleToAim(t / 10 + p),
			buttons: Button.fire,
			viewTick: Math.max(0, t - 3)
		})
	}
	const started = performance.now()
	for (const [r, world] of worlds.entries()) {
		refill(world)
		world.step(inputs)
		if (world.tick % 2 === 0) for (const encoder of encoders[r] ?? []) bytes += encoder.write(writer, world).length
	}
	times.push(performance.now() - started)
}
times.sort((a, b) => a - b)
const mean = times.reduce((a, b) => a + b, 0) / times.length
const pct = (q: number) => (times[Math.min(times.length - 1, Math.floor(q * times.length))] as number).toFixed(3)
process.stdout.write(
	`${JSON.stringify({
		rooms,
		zombiesPerRoom: MAX_ZOMBIES,
		playersPerRoom: 4,
		msPerTickAllRooms: { mean: mean.toFixed(3), p50: pct(0.5), p99: pct(0.99), max: pct(1) },
		msPerRoom: (mean / rooms).toFixed(3),
		snapshotKBPerPlayerPerSecond: (bytes / rooms / 4 / (ticks / 30) / 1024).toFixed(1),
		rssMB: (process.memoryUsage().rss / 1048576).toFixed(0)
	})}\n`
)
