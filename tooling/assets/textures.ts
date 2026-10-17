// Builds the ground and wall materials from ambientCG (CC0): `pnpm assets:textures`. Each material's
// colour, normal (OpenGL) and roughness maps are downloaded once, shrunk and written as WebP under
// public/assets/textures/<id>/, with a credits list for the credits page.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { cacheRoot, publicAssets } from './sources.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(publicAssets, 'textures')
const cache = join(cacheRoot, 'textures')
type Texture = {
	id: string
	source: string
	name: string
	size: number
	/** to pull a too-bright or too-colourful photo toward the game's worn, muted look */
	saturation?: number
	brightness?: number
}
const { textures } = JSON.parse(readFileSync(join(here, 'texture-sources.json'), 'utf8')) as { textures: Texture[] }
mkdirSync(cache, { recursive: true })

const maps = { color: 'Color', normal: 'NormalGL', rough: 'Roughness' } as const

for (const texture of textures) {
	const folder = join(cache, texture.source)
	if (!existsSync(folder)) {
		const response = await fetch(`https://ambientcg.com/get?file=${texture.source}_1K-JPG.zip`)
		if (!response.ok) throw new Error(`${texture.source}: download failed (${response.status})`)
		const zip = `${folder}.zip`
		writeFileSync(zip, Buffer.from(await response.arrayBuffer()))
		execFileSync('unzip', ['-q', '-o', zip, '-d', folder])
	}
	const files = readdirSync(folder)
	const target = join(out, texture.id)
	mkdirSync(target, { recursive: true })
	for (const [name, suffix] of Object.entries(maps)) {
		const file = files.find(entry => entry.endsWith(`_${suffix}.jpg`))
		if (!file) throw new Error(`${texture.source}: no ${suffix} map`)
		const image = sharp(join(folder, file)).resize(texture.size, texture.size)
		if (name === 'color' && (texture.saturation || texture.brightness))
			image.modulate({ saturation: texture.saturation ?? 1, brightness: texture.brightness ?? 1 })
		await image.webp({ quality: name === 'color' ? 80 : 85 }).toFile(join(target, `${name}.webp`))
	}
	process.stdout.write(`${texture.id}: ${texture.source}\n`)
}

const credits = textures.map(texture => ({
	name: texture.name,
	author: 'ambientCG (Lennart Demes)',
	page: `https://ambientcg.com/view?id=${texture.source}`,
	licence: 'CC0 1.0'
}))
writeFileSync(join(out, 'credits.json'), `${JSON.stringify({ textures: credits }, null, '\t')}\n`)
