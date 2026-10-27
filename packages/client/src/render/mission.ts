import type { MissionDef } from '@rotline/game-data'
import { hazardFront, type Prop, PropState } from '@rotline/sim'
import * as THREE from 'three'
import { EFFECTS_LAYER } from './post.ts'

/** How the things a gather objective scatters look: size, colour and the glow round them. */
const GATHER_LOOKS: Record<
	'sample' | 'fuel' | 'intel' | 'supplies',
	{ size: [number, number, number]; color: number; glow: number }
> = {
	sample: { size: [0.6, 0.36, 0.42], color: 0xd8dde0, glow: 0x7fd8ff },
	fuel: { size: [0.46, 0.62, 0.28], color: 0xa02a1a, glow: 0xffa040 },
	intel: { size: [0.5, 0.1, 0.64], color: 0xe8dfc8, glow: 0xffe6a0 },
	supplies: { size: [0.7, 0.5, 0.56], color: 0x4a5a3a, glow: 0xb8f23c }
}

/** A soft round blob for flame and gas particles. */
function puffTexture(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 64
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
	g.addColorStop(0, 'rgba(255,255,255,1)')
	g.addColorStop(0.4, 'rgba(255,255,255,0.5)')
	g.addColorStop(1, 'rgba(255,255,255,0)')
	ctx.fillStyle = g
	ctx.fillRect(0, 0, 64, 64)
	return new THREE.CanvasTexture(canvas)
}

/**
 * A hazard's front is drawn round where the player is: this many flames (or rolling puffs of gas) and
 * puffs of smoke, over this many metres along it and this deep behind it.
 */
const FLAMES = 2400
const SMOKE = 160
const FRONT_SPAN = 26
const FRONT_DEPTH = 1.8

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
	/** notes lying about: a sheet of paper each, with a slow glow so they can be found */
	private readonly notes: THREE.Group[] = []
	/** per objective: what it puts in the world (gather items, capture areas, a hazard's front) */
	private readonly pieces = new Map<number, THREE.Group>()
	private shownObjective = -1

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
		const sheet = new THREE.BoxGeometry(0.32, 0.01, 0.42)
		const halo = new THREE.CircleGeometry(0.55, 32).rotateX(-Math.PI / 2)
		for (const [index, note] of (mission.notes ?? []).entries()) {
			const group = new THREE.Group()
			const paper = new THREE.Mesh(
				sheet,
				new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.9, emissive: 0x6a6450, emissiveIntensity: 0.6 })
			)
			paper.position.y = 0.03
			paper.rotation.y = index * 1.3
			const glow = new THREE.Mesh(
				halo,
				new THREE.MeshBasicMaterial({
					color: 0xffe6a0,
					transparent: true,
					opacity: 0.25,
					blending: THREE.AdditiveBlending,
					depthWrite: false
				})
			)
			glow.position.y = 0.02
			group.add(paper, glow)
			group.position.set(note.x, 0, note.y)
			scene.add(group)
			this.notes.push(group)
		}
	}

	/**
	 * Objectives with things of their own: items lying to be picked up (each kind its own look), areas
	 * to take (a ring filling as it is held), the front of a hazard sweeping across (a wall of fire or
	 * gas, the ground behind it scorched or fouled), the vehicle to walk with (a ring as far as it
	 * drives for, its road ahead).
	 */
	objectiveState(
		index: number,
		picked: number,
		areas: readonly number[],
		seconds: number,
		timeSeconds: number,
		props: readonly Prop[],
		focus: { x: number; y: number }
	): void {
		if (index !== this.shownObjective) {
			this.pieces.get(this.shownObjective)?.removeFromParent()
			this.shownObjective = index
			const group = this.pieces.get(index) ?? this.build(index)
			if (group) {
				this.pieces.set(index, group)
				this.scene.add(group)
			}
		}
		const objective = this.mission.objectives[index]
		const group = this.pieces.get(index)
		if (!objective || !group) return
		if (objective.type === 'gather') {
			for (const [n, item] of group.children.entries()) {
				item.visible = (picked & (1 << n)) === 0
				item.position.y = 0.15 + Math.sin(timeSeconds * 2.5 + n) * 0.08
				item.rotation.y = timeSeconds * 1.2 + n
			}
		} else if (objective.type === 'capture') {
			for (const [n, area] of objective.areas.entries()) {
				const ring = group.children[n * 2] as THREE.Mesh
				const fill = group.children[n * 2 + 1] as THREE.Mesh
				const level = areas[n] ?? 0
				fill.scale.setScalar(Math.max(0.01, level) * area.radius)
				;(ring.material as THREE.MeshBasicMaterial).color.setHex(level >= 1 ? 0xb8f23c : 0xffc02e)
				;(ring.material as THREE.MeshBasicMaterial).opacity =
					level >= 1 ? 0.7 : 0.45 + 0.3 * Math.sin(timeSeconds * 4) ** 2
			}
		} else if (objective.type === 'escort') {
			const vehicle = props.find(prop => prop.def.id === objective.prop)
			const ring = group.children[0] as THREE.Mesh
			ring.visible = vehicle !== undefined
			if (vehicle) {
				// eased toward where the snapshots put it, as the vehicle itself is drawn
				const snap = ring.position.y === 0 || Math.hypot(vehicle.x - ring.position.x, vehicle.y - ring.position.z) > 4
				ring.position.set(
					snap ? vehicle.x : ring.position.x + (vehicle.x - ring.position.x) * 0.15,
					0.07,
					snap ? vehicle.y : ring.position.z + (vehicle.y - ring.position.z) * 0.15
				)
			}
			;(ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.25 * Math.sin(timeSeconds * 3) ** 2
			const road = group.children[1] as THREE.Line
			;(road.material as THREE.LineDashedMaterial).opacity = 0.35 + 0.2 * Math.sin(timeSeconds * 2) ** 2
		} else if (objective.type === 'demolish') {
			// the blast's reach round an armed charge: get out of the red
			const charge = props.find(prop => prop.def.id === objective.prop)
			const armed = charge?.state === PropState.active
			const [ring, fill] = group.children as [THREE.Mesh, THREE.Mesh]
			ring.visible = fill.visible = armed
			if (charge && armed) {
				ring.position.set(charge.x, 0.08, charge.y)
				fill.position.set(charge.x, 0.07, charge.y)
				;(ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(timeSeconds * 10) ** 2
				;(fill.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.06 * Math.sin(timeSeconds * 10) ** 2
			}
		} else if (objective.type === 'escape') {
			const front = hazardFront(objective.hazard, seconds)
			const [behind, glow, flames, smoke, ...lights] = group.children as [
				THREE.Mesh,
				THREE.Mesh,
				THREE.Points,
				THREE.Points,
				...THREE.PointLight[]
			]
			const fire = objective.hazard.kind === 'fire'
			// the planes' depth runs along the way the front moves
			const heading = Math.atan2(front.dx, front.dy)
			behind.position.set(front.x - front.dx * 60, 0.1, front.y - front.dy * 60)
			behind.rotation.y = heading
			// the ground burning just behind the front, flickering
			glow.position.set(front.x - front.dx * 1.2, 0.12, front.y - front.dy * 1.2)
			glow.rotation.y = heading
			;(glow.material as THREE.MeshBasicMaterial).opacity =
				0.45 + 0.15 * Math.sin(timeSeconds * 11) * Math.sin(timeSeconds * 4.3)
			// drawn along the stretch of the front nearest the player
			const across = { x: front.dy, y: -front.dx }
			const along = (focus.x - front.x) * across.x + (focus.y - front.y) * across.y
			const cx = front.x + across.x * along
			const cy = front.y + across.y * along
			const seeds = flames.userData.seeds as Float32Array
			const position = flames.geometry.getAttribute('position') as THREE.BufferAttribute
			const color = flames.geometry.getAttribute('color') as THREE.BufferAttribute
			for (let n = 0; n < FLAMES; n++) {
				const s0 = seeds[n * 4] as number
				const s1 = seeds[n * 4 + 1] as number
				const s2 = seeds[n * 4 + 2] as number
				const s3 = seeds[n * 4 + 3] as number
				// each flame rises over its own short life and narrows; gas rolls low and slow
				const life = (timeSeconds * (fire ? 1.3 + s2 : 0.35 + s2 * 0.3) + s3 * 9) % 1
				// flames burn in clumps along the front (tongues with darker gaps between), gas evenly
				const clump = Math.floor(s0 * 70)
				const side = fire
					? (clump / 70 - 0.5) * FRONT_SPAN * 2 + Math.sin(timeSeconds * 0.8 + clump) * 0.5 + (s3 - 0.5) * 1.1
					: (s0 - 0.5) * FRONT_SPAN * 2 + Math.sin(timeSeconds * 2 + s3 * 30) * 0.3
				const back = s1 * s1 * FRONT_DEPTH
				const height = fire ? life * (0.8 + 1.8 * (1 - back / FRONT_DEPTH)) * (0.5 + s2) : 0.3 + life * 1.2
				position.setXYZ(
					n,
					cx + across.x * side - front.dx * (back - (fire ? 0 : life * 1.5)),
					height,
					cy + across.y * side - front.dy * (back - (fire ? 0 : life * 1.5))
				)
				const strength = (1 - life) * (fire ? 0.55 : 0.5) * (1 - (back / FRONT_DEPTH) * 0.5)
				// white-yellow at the root of a flame, orange, then a dull red as it dies
				if (fire)
					color.setXYZ(n, strength, (0.12 + (1 - life) ** 2 * 0.55) * strength, (1 - life) ** 4 * 0.2 * strength)
				else color.setXYZ(n, 0.32 * strength, 0.62 * strength, 0.14 * strength)
			}
			position.needsUpdate = true
			color.needsUpdate = true
			const smokeSeeds = smoke.userData.seeds as Float32Array
			const smokePosition = smoke.geometry.getAttribute('position') as THREE.BufferAttribute
			for (let n = 0; n < SMOKE; n++) {
				const s0 = smokeSeeds[n * 3] as number
				const s1 = smokeSeeds[n * 3 + 1] as number
				const life = (timeSeconds * (0.18 + s1 * 0.15) + s0 * 7) % 1
				const side = (s0 - 0.5) * FRONT_SPAN * 2
				// rising, and blown back over the ground already burnt
				const back = 1 + life * 6
				smokePosition.setXYZ(
					n,
					cx + across.x * side - front.dx * back,
					2 + life * 5,
					cy + across.y * side - front.dy * back
				)
			}
			smokePosition.needsUpdate = true
			for (const [n, light] of lights.entries()) {
				const side = (n - (lights.length - 1) / 2) * 14
				light.position.set(cx + across.x * side, 1.6, cy + across.y * side)
				light.intensity =
					(fire ? 26 : 10) * (0.75 + 0.25 * Math.sin(timeSeconds * (13 + n * 4)) * Math.sin(timeSeconds * 5.1))
			}
		}
	}

	private build(index: number): THREE.Group | null {
		const objective = this.mission.objectives[index]
		if (!objective) return null
		const group = new THREE.Group()
		if (objective.type === 'gather') {
			const look = GATHER_LOOKS[objective.look]
			const geometry = new THREE.BoxGeometry(...look.size)
			const material = new THREE.MeshStandardMaterial({
				color: look.color,
				emissive: look.glow,
				emissiveIntensity: 0.8,
				roughness: 0.6
			})
			for (const item of objective.items) {
				const piece = new THREE.Group()
				const body = new THREE.Mesh(geometry, material)
				body.castShadow = true
				const halo = new THREE.Mesh(
					new THREE.CircleGeometry(0.95, 24).rotateX(-Math.PI / 2),
					new THREE.MeshBasicMaterial({
						color: look.glow,
						transparent: true,
						opacity: 0.3,
						blending: THREE.AdditiveBlending,
						depthWrite: false
					})
				)
				halo.position.y = -0.12
				piece.add(body, halo)
				piece.position.set(item.x, 0.15, item.y)
				group.add(piece)
			}
		} else if (objective.type === 'capture') {
			for (const area of objective.areas) {
				const ring = new THREE.Mesh(
					new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2),
					new THREE.MeshBasicMaterial({ color: 0xffc02e, transparent: true, opacity: 0.6, depthWrite: false })
				)
				ring.scale.setScalar(area.radius)
				ring.position.set(area.x, 0.07, area.y)
				const fill = new THREE.Mesh(
					new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
					new THREE.MeshBasicMaterial({ color: 0xb8f23c, transparent: true, opacity: 0.18, depthWrite: false })
				)
				fill.position.set(area.x, 0.06, area.y)
				group.add(ring, fill)
			}
		} else if (objective.type === 'escort') {
			// it drives while someone is inside this ring
			const ring = new THREE.Mesh(
				new THREE.RingGeometry(0.97, 1, 72).rotateX(-Math.PI / 2),
				new THREE.MeshBasicMaterial({ color: 0xffc02e, transparent: true, opacity: 0.4, depthWrite: false })
			)
			ring.scale.setScalar(objective.radius)
			const road = new THREE.Line(
				new THREE.BufferGeometry().setFromPoints(
					objective.path.map(point => new THREE.Vector3(point.x, 0.09, point.y))
				),
				new THREE.LineDashedMaterial({ color: 0xffc02e, dashSize: 0.8, gapSize: 0.6, transparent: true })
			)
			road.computeLineDistances()
			group.add(ring, road)
		} else if (objective.type === 'demolish') {
			const ring = new THREE.Mesh(
				new THREE.RingGeometry(0.96, 1, 72).rotateX(-Math.PI / 2),
				new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.7, depthWrite: false })
			)
			const fill = new THREE.Mesh(
				new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2),
				new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.1, depthWrite: false })
			)
			ring.scale.setScalar(objective.radius)
			fill.scale.setScalar(objective.radius)
			group.add(ring, fill)
		} else if (objective.type === 'escape') {
			const fire = objective.hazard.kind === 'fire'
			// behind the front the ground is scorched (or fouled): glowing near it, dark further back
			const behindGeometry = new THREE.PlaneGeometry(400, 120, 1, 12).rotateX(-Math.PI / 2)
			const near = new THREE.Color(fire ? 0x3a1404 : 0x2e4a0e)
			const far = new THREE.Color(fire ? 0x0c0806 : 0x15200a)
			const tint = new THREE.Color()
			const vertices = behindGeometry.getAttribute('position')
			const colors = new Float32Array(vertices.count * 3)
			for (let n = 0; n < vertices.count; n++) {
				// +z is the front's edge (the plane faces the way the front moves)
				const toFront = (60 - vertices.getZ(n)) / 120
				tint.copy(near).lerp(far, Math.min(1, toFront * 8))
				tint.toArray(colors, n * 3)
			}
			behindGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
			const behind = new THREE.Mesh(
				behindGeometry,
				new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65, depthWrite: false })
			)
			const points = (count: number, seedsPer: number, material: THREE.PointsMaterial) => {
				const geometry = new THREE.BufferGeometry()
				geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
				geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3))
				const mesh = new THREE.Points(geometry, material)
				mesh.frustumCulled = false
				mesh.userData.seeds = new Float32Array(count * seedsPer).map(() => Math.random())
				return mesh
			}
			// the ground alight in a band behind the front, brightest at its edge
			const glowGeometry = new THREE.PlaneGeometry(400, 2.4, 1, 4).rotateX(-Math.PI / 2)
			const glowVertices = glowGeometry.getAttribute('position')
			const glowColors = new Float32Array(glowVertices.count * 3)
			const hot = new THREE.Color(fire ? 0xff6a14 : 0x5aa02a)
			for (let n = 0; n < glowVertices.count; n++) {
				// clamped: a hair below zero would turn the power below into NaN (and the screen black under bloom)
				const edge = Math.min(1, Math.max(0, (glowVertices.getZ(n) + 1.2) / 2.4))
				hot
					.clone()
					.multiplyScalar(edge ** 1.5)
					.toArray(glowColors, n * 3)
			}
			glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3))
			const glow = new THREE.Mesh(
				glowGeometry,
				new THREE.MeshBasicMaterial({
					vertexColors: true,
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false
				})
			)
			glow.layers.set(EFFECTS_LAYER)
			const flames = points(
				FLAMES,
				4,
				new THREE.PointsMaterial({
					map: puffTexture(),
					size: fire ? 0.95 : 3.2,
					vertexColors: true,
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false
				})
			)
			flames.layers.set(EFFECTS_LAYER)
			const smoke = points(
				SMOKE,
				3,
				new THREE.PointsMaterial({
					map: puffTexture(),
					size: fire ? 5.5 : 5,
					color: fire ? 0x1a1614 : 0x2a3a14,
					transparent: true,
					opacity: fire ? 0.55 : 0.25,
					depthWrite: false
				})
			)
			group.add(behind, glow, flames, smoke)
			for (let n = 0; n < 2; n++) group.add(new THREE.PointLight(fire ? 0xff7a2a : 0x9adf4a, 0, 18, 1.6))
		} else return null
		return group
	}

	/** Notes already read are drawn dimmer (they stay where they lie). */
	markNotes(read: ReadonlySet<string>, prefix: string, timeSeconds: number): void {
		for (const [index, group] of this.notes.entries()) {
			const note = this.mission.notes?.[index]
			const glow = group.children[1] as THREE.Mesh
			const material = glow.material as THREE.MeshBasicMaterial
			material.opacity =
				note && read.has(prefix + note.id) ? 0.06 : 0.18 + 0.2 * Math.sin(timeSeconds * 2.4 + index) ** 2
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
		this.scene.remove(this.area, this.fill, ...this.caches, ...this.notes, ...this.pieces.values())
		const geometries = new Set<THREE.BufferGeometry>()
		const materials = new Set<THREE.Material>()
		for (const root of [this.area, this.fill, ...this.caches, ...this.notes, ...this.pieces.values()]) {
			root.traverse(node => {
				const mesh = node as THREE.Mesh
				if (mesh.geometry) geometries.add(mesh.geometry)
				if (mesh.material) materials.add(mesh.material as THREE.Material)
			})
		}
		for (const geometry of geometries) geometry.dispose()
		for (const material of materials) {
			;(material as THREE.MeshBasicMaterial).map?.dispose()
			material.dispose()
		}
	}
}
