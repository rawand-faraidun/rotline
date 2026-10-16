import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// the queue test reaches Valkey directly to set a tiny capacity
if (existsSync('../../.env') && !process.env.CI) process.loadEnvFile('../../.env')

// Runs against an already running site (dev server or the built stack) with the OAuth mock provider.
export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	// the queue test changes the shared player capacity
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4321',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
