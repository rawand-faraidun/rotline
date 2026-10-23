import { type MissionDef, maps } from '@rotline/game-data'
import { type PlayerInput, World } from '../src/index.ts'

export const yard = maps.yard as NonNullable<typeof maps.yard>

/**
 * A fixed mission on the yard for tests, so they don't move when the campaign's missions change:
 * kill 40, burn three nests, reach the north gate, hold it, kill a Brute, survive, and an optional kill.
 */
export const sweep: MissionDef = {
	id: 'yard-sweep',
	name: 'Test Sweep',
	zone: 'ashgate',
	map: 'yard',
	description: 'A test mission.',
	parTimeSeconds: 660,
	scoreTarget: 42000,
	enemyLevel: 1,
	recommendedLevel: 1,
	spawn: { perSecond: 1.6, maxAlive: 90, composition: { drudge: 60, bolter: 20, swell: 8, crawler: 12 } },
	caches: [
		{ x: 4, y: 44 },
		{ x: 60, y: 4 }
	],
	objectives: [
		{ type: 'kill', label: 'Thin the horde', count: 40 },
		{
			type: 'destroy',
			label: 'Burn the nests',
			props: ['nest-sheds-west', 'nest-sheds-east', 'nest-centre'],
			ambush: { count: 10, composition: { crawler: 70, bolter: 30 } },
			checkpoint: true,
			checkpointAt: { x: 32, y: 24 }
		},
		{ type: 'reach', label: 'Reach the north gate', area: { x: 32, y: 4, radius: 4 }, checkpoint: true },
		{
			type: 'hold',
			label: 'Hold the gate',
			area: { x: 32, y: 4, radius: 5 },
			seconds: 45,
			spawnScale: 1.6,
			checkpoint: true,
			ambush: { count: 15, composition: { bolter: 60, drudge: 40 } }
		},
		{
			type: 'kill',
			label: 'Stop the Brute',
			count: 1,
			of: 'brute',
			boss: { type: 'brute', at: { x: 32, y: 44 } },
			spawnScale: 0.8
		},
		{
			type: 'survive',
			label: 'Survive',
			seconds: 40,
			spawnScale: 2,
			ambush: { count: 10, composition: { screamer: 20, drudge: 80 } }
		},
		{ type: 'kill', label: 'Optional: put down 150', count: 150, optional: true }
	]
}

/** A world with spawning switched off unless a test asks for it. */
export function quietWorld(seed = 1): World {
	return new World({
		seed,
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

export function input(partial: Partial<PlayerInput> = {}): PlayerInput {
	return { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0, viewTick: 0, reach: 0, ...partial }
}

export function steps(
	world: World,
	count: number,
	inputFor: (tick: number) => Map<number, PlayerInput> = () => new Map()
) {
	for (let i = 0; i < count; i++) world.step(inputFor(world.tick))
}
