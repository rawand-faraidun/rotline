import { WarnKind } from '@rotline/sim'
import * as THREE from 'three'
import { EFFECTS_LAYER } from './post.ts'

/** Warnings on the ground at once; the oldest goes first. */
const MAX = 32
const ALERT = 0xff5630
const ACID = 0xc9e04a

type Warning = {
	root: THREE.Group
	/** grows from nothing to the full ring or lane as the attack comes */
	fill: THREE.Mesh
	/** a spit or canister in the air, drawn on its arc */
	blob: THREE.Mesh | null
	kind: number
	x: number
	y: number
	tx: number
	ty: number
	born: number
	until: number
}

/**
 * The tells before an attack lands: a ring round a Warden's slam or a Delver about to burst out, a
 * lane where a charge will run, and a mark where spit will land with the spit itself on its arc.
 * Each fills as the moment comes, so a player can read how long they have to get out.
 */
export class Warnings {
	private readonly scene: THREE.Scene
	private readonly live: Warning[] = []
	private readonly disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)
	private readonly ring = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2)
	private readonly plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
	private readonly sphere = new THREE.SphereGeometry(0.18, 10, 8)

	constructor(scene: THREE.Scene) {
		this.scene = scene
	}

	private material(colour: number, opacity: number): THREE.MeshBasicMaterial {
		return new THREE.MeshBasicMaterial({
			color: colour,
			transparent: true,
			opacity,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		})
	}

	/** A warning from the server: `seconds` until it lands. */
	add(kind: number, x: number, y: number, tx: number, ty: number, radius: number, seconds: number, now: number): void {
		if (this.live.length >= MAX) this.remove(0)
		const root = new THREE.Group()
		const colour = kind === WarnKind.spit ? ACID : ALERT
		let fill: THREE.Mesh
		let blob: THREE.Mesh | null = null
		if (kind === WarnKind.charge) {
			// the lane: its edge, and a fill that runs along it toward the far end
			const length = Math.max(0.5, Math.hypot(tx - x, ty - y))
			const angle = Math.atan2(ty - y, tx - x)
			root.position.set(x, 0.07, y)
			root.rotation.y = -angle
			const edge = new THREE.Mesh(this.plane, this.material(colour, 0.16))
			edge.scale.set(length, 1, radius * 2)
			edge.position.x = length / 2
			fill = new THREE.Mesh(this.plane, this.material(colour, 0.3))
			fill.scale.set(0.001, 1, radius * 2)
			fill.userData.length = length
			root.add(edge, fill)
		} else {
			root.position.set(tx, 0.07, ty)
			const outline = new THREE.Mesh(this.ring, this.material(colour, 0.7))
			outline.scale.setScalar(radius)
			fill = new THREE.Mesh(this.disc, this.material(colour, 0.22))
			fill.scale.setScalar(0.001)
			fill.userData.radius = radius
			root.add(outline, fill)
			if (kind === WarnKind.spit || kind === WarnKind.lob) {
				blob = new THREE.Mesh(this.sphere, this.material(colour, 0.95))
				this.scene.add(blob)
			}
		}
		for (const node of root.children) node.layers.set(EFFECTS_LAYER)
		blob?.layers.set(EFFECTS_LAYER)
		this.scene.add(root)
		this.live.push({ root, fill, blob, kind, x, y, tx, ty, born: now, until: now + Math.max(0.05, seconds) })
	}

	update(now: number): void {
		for (let w = this.live.length - 1; w >= 0; w--) {
			const warning = this.live[w] as Warning
			const t = (now - warning.born) / (warning.until - warning.born)
			// a moment past the end, then gone (the strike draws itself)
			if (t >= 1.05 || t < -0.1) {
				this.remove(w)
				continue
			}
			const share = Math.max(0.001, Math.min(1, t))
			if (warning.kind === WarnKind.charge) {
				const length = warning.fill.userData.length as number
				warning.fill.scale.x = length * share
				warning.fill.position.x = (length * share) / 2
			} else warning.fill.scale.setScalar((warning.fill.userData.radius as number) * share)
			// the last quarter flickers: now, move
			const material = warning.fill.material as THREE.MeshBasicMaterial
			material.opacity = t > 0.75 && Math.floor(now * 16) % 2 === 0 ? 0.45 : 0.22
			if (warning.blob) {
				const height = 0.4 + Math.sin(share * Math.PI) * 3
				warning.blob.position.set(
					warning.x + (warning.tx - warning.x) * share,
					height,
					warning.y + (warning.ty - warning.y) * share
				)
			}
		}
	}

	private remove(index: number): void {
		const [warning] = this.live.splice(index, 1)
		if (!warning) return
		this.scene.remove(warning.root)
		if (warning.blob) {
			this.scene.remove(warning.blob)
			;(warning.blob.material as THREE.Material).dispose()
		}
		warning.root.traverse(node => {
			const mesh = node as THREE.Mesh
			if (mesh.material) (mesh.material as THREE.Material).dispose()
		})
	}

	dispose(): void {
		while (this.live.length > 0) this.remove(0)
		this.disc.dispose()
		this.ring.dispose()
		this.plane.dispose()
		this.sphere.dispose()
	}
}
