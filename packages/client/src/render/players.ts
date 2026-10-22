import * as THREE from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { findArm, holdGun, type Rig } from './hold.ts'
import { outfitFor, wear } from './outfits.ts'

const SLOT_COLOURS = [0xb8f23c, 0x4fb3ff, 0xffc02e, 0xff7ad9]

/** bones the legs' clips drive; the rest (spine, arms, head) follows the gun */
const LOWER = /^(root|pelvis|thigh_|calf_|foot_|ball_)/
/** how fast the walk and jog clips move the feet, in metres per second */
const WALK_SPEED = 1.5
const JOG_SPEED = 3.6

type Clips = {
	lower: Map<string, THREE.AnimationClip>
	upper: Map<string, THREE.AnimationClip>
	full: Map<string, THREE.AnimationClip>
}
export type Soldier = { scene: THREE.Object3D; clips: Clips }

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
let soldier: Promise<Soldier | null> | null = null
const weaponModels = new Map<string, Promise<THREE.Object3D | null>>()

/** The soldier model with all three classes and its animations, loaded once. */
export function loadSoldier(url: string): Promise<Soldier | null> {
	soldier ??= loader
		.loadAsync(url)
		.then(gltf => {
			const split = (keep: (bone: string) => boolean) =>
				new Map(
					gltf.animations.map(clip => [
						clip.name,
						new THREE.AnimationClip(
							clip.name,
							clip.duration,
							clip.tracks.filter(track => keep(track.name.split('.')[0] ?? ''))
						)
					])
				)
			const clips: Clips = {
				lower: split(bone => LOWER.test(bone)),
				upper: split(bone => !LOWER.test(bone)),
				full: new Map(gltf.animations.map(clip => [clip.name, clip]))
			}
			gltf.scene.traverse(object => {
				if ((object as THREE.Mesh).isMesh) object.castShadow = true
			})
			return { scene: gltf.scene, clips }
		})
		.catch(() => null)
	return soldier
}

function loadWeapon(url: string): Promise<THREE.Object3D | null> {
	let model = weaponModels.get(url)
	if (!model) {
		model = loader
			.loadAsync(url)
			.then(gltf => {
				gltf.scene.traverse(object => {
					if ((object as THREE.Mesh).isMesh) object.castShadow = true
				})
				return gltf.scene as THREE.Object3D
			})
			.catch(() => null)
		weaponModels.set(url, model)
	}
	return model
}

/**
 * A player: their class's soldier with the gun they hold, walking and aiming, and a coloured ring
 * per player slot. A plain stand-in is drawn until the models arrive (or if they cannot load).
 */
export class PlayerFigure {
	readonly group = new THREE.Group()
	private readonly placeholder = new THREE.Group()
	private readonly gun: THREE.Mesh
	private readonly ring: THREE.Mesh
	private readonly colour: number
	private readonly reviveArc: THREE.Mesh
	private reviveSteps = 0
	private readonly assets: string
	private look = ''
	private model: THREE.Object3D | null = null
	private mixer: THREE.AnimationMixer | null = null
	private clips: Clips | null = null
	private legs: THREE.AnimationAction | null = null
	private arms: THREE.AnimationAction | null = null
	private pose: THREE.AnimationAction | null = null
	private legsClip = ''
	private armsClip = ''
	private armsUntil = 0
	private weapon: THREE.Object3D | null = null
	private weaponId = ''
	private weaponLength = 0
	/** long guns are held at the shoulder in both hands; pistols out in front in both hands */
	private longGun = false
	private hand: THREE.Object3D | null = null
	private rig: Rig | null = null
	/** 1 just after a shot, decaying; the current reload's time left and length (seconds, counted by frames) */
	private kick = 0
	private reloadLeft = 0
	private reloadTotal = 1
	private lastX = Number.NaN
	private lastY = 0
	private speed = 0
	private moveX = 0
	private moveY = 1
	private legsYaw = 0
	private spine: THREE.Object3D[] = []
	private last = performance.now()
	/** standing at ease (the lobby): no aiming, no gun in hand */
	private relaxed = false

	constructor(slot: number, isSelf: boolean, assets = '/assets') {
		this.assets = assets
		const colour = SLOT_COLOURS[(slot - 1) % SLOT_COLOURS.length] ?? 0xffffff
		this.colour = colour
		const body = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.34, 0.9, 4, 10),
			new THREE.MeshStandardMaterial({ color: 0x3b4a3c, roughness: 0.7 })
		)
		body.position.y = 0.8
		body.castShadow = true
		const head = new THREE.Mesh(
			new THREE.SphereGeometry(0.2, 12, 10),
			new THREE.MeshStandardMaterial({ color: 0x2a3329 })
		)
		head.position.y = 1.55
		head.castShadow = true
		this.gun = new THREE.Mesh(
			new THREE.BoxGeometry(0.12, 0.12, 0.8),
			new THREE.MeshStandardMaterial({ color: 0x15191a })
		)
		this.gun.position.set(0.22, 1.05, 0.45)
		this.gun.castShadow = true
		this.placeholder.add(body, head, this.gun)
		this.ring = new THREE.Mesh(
			new THREE.RingGeometry(0.5, isSelf ? 0.62 : 0.58, 32),
			new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: isSelf ? 0.9 : 0.7 })
		)
		this.ring.rotation.x = -Math.PI / 2
		this.ring.position.y = 0.03
		this.reviveArc = new THREE.Mesh(
			new THREE.RingGeometry(0.72, 0.86, 32, 1, 0, 0),
			new THREE.MeshBasicMaterial({ color: 0xb8f23c, transparent: true, opacity: 0.95, depthWrite: false })
		)
		this.reviveArc.rotation.x = -Math.PI / 2
		this.reviveArc.position.y = 0.05
		this.reviveArc.visible = false
		this.group.add(this.placeholder, this.ring, this.reviveArc)
	}

	/**
	 * Dresses the figure as a class (`assault`, `medic`, `heavy`, `survivor`) wearing these armour items
	 * (head, torso, vest, legs, feet; omitted: the class's usual kit). The model loads the first time.
	 */
	setClass(classId: string, armour?: readonly (string | null)[]): void {
		const look = `${classId}:${armour?.join(',') ?? ''}`
		if (look === this.look) return
		this.look = look
		void loadSoldier(`${this.assets}/models/characters/soldier.glb`).then(loaded => {
			if (!loaded || this.look !== look) return
			if (this.model) {
				// same soldier, new clothes: no need to rebuild the animation
				wear(this.model, outfitFor(classId, armour))
				return
			}
			const model = cloneSkinned(loaded.scene)
			wear(model, outfitFor(classId, armour))
			this.model = model
			this.clips = loaded.clips
			this.hand = model.getObjectByName('hand_r') ?? null
			this.spine = ['spine_01', 'spine_02', 'spine_03']
				.map(name => model.getObjectByName(name))
				.filter((bone): bone is THREE.Object3D => bone !== undefined)
			const rightArm = findArm(model, 'r')
			const leftArm = findArm(model, 'l')
			this.rig =
				rightArm && leftArm
					? { spine: this.spine, head: model.getObjectByName('Head') ?? null, right: rightArm, left: leftArm }
					: null
			this.mixer = new THREE.AnimationMixer(model)
			this.legs = this.arms = this.pose = null
			this.legsClip = this.armsClip = ''
			this.group.add(model)
			this.placeholder.visible = false
		})
	}

	/** Puts a weapon in the figure's hands (a weapon id; its model loads the first time). */
	setWeapon(weaponId: string, pistol: boolean): void {
		if (weaponId === this.weaponId) return
		this.weaponId = weaponId
		void loadWeapon(`${this.assets}/models/weapons/${weaponId}.glb`).then(loaded => {
			if (!loaded || this.weaponId !== weaponId) return
			this.weapon?.removeFromParent()
			const weapon = loaded.clone()
			const box = new THREE.Box3().setFromObject(weapon)
			this.weaponLength = box.max.x - box.min.x
			this.longGun = !pistol
			this.weapon = weapon
			this.group.add(weapon)
		})
	}

	/** At ease: stands with arms down and the gun put away (for the lobby), or back to the fight. */
	setRelaxed(relaxed: boolean): void {
		this.relaxed = relaxed
	}

	/** The weapon just fired: a short recoil in the arms. */
	fired(): void {
		this.kick = 1
	}

	/** A reload began and lasts `seconds`. */
	reloading(seconds: number): void {
		this.reloadTotal = Math.max(0.1, seconds)
		this.reloadLeft = this.reloadTotal
	}

	/** `revive` is 0..1 progress while a teammate revives this player. */
	set(
		x: number,
		y: number,
		aimAngle: number,
		alive: boolean,
		downed: boolean,
		revive = 0,
		/** the game's clock (ms); it stands still while the game is paused, and so does the figure */
		now = performance.now()
	): void {
		const dt = Math.min(0.1, (now - this.last) / 1000)
		this.last = now
		this.group.visible = alive
		this.group.position.set(x, 0, y)
		// how fast and which way the figure moves, smoothed over a few frames
		const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(x - this.lastX, y - this.lastY)
		const moveX = x - (Number.isNaN(this.lastX) ? x : this.lastX)
		const moveY = y - this.lastY
		this.lastX = x
		this.lastY = y
		if (dt > 0) this.speed += (moved / dt - this.speed) * Math.min(1, dt * 10)
		const facing = Math.PI / 2 - aimAngle
		this.placeholder.rotation.y = facing
		this.placeholder.rotation.z = downed ? Math.PI / 2.4 : 0
		this.placeholder.position.y = downed ? 0.25 : 0
		;(this.ring.material as THREE.MeshBasicMaterial).color.set(downed ? 0xff5630 : this.colour)
		const steps = Math.round(revive * 20)
		if (steps !== this.reviveSteps) {
			this.reviveSteps = steps
			this.reviveArc.geometry.dispose()
			this.reviveArc.geometry = new THREE.RingGeometry(0.72, 0.86, 32, 1, Math.PI / 2, (steps / 20) * Math.PI * 2)
			this.reviveArc.visible = steps > 0
		}
		if (!this.model || !this.mixer || !this.clips) {
			if (this.weapon) this.weapon.visible = false
			return
		}
		// the hands, not the chest, point along the aim
		if (moved > 0) {
			const blend = Math.min(1, dt * 12)
			this.moveX += (moveX / moved - this.moveX) * blend
			this.moveY += (moveY / moved - this.moveY) * blend
		}
		// the legs run the way the player moves (backwards when that is more than ~110° from the aim)
		// and the torso twists toward the aim; standing, the legs come round under the torso
		let backwards = false
		let legsTarget = facing
		if (this.speed >= 0.4 && !downed) {
			const heading = Math.atan2(this.moveX, this.moveY)
			backwards = Math.abs(wrap(heading - facing)) > TWIST_LIMIT
			legsTarget = backwards ? heading + Math.PI : heading
		}
		this.legsYaw += wrap(legsTarget - this.legsYaw) * Math.min(1, dt * 10)
		this.model.rotation.y = this.legsYaw
		if (downed) {
			this.playPose('Sitting_Idle_Loop')
		} else if (this.relaxed) {
			this.playPose('Idle_Loop')
		} else {
			this.playPose(null)
			if (this.speed < 0.4) this.playLegs('Idle_Loop', 1)
			else if (this.speed < 2.6) this.playLegs('Walk_Loop', (this.speed / WALK_SPEED) * (backwards ? -1 : 1))
			else this.playLegs('Jog_Fwd_Loop', (this.speed / JOG_SPEED) * (backwards ? -1 : 1))
			if (now > this.armsUntil) this.playArms('Idle_Loop', 0.2, 0)
		}
		this.mixer.update(dt)
		if (this.weapon && this.hand) {
			// at ease a long gun is held low across the body; a pistol is put away
			this.weapon.visible = !downed && (!this.relaxed || this.longGun)
			this.model.updateMatrixWorld(true)
			if (this.longGun && this.weapon.visible && this.relaxed && this.rig) {
				// at ease: the low ready, both hands on the gun
				holdGun(this.rig, this.weapon, this.weaponLength, aimAngle, 'low', { weaponId: this.weaponId })
			} else if (this.weapon.visible && this.rig) {
				// aiming: the torso turns to the aim and both hands hold the gun (a rifle at the
				// shoulder, a pistol out in front)
				this.kick = Math.max(0, this.kick - dt * 9)
				this.reloadLeft = Math.max(0, this.reloadLeft - dt)
				const reload = this.reloadLeft > 0 ? 1 - this.reloadLeft / this.reloadTotal : 0
				holdGun(this.rig, this.weapon, this.weaponLength, aimAngle, this.longGun ? 'rifle' : 'pistol', {
					kick: this.kick,
					reload,
					weaponId: this.weaponId
				})
			}
		}
	}

	private playLegs(name: string, timeScale: number): void {
		if (!this.mixer || !this.clips) return
		if (name !== this.legsClip) {
			const clip = this.clips.lower.get(name)
			if (!clip) return
			const next = this.mixer.clipAction(clip)
			next.reset().play()
			if (this.legs) next.crossFadeFrom(this.legs, 0.2, false)
			this.legs = next
			this.legsClip = name
		}
		if (this.legs) this.legs.timeScale = timeScale
	}

	private playArms(name: string, fade: number, holdSeconds: number, timeScale = 1): void {
		if (!this.mixer || !this.clips) return
		const clip = this.clips.upper.get(name)
		if (!clip) return
		const next = this.mixer.clipAction(clip)
		if (name === this.armsClip && holdSeconds === 0) return
		next.reset()
		next.timeScale = timeScale
		next.setLoop(holdSeconds > 0 ? THREE.LoopOnce : THREE.LoopRepeat, Number.POSITIVE_INFINITY)
		next.clampWhenFinished = holdSeconds > 0
		next.play()
		if (this.arms && this.arms !== next) next.crossFadeFrom(this.arms, fade, false)
		this.arms = next
		this.armsClip = name
		this.armsUntil = holdSeconds > 0 ? performance.now() + holdSeconds * 1000 : 0
	}

	/** A whole-body pose (downed) over everything else, or `null` to go back to walking and aiming. */
	private playPose(name: string | null): void {
		if (!this.mixer || !this.clips) return
		if (name === null) {
			if (this.pose) {
				this.pose.fadeOut(0.3)
				this.pose = null
				this.legsClip = this.armsClip = ''
			}
			return
		}
		if (this.pose) return
		const clip = this.clips.full.get(name)
		if (!clip) return
		this.legs?.fadeOut(0.3)
		this.arms?.fadeOut(0.3)
		this.pose = this.mixer.clipAction(clip).reset().fadeIn(0.3).play()
	}

	/** World position of the muzzle, for flashes and tracers. */
	muzzle(out: THREE.Vector3): THREE.Vector3 {
		if (this.weapon?.visible) return this.weapon.localToWorld(out.set(this.weaponLength / 2, 0, 0))
		return this.gun.getWorldPosition(out)
	}

	dispose(): void {
		this.mixer?.stopAllAction()
		this.group.removeFromParent()
	}
}

/** the most the torso turns away from the legs; beyond it the legs run backwards */
const TWIST_LIMIT = (110 * Math.PI) / 180

/** An angle brought into -π..π. */
function wrap(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle))
}
