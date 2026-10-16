import type { ObjectState } from '@rotline/protocol'
import { ObjectKind } from '@rotline/sim'
import * as THREE from 'three'

type Drawn = { root: THREE.Object3D; kind: number; pulse: THREE.Mesh | null }

const ZONE_COLOURS: Record<number, number> = {
	[ObjectKind.heal]: 0x7cf27c,
	[ObjectKind.toxin]: 0x9fe04a,
	[ObjectKind.fire]: 0xff8a2a,
	[ObjectKind.marker]: 0xff3a2a,
	[ObjectKind.decoy]: 0xffc02e
}

/**
 * Draws what abilities and utilities leave behind: zones as glowing discs, barricades as walls,
 * mines, decoys and sentries as small props, and mortar markers as a pulsing red ring. Objects are
 * few, so each gets its own mesh, made when it appears and removed when it is gone.
 */
export class ObjectRenderer {
	private readonly scene: THREE.Scene
	private readonly drawn = new Map<number, Drawn>()
	private readonly disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)
	private readonly ring = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2)
	private readonly box = new THREE.BoxGeometry(1, 1, 1)

	constructor(scene: THREE.Scene) {
		this.scene = scene
	}

	update(objects: readonly ObjectState[], timeSeconds: number): void {
		const seen = new Set<number>()
		for (const object of objects) {
			seen.add(object.id)
			let drawn = this.drawn.get(object.id)
			if (!drawn || drawn.kind !== object.kind) {
				if (drawn) this.remove(object.id, drawn)
				drawn = this.make(object)
				this.drawn.set(object.id, drawn)
				this.scene.add(drawn.root)
			}
			drawn.root.position.set(object.x, 0, object.y)
			if (object.kind === ObjectKind.barricade) {
				drawn.root.rotation.y = Math.PI / 2 - object.angle
				const wall = drawn.root.children[0] as THREE.Mesh
				;(wall.material as THREE.MeshStandardMaterial).color.setHSL(0.08, 0.35, 0.08 + 0.12 * object.health)
			}
			if (object.kind === ObjectKind.sentry) drawn.root.rotation.y = Math.PI / 2 - object.angle
			if (drawn.pulse) {
				const beat = 0.5 + 0.5 * Math.sin(timeSeconds * (object.kind === ObjectKind.marker ? 14 : 4))
				;(drawn.pulse.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.5 * beat
			}
		}
		for (const [id, drawn] of this.drawn) if (!seen.has(id)) this.remove(id, drawn)
	}

	private make(object: ObjectState): Drawn {
		const root = new THREE.Group()
		let pulse: THREE.Mesh | null = null
		const colour = ZONE_COLOURS[object.kind] ?? 0xffffff
		switch (object.kind) {
			case ObjectKind.heal:
			case ObjectKind.toxin:
			case ObjectKind.fire:
			case ObjectKind.marker: {
				const fill = new THREE.Mesh(
					this.disc,
					new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.18, depthWrite: false })
				)
				fill.scale.setScalar(object.radius)
				fill.position.y = 0.04
				pulse = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.6, depthWrite: false })
				)
				pulse.scale.setScalar(object.radius)
				pulse.position.y = 0.05
				root.add(fill, pulse)
				break
			}
			case ObjectKind.barricade: {
				const wall = new THREE.Mesh(this.box, new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9 }))
				wall.scale.set(object.radius * 2, 1.2, 0.8)
				wall.position.y = 0.6
				wall.castShadow = true
				root.add(wall)
				break
			}
			case ObjectKind.mine: {
				const body = new THREE.Mesh(
					new THREE.CylinderGeometry(0.25, 0.3, 0.12, 16),
					new THREE.MeshStandardMaterial({ color: 0x2e3a2e })
				)
				body.position.y = 0.06
				pulse = new THREE.Mesh(
					new THREE.SphereGeometry(0.07, 8, 6),
					new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true })
				)
				pulse.position.y = 0.16
				root.add(body, pulse)
				break
			}
			case ObjectKind.decoy: {
				const pole = new THREE.Mesh(
					new THREE.CylinderGeometry(0.08, 0.12, 1.4, 10),
					new THREE.MeshStandardMaterial({ color: 0x8a8a7a })
				)
				pole.position.y = 0.7
				pulse = new THREE.Mesh(
					this.ring,
					new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.5, depthWrite: false })
				)
				pulse.scale.setScalar(1.2)
				pulse.position.y = 0.05
				root.add(pole, pulse)
				break
			}
			case ObjectKind.sentry: {
				const base = new THREE.Mesh(
					new THREE.CylinderGeometry(0.3, 0.4, 0.5, 12),
					new THREE.MeshStandardMaterial({ color: 0x3a443b })
				)
				base.position.y = 0.25
				const barrel = new THREE.Mesh(this.box, new THREE.MeshStandardMaterial({ color: 0xb8f23c }))
				barrel.scale.set(0.12, 0.12, 0.7)
				barrel.position.set(0, 0.6, 0.3)
				root.add(base, barrel)
				break
			}
		}
		return { root, kind: object.kind, pulse }
	}

	private remove(id: number, drawn: Drawn): void {
		this.scene.remove(drawn.root)
		drawn.root.traverse(node => {
			const mesh = node as THREE.Mesh
			if (mesh.material) (mesh.material as THREE.Material).dispose()
		})
		this.drawn.delete(id)
	}
}

/** Floating damage numbers (the player's own hits). A small pool of sprites, each with its canvas. */
export class DamageNumbers {
	private readonly sprites: {
		sprite: THREE.Sprite
		canvas: HTMLCanvasElement
		texture: THREE.CanvasTexture
		born: number
	}[] = []
	private head = 0

	constructor(scene: THREE.Scene, size = 24) {
		for (let i = 0; i < size; i++) {
			const canvas = document.createElement('canvas')
			canvas.width = 96
			canvas.height = 40
			const texture = new THREE.CanvasTexture(canvas)
			const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
			sprite.scale.set(1.6, 0.66, 1)
			sprite.visible = false
			scene.add(sprite)
			this.sprites.push({ sprite, canvas, texture, born: -1 })
		}
	}

	show(x: number, y: number, amount: number, now: number): void {
		const slot = this.sprites[this.head] as (typeof this.sprites)[number]
		this.head = (this.head + 1) % this.sprites.length
		const ctx = slot.canvas.getContext('2d') as CanvasRenderingContext2D
		ctx.clearRect(0, 0, 96, 40)
		ctx.font = 'bold 30px "Chakra Petch", sans-serif'
		ctx.textAlign = 'center'
		ctx.lineWidth = 5
		ctx.strokeStyle = '#0d100e'
		ctx.fillStyle = amount >= 100 ? '#ffc02e' : '#ece8dc'
		const text = String(Math.round(amount))
		ctx.strokeText(text, 48, 30)
		ctx.fillText(text, 48, 30)
		slot.texture.needsUpdate = true
		slot.sprite.position.set(x + (Math.random() - 0.5) * 0.6, 2.2, y)
		slot.sprite.visible = true
		slot.born = now
	}

	update(now: number): void {
		for (const slot of this.sprites) {
			if (slot.born < 0) continue
			const t = (now - slot.born) / 0.7
			if (t >= 1) {
				slot.sprite.visible = false
				slot.born = -1
				continue
			}
			slot.sprite.position.y = 2.2 + t * 1.2
			slot.sprite.material.opacity = 1 - t * t
		}
	}
}
