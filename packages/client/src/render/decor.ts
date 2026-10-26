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

/**
 * Takes the gloss off a model's materials: polished metal and wet-look plastic catch the sun and the
 * player's light and flare white under bloom. Scenery should read as worn.
 */
export function tame(material: THREE.Material | THREE.Material[]): void {
	for (const entry of Array.isArray(material) ? material : [material]) {
		const standard = entry as THREE.MeshStandardMaterial
		if (!standard.isMeshStandardMaterial) continue
		standard.roughness = Math.max(standard.roughness, 0.55)
		standard.metalness = Math.min(standard.metalness, 0.3)
		if (standard.emissive && !standard.emissiveMap) standard.emissive.multiplyScalar(0.4)
	}
}

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
/** lamps that burn after dark: the height of the bulb, the reach of the pool of light on the ground */
const LAMPS: Record<string, { height: number; pool: number }> = {
	'scene-lamp': { height: 3.6, pool: 9 },
	'scene-lamp2': { height: 1.5, pool: 6 },
	'scene-searchlight': { height: 0.6, pool: 7 }
}
/** the hours when lamps are lit */
const LAMPLIGHT = new Set(['dawn', 'dusk', 'fog', 'night', 'dark'])

export class Decor {
	private readonly fires: Fire[] = []
	private readonly group = new THREE.Group()
	/** lit lamps: x, y, bulb height */
	private readonly lamps: { x: number; y: number; height: number }[] = []
	/** real lights, moved to the lamps nearest the camera (a few: each one costs every pixel) */
	private readonly lampLights: THREE.PointLight[] = []
	private lampsPlacedAt = -1

	constructor(scene: THREE.Scene, map: MapDef, assets: string, detailed: boolean, realLamps = detailed ? 6 : 0) {
		scene.add(this.group)
		const texture = puff()
		const lit = LAMPLIGHT.has(map.look?.light ?? 'overcast')
		const night = map.look?.light === 'night' || map.look?.light === 'dark'
		const models = new Map<string, Promise<THREE.Object3D | null>>()
		const model = (id: string) => {
			let pending = models.get(id)
			if (!pending) {
				pending = loader
					.loadAsync(`${assets}/models/props/${id}.glb`)
					.then(gltf => {
						gltf.scene.traverse(object => {
							if (!(object as THREE.Mesh).isMesh) return
							object.castShadow = object.receiveShadow = detailed
							tame((object as THREE.Mesh).material)
						})
						return gltf.scene as THREE.Object3D
					})
					.catch(() => null)
				models.set(id, pending)
			}
			return pending
		}
		// every model is drawn once for all its places (instanced): a forest is a few draw calls
		const placements = new Map<string, THREE.Matrix4[]>()
		const euler = new THREE.Euler()
		for (const entry of map.decor ?? []) {
			const [rx, ry, rz] = (entry.rotation ?? [0, 0, 0]).map(degrees => (degrees * Math.PI) / 180) as [
				number,
				number,
				number
			]
			const matrix = new THREE.Matrix4().compose(
				new THREE.Vector3(entry.x, 0, entry.y),
				new THREE.Quaternion().setFromEuler(euler.set(rx, ry, rz, 'YXZ')),
				new THREE.Vector3().setScalar(entry.scale ?? 1)
			)
			placements.set(entry.model, [...(placements.get(entry.model) ?? []), matrix])
			const lamp = LAMPS[entry.model]
			if (lit && lamp) this.lamps.push({ x: entry.x, y: entry.y, height: lamp.height * (entry.scale ?? 1) })
			if (entry.fire) {
				const fire = new Fire(entry.x, 0.3, entry.y, entry.fire, texture, this.fires.length < LIT_FIRES)
				this.fires.push(fire)
				this.group.add(fire.group)
			}
		}
		if (this.lamps.length > 0) this.lightLamps(map, night, realLamps)
		for (const [id, matrices] of placements) {
			void model(id).then(loaded => {
				if (!loaded) return
				loaded.updateMatrixWorld(true)
				loaded.traverse(object => {
					const mesh = object as THREE.Mesh
					if (!mesh.isMesh) return
					// shape keys (morph targets) are not drawn on instances: scenery stands still anyway
					let geometry = mesh.geometry
					if (Object.keys(geometry.morphAttributes).length > 0) {
						geometry = geometry.clone()
						geometry.morphAttributes = {}
					}
					const instanced = new THREE.InstancedMesh(geometry, mesh.material, matrices.length)
					const local = mesh.matrixWorld
					for (const [i, place] of matrices.entries())
						instanced.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(place, local))
					instanced.castShadow = instanced.receiveShadow = detailed
					instanced.computeBoundingSphere()
					this.group.add(instanced)
				})
			})
		}
	}

	/**
	 * Lamplight: a warm pool on the ground under every lit lamp and a glowing bulb (cheap, all of them),
	 * and a few real lights that follow the camera from lamp to lamp so what stands near them is lit.
	 */
	private lightLamps(map: MapDef, night: boolean, realLamps: number): void {
		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = 128
		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
		const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
		gradient.addColorStop(0, 'rgba(255,255,255,1)')
		gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
		gradient.addColorStop(1, 'rgba(255,255,255,0)')
		ctx.fillStyle = gradient
		ctx.fillRect(0, 0, 128, 128)
		const glow = new THREE.CanvasTexture(canvas)
		const pools = new THREE.InstancedMesh(
			new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({
				map: glow,
				color: night ? 0xffb366 : 0xd89a5c,
				transparent: true,
				opacity: night ? 0.42 : 0.22,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			}),
			this.lamps.length
		)
		const bulbs = new THREE.InstancedMesh(
			new THREE.SphereGeometry(0.16, 8, 6),
			new THREE.MeshBasicMaterial({ color: 0xffe2b0 }),
			this.lamps.length
		)
		const matrix = new THREE.Matrix4()
		for (const [i, lamp] of this.lamps.entries()) {
			const entry = (map.decor ?? []).find(item => item.x === lamp.x && item.y === lamp.y)
			const reach = LAMPS[entry?.model ?? 'scene-lamp']?.pool ?? 8
			pools.setMatrixAt(
				i,
				matrix.compose(
					new THREE.Vector3(lamp.x, 0.05, lamp.y),
					new THREE.Quaternion(),
					new THREE.Vector3(reach, 1, reach)
				)
			)
			bulbs.setMatrixAt(i, matrix.makeTranslation(lamp.x, lamp.height, lamp.y))
		}
		pools.renderOrder = 2
		bulbs.layers.set(EFFECTS_LAYER)
		this.group.add(pools, bulbs)
		for (let i = 0; i < Math.min(realLamps, this.lamps.length); i++) {
			const light = new THREE.PointLight(0xffc488, night ? 26 : 14, 11, 1.5)
			light.position.set(0, -10, 0)
			this.group.add(light)
			this.lampLights.push(light)
		}
	}

	/** `focusX`, `focusY`: where the camera looks (the real lamp lights go to the lamps nearest it). */
	update(timeSeconds: number, focusX?: number, focusY?: number): void {
		for (const fire of this.fires) fire.update(timeSeconds)
		if (this.lampLights.length === 0 || focusX === undefined || focusY === undefined) return
		if (timeSeconds - this.lampsPlacedAt < 0.3) return
		this.lampsPlacedAt = timeSeconds
		const nearest = [...this.lamps]
			.sort((a, b) => Math.hypot(a.x - focusX, a.y - focusY) - Math.hypot(b.x - focusX, b.y - focusY))
			.slice(0, this.lampLights.length)
		for (const [i, light] of this.lampLights.entries()) {
			const lamp = nearest[i]
			if (lamp) light.position.set(lamp.x, Math.max(1.2, lamp.height - 0.3), lamp.y)
			else light.position.set(0, -10, 0)
		}
	}
}
