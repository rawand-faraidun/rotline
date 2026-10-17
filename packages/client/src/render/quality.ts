/**
 * How much the device can draw. A software renderer (no graphics card: SwiftShader, llvmpipe, some
 * virtual machines) gets the light version: no shadows, plain colour textures, simple prop shapes and
 * fewer pixels, so the game stays playable instead of dropping to a few frames a second.
 */
export type Quality = 'high' | 'low'

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i

export function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
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
