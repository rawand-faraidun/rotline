import type { MapDef } from '@rotline/game-data'
import * as THREE from 'three'
import { EFFECTS_LAYER, PostProcessing } from './post.ts'
import { pixelRatioFor, probeQuality, type Quality } from './quality.ts'
import { type Building, OUTSIDE, surroundings } from './surroundings.ts'

/**
 * Camera height and tilt: close over the soldier and almost straight down, so soldiers and zombies
 * read at a glance; leaning toward the aim shows the horde coming from that way.
 */
const CAMERA_HEIGHT = 19
/** walls stand this tall (metres): buildings and yard walls, not kerbs */
const WALL_HEIGHT = 3.2
/** clipped hedges: over a zombie's head, under the camera's line */
const HEDGE_HEIGHT = 1.9
/** a shipping container, a little over its real 2.6 m so it reads beside the walls */
const CONTAINER_HEIGHT = 2.9
/** faded container liveries: rust red, navy, green, orange, grey, teal */
const CONTAINER_COLOURS = [0x9a3b2a, 0x2c4a7a, 0x3d6b3a, 0xc0702a, 0x8a8f92, 0x2f7a78]
/** ground patches that need toning down (the photos are much paler than the rest of the ground) */
const PATCH_TINT: Partial<Record<string, number>> = { tiles: 0x9c9c96, paving: 0xc4c0b8, concrete: 0xc8c8c2 }
/** a container's length (a 20-foot box) and width in metres */
const CONTAINER_LENGTH = 6
const CONTAINER_WIDTH = 2

/**
 * A block of container cells as single containers: rows two metres wide along the block's longer
 * side, cut into six-metre boxes, each a hair smaller than its cells so the seams between show.
 */
function splitContainers(block: { x: number; y: number; w: number; h: number }) {
	const along = block.w >= block.h
	const length = along ? block.w : block.h
	const across = along ? block.h : block.w
	const boxes: { x: number; y: number; w: number; h: number }[] = []
	for (let a = 0; a < across; a += CONTAINER_WIDTH) {
		const width = Math.min(CONTAINER_WIDTH, across - a)
		const count = Math.max(1, Math.round(length / CONTAINER_LENGTH))
		for (let i = 0; i < count; i++) {
			const start = (length / count) * i
			const size = length / count
			const gap = 0.06
			boxes.push(
				along
					? { x: block.x + start + gap, y: block.y + a + gap, w: size - gap * 2, h: width - gap * 2 }
					: { x: block.x + a + gap, y: block.y + start + gap, w: width - gap * 2, h: size - gap * 2 }
			)
		}
	}
	return boxes
}

/** A tiling normal map of soft ripples, drawn once. */
function rippleTexture(): THREE.Texture {
	const size = 128
	const data = new Uint8Array(size * size * 4)
	const height = (x: number, y: number) =>
		Math.sin((x / size) * Math.PI * 2 * 3 + Math.sin((y / size) * Math.PI * 2 * 2) * 1.5) * 0.5 +
		Math.sin((y / size) * Math.PI * 2 * 5 + Math.cos((x / size) * Math.PI * 2 * 2)) * 0.35
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = height(x + 1, y) - height(x - 1, y)
			const dy = height(x, y + 1) - height(x, y - 1)
			const i = (y * size + x) * 4
			data[i] = Math.round((0.5 - dx * 0.5) * 255)
			data[i + 1] = Math.round((0.5 - dy * 0.5) * 255)
			data[i + 2] = 255
			data[i + 3] = 255
		}
	}
	const texture = new THREE.DataTexture(data, size, size)
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping
	texture.needsUpdate = true
	return texture
}

let ribs: THREE.Texture | null = null
/** Corrugated steel: light and dark ribs, multiplied by each container's paint. */
function ribTexture(): THREE.Texture {
	if (ribs) return ribs
	const canvas = document.createElement('canvas')
	canvas.width = 64
	canvas.height = 8
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	for (let x = 0; x < 64; x++) {
		const shade = 0.72 + 0.28 * Math.sin((x / 64) * Math.PI * 2 * 4) ** 2
		const v = Math.round(255 * shade)
		ctx.fillStyle = `rgb(${v},${v},${v})`
		ctx.fillRect(x, 0, 1, 8)
	}
	ribs = new THREE.CanvasTexture(canvas)
	ribs.wrapS = ribs.wrapT = THREE.RepeatWrapping
	ribs.colorSpace = THREE.SRGBColorSpace
	return ribs
}
const CAMERA_BACK = 6
/** How far the camera leans toward where the player aims, in metres. */
const AIM_LEAN = 3
/** How far the player may zoom: a little closer, or a little further out than the usual view. */
const ZOOM_MIN = 0.72
const ZOOM_MAX = 1.35
const ZOOM_KEY = 'rotline.zoom'

function loadZoom(): number {
	try {
		const value = Number(localStorage.getItem(ZOOM_KEY))
		if (value >= ZOOM_MIN && value <= ZOOM_MAX) return value
	} catch {
		// private window: the usual view
	}
	return 1
}

/**
 * The holes zombies climb out of, one at each spawn point: a dark, ragged pit in the ground with a
 * lip of broken earth around it.
 */
export function spawnHoles(points: readonly { x: number; y: number }[]): THREE.Object3D {
	const size = 128
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	let seed = 17
	const random = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0
		return seed / 4294967296
	}
	// the lip: broken ground, then the dark pit inside, both with ragged edges
	const ragged = (radius: number, colour: string) => {
		ctx.beginPath()
		for (let i = 0; i <= 28; i++) {
			const angle = (i / 28) * Math.PI * 2
			const r = radius * (0.82 + random() * 0.3)
			ctx.lineTo(size / 2 + Math.cos(angle) * r, size / 2 + Math.sin(angle) * r)
		}
		ctx.fillStyle = colour
		ctx.fill()
	}
	ragged(58, 'rgba(46, 38, 30, 0.85)')
	ragged(40, 'rgba(14, 11, 9, 1)')
	const glow = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, 34)
	glow.addColorStop(0, 'rgba(0,0,0,1)')
	glow.addColorStop(1, 'rgba(0,0,0,0)')
	ctx.fillStyle = glow
	ctx.fillRect(0, 0, size, size)
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	const holes = new THREE.InstancedMesh(
		new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2),
		new THREE.MeshStandardMaterial({
			map: texture,
			transparent: true,
			depthWrite: false,
			roughness: 1,
			polygonOffset: true,
			polygonOffsetFactor: -1
		}),
		Math.max(1, points.length)
	)
	const matrix = new THREE.Matrix4()
	const turn = new THREE.Quaternion()
	for (const [index, point] of points.entries()) {
		turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2)
		matrix.compose(new THREE.Vector3(point.x, 0.015, point.y), turn, new THREE.Vector3(1, 1, 1))
		holes.setMatrixAt(index, matrix)
	}
	holes.count = points.length
	holes.receiveShadow = true
	return holes
}

function groundTexture(): THREE.CanvasTexture {
	const size = 256
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	const image = ctx.createImageData(size, size)
	let seed = 7
	for (let i = 0; i < size * size; i++) {
		seed = (seed * 1664525 + 1013904223) >>> 0
		const v = 84 + (seed / 4294967296) * 28
		image.data.set([v, v * 1.02, v * 0.92, 255], i * 4)
	}
	ctx.putImageData(image, 0, 0)
	// faint 2 m grid lines, like worn paint on concrete
	ctx.strokeStyle = 'rgba(236,232,220,0.05)'
	ctx.lineWidth = 2
	ctx.strokeRect(0, 0, size, size)
	const texture = new THREE.CanvasTexture(canvas)
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping
	texture.colorSpace = THREE.SRGBColorSpace
	texture.anisotropy = 4
	return texture
}

/**
 * Light for each kind of place: sky and ground fill, the sun or moon (colour, strength, height), fog
 * colour and how near it starts, and whether lamps burn and weapon lights are on.
 */
const LIGHTS = {
	day: {
		sky: 0xd8e2ec,
		ground: 0x3a3a30,
		fill: 1.55,
		sun: 0xfff2dc,
		strength: 2.9,
		height: 40,
		fog: 0x1a1d1c,
		near: 55,
		dark: false
	},
	dawn: {
		sky: 0xd8b8c4,
		ground: 0x2e2622,
		fill: 1.35,
		sun: 0xffb48a,
		strength: 2.4,
		height: 16,
		fog: 0x1c1416,
		near: 45,
		dark: false
	},
	dusk: {
		sky: 0xaeb0c0,
		ground: 0x2a2620,
		fill: 1.4,
		sun: 0xffc8a0,
		strength: 2.6,
		height: 22,
		fog: 0x15130f,
		near: 50,
		dark: false
	},
	overcast: {
		sky: 0xc4ccd2,
		ground: 0x2a3129,
		fill: 1.5,
		sun: 0xeef2f0,
		strength: 1.6,
		height: 34,
		fog: 0x0d100e,
		near: 50,
		dark: false
	},
	fog: {
		sky: 0xb4bcc0,
		ground: 0x2c302e,
		fill: 1.45,
		sun: 0xdde4e6,
		strength: 1.2,
		height: 34,
		fog: 0x4a5052,
		near: 14,
		dark: false
	},
	// a moonlit night: dim but readable, the lamps and the weapon lights do the rest
	night: {
		sky: 0x7a8cb6,
		ground: 0x1b2028,
		fill: 1.15,
		sun: 0xb4c6ea,
		strength: 1.45,
		height: 30,
		fog: 0x07090c,
		near: 45,
		dark: true
	},
	// no moon, the power out: only lamps, fires and torches
	dark: {
		sky: 0x4a5878,
		ground: 0x0e1116,
		fill: 0.72,
		sun: 0x8898b8,
		strength: 0.6,
		height: 30,
		fog: 0x030405,
		near: 30,
		dark: true
	}
} as const
/** weapon lights: one per player, the nearest teammates first */
const FLASHLIGHTS = 4

/** A box's five visible faces with texture coordinates in metres (so textures never stretch), merged. */
function wallGeometry(walls: readonly { x: number; y: number; w: number; h: number }[], height: number, tile: number) {
	const positions: number[] = []
	const normals: number[] = []
	const uvs: number[] = []
	const indices: number[] = []
	const tops: number[] = []
	const quad = (
		corners: [number, number, number][],
		normal: [number, number, number],
		uv: [number, number][],
		into: number[] = indices
	) => {
		const base = positions.length / 3
		for (const [i, corner] of corners.entries()) {
			positions.push(...corner)
			normals.push(...normal)
			const [u, v] = uv[i] as [number, number]
			uvs.push(u / tile, v / tile)
		}
		into.push(base, base + 1, base + 2, base, base + 2, base + 3)
	}
	for (const wall of walls) {
		const [x0, x1, z0, z1] = [wall.x, wall.x + wall.w, wall.y, wall.y + wall.h]
		const h = height
		// sides: u runs along the wall, v up it
		quad(
			[
				[x0, 0, z1],
				[x1, 0, z1],
				[x1, h, z1],
				[x0, h, z1]
			],
			[0, 0, 1],
			[
				[x0, 0],
				[x1, 0],
				[x1, h],
				[x0, h]
			]
		)
		quad(
			[
				[x1, 0, z0],
				[x0, 0, z0],
				[x0, h, z0],
				[x1, h, z0]
			],
			[0, 0, -1],
			// u runs left to right as seen from outside the face, or the normal map turns inward
			[
				[-x1, 0],
				[-x0, 0],
				[-x0, h],
				[-x1, h]
			]
		)
		quad(
			[
				[x1, 0, z1],
				[x1, 0, z0],
				[x1, h, z0],
				[x1, h, z1]
			],
			[1, 0, 0],
			[
				[-z1, 0],
				[-z0, 0],
				[-z0, h],
				[-z1, h]
			]
		)
		quad(
			[
				[x0, 0, z0],
				[x0, 0, z1],
				[x0, h, z1],
				[x0, h, z0]
			],
			[-1, 0, 0],
			[
				[z0, 0],
				[z1, 0],
				[z1, h],
				[z0, h]
			]
		)
		quad(
			[
				[x0, h, z1],
				[x1, h, z1],
				[x1, h, z0],
				[x0, h, z0]
			],
			[0, 1, 0],
			[
				[x0, z1],
				[x1, z1],
				[x1, z0],
				[x0, z0]
			],
			tops
		)
	}
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
	// two groups: the sides (material 0) and the roofs (material 1)
	geometry.setIndex([...indices, ...tops])
	geometry.addGroup(0, indices.length, 0)
	geometry.addGroup(indices.length, tops.length, 1)
	return geometry
}

/** Loads a material's colour, normal and roughness maps into `material` as they arrive. */
function dress(
	material: THREE.MeshStandardMaterial,
	base: string,
	repeat: number | null,
	tint = 0xffffff,
	detail = true,
	/** ground: never glossy (the photos' roughness maps make lawns and tarmac shine under lamps) */
	matte = false
): void {
	const loader = new THREE.TextureLoader()
	const load = (name: string, apply: (texture: THREE.Texture) => void, colour = false) =>
		loader.load(
			`${base}/${name}.webp`,
			texture => {
				texture.wrapS = texture.wrapT = THREE.RepeatWrapping
				if (repeat !== null) texture.repeat.set(repeat, repeat)
				texture.anisotropy = 8
				if (colour) texture.colorSpace = THREE.SRGBColorSpace
				apply(texture)
				material.needsUpdate = true
			},
			undefined,
			() => {
				// missing textures leave the plain material
			}
		)
	load(
		'color',
		texture => {
			material.map = texture
			material.color.set(tint)
		},
		true
	)
	if (!detail) return
	load('normal', texture => {
		material.normalMap = texture
	})
	if (matte) return
	load('rough', texture => {
		material.roughnessMap = texture
		material.roughness = 1
	})
}

export class Stage {
	readonly renderer: THREE.WebGLRenderer
	readonly scene = new THREE.Scene()
	readonly camera: THREE.PerspectiveCamera
	readonly ground: THREE.Mesh
	/** the walls' sides and tops, shared with the weak walls so a cracked one matches the rest */
	readonly wallMaterials: [THREE.Material, THREE.Material]
	/** what this device can draw: `low` skips shadows, texture detail and prop models */
	readonly quality: Quality
	private readonly sun: THREE.DirectionalLight
	private readonly sunHeight: number
	private readonly cameraTarget = new THREE.Vector3()
	/** recoil: the camera knocked back along the shot, easing home */
	private readonly kickOffset = new THREE.Vector2()
	/** shake from explosions and hits, 0..1, decaying */
	private trauma = 0
	private readonly reducedMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
	private readonly canvas: HTMLCanvasElement
	private post: PostProcessing | null = null
	private readonly playerLight: THREE.PointLight
	/** night and dark maps: lamps burn and every soldier carries a weapon light */
	readonly dark: boolean
	private readonly flashlights: THREE.SpotLight[] = []
	/** the pixel ratio the quality calls for, and the share of it drawn now (lowered when frames run slow) */
	private basePixelRatio = 1
	private resolution = 1
	/** frames counted since the last look at the frame rate, and when that was */
	private frames = 0
	private framesSince = 0
	private slowChecks = 0
	private fastChecks = 0
	private loweredAt = 0
	/** the zoom the player chose (1 the usual view, smaller closer) and the one shown, easing toward it */
	private zoom = loadZoom()
	private shownZoom = this.zoom

	constructor(canvas: HTMLCanvasElement, map: MapDef, assets = '/assets') {
		const look = map.look ?? { ground: 'concrete', walls: 'wall-concrete', light: 'overcast' }
		const light = LIGHTS[look.light]
		this.canvas = canvas
		this.quality = probeQuality()
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: this.quality === 'high',
			powerPreference: 'high-performance'
		})
		const high = this.quality === 'high'
		// textures with their detail maps, models and shadows everywhere but on a software renderer
		const detailed = this.quality !== 'low'
		this.basePixelRatio = pixelRatioFor(this.quality, 1.5)
		this.renderer.setPixelRatio(this.basePixelRatio)
		this.renderer.shadowMap.enabled = detailed
		// soft shadows on a graphics card; plain ones on built-in graphics
		this.renderer.shadowMap.type = high ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping
		// a little brighter than neutral: the fight on the ground has to read, even at dusk
		this.renderer.toneMappingExposure = 1.35
		this.scene.background = new THREE.Color(light.fog)
		this.scene.fog = new THREE.Fog(light.fog, light.near, light.near + 40)
		this.dark = light.dark

		this.camera = new THREE.PerspectiveCamera(38, 1, 1, 200)
		this.camera.layers.enable(EFFECTS_LAYER)

		this.scene.add(new THREE.HemisphereLight(light.sky, light.ground, light.fill))
		this.sun = new THREE.DirectionalLight(light.sun, light.strength)
		this.sunHeight = light.height
		this.sun.castShadow = true
		this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024)
		Object.assign(this.sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 })
		this.sun.shadow.bias = -0.0006
		this.scene.add(this.sun, this.sun.target)
		// a soft light from the camera's side, so the faces of walls toward the player read (no shadows)
		const face = new THREE.DirectionalLight(light.sky, light.fill * 0.9)
		face.position.set(0, 0.8, 1)
		this.scene.add(face)
		// a soft light carried with the player (a weapon light, glow of the screen in SAS-like games):
		// the soldier and what is close always read, whatever the hour
		// in the dark the glow is faint (the weapon light shows the way); by day it only lifts the soldier
		this.playerLight = new THREE.PointLight(
			0xfff0dc,
			light.dark ? 4 : look.light === 'overcast' || look.light === 'day' || look.light === 'fog' ? 12 : 22,
			light.dark ? 5 : 12,
			1.4
		)
		this.scene.add(this.playerLight)
		// weapon lights: a cone from each soldier's gun along the aim (yours casts shadows on a graphics card)
		if (light.dark) {
			const count = this.quality === 'low' ? 1 : FLASHLIGHTS
			for (let i = 0; i < count; i++) {
				const torch = new THREE.SpotLight(0xfff4e0, i === 0 ? 90 : 60, i === 0 ? 24 : 18, 0.36, 0.45, 1.2)
				torch.castShadow = i === 0 && high
				torch.shadow.mapSize.set(512, 512)
				torch.shadow.bias = -0.002
				torch.visible = false
				this.scene.add(torch, torch.target)
				this.flashlights.push(torch)
			}
		}

		// the plain ground shows at once; the real material replaces it when it has loaded
		const texture = groundTexture()
		const groundMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 })
		// 1k textures cover 4 m of ground each; the ground runs on past the map under the town round it
		const groundWidth = map.width + OUTSIDE * 2
		const groundDepth = map.height + OUTSIDE * 2
		const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundDepth)
		const uv = groundGeometry.getAttribute('uv') as THREE.BufferAttribute
		for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * groundWidth) / 4, (uv.getY(i) * groundDepth) / 4)
		dress(groundMaterial, `${assets}/textures/${look.ground}`, null, 0xdcdcd4, detailed, true)
		this.ground = new THREE.Mesh(groundGeometry, groundMaterial)
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.set(map.width / 2, 0, map.height / 2)
		this.ground.receiveShadow = true
		// drawn before the patches of other ground laid over it
		this.ground.renderOrder = -30
		this.scene.add(this.ground)

		const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x5d665a, roughness: 0.85 })
		// the photos as they are (a tint multiplies in linear light: a grey one turns them near black)
		dress(wallMaterial, `${assets}/textures/${look.walls}`, null, 0xe8e8e2, detailed)
		// the tops of walls and blocks read as rooftops from above: dark gravel, not more brick
		const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3c38, roughness: 0.95 })
		dress(roofMaterial, `${assets}/textures/roof`, null, 0xc8c8c2, detailed)
		this.wallMaterials = [wallMaterial, roofMaterial]
		const walls = new THREE.Mesh(wallGeometry(map.walls, WALL_HEIGHT, 2), [wallMaterial, roofMaterial])
		walls.name = 'walls'
		walls.castShadow = walls.receiveShadow = true
		this.scene.add(walls)
		this.addSolids(map, assets, detailed)
		this.addPatches(map, assets, detailed)
		this.addWater(map)
		this.addFences(map)
		// the town beyond the border: buildings of a few heights, in the map's wall material and another
		const other = look.walls === 'brick' ? 'wall-concrete' : 'brick'
		const otherMaterial = new THREE.MeshStandardMaterial({ color: 0x5d665a, roughness: 0.85 })
		dress(otherMaterial, `${assets}/textures/${other}`, null, 0xe0e0da, detailed)
		const byHeight = new Map<number, Building[]>()
		for (const building of surroundings(map).buildings)
			byHeight.set(building.height, [...(byHeight.get(building.height) ?? []), building])
		for (const [height, group] of byHeight) {
			const mesh = new THREE.Mesh(wallGeometry(group, height, 2), [
				height > 8 ? otherMaterial : wallMaterial,
				roofMaterial
			])
			mesh.name = 'outside'
			mesh.castShadow = mesh.receiveShadow = detailed
			this.scene.add(mesh)
		}
		if (high) this.post = new PostProcessing(this.renderer, this.scene, this.camera)
		this.resize()
	}

	/**
	 * Hedges (low, leafy, clipped flat on top) and shipping containers (ribbed steel in a few faded
	 * liveries, picked by where each stands so every client paints them alike).
	 */
	private addSolids(map: MapDef, assets: string, detailed: boolean): void {
		const solids = map.solids ?? []
		if (solids.length === 0) return
		const hedges = solids.filter(solid => solid.kind === 'hedge')
		if (hedges.length > 0) {
			const leaves = new THREE.MeshStandardMaterial({ color: 0x3f5a2c, roughness: 1 })
			dress(leaves, `${assets}/textures/grass`, null, 0x5d7a3e, detailed)
			const top = new THREE.MeshStandardMaterial({ color: 0x4a6a32, roughness: 1 })
			dress(top, `${assets}/textures/grass`, null, 0x6e8c48, detailed)
			const mesh = new THREE.Mesh(wallGeometry(hedges, HEDGE_HEIGHT, 1), [leaves, top])
			mesh.name = 'hedges'
			mesh.castShadow = mesh.receiveShadow = true
			this.scene.add(mesh)
		}
		const containers = solids.filter(solid => solid.kind === 'container').flatMap(splitContainers)
		if (containers.length === 0) return
		const ribs = ribTexture()
		for (const [index, colour] of CONTAINER_COLOURS.entries()) {
			const group = containers.filter(
				box => Math.abs(Math.round(box.x * 7 + box.y * 13 + box.w * 3)) % CONTAINER_COLOURS.length === index
			)
			if (group.length === 0) continue
			const paint = new THREE.MeshStandardMaterial({ color: colour, map: ribs, roughness: 0.6, metalness: 0.15 })
			const roof = new THREE.MeshStandardMaterial({
				color: new THREE.Color(colour).multiplyScalar(0.8),
				map: ribs,
				roughness: 0.7,
				metalness: 0.1
			})
			const mesh = new THREE.Mesh(wallGeometry(group, CONTAINER_HEIGHT, 1), [paint, roof])
			mesh.name = 'containers'
			mesh.castShadow = mesh.receiveShadow = true
			this.scene.add(mesh)
		}
	}

	/** Lawns, gravel and the like laid over the ground, a hair above it, one mesh per kind of ground. */
	private addPatches(map: MapDef, assets: string, detailed: boolean): void {
		const patches = map.patches ?? []
		// a patch lies over the ones listed before it that it overlaps: a tiled floor on a lawn on the ground
		const layer = patches.map(() => 1)
		for (const [i, patch] of patches.entries()) {
			for (let j = 0; j < i; j++) {
				const other = patches[j] as (typeof patches)[number]
				if (
					patch.x < other.x + other.w &&
					other.x < patch.x + patch.w &&
					patch.y < other.y + other.h &&
					other.y < patch.y + patch.h
				)
					layer[i] = Math.max(layer[i] as number, (layer[j] as number) + 1)
			}
		}
		// Patches lie flat on the ground and write no depth: the order they are drawn in decides which
		// shows (the ground first, then each layer), so nothing on them (blood, marks) fights them for depth.
		const materials = new Map<string, THREE.MeshStandardMaterial>()
		const groups = new Map<string, number[]>()
		for (const [i, patch] of patches.entries()) {
			const key = `${patch.ground}:${Math.min(8, layer[i] as number)}`
			groups.set(key, [...(groups.get(key) ?? []), i])
		}
		for (const [key, members] of groups) {
			const [ground = 'grass', level = '1'] = key.split(':')
			const positions: number[] = []
			const uvs: number[] = []
			const indices: number[] = []
			for (const i of members) {
				const patch = patches[i] as (typeof patches)[number]
				const base = positions.length / 3
				const [x0, x1, z0, z1] = [patch.x, patch.x + patch.w, patch.y, patch.y + patch.h]
				positions.push(x0, 0.002, z0, x1, 0.002, z0, x1, 0.002, z1, x0, 0.002, z1)
				// the same 4 m tiling as the ground, anchored to the map so neighbouring patches meet
				uvs.push(x0 / 4, -z0 / 4, x1 / 4, -z0 / 4, x1 / 4, -z1 / 4, x0 / 4, -z1 / 4)
				indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
			}
			const geometry = new THREE.BufferGeometry()
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
			geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
			geometry.setAttribute(
				'normal',
				new THREE.Float32BufferAttribute(
					positions.map((_, i) => (i % 3 === 1 ? 1 : 0)),
					3
				)
			)
			geometry.setIndex(indices)
			let material = materials.get(ground)
			if (!material) {
				material = new THREE.MeshStandardMaterial({
					roughness: 0.95,
					depthWrite: false,
					polygonOffset: true,
					polygonOffsetFactor: -2,
					polygonOffsetUnits: -2
				})
				// pale floors (tiles, paving) toned down to sit with the rest of the ground
				dress(material, `${assets}/textures/${ground}`, null, PATCH_TINT[ground] ?? 0xdcdcd4, detailed, true)
				materials.set(ground, material)
			}
			const mesh = new THREE.Mesh(geometry, material)
			mesh.receiveShadow = true
			mesh.renderOrder = -20 + Number(level)
			mesh.name = `patches-${key}`
			this.scene.add(mesh)
		}
	}

	/**
	 * Chain-link fences: steel posts every two and a half metres, a top rail, and wire mesh between
	 * (a see-through texture) along the middle of each run of fence cells.
	 */
	private addFences(map: MapDef): void {
		const runs = map.fences ?? []
		if (runs.length === 0) return
		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = 64
		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
		ctx.strokeStyle = 'rgba(150,156,160,1)'
		ctx.lineWidth = 4
		for (let k = -64; k < 128; k += 16) {
			ctx.beginPath()
			ctx.moveTo(k, 0)
			ctx.lineTo(k + 64, 64)
			ctx.moveTo(k + 64, 0)
			ctx.lineTo(k, 64)
			ctx.stroke()
		}
		const wire = new THREE.CanvasTexture(canvas)
		wire.wrapS = wire.wrapT = THREE.RepeatWrapping
		wire.colorSpace = THREE.SRGBColorSpace
		const mesh = new THREE.MeshStandardMaterial({
			map: wire,
			transparent: true,
			alphaTest: 0.3,
			side: THREE.DoubleSide,
			roughness: 0.6,
			metalness: 0.3
		})
		const steel = new THREE.MeshStandardMaterial({ color: 0x6a6e70, roughness: 0.5, metalness: 0.4 })
		const height = 2.2
		const posts: THREE.Matrix4[] = []
		const rails: THREE.Matrix4[] = []
		const panels = new THREE.Group()
		for (const run of runs) {
			const along = run.w >= run.h
			const length = along ? run.w : run.h
			const cx = run.x + run.w / 2
			const cz = run.y + run.h / 2
			const panel = new THREE.Mesh(new THREE.PlaneGeometry(length, height), mesh)
			const uv = panel.geometry.getAttribute('uv') as THREE.BufferAttribute
			for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * length) / 0.5, (uv.getY(i) * height) / 0.5)
			panel.position.set(cx, height / 2, cz)
			if (!along) panel.rotation.y = Math.PI / 2
			panel.castShadow = true
			panels.add(panel)
			rails.push(
				new THREE.Matrix4().compose(
					new THREE.Vector3(cx, height, cz),
					new THREE.Quaternion(),
					new THREE.Vector3(along ? length : 0.06, 0.06, along ? 0.06 : length)
				)
			)
			const count = Math.max(1, Math.round(length / 2.5))
			for (let k = 0; k <= count; k++) {
				const t = (k / count) * length
				posts.push(new THREE.Matrix4().makeTranslation(along ? run.x + t : cx, height / 2, along ? cz : run.y + t))
			}
		}
		const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, height, 6), steel, posts.length)
		for (const [i, matrix] of posts.entries()) postMesh.setMatrixAt(i, matrix)
		const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, rails.length)
		for (const [i, matrix] of rails.entries()) railMesh.setMatrixAt(i, matrix)
		postMesh.castShadow = railMesh.castShadow = true
		panels.name = 'fences'
		this.scene.add(panels, postMesh, railMesh)
	}

	/** the water's ripples, moved on every frame */
	private waterNormals: THREE.Texture | null = null

	/**
	 * Water: dark, still and glossy, catching the lights, with ripples drifting across it and a stone
	 * edge where it meets the ground. Drawing only; the grid keeps people out of it.
	 */
	private addWater(map: MapDef): void {
		const pools = map.water ?? []
		if (pools.length === 0) return
		const normals = rippleTexture()
		this.waterNormals = normals
		const surface = new THREE.MeshStandardMaterial({
			color: 0x2e4a4c,
			emissive: 0x0b1718,
			roughness: 0.16,
			metalness: 0,
			normalMap: normals,
			normalScale: new THREE.Vector2(0.7, 0.7)
		})
		const kerb = new THREE.MeshStandardMaterial({ color: 0x6d6a62, roughness: 0.9 })
		for (const pool of pools) {
			const water = new THREE.Mesh(new THREE.PlaneGeometry(pool.w, pool.h), surface)
			water.rotation.x = -Math.PI / 2
			water.position.set(pool.x + pool.w / 2, 0.03, pool.y + pool.h / 2)
			const uv = water.geometry.getAttribute('uv') as THREE.BufferAttribute
			for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * pool.w) / 6, (uv.getY(i) * pool.h) / 6)
			water.receiveShadow = true
			water.name = 'water'
			this.scene.add(water)
		}
		// a low kerb round the outline (only where water meets dry cells, so a canal of pieces looks like one)
		const wet = new Set<number>()
		for (const pool of pools)
			for (let y = pool.y; y < pool.y + pool.h; y++)
				for (let x = pool.x; x < pool.x + pool.w; x++) wet.add(y * map.width + x)
		const edges: { x: number; y: number; w: number; h: number }[] = []
		for (const cell of wet) {
			const x = cell % map.width
			const y = Math.floor(cell / map.width)
			if (y > 0 && !wet.has(cell - map.width)) edges.push({ x, y, w: 1, h: 0.15 })
			if (y < map.height - 1 && !wet.has(cell + map.width)) edges.push({ x, y: y + 0.85, w: 1, h: 0.15 })
			if (x > 0 && !wet.has(cell - 1)) edges.push({ x, y, w: 0.15, h: 1 })
			if (x < map.width - 1 && !wet.has(cell + 1)) edges.push({ x: x + 0.85, y, w: 0.15, h: 1 })
		}
		if (edges.length > 0) {
			const mesh = new THREE.Mesh(wallGeometry(edges, 0.18, 1), [kerb, kerb])
			mesh.receiveShadow = true
			mesh.name = 'water-kerb'
			this.scene.add(mesh)
		}
	}

	resize(): void {
		const width = this.canvas.clientWidth || window.innerWidth
		const height = this.canvas.clientHeight || window.innerHeight
		this.renderer.setSize(width, height, false)
		this.post?.setSize(width, height, this.renderer.getPixelRatio())
		this.camera.aspect = width / height
		this.camera.updateProjectionMatrix()
	}

	/** A shot knocks the camera back a little against the aim (`amount` metres). */
	kick(dirX: number, dirY: number, amount: number): void {
		if (this.reducedMotion) return
		this.kickOffset.x -= dirX * amount
		this.kickOffset.y -= dirY * amount
		// it never piles up into a slide
		const length = this.kickOffset.length()
		if (length > 0.8) this.kickOffset.multiplyScalar(0.8 / length)
	}

	/** Shake, 0..1 (explosions nearby, a heavy hit). */
	shake(amount: number): void {
		if (this.reducedMotion) return
		this.trauma = Math.min(1, this.trauma + amount)
	}

	/** Zooms by a mouse-wheel step: a notch is a few percent in or out, within limits. */
	zoomBy(deltaY: number): void {
		const step = Math.max(-1, Math.min(1, deltaY / 100))
		this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * (1 + step * 0.06)))
		try {
			localStorage.setItem(ZOOM_KEY, this.zoom.toFixed(3))
		} catch {
			// not kept: it still applies now
		}
	}

	/**
	 * Points the weapon lights: one per soldier (yours first), from the gun along the aim. Teammates
	 * beyond the available lights go without.
	 */
	setFlashlights(soldiers: readonly { x: number; y: number; angle: number; on: boolean }[]): void {
		for (const [i, torch] of this.flashlights.entries()) {
			const soldier = soldiers[i]
			torch.visible = soldier?.on === true
			if (!soldier?.on) continue
			const dx = Math.cos(soldier.angle)
			const dy = Math.sin(soldier.angle)
			torch.position.set(soldier.x + dx * 0.45, 1.35, soldier.y + dy * 0.45)
			torch.target.position.set(soldier.x + dx * 12, 0, soldier.y + dy * 12)
		}
	}

	/** Follows the player, leaning toward the aim point. */
	follow(x: number, y: number, aimX: number, aimY: number, dtSeconds: number): void {
		this.playerLight.position.set(x, 3.2, y)
		const lean = Math.min(1, Math.hypot(aimX - x, aimY - y) / 12)
		const angle = Math.atan2(aimY - y, aimX - x)
		const tx = x + Math.cos(angle) * AIM_LEAN * lean
		const ty = y + Math.sin(angle) * AIM_LEAN * lean
		const k = 1 - Math.exp(-8 * dtSeconds)
		this.cameraTarget.x += (tx - this.cameraTarget.x) * k
		this.cameraTarget.z += (ty - this.cameraTarget.z) * k
		if (this.cameraTarget.lengthSq() === 0) this.cameraTarget.set(tx, 0, ty)
		// recoil and shake sit on top of the follow, so they never move the aim point
		this.kickOffset.multiplyScalar(Math.exp(-14 * dtSeconds))
		this.trauma = Math.max(0, this.trauma - dtSeconds * 1.6)
		const shake = this.trauma * this.trauma * 0.9
		const ox = this.kickOffset.x + (Math.random() - 0.5) * shake
		const oz = this.kickOffset.y + (Math.random() - 0.5) * shake
		this.shownZoom += (this.zoom - this.shownZoom) * (1 - Math.exp(-10 * dtSeconds))
		this.camera.position.set(
			this.cameraTarget.x + ox,
			CAMERA_HEIGHT * this.shownZoom,
			this.cameraTarget.z + CAMERA_BACK * this.shownZoom + oz
		)
		this.camera.lookAt(this.cameraTarget.x + ox, 0, this.cameraTarget.z + oz)
		this.sun.position.set(this.cameraTarget.x + 14, this.sunHeight, this.cameraTarget.z + 8)
		this.sun.target.position.set(this.cameraTarget.x, 0, this.cameraTarget.z)
	}

	/**
	 * Keeps the frame rate up on a device that cannot hold it: every two seconds, below 50 frames a
	 * second the picture is drawn at fewer pixels (down to 60 %), and ambient occlusion goes first on a
	 * graphics card that struggles; with time to spare, pixels come back. Call once per frame.
	 */
	adapt(now: number): void {
		this.frames++
		if (this.framesSince === 0) this.framesSince = now
		const elapsed = now - this.framesSince
		if (elapsed < 2000) return
		const fps = (this.frames * 1000) / elapsed
		this.frames = 0
		this.framesSince = now
		// a tab in the background or a paused game is not a slow device
		if (document.hidden || elapsed > 4000) return
		if (fps < 50) {
			this.slowChecks++
			this.fastChecks = 0
			// two slow looks in a row before anything changes: one hitch is not a slow device
			if (this.slowChecks < 2) return
			this.loweredAt = now
			if (this.post?.occlusion) this.post.occlusion = false
			else if (this.resolution > 0.6) this.setResolution(Math.max(0.6, this.resolution * 0.85))
		} else if (fps > 58) {
			this.slowChecks = 0
			this.fastChecks++
			// pixels come back slowly (a resize costs a frame): after 20 s at the lower setting and three
			// fast looks in a row, so the picture never pumps up and down
			if (this.resolution < 1 && this.fastChecks >= 3 && now - this.loweredAt > 20_000) {
				this.fastChecks = 0
				this.setResolution(Math.min(1, this.resolution * 1.1))
			}
		} else {
			this.slowChecks = 0
			this.fastChecks = 0
		}
	}

	private setResolution(resolution: number): void {
		this.resolution = resolution
		this.renderer.setPixelRatio(this.basePixelRatio * resolution)
		this.resize()
	}

	/**
	 * Compiles every material in the scene now, hidden ones included (the first explosion, flame or
	 * corpse would otherwise stall a frame while its shader compiles). Call when models have loaded.
	 */
	warmUp(): void {
		const hidden: THREE.Object3D[] = []
		this.scene.traverse(object => {
			if (!object.visible) {
				hidden.push(object)
				object.visible = true
			}
		})
		try {
			this.renderer.compile(this.scene, this.camera)
		} finally {
			for (const object of hidden) object.visible = false
		}
	}

	render(): void {
		if (this.waterNormals) this.waterNormals.offset.set(performance.now() * 0.000012, performance.now() * 0.000007)
		if (this.post) this.post.render(performance.now() / 1000)
		else this.renderer.render(this.scene, this.camera)
	}

	dispose(): void {
		this.post?.dispose()
		this.renderer.dispose()
	}
}
