import type { MissionDef } from '@rotline/game-data'
import * as THREE from 'three'

/**
 * Mission markers from the mission's data: a ring where the current objective wants the squad,
 * and the hidden caches this player has not opened yet.
 */
export class MissionMarkers {
	private readonly scene: THREE.Scene
	private readonly mission: MissionDef
	private readonly area: THREE.Mesh
	private readonly fill: THREE.Mesh
	private readonly caches: THREE.Group[] = []

	constructor(scene: THREE.Scene, mission: MissionDef) {
		this.scene = scene
		this.mission = mission
		const ring = new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2)
		this.area = new THREE.Mesh(
			ring,
			new THREE.MeshBasicMaterial({ color: 0xb8f23c, transparent: true, opacity: 0.7, depthWrite: false })
		)
		this.fill = new THREE.Mesh(
			new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: 0xb8f23c, transparent: true, opacity: 0.08, depthWrite: false })
		)
		this.area.position.y = 0.06
		this.fill.position.y = 0.05
		this.area.visible = this.fill.visible = false
		scene.add(this.area, this.fill)
		const box = new THREE.BoxGeometry(0.9, 0.6, 0.6)
		const lid = new THREE.BoxGeometry(0.95, 0.12, 0.65)
		for (const cache of mission.caches) {
			const crate = new THREE.Group()
			const body = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.8 }))
			body.position.y = 0.3
			body.castShadow = true
			const top = new THREE.Mesh(lid, new THREE.MeshStandardMaterial({ color: 0xffc02e, roughness: 0.6 }))
			top.position.y = 0.66
			crate.add(body, top)
			crate.position.set(cache.x, 0, cache.y)
			scene.add(crate)
			this.caches.push(crate)
		}
	}

	/** `objective` is the current objective's index; `opened` has bit n set for opened cache n. */
	update(objective: number, active: boolean, opened: number, timeSeconds: number): void {
		const current = this.mission.objectives[objective]
		const area = active && current && 'area' in current ? current.area : null
		this.area.visible = this.fill.visible = area !== null
		if (area) {
			this.area.position.set(area.x, 0.06, area.y)
			this.fill.position.set(area.x, 0.05, area.y)
			this.area.scale.setScalar(area.radius)
			this.fill.scale.setScalar(area.radius)
			;(this.area.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * Math.sin(timeSeconds * 3) ** 2
		}
		for (const [index, crate] of this.caches.entries()) crate.visible = (opened & (1 << index)) === 0
	}

	dispose(): void {
		this.scene.remove(this.area, this.fill, ...this.caches)
		const geometries = new Set<THREE.BufferGeometry>()
		const materials = new Set<THREE.Material>()
		for (const root of [this.area, this.fill, ...this.caches]) {
			root.traverse(node => {
				const mesh = node as THREE.Mesh
				if (mesh.geometry) geometries.add(mesh.geometry)
				if (mesh.material) materials.add(mesh.material as THREE.Material)
			})
		}
		for (const geometry of geometries) geometry.dispose()
		for (const material of materials) material.dispose()
	}
}
