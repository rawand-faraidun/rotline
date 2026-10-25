/**
 * How much the device can draw.
 * - `high`: a graphics card. Shadows, ambient occlusion, bloom and the grade, antialiasing.
 * - `medium`: graphics built into the processor (most laptops: Intel UHD and Iris, AMD Radeon
 *   Graphics): textures, models and simple shadows, but no ambient occlusion, bloom or grade and one
 *   pixel per screen pixel, so it holds a steady frame rate.
 * - `low`: a software renderer (no graphics card at all: SwiftShader, llvmpipe, some virtual
 *   machines): no shadows, plain colour textures, simple prop shapes and fewer pixels.
 */
export type Quality = 'high' | 'medium' | 'low'

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i
/** graphics built into the processor (Intel Arc cards and AMD Radeon RX/Pro cards are real cards) */
const INTEGRATED =
	/intel(?!.*\barc\b)|iris|uhd graphics|hd graphics|radeon\(tm\) graphics|radeon graphics|radeon vega|vega \d+ graphics|mali|adreno|powervr/i

/** The player's choice: `auto` follows the device. Kept per browser. */
export type GraphicsSetting = 'auto' | Quality
const SETTING_KEY = 'rotline.graphics'

export function loadGraphicsSetting(): GraphicsSetting {
	try {
		const value = localStorage.getItem(SETTING_KEY)
		if (value === 'high' || value === 'medium' || value === 'low') return value
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
		return qualityForRenderer(renderer)
	} catch {
		return 'high'
	}
}

/** The quality a graphics device's name calls for. */
export function qualityForRenderer(renderer: string): Quality {
	if (SOFTWARE.test(renderer)) return 'low'
	return INTEGRATED.test(renderer) ? 'medium' : 'high'
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

/**
 * Pixel ratio per quality: built-in graphics draw one pixel per screen pixel (never the extra ones of a
 * high-density screen), and a software renderer pays for every pixel, so it draws at half size.
 */
export function pixelRatioFor(quality: Quality, cap: number): number {
	if (quality === 'high') return Math.min(window.devicePixelRatio, cap)
	return quality === 'medium' ? Math.min(window.devicePixelRatio, 1) : 0.5
}
