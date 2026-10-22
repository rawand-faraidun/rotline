import type { PoolState } from '@rotline/protocol'
import * as THREE from 'three'
import { EFFECTS_LAYER } from './post.ts'

const TRACERS = 96
const TRACER_SECONDS = 0.07

/** How a weapon's shots look: tracer colour, thickness and life (seconds), and muzzle flash size. */
export type ShotLook = { color: number; width: number; life: number; flash: number }

/** Each kind of gun draws its own shots: pellet sprays, long bright sniper streaks, orange MG tracers. */
export const SHOT_LOOKS: Record<string, ShotLook> = {
	pistol: { color: 0xffd9a0, width: 0.8, life: 0.05, flash: 0.7 },
	smg: { color: 0xffe6b0, width: 0.75, life: 0.04, flash: 0.75 },
	rifle: { color: 0xfff0b8, width: 1, life: 0.06, flash: 1 },
	shotgun: { color: 0xffc878, width: 0.7, life: 0.06, flash: 1.5 },
	lmg: { color: 0xff9a48, width: 1.3, life: 0.08, flash: 1.15 },
	sniper: { color: 0xeaf4ff, width: 1.8, life: 0.22, flash: 1.5 },
	minigun: { color: 0xff8a3a, width: 1.1, life: 0.06, flash: 1 },
	shock: { color: 0x7fd8ff, width: 1.6, life: 0.12, flash: 0.9 },
	launcher: { color: 0xffe2a0, width: 1, life: 0.06, flash: 1.6 },
	flamethrower: { color: 0xffa040, width: 1, life: 0.06, flash: 0.6 },
	chemical: { color: 0x9fe04a, width: 1, life: 0.06, flash: 0.6 }
}
const DEFAULT_LOOK = SHOT_LOOKS.rifle as ShotLook
const DECALS = 800
const BURSTS = 8
const POOLS = 16
const FLAMES = 96
const FLAME_SECONDS = 0.28
const PROJECTILES = 16

function blob(r: number, g: number, b: number, soft: number): THREE.CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 64
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
	gradient.addColorStop(0, `rgba(${r},${g},${b},1)`)
	gradient.addColorStop(soft, `rgba(${r},${g},${b},0.85)`)
	gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, 64, 64)
	return new THREE.CanvasTexture(canvas)
}

/** Pooled visual effects: nothing here allocates per shot. */
/** Spent cases in the world at once, and how long they lie there. */
const CASINGS = 96
/** chunks a zombie bursts into, and how long they lie on the ground (seconds) */
const GIBS = 320
const GIB_SECONDS = 30
const CASING_SECONDS = 8
/** Sparks where shots hit walls. */
const SPARKS = 24
const SPARK_SECONDS = 0.14

export class Effects {
	private readonly casings: THREE.InstancedMesh
	private readonly casingState = new Float32Array(CASINGS * 6)
	private readonly casingBorn = new Float32Array(CASINGS).fill(-1)
	private casingHead = 0
	private readonly gibs: THREE.InstancedMesh
	/** x, y, z, vx, vy, vz, spin, size per gib */
	private readonly gibState = new Float32Array(GIBS * 8)
	private readonly gibBorn = new Float32Array(GIBS).fill(-1)
	private gibHead = 0
	private lastGibUpdate = 0
	private lastCasingUpdate = 0
	private readonly sparks: THREE.Sprite[] = []
	private readonly sparkBorn = new Float32Array(SPARKS).fill(-1)
	private sparkHead = 0
	private readonly tracers: THREE.InstancedMesh
	private readonly tracerBorn = new Float32Array(TRACERS).fill(-1)
	private readonly tracerLife = new Float32Array(TRACERS).fill(TRACER_SECONDS)
	private tracerHead = 0
	private readonly decals: THREE.InstancedMesh
	private decalHead = 0
	private readonly bursts: THREE.Mesh[] = []
	private readonly burstBorn = new Float32Array(BURSTS).fill(-1)
	private burstHead = 0
	private readonly pools: THREE.InstancedMesh
	private readonly flash: THREE.PointLight
	private readonly flashSprite: THREE.Sprite
	private flashUntil = 0
	private readonly matrix = new THREE.Matrix4()
	private readonly quaternion = new THREE.Quaternion()
	private readonly position = new THREE.Vector3()
	private readonly scale = new THREE.Vector3()
	private readonly up = new THREE.Vector3(0, 1, 0)
	private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0)
	private readonly gore: boolean
	private readonly flames: THREE.Sprite[] = []
	private readonly flameBorn = new Float32Array(FLAMES).fill(-1)
	private readonly flameVelocity = new Float32Array(FLAMES * 2)
	private readonly flameOrigin = new Float32Array(FLAMES * 2)
	private flameHead = 0
	private readonly fireMaterial: THREE.SpriteMaterial
	private readonly toxinMaterial: THREE.SpriteMaterial
	private readonly projectiles: THREE.Mesh[] = []
	private readonly projectileState: {
		id: number
		x: number
		y: number
		dx: number
		dy: number
		born: number
		alive: boolean
	}[] = []
	private readonly tint = new THREE.Color()

	constructor(scene: THREE.Scene, gore = true) {
		this.gore = gore
		this.tracers = new THREE.InstancedMesh(
			new THREE.BoxGeometry(0.035, 0.035, 1).translate(0, 0, 0.5),
			new THREE.MeshBasicMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.9,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			}),
			TRACERS
		)
		this.tracers.frustumCulled = false
		for (let i = 0; i < TRACERS; i++) this.tracers.setMatrixAt(i, this.hidden)

		const decalGeometry = new THREE.PlaneGeometry(1, 1)
		decalGeometry.rotateX(-Math.PI / 2)
		this.decals = new THREE.InstancedMesh(
			decalGeometry,
			new THREE.MeshStandardMaterial({
				map: gore ? blob(96, 10, 8, 0.5) : blob(70, 70, 66, 0.5),
				transparent: true,
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: -2,
				roughness: 0.35
			}),
			DECALS
		)
		this.decals.receiveShadow = true
		this.decals.frustumCulled = false
		for (let i = 0; i < DECALS; i++) this.decals.setMatrixAt(i, this.hidden)

		const burstMaterial = new THREE.MeshBasicMaterial({
			color: 0x9fe04a,
			transparent: true,
			opacity: 0.6,
			side: THREE.DoubleSide,
			depthWrite: false
		})
		for (let i = 0; i < BURSTS; i++) {
			const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), burstMaterial.clone())
			ring.rotation.x = -Math.PI / 2
			ring.visible = false
			ring.layers.set(EFFECTS_LAYER)
			this.bursts.push(ring)
			scene.add(ring)
		}

		const poolGeometry = new THREE.CircleGeometry(1, 32)
		poolGeometry.rotateX(-Math.PI / 2)
		this.pools = new THREE.InstancedMesh(
			poolGeometry,
			new THREE.MeshBasicMaterial({ color: 0x7fd03a, transparent: true, opacity: 0.35, depthWrite: false }),
			POOLS
		)
		this.pools.count = 0
		this.pools.frustumCulled = false

		this.flash = new THREE.PointLight(0xffb050, 0, 9, 2)
		this.flashSprite = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: blob(255, 220, 150, 0.25), blending: THREE.AdditiveBlending, depthWrite: false })
		)
		this.flashSprite.visible = false
		scene.add(this.tracers, this.decals, this.pools, this.flash, this.flashSprite)
		for (const glow of [this.tracers, this.decals, this.pools, this.flashSprite]) glow.layers.set(EFFECTS_LAYER)

		// spent cases: small brass boxes thrown out to the right, bouncing once, lying a while
		this.casings = new THREE.InstancedMesh(
			new THREE.BoxGeometry(0.05, 0.05, 0.14),
			new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.7, roughness: 0.35 }),
			CASINGS
		)
		for (let i = 0; i < CASINGS; i++) this.casings.setMatrixAt(i, this.hidden)
		this.casings.frustumCulled = false
		scene.add(this.casings)

		// lumps of flesh and bone: irregular, wet, from dark red to pale
		this.gibs = new THREE.InstancedMesh(
			new THREE.IcosahedronGeometry(0.085, 0),
			new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0 }),
			GIBS
		)
		const gibColour = new THREE.Color()
		for (let i = 0; i < GIBS; i++) {
			this.gibs.setMatrixAt(i, this.hidden)
			const pale = Math.random() < 0.18
			this.gibs.setColorAt(
				i,
				pale ? gibColour.setRGB(0.55, 0.45, 0.38) : gibColour.setRGB(0.32 + Math.random() * 0.2, 0.03, 0.025)
			)
		}
		this.gibs.frustumCulled = false
		this.gibs.castShadow = true
		if (gore) scene.add(this.gibs)
		const sparkMaterial = new THREE.SpriteMaterial({
			map: blob(255, 230, 160, 0.2),
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			transparent: true
		})
		for (let i = 0; i < SPARKS; i++) {
			const sprite = new THREE.Sprite(sparkMaterial)
			sprite.visible = false
			sprite.layers.set(EFFECTS_LAYER)
			scene.add(sprite)
			this.sparks.push(sprite)
		}

		this.fireMaterial = new THREE.SpriteMaterial({
			map: blob(255, 150, 40, 0.3),
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			transparent: true
		})
		this.toxinMaterial = new THREE.SpriteMaterial({
			map: blob(150, 230, 60, 0.3),
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			transparent: true
		})
		for (let i = 0; i < FLAMES; i++) {
			const sprite = new THREE.Sprite(this.fireMaterial)
			sprite.visible = false
			sprite.layers.set(EFFECTS_LAYER)
			this.flames.push(sprite)
			scene.add(sprite)
		}
		const shell = new THREE.Mesh(
			new THREE.SphereGeometry(0.14, 10, 8),
			new THREE.MeshBasicMaterial({ color: 0xffd36a })
		)
		for (let i = 0; i < PROJECTILES; i++) {
			const mesh = shell.clone()
			mesh.visible = false
			this.projectiles.push(mesh)
			this.projectileState.push({ id: -1, x: 0, y: 0, dx: 0, dy: 0, born: 0, alive: false })
			scene.add(mesh)
		}
	}

	/** A puff of fire or toxin across a cone; the particles drift outward and fade. */
	flame(x: number, y: number, angle: number, range: number, halfAngle: number, toxic: boolean, now: number): void {
		for (let n = 0; n < 3; n++) {
			const i = this.flameHead
			this.flameHead = (i + 1) % FLAMES
			const sprite = this.flames[i] as THREE.Sprite
			const a = angle + (Math.random() * 2 - 1) * halfAngle
			const speed = (range / FLAME_SECONDS) * (0.6 + Math.random() * 0.4)
			sprite.material = toxic ? this.toxinMaterial : this.fireMaterial
			this.flameOrigin[i * 2] = x + Math.cos(angle) * 0.7
			this.flameOrigin[i * 2 + 1] = y + Math.sin(angle) * 0.7
			sprite.position.set(this.flameOrigin[i * 2] as number, 1, this.flameOrigin[i * 2 + 1] as number)
			sprite.visible = true
			this.flameVelocity[i * 2] = Math.cos(a) * speed
			this.flameVelocity[i * 2 + 1] = Math.sin(a) * speed
			this.flameBorn[i] = now
		}
	}

	/** A grenade in flight, drawn locally from its launch until the server says it exploded. */
	launch(id: number, x: number, y: number, angle: number, speed: number, now: number): void {
		const slot = this.projectileState.findIndex(state => !state.alive)
		if (slot < 0) return
		const state = this.projectileState[slot] as (typeof this.projectileState)[number]
		Object.assign(state, { id, x, y, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, born: now, alive: true })
		;(this.projectiles[slot] as THREE.Mesh).visible = true
	}

	explode(id: number, x: number, y: number, radius: number, now: number): void {
		for (const [slot, state] of this.projectileState.entries()) {
			if (state.alive && state.id === id) {
				state.alive = false
				;(this.projectiles[slot] as THREE.Mesh).visible = false
			}
		}
		this.burst(x, y, radius, now, 0xffa040)
		this.flash.position.set(x, 1.5, y)
		this.flash.intensity = 40
		this.flashUntil = now + 0.08
	}

	tracer(
		x: number,
		y: number,
		angle: number,
		length: number,
		now: number,
		height = 1.05,
		look: ShotLook | number = DEFAULT_LOOK
	): void {
		const style = typeof look === 'number' ? { ...DEFAULT_LOOK, color: look } : look
		const i = this.tracerHead
		this.tracers.setColorAt(i, this.tint.set(style.color))
		if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true
		this.tracerHead = (i + 1) % TRACERS
		this.quaternion.setFromAxisAngle(this.up, Math.PI / 2 - angle)
		this.matrix.compose(
			this.position.set(x, height, y),
			this.quaternion,
			this.scale.set(style.width, style.width, Math.max(0.1, length))
		)
		this.tracers.setMatrixAt(i, this.matrix)
		this.tracerBorn[i] = now
		this.tracerLife[i] = style.life
		this.tracers.instanceMatrix.needsUpdate = true
	}

	muzzleFlash(x: number, y: number, angle: number, now: number, size = 1): void {
		const fx = x + Math.cos(angle) * 0.9
		const fy = y + Math.sin(angle) * 0.9
		this.flash.position.set(fx, 1.3, fy)
		this.flash.intensity = 14 * size
		this.flashSprite.position.set(fx, 1.1, fy)
		this.flashSprite.scale.setScalar((0.9 + Math.random() * 0.5) * size)
		this.flashSprite.visible = true
		this.flashUntil = now + 0.05
	}

	/** A spent case thrown out of the gun's right side. */
	casing(x: number, y: number, angle: number, now: number): void {
		const i = this.casingHead
		this.casingHead = (i + 1) % CASINGS
		const side = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.6
		const speed = 2.2 + Math.random() * 1.2
		const state = this.casingState
		state[i * 6] = x + Math.cos(angle) * 0.35
		state[i * 6 + 1] = 1.05
		state[i * 6 + 2] = y + Math.sin(angle) * 0.35
		state[i * 6 + 3] = Math.cos(side) * speed
		state[i * 6 + 4] = 1.8 + Math.random()
		state[i * 6 + 5] = Math.sin(side) * speed
		this.casingBorn[i] = now
	}

	/** Sparks where a shot struck a wall. */
	impact(x: number, y: number, now: number): void {
		const i = this.sparkHead
		this.sparkHead = (i + 1) % SPARKS
		const sprite = this.sparks[i] as THREE.Sprite
		sprite.position.set(x, 0.9 + Math.random() * 0.4, y)
		sprite.scale.setScalar(0.35 + Math.random() * 0.25)
		sprite.visible = true
		this.sparkBorn[i] = now
	}

	splat(x: number, y: number, size: number): void {
		const i = this.decalHead
		this.decalHead = (i + 1) % DECALS
		this.quaternion.setFromAxisAngle(this.up, Math.random() * Math.PI * 2)
		this.matrix.compose(this.position.set(x, 0.02, y), this.quaternion, this.scale.set(size, 1, size))
		this.decals.setMatrixAt(i, this.matrix)
		this.decals.instanceMatrix.needsUpdate = true
	}

	/** A ring that grows and fades; `splat` leaves a stain (Swell bursts, not explosions or abilities). */
	burst(x: number, y: number, radius: number, now: number, color = 0x9fe04a, splat = false): void {
		const i = this.burstHead
		this.burstHead = (i + 1) % BURSTS
		const ring = this.bursts[i] as THREE.Mesh
		;(ring.material as THREE.MeshBasicMaterial).color.set(color)
		ring.position.set(x, 0.1, y)
		ring.userData.radius = radius
		ring.visible = true
		this.burstBorn[i] = now
		if (splat && this.gore) this.splat(x, y, radius * 0.8)
	}

	setPools(pools: readonly PoolState[]): void {
		const count = Math.min(POOLS, pools.length)
		for (let i = 0; i < count; i++) {
			const pool = pools[i] as PoolState
			this.matrix.compose(
				this.position.set(pool.x, 0.03, pool.y),
				this.quaternion.identity(),
				this.scale.set(pool.radius, 1, pool.radius)
			)
			this.pools.setMatrixAt(i, this.matrix)
		}
		this.pools.count = count
		this.pools.instanceMatrix.needsUpdate = true
	}

	/** A body bursting apart: `count` lumps thrown out and up from (x, y), and the blood around it. */
	burstBody(x: number, y: number, count: number, size = 1): void {
		if (!this.gore) return
		for (let n = 0; n < count; n++) {
			const i = this.gibHead
			this.gibHead = (i + 1) % GIBS
			const o = i * 8
			const angle = Math.random() * Math.PI * 2
			const speed = (1.5 + Math.random() * 3.5) * size
			const state = this.gibState
			state[o] = x
			state[o + 1] = 0.6 * size
			state[o + 2] = y
			state[o + 3] = Math.cos(angle) * speed
			state[o + 4] = 1.5 + Math.random() * 3.5
			state[o + 5] = Math.sin(angle) * speed
			state[o + 6] = (Math.random() - 0.5) * 20
			state[o + 7] = (0.6 + Math.random() * 1.1) * size
			this.gibBorn[i] = this.lastGibUpdate
		}
		this.splat(x, y, (1.1 + Math.random() * 0.7) * size)
		for (let n = 0; n < 3; n++) {
			const angle = Math.random() * Math.PI * 2
			const reach = (0.8 + Math.random() * 1.4) * size
			this.splat(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, (0.25 + Math.random() * 0.35) * size)
		}
	}

	private updateGibs(now: number): void {
		const dt = Math.min(0.05, now - this.lastGibUpdate)
		this.lastGibUpdate = now
		if (!this.gore) return
		const state = this.gibState
		let changed = false
		for (let i = 0; i < GIBS; i++) {
			const born = this.gibBorn[i] as number
			if (born < 0) continue
			changed = true
			const age = now - born
			if (age > GIB_SECONDS) {
				this.gibs.setMatrixAt(i, this.hidden)
				this.gibBorn[i] = -1
				continue
			}
			const o = i * 8
			const size = state[o + 7] as number
			const floor = 0.05 * size
			if ((state[o + 1] as number) > floor || (state[o + 4] as number) > 0) {
				// thrown, falling, bouncing once with a wet skid, then lying where it landed
				state[o + 4] = (state[o + 4] as number) - 9.8 * dt
				state[o] = (state[o] as number) + (state[o + 3] as number) * dt
				state[o + 1] = (state[o + 1] as number) + (state[o + 4] as number) * dt
				state[o + 2] = (state[o + 2] as number) + (state[o + 5] as number) * dt
				if ((state[o + 1] as number) <= floor) {
					state[o + 1] = floor
					const bounce = -(state[o + 4] as number) * 0.25
					state[o + 4] = bounce > 0.5 ? bounce : 0
					state[o + 3] = (state[o + 3] as number) * 0.3
					state[o + 5] = (state[o + 5] as number) * 0.3
					state[o + 6] = (state[o + 6] as number) * 0.3
				}
			}
			// the last few seconds they sink away
			const fade = Math.min(1, (GIB_SECONDS - age) / 3)
			this.quaternion.setFromAxisAngle(
				this.spinAxis.set(1, 0.6, 0.3).normalize(),
				born * 13 + age * (state[o + 6] as number)
			)
			this.matrix.compose(
				this.position.set(state[o] as number, (state[o + 1] as number) - (1 - fade) * 0.1, state[o + 2] as number),
				this.quaternion,
				this.scale.set(size, size * 0.7, size * 1.2)
			)
			this.gibs.setMatrixAt(i, this.matrix)
		}
		if (changed) this.gibs.instanceMatrix.needsUpdate = true
	}

	private readonly spinAxis = new THREE.Vector3()

	private updateCasings(now: number): void {
		const dt = Math.min(0.05, now - this.lastCasingUpdate)
		this.lastCasingUpdate = now
		const state = this.casingState
		let changed = false
		for (let i = 0; i < CASINGS; i++) {
			const born = this.casingBorn[i] as number
			if (born < 0) continue
			changed = true
			if (now - born > CASING_SECONDS) {
				this.casings.setMatrixAt(i, this.hidden)
				this.casingBorn[i] = -1
				continue
			}
			const o = i * 6
			if ((state[o + 1] as number) > 0.025 || (state[o + 4] as number) > 0) {
				// fall, bounce once off the floor, then lie still
				state[o + 4] = (state[o + 4] as number) - 9.8 * dt
				state[o] = (state[o] as number) + (state[o + 3] as number) * dt
				state[o + 1] = (state[o + 1] as number) + (state[o + 4] as number) * dt
				state[o + 2] = (state[o + 2] as number) + (state[o + 5] as number) * dt
				if ((state[o + 1] as number) <= 0.025) {
					state[o + 1] = 0.025
					const bounce = -(state[o + 4] as number) * 0.3
					state[o + 4] = bounce > 0.4 ? bounce : 0
					state[o + 3] = (state[o + 3] as number) * 0.4
					state[o + 5] = (state[o + 5] as number) * 0.4
				}
			}
			this.quaternion.setFromAxisAngle(this.up, born * 37)
			this.matrix.compose(
				this.position.set(state[o] as number, state[o + 1] as number, state[o + 2] as number),
				this.quaternion,
				this.scale.set(1, 1, 1)
			)
			this.casings.setMatrixAt(i, this.matrix)
		}
		if (changed) this.casings.instanceMatrix.needsUpdate = true
	}

	update(now: number): void {
		this.updateCasings(now)
		this.updateGibs(now)
		for (let i = 0; i < SPARKS; i++) {
			const born = this.sparkBorn[i] as number
			if (born >= 0 && now - born > SPARK_SECONDS) {
				;(this.sparks[i] as THREE.Sprite).visible = false
				this.sparkBorn[i] = -1
			}
		}
		let changed = false
		for (let i = 0; i < TRACERS; i++) {
			const born = this.tracerBorn[i] as number
			if (born >= 0 && now - born > (this.tracerLife[i] as number)) {
				this.tracers.setMatrixAt(i, this.hidden)
				this.tracerBorn[i] = -1
				changed = true
			}
		}
		if (changed) this.tracers.instanceMatrix.needsUpdate = true
		if (now > this.flashUntil) {
			this.flash.intensity = 0
			this.flashSprite.visible = false
		}
		for (let i = 0; i < FLAMES; i++) {
			const born = this.flameBorn[i] as number
			if (born < 0) continue
			const sprite = this.flames[i] as THREE.Sprite
			const t = (now - born) / FLAME_SECONDS
			if (t >= 1) {
				sprite.visible = false
				this.flameBorn[i] = -1
				continue
			}
			const age = now - born
			sprite.position.x = (this.flameOrigin[i * 2] as number) + (this.flameVelocity[i * 2] as number) * age
			sprite.position.z = (this.flameOrigin[i * 2 + 1] as number) + (this.flameVelocity[i * 2 + 1] as number) * age
			sprite.scale.setScalar(0.5 + t * 1.6)
			sprite.material.opacity = 0.9 * (1 - t)
		}
		for (const [slot, state] of this.projectileState.entries()) {
			if (!state.alive) continue
			const age = now - state.born
			// a lost explode event must not leave a grenade hanging forever
			if (age > 3) {
				state.alive = false
				;(this.projectiles[slot] as THREE.Mesh).visible = false
				continue
			}
			;(this.projectiles[slot] as THREE.Mesh).position.set(state.x + state.dx * age, 1.1, state.y + state.dy * age)
		}
		for (let i = 0; i < BURSTS; i++) {
			const born = this.burstBorn[i] as number
			if (born < 0) continue
			const ring = this.bursts[i] as THREE.Mesh
			const t = (now - born) / 0.35
			if (t >= 1) {
				ring.visible = false
				this.burstBorn[i] = -1
				continue
			}
			ring.scale.setScalar((ring.userData.radius as number) * (0.2 + 0.8 * t))
			;(ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t)
		}
	}
}
