import type { MapDef } from '@rotline/game-data'
import * as THREE from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EFFECTS_LAYER } from './post.ts'

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
/** fires that get a real flickering light; the rest only glow (lights are costly) */
const LIT_FIRES = 6
const FLAMES = 36
const SMOKE = 18

/** A soft round sprite for flames and smoke. */
function puff(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 64
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
	gradient.addColorStop(0, 'rgba(255,255,255,1)')
	gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)')
	gradient.addColorStop(1, 'rgba(255,255,255,0)')
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, 64, 64)
	return new THREE.CanvasTexture(canvas)
}

/** One fire: flames rising and fading, smoke above them, and (for the first few) a light that flickers. */
class Fire {
	readonly group = new THREE.Group()
	private readonly flames: THREE.Points
	private readonly smoke: THREE.Points
	private readonly light: THREE.PointLight | null
	private readonly seeds: Float32Array
	private readonly size: number

	constructor(x: number, y: number, z: number, size: number, texture: THREE.Texture, lit: boolean) {
		this.size = size
		this.group.position.set(x, y, z)
		this.seeds = new Float32Array(FLAMES + SMOKE).map(() => Math.random())
		const points = (count: number, material: THREE.PointsMaterial) => {
			const geometry = new THREE.BufferGeometry()
			geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
			const mesh = new THREE.Points(geometry, material)
			mesh.frustumCulled = false
			mesh.layers.set(EFFECTS_LAYER)
			this.group.add(mesh)
			return mesh
		}
		this.flames = points(
			FLAMES,
			new THREE.PointsMaterial({
				map: texture,
				color: 0xff8a2a,
				size: 0.9 * size,
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
				blending: THREE.AdditiveBlending
			})
		)
		this.smoke = points(
			SMOKE,
			new THREE.PointsMaterial({
				map: texture,
				color: 0x2a2624,
				size: 2.2 * size,
				transparent: true,
				opacity: 0.35,
				depthWrite: false
			})
		)
		this.light = lit ? new THREE.PointLight(0xff8a3a, 8 * size, 9 * size, 1.6) : null
		if (this.light) {
			this.light.position.y = 0.8 * size
			this.group.add(this.light)
		}
	}

	update(time: number): void {
		const size = this.size
		const flames = this.flames.geometry.getAttribute('position') as THREE.BufferAttribute
		for (let i = 0; i < FLAMES; i++) {
			const seed = this.seeds[i] as number
			// each flame rises over its own short life, drifting and narrowing toward the tip
			const life = (time * (1.1 + seed) + seed * 7) % 1
			const spread = (1 - life) * 0.45 * size
			flames.setXYZ(
				i,
				Math.sin(seed * 40 + time * 3) * spread,
				life * 1.6 * size,
				Math.cos(seed * 30 + time * 2.4) * spread
			)
		}
		flames.needsUpdate = true
		const smoke = this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute
		for (let i = 0; i < SMOKE; i++) {
			const seed = this.seeds[FLAMES + i] as number
			const life = (time * (0.25 + seed * 0.2) + seed * 5) % 1
			smoke.setXYZ(i, Math.sin(seed * 20) * life * 1.2 * size, (1.2 + life * 4) * size, life * 1.5 * size)
		}
		smoke.needsUpdate = true
		if (this.light) this.light.intensity = 8 * size * (0.75 + Math.sin(time * 17) * Math.sin(time * 6.3) * 0.25)
	}
}

/**
 * A map's scenery (wrecks, cars, barriers, lamps, crates): models from the scenery set placed as the
 * map lists them, some of them burning. Drawing only; what blocks is in the map's blockers.
 */
export class Decor {
	private readonly fires: Fire[] = []
	private readonly group = new THREE.Group()

	constructor(scene: THREE.Scene, map: MapDef, assets: string, detailed: boolean) {
		scene.add(this.group)
		const texture = puff()
		const models = new Map<string, Promise<THREE.Object3D | null>>()
		const model = (id: string) => {
			let pending = models.get(id)
			if (!pending) {
				pending = loader
					.loadAsync(`${assets}/models/props/${id}.glb`)
					.then(gltf => {
						gltf.scene.traverse(object => {
							if ((object as THREE.Mesh).isMesh) object.castShadow = object.receiveShadow = detailed
						})
						return gltf.scene as THREE.Object3D
					})
					.catch(() => null)
				models.set(id, pending)
			}
			return pending
		}
		for (const entry of map.decor ?? []) {
			const [rx, ry, rz] = (entry.rotation ?? [0, 0, 0]).map(degrees => (degrees * Math.PI) / 180) as [
				number,
				number,
				number
			]
			void model(entry.model).then(loaded => {
				if (!loaded) return
				const copy = loaded.clone()
				copy.position.set(entry.x, 0, entry.y)
				copy.rotation.set(rx, ry, rz, 'YXZ')
				copy.scale.setScalar(entry.scale ?? 1)
				this.group.add(copy)
			})
			if (entry.fire) {
				const fire = new Fire(entry.x, 0.3, entry.y, entry.fire, texture, this.fires.length < LIT_FIRES)
				this.fires.push(fire)
				this.group.add(fire.group)
			}
		}
	}

	update(timeSeconds: number): void {
		for (const fire of this.fires) fire.update(timeSeconds)
	}
}
