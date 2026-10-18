import type { MapDef } from '@rotline/game-data'
import * as THREE from 'three'
import { PostProcessing } from './post.ts'
import { pixelRatioFor, probeQuality, type Quality } from './quality.ts'

/** Camera height and tilt: high and almost straight down, pulled back enough to see the horde coming. */
const CAMERA_HEIGHT = 27
const CAMERA_BACK = 7.5
/** How far the camera leans toward where the player aims, in metres. */
const AIM_LEAN = 3.5

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
	const quad = (corners: [number, number, number][], normal: [number, number, number], uv: [number, number][]) => {
		const base = positions.length / 3
		for (const [i, corner] of corners.entries()) {
			positions.push(...corner)
			normals.push(...normal)
			const [u, v] = uv[i] as [number, number]
			uvs.push(u / tile, v / tile)
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
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
			[
				[x1, 0],
				[x0, 0],
				[x0, h],
				[x1, h]
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
				[z1, 0],
				[z0, 0],
				[z0, h],
				[z1, h]
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
			]
		)
	}
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
	geometry.setIndex(indices)
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
		this.scene.background = new THREE.Color(light.fog)
		this.scene.fog = new THREE.Fog(light.fog, 50, 90)

		this.camera = new THREE.PerspectiveCamera(38, 1, 1, 200)

		this.scene.add(new THREE.HemisphereLight(light.sky, light.ground, light.fill))
		this.sun = new THREE.DirectionalLight(light.sun, light.strength)
		this.sunHeight = light.height
		this.sun.castShadow = true
		this.sun.shadow.mapSize.set(2048, 2048)
		Object.assign(this.sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 })
		this.sun.shadow.bias = -0.0006
		this.scene.add(this.sun, this.sun.target)

		// the plain ground shows at once; the real material replaces it when it has loaded
		const texture = groundTexture()
		const groundMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 })
		// 1k textures cover 4 m of ground each
		const groundGeometry = new THREE.PlaneGeometry(map.width, map.height)
		const uv = groundGeometry.getAttribute('uv') as THREE.BufferAttribute
		for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * map.width) / 4, (uv.getY(i) * map.height) / 4)
		dress(groundMaterial, `${assets}/textures/${look.ground}`, null, 0xdcdcd4, high)
		this.ground = new THREE.Mesh(groundGeometry, groundMaterial)
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.set(map.width / 2, 0, map.height / 2)
		this.ground.receiveShadow = true
		this.scene.add(this.ground)

		const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x5d665a, roughness: 0.85 })
		// walls a little darker than their photos: the eye should go to the fight on the ground
		dress(wallMaterial, `${assets}/textures/${look.walls}`, null, 0x8c8c86, high)
		const walls = new THREE.Mesh(wallGeometry(map.walls, 2.4, 2), wallMaterial)
		walls.castShadow = walls.receiveShadow = true
		this.scene.add(walls)
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

	/** Follows the player, leaning toward the aim point. */
	follow(x: number, y: number, aimX: number, aimY: number, dtSeconds: number): void {
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
		this.camera.position.set(this.cameraTarget.x + ox, CAMERA_HEIGHT, this.cameraTarget.z + CAMERA_BACK + oz)
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
