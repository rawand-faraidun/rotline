import { describe, expect, it } from 'vitest'
import { qualityForRenderer } from '../src/render/quality.ts'

describe('graphics quality by device', () => {
	it('gives graphics cards high, built-in graphics medium and software renderers low', () => {
		expect(
			qualityForRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)')
		).toBe('high')
		expect(qualityForRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe('high')
		expect(qualityForRenderer('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(
			'high'
		)
		expect(qualityForRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(
			'medium'
		)
		expect(qualityForRenderer('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(
			'medium'
		)
		expect(qualityForRenderer('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium')
		expect(qualityForRenderer('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
		expect(qualityForRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(
			'low'
		)
	})
})
