import * as THREE from 'three'

const SLOT_COLOURS = [0xb8f23c, 0x4fb3ff, 0xffc02e, 0xff7ad9]

/** A placeholder soldier: body, weapon pointing along the aim, and a coloured ring per player slot. */
export class PlayerFigure {
	readonly group = new THREE.Group()
	private readonly body: THREE.Mesh
	private readonly gun: THREE.Mesh
	private readonly ring: THREE.Mesh
	private readonly material: THREE.MeshStandardMaterial

	constructor(slot: number, isSelf: boolean) {
		const colour = SLOT_COLOURS[(slot - 1) % SLOT_COLOURS.length] ?? 0xffffff
		this.material = new THREE.MeshStandardMaterial({ color: 0x3b4a3c, roughness: 0.7 })
		this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 4, 10), this.material)
		this.body.position.y = 0.8
		this.body.castShadow = true
		const head = new THREE.Mesh(
			new THREE.SphereGeometry(0.2, 12, 10),
			new THREE.MeshStandardMaterial({ color: 0x2a3329 })
		)
		head.position.y = 1.55
		head.castShadow = true
		this.gun = new THREE.Mesh(
			new THREE.BoxGeometry(0.12, 0.12, 0.8),
			new THREE.MeshStandardMaterial({ color: 0x15191a })
		)
		this.gun.position.set(0.22, 1.05, 0.45)
		this.gun.castShadow = true
		this.ring = new THREE.Mesh(
			new THREE.RingGeometry(0.5, isSelf ? 0.62 : 0.58, 32),
			new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: isSelf ? 0.9 : 0.7 })
		)
		this.ring.rotation.x = -Math.PI / 2
		this.ring.position.y = 0.03
		const pivot = new THREE.Group()
		pivot.add(this.body, head, this.gun)
		this.group.add(pivot, this.ring)
		this.group.userData.pivot = pivot
	}

	set(x: number, y: number, aimAngle: number, alive: boolean): void {
		this.group.position.set(x, 0, y)
		const pivot = this.group.userData.pivot as THREE.Group
		pivot.rotation.y = Math.PI / 2 - aimAngle
		pivot.rotation.z = alive ? 0 : Math.PI / 2.4
		pivot.position.y = alive ? 0 : 0.25
		this.material.opacity = alive ? 1 : 0.6
	}

	/** World position of the muzzle, for flashes and tracers. */
	muzzle(out: THREE.Vector3): THREE.Vector3 {
		return this.gun.getWorldPosition(out).add(new THREE.Vector3(0, 0, 0))
	}

	dispose(): void {
		this.group.removeFromParent()
	}
}
