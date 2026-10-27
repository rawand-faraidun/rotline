import { zombies as zombieDefs } from '@rotline/game-data'
import { ZombieStatus } from '@rotline/protocol'
import * as THREE from 'three'
import type { ZombieView } from '../interpolate.ts'
import { EFFECTS_LAYER } from './post.ts'

/** elites with a bar at once (more than this on screen and the farthest go without) */
const BARS = 12
const WIDTH = 1.6
const HEIGHT = 0.16

/**
 * A health bar over the head of every elite in view (Brutes and the like), so with two of them about
 * each one's health reads on its own, and over every zombie a hunt wants dead, with a red marker
 * bobbing above it. The bars face the camera.
 */
export class EliteBars {
	private readonly back: THREE.InstancedMesh
	private readonly fill: THREE.InstancedMesh
	private readonly marks: THREE.InstancedMesh
	private readonly matrix = new THREE.Matrix4()
	private readonly position = new THREE.Vector3()
	private readonly scale = new THREE.Vector3()

	constructor(scene: THREE.Scene) {
		const plane = new THREE.PlaneGeometry(1, 1)
		// the fill grows from the bar's left end
		const left = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0)
		const material = (color: number, opacity: number) =>
			new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })
		this.back = new THREE.InstancedMesh(plane, material(0x0d100e, 0.8), BARS)
		this.fill = new THREE.InstancedMesh(left, material(0xe0402a, 0.95), BARS)
		// a downward-pointing marker
		const arrow = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(-0.5, 0.5, 0),
			new THREE.Vector3(0, -0.5, 0),
			new THREE.Vector3(0.5, 0.5, 0)
		])
		const red = material(0xff3a2a, 0.95)
		red.side = THREE.DoubleSide
		this.marks = new THREE.InstancedMesh(arrow, red, BARS)
		for (const mesh of [this.back, this.fill, this.marks]) {
			mesh.count = 0
			mesh.frustumCulled = false
			mesh.renderOrder = 20
			mesh.layers.set(EFFECTS_LAYER)
			scene.add(mesh)
		}
	}

	update(view: ZombieView, camera: THREE.Camera, timeSeconds = 0): void {
		let n = 0
		let m = 0
		for (let i = 0; i < view.count && n < BARS; i++) {
			const def = zombieDefs[view.type[i] as number]
			const hunted = ((view.status[i] as number) & ZombieStatus.hunted) !== 0
			if (!def || (!def.elite && !hunted)) continue
			const health = (view.health[i] as number) / 255
			const size = def.scale ?? 1
			const x = view.x[i] as number
			const y = view.y[i] as number
			this.position.set(x, 2.3 * size + 0.4, y)
			this.matrix.compose(this.position, camera.quaternion, this.scale.set(WIDTH * size, HEIGHT, 1))
			this.back.setMatrixAt(n, this.matrix)
			// the fill sits on the same spot, starting at the bar's left end
			this.position.set(x, 2.3 * size + 0.4, y)
			const offset = new THREE.Vector3(-(WIDTH * size) / 2, 0, 0.001).applyQuaternion(camera.quaternion)
			this.position.add(offset)
			this.matrix.compose(this.position, camera.quaternion, this.scale.set(WIDTH * size * health, HEIGHT * 0.7, 1))
			this.fill.setMatrixAt(n, this.matrix)
			n++
			if (hunted) {
				this.position.set(x, 2.3 * size + 1 + Math.sin(timeSeconds * 5 + i) * 0.12, y)
				this.matrix.compose(this.position, camera.quaternion, this.scale.set(0.55, 0.45, 1))
				this.marks.setMatrixAt(m++, this.matrix)
			}
		}
		this.back.count = n
		this.fill.count = n
		this.marks.count = m
		this.back.instanceMatrix.needsUpdate = true
		this.fill.instanceMatrix.needsUpdate = true
		this.marks.instanceMatrix.needsUpdate = true
	}
}
