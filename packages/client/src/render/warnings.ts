import { WarnKind } from '@rotline/sim'
import * as THREE from 'three'
import { EFFECTS_LAYER } from './post.ts'

/** Warnings on the ground at once; the oldest goes first. */
const MAX = 32
const ALERT = 0xff5630
const ACID = 0xc9e04a

/** One pooled warning: built once, shaped and coloured again each time it is used. */
type Warning = {
	root: THREE.Group
	/** the ring's outline or the lane's edge */
	edge: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
	/** grows from nothing to the full ring or lane as the attack comes */
	fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
	/** a spit or canister in the air, drawn on its arc */
	blob: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
	/** in use */
	live: boolean
	kind: number
	x: number
	y: number
	tx: number
	ty: number
	/** the lane's length or the ring's radius */
	size: number
	born: number
	until: number
}

/**
 * The tells before an attack lands: a ring round a Warden's slam or a Delver about to burst out, a
 * lane where a charge will run, and a mark where spit will land with the spit itself on its arc.
 * Each fills as the moment comes, so a player can read how long they have to get out. The meshes
 * are kept in a pool: a fight full of warnings makes nothing new.
 */
export class Warnings {
	private readonly scene: THREE.Scene
	private readonly slots: Warning[] = []
	private readonly disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)
	private readonly ring = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2)
	private readonly plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
	private readonly sphere = new THREE.SphereGeometry(0.18, 10, 8)

	constructor(scene: THREE.Scene) {
		this.scene = scene
	}

	private static material(): THREE.MeshBasicMaterial {
		return new THREE.MeshBasicMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		})
	}

	/** A free slot, a new one while the pool is below its size, else the oldest. */
	private slot(): Warning {
		const free = this.slots.find(slot => !slot.live)
		if (free) return free
		if (this.slots.length >= MAX) {
			let oldest = this.slots[0] as Warning
			for (const slot of this.slots) if (slot.born < oldest.born) oldest = slot
			return oldest
		}
		const root = new THREE.Group()
		const edge = new THREE.Mesh(this.ring as THREE.BufferGeometry, Warnings.material())
		const fill = new THREE.Mesh(this.disc as THREE.BufferGeometry, Warnings.material())
		const blob = new THREE.Mesh(this.sphere as THREE.BufferGeometry, Warnings.material())
		root.add(edge, fill)
		for (const node of [edge, fill, blob]) node.layers.set(EFFECTS_LAYER)
		root.visible = false
		blob.visible = false
		this.scene.add(root, blob)
		const slot: Warning = {
			root,
			edge,
			fill,
			blob,
			live: false,
			kind: 0,
			x: 0,
			y: 0,
			tx: 0,
			ty: 0,
			size: 0,
			born: 0,
			until: 0
		}
		this.slots.push(slot)
		return slot
	}

	/** A warning from the server: `seconds` until it lands. */
	add(kind: number, x: number, y: number, tx: number, ty: number, radius: number, seconds: number, now: number): void {
		const w = this.slot()
		const colour = kind === WarnKind.spit ? ACID : ALERT
		const { root, edge, fill, blob } = w
		for (const mesh of [edge, fill, blob]) mesh.material.color.setHex(colour)
		root.rotation.set(0, 0, 0)
		fill.position.set(0, 0, 0)
		edge.position.set(0, 0, 0)
		if (kind === WarnKind.charge) {
			// the lane: its edge, and a fill that runs along it toward the far end
			const length = Math.max(0.5, Math.hypot(tx - x, ty - y))
			root.position.set(x, 0.07, y)
			root.rotation.y = -Math.atan2(ty - y, tx - x)
			edge.geometry = this.plane
			edge.material.opacity = 0.16
			edge.scale.set(length, 1, radius * 2)
			edge.position.x = length / 2
			fill.geometry = this.plane
			fill.scale.set(0.001, 1, radius * 2)
			w.size = length
		} else {
			root.position.set(tx, 0.07, ty)
			edge.geometry = this.ring
			edge.material.opacity = 0.7
			edge.scale.setScalar(radius)
			fill.geometry = this.disc
			fill.scale.setScalar(0.001)
			w.size = radius
		}
		fill.material.opacity = 0.22
		blob.material.opacity = 0.95
		blob.visible = kind === WarnKind.spit || kind === WarnKind.lob
		root.visible = true
		Object.assign(w, { live: true, kind, x, y, tx, ty, born: now, until: now + Math.max(0.05, seconds) })
	}

	update(now: number): void {
		for (const warning of this.slots) {
			if (!warning.live) continue
			const t = (now - warning.born) / (warning.until - warning.born)
			// a moment past the end, then gone (the strike draws itself)
			if (t >= 1.05 || t < -0.1) {
				this.free(warning)
				continue
			}
			const share = Math.max(0.001, Math.min(1, t))
			if (warning.kind === WarnKind.charge) {
				warning.fill.scale.x = warning.size * share
				warning.fill.position.x = (warning.size * share) / 2
			} else warning.fill.scale.setScalar(warning.size * share)
			// the last quarter flickers: now, move
			warning.fill.material.opacity = t > 0.75 && Math.floor(now * 16) % 2 === 0 ? 0.45 : 0.22
			if (warning.blob.visible) {
				const height = 0.4 + Math.sin(share * Math.PI) * 3
				warning.blob.position.set(
					warning.x + (warning.tx - warning.x) * share,
					height,
					warning.y + (warning.ty - warning.y) * share
				)
			}
		}
	}

	private free(warning: Warning): void {
		warning.live = false
		warning.root.visible = false
		warning.blob.visible = false
	}

	dispose(): void {
		for (const slot of this.slots) {
			this.scene.remove(slot.root, slot.blob)
			for (const mesh of [slot.edge, slot.fill, slot.blob]) mesh.material.dispose()
		}
		this.slots.length = 0
		this.disc.dispose()
		this.ring.dispose()
		this.plane.dispose()
		this.sphere.dispose()
	}
}
