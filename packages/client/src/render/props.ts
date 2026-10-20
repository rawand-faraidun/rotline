import type { Prop } from '@rotline/sim'
import { PropState } from '@rotline/sim'
import * as THREE from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { outfitFor, wear } from './outfits.ts'
import { loadSoldier } from './players.ts'

/** Kinds drawn with a model (fitted to a 1 m cube by the asset pipeline); the rest stay simple shapes. */
const MODELLED = new Set(['barrel', 'crate', 'sandbags', 'generator', 'terminal', 'carry', 'defend', 'door'])
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

	constructor(scene: THREE.Scene, props: readonly Prop[], assets = '/assets', models = true) {
		this.scene = scene
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
		if (!this.models || !MODELLED.has(prop.def.kind)) return
		void propModel(`${this.assets}/models/props/${prop.def.kind}.glb`).then(model => {
			if (!model || !root.parent) return
			const copy = model.clone()
			copy.scale.set(...size)
			// barrels and crates do not all face the same way
			copy.rotation.y = ((prop.index * 2.399) % (Math.PI * 2)) * (prop.def.kind === 'barrel' ? 1 : 0)
			root.add(copy)
			for (const mesh of body) mesh.visible = false
			if (top) top.position.y = size[1] + 0.06
		})
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
				this.dressUp(prop, root, [body], [w, 0.8, h], null)
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
				add(new THREE.Mesh(this.cylinder, this.material(0x3a443b)), 0.4).scale.set(0.8, 0.8, 0.8)
				glow = this.material(0x6b6b6b, 0x000000)
				add(new THREE.Mesh(this.box, glow), 0.95).scale.set(0.2, 0.2, 0.9)
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
				glow = new THREE.MeshStandardMaterial({ color: 0x3a3a34, emissive: 0x6fb8ff, emissiveIntensity: 0 })
				const plate = add(new THREE.Mesh(this.cylinder, glow), 0.04)
				plate.scale.set(2.4, 0.08, 2.4)
				break
			}
			case 'survivor': {
				const body = add(new THREE.Mesh(this.cylinder, this.material(0xd9c9a3)), 0.8)
				body.scale.set(0.55, 1.6, 0.55)
				const head = add(new THREE.Mesh(this.box, this.material(0xffc02e)), 1.75)
				head.scale.set(0.35, 0.35, 0.35)
				// a civilian from the soldiers' file, standing at ease (walking when led out)
				if (this.models)
					void loadSoldier(`${this.assets}/models/characters/soldier.glb`).then(loaded => {
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
			root.visible = !gone || prop.def.kind === 'door' || prop.def.kind === 'defend'
			switch (prop.def.kind) {
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
					} else {
						drawn.glow?.emissive.setHex(prop.state === PropState.done ? 0xb8f23c : 0xff3a2a)
						if (drawn.glow) drawn.glow.emissiveIntensity = 1
					}
					this.setBar(drawn.bar, prop.state === PropState.done ? 0 : prop.progress)
					break
				case 'turret':
				case 'floodlight':
					drawn.glow?.emissive.setHex(prop.powered ? 0xfff2cc : 0x000000)
					if (drawn.light) drawn.light.intensity = prop.powered ? 40 : 0
					break
				case 'trap':
					if (drawn.glow) {
						drawn.glow.emissiveIntensity = prop.state === PropState.active ? 0.6 + 0.4 * Math.sin(timeSeconds * 30) : 0
					}
					break
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
				if (mesh.material) (mesh.material as THREE.Material).dispose()
			})
		}
		this.box.dispose()
		this.cylinder.dispose()
		this.ring.dispose()
	}
}
