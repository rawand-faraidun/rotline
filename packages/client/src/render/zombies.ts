import { zombies as zombieDefs } from '@rotline/game-data'
import { ZombieStatus } from '@rotline/protocol'
import { MAX_ZOMBIES, ZombieState } from '@rotline/sim'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { ZombieView } from '../interpolate.ts'

const BAKE_FPS = 30

type Clip = { start: number; frames: number; fps: number }

type Baked = {
	geometry: THREE.BufferGeometry
	materials: THREE.Material[]
	boneTexture: THREE.DataTexture
	clips: { walk: Clip; run: Clip; attack: Clip }
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
	const chosen = { walk: pick('walk'), run: pick('run'), attack: pick('bite') }
	const order = [chosen.walk, chosen.run, chosen.attack]
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
		position.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, offset * 3)
		normal.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, offset * 3)
		if (g.attributes.uv) uv.set((g.attributes.uv as THREE.BufferAttribute).array as Float32Array, offset * 2)
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
		clips: { walk: clips[0] as Clip, run: clips[1] as Clip, attack: clips[2] as Clip }
	}
}

const HEADER = /* glsl */ `
uniform highp sampler2D batTex; uniform float batTime;
attribute vec4 aAnim; attribute vec4 aSkinI; attribute vec4 aSkinW;
mat4 batBone(int f, float j) { int x = int(j) * 4; return mat4(texelFetch(batTex, ivec2(x, f), 0), texelFetch(batTex, ivec2(x + 1, f), 0), texelFetch(batTex, ivec2(x + 2, f), 0), texelFetch(batTex, ivec2(x + 3, f), 0)); }
mat4 batSkin(int f) { return aSkinW.x * batBone(f, aSkinI.x) + aSkinW.y * batBone(f, aSkinI.y) + aSkinW.z * batBone(f, aSkinI.z) + aSkinW.w * batBone(f, aSkinI.w); }
`
const FETCH = (withNormal: boolean) => /* glsl */ `
float batF = mod(aAnim.z * aAnim.y + batTime * aAnim.w, aAnim.y);
int batF0 = int(floor(batF)); int batF1 = (batF0 + 1) % int(aAnim.y); float batT = fract(batF);
mat4 batM = batSkin(int(aAnim.x) + batF0) * (1.0 - batT) + batSkin(int(aAnim.x) + batF1) * batT;
vec3 batP = (batM * vec4(position, 1.0)).xyz;
${withNormal ? 'vec3 objectNormal = normalize(mat3(batM) * normal);' : ''}
`

/** Draws every visible zombie as one instanced, GPU-skinned mesh. */
const MARKED = new THREE.Color(0xff3a2a)
const STUNNED = new THREE.Color(0x6fb8ff)
const POISONED = new THREE.Color(0x9fe04a)
const SLOWED = new THREE.Color(0x9fd8e8)

export class ZombieRenderer {
	readonly mesh: THREE.InstancedMesh
	private readonly anim: THREE.InstancedBufferAttribute
	private readonly uniforms: { batTex: { value: THREE.DataTexture }; batTime: { value: number } }
	private readonly clips: Baked['clips']
	private readonly matrix = new THREE.Matrix4()
	private readonly quaternion = new THREE.Quaternion()
	private readonly position = new THREE.Vector3()
	private readonly scale = new THREE.Vector3()
	private readonly color = new THREE.Color()
	private readonly up = new THREE.Vector3(0, 1, 0)
	private readonly tints = zombieDefs.map(def => new THREE.Color(def.tint))

	private constructor(baked: Baked) {
		this.clips = baked.clips
		this.uniforms = { batTex: { value: baked.boneTexture }, batTime: { value: 0 } }
		const patch = <T extends THREE.Material>(material: T, depth: boolean): T => {
			material.onBeforeCompile = shader => {
				Object.assign(shader.uniforms, this.uniforms)
				shader.vertexShader = HEADER + shader.vertexShader
				shader.vertexShader = depth
					? shader.vertexShader.replace('#include <begin_vertex>', `${FETCH(false)}\nvec3 transformed = batP;`)
					: shader.vertexShader
							.replace('#include <beginnormal_vertex>', FETCH(true))
							.replace('#include <begin_vertex>', 'vec3 transformed = batP;')
			}
			material.customProgramCacheKey = () => (depth ? 'rotline-zombie-depth' : 'rotline-zombie')
			return material
		}
		this.anim = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ZOMBIES * 4), 4)
		this.anim.setUsage(THREE.DynamicDrawUsage)
		baked.geometry.setAttribute('aAnim', this.anim)
		const materials = baked.materials.map(material => patch(material.clone(), false))
		this.mesh = new THREE.InstancedMesh(baked.geometry, materials, MAX_ZOMBIES)
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this.mesh.frustumCulled = false
		this.mesh.castShadow = true
		this.mesh.count = 0
		this.mesh.customDepthMaterial = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), true)
		for (let i = 0; i < MAX_ZOMBIES; i++) this.mesh.setColorAt(i, this.color.set(0xffffff))
	}

	static async load(url: string): Promise<ZombieRenderer> {
		const gltf = await new GLTFLoader().loadAsync(url)
		return new ZombieRenderer(bake(gltf.scene, gltf.animations))
	}

	update(view: ZombieView, timeSeconds: number): void {
		this.uniforms.batTime.value = timeSeconds
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
			this.matrix.compose(
				this.position.set(view.x[n] as number, 0, view.y[n] as number),
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
			this.mesh.setColorAt(n, this.color)
		}
		this.mesh.count = view.count
		this.mesh.instanceMatrix.needsUpdate = true
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
		this.anim.needsUpdate = true
	}
}
