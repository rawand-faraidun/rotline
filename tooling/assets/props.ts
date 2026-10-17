// Builds the map props from Poly Haven (CC0): `pnpm assets:props`. Each model is downloaded once,
// simplified, its textures shrunk to WebP, and it is fitted into a 1 m cube standing on the ground
// (centred, base at 0) so the game can stretch it to each prop's footprint and height.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
	dedup,
	flatten,
	getBounds,
	join as joinPrimitives,
	meshopt,
	prune,
	simplify,
	textureCompress,
	weld
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { cacheRoot, plainMaterials, publicAssets } from './sources.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(publicAssets, 'models', 'props')
const cache = join(cacheRoot, 'polyhaven')
type PropSource = {
	kind: string
	source: string
	name: string
	author: string
	triangles: number
	/** multiplies the colours (compost bags become sandbags) */
	tint?: [number, number, number]
	/** keep only these mesh nodes (for files holding several variants) */
	nodes?: string[]
}
const { props } = JSON.parse(readFileSync(join(here, 'prop-sources.json'), 'utf8')) as { props: PropSource[] }
mkdirSync(out, { recursive: true })
await MeshoptSimplifier.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

/** The model's glTF on disk: the 1k version from the Poly Haven API, with its buffer and textures. */
async function fetchModel(id: string): Promise<string> {
	const folder = join(cache, id)
	const files = (await (await fetch(`https://api.polyhaven.com/files/${id}`)).json()) as {
		gltf: Record<string, { gltf: { url: string; include: Record<string, { url: string }> } }>
	}
	const entry = files.gltf['1k']?.gltf
	if (!entry) throw new Error(`${id}: no 1k glTF`)
	const main = join(folder, `${id}.gltf`)
	if (!existsSync(main)) {
		for (const [path, file] of Object.entries(entry.include)) {
			const target = join(folder, path)
			mkdirSync(dirname(target), { recursive: true })
			writeFileSync(target, Buffer.from(await (await fetch(file.url)).arrayBuffer()))
		}
		mkdirSync(folder, { recursive: true })
		writeFileSync(main, Buffer.from(await (await fetch(entry.url)).arrayBuffer()))
	}
	return main
}

const credits: { name: string; author: string; page: string; licence: string }[] = []
for (const prop of props) {
	const document = await io.read(await fetchModel(prop.source))
	const root = document.getRoot()
	plainMaterials(document)
	if (prop.nodes) {
		const keep = prop.nodes
		for (const node of root.listNodes()) if (node.getMesh() && !keep.includes(node.getName())) node.setMesh(null)
	}
	process.stdout.write(
		`${prop.kind} parts: ${root
			.listNodes()
			.filter(node => node.getMesh())
			.map(node => node.getName())
			.join(', ')}\n`
	)
	await document.transform(flatten(), weld())
	if (prop.tint) {
		const [r, g, b] = prop.tint
		for (const material of root.listMaterials()) {
			const [cr, cg, cb, ca] = material.getBaseColorFactor()
			material.setBaseColorFactor([cr * r, cg * g, cb * b, ca])
		}
	}
	const triangles = root
		.listMeshes()
		.reduce(
			(sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0),
			0
		)
	if (triangles > prop.triangles)
		await document.transform(
			simplify({ simplifier: MeshoptSimplifier, ratio: prop.triangles / triangles, error: 0.05 })
		)
	// into a 1 m cube: centred on the ground, every side 1 m long
	const scene = root.getDefaultScene() ?? root.listScenes()[0]
	if (!scene) continue
	const { min, max } = getBounds(scene)
	const fit = document
		.createNode('prop')
		.setScale([1 / (max[0] - min[0]), 1 / (max[1] - min[1]), 1 / (max[2] - min[2])])
	const offset = document.createNode('base').setTranslation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2])
	for (const child of scene.listChildren()) {
		scene.removeChild(child)
		offset.addChild(child)
	}
	fit.addChild(offset)
	scene.addChild(fit)
	await document.transform(
		dedup(),
		// one draw call per material: a map holds dozens of these
		joinPrimitives(),
		prune(),
		textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
		meshopt({ encoder: MeshoptEncoder, level: 'medium' })
	)
	const target = join(out, `${prop.kind}.glb`)
	writeFileSync(target, await io.writeBinary(document))
	credits.push({
		name: prop.name,
		author: prop.author,
		page: `https://polyhaven.com/a/${prop.source}`,
		licence: 'CC0 1.0'
	})
	process.stdout.write(`${prop.kind}: ${(readFileSync(target).byteLength / 1024).toFixed(0)} KB\n`)
}
writeFileSync(join(out, 'credits.json'), `${JSON.stringify({ props: credits }, null, '\t')}\n`)
