// Builds the game's weapon models from Sketchfab (CC-BY / CC0, listed in model-sources.json):
// `SKETCHFAB_API_TOKEN=… pnpm assets:models`. Each model is downloaded once (cached), cleaned up
// (duplicates and unused data removed, textures shrunk to WebP), turned so the muzzle points along +X
// with the grip down, scaled to its length in metres and written as one .glb per weapon.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Document, MathUtils, type mat4, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
	dedup,
	flatten,
	getBounds,
	meshopt,
	metalRough,
	prune,
	simplify,
	textureCompress,
	weld
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { plainMaterials, publicAssets, sketchfabModel } from './sources.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(publicAssets, 'models', 'weapons')

type Weapon = {
	id: string
	uid: string
	name: string
	author: string
	length: number
	flip?: boolean
	upsideDown?: boolean
	/** degrees the model is turned about Z after that (a model made with its barrel tilted; down is negative) */
	pitch?: number
	/** parts left out (node names matching this: loose bullets, display stands) */
	drop?: string
	/** loose pieces lying wholly in this bottom share of the height are left out (a display base) */
	dropBottom?: number
	/** the most triangles kept (default 16,000); finer models are simplified */
	triangles?: number
}
const { collection, weapons } = JSON.parse(readFileSync(join(here, 'model-sources.json'), 'utf8')) as {
	collection: string
	weapons: Weapon[]
}
mkdirSync(out, { recursive: true })

/**
 * Turns and scales the whole scene: the longest axis becomes +X (the barrel), the model is centred
 * on its grip height, and it is `length` metres long. `flip` turns it end for end.
 */
function normalise(document: Document, length: number, flip: boolean, upsideDown = false, pitch = 0): void {
	const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]
	if (!scene) return
	const { min, max } = getBounds(scene)
	const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const
	const longest = size.indexOf(Math.max(...size))
	const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
	const scale = length / (size[longest] as number)
	// a wrapper node holds the rotation and scale for everything in the scene
	const wrapper = document.createNode('weapon')
	for (const child of scene.listChildren()) {
		scene.removeChild(child)
		wrapper.addChild(child)
	}
	scene.addChild(wrapper)
	// the longest side becomes +X (the barrel), the next longest +Y (a gun is taller than it is
	// wide), the shortest Z: a rotation built from those axes (right-handed)
	const order = [0, 1, 2].sort((i, j) => (size[j] as number) - (size[i] as number))
	const axis = (index: number) => [0, 1, 2].map(k => (k === index ? 1 : 0)) as [number, number, number]
	const x = axis(order[0] as number)
	const y = axis(order[1] as number)
	const z: [number, number, number] = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
	// rows of the rotation are the model axes that land on X, Y and Z
	const matrix = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1]
	const t: [number, number, number] = [0, 0, 0]
	const rotation: [number, number, number, number] = [0, 0, 0, 1]
	const s: [number, number, number] = [1, 1, 1]
	MathUtils.decompose(matrix as unknown as mat4, t, rotation, s)
	// `flip` turns it end for end (a half turn about +Y), `upsideDown` rights it (a half turn about +X)
	let turned = flip ? multiply([0, 1, 0, 0], rotation) : rotation
	if (upsideDown) turned = multiply([1, 0, 0, 0], turned)
	if (pitch) {
		const half = (pitch * Math.PI) / 360
		turned = multiply([0, 0, Math.sin(half), Math.cos(half)], turned)
	}
	wrapper.setRotation(turned)
	wrapper.setScale([scale, scale, scale])
	// move the centre to the origin (applied before rotation and scale, so through a child)
	const offset = document.createNode('centre')
	for (const child of wrapper.listChildren()) {
		wrapper.removeChild(child)
		offset.addChild(child)
	}
	offset.setTranslation([-(centre[0] as number), -(centre[1] as number), -(centre[2] as number)])
	wrapper.addChild(offset)
}

/**
 * Removes the separate pieces (connected triangles) that lie wholly in the bottom `share` of the
 * model's height, measured with the turn already applied (+Y is up).
 */
function dropBottom(document: Document, share: number): void {
	const parts = document
		.getRoot()
		.listNodes()
		.flatMap(node => (node.getMesh()?.listPrimitives() ?? []).map(primitive => ({ node, primitive })))
	const heights = parts.map(({ node, primitive }) => {
		const m = node.getWorldMatrix()
		const position = primitive.getAttribute('POSITION')
		const p: number[] = []
		const y = new Float32Array(position?.getCount() ?? 0)
		for (let v = 0; v < y.length; v++) {
			position?.getElement(v, p)
			y[v] =
				(m[1] as number) * (p[0] as number) +
				(m[5] as number) * (p[1] as number) +
				(m[9] as number) * (p[2] as number) +
				(m[13] as number)
		}
		return y
	})
	let low = Number.POSITIVE_INFINITY
	let high = Number.NEGATIVE_INFINITY
	for (const y of heights)
		for (const value of y) {
			low = Math.min(low, value)
			high = Math.max(high, value)
		}
	const cut = low + (high - low) * share
	for (const [index, { primitive }] of parts.entries()) {
		const indices = primitive.getIndices()
		const y = heights[index] as Float32Array
		if (!indices) continue
		const list = Array.from(indices.getArray() ?? [])
		// union-find over the vertices: triangles sharing a vertex are one piece
		const parent = Array.from({ length: y.length }, (_, v) => v)
		const find = (v: number): number => {
			while (parent[v] !== v) {
				parent[v] = parent[parent[v] as number] as number
				v = parent[v] as number
			}
			return v
		}
		for (let t = 0; t < list.length; t += 3) {
			const a = find(list[t] as number)
			parent[find(list[t + 1] as number)] = a
			parent[find(list[t + 2] as number)] = a
		}
		const top = new Map<number, number>()
		for (let v = 0; v < y.length; v++) {
			const root = find(v)
			top.set(root, Math.max(top.get(root) ?? Number.NEGATIVE_INFINITY, y[v] as number))
		}
		const kept = list.filter((_, at) => {
			const corner = list[at - (at % 3)] as number
			return (top.get(find(corner)) ?? 0) > cut
		})
		indices.setArray(new Uint32Array(kept))
	}
}

function multiply(a: number[], b: number[]): [number, number, number, number] {
	const [ax, ay, az, aw] = a as [number, number, number, number]
	const [bx, by, bz, bw] = b as [number, number, number, number]
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz
	]
}

await MeshoptSimplifier.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const triangles = (document: Document) =>
	document
		.getRoot()
		.listMeshes()
		.flatMap(mesh => mesh.listPrimitives())
		.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0)
const credits: { id: string; name: string; author: string; page: string; licence: string }[] = []
for (const weapon of weapons) {
	const document = await io.read(await sketchfabModel(weapon.uid))
	// some models are rigged for first-person animation: their skins would ignore the turn below
	for (const node of document.getRoot().listNodes()) node.setSkin(null)
	for (const mesh of document.getRoot().listMeshes())
		for (const primitive of mesh.listPrimitives()) {
			primitive.setAttribute('JOINTS_0', null)
			primitive.setAttribute('WEIGHTS_0', null)
		}
	for (const skin of document.getRoot().listSkins()) skin.dispose()
	if (weapon.drop) {
		const drop = new RegExp(weapon.drop)
		for (const node of document.getRoot().listNodes()) if (drop.test(node.getName())) node.setMesh(null)
	}
	// older files describe colour as specular-glossiness: turn that into the usual metal-roughness
	await document.transform(metalRough())
	plainMaterials(document)
	normalise(document, weapon.length, weapon.flip ?? false, weapon.upsideDown ?? false, weapon.pitch ?? 0)
	await document.transform(dedup(), flatten(), weld(), prune())
	if (weapon.dropBottom) dropBottom(document, weapon.dropBottom)
	const limit = weapon.triangles ?? 16000
	const count = triangles(document)
	if (count > limit)
		await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: limit / count, error: 0.002 }))
	// the shop and armory show the guns close up: colour stays sharp, the other maps can be smaller
	await document.transform(
		prune(),
		textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 78, slots: /^(?!baseColor)/ }),
		textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82, slots: /^baseColor/ }),
		// quantised and packed vertices (the game loads them with the meshopt decoder)
		meshopt({ encoder: MeshoptEncoder, level: 'medium' })
	)
	const target = join(out, `${weapon.id}.glb`)
	writeFileSync(target, await io.writeBinary(document))
	credits.push({
		id: weapon.id,
		name: weapon.name,
		author: weapon.author,
		page: `https://sketchfab.com/3d-models/${weapon.uid}`,
		licence: 'CC BY 4.0'
	})
	process.stdout.write(
		`${weapon.id}: ${(readFileSync(target).byteLength / 1024).toFixed(0)} KB, ${Math.round(triangles(document))} triangles\n`
	)
}
writeFileSync(join(out, 'credits.json'), `${JSON.stringify({ collection, models: credits }, null, '\t')}\n`)
