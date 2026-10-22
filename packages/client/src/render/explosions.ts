import * as THREE from 'three'
import { EFFECTS_LAYER } from './post.ts'

/**
 * Explosions: a fireball of billowing flame that swells and burns out, black smoke rolling up
 * after it, a ring of dust thrown along the ground, burning debris arcing out, and a scorch mark
 * left behind. Everything is pooled particles drawn as camera-facing quads (one draw call for the
 * glowing ones, one for the smoke), so a barrage costs no allocations.
 */

const GLOW = 512
const SMOKE = 512
const SCORCHES = 32
const SCORCH_SECONDS = 45

/** A soft, lumpy puff (fractal noise inside a round falloff), grey on transparent. */
function puffTexture(seed: number): THREE.CanvasTexture {
	const size = 128
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const image = ctx.createImageData(size, size)
	// value noise on a few octaves
	let state = seed
	const random = () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 4294967296
	}
	const grids = [4, 8, 16, 32].map(cells => {
		const values = Float32Array.from({ length: (cells + 1) * (cells + 1) }, random)
		return { cells, values }
	})
	const sample = (grid: { cells: number; values: Float32Array }, u: number, v: number) => {
		const x = u * grid.cells
		const y = v * grid.cells
		const x0 = Math.floor(x)
		const y0 = Math.floor(y)
		const fx = x - x0
		const fy = y - y0
		const sx = fx * fx * (3 - 2 * fx)
		const sy = fy * fy * (3 - 2 * fy)
		const at = (i: number, j: number) => grid.values[j * (grid.cells + 1) + i] as number
		const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx
		const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx
		return top * (1 - sy) + bottom * sy
	}
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const u = x / size
			const v = y / size
			let noise = 0
			let weight = 0.5
			for (const grid of grids) {
				noise += sample(grid, u, v) * weight
				weight *= 0.5
			}
			const dx = u - 0.5
			const dy = v - 0.5
			const r = Math.sqrt(dx * dx + dy * dy) * 2
			// billows: the edge eaten by the noise, the middle full
			const edge = Math.max(0, 1 - r * (0.55 + (1 - noise) * 0.9))
			// and always gone before the square's edge, so no straight cut shows
			const fade = Math.max(0, 1 - r) ** 0.6
			const alpha = Math.min(1, edge ** 0.9 * 2.2) * fade
			// dark creases between bright billows
			const shade = 40 + Math.min(1, noise * 1.25) ** 2 * 215
			const o = (y * size + x) * 4
			image.data[o] = image.data[o + 1] = image.data[o + 2] = shade
			image.data[o + 3] = alpha * 255
		}
	ctx.putImageData(image, 0, 0)
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
}

/** A burn mark: a sooty core, ragged blotches round it, a few short streaks thrown outward. */
function scorchTexture(): THREE.CanvasTexture {
	const size = 256
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const c = size / 2
	const soot = (x: number, y: number, radius: number, alpha: number) => {
		const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
		gradient.addColorStop(0, `rgba(10,9,8,${alpha})`)
		gradient.addColorStop(0.6, `rgba(14,12,10,${alpha * 0.5})`)
		gradient.addColorStop(1, 'rgba(14,12,10,0)')
		ctx.fillStyle = gradient
		ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
	}
	soot(c, c, c * 0.62, 0.8)
	for (let n = 0; n < 30; n++) {
		const angle = Math.random() * Math.PI * 2
		const reach = c * (0.2 + Math.random() * 0.55)
		soot(c + Math.cos(angle) * reach, c + Math.sin(angle) * reach, c * (0.08 + Math.random() * 0.22), 0.35)
	}
	ctx.lineCap = 'round'
	for (let n = 0; n < 9; n++) {
		const angle = Math.random() * Math.PI * 2
		const from = c * (0.35 + Math.random() * 0.15)
		const to = from + c * (0.15 + Math.random() * 0.35)
		ctx.strokeStyle = `rgba(12,10,9,${0.15 + Math.random() * 0.2})`
		ctx.lineWidth = 3 + Math.random() * 9
		ctx.beginPath()
		ctx.moveTo(c + Math.cos(angle) * from, c + Math.sin(angle) * from)
		ctx.lineTo(c + Math.cos(angle) * to, c + Math.sin(angle) * to)
		ctx.stroke()
	}
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
}

const VERTEX = /* glsl */ `
attribute vec3 iPosition;
attribute vec4 iColor;
attribute vec2 iShape;
varying vec2 vUv;
varying vec4 vColor;
void main() {
	vUv = uv;
	vColor = iColor;
	vec4 view = modelViewMatrix * vec4(iPosition, 1.0);
	float c = cos(iShape.y);
	float s = sin(iShape.y);
	view.xy += mat2(c, s, -s, c) * position.xy * iShape.x;
	gl_Position = projectionMatrix * view;
}
`
const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
	vec4 texel = texture2D(map, vUv);
	gl_FragColor = vec4(vColor.rgb * texel.rgb, vColor.a * texel.a);
	#include <colorspace_fragment>
}
`

type Kind = 'fire' | 'spark' | 'smoke' | 'dust' | 'gas'

/** One pool of particles drawn as one instanced mesh. */
class Particles {
	readonly mesh: THREE.Mesh
	private readonly geometry: THREE.InstancedBufferGeometry
	private readonly position: THREE.InstancedBufferAttribute
	private readonly color: THREE.InstancedBufferAttribute
	private readonly shape: THREE.InstancedBufferAttribute
	/** per particle: x y z, vx vy vz, born, life, size from, size to, spin, kind, alpha, drag, rotation */
	private readonly state: Float32Array
	private readonly kinds: Kind[]
	private head = 0
	private static readonly STRIDE = 15

	private readonly count: number

	constructor(count: number, texture: THREE.Texture, additive: boolean) {
		this.count = count
		this.state = new Float32Array(count * Particles.STRIDE).fill(-1)
		this.kinds = new Array<Kind>(count).fill('fire')
		const base = new THREE.PlaneGeometry(1, 1)
		this.geometry = new THREE.InstancedBufferGeometry()
		this.geometry.setIndex(base.index)
		this.geometry.setAttribute('position', base.getAttribute('position'))
		this.geometry.setAttribute('uv', base.getAttribute('uv'))
		this.position = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage)
		this.color = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage)
		this.shape = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage)
		this.geometry.setAttribute('iPosition', this.position)
		this.geometry.setAttribute('iColor', this.color)
		this.geometry.setAttribute('iShape', this.shape)
		this.geometry.instanceCount = 0
		const material = new THREE.ShaderMaterial({
			uniforms: { map: { value: texture } },
			vertexShader: VERTEX,
			fragmentShader: FRAGMENT,
			transparent: true,
			depthWrite: false,
			blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
		})
		this.mesh = new THREE.Mesh(this.geometry, material)
		this.mesh.frustumCulled = false
		this.mesh.layers.set(EFFECTS_LAYER)
	}

	emit(
		kind: Kind,
		now: number,
		x: number,
		y: number,
		z: number,
		vx: number,
		vy: number,
		vz: number,
		life: number,
		sizeFrom: number,
		sizeTo: number,
		alpha = 1,
		drag = 0
	): void {
		const i = this.head
		this.head = (i + 1) % this.count
		this.kinds[i] = kind
		const spin = (Math.random() - 0.5) * 1.5
		this.state.set(
			[x, y, z, vx, vy, vz, now, life, sizeFrom, sizeTo, spin, 0, alpha, drag, Math.random() * Math.PI * 2],
			i * Particles.STRIDE
		)
	}

	update(now: number, dt: number): void {
		const s = this.state
		const position = this.position.array as Float32Array
		const color = this.color.array as Float32Array
		const shape = this.shape.array as Float32Array
		let shown = 0
		for (let i = 0; i < this.count; i++) {
			const o = i * Particles.STRIDE
			const born = s[o + 6] as number
			if (born < 0) continue
			const life = s[o + 7] as number
			const t = (now - born) / life
			if (t >= 1) {
				s[o + 6] = -1
				continue
			}
			// one that starts a moment later (smoke after the flame) waits unseen
			if (t < 0) continue
			const kind = this.kinds[i] as Kind
			const drag = Math.exp(-(s[o + 13] as number) * dt)
			s[o + 3] = (s[o + 3] as number) * drag
			s[o + 5] = (s[o + 5] as number) * drag
			// smoke rises and keeps rising; sparks fall; flame and dust slow down
			s[o + 4] = kind === 'spark' ? (s[o + 4] as number) - 9.8 * dt : (s[o + 4] as number) * drag
			if (kind === 'smoke') s[o + 4] = Math.max(s[o + 4] as number, 0.5)
			s[o] = (s[o] as number) + (s[o + 3] as number) * dt
			s[o + 1] = Math.max(0.05, (s[o + 1] as number) + (s[o + 4] as number) * dt)
			s[o + 2] = (s[o + 2] as number) + (s[o + 5] as number) * dt
			s[o + 14] = (s[o + 14] as number) + (s[o + 10] as number) * dt
			position[shown * 3] = s[o] as number
			position[shown * 3 + 1] = s[o + 1] as number
			position[shown * 3 + 2] = s[o + 2] as number
			// swells fast, then slowly
			const grow = 1 - (1 - t) ** 3
			shape[shown * 2] = (s[o + 8] as number) + ((s[o + 9] as number) - (s[o + 8] as number)) * grow
			shape[shown * 2 + 1] = s[o + 14] as number
			const alpha = s[o + 12] as number
			const c = shown * 4
			if (kind === 'fire') {
				// yellow-hot, then orange, then a dull red as it burns out
				const heat = 1 - t
				color[c] = 1.15 * Math.min(1, heat * 1.6 + 0.35)
				color[c + 1] = 0.72 * Math.max(0.1, heat ** 1.8)
				color[c + 2] = 0.3 * Math.max(0.02, heat ** 5)
				color[c + 3] = alpha * (t < 0.06 ? t / 0.06 : (1 - t) ** 1.1)
			} else if (kind === 'spark') {
				color[c] = 2
				color[c + 1] = 1.1 * (1 - t * 0.6)
				color[c + 2] = 0.4 * (1 - t)
				color[c + 3] = alpha * (1 - t)
			} else if (kind === 'gas') {
				color[c] = 0.42
				color[c + 1] = 0.62
				color[c + 2] = 0.22
				color[c + 3] = alpha * (t < 0.1 ? t / 0.1 : (1 - t) ** 1.3)
			} else {
				const shade = kind === 'smoke' ? 0.16 + t * 0.1 : 0.42
				color[c] = shade
				color[c + 1] = shade * 0.95
				color[c + 2] = shade * (kind === 'dust' ? 0.82 : 0.9)
				color[c + 3] = alpha * (t < 0.12 ? t / 0.12 : (1 - t) ** 1.5)
			}
			shown++
		}
		this.geometry.instanceCount = shown
		this.position.needsUpdate = true
		this.color.needsUpdate = true
		this.shape.needsUpdate = true
	}
}

/** Fireballs, smoke, dust, debris and the scorch marks they leave. */
export class Explosions {
	private readonly glow: Particles
	private readonly smoke: Particles
	private readonly scorches: THREE.InstancedMesh
	private readonly scorchBorn = new Float32Array(SCORCHES).fill(-1)
	private scorchHead = 0
	private last = 0
	private readonly matrix = new THREE.Matrix4()
	private readonly quaternion = new THREE.Quaternion()
	private readonly up = new THREE.Vector3(0, 1, 0)

	constructor(scene: THREE.Scene) {
		this.glow = new Particles(GLOW, puffTexture(7), true)
		this.smoke = new Particles(SMOKE, puffTexture(19), false)
		// the fire draws over its own smoke
		this.smoke.mesh.renderOrder = 2
		this.glow.mesh.renderOrder = 3
		const ground = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
		this.scorches = new THREE.InstancedMesh(
			ground,
			new THREE.MeshBasicMaterial({
				map: scorchTexture(),
				transparent: true,
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: -3
			}),
			SCORCHES
		)
		this.scorches.count = 0
		this.scorches.frustumCulled = false
		this.scorches.layers.set(EFFECTS_LAYER)
		scene.add(this.smoke.mesh, this.glow.mesh, this.scorches)
	}

	/** An explosion of `radius` metres at (x, y); `toxic` makes it a green gas burst instead of fire. */
	blast(x: number, y: number, radius: number, now: number, toxic = false): void {
		const r = Math.max(1, radius)
		const random = (spread: number) => (Math.random() - 0.5) * 2 * spread
		if (toxic) {
			for (let n = 0; n < 22; n++) {
				const angle = Math.random() * Math.PI * 2
				const speed = r * (0.8 + Math.random() * 1.6)
				this.smoke.emit(
					'gas',
					now,
					x + random(0.4),
					0.4 + Math.random() * 0.8,
					y + random(0.4),
					Math.cos(angle) * speed,
					0.3 + Math.random(),
					Math.sin(angle) * speed,
					1.4 + Math.random() * 1.2,
					r * 0.5,
					r * 1.3,
					0.5,
					2.2
				)
			}
			return
		}
		// the fireball: puffs flung out a little and up, swelling as they burn
		for (let n = 0; n < 18; n++) {
			const angle = Math.random() * Math.PI * 2
			const out = Math.random() * r * 2.2
			this.glow.emit(
				'fire',
				now,
				x + random(r * 0.25),
				0.5 + Math.random() * r * 0.4,
				y + random(r * 0.25),
				Math.cos(angle) * out,
				1 + Math.random() * r * 1.4,
				Math.sin(angle) * out,
				0.55 + Math.random() * 0.6,
				r * (0.3 + Math.random() * 0.25),
				r * (0.75 + Math.random() * 0.5),
				0.55,
				5
			)
		}
		// a hot core for the first instant
		this.glow.emit('fire', now, x, 1, y, 0, 0.5, 0, 0.14, r * 0.8, r * 1.4, 0.45, 0)
		// burning bits thrown out in arcs
		for (let n = 0; n < 34; n++) {
			const angle = Math.random() * Math.PI * 2
			const speed = 4 + Math.random() * 9
			this.glow.emit(
				'spark',
				now,
				x,
				0.6,
				y,
				Math.cos(angle) * speed,
				3 + Math.random() * 7,
				Math.sin(angle) * speed,
				0.5 + Math.random() * 0.7,
				0.14 + Math.random() * 0.12,
				0.06,
				1,
				0.6
			)
		}
		// black smoke rolling up after the flame
		for (let n = 0; n < 18; n++) {
			const angle = Math.random() * Math.PI * 2
			const out = Math.random() * r * 0.9
			this.smoke.emit(
				'smoke',
				now + 0.05 + Math.random() * 0.25,
				x + random(r * 0.4),
				0.8 + Math.random() * r * 0.5,
				y + random(r * 0.4),
				Math.cos(angle) * out,
				0.8 + Math.random() * 1.6,
				Math.sin(angle) * out,
				2.4 + Math.random() * 2.2,
				r * (0.6 + Math.random() * 0.4),
				r * (1.6 + Math.random() * 0.9),
				0.7,
				0.9
			)
		}
		// dust thrown out along the ground
		for (let n = 0; n < 20; n++) {
			const angle = (n / 20) * Math.PI * 2 + random(0.15)
			const speed = r * (5 + Math.random() * 3)
			this.smoke.emit(
				'dust',
				now,
				x + Math.cos(angle) * r * 0.3,
				0.3,
				y + Math.sin(angle) * r * 0.3,
				Math.cos(angle) * speed,
				0.4 + Math.random() * 0.6,
				Math.sin(angle) * speed,
				0.9 + Math.random() * 0.6,
				r * 0.35,
				r * 0.9,
				0.55,
				4.5
			)
		}
		// the scorch it leaves
		const i = this.scorchHead
		this.scorchHead = (i + 1) % SCORCHES
		this.quaternion.setFromAxisAngle(this.up, Math.random() * Math.PI * 2)
		const size = r * 1.9
		this.matrix.compose(new THREE.Vector3(x, 0.02 + i * 0.0003, y), this.quaternion, new THREE.Vector3(size, 1, size))
		this.scorches.setMatrixAt(i, this.matrix)
		this.scorchBorn[i] = now
		this.scorches.count = Math.max(this.scorches.count, i + 1)
		this.scorches.instanceMatrix.needsUpdate = true
	}

	update(now: number): void {
		const dt = Math.min(0.05, Math.max(0, now - this.last))
		this.last = now
		this.glow.update(now, dt)
		this.smoke.update(now, dt)
		// old scorch marks fade out by shrinking into the ground's dirt
		for (let i = 0; i < this.scorches.count; i++) {
			const born = this.scorchBorn[i] as number
			if (born >= 0 && now - born > SCORCH_SECONDS) {
				this.scorches.setMatrixAt(i, this.matrix.makeScale(0, 0, 0))
				this.scorchBorn[i] = -1
				this.scorches.instanceMatrix.needsUpdate = true
			}
		}
	}
}
