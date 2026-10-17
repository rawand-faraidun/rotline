// Builds the game's weapon models from Sketchfab (CC-BY / CC0, listed in model-sources.json):
// `SKETCHFAB_API_TOKEN=… pnpm assets:models`. Each model is downloaded once (cached), cleaned up
// (duplicates and unused data removed, textures shrunk to WebP), turned so the muzzle points along +X
// with the grip down, scaled to its length in metres and written as one .glb per weapon.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, getBounds, prune, textureCompress, weld } from '@gltf-transform/functions'
import sharp from 'sharp'
import { plainMaterials, publicAssets, sketchfabModel } from './sources.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(publicAssets, 'models', 'weapons')

type Weapon = { id: string; uid: string; name: string; author: string; length: number; flip?: boolean }
const { collection, weapons } = JSON.parse(readFileSync(join(here, 'model-sources.json'), 'utf8')) as {
	collection: string
	weapons: Weapon[]
}
mkdirSync(out, { recursive: true })

/**
 * Turns and scales the whole scene: the longest axis becomes +X (the barrel), the model is centred
 * on its grip height, and it is `length` metres long. `flip` turns it end for end.
 */
function normalise(document: Document, length: number, flip: boolean): void {
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
	const half = Math.SQRT1_2
	// rotation taking the longest axis onto +X (quaternions x, y, z, w)
	const rotation: [number, number, number, number] =
		longest === 0 ? [0, 0, 0, 1] : longest === 2 ? [0, half, 0, half] : [0, 0, -half, half]
	// flipping is a half turn about +Y after that, so the model stays upright
	wrapper.setRotation(flip ? multiply([0, 1, 0, 0], rotation) : rotation)
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

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const credits: { id: string; name: string; author: string; page: string; licence: string }[] = []
for (const weapon of weapons) {
	const document = await io.read(await sketchfabModel(weapon.uid))
	plainMaterials(document)
	normalise(document, weapon.length, weapon.flip ?? false)
	await document.transform(
		dedup(),
		flatten(),
		weld(),
		prune(),
		textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 })
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
	process.stdout.write(`${weapon.id}: ${(readFileSync(target).byteLength / 1024).toFixed(0)} KB\n`)
}
writeFileSync(join(out, 'credits.json'), `${JSON.stringify({ collection, models: credits }, null, '\t')}\n`)
