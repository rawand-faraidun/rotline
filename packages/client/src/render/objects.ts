import { buffs } from '@rotline/game-data'
import type { ObjectState } from '@rotline/protocol'
import { ObjectKind } from '@rotline/sim'
import * as THREE from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EFFECTS_LAYER } from './post.ts'

type Drawn = { root: THREE.Object3D; kind: number; pulse: THREE.Mesh | null; spin: THREE.Object3D | null }

const ZONE_COLOURS: Record<number, number> = {
	[ObjectKind.heal]: 0x7cf27c,
	[ObjectKind.toxin]: 0x9fe04a,
	[ObjectKind.fire]: 0xff8a2a,
	[ObjectKind.marker]: 0xff3a2a,
	[ObjectKind.decoy]: 0xffc02e
}

/** Buff pickups, by buff id: what lies on the ground, and the colour of the light it gives off. */
const PICKUPS: Record<string, { model: string; colour: number }> = {
	'screen-nuke': { model: 'props/item-c4', colour: 0xff5a2a },
	'max-ammo': { model: 'props/item-ammo', colour: 0xffc02e },
	'double-xp': { model: 'props/item-tags', colour: 0xb8f23c },
	minigun: { model: 'weapons/minigun', colour: 0xff8a2a },
	instakill: { model: 'props/item-syringe', colour: 0xff3a2a },
	'speed-boost': { model: 'props/item-injector', colour: 0x6fb8ff },
	'freeze-pulse': { model: 'props/item-cryo', colour: 0x9fd8ff },
	sentry: { model: 'props/item-sentry', colour: 0xb8f23c }
}
/** pickups are drawn at least this long (metres), so a dog tag can be found from the game camera */
const PICKUP_SIZE = 0.95

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

/** A soft vertical fade (bright at the foot), for the light rising from a pickup. */
function beamTexture(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = 4
	canvas.height = 128
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const gradient = ctx.createLinearGradient(0, 128, 0, 0)
	gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
	gradient.addColorStop(0.25, 'rgba(255,255,255,0.35)')
	gradient.addColorStop(1, 'rgba(255,255,255,0)')
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, 4, 128)
	return new THREE.CanvasTexture(canvas)
}

/** A round glow, for the light a pickup throws on the ground. */
function glowTexture(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 64
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
	gradient.addColorStop(0, 'rgba(255,255,255,0.8)')
	gradient.addColorStop(0.5, 'rgba(255,255,255,0.25)')
	gradient.addColorStop(1, 'rgba(255,255,255,0)')
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, 64, 64)
	return new THREE.CanvasTexture(canvas)
}

/**
 * Draws what abilities, utilities and drops leave behind: zones as glowing discs, barricades as
 * sandbag walls, claymores, a radio for the decoy, sentry turrets, and pickups lying on the ground in
 * a column of their colour's light. Objects are few, so each gets its own mesh, made when it
 * appears and removed when it is gone; the models load once and are copied.
 */
export class ObjectRenderer {
	private readonly scene: THREE.Scene
	private readonly assets: string
	private readonly drawn = new Map<number, Drawn>()
	private readonly models = new Map<string, Promise<THREE.Object3D | null>>()
	private readonly disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)
	private readonly ring = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2)
	private readonly beam = new THREE.CylinderGeometry(0.32, 0.42, 2.6, 24, 1, true).translate(0, 1.3, 0)
	private readonly plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
	private readonly beamMap = beamTexture()
	private readonly glowMap = glowTexture()

	constructor(scene: THREE.Scene, assets = '/assets') {
		this.scene = scene
		this.assets = assets
	}

	/** A model from the asset folder, loaded the first time it is asked for. */
	private model(path: string): Promise<THREE.Object3D | null> {
		let pending = this.models.get(path)
		if (!pending) {
			pending = loader
				.loadAsync(`${this.assets}/models/${path}.glb`)
				.then(gltf => {
					gltf.scene.traverse(object => {
						if (!(object as THREE.Mesh).isMesh) return
						object.castShadow = true
						object.userData.shared = true
					})
					return gltf.scene as THREE.Object3D
				})
				.catch(() => null)
			this.models.set(path, pending)
		}
		return pending
	}

	/** Puts a copy of a model into `parent` once it has loaded, `fit` turning it to size. */
	private place(parent: THREE.Object3D, path: string, fit: (copy: THREE.Object3D) => void): void {
		void this.model(path).then(model => {
			if (!model || !parent.parent) return
			const copy = model.clone()
			fit(copy)
			parent.add(copy)
		})
	}

	update(objects: readonly ObjectState[], timeSeconds: number): void {
		const seen = new Set<number>()
		for (const object of objects) {
			seen.add(object.id)
			let drawn = this.drawn.get(object.id)
			if (!drawn || drawn.kind !== object.kind) {
				if (drawn) this.remove(object.id, drawn)
				drawn = this.make(object)
				this.drawn.set(object.id, drawn)
				this.scene.add(drawn.root)
			}
			drawn.root.position.set(object.x, 0, object.y)
			if (object.kind === ObjectKind.barricade) drawn.root.rotation.y = Math.PI / 2 - object.angle
			if (object.kind === ObjectKind.sentry || object.kind === ObjectKind.mine)
				drawn.root.rotation.y = Math.PI / 2 - object.angle
			if (object.kind === ObjectKind.buff && drawn.spin) {
				// a pickup turns slowly where it lies, and blinks in its last seconds
				drawn.spin.rotation.y = timeSeconds * 0.8
				drawn.root.visible = object.secondsLeft > 4 || Math.floor(timeSeconds * 6) % 2 === 0
			}
			if (drawn.pulse) {
				const beat = 0.5 + 0.5 * Math.sin(timeSeconds * (object.kind === ObjectKind.marker ? 14 : 4))
				;(drawn.pulse.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.45 * beat
			}
		}
		for (const [id, drawn] of this.drawn) if (!seen.has(id)) this.remove(id, drawn)
	}

	private glow(colour: number, opacity: number): THREE.MeshBasicMaterial {
		return new THREE.MeshBasicMaterial({
			color: colour,
			map: this.glowMap,
			transparent: true,
			opacity,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		})
	}

	private make(object: ObjectState): Drawn {
		const root = new THREE.Group()
		let pulse: THREE.Mesh | null = null
		let spin: THREE.Object3D | null = null
		const colour = ZONE_COLOURS[object.kind] ?? 0xffffff
		switch (object.kind) {
			case ObjectKind.heal:
			case ObjectKind.toxin:
			case ObjectKind.fire:
			case ObjectKind.marker: {
				const fill = new THREE.Mesh(
					this.disc,
					new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.18, depthWrite: false })
				)
				fill.scale.setScalar(object.radius)
				fill.position.y = 0.04
				pulse = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.6, depthWrite: false })
				)
				pulse.scale.setScalar(object.radius)
				pulse.position.y = 0.05
				root.add(fill, pulse)
				break
			}
			case ObjectKind.barricade: {
				// a wall of sandbags as long as the barricade, waist high: bags laid side by side, two rows
				const bags = Math.max(2, Math.round((object.radius * 2) / 0.8))
				for (let row = 0; row < 2; row++)
					for (let bag = 0; bag < bags - row; bag++)
						this.place(root, 'props/sandbags', copy => {
							copy.scale.set(0.85, 0.5, 0.8)
							copy.position.set((bag - (bags - 1 - row) / 2) * 0.8, row * 0.45, 0)
							copy.rotation.y = (bag % 2) * Math.PI
						})
				break
			}
			case ObjectKind.mine: {
				// a claymore on its legs, facing the way it was set, with its arming light
				this.place(root, 'props/item-claymore', copy => copy.scale.multiplyScalar(1.5))
				pulse = new THREE.Mesh(
					new THREE.SphereGeometry(0.03, 8, 6),
					new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true })
				)
				pulse.position.y = 0.3
				pulse.layers.set(EFFECTS_LAYER)
				root.add(pulse)
				break
			}
			case ObjectKind.decoy: {
				// a radio blaring on the ground, with a blinking light and the ring it draws them to
				this.place(root, 'props/item-radio', copy => copy.rotation.set(0, Math.random() * Math.PI * 2, 0))
				pulse = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.5, depthWrite: false })
				)
				pulse.scale.setScalar(1.2)
				pulse.position.y = 0.05
				pulse.layers.set(EFFECTS_LAYER)
				root.add(pulse)
				break
			}
			case ObjectKind.sentry: {
				this.place(root, 'props/item-sentry', copy => copy.scale.multiplyScalar(1.3))
				const light = new THREE.Mesh(this.plane, this.glow(0xb8f23c, 0.35))
				light.scale.setScalar(1.6)
				light.position.y = 0.03
				light.layers.set(EFFECTS_LAYER)
				root.add(light)
				break
			}
			case ObjectKind.buff: {
				const pickup = PICKUPS[buffs.buffs[object.variant]?.id ?? ''] ?? { model: 'props/item-ammo', colour: 0xffffff }
				spin = new THREE.Group()
				root.add(spin)
				this.place(spin, pickup.model, copy => {
					// flat things lie flat, their broad side up to the camera
					const size = new THREE.Box3().setFromObject(copy).getSize(new THREE.Vector3())
					if (size.x < size.y && size.x < size.z) copy.rotation.z = Math.PI / 2
					else if (size.z < size.y && size.z < size.x) copy.rotation.x = Math.PI / 2
					// small things are drawn bigger, so they can be seen and picked up
					const longest = Math.max(size.x, size.y, size.z, 0.01)
					if (longest < PICKUP_SIZE) copy.scale.multiplyScalar(PICKUP_SIZE / longest)
					// a gun model is centred on its middle: set it down on the ground
					const box = new THREE.Box3().setFromObject(copy)
					copy.position.y -= box.min.y - 0.02
				})
				// a column of light and a glow on the ground in the pickup's colour
				const beam = new THREE.Mesh(
					this.beam,
					new THREE.MeshBasicMaterial({
						color: pickup.colour,
						map: this.beamMap,
						transparent: true,
						opacity: 0.22,
						depthWrite: false,
						side: THREE.DoubleSide,
						blending: THREE.AdditiveBlending
					})
				)
				beam.layers.set(EFFECTS_LAYER)
				const ground = new THREE.Mesh(this.plane, this.glow(pickup.colour, 0.3))
				ground.scale.setScalar(1.8)
				ground.position.y = 0.03
				ground.layers.set(EFFECTS_LAYER)
				pulse = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: pickup.colour, transparent: true, opacity: 0.5, depthWrite: false })
				)
				pulse.scale.setScalar(Math.max(0.6, object.radius))
				pulse.position.y = 0.04
				pulse.layers.set(EFFECTS_LAYER)
				root.add(beam, ground, pulse)
				break
			}
		}
		return { root, kind: object.kind, pulse, spin }
	}

	private remove(id: number, drawn: Drawn): void {
		this.scene.remove(drawn.root)
		drawn.root.traverse(node => {
			const mesh = node as THREE.Mesh
			// copies of loaded models share their materials with the original: leave those
			if (mesh.material && !mesh.userData.shared) (mesh.material as THREE.Material).dispose()
		})
		this.drawn.delete(id)
	}
}

/** Floating damage numbers (the player's own hits). A small pool of sprites, each with its canvas. */
export class DamageNumbers {
	private readonly sprites: {
		sprite: THREE.Sprite
		canvas: HTMLCanvasElement
		texture: THREE.CanvasTexture
		born: number
	}[] = []
	private head = 0

	constructor(scene: THREE.Scene, size = 24) {
		for (let i = 0; i < size; i++) {
			const canvas = document.createElement('canvas')
			canvas.width = 96
			canvas.height = 40
			const texture = new THREE.CanvasTexture(canvas)
			const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
			sprite.layers.set(EFFECTS_LAYER)
			sprite.scale.set(1.6, 0.66, 1)
			sprite.visible = false
			scene.add(sprite)
			this.sprites.push({ sprite, canvas, texture, born: -1 })
		}
	}

	show(x: number, y: number, amount: number, now: number): void {
		const slot = this.sprites[this.head] as (typeof this.sprites)[number]
		this.head = (this.head + 1) % this.sprites.length
		const ctx = slot.canvas.getContext('2d') as CanvasRenderingContext2D
		ctx.clearRect(0, 0, 96, 40)
		ctx.font = 'bold 30px "Chakra Petch", sans-serif'
		ctx.textAlign = 'center'
		ctx.lineWidth = 5
		ctx.strokeStyle = '#0d100e'
		ctx.fillStyle = amount >= 100 ? '#ffc02e' : '#ece8dc'
		const text = String(Math.round(amount))
		ctx.strokeText(text, 48, 30)
		ctx.fillText(text, 48, 30)
		slot.texture.needsUpdate = true
		slot.sprite.position.set(x + (Math.random() - 0.5) * 0.6, 2.2, y)
		slot.sprite.visible = true
		slot.born = now
	}

	update(now: number): void {
		for (const slot of this.sprites) {
			if (slot.born < 0) continue
			const t = (now - slot.born) / 0.7
			if (t >= 1) {
				slot.sprite.visible = false
				slot.born = -1
				continue
			}
			slot.sprite.position.y = 2.2 + t * 1.2
			slot.sprite.material.opacity = 1 - t * t
		}
	}
}
