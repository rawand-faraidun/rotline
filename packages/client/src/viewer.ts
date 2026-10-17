import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export type ViewerHandle = {
	/** shows another model (a weapon id's .glb under the base path) */
	show(url: string): void
	dispose(): void
}

/**
 * A small turntable for one model: the armory and shop show the weapon you picked, turning slowly;
 * drag to turn it yourself. The page loads it (and three.js) only when it is opened.
 */
export function mountViewer(canvas: HTMLCanvasElement): ViewerHandle {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.outputColorSpace = THREE.SRGBColorSpace
	const scene = new THREE.Scene()
	// metal needs something to reflect: a soft studio around the model
	const environment = new THREE.PMREMGenerator(renderer)
	scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture
	renderer.toneMappingExposure = 1.1
	const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50)
	camera.position.set(0, 0.25, 2.4)
	camera.lookAt(0, 0, 0)
	scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x2a3129, 1.6))
	const key = new THREE.DirectionalLight(0xfff1dd, 3)
	key.position.set(2, 3, 2)
	const rim = new THREE.DirectionalLight(0xb8f23c, 1.4)
	rim.position.set(-3, 1, -2)
	scene.add(key, rim)
	const turntable = new THREE.Group()
	scene.add(turntable)
	const loader = new GLTFLoader()
	let current: THREE.Object3D | null = null
	let wanted = ''
	// side on, swaying a little; dragging turns it freely
	let angle = 0
	let sway = 0
	let held = false
	let dragging = false
	let lastX = 0
	let frame = 0
	let last = performance.now()

	const resize = () => {
		const width = canvas.clientWidth || 300
		const height = canvas.clientHeight || 200
		renderer.setSize(width, height, false)
		camera.aspect = width / height
		camera.updateProjectionMatrix()
	}
	resize()
	const observer = new ResizeObserver(resize)
	observer.observe(canvas)

	const down = (event: PointerEvent) => {
		dragging = true
		lastX = event.clientX
		canvas.setPointerCapture(event.pointerId)
	}
	const move = (event: PointerEvent) => {
		if (!dragging) return
		angle += (event.clientX - lastX) * 0.01
		lastX = event.clientX
	}
	const up = () => {
		dragging = false
		held = true
	}
	canvas.addEventListener('pointerdown', down)
	canvas.addEventListener('pointermove', move)
	canvas.addEventListener('pointerup', up)

	const loop = (now: number) => {
		frame = requestAnimationFrame(loop)
		const dt = Math.min(0.1, (now - last) / 1000)
		last = now
		sway += dt
		turntable.rotation.y = angle + (dragging || held ? 0 : Math.sin(sway * 0.6) * 0.45)
		renderer.render(scene, camera)
	}
	frame = requestAnimationFrame(loop)

	return {
		show(url) {
			if (url === wanted) return
			wanted = url
			loader.load(
				url,
				gltf => {
					if (url !== wanted) return
					if (current) turntable.remove(current)
					// the models are one metre or so along +X, centred: frame them to fit
					const model = gltf.scene
					const box = new THREE.Box3().setFromObject(model)
					const size = box.getSize(new THREE.Vector3())
					const fit = 1.4 / Math.max(size.x, size.y, size.z, 0.01)
					model.scale.setScalar(fit)
					model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(fit))
					current = model
					turntable.add(model)
				},
				undefined,
				() => {
					// a missing model leaves the viewer empty
				}
			)
		},
		dispose() {
			cancelAnimationFrame(frame)
			observer.disconnect()
			environment.dispose()
			canvas.removeEventListener('pointerdown', down)
			canvas.removeEventListener('pointermove', move)
			canvas.removeEventListener('pointerup', up)
			renderer.dispose()
			// browsers allow only a few live WebGL contexts: give this one back now
			renderer.forceContextLoss()
		}
	}
}
