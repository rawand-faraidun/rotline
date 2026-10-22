import type { MapDef } from '@rotline/game-data'
import * as THREE from 'three'

/**
 * Dressing every map gets without anyone placing it: litter along the walls (trash bags, cardboard,
 * tyres, jerrycans, crates) and marks on the ground (cracks, oil stains, puddles, scattered paper).
 * Drawing only; placed the same way every time for a map (seeded by its id), and kept clear of
 * spawns, props and the map's own scenery.
 */

/** small scenery models that can lean against a wall without looking like they block the way */
const LITTER = [
	'scene-trash',
	'scene-cardboard',
	'scene-tyre',
	'scene-jerrycan',
	'scene-plastic-crate',
	'scene-propane'
]
/** chance a floor cell along a wall gets a piece of litter */
const LITTER_CHANCE = 0.07
/** ground marks per square metre of open floor */
const MARKS_PER_CELL = 0.06

function random(seed: string): () => number {
	let state = 2166136261
	for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 4294967296
	}
}

/** The scenery to scatter: entries in the same form as a map's own `decor`. */
export function autoDecor(map: MapDef): NonNullable<MapDef['decor']> {
	const rng = random(`${map.id}:litter`)
	const solid = solidCells(map)
	const keepClear = clearCells(map)
	const decor: NonNullable<MapDef['decor']> = []
	for (let y = 1; y < map.height - 1; y++)
		for (let x = 1; x < map.width - 1; x++) {
			const cell = y * map.width + x
			if (solid[cell] || keepClear[cell]) continue
			// against a wall on one side: lean on it
			const sides = [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1]
			].filter(([dx, dy]) => solid[(y + (dy as number)) * map.width + x + (dx as number)])
			const side = sides[0]
			if (!side || rng() > LITTER_CHANCE) continue
			const model = LITTER[Math.floor(rng() * LITTER.length)] as string
			const lying = model === 'scene-tyre' || (model === 'scene-jerrycan' && rng() < 0.4)
			decor.push({
				model,
				x: x + 0.5 + (side[0] as number) * 0.3 + (rng() - 0.5) * 0.4,
				y: y + 0.5 + (side[1] as number) * 0.3 + (rng() - 0.5) * 0.4,
				rotation: lying ? [90, rng() * 360, 0] : [0, rng() * 360, 0],
				scale: 0.9 + rng() * 0.25
			})
		}
	return decor
}

/** The marks on the ground: a texture atlas of four kinds, laid as flat quads. */
export function groundMarks(map: MapDef): THREE.Object3D {
	const rng = random(`${map.id}:marks`)
	const solid = solidCells(map)
	const atlas = markAtlas()
	const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
	const material = new THREE.MeshStandardMaterial({
		map: atlas,
		transparent: true,
		depthWrite: false,
		roughness: 0.6,
		polygonOffset: true,
		polygonOffsetFactor: -1
	})
	const open: number[] = []
	for (let cell = 0; cell < solid.length; cell++) if (!solid[cell]) open.push(cell)
	const count = Math.round(open.length * MARKS_PER_CELL)
	// one mesh per kind, so each samples its quarter of the atlas
	const group = new THREE.Group()
	const kinds = [0, 1, 2, 3].map(kind => {
		const quarter = geometry.clone()
		const uv = quarter.getAttribute('uv') as THREE.BufferAttribute
		for (let i = 0; i < uv.count; i++)
			uv.setXY(i, (uv.getX(i) + (kind % 2)) / 2, (uv.getY(i) + Math.floor(kind / 2)) / 2)
		const mesh = new THREE.InstancedMesh(quarter, material, count)
		mesh.count = 0
		mesh.receiveShadow = true
		group.add(mesh)
		return mesh
	})
	const matrix = new THREE.Matrix4()
	const turn = new THREE.Quaternion()
	const up = new THREE.Vector3(0, 1, 0)
	for (let n = 0; n < count; n++) {
		const cell = open[Math.floor(rng() * open.length)] as number
		const kind = Math.floor(rng() * 4)
		// cracks long, puddles and stains wide, paper small
		const size = kind === 0 ? 2 + rng() * 2.5 : kind === 3 ? 0.8 + rng() * 0.8 : 1.2 + rng() * 2
		turn.setFromAxisAngle(up, rng() * Math.PI * 2)
		matrix.compose(
			new THREE.Vector3((cell % map.width) + rng(), 0.012 + n * 0.00001, Math.floor(cell / map.width) + rng()),
			turn,
			new THREE.Vector3(size, 1, size)
		)
		const mesh = kinds[kind] as THREE.InstancedMesh
		mesh.setMatrixAt(mesh.count++, matrix)
	}
	for (const mesh of kinds) mesh.instanceMatrix.needsUpdate = true
	return group
}

function solidCells(map: MapDef): Uint8Array {
	const cells = new Uint8Array(map.width * map.height)
	for (const wall of [...map.walls, ...(map.blockers ?? [])])
		for (let y = wall.y; y < wall.y + wall.h; y++)
			for (let x = wall.x; x < wall.x + wall.w; x++)
				if (x >= 0 && y >= 0 && x < map.width && y < map.height) cells[y * map.width + x] = 1
	return cells
}

/** Cells to leave bare: near spawns, props and scenery placed by hand. */
function clearCells(map: MapDef): Uint8Array {
	const cells = new Uint8Array(map.width * map.height)
	const clear = (cx: number, cy: number, radius: number) => {
		for (let y = Math.floor(cy - radius); y <= cy + radius; y++)
			for (let x = Math.floor(cx - radius); x <= cx + radius; x++)
				if (x >= 0 && y >= 0 && x < map.width && y < map.height) cells[y * map.width + x] = 1
	}
	for (const spawn of map.playerSpawns) clear(spawn.x, spawn.y, 2)
	for (const spawn of map.zombieSpawns) clear(spawn.x, spawn.y, 1.5)
	for (const prop of map.props ?? [])
		clear(prop.x + (prop.w ?? 1) / 2, prop.y + (prop.h ?? 1) / 2, Math.max(prop.w ?? 1, prop.h ?? 1) / 2 + 1)
	for (const entry of map.decor ?? []) clear(entry.x, entry.y, 1.5)
	return cells
}

/** Four ground marks drawn into one texture: a crack, an oil stain, a puddle, scattered paper. */
function markAtlas(): THREE.CanvasTexture {
	const size = 256
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size * 2
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const rng = random('marks')
	const cell = (kind: number) => [(kind % 2) * size, (1 - Math.floor(kind / 2)) * size] as const
	// a crack: a jagged line with a few branches
	{
		const [ox, oy] = cell(0)
		ctx.strokeStyle = 'rgba(12, 11, 10, 0.85)'
		ctx.lineCap = 'round'
		const branch = (x: number, y: number, angle: number, length: number, width: number) => {
			ctx.lineWidth = width
			ctx.beginPath()
			ctx.moveTo(ox + x, oy + y)
			for (let step = 0; step < length; step += 10) {
				angle += (rng() - 0.5) * 0.9
				x += Math.cos(angle) * 10
				y += Math.sin(angle) * 10
				ctx.lineTo(ox + x, oy + y)
				if (rng() < 0.12 && width > 1) branch(x, y, angle + (rng() - 0.5) * 2, length / 3, width * 0.6)
			}
			ctx.stroke()
		}
		branch(20, size / 2, 0, size - 40, 3.5)
	}
	// an oil stain: dark, soft-edged, uneven
	{
		const [ox, oy] = cell(1)
		for (let blob = 0; blob < 6; blob++) {
			const x = ox + size / 2 + (rng() - 0.5) * 60
			const y = oy + size / 2 + (rng() - 0.5) * 60
			const r = 25 + rng() * 35
			const g = ctx.createRadialGradient(x, y, 0, x, y, r)
			g.addColorStop(0, 'rgba(8, 8, 10, 0.22)')
			g.addColorStop(1, 'rgba(8, 8, 10, 0)')
			ctx.fillStyle = g
			ctx.fillRect(ox, oy, size, size)
		}
	}
	// a puddle: dark water with a pale rim of reflected sky
	{
		const [ox, oy] = cell(2)
		ctx.save()
		ctx.beginPath()
		for (let i = 0; i <= 30; i++) {
			const a = (i / 30) * Math.PI * 2
			const r = 90 * (0.75 + rng() * 0.3)
			ctx.lineTo(ox + size / 2 + Math.cos(a) * r, oy + size / 2 + Math.sin(a) * r * 0.7)
		}
		ctx.closePath()
		ctx.fillStyle = 'rgba(20, 26, 32, 0.45)'
		ctx.fill()
		ctx.strokeStyle = 'rgba(150, 165, 180, 0.25)'
		ctx.lineWidth = 3
		ctx.stroke()
		ctx.restore()
	}
	// paper and rubbish: pale scraps
	{
		const [ox, oy] = cell(3)
		for (let n = 0; n < 14; n++) {
			ctx.save()
			ctx.translate(ox + 40 + rng() * (size - 80), oy + 40 + rng() * (size - 80))
			ctx.rotate(rng() * Math.PI)
			const shade = 150 + Math.floor(rng() * 80)
			ctx.fillStyle = `rgba(${shade}, ${shade - 10}, ${shade - 30}, 0.8)`
			ctx.fillRect(-12, -8, 16 + rng() * 14, 10 + rng() * 10)
			ctx.restore()
		}
	}
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	return texture
}
