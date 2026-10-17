import {
	abilityById,
	abilities as abilityDefs,
	buffs as buffDefs,
	classes as classDefs,
	type DifficultyId,
	difficultyDef,
	economy,
	gear,
	items,
	type MissionDef,
	maps,
	missionById,
	propsDef,
	weapons,
	zombies as zombieDefs
} from '@rotline/game-data'
import { INPUT_REDUNDANCY, KickReason, RangeAction, Writer, writePause, writeRange } from '@rotline/protocol'
import {
	activeWeapon,
	aimToAngle,
	angleToAim,
	Button,
	chainMultiplier,
	createProps,
	Grid,
	ObjectKind,
	type PlayerInput,
	type PlayerState,
	type Prop,
	PropState,
	quantiseAxis,
	REACH_STEP,
	REVIVE_COMPLETE,
	REVIVE_RANGE,
	Step,
	separateFromZombies,
	setPropState,
	TICK_RATE
} from '@rotline/sim'
import * as THREE from 'three'
import { AudioEngine, type AudioSettings, type LoopHandle } from './audio.ts'
import { Controls } from './controls.ts'
import { HudStore, type InteractAction, type MissionHud, type Toast } from './hud-store.ts'
import { Interpolator } from './interpolate.ts'
import { GameConnection } from './net.ts'
import { Predictor } from './predict.ts'
import { Effects } from './render/effects.ts'
import { MissionMarkers } from './render/mission.ts'
import { DamageNumbers, ObjectRenderer } from './render/objects.ts'
import { PlayerFigure } from './render/players.ts'
import { PropRenderer } from './render/props.ts'
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
	/** the map to draw: the mission's map, or 'range' for the firing range */
	map?: string
	/** floating damage numbers for your own hits (always on in the firing range) */
	damageNumbers?: boolean
}

export type GameHandle = {
	hud: HudStore
	/** resolves when the model is loaded and the first snapshot arrived */
	ready: Promise<void>
	/** firing range: spawn zombies of a type, or clear them */
	range(action: 'spawn' | 'clear', zombieType?: number, count?: number): void
	/** Sound volumes (kept in this browser). */
	audio: { get(): AudioSettings; set(settings: AudioSettings): void }
	/**
	 * The pause menu opened or closed. Alone in the room the game really pauses; with a squad it
	 * goes on, and the player simply stands still while the menu is open.
	 */
	menu(open: boolean): void
	stop(): void
}

const ABILITY_KEYS = ['F', 'C', 'V']
const UTILITY_KEYS = ['G', 'T']
/** The damage-per-second meter looks this far back. */
const DPS_WINDOW_MS = 3000
/** Toasts stay on screen this long. */
const TOAST_MS = 4000

/** Starts a mission client: connects, predicts, interpolates and draws until stopped. */
export function startGame(options: GameOptions): GameHandle {
	const hud = new HudStore()
	const map = (maps[options.map ?? 'yard'] ?? maps.yard) as NonNullable<typeof maps.yard>
	const grid = new Grid(map)
	// the map's props, kept in step with the server's (their blocking cells match its grid)
	const props = createProps(map, grid)
	const stage = new Stage(options.canvas, map)
	const effects = new Effects(stage.scene, options.gore ?? true)
	const objectRenderer = new ObjectRenderer(stage.scene)
	const propRenderer = new PropRenderer(stage.scene, props)
	const showNumbers = options.damageNumbers ?? options.map === 'range'
	const numbers = showNumbers ? new DamageNumbers(stage.scene) : null
	const ownHits: { at: number; amount: number }[] = []
	const barricades = new Map<number, number[]>()
	const rangeWriter = new Writer(16)
	const interpolator = new Interpolator()
	const controls = new Controls(options.canvas)
	const audio = new AudioEngine(`${options.assets}/audio`)
	// sound may only start after the player clicks or presses a key
	const unlock = () => audio.unlock()
	window.addEventListener('pointerdown', unlock)
	window.addEventListener('keydown', unlock)
	let lastReloadEnd = 0
	let lastEmptyAt = 0
	let lastHitSoundAt = 0
	let nextGrowlAt = 0
	/** A weapon's shot: its recorded sound, or a made-up one (flames, the launcher, lightning). */
	const shotSound = (weaponIndex: number, at?: { x: number; y: number }, minigun = false) => {
		const sound = weapons[weaponIndex]?.sound
		if (!sound) return
		audio.sound(sound.shot, {
			...(at ?? {}),
			rate: sound.rate * (minigun ? 1.15 : 1),
			volume: at ? 0.7 : 0.85
		})
		// the weight under it: heavier guns thump harder (only for recorded gunshots)
		if (sound.shot !== 'flame' && sound.shot !== 'zap' && sound.shot !== 'thump')
			audio.synth('body', { ...(at ?? {}), volume: Math.min(1, 0.35 + sound.recoil * 1.4) * (at ? 0.5 : 0.8) })
	}
	let lastPainAt = 0
	/** the soundscape: a bed for the place, the horde's murmur, and music that rises with the fight */
	type Loops = { bed: LoopHandle; horde: LoopHandle; calm: LoopHandle; fight: LoopHandle }
	let loops: Loops | null = null
	let nextMixAt = 0
	const startLoops = (mapId: string) => {
		if (loops) return
		const beds = ['ambience-dark', 'ambience-terror', 'ambience-wind']
		let hash = 0
		for (const char of mapId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
		loops = {
			bed: audio.loop(beds[hash % beds.length] as string, { bus: 'ambience', volume: 0.8, fadeIn: 4 }),
			horde: audio.loop('ambience-horde', { bus: 'ambience', volume: 0.1, fadeIn: 4 }),
			calm: audio.loop('music-calm', { bus: 'music', volume: 0.7, fadeIn: 6 }),
			fight: audio.loop('music-fight', { bus: 'music', volume: 0, fadeIn: 1 })
		}
	}
	/** How close the fight is: zombies near the player push the horde and the fight music up. */
	const mixLoops = (x: number, y: number, now: number) => {
		if (!loops || now < nextMixAt) return
		nextMixAt = now + 250
		const view = interpolator.view
		let near = 0
		for (let i = 0; i < view.count; i++)
			if (Math.hypot((view.x[i] as number) - x, (view.y[i] as number) - y) < 18) near++
		const fight = Math.min(1, near / 8)
		loops.horde.fade(0.1 + 0.6 * Math.min(1, near / 16), 1.5)
		loops.fight.fade(0.85 * fight, fight > 0 ? 1.2 : 4)
		loops.calm.fade(0.7 * (1 - 0.75 * fight), 3)
	}
	const raycaster = new THREE.Raycaster()
	const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
	const aimPoint = new THREE.Vector3()
	const pointer = new THREE.Vector2()
	const others = new Map<number, PlayerFigure>()
	/** each player's class and loadout (from the roster), and the weapon they last fired */
	const looks = new Map<number, { classIndex: number; weapons: readonly [number, number, number] }>()
	const lastFired = new Map<number, { weapon: number; at: number }>()
	const names = new Map<number, { name: string; connected: boolean }>()
	let mission: MissionDef | null = null
	let openedCaches = 0
	let rewardScale = 1
	let menuOpen = false
	let paused = false
	let markers: MissionMarkers | null = null
	let missionHud: MissionHud | null = null
	let toastId = 0
	let toasts: Toast[] = []
	const toast = (kind: Toast['kind'], text: string, by: string | null = null) => {
		const at = performance.now()
		toasts = [...toasts.filter(entry => at - entry.at < TOAST_MS), { id: ++toastId, kind, text, by, at }]
		hud.set({ toasts }, at, true)
	}
	const nameOf = (slot: number) => (slot === you ? null : (names.get(slot)?.name ?? `Player ${slot}`))

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
		welcome: (slot, _tick, map, build, missionId, difficulty) => {
			startLoops(map)
			you = slot
			predictor = new Predictor(grid, slot, build)
			// zombies are solid, as on the server (against where they are drawn)
			predictor.collide = state =>
				separateFromZombies(grid, state, interpolator.view.count, interpolator.view.x, interpolator.view.y, viewRadius)
			me?.dispose()
			me = new PlayerFigure(slot, true, options.assets)
			me.setClass(build.class)
			stage.scene.add(me.group)
			mission = missionById(missionId) ?? null
			rewardScale = difficultyDef(difficulty as DifficultyId)?.rewards ?? 1
			markers?.dispose()
			markers = mission ? new MissionMarkers(stage.scene, mission) : null
			if (mission) {
				missionHud = {
					id: mission.id,
					name: mission.name,
					difficulty: difficultyDef(difficulty as DifficultyId)?.name ?? difficulty,
					objective: 0,
					step: 1,
					count: mission.objectives.filter(objective => !objective.optional).length,
					label: mission.objectives[0]?.label ?? '',
					type: mission.objectives[0]?.type ?? 'kill',
					progress: 0,
					goal: 0,
					complete: false
				}
				hud.set({ mission: missionHud }, performance.now(), true)
			}
		},
		results: results =>
			hud.set(
				{ results: { ...results, items: results.items.map(index => items[index]?.name ?? '') } },
				performance.now(),
				true
			),
		roster: entries => {
			names.clear()
			for (const entry of entries) {
				names.set(entry.slot, { name: entry.name, connected: entry.connected })
				looks.set(entry.slot, { classIndex: entry.classIndex, weapons: entry.weapons })
			}
			// someone joined: the game no longer pauses for one player's menu
			if (paused && entries.length > 1) {
				paused = false
				accumulator = 0
				interpolator.resync()
			}
		},
		snapshot: (snapshot, table, receivedAt) => {
			interpolator.push(snapshot.tick, table, snapshot.others, snapshot.pools, receivedAt, snapshot.objects)
			syncBarricades(snapshot.objects)
			for (const update of snapshot.props) {
				const prop = props[update.index]
				if (!prop) continue
				prop.health = update.health * prop.maxHealth
				prop.progress = update.progress
				prop.powered = update.powered
				prop.readyTick = update.cooling ? Number.MAX_SAFE_INTEGER : 0
				prop.x = update.x
				prop.y = update.y
				if (prop.state !== update.state) setPropState(grid, prop, update.state)
			}
			predictor?.reconcile(snapshot.self, snapshot.lastSeq, snapshot.tick)
			hudDirty = true
			if (snapshot.rttMs > 0) pingMs = snapshot.rttMs
			const self = snapshot.self
			const progress = snapshot.mission
			if (mission && missionHud) {
				const objective = mission.objectives[progress.objective]
				const timed =
					objective?.type === 'hold' ||
					objective?.type === 'survive' ||
					objective?.type === 'defend' ||
					objective?.type === 'extract'
				const next: MissionHud = {
					...missionHud,
					objective: Math.min(progress.objective, mission.objectives.length - 1),
					step: mission.objectives.slice(0, progress.objective + 1).filter(objective => !objective.optional).length,
					label: objective?.label ?? missionHud.label,
					type: objective?.type ?? missionHud.type,
					// extraction counts down
					progress:
						objective?.type === 'extract'
							? Math.max(0, Math.ceil((progress.goal - progress.progress) / TICK_RATE))
							: timed
								? Math.floor(progress.progress / TICK_RATE)
								: progress.progress,
					goal: timed ? Math.round(progress.goal / TICK_RATE) : progress.goal,
					complete: progress.status === 2
				}
				if (
					next.objective !== missionHud.objective ||
					next.progress !== missionHud.progress ||
					next.goal !== missionHud.goal ||
					next.complete !== missionHud.complete
				)
					missionHud = next
				markers?.update(progress.objective, progress.status === 1, progress.caches, receivedAt / 1000)
				openedCaches = progress.caches
			}
			const running: { id: string; name: string; seconds: number }[] = []
			const buffName = (id: string) => buffDefs.buffs.find(buff => buff.id === id)?.name ?? id
			if (progress.doubleXpSeconds > 0)
				running.push({ id: 'double-xp', name: buffName('double-xp'), seconds: progress.doubleXpSeconds })
			if (progress.instakillSeconds > 0)
				running.push({ id: 'instakill', name: buffName('instakill'), seconds: progress.instakillSeconds })
			if (self.minigunSteps > 0)
				running.push({ id: 'minigun', name: buffName('minigun'), seconds: Math.ceil(self.minigunSteps / TICK_RATE) })
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
					mission: missionHud,
					chain: progress.chain,
					multiplier: chainMultiplier(progress.chain),
					chainLeft: progress.chainLeft,
					missionScore: progress.score,
					buffs: sameBuffs(hud.getSnapshot().buffs, running) ? hud.getSnapshot().buffs : running,
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
						// our own bullets and flames are already drawn (and heard) when predicted; lightning is drawn from here
						if (event.player === you && behaviour !== 'chain') break
						// sentries and turrets (player 0) sound like a light rifle
						if (event.player === 0) audio.sound('rifle', { x: event.x, y: event.y, rate: 1.3, volume: 0.45 })
						else if (event.player !== you) {
							shotSound(event.weapon, { x: event.x, y: event.y })
							others.get(event.player)?.fired()
							lastFired.set(event.player, { weapon: event.weapon, at: now * 1000 })
						}
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
						if (event.player !== you || event.weapon === 255)
							audio.synth('thump', { x: event.x, y: event.y, volume: 0.7 })
						effects.launch(event.id, event.x, event.y, event.angle, event.speed, now)
						if (event.player !== you) effects.muzzleFlash(event.x, event.y, event.angle, now)
						break
					case 'explode':
						effects.explode(event.id, event.x, event.y, event.radius, now)
						if (event.radius > 0) {
							audio.sound('explosion', { x: event.x, y: event.y, rate: 1.25 - Math.min(0.4, event.radius / 12) })
							audio.synth('body', { x: event.x, y: event.y, rate: 0.6 })
							const d = Math.hypot(event.x - drawn.x, event.y - drawn.y)
							if (d < 18) stage.shake(0.6 * (1 - d / 18))
						}
						break
					case 'hit':
						if (event.by === you) {
							ownHits.push({ at: performance.now(), amount: event.amount })
							numbers?.show(event.x, event.y, event.amount, now)
						}
						if (now - lastOwnShotAt < 0.3) {
							hud.set({ hitMarker: performance.now() }, performance.now(), true)
							if (event.by === you && now - lastHitSoundAt > 0.05) {
								lastHitSoundAt = now
								audio.synth('hit', { volume: 0.35, bus: 'interface' })
							}
						}
						if (Math.random() < 0.3) effects.splat(event.x, event.y, 0.35 + Math.random() * 0.3)
						// the wet smack of rounds landing, and now and then the zombie's pain
						if (now - lastPainAt > 0.12) {
							lastPainAt = now
							audio.sound('flesh', { x: event.x, y: event.y, volume: 0.45 })
							if (Math.random() < 0.25) audio.sound('zombie-pain', { x: event.x, y: event.y, volume: 0.55 })
						}
						break
					case 'kill':
						effects.splat(event.x, event.y, 0.8 + Math.random() * 0.6)
						{
							const scale = zombieDefs[event.zombieType]?.scale ?? 1
							if (Math.random() < 0.6)
								audio.sound('zombie-death', { x: event.x, y: event.y, rate: 0.95 / scale, volume: 0.65 })
							if (Math.random() < 0.5) audio.sound('bodyfall', { x: event.x, y: event.y, rate: 1 / scale, volume: 0.5 })
						}
						break
					case 'burst':
						effects.burst(event.x, event.y, event.radius, now, 0x9fe04a, true)
						audio.synth('thump', { x: event.x, y: event.y, rate: 0.6 })
						break
					case 'player-down':
						if (event.player === you) {
							hud.set({ status: 'down' }, performance.now(), true)
							audio.synth('thud', { volume: 0.9 })
						}
						break
					case 'player-hurt':
						if (event.player === you && event.amount >= 5) {
							audio.sound('zombie-bite', { volume: 0.7 })
							audio.synth('thud', { volume: 0.4, rate: 1.4 })
							stage.shake(Math.min(0.35, event.amount / 60))
						}
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
					case 'objective':
						hud.set(
							{ banner: { text: 'objective', wave: event.index + 1, at: performance.now() } },
							performance.now(),
							true
						)
						break
					case 'checkpoint':
						audio.synth('chime', { bus: 'interface', rate: 0.9 })
						hud.set(
							{ banner: { text: 'checkpoint', wave: event.index + 1, at: performance.now() } },
							performance.now(),
							true
						)
						break
					case 'failed':
						hud.set({ banner: { text: 'failed', wave: 0, at: performance.now() } }, performance.now(), true)
						audio.synth('alarm', { bus: 'interface' })
						break
					case 'run-over':
						hud.set({ banner: { text: 'run-over', wave: event.wave, at: performance.now() } }, performance.now(), true)
						break
					case 'mission-complete':
						hud.set({ banner: { text: 'complete', wave: 0, at: performance.now() } }, performance.now(), true)
						break
					case 'item-found':
						// drops are per player: only your own are shown
						if (event.player === you) {
							toast('item', items[event.item]?.name ?? '')
							audio.synth('chime', { bus: 'interface', rate: 1.2 })
						}
						break
					case 'prop': {
						const prop = props[event.index]
						if (!prop) break
						if (prop.def.kind === 'door') audio.synth('door', { x: prop.x, y: prop.y })
						else if (event.state === PropState.done && prop.def.kind === 'generator')
							audio.synth('power', { x: prop.x, y: prop.y })
						else if (prop.def.kind === 'trap' && event.state === PropState.active)
							audio.synth('zap', { x: prop.x, y: prop.y, rate: 0.6 })
						break
					}
					case 'buff': {
						const buff = buffDefs.buffs[event.buff]
						effects.burst(drawnX(event.player), drawnY(event.player), 3, now, 0xb8f23c)
						if (buff && (buff.team || event.player === you)) {
							toast('buff', buff.name, nameOf(event.player))
							audio.synth('pickup', { bus: 'interface' })
						}
						break
					}
					case 'threshold':
						if (event.player === you)
							toast('threshold', String(Math.floor(economy.score.thresholdSalvage * rewardScale)))
						break
				}
			}
		},
		kicked: reason =>
			hud.set(
				{
					status: reason === KickReason.complete ? 'over' : reason === KickReason.elsewhere ? 'elsewhere' : 'kicked',
					kickReason: reason
				},
				performance.now(),
				true
			),
		closed: () => hud.set({ status: 'disconnected' }, performance.now(), true),
		outdated: () => hud.set({ status: 'outdated' }, performance.now(), true)
	})

	/** A drawn zombie's body radius. */
	function viewRadius(index: number): number {
		return zombieDefs[interpolator.view.type[index] as number]?.radius ?? 0.4
	}

	/** How far a shot goes before the zombie that stops it (`pierce` more pass through), or `limit`. */
	function firstZombie(x: number, y: number, angle: number, limit: number, pierce: number): number {
		const dx = Math.cos(angle)
		const dy = Math.sin(angle)
		const view = interpolator.view
		const hits: number[] = []
		for (let i = 0; i < view.count; i++) {
			const qx = (view.x[i] as number) - x
			const qy = (view.y[i] as number) - y
			const along = qx * dx + qy * dy
			if (along < 0 || along > limit) continue
			const px = qx - dx * along
			const py = qy - dy * along
			const r = viewRadius(i)
			if (px * px + py * py < r * r) hits.push(along)
		}
		if (hits.length <= pierce) return limit
		hits.sort((a, b) => a - b)
		return hits[pierce] as number
	}

	/** Where a player is drawn (for effects at their feet). */
	function drawnX(slot: number): number {
		return slot === you ? drawn.x : (interpolator.others.find(other => other.id === slot)?.x ?? drawn.x)
	}
	function drawnY(slot: number): number {
		return slot === you ? drawn.y : (interpolator.others.find(other => other.id === slot)?.y ?? drawn.y)
	}

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
				dps: dps(now),
				interactHint: interactHint(state)
			},
			now
		)
	}

	/** Objective props that may be worked now: the current objective's and the optional ones'. */
	let workableKey = -1
	let workable: Set<string> | null = null
	function workableIds(): Set<string> | null {
		if (!mission || !missionHud) return null
		if (workableKey === missionHud.objective) return workable
		workableKey = missionHud.objective
		const ids = new Set<string>()
		const add = (objective: MissionDef['objectives'][number] | undefined) => {
			if (!objective) return
			if (objective.type === 'interact') for (const id of objective.props) ids.add(id)
			if (objective.type === 'rescue') for (const id of objective.survivors) ids.add(id)
			if (objective.type === 'retrieve') ids.add(objective.item)
		}
		add(mission.objectives[missionHud.objective])
		for (const objective of mission.objectives) if (objective.optional) add(objective)
		workable = ids
		return ids
	}

	/** What interact would do where the player stands (the same rules the server applies). */
	let lastHint: { action: InteractAction; progress: number } | null = null
	function interactHint(state: PlayerState): { action: InteractAction; progress: number } | null {
		let best: { action: InteractAction; progress: number } | null = null
		if (state.alive && !state.downed) {
			let nearest = propsDef.interactRange
			const workable = workableIds()
			for (const prop of props) {
				const action = propAction(prop, state.carrying, predictorTick, workable)
				if (!action) continue
				const d = propReach(prop, state)
				if (d > nearest || !propInSight(grid, prop, state)) continue
				nearest = d
				best = { action, progress: prop.progress }
			}
			if (!best && mission) {
				for (const [index, cache] of mission.caches.entries()) {
					if (openedCaches & (1 << index)) continue
					if (Math.hypot(cache.x - state.x, cache.y - state.y) <= economy.drops.cacheRange)
						best = { action: 'cache', progress: 0 }
				}
			}
		}
		// the same hint object while nothing changed, so the HUD does not re-render
		if (best && lastHint && best.action === lastHint.action && Math.abs(best.progress - lastHint.progress) < 0.02)
			return lastHint
		if (!best && !lastHint) return null
		lastHint = best
		return best
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

		// fixed-rate input and prediction, independent of the display rate (stopped while paused)
		if (predictor && !paused) {
			accumulator += dt * 1000
			while (accumulator >= TICK_MS) {
				accumulator -= TICK_MS
				const input = sampleInput(renderTick)
				// behind the menu in a squad the player stands still (aim kept)
				if (menuOpen) {
					input.moveX = 0
					input.moveY = 0
					input.buttons = 0
					input.aim = predictor.state.aim
					input.reach = 0
				}
				const result = predictor.apply(input)
				hudDirty = true
				predictorTick = predictor.tick
				if (result & Step.fired) {
					const angle = aimToAngle(predictor.state.aim)
					const held = activeWeapon(predictor.state, (result & Step.minigun) !== 0)
					const { x, y } = predictor.state
					// where the drawn shot ends, and whether a wall (not a zombie) stopped it
					let stop = 0
					let wallHit = false
					if (held.behaviour.type === 'cone') {
						const half = (held.behaviour.angleDegrees * Math.PI) / 360
						effects.flame(x, y, angle, held.range, half, held.damageType === 'chemical', now / 1000)
					} else if (held.behaviour.type !== 'projectile') {
						// the shot stops at the first zombie (more with piercing), else at the wall
						const wall = grid.rayToWall(x, y, Math.cos(angle), Math.sin(angle), held.range)
						const pierce =
							(held.behaviour.type === 'hitscan' ? held.behaviour.pierce : 0) +
							((result & Step.piercing) !== 0 ? (abilityById.get('overwatch')?.params.pierce ?? 0) : 0)
						stop = firstZombie(x, y, angle, wall, pierce)
						wallHit = stop === wall && wall < held.range - 0.05
						effects.tracer(x, y, angle, stop, now / 1000, 1.05, held.behaviour.type === 'chain' ? 0x7fd8ff : 0xffe2a0)
					}
					effects.muzzleFlash(x, y, angle, now / 1000)
					me?.fired()
					lastOwnShotAt = now / 1000
					shotSound(held.index, undefined, (result & Step.minigun) !== 0)
					// the feel of it: the camera kicks back, a case flies out, sparks where it hits a wall
					stage.kick(Math.cos(angle), Math.sin(angle), weapons[held.index]?.sound.recoil ?? 0.1)
					if (held.behaviour.type === 'hitscan') {
						effects.casing(x, y, angle, now / 1000)
						if (wallHit) effects.impact(x + Math.cos(angle) * stop, y + Math.sin(angle) * stop, now / 1000)
					}
				}
				// a reload starting, or the dry click of an empty magazine
				const own = predictor.state
				if (own.reloadEndTick !== 0 && lastReloadEnd === 0) {
					const sound = weapons[activeWeapon(own).index]?.sound
					if (sound) audio.sound(sound.reload, { volume: 0.8 })
					me?.reloading((own.reloadEndTick - predictor.tick) / TICK_RATE)
				}
				lastReloadEnd = own.reloadEndTick
				if (input.buttons & Button.fire && own.weapons[own.slot as 0 | 1 | 2].mag === 0 && own.reloadEndTick === 0) {
					if (now - lastEmptyAt > 350) {
						lastEmptyAt = now
						audio.synth('empty', { volume: 0.6 })
					}
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
			audio.setListener(drawn.x, drawn.y)
			mixLoops(drawn.x, drawn.y, now)
			const own = predictor.state
			const held = weapons[activeWeapon(own, own.minigunSteps > 0).index]
			if (held) me.setWeapon(held.id, held.kind === 'pistol')
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
			// now and then one of the zombies nearby makes itself heard
			if (now >= nextGrowlAt && interpolator.view.count > 0) {
				nextGrowlAt = now + 900 + Math.random() * 1600
				const view = interpolator.view
				const pick = Math.floor(Math.random() * view.count)
				const zx = view.x[pick] as number
				const zy = view.y[pick] as number
				if (Math.hypot(zx - drawn.x, zy - drawn.y) < 25) {
					const def = zombieDefs[view.type[pick] as number]
					audio.sound(def && def.speed > 3 ? 'zombie-fast' : 'zombie', {
						x: zx,
						y: zy,
						rate: 1 / (def?.scale ?? 1),
						volume: 0.5
					})
				}
			}
			effects.setPools(interpolator.pools)
			objectRenderer.update(interpolator.objects, now / 1000)
			propRenderer.update(props, now / 1000, dt)
			for (const other of interpolator.others) {
				let figure = others.get(other.id)
				if (!figure) {
					figure = new PlayerFigure(other.id, false, options.assets)
					others.set(other.id, figure)
					stage.scene.add(figure.group)
				}
				// dressed as their class, holding the weapon of their slot (or the one they just fired)
				const look = looks.get(other.id)
				if (look) {
					figure.setClass(classDefs.classes[look.classIndex]?.id ?? 'assault')
					const fired = lastFired.get(other.id)
					const index = fired && now - fired.at < 1500 ? fired.weapon : look.weapons[other.slot as 0 | 1 | 2]
					const held = index === undefined ? undefined : weapons[index]
					if (held) figure.setWeapon(held.id, held.kind === 'pistol')
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
		menu(open) {
			if (open === menuOpen) return
			menuOpen = open
			// alone in the room: really pause (the server stops it too)
			const alone = [...names.values()].length <= 1
			if (open && alone) {
				paused = true
				connection.send(writePause(rangeWriter, true))
			}
			if (!open && paused) {
				paused = false
				connection.send(writePause(rangeWriter, false))
				accumulator = 0
				last = performance.now()
				interpolator.resync()
			}
		},
		audio: {
			get: () => audio.getSettings(),
			set: (settings: AudioSettings) => audio.setSettings(settings)
		},
		stop() {
			audio.dispose()
			window.removeEventListener('pointerdown', unlock)
			window.removeEventListener('keydown', unlock)
			stopped = true
			cancelAnimationFrame(frame)
			connection.close()
			controls.dispose()
			window.removeEventListener('resize', onResize)
			markers?.dispose()
			propRenderer.dispose()
			stage.dispose()
		}
	}
}

function sameBuffs(
	a: readonly { id: string; seconds: number }[],
	b: readonly { id: string; seconds: number }[]
): boolean {
	return (
		a.length === b.length && a.every((buff, index) => buff.id === b[index]?.id && buff.seconds === b[index]?.seconds)
	)
}

/** What interact does to a prop right now, or null if nothing (mirrors the server's rules). */
function propAction(prop: Prop, carrying: boolean, tick: number, workable: Set<string> | null): InteractAction | null {
	const allowed = workable === null || workable.has(prop.def.id)
	switch (prop.def.kind) {
		case 'door':
			if (prop.state === PropState.welded) return prop.health < prop.maxHealth ? 'repair' : null
			if (prop.state === PropState.open) return 'close'
			if (prop.state === PropState.closed) return prop.progress > 0 ? 'weld' : 'open'
			return null
		case 'generator':
			return allowed && prop.state === PropState.idle ? 'power' : null
		case 'terminal':
			return allowed && prop.state === PropState.idle ? 'hack' : null
		case 'trap':
			return prop.state === PropState.idle && tick >= prop.readyTick ? 'trap' : null
		case 'survivor':
			return allowed && prop.state === PropState.idle ? 'free' : null
		case 'carry':
			return allowed && prop.state === PropState.idle && !carrying ? 'pickup' : null
		case 'defend':
			return prop.state !== PropState.destroyed && prop.health < prop.maxHealth ? 'repair' : null
		default:
			return null
	}
}

/** Nothing in between the player and the prop (the server's rule: no working through walls). */
function propInSight(grid: Grid, prop: Prop, player: { x: number; y: number }): boolean {
	const halfW = prop.cells.length > 0 ? (prop.def.w ?? 1) / 2 : 0
	const halfH = prop.cells.length > 0 ? (prop.def.h ?? 1) / 2 : 0
	const tx = Math.max(prop.x - halfW, Math.min(prop.x + halfW, player.x))
	const ty = Math.max(prop.y - halfH, Math.min(prop.y + halfH, player.y))
	const d = Math.hypot(tx - player.x, ty - player.y)
	if (d < 0.05) return true
	const length = Math.max(0, d - 0.1)
	return grid.rayToWall(player.x, player.y, (tx - player.x) / d, (ty - player.y) / d, length) >= length - 1e-6
}

function propReach(prop: Prop, player: { x: number; y: number }): number {
	const halfW = prop.cells.length > 0 ? (prop.def.w ?? 1) / 2 : 0
	const halfH = prop.cells.length > 0 ? (prop.def.h ?? 1) / 2 : 0
	return Math.hypot(Math.max(0, Math.abs(player.x - prop.x) - halfW), Math.max(0, Math.abs(player.y - prop.y) - halfH))
}
