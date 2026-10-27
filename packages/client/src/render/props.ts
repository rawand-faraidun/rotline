import { propsDef } from '@rotline/game-data'
import type { Prop } from '@rotline/sim'
import { PropState } from '@rotline/sim'
import * as THREE from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { tame } from './decor.ts'
import { outfitFor, wear } from './outfits.ts'
import { loadSoldier, loadWeapon, soldierUrl } from './players.ts'

/** lightning bolts a firing shock trap shows at once, and the jagged steps in each */
const BOLTS = 7
const BOLT_STEPS = 7
/** as tall as the map's walls */
const WEAK_WALL_HEIGHT = 3.2

/** How far each vehicle model is turned so it faces along +z (the way the vehicle drives). */
const VEHICLE_TURN: Record<string, number> = { 'scene-apc': -Math.PI / 2 }

/** Kinds drawn with a model (fitted to a 1 m cube by the asset pipeline); the rest stay simple shapes. */
const MODELLED = new Set(['barrel', 'crate', 'generator', 'terminal', 'carry', 'defend', 'door', 'ammo'])
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const models = new Map<string, Promise<THREE.Object3D | null>>()

function propModel(url: string): Promise<THREE.Object3D | null> {
	let model = models.get(url)
	if (!model) {
		model = loader
			.loadAsync(url)
			.then(gltf => {
				gltf.scene.traverse(node => {
					if ((node as THREE.Mesh).isMesh) {
						node.castShadow = true
						node.receiveShadow = true
						tame((node as THREE.Mesh).material)
					}
				})
				return gltf.scene as THREE.Object3D
			})
			.catch(() => null)
		models.set(url, model)
	}
	return model
}

type Drawn = {
	root: THREE.Group
	/** health bar for things that can be lost (survivors, defend targets, doors under attack) */
	bar: THREE.Mesh | null
	glow: THREE.MeshStandardMaterial | null
	light: THREE.PointLight | null
	lastState: number
}

const BAR = new THREE.PlaneGeometry(1, 0.12).rotateX(-Math.PI / 2)

/**
 * The map's props: barrels, cover, doors, generators, terminals, turrets, floodlights, traps,
 * survivors, carried objects and defend targets. Placeholder shapes until the art milestone; each
 * shows its state (open, welded, powered, broken) plainly.
 */
export class PropRenderer {
	private readonly scene: THREE.Scene
	private readonly drawn: Drawn[] = []
	private readonly box = new THREE.BoxGeometry(1, 1, 1)
	private readonly cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
	private readonly ring = new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2)

	private readonly assets: string

	/** on a weak device props stay simple shapes */
	private readonly models: boolean

	/** the map's wall sides and tops, for weak walls */
	private readonly wallMaterials: [THREE.Material, THREE.Material] | null

	constructor(
		scene: THREE.Scene,
		props: readonly Prop[],
		assets = '/assets',
		models = true,
		wallMaterials: [THREE.Material, THREE.Material] | null = null
	) {
		this.scene = scene
		this.wallMaterials = wallMaterials
		this.assets = assets
		this.models = models
		for (const prop of props) {
			const drawn = this.make(prop)
			scene.add(drawn.root)
			this.drawn.push(drawn)
		}
	}

	/**
	 * Swaps a prop's stand-in shape for its model once that has loaded: `body` is hidden, the model is
	 * stretched to `size` (width, height, depth in metres), and status lights move onto its top.
	 */
	private dressUp(
		prop: Prop,
		root: THREE.Group,
		body: THREE.Mesh[],
		size: [number, number, number],
		top: THREE.Mesh | null
	) {
		if (!this.models || (!MODELLED.has(prop.def.kind) && !prop.def.look)) return
		// the props' own models are fitted to a cube; a scenery model it is to look like is scaled (evenly)
		// so its longer side across the ground fits the prop's
		const look = prop.def.look
		void propModel(`${this.assets}/models/props/${look ?? prop.def.kind}.glb`).then(model => {
			if (!model || !root.parent) return
			const copy = model.clone()
			if (look) {
				const box = new THREE.Box3().setFromObject(model)
				const across = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1e-3)
				copy.scale.setScalar(Math.max(size[0], size[2]) / across)
			} else copy.scale.set(...size)
			// barrels and crates do not all face the same way
			copy.rotation.y = ((prop.index * 2.399) % (Math.PI * 2)) * (prop.def.kind === 'barrel' ? 1 : 0)
			root.add(copy)
			for (const mesh of body) mesh.visible = false
			// the lamp on a plain defend target's top; a scenery model has none
			if (top && look) top.visible = false
			else if (top) top.position.y = size[1] + 0.06
		})
	}

	/**
	 * Sandbags as real bags: three courses on each cell, two bags to a course, each course turned
	 * across the one below (like a wall is laid), with a little give in every bag.
	 */
	private stackBags(prop: Prop, root: THREE.Group, body: THREE.Mesh, w: number, h: number) {
		if (!this.models) return
		void propModel(`${this.assets}/models/props/sandbags.glb`).then(model => {
			if (!model || !root.parent) return
			let seed = prop.index * 9301 + 49297
			const jitter = () => {
				seed = (seed * 9301 + 49297) % 233280
				return seed / 233280 - 0.5
			}
			// every bag of the prop in one instanced draw per part of the model
			const bags: THREE.Matrix4[] = []
			const quaternion = new THREE.Quaternion()
			const up = new THREE.Vector3(0, 1, 0)
			for (let cx = 0; cx < w; cx++) {
				for (let cy = 0; cy < h; cy++) {
					for (let course = 0; course < 3; course++) {
						const across = course % 2 === 1
						for (let n = 0; n < 2; n++) {
							const offset = (n - 0.5) * 0.48
							quaternion.setFromAxisAngle(up, (across ? Math.PI / 2 : 0) + jitter() * 0.2)
							bags.push(
								new THREE.Matrix4().compose(
									new THREE.Vector3(
										cx - (w - 1) / 2 + (across ? offset : 0) + jitter() * 0.06,
										course * 0.25,
										cy - (h - 1) / 2 + (across ? 0 : offset) + jitter() * 0.06
									),
									quaternion,
									new THREE.Vector3(0.95, 0.27, 0.47)
								)
							)
						}
					}
				}
			}
			model.updateMatrixWorld(true)
			model.traverse(node => {
				const mesh = node as THREE.Mesh
				if (!mesh.isMesh) return
				const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, bags.length)
				for (const [i, bag] of bags.entries())
					instanced.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(bag, mesh.matrixWorld))
				instanced.castShadow = instanced.receiveShadow = true
				instanced.computeBoundingSphere()
				root.add(instanced)
			})
			body.visible = false
		})
	}

	/** The lightning of a shock trap: flat jagged ribbons, redrawn many times a second while it fires. */
	private lightning(root: THREE.Group): THREE.Mesh {
		const geometry = new THREE.BufferGeometry()
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLTS * BOLT_STEPS * 6 * 3), 3))
		const bolts = new THREE.Mesh(
			geometry,
			new THREE.MeshBasicMaterial({
				color: 0xbfe8ff,
				transparent: true,
				opacity: 0.95,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				side: THREE.DoubleSide
			})
		)
		bolts.frustumCulled = false
		bolts.visible = false
		bolts.userData.drawnAt = -1
		root.add(bolts)
		return bolts
	}

	private strike(bolts: THREE.Mesh | undefined, active: boolean, timeSeconds: number): void {
		if (!bolts) return
		bolts.visible = active
		if (!active || timeSeconds - (bolts.userData.drawnAt as number) < 0.045) return
		bolts.userData.drawnAt = timeSeconds
		const positions = bolts.geometry.getAttribute('position') as THREE.BufferAttribute
		const out = positions.array as Float32Array
		const reach = propsDef.trap.radius
		let o = 0
		for (let b = 0; b < BOLTS; b++) {
			// from a post (or the plate's middle) out to a point on the ground it covers, or to the next post
			const a0 = (Math.floor(Math.random() * 4) / 4) * Math.PI * 2 + Math.PI / 4
			let x = b === 0 ? 0 : Math.cos(a0) * 1.05
			let z = b === 0 ? 0 : Math.sin(a0) * 1.05
			let y = b === 0 ? 0.1 : 0.74
			const a1 = Math.random() * Math.PI * 2
			const r1 = reach * (0.45 + Math.random() * 0.55)
			const tx = Math.cos(a1) * r1
			const tz = Math.sin(a1) * r1
			for (let k = 0; k < BOLT_STEPS; k++) {
				const t = (k + 1) / BOLT_STEPS
				const jitter = k === BOLT_STEPS - 1 ? 0 : 0.35
				const nx = x + (tx - x) / (BOLT_STEPS - k) + (Math.random() - 0.5) * jitter
				const nz = z + (tz - z) / (BOLT_STEPS - k) + (Math.random() - 0.5) * jitter
				const ny = y + (0.08 - y) * t + Math.random() * 0.05
				// a flat ribbon from (x, y, z) to (nx, ny, nz), its width across the step
				const dx = nx - x
				const dz = nz - z
				const length = Math.hypot(dx, dz) || 1
				const w = (b === 0 ? 0.07 : 0.05) * (1 - t * 0.5)
				const px = (-dz / length) * w
				const pz = (dx / length) * w
				out.set([x - px, y, z - pz, x + px, y, z + pz, nx + px, ny, nz + pz], o)
				out.set([x - px, y, z - pz, nx + px, ny, nz + pz, nx - px, ny, nz - pz], o + 9)
				o += 18
				x = nx
				y = ny
				z = nz
			}
		}
		positions.needsUpdate = true
	}

	private material(color: number, emissive = 0): THREE.MeshStandardMaterial {
		return new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive, emissiveIntensity: emissive ? 0.8 : 0 })
	}

	private make(prop: Prop): Drawn {
		const root = new THREE.Group()
		const w = prop.def.w ?? 1
		const h = prop.def.h ?? 1
		let bar: THREE.Mesh | null = null
		let glow: THREE.MeshStandardMaterial | null = null
		let light: THREE.PointLight | null = null
		const add = (mesh: THREE.Mesh, y: number) => {
			mesh.position.y = y
			mesh.castShadow = true
			root.add(mesh)
			return mesh
		}
		switch (prop.def.kind) {
			case 'barrel': {
				const body = add(new THREE.Mesh(this.cylinder, this.material(0xa8321e)), 0.5)
				body.scale.set(0.8, 1, 0.8)
				const band = add(new THREE.Mesh(this.cylinder, this.material(0xffc02e)), 0.65)
				band.scale.set(0.82, 0.08, 0.82)
				this.dressUp(prop, root, [body, band], [0.78, 1.05, 0.78], null)
				break
			}
			case 'crate': {
				const body = add(new THREE.Mesh(this.box, this.material(0x6b5232)), 0.5)
				body.scale.set(w * 0.96, 1, h * 0.96)
				this.dressUp(prop, root, [body], [w * 0.96, 0.95, h * 0.96], null)
				break
			}
			case 'sandbags': {
				const body = add(new THREE.Mesh(this.box, this.material(0x8a7a52)), 0.4)
				body.scale.set(w * 0.98, 0.8, h * 0.98)
				this.stackBags(prop, root, body, w, h)
				break
			}
			case 'vehicle': {
				// the vehicle to walk out (a car, the fuel tanker, the armoured carrier), its health over it
				const look = prop.def.look ?? 'scene-car'
				const turn = VEHICLE_TURN[look] ?? 0
				const body = add(new THREE.Mesh(this.box, this.material(0x3a4a3e)), 0.8)
				body.scale.set(1.8, 1.5, 4.2)
				bar = this.bar(root, look === 'scene-car' ? 2.2 : 3.4)
				if (this.models)
					void propModel(`${this.assets}/models/props/${look}.glb`).then(model => {
						if (!model || !root.parent) return
						const copy = model.clone()
						// scenery models come at their real size; each faces its own way
						copy.rotation.y = turn
						root.add(copy)
						body.visible = false
					})
				root.userData.heading = 0
				break
			}
			case 'weakwall': {
				// a stretch of wall like the rest, but cracked through and patched: it gives way under fire
				const [sides, top] = this.wallMaterials ?? [this.material(0x5d665a), this.material(0x3a3c38)]
				const body = add(new THREE.Mesh(this.box, [sides, sides, top, top, sides, sides]), WEAK_WALL_HEIGHT / 2)
				body.scale.set(w, WEAK_WALL_HEIGHT, h)
				body.receiveShadow = true
				// the map's own wall materials: the stage disposes of them
				body.userData.shared = this.wallMaterials !== null
				const crack = this.material(0x141614)
				// jagged dark seams on both faces, standing a hair proud of the wall
				const along = w >= h
				const length = along ? w : h
				for (let i = 0; i < 2 + Math.round(length); i++) {
					const seam = new THREE.Mesh(this.box, crack)
					const t = (((prop.index * 7 + i * 13) % 17) / 17 - 0.5) * (length - 0.4)
					const y = 0.6 + (((prop.index * 5 + i * 11) % 13) / 13) * 2
					const tilt = (((prop.index + i * 3) % 7) / 7 - 0.5) * 2.2
					const tall = 0.9 + (i % 3) * 0.35
					if (along) {
						seam.scale.set(0.06, tall, h + 0.04)
						seam.rotation.z = tilt
						seam.position.set(t, y, 0)
					} else {
						seam.scale.set(w + 0.04, tall, 0.06)
						seam.rotation.x = tilt
						seam.position.set(0, y, t)
					}
					root.add(seam)
				}
				break
			}
			case 'door': {
				const slab = add(new THREE.Mesh(this.box, this.material(0x4c5a52)), 1.1)
				slab.scale.set(w, 2.2, h)
				// the shutter rides on the slab (which sinks when the door opens); its colour shows the state
				if (this.models)
					void propModel(`${this.assets}/models/props/door.glb`).then(model => {
						if (!model || !root.parent) return
						const shutter = model.clone()
						shutter.traverse(node => {
							const mesh = node as THREE.Mesh
							if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone()
						})
						shutter.position.y = -0.5
						// the shutter's face runs along the door's longer side
						if (h > w) shutter.rotation.y = Math.PI / 2
						slab.add(shutter)
						slab.userData.shutter = shutter
						;(slab.material as THREE.Material).visible = false
					})
				break
			}
			case 'generator':
			case 'terminal': {
				const isGenerator = prop.def.kind === 'generator'
				const body = add(new THREE.Mesh(this.box, this.material(isGenerator ? 0x3d4a3f : 0x2f3533)), 0.6)
				body.scale.set(w * 0.9, 1.2, h * 0.9)
				glow = this.material(0x1a1a1a, 0xff3a2a)
				const lamp = add(new THREE.Mesh(this.box, glow), 1.25)
				lamp.scale.set(0.3, 0.1, 0.3)
				bar = this.bar(root, 1.9)
				this.dressUp(prop, root, [body], isGenerator ? [w * 0.9, 0.85, h * 0.75] : [w * 0.75, 1.5, h * 0.55], lamp)
				break
			}
			case 'turret': {
				// a mounted M134: a tripod and post, a swivelling cradle with its ammunition box, and the
				// minigun on top, turning to whatever it fires at
				const steel = this.material(0x2b2f2b)
				for (let leg = 0; leg < 3; leg++) {
					const angle = (leg / 3) * Math.PI * 2
					const strut = add(new THREE.Mesh(this.cylinder, steel), 0.42)
					strut.scale.set(0.07, 0.95, 0.07)
					strut.position.set(Math.cos(angle) * 0.32, 0.4, Math.sin(angle) * 0.32)
					strut.rotation.set(Math.sin(angle) * 0.62, 0, -Math.cos(angle) * 0.62)
				}
				add(new THREE.Mesh(this.cylinder, steel), 0.55).scale.set(0.14, 1.1, 0.14)
				const head = new THREE.Group()
				head.position.y = 1.08
				root.add(head)
				const cradle = new THREE.Mesh(this.box, this.material(0x3a4038))
				cradle.scale.set(0.36, 0.16, 0.3)
				cradle.castShadow = true
				head.add(cradle)
				const ammo = new THREE.Mesh(this.box, this.material(0x4a5236))
				ammo.scale.set(0.3, 0.26, 0.2)
				ammo.position.set(-0.08, 0.02, 0.27)
				ammo.castShadow = true
				head.add(ammo)
				// a lamp on the cradle: dark without power, lit once its generator runs
				glow = this.material(0x1a1a1a, 0x000000)
				const lamp = new THREE.Mesh(this.box, glow)
				lamp.scale.set(0.08, 0.06, 0.08)
				lamp.position.set(-0.14, 0.11, -0.1)
				head.add(lamp)
				// a plain barrel until the gun's model has loaded (or if it cannot)
				const stand = new THREE.Mesh(this.box, this.material(0x55595a))
				stand.scale.set(0.9, 0.14, 0.14)
				stand.position.set(0.3, 0.14, 0)
				head.add(stand)
				// a heavy emplacement, a little larger than a soldier's own gun
				root.scale.setScalar(1.25)
				root.userData.head = head
				root.userData.aim = 0
				root.userData.firedAt = -1
				if (this.models)
					void loadWeapon(`${this.assets}/models/weapons/minigun.glb`).then(loaded => {
						if (!loaded || !root.parent) return
						const gun = loaded.clone()
						gun.traverse(node => {
							if ((node as THREE.Mesh).isMesh) {
								node.castShadow = true
								node.userData.shared = true
							}
						})
						const box = new THREE.Box3().setFromObject(gun)
						// pivot a little behind the middle, sitting on the cradle
						gun.position.set(
							-box.min.x - (box.max.x - box.min.x) * 0.38,
							0.08 - box.min.y * 0.6,
							-(box.min.z + box.max.z) / 2
						)
						head.remove(stand)
						head.add(gun)
					})
				break
			}
			case 'floodlight': {
				add(new THREE.Mesh(this.cylinder, this.material(0x55605a)), 1.5).scale.set(0.15, 3, 0.15)
				glow = this.material(0x222222, 0x000000)
				add(new THREE.Mesh(this.box, glow), 3.1).scale.set(0.6, 0.3, 0.4)
				light = new THREE.PointLight(0xfff2cc, 0, 18, 1.4)
				light.position.y = 3
				root.add(light)
				break
			}
			case 'trap': {
				// a shock trap: a steel grid plate with four coil posts round it; when it fires, lightning
				// crawls from post to post and out over the ground it covers
				const plate = add(new THREE.Mesh(this.cylinder, this.material(0x2c2f30)), 0.03)
				plate.scale.set(2.4, 0.06, 2.4)
				plate.receiveShadow = true
				glow = new THREE.MeshStandardMaterial({ color: 0x1a2430, emissive: 0x6fc8ff, emissiveIntensity: 0.15 })
				for (let k = 0; k < 4; k++) {
					const a = (k / 4) * Math.PI * 2 + Math.PI / 4
					const post = add(new THREE.Mesh(this.cylinder, this.material(0x4a4e50)), 0.35)
					post.scale.set(0.16, 0.7, 0.16)
					post.position.set(Math.cos(a) * 1.05, 0.35, Math.sin(a) * 1.05)
					const cap = add(new THREE.Mesh(this.cylinder, glow), 0.74)
					cap.scale.set(0.22, 0.1, 0.22)
					cap.position.set(Math.cos(a) * 1.05, 0.74, Math.sin(a) * 1.05)
				}
				const ring = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0.25, depthWrite: false })
				)
				ring.scale.setScalar(propsDef.trap.radius)
				ring.position.y = 0.06
				root.add(ring)
				root.userData.ring = ring
				root.userData.bolts = this.lightning(root)
				light = new THREE.PointLight(0x7fd0ff, 0, 7, 1.6)
				light.position.y = 1
				root.add(light)
				break
			}
			case 'survivor': {
				const body = add(new THREE.Mesh(this.cylinder, this.material(0xd9c9a3)), 0.8)
				body.scale.set(0.55, 1.6, 0.55)
				const head = add(new THREE.Mesh(this.box, this.material(0xffc02e)), 1.75)
				head.scale.set(0.35, 0.35, 0.35)
				// a civilian from the soldiers' file, standing at ease (walking when led out)
				if (this.models)
					void loadSoldier(soldierUrl(this.assets, 'game')).then(loaded => {
						if (!loaded || !root.parent) return
						const person = cloneSkinned(loaded.scene)
						wear(person, outfitFor('survivor'))
						const mixer = new THREE.AnimationMixer(person)
						const idle = loaded.clips.full.get('Idle_Loop')
						const walk = loaded.clips.full.get('Walk_Loop')
						if (idle) mixer.clipAction(idle).play()
						person.userData.walk = walk ? mixer.clipAction(walk) : null
						person.userData.mixer = mixer
						root.add(person)
						root.userData.person = person
						body.visible = head.visible = false
					})
				const ring = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: 0xffc02e, transparent: true, opacity: 0.7, depthWrite: false })
				)
				ring.scale.setScalar(0.7)
				ring.position.y = 0.05
				root.add(ring)
				bar = this.bar(root, 2.2)
				break
			}
			case 'search': {
				// something to go through: a wreck, a locker, a car boot; a ring round it until it has been searched
				const body = add(new THREE.Mesh(this.box, this.material(0x4a4f48)), 0.35)
				body.scale.set(0.9, 0.7, 0.6)
				// a car is a car's length; a crate, a locker or a bench about a metre
				const car = prop.def.look === 'scene-car'
				this.dressUp(prop, root, [body], car ? [1.9, 1.4, 4.3] : [1.1, 1, 1.1], null)
				const ring = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: 0xffc02e, transparent: true, opacity: 0.6, depthWrite: false })
				)
				ring.scale.setScalar(1.1)
				ring.position.y = 0.05
				root.add(ring)
				root.userData.ring = ring
				root.rotation.y = (prop.index * 2.399) % (Math.PI * 2)
				break
			}
			case 'charge': {
				// where the charge goes: a red ring until it is planted, then the charge itself, blinking
				const ring = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.6, depthWrite: false })
				)
				ring.scale.setScalar(0.9)
				ring.position.y = 0.05
				root.add(ring)
				root.userData.ring = ring
				const pack = add(new THREE.Mesh(this.box, this.material(0x5a5a3a)), 0.18)
				pack.scale.set(0.5, 0.3, 0.35)
				glow = this.material(0x220000, 0xff2a1a)
				const lamp = add(new THREE.Mesh(this.box, glow), 0.36)
				lamp.scale.set(0.1, 0.06, 0.1)
				root.userData.pack = pack
				root.userData.lamp = lamp
				if (this.models)
					void propModel(`${this.assets}/models/props/item-c4.glb`).then(model => {
						if (!model || !root.parent) return
						const copy = model.clone()
						copy.scale.setScalar(0.55)
						copy.visible = pack.visible
						root.userData.model = copy
						root.add(copy)
						pack.scale.setScalar(0.001)
					})
				light = new THREE.PointLight(0xff2a1a, 0, 4, 2)
				light.position.y = 0.6
				root.add(light)
				bar = this.bar(root, 1.2)
				break
			}
			case 'carry': {
				glow = this.material(0xffc02e, 0xffc02e)
				const body = add(new THREE.Mesh(this.box, glow), 0.35)
				body.scale.set(0.6, 0.5, 0.5)
				// the thing to carry is marked on the ground, so it stands out as a model too
				const ring = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: 0xffc02e, transparent: true, opacity: 0.75, depthWrite: false })
				)
				ring.scale.setScalar(0.6)
				ring.position.y = 0.04
				root.add(ring)
				this.dressUp(prop, root, [body], [0.62, 0.42, 0.34], null)
				break
			}
			case 'ammo': {
				// a supply case: olive, with a green light so it reads as a place to stop at
				const body = add(new THREE.Mesh(this.box, this.material(0x4a5a36)), 0.35)
				body.scale.set(w * 0.9, 0.7, h * 0.9)
				const ring = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: 0xb8f23c, transparent: true, opacity: 0.6, depthWrite: false })
				)
				ring.scale.setScalar(Math.max(w, h) * 0.75 + 0.3)
				ring.position.y = 0.04
				root.add(ring)
				this.dressUp(prop, root, [body], [w * 0.92, 0.62, h * 0.85], null)
				break
			}
			case 'nest': {
				// a swollen mass of flesh, veined and wet, that breathes
				const geometry = new THREE.IcosahedronGeometry(0.5, 4)
				const position = geometry.getAttribute('position') as THREE.BufferAttribute
				for (let v = 0; v < position.count; v++) {
					const x = position.getX(v)
					const y = position.getY(v)
					const z = position.getZ(v)
					const bump = 1 + 0.18 * Math.sin(x * 9 + z * 5) * Math.cos(y * 7) + 0.1 * Math.sin(z * 13 + x * 3)
					position.setXYZ(v, x * bump, Math.max(-0.1, y) * bump * 0.8, z * bump)
				}
				geometry.computeVertexNormals()
				glow = new THREE.MeshStandardMaterial({
					color: 0x4a1612,
					roughness: 0.35,
					metalness: 0.1,
					emissive: 0x7a1a10,
					emissiveIntensity: 0.4
				})
				const mass = add(new THREE.Mesh(geometry, glow), 0.1)
				mass.scale.set(w * 1.1, 1.1, h * 1.1)
				root.userData.mass = mass
				bar = this.bar(root, 1.6)
				break
			}
			case 'defend': {
				const body = add(new THREE.Mesh(this.box, this.material(0x56605c)), 1)
				body.scale.set(w * 0.95, 2, h * 0.95)
				glow = this.material(0x111111, 0xb8f23c)
				const lamp = add(new THREE.Mesh(this.box, glow), 2.05)
				lamp.scale.set(w * 0.5, 0.1, h * 0.5)
				bar = this.bar(root, 2.6)
				this.dressUp(prop, root, [body], [w * 0.95, 1.1, h * 0.95], lamp)
				break
			}
		}
		root.position.set(prop.x, 0, prop.y)
		return { root, bar, glow, light, lastState: -1 }
	}

	/** A map turret at (x, y) fired along `angle` (radians on the map): its gun turns that way. */
	aimTurret(x: number, y: number, angle: number, timeSeconds: number): void {
		for (const drawn of this.drawn) {
			const root = drawn.root
			if (!root.userData.head) continue
			if (Math.abs(root.position.x - x) > 0.6 || Math.abs(root.position.z - y) > 0.6) continue
			root.userData.aim = -angle
			root.userData.firedAt = timeSeconds
			return
		}
	}

	private bar(root: THREE.Group, height: number): THREE.Mesh {
		const back = new THREE.Mesh(BAR, new THREE.MeshBasicMaterial({ color: 0x0d100e, depthTest: false }))
		back.position.y = height
		back.renderOrder = 10
		const fill = new THREE.Mesh(BAR, new THREE.MeshBasicMaterial({ color: 0xb8f23c, depthTest: false }))
		fill.position.y = height + 0.01
		fill.renderOrder = 11
		root.add(back, fill)
		return fill
	}

	/** Brings every prop's look up to its state; `progress` bars show hold work, health bars health. */
	update(props: readonly Prop[], timeSeconds: number, dt: number): void {
		for (const prop of props) {
			const drawn = this.drawn[prop.index]
			if (!drawn) continue
			const root = drawn.root
			// moving props glide to where the server put them
			const ease = 1 - Math.exp(-12 * dt)
			root.position.x += (prop.x - root.position.x) * ease
			root.position.z += (prop.y - root.position.z) * ease
			const gone = prop.state === PropState.destroyed || prop.state === PropState.delivered
			root.visible =
				prop.state !== PropState.hidden &&
				(!gone || prop.def.kind === 'door' || prop.def.kind === 'defend' || prop.def.kind === 'search')
			switch (prop.def.kind) {
				case 'search': {
					// amber and pulsing until searched; green where it was found; nothing once gone through
					const ring = root.userData.ring as THREE.Mesh
					const material = ring.material as THREE.MeshBasicMaterial
					ring.visible = prop.state !== PropState.done
					material.color.setHex(prop.state === PropState.delivered ? 0xb8f23c : 0xffc02e)
					material.opacity = prop.state === PropState.delivered ? 0.8 : 0.35 + 0.35 * Math.sin(timeSeconds * 3) ** 2
					break
				}
				case 'charge': {
					const armed = prop.state === PropState.active
					;(root.userData.ring as THREE.Mesh).visible = prop.state === PropState.idle
					;(root.userData.ring as THREE.Mesh).scale.setScalar(0.9 + 0.1 * Math.sin(timeSeconds * 4))
					for (const part of [root.userData.pack, root.userData.lamp, root.userData.model] as THREE.Object3D[])
						if (part) part.visible = armed
					// blinking faster as the fuse burns down (its bar is its health)
					const blink = Math.sin(timeSeconds * (armed ? 12 : 0)) > 0
					if (drawn.glow) drawn.glow.emissiveIntensity = armed && blink ? 2.5 : 0.1
					if (drawn.light) drawn.light.intensity = armed && blink ? 3 : 0
					this.setBar(drawn.bar, armed ? prop.health / prop.maxHealth : 0)
					if (prop.state === PropState.done) root.visible = false
					break
				}
				case 'door': {
					const slab = root.children[0] as THREE.Mesh
					const open = prop.state === PropState.open || prop.state === PropState.destroyed
					// an open door sinks into the floor; a broken one stays down
					slab.position.y = open ? -0.95 : 1.1
					const material = slab.material as THREE.MeshStandardMaterial
					material.color.setHex(
						prop.state === PropState.welded ? 0x8a5a2a : prop.state === PropState.locked ? 0x2a302d : 0x4c5a52
					)
					// welded shutters glow a hot orange at the seams, locked ones are dark
					const shutter = slab.userData.shutter as THREE.Object3D | undefined
					if (shutter && drawn.lastState !== prop.state)
						shutter.traverse(node => {
							const mesh = node as THREE.Mesh
							if (!mesh.isMesh) return
							const paint = mesh.material as THREE.MeshStandardMaterial
							paint.color.setHex(
								prop.state === PropState.welded ? 0xb07850 : prop.state === PropState.locked ? 0x50504c : 0x9a9a94
							)
							paint.emissive.setHex(prop.state === PropState.welded ? 0x5a2008 : 0x000000)
						})
					break
				}
				case 'generator':
				case 'terminal':
					// red until worked, amber and pulsing while a generator runs up, green once on
					if (prop.state === PropState.active) {
						drawn.glow?.emissive.setHex(0xffa020)
						if (drawn.glow) drawn.glow.emissiveIntensity = 0.6 + 0.4 * Math.sin(timeSeconds * 8)
					} else if (prop.state === PropState.done && prop.progress > 0 && prop.progress < 0.2) {
						// running dry (Survival): amber, blinking, until someone starts it again
						drawn.glow?.emissive.setHex(0xffa020)
						if (drawn.glow) drawn.glow.emissiveIntensity = Math.sin(timeSeconds * 10) > 0 ? 1 : 0.2
					} else {
						drawn.glow?.emissive.setHex(prop.state === PropState.done ? 0xb8f23c : 0xff3a2a)
						if (drawn.glow) drawn.glow.emissiveIntensity = 1
					}
					// a hold's progress, a generator running up, or (Survival) the fuel left in a running one
					this.setBar(drawn.bar, prop.progress)
					break
				case 'turret': {
					drawn.glow?.emissive.setHex(prop.powered ? 0xb8f23c : 0x000000)
					const head = root.userData.head as THREE.Group | undefined
					if (head) {
						// it turns to its last target; idle and powered it sweeps slowly; without power the gun droops
						const firedAt = root.userData.firedAt as number
						const idle = firedAt < 0 || timeSeconds - firedAt > 1.5
						const want =
							idle && prop.powered
								? (root.userData.aim as number) + Math.sin(timeSeconds * 0.6) * 0.6
								: (root.userData.aim as number)
						let delta = want - head.rotation.y
						delta = Math.atan2(Math.sin(delta), Math.cos(delta))
						head.rotation.y += delta * (1 - Math.exp(-(idle ? 2 : 18) * dt))
						const droop = prop.powered ? 0 : -0.18
						head.rotation.z += (droop - head.rotation.z) * (1 - Math.exp(-4 * dt))
					}
					break
				}
				case 'floodlight':
					drawn.glow?.emissive.setHex(prop.powered ? 0xfff2cc : 0x000000)
					if (drawn.light) drawn.light.intensity = prop.powered ? 40 : 0
					break
				case 'vehicle': {
					this.setBar(drawn.bar, prop.health / prop.maxHealth)
					// it faces the way it drives
					const dx = prop.x - root.position.x
					const dz = prop.y - root.position.z
					if (Math.hypot(dx, dz) > 0.002) root.userData.heading = Math.atan2(dx, dz)
					root.rotation.y += ((root.userData.heading as number) - root.rotation.y) * Math.min(1, dt * 6)
					break
				}
				case 'trap': {
					const active = prop.state === PropState.active
					if (drawn.glow)
						drawn.glow.emissiveIntensity = active ? 1.5 + Math.random() : 0.15 + 0.1 * Math.sin(timeSeconds * 3)
					const ring = root.userData.ring as THREE.Mesh | undefined
					if (ring) (ring.material as THREE.MeshBasicMaterial).opacity = active ? 0.55 : 0.12
					if (drawn.light) drawn.light.intensity = active ? 14 + Math.random() * 18 : 0
					this.strike(root.userData.bolts as THREE.Mesh | undefined, active, timeSeconds)
					break
				}
				case 'survivor': {
					this.setBar(drawn.bar, prop.state === PropState.idle ? prop.progress : prop.health / prop.maxHealth)
					const person = root.userData.person as THREE.Object3D | undefined
					if (person) {
						// following the squad: walk, facing the way they go
						const dx = prop.x - root.position.x
						const dz = prop.y - root.position.z
						const moving = Math.hypot(dx, dz) > 0.05
						const walk = person.userData.walk as THREE.AnimationAction | null
						if (walk && moving !== walk.isRunning()) {
							if (moving) walk.reset().fadeIn(0.2).play()
							else walk.fadeOut(0.3)
						}
						if (moving) person.rotation.y = Math.atan2(dx, dz)
						;(person.userData.mixer as THREE.AnimationMixer).update(dt)
					}
					break
				}
				case 'carry':
					root.position.y = prop.state === PropState.carried ? 1.1 : 0
					break
				case 'defend':
					this.setBar(drawn.bar, prop.health / prop.maxHealth)
					break
				case 'nest': {
					this.setBar(drawn.bar, prop.health / prop.maxHealth)
					const mass = root.userData.mass as THREE.Mesh | undefined
					const breath = 1 + 0.05 * Math.sin(timeSeconds * 2.2 + prop.index)
					if (mass) mass.scale.y = 1.1 * breath
					if (drawn.glow) drawn.glow.emissiveIntensity = 0.3 + 0.25 * Math.sin(timeSeconds * 2.2 + prop.index) ** 2
					break
				}
			}
			drawn.lastState = prop.state
		}
	}

	private setBar(bar: THREE.Mesh | null, value: number): void {
		if (!bar) return
		const v = Math.max(0, Math.min(1, value))
		bar.visible = v > 0
		bar.scale.x = Math.max(0.001, v)
		bar.position.x = (v - 1) / 2
	}

	dispose(): void {
		for (const drawn of this.drawn) {
			this.scene.remove(drawn.root)
			drawn.root.traverse(node => {
				const mesh = node as THREE.Mesh
				// a weapon model's materials are shared with the soldiers' guns
				if (!mesh.material || mesh.userData.shared) return
				for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
			})
		}
		this.box.dispose()
		this.cylinder.dispose()
		this.ring.dispose()
	}
}
