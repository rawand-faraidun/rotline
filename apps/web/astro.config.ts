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
	// pages answer with or without a trailing slash (the app trims it from the address)
	trailingSlash: 'ignore',
	build: { format: 'file' },
	integrations: [react()],
	devToolbar: { enabled: false },
	server: { port: 4321, host: true },
	vite: {
		plugins: [tailwindcss()],
		// found up front, so the dev server never has to re-bundle them mid-session (and reload the page)
		optimizeDeps: {
			include: [
				'three',
				'three/addons/loaders/GLTFLoader.js',
				'three/addons/libs/meshopt_decoder.module.js',
				'three/addons/utils/SkeletonUtils.js',
				'three/addons/environments/RoomEnvironment.js',
				'three/addons/postprocessing/EffectComposer.js',
				'three/addons/postprocessing/GTAOPass.js',
				'three/addons/postprocessing/OutputPass.js',
				'three/addons/postprocessing/RenderPass.js',
				'three/addons/postprocessing/ShaderPass.js',
				'three/addons/postprocessing/UnrealBloomPass.js'
			]
		},
		server: { proxy },
		preview: { proxy }
	}
})
