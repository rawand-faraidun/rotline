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
/** bodies kept at once; the oldest goes first */
const CORPSES = 160

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
const FETCH = (withNormal: boolean, once: boolean) => /* glsl */ `
${
	once
		? 'float batF = clamp((batTime - aAnim.z) * aAnim.w, 0.0, aAnim.y - 1.001);\nint batF0 = int(floor(batF)); int batF1 = min(batF0 + 1, int(aAnim.y) - 1); float batT = fract(batF);'
		: 'float batF = mod(aAnim.z * aAnim.y + batTime * aAnim.w, aAnim.y);\nint batF0 = int(floor(batF)); int batF1 = (batF0 + 1) % int(aAnim.y); float batT = fract(batF);'
}
mat4 batM = batSkin(int(aAnim.x) + batF0) * (1.0 - batT) + batSkin(int(aAnim.x) + batF1) * batT;
vec3 batP = (batM * vec4(position, 1.0)).xyz;
${withNormal ? 'vec3 objectNormal = normalize(mat3(batM) * normal);' : ''}
`

/** Draws every visible zombie as one instanced, GPU-skinned mesh. */
const MARKED = new THREE.Color(0xff3a2a)
const STUNNED = new THREE.Color(0x6fb8ff)
const POISONED = new THREE.Color(0x9fe04a)
const SLOWED = new THREE.Color(0x9fd8e8)
const BURNING = new THREE.Color(0xff7a2a)

export class ZombieRenderer {
	readonly mesh: THREE.InstancedMesh
	/** the dead: each falls where it was killed and lies there a while */
	readonly corpses: THREE.InstancedMesh
	private readonly anim: THREE.InstancedBufferAttribute
	private readonly corpseAnim: THREE.InstancedBufferAttribute
	/** per body: x, y, facing, type, when it fell (seconds) */
	private readonly bodies = new Float32Array(CORPSES * 5)
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

	private constructor(baked: Baked) {
		this.clips = baked.clips
		this.uniforms = { batTex: { value: baked.boneTexture }, batTime: { value: 0 } }
		const patch = <T extends THREE.Material>(material: T, depth: boolean, once: boolean): T => {
			material.onBeforeCompile = shader => {
				Object.assign(shader.uniforms, this.uniforms)
				shader.vertexShader = HEADER + shader.vertexShader
				shader.vertexShader = depth
					? shader.vertexShader.replace('#include <begin_vertex>', `${FETCH(false, once)}\nvec3 transformed = batP;`)
					: shader.vertexShader
							.replace('#include <beginnormal_vertex>', FETCH(true, once))
							.replace('#include <begin_vertex>', 'vec3 transformed = batP;')
			}
			material.customProgramCacheKey = () => `rotline-zombie${depth ? '-depth' : ''}${once ? '-once' : ''}`
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
			mesh.castShadow = true
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
		const dead = instanced(CORPSES, true)
		this.corpses = dead.mesh
		this.corpseAnim = dead.anim
		this.corpses.receiveShadow = true
	}

	static async load(url: string): Promise<ZombieRenderer> {
		const gltf = await new GLTFLoader().loadAsync(url)
		return new ZombieRenderer(bake(gltf.scene, gltf.animations))
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
		this.bodyHead = (i + 1) % CORPSES
		this.bodyCount = Math.min(CORPSES, this.bodyCount + 1)
		this.bodies.set([x, y, facing, type, this.time], i * 5)
	}

	update(view: ZombieView, timeSeconds: number): void {
		this.uniforms.batTime.value = timeSeconds
		this.time = timeSeconds
		this.updateCorpses(timeSeconds)
		this.seenNow.fill(0)
		for (let n = 0; n < view.count; n++) {
			const type = view.type[n] as number
			const def = zombieDefs[type]
			const attacking = view.state[n] === ZombieState.attacking
			const clip = attacking ? this.clips.attack : def && def.speed > 2.5 ? this.clips.run : this.clips.walk
			// a stable per-zombie phase so the horde does not step in unison
			const phase = (((view.index[n] as number) * 0.6180339887) % 1) as number
			const speed = attacking ? 1.2 : def ? Math.min(1.6, 0.6 + def.speed / 3) : 1
			const base = n * 4
			this.anim.array[base] = clip.start
			this.anim.array[base + 1] = clip.frames
			this.anim.array[base + 2] = phase
			this.anim.array[base + 3] = clip.fps * speed

			// sim (x, y) maps to world (x, z); the model faces +z
			this.quaternion.setFromAxisAngle(this.up, Math.PI / 2 - (view.facing[n] as number))
			const size = def?.scale ?? 1
			// one that just appeared at a hole climbs out of it over EMERGE seconds
			const slot = view.index[n] as number
			this.seenNow[slot] = 1
			this.lastSeen[slot * 3] = view.x[n] as number
			this.lastSeen[slot * 3 + 1] = view.y[n] as number
			this.lastSeen[slot * 3 + 2] = view.facing[n] as number
			if (this.seen[slot] === 0)
				this.bornAt[slot] = this.nearHole(view.x[n] as number, view.y[n] as number) ? timeSeconds : 0
			const rising = (timeSeconds - (this.bornAt[slot] as number)) / EMERGE
			const below = rising < 1 && this.bornAt[slot] !== 0 ? (1 - rising) ** 2 * 1.7 * size : 0
			this.matrix.compose(
				this.position.set(view.x[n] as number, -below, view.y[n] as number),
				this.quaternion,
				this.scale.set(size, size, size)
			)
			this.mesh.setMatrixAt(n, this.matrix)
			// wounded zombies darken slightly; statuses tint them (stunned blue, marked red, poisoned green)
			const health = (view.health[n] as number) / 255
			this.color.copy(this.tints[type] ?? this.color.set(0xffffff)).multiplyScalar(0.55 + 0.45 * health)
			const status = view.status[n] as number
			if (status & ZombieStatus.marked) this.color.lerp(MARKED, 0.55)
			else if (status & ZombieStatus.stunned) this.color.lerp(STUNNED, 0.6)
			else if (status & ZombieStatus.poisoned) this.color.lerp(POISONED, 0.45)
			else if (status & ZombieStatus.slowed) this.color.lerp(SLOWED, 0.35)
			// burning: scorched dark, lit orange by its own flames
			if (status & ZombieStatus.burning) this.color.multiplyScalar(0.55).lerp(BURNING, 0.25)
			this.mesh.setColorAt(n, this.color)
		}
		this.seen.set(this.seenNow)
		this.mesh.count = view.count
		this.mesh.instanceMatrix.needsUpdate = true
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
		this.anim.needsUpdate = true
	}

	private updateCorpses(now: number): void {
		const death = this.clips.death
		let shown = 0
		for (let k = 0; k < this.bodyCount; k++) {
			const o = k * 5
			const age = now - (this.bodies[o + 4] as number)
			// the time base moved back (a new game on the same renderer): drop the old bodies
			if (age < 0 || age > CORPSE_SECONDS + CORPSE_SINK) continue
			const type = this.bodies[o + 3] as number
			const size = zombieDefs[type]?.scale ?? 1
			const sink = Math.max(0, age - CORPSE_SECONDS) / CORPSE_SINK
			this.quaternion.setFromAxisAngle(this.up, Math.PI / 2 - (this.bodies[o + 2] as number))
			this.matrix.compose(
				this.position.set(this.bodies[o] as number, -sink * 0.5 * size, this.bodies[o + 1] as number),
				this.quaternion,
				this.scale.set(size, size, size)
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
