import { maps } from '@rotline/game-data'
import { Interpolator } from './interpolate.ts'
import { Effects } from './render/effects.ts'
import { Stage } from './render/scene.ts'
import { ZombieRenderer } from './render/zombies.ts'

/**
 * A development bench for effects: a map seen from the game's camera, where explosions, gas
 * bursts and falling bodies can be set off by hand (`window.fxLab`). Used to tune how they look.
 */
export function mountFxLab(canvas: HTMLCanvasElement, mapId = 'yard', at = { x: 32, y: 24 }) {
	const map = (maps[mapId] ?? maps.yard) as NonNullable<typeof maps.yard>
	const stage = new Stage(canvas, map, '/assets')
	stage.resize()
	const effects = new Effects(stage.scene, true)
	const view = new Interpolator().view
	let zombies: ZombieRenderer | null = null
	void ZombieRenderer.load('/assets/models/characters/zombie.glb').then(renderer => {
		zombies = renderer
		stage.scene.add(renderer.mesh, renderer.corpses)
	})
	// a clock that can be stopped and set, to see one moment of an effect
	let frozen: number | null = null
	const now = () => frozen ?? performance.now() / 1000
	;(window as unknown as { fxLab: unknown }).fxLab = {
		blast: (x: number, y: number, radius: number) => effects.explode(-1, x, y, radius, now()),
		gas: (x: number, y: number, radius: number) => effects.gas(x, y, radius, now()),
		fall: (x: number, y: number, type = 0) => zombies?.fall(9999, type, x, y),
		ready: () => zombies !== null,
		/** stops the clock at `seconds` after the last call to `freeze()` without an argument */
		freeze: (seconds?: number) => {
			if (seconds === undefined) {
				frozen = performance.now() / 1000
				start = frozen
			} else {
				// step there, so the particles move as they would have
				const target = start + seconds
				while ((frozen as number) < target - 1e-6) {
					frozen = Math.min(target, (frozen as number) + 1 / 60)
					effects.update(frozen)
					zombies?.update(view, frozen)
				}
			}
		}
	}
	let start = 0
	let last = now()
	const loop = () => {
		requestAnimationFrame(loop)
		const time = now()
		stage.follow(at.x, at.y, at.x + 1, at.y, time - last)
		last = time
		effects.update(time)
		zombies?.update(view, time)
		stage.render()
	}
	loop()
}
