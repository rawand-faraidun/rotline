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

/** Light for each kind of place: sky and ground fill, the sun (colour, strength, height), fog. */
const LIGHTS = {
	dusk: { sky: 0xaeb0c0, ground: 0x2a2620, fill: 1.4, sun: 0xffc8a0, strength: 2.6, height: 22, fog: 0x15130f },
	overcast: { sky: 0xc4ccd2, ground: 0x2a3129, fill: 1.5, sun: 0xeef2f0, strength: 1.6, height: 34, fog: 0x0d100e },
	night: { sky: 0x6f80a8, ground: 0x111418, fill: 0.85, sun: 0xa8bce0, strength: 1.1, height: 30, fog: 0x07090c }
} as const

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
	detail = true
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
		this.renderer.setPixelRatio(pixelRatioFor(this.quality, 1.5))
		this.renderer.shadowMap.enabled = high
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping
		// a little brighter than neutral: the fight on the ground has to read, even at dusk
		this.renderer.toneMappingExposure = 1.35
		this.scene.background = new THREE.Color(light.fog)
		this.scene.fog = new THREE.Fog(light.fog, 50, 90)

		this.camera = new THREE.PerspectiveCamera(38, 1, 1, 200)
		this.camera.layers.enable(EFFECTS_LAYER)

		this.scene.add(new THREE.HemisphereLight(light.sky, light.ground, light.fill))
		this.sun = new THREE.DirectionalLight(light.sun, light.strength)
		this.sunHeight = light.height
		this.sun.castShadow = true
		this.sun.shadow.mapSize.set(2048, 2048)
		Object.assign(this.sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 })
		this.sun.shadow.bias = -0.0006
		this.scene.add(this.sun, this.sun.target)
		// a soft light from the camera's side, so the faces of walls toward the player read (no shadows)
		const face = new THREE.DirectionalLight(light.sky, light.fill * 0.9)
		face.position.set(0, 0.8, 1)
		this.scene.add(face)
		// a soft light carried with the player (a weapon light, glow of the screen in SAS-like games):
		// the soldier and what is close always read, whatever the hour
		this.playerLight = new THREE.PointLight(0xfff0dc, look.light === 'overcast' ? 14 : 28, 12, 1.4)
		this.scene.add(this.playerLight)

		// the plain ground shows at once; the real material replaces it when it has loaded
		const texture = groundTexture()
		const groundMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 })
		// 1k textures cover 4 m of ground each; the ground runs on past the map under the town round it
		const groundWidth = map.width + OUTSIDE * 2
		const groundDepth = map.height + OUTSIDE * 2
		const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundDepth)
		const uv = groundGeometry.getAttribute('uv') as THREE.BufferAttribute
		for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * groundWidth) / 4, (uv.getY(i) * groundDepth) / 4)
		dress(groundMaterial, `${assets}/textures/${look.ground}`, null, 0xdcdcd4, high)
		this.ground = new THREE.Mesh(groundGeometry, groundMaterial)
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.set(map.width / 2, 0, map.height / 2)
		this.ground.receiveShadow = true
		this.scene.add(this.ground)

		const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x5d665a, roughness: 0.85 })
		// the photos as they are (a tint multiplies in linear light: a grey one turns them near black)
		dress(wallMaterial, `${assets}/textures/${look.walls}`, null, 0xe8e8e2, high)
		// the tops of walls and blocks read as rooftops from above: dark gravel, not more brick
		const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3c38, roughness: 0.95 })
		dress(roofMaterial, `${assets}/textures/roof`, null, 0xc8c8c2, high)
		const walls = new THREE.Mesh(wallGeometry(map.walls, WALL_HEIGHT, 2), [wallMaterial, roofMaterial])
		walls.name = 'walls'
		walls.castShadow = walls.receiveShadow = true
		this.scene.add(walls)
		// the town beyond the border: buildings of a few heights, in the map's wall material and another
		const other = look.walls === 'brick' ? 'wall-concrete' : 'brick'
		const otherMaterial = new THREE.MeshStandardMaterial({ color: 0x5d665a, roughness: 0.85 })
		dress(otherMaterial, `${assets}/textures/${other}`, null, 0xe0e0da, high)
		const byHeight = new Map<number, Building[]>()
		for (const building of surroundings(map).buildings)
			byHeight.set(building.height, [...(byHeight.get(building.height) ?? []), building])
		for (const [height, group] of byHeight) {
			const mesh = new THREE.Mesh(wallGeometry(group, height, 2), [
				height > 8 ? otherMaterial : wallMaterial,
				roofMaterial
			])
			mesh.name = 'outside'
			mesh.castShadow = mesh.receiveShadow = high
			this.scene.add(mesh)
		}
		if (high) this.post = new PostProcessing(this.renderer, this.scene, this.camera)
		this.resize()
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

	render(): void {
		if (this.post) this.post.render(performance.now() / 1000)
		else this.renderer.render(this.scene, this.camera)
	}

	dispose(): void {
		this.post?.dispose()
		this.renderer.dispose()
	}
}
