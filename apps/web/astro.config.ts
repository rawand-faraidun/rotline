import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const apiTarget = process.env.API_PROXY_TARGET ?? `http://localhost:${process.env.API_PORT ?? 3100}`

// Static output: the reverse proxy serves these files and routes /api to the API.
export default defineConfig({
	output: 'static',
	site: process.env.PUBLIC_ORIGIN ?? 'http://localhost:4321',
	trailingSlash: 'never',
	build: { format: 'file' },
	integrations: [react()],
	devToolbar: { enabled: false },
	server: { port: 4321, host: true },
	vite: {
		plugins: [tailwindcss()],
		server: {
			proxy: { '/api': { target: apiTarget, changeOrigin: false } }
		}
	}
})
