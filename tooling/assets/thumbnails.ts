// Renders a still of every weapon model for the shop and armory cards: `pnpm assets:thumbnails`
// (after `pnpm assets:models`). A headless browser draws each model the way the 3D viewer shows it,
// and the stills are written next to the models as small WebP files.
import { createReadStream, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { publicAssets } from './sources.ts'

const here = dirname(fileURLToPath(import.meta.url))
// three's build folder holds the module the page imports
const three = dirname(dirname(createRequire(import.meta.url).resolve('three')))
const weapons = join(publicAssets, 'models', 'weapons')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' }

// a tiny local server: the page, three.js and the models (browsers will not load modules from files)
const server = createServer((request, response) => {
	const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname))
	const file = path.startsWith('/three/')
		? join(three, path.slice('/three/'.length))
		: path.startsWith('/weapons/')
			? join(weapons, path.slice('/weapons/'.length))
			: join(here, 'thumbnails', 'page.html')
	if (!existsSync(file)) {
		response.writeHead(404).end()
		return
	}
	response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
	createReadStream(file).pipe(response)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const port = typeof address === 'object' && address ? address.port : 0

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
	const page = await browser.newPage()
	await page.goto(`http://127.0.0.1:${port}/`)
	await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true)
	for (const file of readdirSync(weapons).filter(name => name.endsWith('.glb'))) {
		const data = await page.evaluate(
			url => (window as unknown as { render(url: string): Promise<string> }).render(url),
			`/weapons/${file}`
		)
		const png = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
		const target = join(weapons, file.replace(/\.glb$/, '.webp'))
		// cut the empty space around the gun, then centre it on a 16:9 still with a small margin
		const trimmed = await sharp(png).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true })
		const { width, height } = trimmed.info
		const canvasWidth = Math.ceil(Math.max(width, (height * 16) / 9) * 1.08)
		const canvasHeight = Math.ceil((canvasWidth * 9) / 16)
		const across = canvasWidth - width
		const down = canvasHeight - height
		const clear = { r: 0, g: 0, b: 0, alpha: 0 }
		const still = await sharp(trimmed.data)
			.extend({
				left: Math.floor(across / 2),
				right: Math.ceil(across / 2),
				top: Math.floor(down / 2),
				bottom: Math.ceil(down / 2),
				background: clear
			})
			.toBuffer()
		writeFileSync(
			target,
			await sharp(still)
				.resize({ width: 480, height: 270, fit: 'contain', background: clear })
				.webp({ quality: 82, alphaQuality: 90 })
				.toBuffer()
		)
		process.stdout.write(`${file.replace(/\.glb$/, '')}: still written\n`)
	}
} finally {
	await browser.close()
	server.close()
}
