import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const apiTarget = process.env.API_PROXY_TARGET ?? `http://localhost:${process.env.API_PORT ?? 3100}`
const queueTarget = process.env.QUEUE_PROXY_TARGET ?? `http://localhost:${process.env.QUEUE_PORT ?? 3300}`
const gameTarget = process.env.GAME_PROXY_TARGET ?? `ws://localhost:${process.env.GAME_PORT ?? 3200}`

// The routes of the production reverse proxy, for `pnpm dev` and for `pnpm start` (the built site).
// First match wins: the queue before the rest of the API.
const proxy = {
	'/api/queue': { target: queueTarget, changeOrigin: false },
	'/api': { target: apiTarget, changeOrigin: false },
	'/game': { target: gameTarget, ws: true }
}

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
		server: { proxy },
		preview: { proxy }
	}
})
