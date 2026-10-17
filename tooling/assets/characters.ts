// Builds the player characters: `pnpm assets:characters` (the gear needs SKETCHFAB_API_TOKEN).
// One CC0 body from Quaternius' Universal Base Characters, repainted per class into a uniform
// (shirt, trousers, gloves, boots), with CC BY gear from Sketchfab fixed to its bones and the CC0
// Universal Animation Library's clips moved onto its skeleton by bone name. The result is one
// soldier.glb holding all three classes: nodes named `<class>-…` belong to that class only.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	type Document,
	MathUtils,
	type Mesh,
	type mat4,
	type Node,
	NodeIO,
	type Skin,
	type Texture
} from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
	dedup,
	flatten,
	getBounds,
	mergeDocuments,
	meshopt,
	prune,
	resample,
	simplify,
	textureCompress,
	unpartition,
	weld
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { itchDownload, publicAssets, sketchfabModel } from './sources.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(publicAssets, 'models', 'characters')
mkdirSync(out, { recursive: true })

type Pack = { creator: string; game: string; file: string; name: string; author: string; page: string; licence: string }
type Gear = {
	uid: string
	name: string
	author: string
	/** keep only these mesh nodes (for packs holding several items) */
	nodes?: string[]
	joint: string
	/** metres from the joint, in the character's space (+Y up, +Z forward) */
	offset: [number, number, number]
	/** degrees, applied to the gear before it is placed */
	rotation: [number, number, number]
	/** the gear's largest side, in metres */
	size: number
	triangles: number
	/** multiplies the gear's colours, to bring a too-clean item into the uniform's tones */
	tint?: [number, number, number]
}
type Look = { shirt: string; trousers: string; armband?: string; gear: string[] }
const config = JSON.parse(readFileSync(join(here, 'character-sources.json'), 'utf8')) as {
	body: Pack & { gltf: string }
	animations: Pack & { glb: string; clips: string[] }
	classes: Record<string, Look>
	gear: Record<string, Gear>
}

await MeshoptSimplifier.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

// ---- small matrix helpers (column-major, like glTF) ----

function multiply(a: mat4, b: mat4): mat4 {
	const out = new Array(16).fill(0) as unknown as mat4
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0
			for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number)
			out[c * 4 + r] = sum
		}
	return out
}

function invert(m: mat4): mat4 {
	const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m as unknown as number[]
	const b00 = a00 * a11 - a01 * a10
	const b01 = a00 * a12 - a02 * a10
	const b02 = a00 * a13 - a03 * a10
	const b03 = a01 * a12 - a02 * a11
	const b04 = a01 * a13 - a03 * a11
	const b05 = a02 * a13 - a03 * a12
	const b06 = a20 * a31 - a21 * a30
	const b07 = a20 * a32 - a22 * a30
	const b08 = a20 * a33 - a23 * a30
	const b09 = a21 * a32 - a22 * a31
	const b10 = a21 * a33 - a23 * a31
	const b11 = a22 * a33 - a23 * a32
	const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06)
	return [
		(a11 * b11 - a12 * b10 + a13 * b09) * det,
		(a02 * b10 - a01 * b11 - a03 * b09) * det,
		(a31 * b05 - a32 * b04 + a33 * b03) * det,
		(a22 * b04 - a21 * b05 - a23 * b03) * det,
		(a12 * b08 - a10 * b11 - a13 * b07) * det,
		(a00 * b11 - a02 * b08 + a03 * b07) * det,
		(a32 * b02 - a30 * b05 - a33 * b01) * det,
		(a20 * b05 - a22 * b02 + a23 * b01) * det,
		(a10 * b10 - a11 * b08 + a13 * b06) * det,
		(a01 * b08 - a00 * b10 - a03 * b06) * det,
		(a30 * b04 - a31 * b02 + a33 * b00) * det,
		(a21 * b02 - a20 * b04 - a23 * b00) * det,
		(a11 * b07 - a10 * b09 - a12 * b06) * det,
		(a00 * b09 - a01 * b07 + a02 * b06) * det,
		(a31 * b01 - a30 * b03 - a32 * b00) * det,
		(a20 * b03 - a21 * b01 + a22 * b00) * det
	] as unknown as mat4
}

/** Quaternion from Euler angles in degrees (XYZ order, like three.js). */
function quaternion([x, y, z]: [number, number, number]): [number, number, number, number] {
	const [hx, hy, hz] = [x, y, z].map(angle => (angle * Math.PI) / 360) as [number, number, number]
	const [c1, c2, c3, s1, s2, s3] = [Math.cos(hx), Math.cos(hy), Math.cos(hz), Math.sin(hx), Math.sin(hy), Math.sin(hz)]
	return [
		s1 * c2 * c3 + c1 * s2 * s3,
		c1 * s2 * c3 - s1 * c2 * s3,
		c1 * c2 * s3 + s1 * s2 * c3,
		c1 * c2 * c3 - s1 * s2 * s3
	]
}

// ---- the body ----

const bodyFolder = await itchDownload(config.body.creator, config.body.game, config.body.file)
const bodyFile = join(bodyFolder, config.body.gltf)
// the pack's glTF names a few textures with an extra "_png" that are not in the archive
const bodyJson = JSON.parse(readFileSync(bodyFile, 'utf8')) as { images?: { uri?: string }[] }
for (const image of bodyJson.images ?? []) {
	if (!image.uri) continue
	const wanted = join(dirname(bodyFile), decodeURIComponent(image.uri))
	const plain = wanted.replace(/_png\.png$/, '.png')
	if (!existsSync(wanted) && existsSync(plain)) copyFileSync(plain, wanted)
}
const document = await io.read(bodyFile)
const root = document.getRoot()
const scene = root.getDefaultScene() ?? (root.listScenes()[0] as NonNullable<ReturnType<typeof root.getDefaultScene>>)
const skin = root.listSkins()[0] as Skin
const joints = new Map(skin.listJoints().map(joint => [joint.getName(), joint]))

// hair would show under the helmets: drop it
for (const node of root.listNodes()) if (/eyebrow|hair/i.test(node.getName())) node.dispose()
const bodyNode = root.listNodes().find(node => node.getSkin() && /superhero/i.test(node.getName())) as Node
const bodyMesh = bodyNode.getMesh() as Mesh
const eyes = root.listNodes().find(node => /eyes/i.test(node.getName()))
eyes?.setName('eyes')

const Region = { none: 0, skin: 1, glove: 2, boot: 3, trousers: 4, shirt: 5, armband: 6 } as const

/** Which part of the uniform each texel of the body texture belongs to, from the bones that move it. */
function regions(width: number, height: number): Uint8Array {
	const primitive = bodyMesh.listPrimitives()[0]
	if (!primitive) throw new Error('the body has no mesh')
	const position = primitive.getAttribute('POSITION')
	const uv = primitive.getAttribute('TEXCOORD_0')
	const jointsOf = primitive.getAttribute('JOINTS_0')
	const weights = primitive.getAttribute('WEIGHTS_0')
	const indices = primitive.getIndices()
	if (!position || !uv || !jointsOf || !weights || !indices) throw new Error('the body is missing skinning data')
	const names = skin.listJoints().map(joint => joint.getName())
	const count = position.getCount()
	const [minY, maxY] = [position.getMin([])[1] as number, position.getMax([])[1] as number]
	const p: number[] = []
	const j: number[] = []
	const w: number[] = []
	// the left upper arm's extent along the arm, for the medic's armband
	let armMin = Number.POSITIVE_INFINITY
	let armMax = Number.NEGATIVE_INFINITY
	const dominant = new Array<string>(count)
	for (let v = 0; v < count; v++) {
		jointsOf.getElement(v, j)
		weights.getElement(v, w)
		let best = 0
		for (let k = 1; k < 4; k++) if ((w[k] as number) > (w[best] as number)) best = k
		dominant[v] = names[j[best] as number] ?? ''
		if (dominant[v] === 'upperarm_l') {
			position.getElement(v, p)
			armMin = Math.min(armMin, p[0] as number)
			armMax = Math.max(armMax, p[0] as number)
		}
	}
	const vertex = new Uint8Array(count)
	for (let v = 0; v < count; v++) {
		const name = dominant[v] as string
		position.getElement(v, p)
		const height = ((p[1] as number) - minY) / (maxY - minY)
		const along = ((p[0] as number) - armMin) / (armMax - armMin)
		vertex[v] = /^(Head|neck_01)$/.test(name)
			? Region.skin
			: /hand|index|middle|pinky|ring|thumb/.test(name)
				? Region.glove
				: /foot|ball/.test(name) || (/calf/.test(name) && height < 0.12)
					? Region.boot
					: /pelvis|thigh|calf|root/.test(name)
						? Region.trousers
						: name === 'upperarm_l' && along > 0.4 && along < 0.65
							? Region.armband
							: Region.shirt
	}
	const map = new Uint8Array(width * height)
	const a: number[] = []
	const b: number[] = []
	const c: number[] = []
	for (let t = 0; t < indices.getCount(); t += 3) {
		const [i0, i1, i2] = [indices.getScalar(t), indices.getScalar(t + 1), indices.getScalar(t + 2)]
		const votes = [vertex[i0] as number, vertex[i1] as number, vertex[i2] as number]
		const region = votes[1] === votes[2] ? (votes[1] as number) : (votes[0] as number)
		uv.getElement(i0, a)
		uv.getElement(i1, b)
		uv.getElement(i2, c)
		const [ax, ay, bx, by, cx, cy] = [
			(a[0] as number) * width,
			(a[1] as number) * height,
			(b[0] as number) * width,
			(b[1] as number) * height,
			(c[0] as number) * width,
			(c[1] as number) * height
		]
		const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
		if (Math.abs(area) < 1e-9) continue
		const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
		const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
		const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
		const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const px = x + 0.5
				const py = y + 0.5
				const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area
				const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area
				const w2 = 1 - w0 - w1
				if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) map[y * width + x] = region
			}
	}
	// grow every island a few texels so filtering at the seams never reaches unpainted texels
	for (let pass = 0; pass < 6; pass++) {
		const copy = map.slice()
		for (let y = 1; y < height - 1; y++)
			for (let x = 1; x < width - 1; x++) {
				const i = y * width + x
				if (copy[i]) continue
				map[i] = copy[i - 1] || copy[i + 1] || copy[i - width] || copy[i + width] || 0
			}
	}
	return map
}

function hex(colour: string): [number, number, number] {
	const value = Number.parseInt(colour.slice(1), 16)
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** Cheap repeatable noise for cloth grain, 0..1. */
function grain(x: number, y: number): number {
	let h = (x * 374761393 + y * 668265263) | 0
	h = Math.imul(h ^ (h >>> 13), 1274126177)
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

async function raw(texture: Texture) {
	const { data, info } = await sharp(texture.getImage() as Uint8Array)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true })
	return { data, width: info.width, height: info.height }
}

async function png(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
	return new Uint8Array(
		await sharp(data, { raw: { width, height, channels: 4 } })
			.png()
			.toBuffer()
	)
}

const bodyMaterial = bodyMesh.listPrimitives()[0]?.getMaterial()
if (!bodyMaterial) throw new Error('the body has no material')
const base = await raw(bodyMaterial.getBaseColorTexture() as Texture)
const map = regions(base.width, base.height)

// cloth is rough and flatter than the skin it is painted over
const metalRough = bodyMaterial.getMetallicRoughnessTexture()
if (metalRough) {
	const image = await raw(metalRough)
	for (let i = 0; i < image.width * image.height; i++) {
		const x = Math.floor(((i % image.width) * base.width) / image.width)
		const y = Math.floor((Math.floor(i / image.width) * base.height) / image.height)
		const region = map[y * base.width + x] ?? 0
		if (region > Region.skin) {
			image.data[i * 4 + 1] = region === Region.glove || region === Region.boot ? 200 : 235
			image.data[i * 4 + 2] = 0
		}
	}
	metalRough.setImage(await png(image.data, image.width, image.height)).setMimeType('image/png')
}
const normal = bodyMaterial.getNormalTexture()
if (normal) {
	const image = await raw(normal)
	for (let i = 0; i < image.width * image.height; i++) {
		const x = Math.floor(((i % image.width) * base.width) / image.width)
		const y = Math.floor((Math.floor(i / image.width) * base.height) / image.height)
		if ((map[y * base.width + x] ?? 0) > Region.skin) {
			image.data[i * 4] = Math.round((image.data[i * 4] as number) * 0.2 + 128 * 0.8)
			image.data[i * 4 + 1] = Math.round((image.data[i * 4 + 1] as number) * 0.2 + 128 * 0.8)
			image.data[i * 4 + 2] = Math.round((image.data[i * 4 + 2] as number) * 0.2 + 255 * 0.8)
		}
	}
	normal
		.setImage(await png(image.data, image.width, image.height))
		.setMimeType('image/png')
		.setName('body-normal')
}
metalRough?.setName('body-rough')

// mean brightness of each region, so the painted cloth keeps the body's folds and shading but not its tone
const sums = new Float64Array(8)
const counts = new Float64Array(8)
const luminance = (i: number) =>
	0.2126 * (base.data[i * 4] as number) +
	0.7152 * (base.data[i * 4 + 1] as number) +
	0.0722 * (base.data[i * 4 + 2] as number)
for (let i = 0; i < base.width * base.height; i++) {
	const region = map[i] as number
	sums[region] = (sums[region] as number) + luminance(i)
	counts[region] = (counts[region] as number) + 1
}

const primitive = bodyMesh.listPrimitives()[0] as NonNullable<ReturnType<Mesh['listPrimitives']>[number]>
for (const [id, look] of Object.entries(config.classes)) {
	const colours: Record<number, [number, number, number]> = {
		[Region.glove]: [30, 31, 29],
		[Region.boot]: [38, 33, 28],
		[Region.trousers]: hex(look.trousers),
		[Region.shirt]: hex(look.shirt),
		[Region.armband]: hex(look.armband ?? look.shirt)
	}
	const data = Buffer.from(base.data)
	for (let i = 0; i < base.width * base.height; i++) {
		const region = map[i] as number
		const colour = colours[region]
		if (!colour) continue
		const mean = (sums[region] as number) / Math.max(1, counts[region] as number)
		const shade = Math.min(1.12, Math.max(0.85, (luminance(i) / Math.max(1, mean)) ** 0.25))
		const x = i % base.width
		const y = Math.floor(i / base.width)
		// fine weave plus a coarser mottling
		const noise = 0.92 + 0.1 * grain(x, y) + 0.08 * grain(x >> 3, y >> 3)
		for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.min(255, Math.round((colour[k] as number) * shade * noise))
	}
	const texture = document
		.createTexture(`body-${id}`)
		.setImage(await png(data, base.width, base.height))
		.setMimeType('image/png')
	const material = bodyMaterial.clone().setName(`${id}-body`).setBaseColorTexture(texture)
	const mesh = document.createMesh(`${id}-body`).addPrimitive(primitive.clone().setMaterial(material))
	const node = document.createNode(`${id}-body`).setMesh(mesh).setSkin(skin)
	node.setTranslation(bodyNode.getTranslation()).setRotation(bodyNode.getRotation()).setScale(bodyNode.getScale())
	;(bodyNode.getParentNode() ?? scene).addChild(node)
}
;(bodyMaterial.getBaseColorTexture() as Texture).setName('body-skin')
bodyNode.dispose()
bodyMesh.dispose()

// ---- gear ----

const credits: { name: string; author: string; page: string; licence: string }[] = [
	{ name: config.body.name, author: config.body.author, page: config.body.page, licence: config.body.licence },
	{
		name: config.animations.name,
		author: config.animations.author,
		page: config.animations.page,
		licence: config.animations.licence
	}
]
const used = new Set(Object.values(config.classes).flatMap(look => look.gear))
for (const [id, gear] of Object.entries(config.gear)) {
	if (!used.has(id)) continue
	const source = await io.read(await sketchfabModel(gear.uid))
	const sourceRoot = source.getRoot()
	if (gear.nodes) {
		const keep = gear.nodes
		for (const node of sourceRoot.listNodes())
			if (node.getMesh() && !keep.some(name => node.getName().startsWith(name))) node.setMesh(null)
	}
	await source.transform(flatten(), prune(), weld())
	const triangles = sourceRoot
		.listMeshes()
		.reduce(
			(sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0),
			0
		)
	if (triangles > gear.triangles)
		await source.transform(simplify({ simplifier: MeshoptSimplifier, ratio: gear.triangles / triangles, error: 0.06 }))
	for (const [index, texture] of sourceRoot.listTextures().entries()) texture.setName(`gear-${id}-${index}`)
	// some sources rely on Sketchfab's two-sided rendering (shells seen from outside vanish otherwise)
	for (const material of sourceRoot.listMaterials()) material.setDoubleSided(true)
	if (gear.tint) {
		const [r, g, b] = gear.tint
		for (const material of sourceRoot.listMaterials()) {
			const [cr, cg, cb, ca] = material.getBaseColorFactor()
			material.setBaseColorFactor([cr * r, cg * g, cb * b, ca])
		}
	}
	const sourceScene = sourceRoot.getDefaultScene() ?? sourceRoot.listScenes()[0]
	if (!sourceScene) continue
	const { min, max } = getBounds(sourceScene)
	const scale = gear.size / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
	const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as [number, number, number]

	const map = mergeDocuments(document, source)
	const merged = map.get(sourceScene) as typeof scene
	const joint = joints.get(gear.joint)
	if (!joint) throw new Error(`${id}: no joint ${gear.joint}`)
	const jointWorld = joint.getWorldMatrix()
	const at = [jointWorld[12] + gear.offset[0], jointWorld[13] + gear.offset[1], jointWorld[14] + gear.offset[2]] as [
		number,
		number,
		number
	]
	// where the gear should sit in the character's space, then the same relative to the joint
	const placed = multiply(
		MathUtils.compose(at, quaternion(gear.rotation), [scale, scale, scale], [] as unknown as mat4),
		MathUtils.compose([-centre[0], -centre[1], -centre[2]], [0, 0, 0, 1], [1, 1, 1], [] as unknown as mat4)
	)
	const local = multiply(invert(jointWorld), placed)
	const t: [number, number, number] = [0, 0, 0]
	const r: [number, number, number, number] = [0, 0, 0, 1]
	const s: [number, number, number] = [1, 1, 1]
	MathUtils.decompose(local, t, r, s)
	const parts = merged.listChildren()
	let first = true
	for (const [look, entry] of Object.entries(config.classes)) {
		if (!entry.gear.includes(id)) continue
		const wrapper = document.createNode(`${look}-${id}`).setTranslation(t).setRotation(r).setScale(s)
		for (const part of parts) wrapper.addChild(first ? part : part.clone())
		joint.addChild(wrapper)
		first = false
	}
	merged.dispose()
	if (!credits.some(credit => credit.page.endsWith(gear.uid)))
		credits.push({
			name: gear.name,
			author: gear.author,
			page: `https://sketchfab.com/3d-models/${gear.uid}`,
			licence: 'CC BY 4.0'
		})
	process.stdout.write(`${id}: ${Math.min(triangles, gear.triangles)} triangles\n`)
}

// ---- animations ----

const animationFolder = await itchDownload(config.animations.creator, config.animations.game, config.animations.file)
const library = await io.read(join(animationFolder, config.animations.glb))
const libraryRoot = library.getRoot()
for (const animation of libraryRoot.listAnimations()) {
	if (!config.animations.clips.includes(animation.getName())) {
		// samplers outlive their animation and would keep its keyframes in the file
		for (const sampler of animation.listSamplers()) sampler.dispose()
		animation.dispose()
		continue
	}
	for (const channel of animation.listChannels()) {
		const path = channel.getTargetPath()
		const name = channel.getTargetNode()?.getName() ?? ''
		// bones keep this body's lengths: only rotations move, plus the hips' height and sway. Fingers
		// move only in the gun clips (the grip); a top-down camera cannot see them otherwise.
		const finger = /^(index|middle|pinky|ring|thumb)_/.test(name)
		if (
			path === 'scale' ||
			(path === 'translation' && name !== 'pelvis') ||
			(finger && !animation.getName().startsWith('Pistol_'))
		) {
			channel.getSampler()?.dispose()
			channel.dispose()
		}
	}
}
const libraryScenes = libraryRoot.listScenes()
const mergedLibrary = mergeDocuments(document, library)
for (const animation of root.listAnimations())
	for (const channel of animation.listChannels()) {
		const target = channel.getTargetNode()
		const own = target && joints.get(target.getName())
		if (own && own !== target) channel.setTargetNode(own)
	}
for (const libraryScene of libraryScenes) {
	const merged = mergedLibrary.get(libraryScene) as typeof scene
	for (const node of merged.listChildren()) node.traverse(child => child.dispose())
	merged.dispose()
}
root.setDefaultScene(scene)

await document.transform(
	// every merged source brought its own buffer; a .glb holds one
	unpartition(),
	resample(),
	dedup(),
	prune(),
	textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80, pattern: /^gear-/ }),
	textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82, pattern: /^body-/ }),
	// what is left (the eyes) is small
	textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 80, formats: /png|jpe?g/ }),
	// quantised and packed vertices and keyframes (the client loads it with the meshopt decoder)
	meshopt({ encoder: MeshoptEncoder, level: 'medium' })
)
const target = join(out, 'soldier.glb')
writeFileSync(target, await io.writeBinary(document as Document))
writeFileSync(join(out, 'credits.json'), `${JSON.stringify({ models: credits }, null, '\t')}\n`)
process.stdout.write(
	`soldier: ${(readFileSync(target).byteLength / 1024).toFixed(0)} KB, ${root.listAnimations().length} clips\n`
)
