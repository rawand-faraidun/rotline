import { abilityById, abilities as abilityDefs, gear, maps, weapons } from '@rotline/game-data'
import { INPUT_REDUNDANCY, RangeAction, Writer, writeRange } from '@rotline/protocol'
import {
	activeWeapon,
	aimToAngle,
	angleToAim,
	Grid,
	ObjectKind,
	type PlayerInput,
	quantiseAxis,
	REACH_STEP,
	REVIVE_COMPLETE,
	REVIVE_RANGE,
	Step,
	TICK_RATE
} from '@rotline/sim'
import * as THREE from 'three'
import { Controls } from './controls.ts'
import { HudStore } from './hud-store.ts'
import { Interpolator } from './interpolate.ts'
import { GameConnection } from './net.ts'
import { Predictor } from './predict.ts'
import { Effects } from './render/effects.ts'
import { DamageNumbers, ObjectRenderer } from './render/objects.ts'
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
	/** 'yard' for missions, 'range' for the firing range */
	map?: 'yard' | 'range'
	/** floating damage numbers for your own hits (always on in the firing range) */
	damageNumbers?: boolean
}

export type GameHandle = {
	hud: HudStore
	/** resolves when the model is loaded and the first snapshot arrived */
	ready: Promise<void>
	/** firing range: spawn zombies of a type, or clear them */
	range(action: 'spawn' | 'clear', zombieType?: number, count?: number): void
	stop(): void
}

const ABILITY_KEYS = ['F', 'C', 'V']
const UTILITY_KEYS = ['G', 'T']
/** The damage-per-second meter looks this far back. */
const DPS_WINDOW_MS = 3000

/** Starts a mission client: connects, predicts, interpolates and draws until stopped. */
export function startGame(options: GameOptions): GameHandle {
	const hud = new HudStore()
	const map = (options.map === 'range' ? maps.range : maps.yard) as NonNullable<typeof maps.yard>
	const grid = new Grid(map)
	const stage = new Stage(options.canvas, map)
	const effects = new Effects(stage.scene, options.gore ?? true)
	const objectRenderer = new ObjectRenderer(stage.scene)
	const showNumbers = options.damageNumbers ?? options.map === 'range'
	const numbers = showNumbers ? new DamageNumbers(stage.scene) : null
	const ownHits: { at: number; amount: number }[] = []
	const barricades = new Map<number, number[]>()
	const rangeWriter = new Writer(16)
	const interpolator = new Interpolator()
	const controls = new Controls(options.canvas)
	const raycaster = new THREE.Raycaster()
	const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
	const aimPoint = new THREE.Vector3()
	const pointer = new THREE.Vector2()
	const others = new Map<number, PlayerFigure>()
	const names = new Map<number, { name: string; connected: boolean }>()

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
	let predictorTick = 0
	/** the weapons and abilities HUD is rebuilt only after a tick or a snapshot, not every frame */
	let hudDirty = true
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
		welcome: (slot, _tick, _map, build) => {
			you = slot
			predictor = new Predictor(grid, slot, build)
			me = new PlayerFigure(slot, true)
			stage.scene.add(me.group)
		},
		roster: entries => {
			names.clear()
			for (const entry of entries) names.set(entry.slot, { name: entry.name, connected: entry.connected })
		},
		snapshot: (snapshot, table, receivedAt) => {
			interpolator.push(snapshot.tick, table, snapshot.others, snapshot.pools, receivedAt, snapshot.objects)
			syncBarricades(snapshot.objects)
			predictor?.reconcile(snapshot.self, snapshot.lastSeq, snapshot.tick)
			hudDirty = true
			if (snapshot.rttMs > 0) pingMs = snapshot.rttMs
			const self = snapshot.self
			const teammates = snapshot.others.map(other => ({
				slot: other.id,
				name: names.get(other.id)?.name ?? `Player ${other.id}`,
				health: Math.round(other.healthPercent * 100),
				downed: other.downed,
				out: !other.alive,
				bleedoutSeconds: other.bleedoutSeconds,
				revive: other.revive,
				connected: names.get(other.id)?.connected ?? true
			}))
			const near = snapshot.others.find(
				other =>
					other.downed &&
					self.alive &&
					!self.downed &&
					Math.hypot(other.x - self.x, other.y - self.y) <= REVIVE_RANGE + 0.3
			)
			hud.set(
				{
					status: self.downed ? 'down' : self.alive ? 'playing' : 'out',
					bleedoutSeconds: self.downed ? Math.max(0, Math.ceil((self.bleedoutTick - snapshot.tick) / TICK_RATE)) : 0,
					beingRevived: self.downed ? self.reviveProgress / REVIVE_COMPLETE : 0,
					reviveHint: near ? (names.get(near.id)?.name ?? `Player ${near.id}`) : null,
					teammates,
					health: Math.ceil(self.health),
					wave: snapshot.wave + 1,
					kills: snapshot.kills,
					score: snapshot.score,
					respawnSeconds:
						self.alive || self.respawnTick > snapshot.tick + 3600 * TICK_RATE
							? 0
							: Math.max(0, Math.ceil((self.respawnTick - snapshot.tick) / TICK_RATE)),
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
					case 'shot': {
						const weapon = weapons[event.weapon]
						const behaviour = weapon?.behaviour.type ?? 'hitscan'
						// our own bullets and flames are already drawn when predicted; lightning is drawn from here
						if (event.player === you && behaviour !== 'chain') break
						if (behaviour === 'cone') {
							effects.flame(event.x, event.y, event.angle, event.length, 0.3, weapon?.damageType === 'chemical', now)
						} else {
							effects.tracer(
								event.x,
								event.y,
								event.angle,
								event.length,
								now,
								1.05,
								behaviour === 'chain' ? 0x7fd8ff : 0xffe2a0
							)
							if (behaviour !== 'chain' || event.player !== you) effects.muzzleFlash(event.x, event.y, event.angle, now)
						}
						break
					}
					case 'launch':
						effects.launch(event.id, event.x, event.y, event.angle, event.speed, now)
						if (event.player !== you) effects.muzzleFlash(event.x, event.y, event.angle, now)
						break
					case 'explode':
						effects.explode(event.id, event.x, event.y, event.radius, now)
						break
					case 'hit':
						if (event.by === you) {
							ownHits.push({ at: performance.now(), amount: event.amount })
							numbers?.show(event.x, event.y, event.amount, now)
						}
						if (now - lastOwnShotAt < 0.3) hud.set({ hitMarker: performance.now() }, performance.now(), true)
						if (Math.random() < 0.3) effects.splat(event.x, event.y, 0.35 + Math.random() * 0.3)
						break
					case 'kill':
						effects.splat(event.x, event.y, 0.8 + Math.random() * 0.6)
						break
					case 'burst':
						effects.burst(event.x, event.y, event.radius, now, 0x9fe04a, true)
						break
					case 'player-down':
						if (event.player === you) hud.set({ status: 'down' }, performance.now(), true)
						break
					case 'ability': {
						const id = abilityDefs[event.ability]?.id ?? ''
						const colour = /medkit|healing|stim|antidote|defib/.test(id)
							? 0x7cf27c
							: /shock|pulse/.test(id)
								? 0x6fb8ff
								: /taunt|mark/.test(id)
									? 0xff3a2a
									: 0xffc02e
						effects.burst(event.x, event.y, 2.5, now, colour)
						break
					}
					case 'wave':
						hud.set({ banner: { text: 'wave', wave: event.wave, at: performance.now() } }, performance.now(), true)
						break
					case 'wipe':
						hud.set({ banner: { text: 'wipe', wave: event.wave, at: performance.now() } }, performance.now(), true)
						break
				}
			}
		},
		kicked: reason => hud.set({ status: 'kicked', kickReason: reason }, performance.now(), true),
		closed: () => hud.set({ status: 'disconnected' }, performance.now(), true)
	})

	/** Barricades are walls: the client's grid must match the server's or prediction slides through them. */
	function syncBarricades(objects: readonly { id: number; kind: number; cells: number[] }[]) {
		const live = new Set<number>()
		for (const object of objects) {
			if (object.kind !== ObjectKind.barricade) continue
			live.add(object.id)
			if (barricades.has(object.id)) continue
			// exactly the server's cells, so prediction stops where the server does
			const cells = object.cells.filter(cell => grid.walls[cell] === 0)
			for (const cell of cells) grid.walls[cell] = 2
			barricades.set(object.id, cells)
		}
		for (const [id, cells] of barricades) {
			if (live.has(id)) continue
			for (const cell of cells) if (grid.walls[cell] === 2) grid.walls[cell] = 0
			barricades.delete(id)
		}
	}

	const onResize = () => stage.resize()
	window.addEventListener('resize', onResize)

	function sampleInput(renderTick: number): PlayerInput {
		const move = controls.movement()
		const length = Math.hypot(move.x, move.y) || 1
		let aim = predictor?.state.aim ?? 0
		let reach = 0
		if (controls.pointer.inside && predictor) {
			pointer.set(controls.pointer.x, controls.pointer.y)
			raycaster.setFromCamera(pointer, stage.camera)
			if (raycaster.ray.intersectPlane(groundPlane, aimPoint)) {
				const dx = aimPoint.x - predictor.state.x
				const dy = aimPoint.z - predictor.state.y
				aim = angleToAim(Math.atan2(dy, dx))
				reach = Math.min(255, Math.hypot(dx, dy) / REACH_STEP)
			}
		}
		seq++
		return {
			seq,
			moveX: quantiseAxis(move.x / length),
			moveY: quantiseAxis(move.y / length),
			aim,
			buttons: controls.buttons(),
			viewTick: Math.max(0, Math.floor(renderTick)),
			reach: Math.round(reach)
		}
	}

	function updateWeaponsHud(now: number): void {
		const state = predictor?.state
		if (!state) return
		hud.set(
			{
				weapons: state.weapons.map((held, slot) => {
					const stats = state.stats.weapons[slot as 0 | 1 | 2]
					return {
						name: stats.name,
						mag: held.mag,
						magazine: stats.magazine,
						reserve: held.reserve < 0 ? null : held.reserve,
						active: slot === state.slot
					}
				}),
				reloading: state.reloadEndTick !== 0 ? state.reloadEndTick : null,
				abilities: state.stats.abilities.map((id, slot) => {
					const def = abilityById.get(id)
					const left = Math.max(0, (state.abilityReady[slot as 0 | 1 | 2] - tickNow()) / TICK_RATE)
					return {
						name: def?.name ?? id,
						key: ABILITY_KEYS[slot] ?? '',
						seconds: Math.ceil(left),
						cooldown: (def?.cooldownSeconds ?? 1) * state.stats.abilityCooldown
					}
				}),
				utilities: state.stats.utilities.flatMap((utility, slot) =>
					utility
						? [
								{
									name: gear.utility.find(entry => entry.id === utility.id)?.name ?? utility.id,
									key: UTILITY_KEYS[slot] ?? '',
									charges: state.free ? null : state.utilityCharges[slot as 0 | 1]
								}
							]
						: []
				),
				dps: dps(now)
			},
			now
		)
	}

	/** The predicted tick: what cooldowns are measured against. */
	function tickNow(): number {
		return predictorTick
	}

	function dps(now: number): number {
		while (ownHits.length > 0 && now - (ownHits[0]?.at ?? now) > DPS_WINDOW_MS) ownHits.shift()
		const total = ownHits.reduce((sum, hit) => sum + hit.amount, 0)
		return Math.round(total / (DPS_WINDOW_MS / 1000))
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
				const result = predictor.apply(input)
				hudDirty = true
				predictorTick = predictor.tick
				if (result & Step.fired) {
					const angle = aimToAngle(predictor.state.aim)
					const held = activeWeapon(predictor.state, (result & Step.minigun) !== 0)
					const { x, y } = predictor.state
					if (held.behaviour.type === 'cone') {
						const half = (held.behaviour.angleDegrees * Math.PI) / 360
						effects.flame(x, y, angle, held.range, half, held.damageType === 'chemical', now / 1000)
					} else if (held.behaviour.type !== 'projectile') {
						const reach = grid.rayToWall(x, y, Math.cos(angle), Math.sin(angle), held.range)
						effects.tracer(x, y, angle, reach, now / 1000, 1.05, held.behaviour.type === 'chain' ? 0x7fd8ff : 0xffe2a0)
					}
					effects.muzzleFlash(x, y, angle, now / 1000)
					lastOwnShotAt = now / 1000
				}
				recent.push(input)
				if (recent.length > INPUT_REDUNDANCY) recent.shift()
				connection.sendInputs(recent)
			}
			if (hudDirty) {
				updateWeaponsHud(now)
				hudDirty = false
			}
		}

		// draw
		if (predictor && me) {
			predictor.renderPosition(accumulator / TICK_MS, dt, drawn)
			const own = predictor.state
			me.set(drawn.x, drawn.y, aimToAngle(own.aim), own.alive, own.downed, own.reviveProgress / REVIVE_COMPLETE)
			const aimAngle = aimToAngle(predictor.state.aim)
			const aimX = controls.pointer.inside ? aimPoint.x : drawn.x + Math.cos(aimAngle) * 8
			const aimY = controls.pointer.inside ? aimPoint.z : drawn.y + Math.sin(aimAngle) * 8
			// while out of the fight, watch a teammate who is still in it
			const watched = own.alive ? null : interpolator.others.find(other => other.alive)
			if (watched) stage.follow(watched.x, watched.y, watched.x, watched.y, dt)
			else stage.follow(drawn.x, drawn.y, aimX, aimY, dt)
		}
		if (interpolator.sample(renderTick)) {
			zombies?.update(interpolator.view, now / 1000)
			effects.setPools(interpolator.pools)
			objectRenderer.update(interpolator.objects, now / 1000)
			for (const other of interpolator.others) {
				let figure = others.get(other.id)
				if (!figure) {
					figure = new PlayerFigure(other.id, false)
					others.set(other.id, figure)
					stage.scene.add(figure.group)
				}
				figure.set(other.x, other.y, aimToAngle(other.aim), other.alive, other.downed, other.revive)
			}
		}
		effects.update(now / 1000)
		numbers?.update(now / 1000)
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
		range(action, zombieType = 0, count = 1) {
			connection.send(
				writeRange(rangeWriter, action === 'spawn' ? RangeAction.spawn : RangeAction.clear, zombieType, count)
			)
		},
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
