import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['test/unit/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/lib/**', 'src/env.ts'],
			thresholds: { lines: 90, branches: 85 }
		}
	}
})
