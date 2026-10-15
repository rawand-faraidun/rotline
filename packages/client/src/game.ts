import { maps, weapons } from '@rotline/game-data'
import { INPUT_REDUNDANCY } from '@rotline/protocol'
import { aimToAngle, angleToAim, Grid, type PlayerInput, quantiseAxis, TICK_RATE } from '@rotline/sim'
import * as THREE from 'three'
import { Controls } from './controls.ts'
import { HudStore } from './hud-store.ts'
import { Interpolator } from './interpolate.ts'
import { GameConnection } from './net.ts'
import { Predictor } from './predict.ts'
import { Effects } from './render/effects.ts'
import { PlayerFigure } from './render/players.ts'
import { Stage } from './render/scene.ts'
import { ZombieRenderer } from './render/zombies.ts'

const TICK_MS = 1000 / TICK_RATE

export type GameOptions = {
	canvas: HTMLCanvasElement
	/** ws:// or wss:// URL of the game endpoint */
	url: string
	ticket: string
	/** where the game's models live, e.g. "/assets" */
	assets: string
	gore?: boolean
}

export type GameHandle = {
	hud: HudStore
	/** resolves when the model is loaded and the first snapshot arrived */
	ready: Promise<void>
	stop(): void
}

/** Starts a mission client: connects, predicts, interpolates and draws until stopped. */
export function startGame(options: GameOptions): GameHandle {
	const hud = new HudStore()
	const map = maps.yard as NonNullable<typeof maps.yard>
	const grid = new Grid(map)
	const stage = new Stage(options.canvas, map)
	const effects = new Effects(stage.scene, options.gore ?? true)
	const interpolator = new Interpolator()
	const controls = new Controls(options.canvas)
	const raycaster = new THREE.Raycaster()
	const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
	const aimPoint = new THREE.Vector3()
	const pointer = new THREE.Vector2()
	const others = new Map<number, PlayerFigure>()

	let zombies: ZombieRenderer | null = null
	let predictor: Predictor | null = null
	let me: PlayerFigure | null = null
	let you = 0
	let seq = 0
	let accumulator = 0
	let last = performance.now()
	let frame = 0
	let frames = 0
	let fpsSince = last
	let pingMs = 0
	let lastOwnShotAt = -1
	let stopped = false
	const recent: PlayerInput[] = []
	const drawn = { x: 0, y: 0 }

	let markReady: () => void = () => {}
	const ready = new Promise<void>(resolve => {
		markReady = resolve
	})
	let modelReady = false
	let snapshotReady = false
	const checkReady = () => modelReady && snapshotReady && markReady()

	void ZombieRenderer.load(`${options.assets}/models/zombie.glb`).then(renderer => {
		if (stopped) return
		zombies = renderer
		stage.scene.add(renderer.mesh)
		modelReady = true
		checkReady()
	})

	const connection = new GameConnection(options.url, options.ticket, {
		welcome: slot => {
			you = slot
			predictor = new Predictor(grid, slot)
			me = new PlayerFigure(slot, true)
			stage.scene.add(me.group)
		},
		snapshot: (snapshot, table, receivedAt) => {
			interpolator.push(snapshot.tick, table, snapshot.others, snapshot.pools, receivedAt)
			predictor?.reconcile(snapshot.self, snapshot.lastSeq, snapshot.tick)
			if (snapshot.rttMs > 0) pingMs = snapshot.rttMs
			const self = snapshot.self
			hud.set(
				{
					status: self.alive ? 'playing' : 'down',
					health: Math.ceil(self.health),
					wave: snapshot.wave + 1,
					kills: snapshot.kills,
					score: snapshot.score,
					respawnSeconds: self.alive ? 0 : Math.max(0, Math.ceil((self.respawnTick - snapshot.tick) / TICK_RATE)),
					pingMs: Math.round(pingMs)
				},
				receivedAt
			)
			if (!snapshotReady) {
				snapshotReady = true
				checkReady()
			}
		},
		events: events => {
			const now = performance.now() / 1000
			for (const event of events) {
				switch (event.type) {
					case 'shot':
						// our own shots are already drawn when predicted
						if (event.player !== you) {
							effects.tracer(event.x, event.y, event.angle, event.length, now)
							effects.muzzleFlash(event.x, event.y, event.angle, now)
						}
						break
					case 'hit':
						if (now - lastOwnShotAt < 0.3) hud.set({ hitMarker: performance.now() }, performance.now(), true)
						if (Math.random() < 0.3) effects.splat(event.x, event.y, 0.35 + Math.random() * 0.3)
						break
					case 'kill':
						effects.splat(event.x, event.y, 0.8 + Math.random() * 0.6)
						break
					case 'burst':
						effects.burst(event.x, event.y, event.radius, now)
						break
					case 'player-down':
						if (event.player === you) hud.set({ status: 'down' }, performance.now(), true)
						break
				}
			}
		},
		kicked: reason => hud.set({ status: 'kicked', kickReason: reason }, performance.now(), true),
		closed: () => hud.set({ status: 'disconnected' }, performance.now(), true)
	})

	const onResize = () => stage.resize()
	window.addEventListener('resize', onResize)

	function sampleInput(renderTick: number): PlayerInput {
		const move = controls.movement()
		const length = Math.hypot(move.x, move.y) || 1
		let aim = predictor?.state.aim ?? 0
		if (controls.pointer.inside && predictor) {
			pointer.set(controls.pointer.x, controls.pointer.y)
			raycaster.setFromCamera(pointer, stage.camera)
			if (raycaster.ray.intersectPlane(groundPlane, aimPoint)) {
				aim = angleToAim(Math.atan2(aimPoint.z - predictor.state.y, aimPoint.x - predictor.state.x))
			}
		}
		seq++
		return {
			seq,
			moveX: quantiseAxis(move.x / length),
			moveY: quantiseAxis(move.y / length),
			aim,
			buttons: controls.buttons(),
			viewTick: Math.max(0, Math.floor(renderTick))
		}
	}

	function updateWeaponsHud(now: number): void {
		const state = predictor?.state
		if (!state) return
		hud.set(
			{
				weapons: state.weapons.map((held, slot) => {
					const def = weapons[held.def]
					return {
						name: def?.name ?? '?',
						mag: held.mag,
						magazine: def?.magazine ?? 0,
						reserve: held.reserve < 0 ? null : held.reserve,
						active: slot === state.slot
					}
				}),
				reloading: state.reloadEndTick !== 0 ? state.reloadEndTick : null
			},
			now
		)
	}

	function loop(now: number): void {
		if (stopped) return
		frame = requestAnimationFrame(loop)
		const dt = Math.min(0.1, (now - last) / 1000)
		last = now
		const renderTick = interpolator.renderTick(now)

		// fixed-rate input and prediction, independent of the display rate
		if (predictor) {
			accumulator += dt * 1000
			while (accumulator >= TICK_MS) {
				accumulator -= TICK_MS
				const input = sampleInput(renderTick)
				const fired = predictor.apply(input)
				if (fired) {
					const angle = aimToAngle(predictor.state.aim)
					const def = weapons[predictor.state.weapons[predictor.state.slot as 0 | 1 | 2].def]
					const reach = grid.rayToWall(
						predictor.state.x,
						predictor.state.y,
						Math.cos(angle),
						Math.sin(angle),
						def?.range ?? 20
					)
					effects.tracer(predictor.state.x, predictor.state.y, angle, reach, now / 1000)
					effects.muzzleFlash(predictor.state.x, predictor.state.y, angle, now / 1000)
					lastOwnShotAt = now / 1000
				}
				recent.push(input)
				if (recent.length > INPUT_REDUNDANCY) recent.shift()
				connection.sendInputs(recent)
			}
			updateWeaponsHud(now)
		}

		// draw
		if (predictor && me) {
			predictor.renderPosition(accumulator / TICK_MS, dt, drawn)
			me.set(drawn.x, drawn.y, aimToAngle(predictor.state.aim), predictor.state.alive)
			const aimAngle = aimToAngle(predictor.state.aim)
			const aimX = controls.pointer.inside ? aimPoint.x : drawn.x + Math.cos(aimAngle) * 8
			const aimY = controls.pointer.inside ? aimPoint.z : drawn.y + Math.sin(aimAngle) * 8
			stage.follow(drawn.x, drawn.y, aimX, aimY, dt)
		}
		if (interpolator.sample(renderTick)) {
			zombies?.update(interpolator.view, now / 1000)
			effects.setPools(interpolator.pools)
			for (const other of interpolator.others) {
				let figure = others.get(other.id)
				if (!figure) {
					figure = new PlayerFigure(other.id, false)
					others.set(other.id, figure)
					stage.scene.add(figure.group)
				}
				figure.set(other.x, other.y, aimToAngle(other.aim), other.alive)
			}
		}
		effects.update(now / 1000)
		stage.render()

		frames++
		if (now - fpsSince > 500) {
			hud.set({ fps: Math.round((frames * 1000) / (now - fpsSince)) }, now)
			frames = 0
			fpsSince = now
		}
		hud.flush(now)
	}
	frame = requestAnimationFrame(loop)

	return {
		hud,
		ready,
		stop() {
			stopped = true
			cancelAnimationFrame(frame)
			connection.close()
			controls.dispose()
			window.removeEventListener('resize', onResize)
			stage.dispose()
		}
	}
}
