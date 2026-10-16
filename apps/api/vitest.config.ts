import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['test/unit/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			// database-bound modules (ledger, build, routes, rewards) are covered by the integration tests
			include: ['src/lib/player-name.ts', 'src/env.ts'],
			thresholds: { lines: 90, branches: 85 }
		}
	}
})
