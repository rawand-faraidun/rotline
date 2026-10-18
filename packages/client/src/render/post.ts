import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

/**
 * The finish on the picture (high quality only): ambient occlusion so things sit in their corners,
 * a soft bloom on bright things (muzzle flashes, lamps, fire), and a grade: a little contrast, colour
 * pulled toward a cold, worn palette, a vignette and fine film grain.
 */
const GRADE = {
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		time: { value: 0 },
		vignette: { value: 0.32 },
		grain: { value: 0.035 }
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
	`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float time;
		uniform float vignette;
		uniform float grain;
		varying vec2 vUv;
		float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
		void main() {
			vec4 colour = texture2D(tDiffuse, vUv);
			vec3 c = colour.rgb;
			// a touch of contrast around the middle grey
			c = (c - 0.5) * 1.08 + 0.5;
			// muted, a little cold in the shadows and warm in the lights
			float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
			c = mix(vec3(luma), c, 0.86);
			c += vec3(-0.012, 0.0, 0.018) * (1.0 - luma) + vec3(0.02, 0.01, -0.01) * luma;
			// darker toward the corners
			vec2 d = vUv - 0.5;
			c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
			// grain that moves every frame
			c += (hash(vUv * 1024.0 + time) - 0.5) * grain;
			gl_FragColor = vec4(c, colour.a);
		}
	`
}

export class PostProcessing {
	private readonly composer: EffectComposer
	private readonly ao: GTAOPass
	private readonly bloom: UnrealBloomPass
	private readonly grade: ShaderPass

	constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
		const size = renderer.getSize(new THREE.Vector2())
		this.composer = new EffectComposer(renderer)
		this.composer.addPass(new RenderPass(scene, camera))
		this.ao = new GTAOPass(scene, camera, size.x, size.y)
		this.ao.blendIntensity = 0.85
		this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12 })
		this.composer.addPass(this.ao)
		this.bloom = new UnrealBloomPass(size, 0.42, 0.55, 0.82)
		this.composer.addPass(this.bloom)
		this.composer.addPass(new OutputPass())
		this.grade = new ShaderPass(GRADE)
		this.composer.addPass(this.grade)
	}

	setSize(width: number, height: number, pixelRatio: number): void {
		this.composer.setPixelRatio(pixelRatio)
		this.composer.setSize(width, height)
	}

	render(timeSeconds: number): void {
		;(this.grade.uniforms.time as { value: number }).value = timeSeconds % 100
		this.composer.render()
	}

	dispose(): void {
		this.composer.dispose()
	}
}
