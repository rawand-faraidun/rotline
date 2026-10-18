import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PlayerFigure } from './render/players.ts'
import { PostProcessing } from './render/post.ts'
import { pixelRatioFor, probeQuality } from './render/quality.ts'

export type LobbyMember = {
	/** the player's slot colour (1-4) */
	slot: number
	classId: string
	weaponId: string
	pistol: boolean
	you: boolean
	/** armour item ids worn on head, torso, vest, legs, feet (omitted: the class's usual kit) */
	armour?: (string | null)[]
}

export type LobbyHandle = {
	setSquad(members: readonly LobbyMember[]): void
	dispose(): void
}

/** Where squad members stand: you in front, the others fanned out behind. */
const SPOTS: readonly [number, number][] = [
	[0, 0],
	[-1.7, -0.9],
	[1.7, -0.9],
	[-3.3, -1.9]
]

/**
 * The lobby's backdrop: the squad standing ready in a floodlit yard at night, among crates, sandbags
 * and barrels, the camera breathing slowly. The menus are laid over it by the page.
 */
export function mountLobby(canvas: HTMLCanvasElement, assets = '/assets'): LobbyHandle {
	const quality = probeQuality()
	const high = quality === 'high'
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance' })
	renderer.setPixelRatio(pixelRatioFor(quality, 1.5))
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.05
	renderer.shadowMap.enabled = high
	renderer.shadowMap.type = THREE.PCFShadowMap
	const scene = new THREE.Scene()
	scene.background = new THREE.Color(0x06080a)
	scene.fog = new THREE.FogExp2(0x0a0d10, 0.055)
	// a faint studio reflection, so metal, wet ground and gear catch something
	const environment = new THREE.PMREMGenerator(renderer)
	scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture
	scene.environmentIntensity = 0.18
	const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80)

	// night air, a work light from the front right, a cold rim from behind
	scene.add(new THREE.HemisphereLight(0x6f7f94, 0x15130f, 0.9))
	const flood = new THREE.SpotLight(0xffe2b8, 120, 30, Math.PI / 5, 0.5, 1.6)
	flood.position.set(4.5, 7, 6)
	flood.target.position.set(0, 0.8, -0.6)
	flood.castShadow = high
	flood.shadow.mapSize.set(1024, 1024)
	flood.shadow.bias = -0.0005
	scene.add(flood, flood.target)
	const rim = new THREE.DirectionalLight(0x9fc2e8, 1.6)
	rim.position.set(-4, 5, -6)
	scene.add(rim)
	const warm = new THREE.PointLight(0xff8a3a, 6, 7, 1.8)
	warm.position.set(-3.6, 0.6, -2.6)
	scene.add(warm)

	// the ground, a wall and a container behind the squad
	const textures = new THREE.TextureLoader()
	const material = (name: string, repeat: number, tint: number) => {
		const paint = new THREE.MeshStandardMaterial({ color: 0x3a3d38, roughness: 0.95 })
		const maps = high ? (['color', 'normal', 'rough'] as const) : (['color'] as const)
		for (const map of maps)
			textures.load(`${assets}/textures/${name}/${map}.webp`, texture => {
				texture.wrapS = texture.wrapT = THREE.RepeatWrapping
				texture.repeat.set(repeat, repeat)
				if (map === 'color') {
					texture.colorSpace = THREE.SRGBColorSpace
					paint.map = texture
					paint.color.set(tint)
				} else if (map === 'normal') paint.normalMap = texture
				else {
					paint.roughnessMap = texture
					paint.roughness = paint.roughness < 0.9 ? paint.roughness : 1
				}
				paint.needsUpdate = true
			})
		return paint
	}
	const groundPaint = material('asphalt', 15, 0x9a9a94)
	// rain-wet: the lamp and the floodlight shine in it
	groundPaint.roughness = 0.55
	groundPaint.metalness = 0.15
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundPaint)
	ground.rotation.x = -Math.PI / 2
	ground.receiveShadow = true
	scene.add(ground)
	const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 0.4), material('brick', 3, 0x8a8a84))
	wall.position.set(-2, 1.6, -5.5)
	wall.receiveShadow = true
	const container = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), material('metal', 2, 0x7a8a7c))
	container.position.set(5.2, 1.3, -4.6)
	container.rotation.y = -0.35
	container.castShadow = container.receiveShadow = true
	scene.add(wall, container)

	// props from the game's own models, fitted to their 1 m cube
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
	const place = (kind: string, x: number, z: number, size: [number, number, number] = [1, 1, 1], turn = 0) =>
		loader.load(`${assets}/models/props/${kind}.glb`, gltf => {
			const model = gltf.scene
			model.scale.set(...size)
			model.position.set(x, 0, z)
			model.rotation.y = turn
			model.traverse(node => {
				if ((node as THREE.Mesh).isMesh) node.castShadow = node.receiveShadow = high
			})
			scene.add(model)
		})
	place('crate', -3.4, -3.6, [1.1, 1, 1.1], 0.3)
	place('crate', -3.2, -3.5, [0.8, 0.75, 0.8], -0.4)
	place('crate', 3.6, -2.4, [1.2, 1, 1.2], -0.5)
	place('crate', 4.4, -2.0, [0.8, 0.8, 0.8], 0.4)
	place('barrel', -4.6, -2.6, [0.75, 1.05, 0.75])
	place('barrel', -5.2, -3.4, [0.75, 1.05, 0.75], 1)
	place('defend', 2.4, -4.4, [1.4, 1, 1], 0.2)
	place('generator', -1.4, -4.6, [1.2, 0.85, 0.8], 0.1)
	// the yard around them (real sizes)
	place('scene-car', 6.8, -1.2, [1, 1, 1], -1.2)
	place('scene-barrier', -6.5, -1.2, [1, 1, 1], 0.4)
	place('scene-barrier', -4.2, 1.6, [1, 1, 1], 1.3)
	place('scene-tyre', 3.1, 0.9, [1, 1, 1], 0.4)
	place('scene-tyre', -2.6, 1.2, [1, 1, 1], 1.1)
	place('scene-trash', -5.4, -4.4, [1, 1, 1], 0.2)
	place('scene-trash', 0.8, -5, [1, 1, 1], 2.4)
	place('scene-bin', -0.2, -4.8, [1, 1, 1], 0.6)
	place('scene-lamp', -7.5, -3.6, [1, 1, 1], 0.6)
	place('scene-searchlight', 4.4, 1.8, [1, 1, 1], -2.6)

	// the street lamp's glow and pool of light; dust drifting through the beams
	const lamp = new THREE.PointLight(0xffb070, 18, 9, 1.6)
	lamp.position.set(-7.1, 4.4, -3.4)
	scene.add(lamp)
	const glow = new THREE.Sprite(
		new THREE.SpriteMaterial({
			map: glowTexture(),
			color: 0xffc080,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		})
	)
	glow.position.copy(lamp.position)
	glow.scale.setScalar(1.6)
	scene.add(glow)
	const DUST = 220
	const dustPositions = new Float32Array(DUST * 3)
	for (let i = 0; i < DUST; i++) {
		dustPositions[i * 3] = (Math.random() - 0.5) * 12
		dustPositions[i * 3 + 1] = Math.random() * 5
		dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1
	}
	const dustGeometry = new THREE.BufferGeometry()
	dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
	const dust = new THREE.Points(
		dustGeometry,
		new THREE.PointsMaterial({
			color: 0xd8cbb0,
			size: 0.03,
			transparent: true,
			opacity: 0.55,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		})
	)
	scene.add(dust)

	// the squad
	let figures: { figure: PlayerFigure; spot: [number, number] }[] = []
	let wanted = ''
	const setSquad = (members: readonly LobbyMember[]) => {
		const key = JSON.stringify(members)
		if (key === wanted) return
		wanted = key
		for (const entry of figures) entry.figure.dispose()
		const ordered = [...members].sort((a, b) => Number(b.you) - Number(a.you))
		figures = ordered.slice(0, SPOTS.length).map((member, index) => {
			const figure = new PlayerFigure(member.slot, member.you, assets)
			figure.setClass(member.classId, member.armour)
			figure.setRelaxed(true)
			figure.setWeapon(member.weaponId, member.pistol)
			scene.add(figure.group)
			return { figure, spot: SPOTS[index] as [number, number] }
		})
	}

	const resize = () => {
		const width = canvas.clientWidth || window.innerWidth
		const height = canvas.clientHeight || window.innerHeight
		renderer.setSize(width, height, false)
		camera.aspect = width / height
		// a narrow window frames the squad closer
		camera.fov = width / height < 1 ? 52 : 32
		camera.updateProjectionMatrix()
	}
	const post = high ? new PostProcessing(renderer, scene, camera) : null
	const resizeAll = () => {
		resize()
		post?.setSize(
			canvas.clientWidth || window.innerWidth,
			canvas.clientHeight || window.innerHeight,
			renderer.getPixelRatio()
		)
	}
	resizeAll()
	const observer = new ResizeObserver(resizeAll)
	observer.observe(canvas)

	let frame = 0
	let tick = 0
	const start = performance.now()
	const loop = (now: number) => {
		frame = requestAnimationFrame(loop)
		tick++
		// software renderers draw the backdrop at a third of the rate
		if (document.hidden || (!high && tick % 3 !== 0)) return
		const t = (now - start) / 1000
		// standing ready, turned a little toward the light
		for (const [index, { figure, spot }] of figures.entries())
			figure.set(spot[0], spot[1], Math.PI / 2 + 0.25 - index * 0.1, true, false, 0)
		camera.position.set(Math.sin(t * 0.12) * 0.35, 1.9 + Math.sin(t * 0.21) * 0.05, 7.2)
		camera.lookAt(0, 1.0, -0.8)
		flood.intensity = 120 + Math.sin(t * 7.3) * Math.sin(t * 2.1) * 6
		// the dust drifts and settles, then rises again
		const drift = dustGeometry.getAttribute('position') as THREE.BufferAttribute
		for (let i = 0; i < DUST; i++) {
			let y = (drift.getY(i) - 0.004) % 5
			if (y < 0) y += 5
			drift.setY(i, y)
			drift.setX(i, drift.getX(i) + Math.sin(t * 0.7 + i) * 0.002)
		}
		drift.needsUpdate = true
		if (post) post.render(t)
		else renderer.render(scene, camera)
	}
	frame = requestAnimationFrame(loop)

	return {
		setSquad,
		dispose() {
			cancelAnimationFrame(frame)
			observer.disconnect()
			for (const entry of figures) entry.figure.dispose()
			post?.dispose()
			environment.dispose()
			renderer.dispose()
			renderer.forceContextLoss()
		}
	}
}

/** A soft round glow for lamps. */
function glowTexture(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 64
	const context = canvas.getContext('2d') as CanvasRenderingContext2D
	const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
	gradient.addColorStop(0, 'rgba(255,255,255,1)')
	gradient.addColorStop(0.3, 'rgba(255,255,255,0.35)')
	gradient.addColorStop(1, 'rgba(255,255,255,0)')
	context.fillStyle = gradient
	context.fillRect(0, 0, 64, 64)
	return new THREE.CanvasTexture(canvas)
}
