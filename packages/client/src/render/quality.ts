/**
 * How much the device can draw. A software renderer (no graphics card: SwiftShader, llvmpipe, some
 * virtual machines) gets the light version: no shadows, plain colour textures, simple prop shapes and
 * fewer pixels, so the game stays playable instead of dropping to a few frames a second.
 */
export type Quality = 'high' | 'low'

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i

/** The player's choice: `auto` follows the device. Kept per browser. */
export type GraphicsSetting = 'auto' | Quality
const SETTING_KEY = 'rotline.graphics'

export function loadGraphicsSetting(): GraphicsSetting {
	try {
		const value = localStorage.getItem(SETTING_KEY)
		if (value === 'high' || value === 'low') return value
	} catch {
		// private window: auto
	}
	return 'auto'
}

export function saveGraphicsSetting(setting: GraphicsSetting): void {
	try {
		if (setting === 'auto') localStorage.removeItem(SETTING_KEY)
		else localStorage.setItem(SETTING_KEY, setting)
	} catch {
		// not saved
	}
}

export function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
	const chosen = loadGraphicsSetting()
	if (chosen !== 'auto') return chosen
	try {
		const info = gl.getExtension('WEBGL_debug_renderer_info')
		const renderer = String(
			(info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ''
		)
		return SOFTWARE.test(renderer) ? 'low' : 'high'
	} catch {
		return 'high'
	}
}

/** Finds the quality before the real renderer exists (antialiasing can only be chosen at creation). */
export function probeQuality(): Quality {
	const chosen = loadGraphicsSetting()
	if (chosen !== 'auto') return chosen
	try {
		const canvas = document.createElement('canvas')
		const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
		if (!gl) return 'low'
		const quality = detectQuality(gl)
		gl.getExtension('WEBGL_lose_context')?.loseContext()
		return quality
	} catch {
		return 'high'
	}
}

/** Pixel ratio per quality: a software renderer pays for every pixel, so it draws at half size. */
export function pixelRatioFor(quality: Quality, cap: number): number {
	return quality === 'high' ? Math.min(window.devicePixelRatio, cap) : 0.5
}
