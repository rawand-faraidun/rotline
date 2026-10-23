import * as THREE from 'three'
import { PlayerFigure } from './render/players.ts'

/**
 * A development bench for soldiers: one figure holding a weapon, aimed at a fixed angle, drawn from
 * the game's camera, the front and the side at once. Used to tune how guns are held.
 */
export function mountLab(
	canvas: HTMLCanvasElement,
	options: {
		weapon: string
		pistol: boolean
		classId: string
		aim: number
		only?: string
		relaxed?: boolean
		/** how far the front and side cameras stand (metres) */
		distance?: number
		/** the game camera's field of view (degrees; smaller is closer) */
		zoom?: number
		/** armour ids worn (head, torso, vest, legs, feet), instead of the class's usual kit */
		armour?: (string | null)[]
	}
) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
	renderer.setPixelRatio(1)
	renderer.setScissorTest(true)
	const scene = new THREE.Scene()
	scene.background = new THREE.Color(0x30353a)
	scene.add(new THREE.HemisphereLight(0xdde6ee, 0x30302a, 1.6))
	const sun = new THREE.DirectionalLight(0xffffff, 2.2)
	sun.position.set(4, 10, 6)
	scene.add(sun)
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x55585a }))
	ground.rotation.x = -Math.PI / 2
	scene.add(ground)
	const figure = new PlayerFigure(1, true, '/assets')
	figure.setClass(options.classId, options.armour)
	figure.setWeapon(options.weapon, options.pistol)
	figure.setRelaxed(options.relaxed ?? false)
	scene.add(figure.group)
	;(window as unknown as { labScene: THREE.Scene; labFigure: PlayerFigure }).labScene = scene
	;(window as unknown as { labFigure: PlayerFigure }).labFigure = figure
	const top = new THREE.PerspectiveCamera(38, 1, 0.5, 100)
	top.position.set(0, 19, 6)
	top.lookAt(0, 0, 0)
	const front = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
	const side = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
	const loop = () => {
		requestAnimationFrame(loop)
		figure.set(0, 0, options.aim, true, false, 0)
		// only these pieces (a name pattern), to see one at a time
		if (options.only) {
			const only = new RegExp(options.only)
			figure.group.traverse(object => {
				if ((object as THREE.Mesh).isMesh && /^(head|vest|body|legs|feet|pack|skin)-/.test(object.name))
					object.visible = only.test(object.name)
			})
		}
		// the front camera stands where the gun points, the side camera off the right shoulder
		const dx = Math.cos(options.aim)
		const dz = Math.sin(options.aim)
		const distance = options.distance ?? 3.2
		const height = distance < 2 ? 1.3 : 1.1
		front.position.set(dx * distance, height + 0.2, dz * distance)
		front.lookAt(dx * 0.3, height, dz * 0.3)
		side.position.set(-dz * distance, height + 0.3, dx * distance)
		side.lookAt(dx * 0.3, height, dz * 0.3)
		const width = canvas.width / 3
		const views: [THREE.PerspectiveCamera, number][] = [
			[top, 0],
			[front, 1],
			[side, 2]
		]
		for (const [camera, index] of views) {
			renderer.setViewport(width * index, 0, width, canvas.height)
			renderer.setScissor(width * index, 0, width, canvas.height)
			camera.aspect = width / canvas.height
			camera.updateProjectionMatrix()
			if (camera === top) {
				// the game camera, zoomed on the figure
				camera.fov = options.zoom ?? 9
				camera.updateProjectionMatrix()
			}
			renderer.render(scene, camera)
		}
	}
	loop()
}
