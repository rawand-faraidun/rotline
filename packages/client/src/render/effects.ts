import type { PoolState } from '@rotline/protocol'
import * as THREE from 'three'

const TRACERS = 96
const TRACER_SECONDS = 0.07
const DECALS = 256
const BURSTS = 8
const POOLS = 16

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
export class Effects {
	private readonly tracers: THREE.InstancedMesh
	private readonly tracerBorn = new Float32Array(TRACERS).fill(-1)
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

	constructor(scene: THREE.Scene, gore = true) {
		this.gore = gore
		this.tracers = new THREE.InstancedMesh(
			new THREE.BoxGeometry(0.035, 0.035, 1).translate(0, 0, 0.5),
			new THREE.MeshBasicMaterial({
				color: 0xffe2a0,
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
	}

	tracer(x: number, y: number, angle: number, length: number, now: number, height = 1.05): void {
		const i = this.tracerHead
		this.tracerHead = (i + 1) % TRACERS
		this.quaternion.setFromAxisAngle(this.up, Math.PI / 2 - angle)
		this.matrix.compose(this.position.set(x, height, y), this.quaternion, this.scale.set(1, 1, Math.max(0.1, length)))
		this.tracers.setMatrixAt(i, this.matrix)
		this.tracerBorn[i] = now
		this.tracers.instanceMatrix.needsUpdate = true
	}

	muzzleFlash(x: number, y: number, angle: number, now: number): void {
		const fx = x + Math.cos(angle) * 0.9
		const fy = y + Math.sin(angle) * 0.9
		this.flash.position.set(fx, 1.3, fy)
		this.flash.intensity = 14
		this.flashSprite.position.set(fx, 1.1, fy)
		this.flashSprite.scale.setScalar(0.9 + Math.random() * 0.5)
		this.flashSprite.visible = true
		this.flashUntil = now + 0.05
	}

	splat(x: number, y: number, size: number): void {
		const i = this.decalHead
		this.decalHead = (i + 1) % DECALS
		this.quaternion.setFromAxisAngle(this.up, Math.random() * Math.PI * 2)
		this.matrix.compose(this.position.set(x, 0.02, y), this.quaternion, this.scale.set(size, 1, size))
		this.decals.setMatrixAt(i, this.matrix)
		this.decals.instanceMatrix.needsUpdate = true
	}

	burst(x: number, y: number, radius: number, now: number): void {
		const i = this.burstHead
		this.burstHead = (i + 1) % BURSTS
		const ring = this.bursts[i] as THREE.Mesh
		ring.position.set(x, 0.1, y)
		ring.userData.radius = radius
		ring.visible = true
		this.burstBorn[i] = now
		if (this.gore) this.splat(x, y, radius * 0.8)
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

	update(now: number): void {
		let changed = false
		for (let i = 0; i < TRACERS; i++) {
			const born = this.tracerBorn[i] as number
			if (born >= 0 && now - born > TRACER_SECONDS) {
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
