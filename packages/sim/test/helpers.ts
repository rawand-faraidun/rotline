import { maps } from '@rotline/game-data'
import { type PlayerInput, World } from '../src/index.ts'

export const yard = maps.yard as NonNullable<typeof maps.yard>

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
