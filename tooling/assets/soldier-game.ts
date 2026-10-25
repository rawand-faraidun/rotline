/**
 * The soldier as the game draws it: the same people, gear and animations as soldier.glb (which the
 * lobby and armory show close up), with about a third of the triangles and textures at 512 pixels.
 * From the game's camera nobody sees the difference, and a squad of four costs a lot less to draw.
 *
 *   pnpm --filter @rotline/assets characters:game   (after `characters`)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const out = join(import.meta.dirname, '../../apps/web/public/assets/models/characters')
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const document = await io.read(join(out, 'soldier.glb'))
const triangles = () =>
	document
		.getRoot()
		.listMeshes()
		.flatMap(mesh => mesh.listPrimitives())
		.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0)
const before = triangles()
await document.transform(
	weld(),
	// keep silhouettes: the error bound stops the simplifier before shapes start to break (nothing is
	// pruned: every class and piece of gear stays, as the game picks them by name)
	simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.01, lockBorder: true }),
	textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
	meshopt({ encoder: MeshoptEncoder, level: 'medium' })
)
const target = join(out, 'soldier-game.glb')
writeFileSync(target, await io.writeBinary(document))
process.stdout.write(
	`soldier-game: ${(readFileSync(target).byteLength / 1024).toFixed(0)} KB, ${before} → ${triangles()} triangles\n`
)
