// Renders a model to a PNG for a quick look: `node preview.ts <model.gltf|glb> <out.png> [mesh filter]`.
// Two views side by side (front and three-quarter), orthographic; old specular-glossiness materials
// are converted first so they show their colours.
import { createReadStream, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { metalRough } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { chromium } from 'playwright'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const three = dirname(dirname(createRequire(import.meta.url).resolve('three')))
const [input, output, focus] = process.argv.slice(2) as [string, string, string | undefined]
await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const document = await io.read(input)
await document.transform(metalRough())
const folder = mkdtempSync(join(tmpdir(), 'preview-'))
writeFileSync(join(folder, 'model.glb'), await io.writeBinary(document))

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' }
const server = createServer((request, response) => {
	const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname))
	const file = path.startsWith('/three/')
		? join(three, path.slice('/three/'.length))
		: path === '/model.glb'
			? join(folder, 'model.glb')
			: join(here, 'preview', 'page.html')
	if (!existsSync(file)) {
		response.writeHead(404).end()
		return
	}
	response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
	createReadStream(file).pipe(response)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
	const page = await browser.newPage()
	await page.goto(`http://127.0.0.1:${port}/`)
	await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true)
	const shots = (await page.evaluate(
		([filter]) =>
			(window as unknown as { render(url: string, views: number[], focus?: string): Promise<string[]> }).render(
				'/model.glb',
				[0, Math.PI / 4],
				filter ?? undefined
			),
		[focus ?? null] as const
	)) as string[]
	const images = shots.map(data => Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'))
	await sharp({ create: { width: 2400, height: 900, channels: 3, background: '#000' } })
		.composite(images.map((image, index) => ({ input: image, left: index * 1200, top: 0 })))
		.png()
		.toFile(output)
} finally {
	await browser.close()
	server.close()
}
