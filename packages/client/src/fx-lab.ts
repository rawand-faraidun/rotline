import { buffs, maps } from '@rotline/game-data'
import type { ObjectState } from '@rotline/protocol'
import { createProps, Grid, ObjectKind } from '@rotline/sim'
import { Interpolator } from './interpolate.ts'
import { Decor } from './render/decor.ts'
import { autoDecor } from './render/dressing.ts'
import { Effects } from './render/effects.ts'
import { ObjectRenderer } from './render/objects.ts'
import { PropRenderer } from './render/props.ts'
import { Stage } from './render/scene.ts'
import { surroundings } from './render/surroundings.ts'
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
	const decor = new Decor(
		stage.scene,
		{ ...map, decor: [...(map.decor ?? []), ...autoDecor(map), ...surroundings(map).decor] },
		'/assets',
		true
	)
	// the map's props as they start (doors, turrets, cracked walls)
	const props = createProps(map, new Grid(map))
	const propRenderer = new PropRenderer(stage.scene, props, '/assets', true, stage.wallMaterials)
	const view = new Interpolator().view
	const objectRenderer = new ObjectRenderer(stage.scene, '/assets')
	// what lies on the ground: every pickup in a row, and a sentry, a claymore, a decoy, sandbags
	const thing = (id: number, kind: number, x: number, y: number, extra: Partial<ObjectState> = {}): ObjectState => ({
		id,
		kind,
		x,
		y,
		radius: 1,
		angle: 0,
		health: 1,
		secondsLeft: 30,
		variant: 0,
		cells: [],
		...extra
	})
	const objects: ObjectState[] = [
		...buffs.buffs.map((_, index) =>
			thing(index + 1, ObjectKind.buff, at.x - 6 + index * 1.7, at.y + 3.5, { variant: index })
		),
		thing(100, ObjectKind.sentry, at.x - 4, at.y - 3, { angle: 0.4 }),
		thing(101, ObjectKind.mine, at.x - 1.5, at.y - 3, { angle: 0 }),
		thing(102, ObjectKind.decoy, at.x + 1, at.y - 3),
		thing(103, ObjectKind.barricade, at.x + 4.5, at.y - 3, { radius: 1.5 })
	]
	let showObjects = false
	/** zombies-on-fire stand-ins: places that burn every frame */
	const fires: { x: number; y: number }[] = []
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
		/** moves the camera to look at (x, y) */
		goto: (x: number, y: number) => {
			at.x = x
			at.y = y
		},
		jet: (x: number, y: number, angle: number, toxic = false) => effects.flame(x, y, angle, 7, 0.26, toxic, now()),
		burn: (x: number, y: number) => fires.push({ x, y }),
		shot: (x: number, y: number, angle: number) => effects.tracer(x, y, angle, 6, now(), 1.05, 0xff3a2a),
		objects: (on = true) => {
			showObjects = on
		},
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
					for (const fire of fires) effects.burning(fire.x, fire.y, 1, frozen, 1 / 60)
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
		decor.update(time)
		if (frozen === null) for (const fire of fires) effects.burning(fire.x, fire.y, 1, time, 1 / 60)
		zombies?.update(view, time)
		objectRenderer.update(showObjects ? objects : [], time)
		propRenderer.update(props, time, 1 / 60)
		stage.render()
	}
	loop()
}
