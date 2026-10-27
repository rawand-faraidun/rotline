import type { MissionDef } from '@rotline/game-data'
import { hazardFront, type Prop } from '@rotline/sim'
import * as THREE from 'three'

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

/** Rising tongues of fire (or a green fog of gas) on a strip that scrolls upward. */
function flameTexture(fire: boolean): THREE.CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = 256
	canvas.height = 128
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	for (let n = 0; n < 90; n++) {
		const x = Math.random() * 256
		const y = 40 + Math.random() * 88
		const r = 10 + Math.random() * 26
		const g = ctx.createRadialGradient(x, y, 0, x, y, r)
		g.addColorStop(0, fire ? 'rgba(255,200,90,0.8)' : 'rgba(170,230,90,0.55)')
		g.addColorStop(0.5, fire ? 'rgba(255,90,20,0.45)' : 'rgba(90,150,40,0.3)')
		g.addColorStop(1, 'rgba(0,0,0,0)')
		ctx.fillStyle = g
		ctx.fillRect(x - r, y - r, r * 2, r * 2)
	}
	const texture = new THREE.CanvasTexture(canvas)
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping
	texture.repeat.set(80, 1)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
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

/** Flames (or puffs of gas) along a hazard's front: how many, how wide the band is, how deep behind it. */
const PUFFS = 360
const PUFF_SPAN = 60
const PUFF_DEPTH = 5

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
		props: readonly Prop[]
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
		} else if (objective.type === 'escape') {
			const front = hazardFront(objective.hazard, seconds)
			const [strip, behind, puffs] = group.children as [THREE.Mesh, THREE.Mesh, THREE.Points]
			// the planes' depth runs along the way the front moves
			const heading = Math.atan2(front.dx, front.dy)
			strip.position.set(front.x, 0.14, front.y)
			strip.rotation.y = heading
			behind.position.set(front.x - front.dx * 60, 0.1, front.y - front.dy * 60)
			behind.rotation.y = heading
			const texture = (strip.material as THREE.MeshBasicMaterial).map
			if (texture) texture.offset.y = -timeSeconds * 0.9
			// flames lick up along the front and die back behind it; gas rolls and thins
			const fire = objective.hazard.kind === 'fire'
			const seeds = puffs.userData.seeds as Float32Array
			const position = puffs.geometry.getAttribute('position') as THREE.BufferAttribute
			const color = puffs.geometry.getAttribute('color') as THREE.BufferAttribute
			const across = { x: front.dy, y: -front.dx }
			for (let n = 0; n < PUFFS; n++) {
				const side = ((seeds[n * 3] as number) - 0.5) * PUFF_SPAN * 2
				const back = (((seeds[n * 3 + 1] as number) * PUFF_DEPTH + timeSeconds * (fire ? 1.4 : 0.6)) % PUFF_DEPTH) - 0.6
				const phase = seeds[n * 3 + 2] as number
				const rise = fire ? 0.3 + Math.abs(Math.sin(timeSeconds * 5 + phase * 20)) * 0.9 : 0.4 + phase * 0.5
				position.setXYZ(
					n,
					front.x + across.x * side - front.dx * back,
					rise,
					front.y + across.y * side - front.dy * back
				)
				const strength =
					Math.max(0, 1 - Math.max(0, back) / PUFF_DEPTH) * (0.6 + 0.4 * Math.sin(timeSeconds * 9 + phase * 40))
				if (fire) color.setXYZ(n, 1 * strength, (0.45 + phase * 0.3) * strength, 0.12 * strength)
				else color.setXYZ(n, 0.35 * strength, 0.6 * strength, 0.15 * strength)
			}
			position.needsUpdate = true
			color.needsUpdate = true
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
		} else if (objective.type === 'escape') {
			const fire = objective.hazard.kind === 'fire'
			// a burning band on the ground along the front (lying flat, so the camera above sees it)
			const strip = new THREE.Mesh(
				new THREE.PlaneGeometry(400, 3).rotateX(-Math.PI / 2),
				new THREE.MeshBasicMaterial({
					map: flameTexture(fire),
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false
				})
			)
			// behind it the ground is scorched (or fouled): glowing at the front, dark further back
			const behindGeometry = new THREE.PlaneGeometry(400, 120, 1, 12).rotateX(-Math.PI / 2)
			const near = new THREE.Color(fire ? 0x4a1604 : 0x2e4a0e)
			const far = new THREE.Color(fire ? 0x120604 : 0x15200a)
			const tint = new THREE.Color()
			const vertices = behindGeometry.getAttribute('position')
			const colors = new Float32Array(vertices.count * 3)
			for (let n = 0; n < vertices.count; n++) {
				// +z is the front's edge (the planes face the way the front moves)
				const toFront = (60 - vertices.getZ(n)) / 120
				tint.copy(near).lerp(far, Math.min(1, toFront * 6))
				tint.toArray(colors, n * 3)
			}
			behindGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
			const behind = new THREE.Mesh(
				behindGeometry,
				new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false })
			)
			strip.renderOrder = behind.renderOrder + 1
			const puffGeometry = new THREE.BufferGeometry()
			puffGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3))
			puffGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3))
			const puffs = new THREE.Points(
				puffGeometry,
				new THREE.PointsMaterial({
					map: puffTexture(),
					size: fire ? 2 : 2.8,
					vertexColors: true,
					transparent: true,
					blending: THREE.AdditiveBlending,
					depthWrite: false
				})
			)
			puffs.frustumCulled = false
			puffs.renderOrder = strip.renderOrder + 1
			const seeds = new Float32Array(PUFFS * 3)
			for (let n = 0; n < seeds.length; n++) seeds[n] = Math.random()
			puffs.userData.seeds = seeds
			group.add(strip, behind, puffs)
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
