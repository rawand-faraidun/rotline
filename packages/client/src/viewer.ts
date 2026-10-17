import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { detectQuality } from './render/quality.ts'

export type ShowOptions = {
	/** for a model holding several looks (the soldier's classes): show only nodes named `<only>-…` */
	only?: string | undefined
	/** an animation clip to loop */
	clip?: string | undefined
}

export type ViewerHandle = {
	/** shows another model (a .glb) */
	show(url: string, options?: ShowOptions): void
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
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
	let mixer: THREE.AnimationMixer | null = null
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

	// a weak device draws the turntable at a third of the rate; nobody draws it while it is off screen
	const low = detectQuality(renderer.getContext()) === 'low'
	if (low) {
		renderer.setPixelRatio(1)
		resize()
	}
	let onScreen = true
	const watcher = new IntersectionObserver(entries => {
		onScreen = entries.some(entry => entry.isIntersecting)
	})
	watcher.observe(canvas)
	let tick = 0
	const loop = (now: number) => {
		frame = requestAnimationFrame(loop)
		tick++
		if (!onScreen || document.hidden || (low && !dragging && tick % 3 !== 0)) return
		const dt = Math.min(0.1, (now - last) / 1000)
		last = now
		sway += dt
		mixer?.update(dt)
		turntable.rotation.y = angle + (dragging || held ? 0 : Math.sin(sway * 0.6) * 0.45)
		renderer.render(scene, camera)
	}
	frame = requestAnimationFrame(loop)

	return {
		show(url, options = {}) {
			const key = `${url}#${options.only ?? ''}#${options.clip ?? ''}`
			if (key === wanted) return
			wanted = key
			loader.load(
				url,
				gltf => {
					if (key !== wanted) return
					if (current) turntable.remove(current)
					mixer?.stopAllAction()
					mixer = null
					// the weapons are one metre or so along +X, centred: frame them to fit
					const model = options.only || options.clip ? cloneSkinned(gltf.scene) : gltf.scene
					if (options.only) {
						const only = options.only
						model.traverse(object => {
							const owner = /^(\w+)-/.exec(object.name)?.[1]
							if (owner && /^(assault|medic|heavy|survivor)$/.test(owner)) object.visible = owner === only
						})
					}
					const clip = options.clip && gltf.animations.find(entry => entry.name === options.clip)
					if (clip) {
						mixer = new THREE.AnimationMixer(model)
						mixer.clipAction(clip).play()
						mixer.update(0)
					}
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
			mixer?.stopAllAction()
			observer.disconnect()
			watcher.disconnect()
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
