import { zombies as zombieDefs } from '@rotline/game-data'
import { ZombieStatus } from '@rotline/protocol'
import { MAX_ZOMBIES, ZombieState } from '@rotline/sim'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { ZombieView } from '../interpolate.ts'

const BAKE_FPS = 30
/** how long a zombie takes to climb out of a spawn hole (seconds) */
const EMERGE = 0.9
/** how long a body stays on the ground, then how long it takes to sink away (seconds) */
const CORPSE_SECONDS = 30
const CORPSE_SINK = 3
/** bodies kept at once by detail (the oldest goes first) */
const CORPSES = { high: 160, medium: 90, low: 40 } as const
export type ZombieDetail = keyof typeof CORPSES

type Clip = { start: number; frames: number; fps: number }

type Baked = {
	geometry: THREE.BufferGeometry
	materials: THREE.Material[]
	boneTexture: THREE.DataTexture
	clips: { walk: Clip; run: Clip; attack: Clip; death: Clip }
}

/**
 * Bakes every animation's bone matrices into one small float texture (bones × frames), so the GPU
 * can skin hundreds of instances from a single draw call per material.
 */
function bake(root: THREE.Object3D, animations: THREE.AnimationClip[]): Baked {
	root.updateMatrixWorld(true)
	const meshes: THREE.SkinnedMesh[] = []
	root.traverse(object => {
		if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh)
	})
	const pick = (word: string) =>
		animations.find(clip => clip.name.toLowerCase().includes(word)) ?? (animations[0] as THREE.AnimationClip)
	const chosen = { walk: pick('walk'), run: pick('run'), attack: pick('bite'), death: pick('death') }
	const order = [chosen.walk, chosen.run, chosen.attack, chosen.death]
	const frameCounts = order.map(clip => Math.max(2, Math.round(clip.duration * BAKE_FPS)))
	const totalFrames = frameCounts.reduce((a, b) => a + b, 0)

	const offsets: number[] = []
	let bones = 0
	for (const mesh of meshes) {
		offsets.push(bones)
		bones += mesh.skeleton.bones.length
	}
	const data = new Float32Array(bones * 4 * totalFrames * 4)
	const mixer = new THREE.AnimationMixer(root)
	const bone = new THREE.Matrix4()
	const full = new THREE.Matrix4()

	// normalise to 1.8 m tall, standing on the ground
	const box = new THREE.Box3().setFromObject(root)
	const scale = 1.8 / (box.max.y - box.min.y)
	const fit = new THREE.Matrix4()
		.makeTranslation(0, -box.min.y * scale, 0)
		.multiply(new THREE.Matrix4().makeScale(scale, scale, scale))

	let frame = 0
	const clips: Clip[] = []
	for (const [c, clip] of order.entries()) {
		clips.push({ start: frame, frames: frameCounts[c] as number, fps: BAKE_FPS })
		mixer.stopAllAction()
		mixer.clipAction(clip).reset().play()
		for (let f = 0; f < (frameCounts[c] as number); f++, frame++) {
			mixer.setTime((f / (frameCounts[c] as number)) * clip.duration)
			root.updateMatrixWorld(true)
			for (const [m, mesh] of meshes.entries()) {
				mesh.skeleton.update()
				for (let j = 0; j < mesh.skeleton.bones.length; j++) {
					bone.fromArray(mesh.skeleton.boneMatrices as Float32Array, j * 16)
					full
						.multiplyMatrices(mesh.bindMatrixInverse, bone)
						.multiply(mesh.bindMatrix)
						.premultiply(mesh.matrixWorld)
						.premultiply(fit)
					data.set(full.elements, (frame * bones + (offsets[m] as number) + j) * 16)
				}
			}
		}
	}
	const boneTexture = new THREE.DataTexture(data, bones * 4, totalFrames, THREE.RGBAFormat, THREE.FloatType)
	boneTexture.needsUpdate = true

	// one merged geometry: rest positions, normals, uvs and skin indices offset per mesh
	let vertexCount = 0
	for (const mesh of meshes) vertexCount += mesh.geometry.attributes.position?.count ?? 0
	const position = new Float32Array(vertexCount * 3)
	const normal = new Float32Array(vertexCount * 3)
	const uv = new Float32Array(vertexCount * 2)
	const skinIndex = new Float32Array(vertexCount * 4)
	const skinWeight = new Float32Array(vertexCount * 4)
	const index: number[] = []
	const materials: THREE.Material[] = []
	const geometry = new THREE.BufferGeometry()
	let offset = 0
	for (const [m, mesh] of meshes.entries()) {
		const g = mesh.geometry
		const count = g.attributes.position?.count ?? 0
		// read through the attribute (not its array): models may store vertices interleaved or quantised
		const copy = (
			attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
			into: Float32Array,
			size: number
		) => {
			if (!attribute) return
			for (let v = 0; v < count; v++)
				for (let k = 0; k < size; k++) into[(offset + v) * size + k] = attribute.getComponent(v, k)
		}
		copy(g.attributes.position as THREE.BufferAttribute, position, 3)
		copy(g.attributes.normal as THREE.BufferAttribute, normal, 3)
		copy(g.attributes.uv as THREE.BufferAttribute | undefined, uv, 2)
		const si = g.attributes.skinIndex as THREE.BufferAttribute
		const sw = g.attributes.skinWeight as THREE.BufferAttribute
		for (let v = 0; v < count; v++) {
			for (let k = 0; k < 4; k++) {
				skinIndex[(offset + v) * 4 + k] = si.getComponent(v, k) + (offsets[m] as number)
				skinWeight[(offset + v) * 4 + k] = sw.getComponent(v, k)
			}
		}
		const start = index.length
		const source = g.index ? g.index.array : Array.from({ length: count }, (_, i) => i)
		for (let i = 0; i < source.length; i++) index.push((source[i] as number) + offset)
		geometry.addGroup(start, index.length - start, materials.length)
		materials.push(Array.isArray(mesh.material) ? (mesh.material[0] as THREE.Material) : mesh.material)
		offset += count
	}
	geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
	geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
	geometry.setAttribute('aSkinI', new THREE.BufferAttribute(skinIndex, 4))
	geometry.setAttribute('aSkinW', new THREE.BufferAttribute(skinWeight, 4))
	geometry.setIndex(index)
	return {
		geometry,
		materials,
		boneTexture,
		clips: { walk: clips[0] as Clip, run: clips[1] as Clip, attack: clips[2] as Clip, death: clips[3] as Clip }
	}
}

const HEADER = /* glsl */ `
uniform highp sampler2D batTex; uniform float batTime;
attribute vec4 aAnim; attribute vec4 aSkinI; attribute vec4 aSkinW;
mat4 batBone(int f, float j) { int x = int(j) * 4; return mat4(texelFetch(batTex, ivec2(x, f), 0), texelFetch(batTex, ivec2(x + 1, f), 0), texelFetch(batTex, ivec2(x + 2, f), 0), texelFetch(batTex, ivec2(x + 3, f), 0)); }
mat4 batSkin(int f) { return aSkinW.x * batBone(f, aSkinI.x) + aSkinW.y * batBone(f, aSkinI.y) + aSkinW.z * batBone(f, aSkinI.z) + aSkinW.w * batBone(f, aSkinI.w); }
`
// aAnim: first frame, frame count, then (looping) a phase and frames per second, or (played once,
// for a body falling) the time it started and frames per second
// `blend` mixes the two nearest baked frames (smooth, twice the texture reads); without it the
// nearest frame is drawn, which at 30 baked frames a second is hard to tell apart and much cheaper
const FETCH = (withNormal: boolean, once: boolean, blend: boolean) => /* glsl */ `
${
	once
		? 'float batF = clamp((batTime - aAnim.z) * aAnim.w, 0.0, aAnim.y - 1.001);\nint batF0 = int(floor(batF)); int batF1 = min(batF0 + 1, int(aAnim.y) - 1); float batT = fract(batF);'
		: 'float batF = mod(aAnim.z * aAnim.y + batTime * aAnim.w, aAnim.y);\nint batF0 = int(floor(batF)); int batF1 = (batF0 + 1) % int(aAnim.y); float batT = fract(batF);'
}
${blend ? 'mat4 batM = batSkin(int(aAnim.x) + batF0) * (1.0 - batT) + batSkin(int(aAnim.x) + batF1) * batT;' : 'mat4 batM = batSkin(int(aAnim.x) + (batT < 0.5 ? batF0 : batF1));'}
vec3 batP = (batM * vec4(position, 1.0)).xyz;
${withNormal ? 'vec3 objectNormal = normalize(mat3(batM) * normal);' : ''}
`

/** Draws every visible zombie as one instanced, GPU-skinned mesh. */
const MARKED = new THREE.Color(0xff3a2a)
const STUNNED = new THREE.Color(0x6fb8ff)
const POISONED = new THREE.Color(0x9fe04a)
const SLOWED = new THREE.Color(0x9fd8e8)
const BURNING = new THREE.Color(0xff7a2a)
const DAZED = new THREE.Color(0xd8d0b0)
/** mutated flesh goes sickly and dark, more with every stage; a strain grows a pale crust */
const MUTATED = new THREE.Color(0x6d7a3a)
const CRUST = new THREE.Color(0xd9d2b8)
/** a zombie's own glow, by type: a Retcher's throat */
/** each kind's look beyond tint and size: build, glow, shoulder plates, sacs on the back */
const GLOWS = zombieDefs.map(def =>
	def.look?.glow ? { ...def.look.glow, color: new THREE.Color(def.look.glow.colour) } : null
)
const SACS = zombieDefs.map(def => (def.look?.sacs ? new THREE.Color(def.look.sacs) : null))
const PLATES = zombieDefs.map(def => def.look?.plates === true)
const BUILD = zombieDefs.map(def => ({ width: def.look?.width ?? 1, height: def.look?.height ?? 1 }))
/** how many of each part may be drawn at once */
const PARTS = 128
/** who carries a shield, and how big it is for them */
const SHIELDS = zombieDefs.map(def => (def.shield ? def.scale : 0))

export class ZombieRenderer {
	readonly mesh: THREE.InstancedMesh
	/** the dead: each falls where it was killed and lies there a while */
	readonly corpses: THREE.InstancedMesh
	private readonly anim: THREE.InstancedBufferAttribute
	private readonly corpseAnim: THREE.InstancedBufferAttribute
	/** per body: x, y, facing, type, when it fell (seconds) */
	private readonly bodies: Float32Array
	private readonly maxBodies: number
	private bodyCount = 0
	private bodyHead = 0
	/** per zombie slot, where it was last drawn: x, y, facing */
	private readonly lastSeen = new Float32Array(MAX_ZOMBIES * 3)
	private time = 0
	private readonly uniforms: { batTex: { value: THREE.DataTexture }; batTime: { value: number } }
	private readonly clips: Baked['clips']
	private readonly matrix = new THREE.Matrix4()
	private readonly quaternion = new THREE.Quaternion()
	private readonly position = new THREE.Vector3()
	private readonly scale = new THREE.Vector3()
	private readonly color = new THREE.Color()
	private readonly up = new THREE.Vector3(0, 1, 0)
	// the model is already painted (skin, rags, blood): the type's tint only shifts it a little
	private readonly tints = zombieDefs.map(def => new THREE.Color(0xffffff).lerp(new THREE.Color(def.tint), 0.4))

	/** a mound of earth over each zombie under the ground, shields carried in front, a Retcher's throat */
	readonly extras = new THREE.Group()
	private readonly mounds: THREE.InstancedMesh
	private readonly shields: THREE.InstancedMesh
	private readonly glows: THREE.InstancedMesh
	private readonly plates: THREE.InstancedMesh
	private readonly sacs: THREE.InstancedMesh
	private readonly side = new THREE.Vector3()

	/** how far the horde has mutated (0 to 3) */
	mutation = 0

	private readonly frustum = new THREE.Frustum()
	private readonly viewMatrix = new THREE.Matrix4()
	private readonly sphere = new THREE.Sphere()

	private constructor(baked: Baked, detail: ZombieDetail) {
		this.clips = baked.clips
		this.maxBodies = CORPSES[detail]
		this.bodies = new Float32Array(this.maxBodies * 5)
		const blend = detail === 'high'
		this.uniforms = { batTex: { value: baked.boneTexture }, batTime: { value: 0 } }
		const patch = <T extends THREE.Material>(material: T, depth: boolean, once: boolean): T => {
			material.onBeforeCompile = shader => {
				Object.assign(shader.uniforms, this.uniforms)
				shader.vertexShader = HEADER + shader.vertexShader
				shader.vertexShader = depth
					? shader.vertexShader.replace(
							'#include <begin_vertex>',
							`${FETCH(false, once, blend)}\nvec3 transformed = batP;`
						)
					: shader.vertexShader
							.replace('#include <beginnormal_vertex>', FETCH(true, once, blend))
							.replace('#include <begin_vertex>', 'vec3 transformed = batP;')
			}
			material.customProgramCacheKey = () =>
				`rotline-zombie${depth ? '-depth' : ''}${once ? '-once' : ''}${blend ? '-blend' : ''}`
			return material
		}
		// the living and the dead share one geometry's vertices, each with its own animation attribute
		const instanced = (count: number, once: boolean) => {
			const geometry = new THREE.BufferGeometry()
			for (const [name, attribute] of Object.entries(baked.geometry.attributes)) geometry.setAttribute(name, attribute)
			geometry.setIndex(baked.geometry.index)
			for (const group of baked.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex)
			const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
			anim.setUsage(THREE.DynamicDrawUsage)
			geometry.setAttribute('aAnim', anim)
			const materials = baked.materials.map(material => {
				const copy = material.clone()
				// the baked geometry carries no vertex colours (a model with COLOR_0 would otherwise draw black)
				copy.vertexColors = false
				return patch(copy, false, once)
			})
			const mesh = new THREE.InstancedMesh(geometry, materials, count)
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
			mesh.frustumCulled = false
			// the living cast shadows on capable devices; bodies on the ground hardly would
			mesh.castShadow = !once && detail === 'high'
			mesh.count = 0
			mesh.customDepthMaterial = patch(
				new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
				true,
				once
			)
			for (let i = 0; i < count; i++) mesh.setColorAt(i, this.color.set(0xffffff))
			return { mesh, anim }
		}
		const living = instanced(MAX_ZOMBIES, false)
		this.mesh = living.mesh
		this.anim = living.anim
		const dead = instanced(this.maxBodies, true)
		this.corpses = dead.mesh
		this.corpseAnim = dead.anim
		this.corpses.receiveShadow = true

		const mound = new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)
		this.mounds = new THREE.InstancedMesh(
			mound,
			new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }),
			MAX_ZOMBIES
		)
		// a riot shield: a slab with a little give at the edges, dark steel with a scratched face
		const slab = new THREE.BoxGeometry(0.85, 1.25, 0.07).translate(0, 0.85, 0)
		this.shields = new THREE.InstancedMesh(
			slab,
			new THREE.MeshStandardMaterial({ color: 0x39434c, roughness: 0.55, metalness: 0.7 }),
			64
		)
		this.shields.castShadow = detail === 'high'
		const glowing = () =>
			new THREE.MeshBasicMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.85,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			})
		this.glows = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), glowing(), PARTS)
		// sacs are swollen flesh, not lights: solid, a little glossy
		this.sacs = new THREE.InstancedMesh(
			new THREE.SphereGeometry(0.085, 10, 8),
			new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0 }),
			PARTS * 3
		)
		// riot plates over each shoulder: dark steel, scuffed
		this.plates = new THREE.InstancedMesh(
			new THREE.BoxGeometry(0.16, 0.06, 0.2),
			new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: 0.5, metalness: 0.75 }),
			PARTS * 2
		)
		this.plates.castShadow = detail === 'high'
		for (const mesh of [this.mounds, this.shields, this.glows, this.sacs, this.plates]) {
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
			mesh.frustumCulled = false
			mesh.count = 0
		}
		this.mounds.receiveShadow = true
		this.extras.add(this.mounds, this.shields, this.glows, this.sacs, this.plates)
	}

	static async load(url: string, detail: ZombieDetail = 'high'): Promise<ZombieRenderer> {
		const gltf = await new GLTFLoader().loadAsync(url)
		return new ZombieRenderer(bake(gltf.scene, gltf.animations), detail)
	}

	/** Is a figure at (x, y) of this size in the camera's view? (Off-screen ones are not drawn.) */
	private inView(x: number, y: number, size: number): boolean {
		this.sphere.center.set(x, 0.9 * size, y)
		this.sphere.radius = 1.4 * size
		return this.frustum.intersectsSphere(this.sphere)
	}

	/**
	 * The holes zombies come out of (the map's spawn points): a zombie that appears next to one
	 * climbs out of the ground instead of popping into being.
	 */
	setSpawnHoles(points: readonly { x: number; y: number }[]): void {
		this.holes = points
	}
	private holes: readonly { x: number; y: number }[] = []
	/** per zombie slot: seen last frame, and when it climbed out (seconds; 0 = it walked in) */
	private readonly seen = new Uint8Array(MAX_ZOMBIES)
	private readonly seenNow = new Uint8Array(MAX_ZOMBIES)
	private readonly bornAt = new Float64Array(MAX_ZOMBIES)

	private nearHole(x: number, y: number): boolean {
		for (const hole of this.holes) if (Math.abs(hole.x - x) < 1.6 && Math.abs(hole.y - y) < 1.6) return true
		return false
	}

	/**
	 * A zombie died: its body falls where it was (facing the way it last faced) and stays a while.
	 * `slot` is the zombie's index, `x`, `y` where the server says it died.
	 */
	fall(slot: number, type: number, x: number, y: number): void {
		const facing = slot < MAX_ZOMBIES ? (this.lastSeen[slot * 3 + 2] as number) : Math.random() * Math.PI * 2
		const i = this.bodyHead
		this.bodyHead = (i + 1) % this.maxBodies
		this.bodyCount = Math.min(this.maxBodies, this.bodyCount + 1)
		this.bodies.set([x, y, facing, type, this.time], i * 5)
	}

	/**
	 * Draws this frame's zombies. With a camera, only those in its view are sent to the GPU (each one
	 * is skinned in the vertex shader, once more for its shadow): a big horde mostly off screen costs
	 * little.
	 */
	update(view: ZombieView, timeSeconds: number, camera?: THREE.Camera): void {
		this.uniforms.batTime.value = timeSeconds
		this.time = timeSeconds
		if (camera) {
			camera.updateMatrixWorld()
			this.frustum.setFromProjectionMatrix(
				this.viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
			)
		}
		const culled = camera !== undefined
		this.updateCorpses(timeSeconds, culled)
		this.seenNow.fill(0)
		let drawn = 0
		let mounds = 0
		let shields = 0
		let glows = 0
		let sacs = 0
		let plates = 0
		for (let i = 0; i < view.count; i++) {
			const type = view.type[i] as number
			const def = zombieDefs[type]
			const state = view.state[i] as number
			const attacking = state === ZombieState.attacking || state === ZombieState.windup
			const charging = state === ZombieState.charging
			const clip = attacking
				? this.clips.attack
				: charging || (def && def.speed > 2.5)
					? this.clips.run
					: this.clips.walk
			// a stable per-zombie phase so the horde does not step in unison
			const phase = (((view.index[i] as number) * 0.6180339887) % 1) as number
			const speed = charging
				? 2.2
				: state === ZombieState.windup
					? 0.6
					: state === ZombieState.dazed
						? 0.35
						: attacking
							? 1.2
							: def
								? Math.min(1.6, 0.6 + def.speed / 3)
								: 1
			const size = def?.scale ?? 1
			const slot = view.index[i] as number
			this.seenNow[slot] = 1
			this.lastSeen[slot * 3] = view.x[i] as number
			this.lastSeen[slot * 3 + 1] = view.y[i] as number
			this.lastSeen[slot * 3 + 2] = view.facing[i] as number
			if (this.seen[slot] === 0)
				this.bornAt[slot] = this.nearHole(view.x[i] as number, view.y[i] as number) ? timeSeconds : 0
			if (culled && !this.inView(view.x[i] as number, view.y[i] as number, size)) continue
			// under the ground: only the earth it heaves up shows, trembling harder just before it bursts out
			if (state === ZombieState.under || state === ZombieState.erupting) {
				const erupting = state === ZombieState.erupting
				const wobble = 1 + Math.sin(timeSeconds * (erupting ? 40 : 9) + phase * 6) * (erupting ? 0.18 : 0.08)
				this.matrix.compose(
					this.position.set(view.x[i] as number, -0.12, view.y[i] as number),
					this.quaternion.setFromAxisAngle(this.up, phase * 6),
					this.scale.set(size * wobble * (erupting ? 1.5 : 1), size * (erupting ? 0.7 : 0.45), size * wobble)
				)
				this.mounds.setMatrixAt(mounds++, this.matrix)
				continue
			}
			const n = drawn++
			const base = n * 4
			this.anim.array[base] = clip.start
			this.anim.array[base + 1] = clip.frames
			this.anim.array[base + 2] = phase
			this.anim.array[base + 3] = clip.fps * speed

			// sim (x, y) maps to world (x, z); the model faces +z
			this.quaternion.setFromAxisAngle(this.up, Math.PI / 2 - (view.facing[i] as number))
			// one that just appeared at a hole climbs out of it over EMERGE seconds
			const rising = (timeSeconds - (this.bornAt[slot] as number)) / EMERGE
			const below = rising < 1 && this.bornAt[slot] !== 0 ? (1 - rising) ** 2 * 1.7 * size : 0
			const build = BUILD[type] ?? { width: 1, height: 1 }
			this.matrix.compose(
				this.position.set(view.x[i] as number, -below, view.y[i] as number),
				this.quaternion,
				this.scale.set(size * build.width, size * build.height, size * build.width)
			)
			this.mesh.setMatrixAt(n, this.matrix)
			const facing = view.facing[i] as number
			const fx = Math.cos(facing)
			const fy = Math.sin(facing)
			const tall = size * build.height
			const wide = size * build.width
			// plates over both shoulders
			if (PLATES[type] && plates < PARTS * 2 - 1)
				for (const hand of [-1, 1]) {
					this.matrix.compose(
						this.position.set(
							(view.x[i] as number) - fy * hand * 0.16 * wide,
							1.4 * tall - below,
							(view.y[i] as number) + fx * hand * 0.16 * wide
						),
						this.quaternion,
						this.scale.set(wide, size, wide)
					)
					this.plates.setMatrixAt(plates++, this.matrix)
				}
			// sacs on the back, swelling and easing
			const sac = SACS[type]
			if (sac && sacs < PARTS * 3 - 2)
				for (let k = 0; k < 3; k++) {
					const swell = 1 + Math.sin(timeSeconds * 2.2 + phase * 6 + k * 2) * 0.12
					this.side.set(-fy * (k - 1) * 0.09, 0, fx * (k - 1) * 0.09)
					this.matrix.compose(
						this.position.set(
							(view.x[i] as number) - fx * 0.13 * wide + this.side.x * wide,
							(1.15 + (k === 1 ? 0.1 : 0)) * tall - below,
							(view.y[i] as number) - fy * 0.13 * wide + this.side.z * wide
						),
						this.quaternion,
						this.scale.setScalar(size * swell * (k === 1 ? 1.25 : 1))
					)
					this.sacs.setMatrixAt(sacs, this.matrix)
					this.sacs.setColorAt(sacs, sac)
					sacs++
				}
			// a shield held in front, the way it faces (dropped low while it stands dazed)
			const shieldSize = SHIELDS[type] ?? 0
			if (shieldSize > 0 && shields < 64) {
				const ahead = 0.45 * shieldSize
				const dazed = state === ZombieState.dazed
				this.matrix.compose(
					this.position.set(
						(view.x[i] as number) + Math.cos(facing) * ahead,
						dazed ? -0.45 * shieldSize : -below,
						(view.y[i] as number) + Math.sin(facing) * ahead
					),
					this.quaternion,
					this.scale.set(shieldSize, shieldSize, shieldSize)
				)
				this.shields.setMatrixAt(shields++, this.matrix)
			}
			// its glow (a Retcher's throat, a Cinder's chest), brighter as it winds up
			const glow = GLOWS[type]
			if (glow && glows < PARTS) {
				const pulse =
					state === ZombieState.windup
						? 1.8 + Math.sin(timeSeconds * 30) * 0.4
						: 1 + Math.sin(timeSeconds * 3 + phase * 6) * 0.08
				this.matrix.compose(
					this.position.set(
						(view.x[i] as number) + fx * glow.ahead * size,
						glow.up * tall - below,
						(view.y[i] as number) + fy * glow.ahead * size
					),
					this.quaternion,
					this.scale.setScalar(pulse * size * glow.size)
				)
				this.glows.setMatrixAt(glows, this.matrix)
				this.glows.setColorAt(glows, glow.color)
				glows++
			}
			// wounded zombies darken slightly; statuses tint them (stunned blue, marked red, poisoned green)
			const health = (view.health[i] as number) / 255
			this.color.copy(this.tints[type] ?? this.color.set(0xffffff)).multiplyScalar(0.55 + 0.45 * health)
			const status = view.status[i] as number
			if (status & ZombieStatus.marked) this.color.lerp(MARKED, 0.55)
			else if (status & ZombieStatus.stunned) this.color.lerp(STUNNED, 0.6)
			else if (status & ZombieStatus.poisoned) this.color.lerp(POISONED, 0.45)
			else if (status & ZombieStatus.slowed) this.color.lerp(SLOWED, 0.35)
			// burning: scorched dark, lit orange by its own flames
			if (status & ZombieStatus.burning) this.color.multiplyScalar(0.55).lerp(BURNING, 0.25)
			if (state === ZombieState.dazed) this.color.lerp(DAZED, 0.35 + 0.2 * Math.sin(timeSeconds * 12))
			if (this.mutation > 0 && !def?.boss) this.color.lerp(MUTATED, 0.12 * this.mutation)
			if (status & ZombieStatus.strain) this.color.lerp(CRUST, 0.45)
			this.mesh.setColorAt(n, this.color)
		}
		this.mounds.count = mounds
		this.shields.count = shields
		this.glows.count = glows
		this.sacs.count = sacs
		this.plates.count = plates
		for (const mesh of [this.mounds, this.shields, this.glows, this.sacs, this.plates])
			mesh.instanceMatrix.needsUpdate = true
		for (const mesh of [this.glows, this.sacs]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
		this.seen.set(this.seenNow)
		this.mesh.count = drawn
		this.mesh.instanceMatrix.needsUpdate = true
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
		this.anim.needsUpdate = true
	}

	private updateCorpses(now: number, culled: boolean): void {
		const death = this.clips.death
		let shown = 0
		for (let k = 0; k < this.bodyCount; k++) {
			const o = k * 5
			const age = now - (this.bodies[o + 4] as number)
			// the time base moved back (a new game on the same renderer): drop the old bodies
			if (age < 0 || age > CORPSE_SECONDS + CORPSE_SINK) continue
			const type = this.bodies[o + 3] as number
			const size = zombieDefs[type]?.scale ?? 1
			if (culled && !this.inView(this.bodies[o] as number, this.bodies[o + 1] as number, size)) continue
			const sink = Math.max(0, age - CORPSE_SECONDS) / CORPSE_SINK
			this.quaternion.setFromAxisAngle(this.up, Math.PI / 2 - (this.bodies[o + 2] as number))
			this.matrix.compose(
				this.position.set(this.bodies[o] as number, -sink * 0.5 * size, this.bodies[o + 1] as number),
				this.quaternion,
				this.scale.set(
					size * (BUILD[type]?.width ?? 1),
					size * (BUILD[type]?.height ?? 1),
					size * (BUILD[type]?.width ?? 1)
				)
			)
			this.corpses.setMatrixAt(shown, this.matrix)
			this.color.copy(this.tints[type] ?? this.color.set(0xffffff)).multiplyScalar(0.6)
			this.corpses.setColorAt(shown, this.color)
			const base = shown * 4
			this.corpseAnim.array[base] = death.start
			this.corpseAnim.array[base + 1] = death.frames
			this.corpseAnim.array[base + 2] = this.bodies[o + 4] as number
			this.corpseAnim.array[base + 3] = death.fps * 1.2
			shown++
		}
		this.corpses.count = shown
		this.corpses.instanceMatrix.needsUpdate = true
		if (this.corpses.instanceColor) this.corpses.instanceColor.needsUpdate = true
		this.corpseAnim.needsUpdate = true
	}
}
