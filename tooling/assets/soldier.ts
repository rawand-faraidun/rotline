// Builds the soldier: `pnpm assets:characters` (needs SKETCHFAB_API_TOKEN for the models).
//
// A realistic CC0 operator (britdawgmasterfunk's "Devgru 2": face, hands, combat shirt and trousers,
// boots, plate carrier, helmet) is skinned onto the Universal Animation Library skeleton (see rig.ts),
// and the extra helmets, vests and packs from Sketchfab are fixed to its bones. The other classes'
// people (whole figures) are skinned the same way, each with its own bind pose, named `person-<class>`. Every piece is its own
// node named `<slot>-<id>` (head, vest, body, legs, feet, pack, skin): the game shows the pieces a
// player wears and tints them. The library's clips are moved onto the skeleton by bone name.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Accessor, MathUtils, type mat4, type Node, NodeIO, type Scene, type Skin } from '@gltf-transform/core'
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
	simplifyPrimitive,
	textureCompress,
	unpartition,
	weld
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mergeClips } from './clips.ts'
import { bindMesh, invert, jointPosition, multiply, PointGrid, poseBody, turnJoint } from './rig.ts'
import { itchDownload, plainMaterials, publicAssets, sketchfabModel } from './sources.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(publicAssets, 'models', 'characters')
mkdirSync(out, { recursive: true })

type Part = { material: string; id: string; joint?: string; stiffFingers?: boolean; triangles?: number }
type Gear = {
	uid: string
	name: string
	author: string
	nodes?: string[]
	joint: string
	offset: [number, number, number]
	rotation: [number, number, number]
	size: number
	triangles: number
	tint?: [number, number, number]
}
type Person = {
	id: string
	uid: string
	name: string
	author: string
	licence: string
	material: string
	triangles: number
}
type Pack = { creator: string; game: string; file: string; name: string; author: string; page: string; licence: string }
const config = JSON.parse(readFileSync(join(here, 'soldier-sources.json'), 'utf8')) as {
	skeleton: Pack & { gltf: string }
	animations: Pack & { glb: string; clips: string[] }
	operator: { uid: string; name: string; author: string; parts: Part[] }
	people: Person[]
	gear: Record<string, Gear>
}

await MeshoptSimplifier.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

const triangles = (node: Node) =>
	node
		.getMesh()
		?.listPrimitives()
		.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0) ?? 0

// ---- the skeleton, bent into the operator's pose ----

const skeletonFile = join(
	await itchDownload(config.skeleton.creator, config.skeleton.game, config.skeleton.file),
	config.skeleton.gltf
)
// the pack's glTF names a few textures with an extra "_png" that are not in the archive
const skeletonJson = JSON.parse(readFileSync(skeletonFile, 'utf8')) as { images?: { uri?: string }[] }
for (const image of skeletonJson.images ?? []) {
	if (!image.uri) continue
	const wanted = join(dirname(skeletonFile), decodeURIComponent(image.uri))
	const plain = wanted.replace(/_png\.png$/, '.png')
	if (!existsSync(wanted) && existsSync(plain)) copyFileSync(plain, wanted)
}
const document = await io.read(skeletonFile)
const root = document.getRoot()
const scene = (root.getDefaultScene() ?? root.listScenes()[0]) as Scene
const baseSkin = root.listSkins()[0] as Skin
const jointList = baseSkin.listJoints()
const joints = new Map(jointList.map(joint => [joint.getName(), joint]))
const baseBind = jointList.map(
	(_, index) => Array.from((baseSkin.getInverseBindMatrices() as Accessor).getElement(index, [])) as unknown as mat4
)
const bodyNode = root.listNodes().find(node => node.getSkin() && /superhero/i.test(node.getName())) as Node
const bodyPrimitive = bodyNode.getMesh()?.listPrimitives()[0]
if (!bodyPrimitive) throw new Error('the base body has no mesh')

const operator = await io.read(await sketchfabModel(config.operator.uid))
const operatorRoot = operator.getRoot()
const partOf = (node: Node) => {
	const material = node.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() ?? ''
	return config.operator.parts.find(part => new RegExp(part.material).test(material))
}

// the skeleton's own arms, before they are bent to any model's
const arms = ['upperarm_l', 'upperarm_r'].map(name => joints.get(name) as Node)
const restArms = arms.map(arm => [...arm.getRotation()] as [number, number, number, number])

// arms down to the operator's: aim each upper arm at where the operator's hand is
{
	const hands = operatorRoot.listNodes().find(node => partOf(node)?.id === 'skin-hands')
	if (!hands) throw new Error('the operator has no hands')
	const world = hands.getWorldMatrix()
	const position = hands.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION') as Accessor
	const p: number[] = []
	let sumX = 0
	let sumY = 0
	let count = 0
	for (let v = 0; v < position.getCount(); v++) {
		position.getElement(v, p)
		const x =
			(world[0] as number) * (p[0] as number) +
			(world[4] as number) * (p[1] as number) +
			(world[8] as number) * (p[2] as number) +
			(world[12] as number)
		const y =
			(world[1] as number) * (p[0] as number) +
			(world[5] as number) * (p[1] as number) +
			(world[9] as number) * (p[2] as number) +
			(world[13] as number)
		if (x < 0.3) continue
		sumX += x
		sumY += y
		count++
	}
	const shoulder = jointPosition(joints.get('upperarm_l') as Node)
	const angle = Math.atan2(shoulder[1] - sumY / count, sumX / count - shoulder[0])
	turnJoint(joints.get('upperarm_l') as Node, [0, 0, 1], -angle)
	turnJoint(joints.get('upperarm_r') as Node, [0, 0, 1], angle)
	process.stdout.write(`arms lowered ${((angle * 180) / Math.PI).toFixed(1)}°\n`)
}
const posed = poseBody(bodyPrimitive, baseSkin, baseBind)
const grid = new PointGrid(posed.positions, posed.count, 0.03)

// the posed skeleton is the bind pose of everything the soldier wears
const skin = document.createSkin('soldier').setSkeleton(baseSkin.getSkeleton())
for (const joint of jointList) skin.addJoint(joint)
const bind = new Float32Array(jointList.length * 16)
for (const [index, joint] of jointList.entries())
	bind.set(invert(joint.getWorldMatrix()) as unknown as number[], index * 16)
skin.setInverseBindMatrices(
	document
		.createAccessor('bind')
		.setType('MAT4')
		.setArray(bind)
		.setBuffer(root.listBuffers()[0] ?? null)
)

// ---- the operator's pieces ----

for (const node of operatorRoot.listNodes()) {
	const part = partOf(node)
	if (node.getMesh() && (!part || part.id === 'drop')) node.setMesh(null)
}
for (const node of operatorRoot.listNodes()) {
	const part = partOf(node)
	const limit = part?.triangles
	const mesh = node.getMesh()
	if (!part || !mesh || !limit) continue
	const count = triangles(node)
	if (count > limit) {
		// simplify this piece alone: a scratch document would lose its place, so work on its primitives
		for (const primitive of mesh.listPrimitives()) {
			simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio: limit / count, error: 0.01 })
		}
	}
}
const operatorScenes = operatorRoot.listScenes()
const merged = mergeDocuments(document, operator)
for (const source of operatorRoot.listNodes()) {
	const part = partOf(source)
	if (!part || part.id === 'drop' || !source.getMesh()) continue
	const node = merged.get(source) as Node
	bindMesh(
		document,
		node,
		skin,
		posed,
		part.joint ? { kind: 'rigid', joint: part.joint } : { kind: 'transfer', stiffFingers: part.stiffFingers ?? false },
		grid
	)
	node.getParentNode()?.removeChild(node)
	for (const sceneOf of root.listScenes()) sceneOf.removeChild(node)
	scene.addChild(node)
	node.setName(part.id)
	for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
		const material = primitive.getMaterial()
		material?.setName(part.id)
		// the game tints worn pieces: the paint must start from white
		material?.setBaseColorFactor([1, 1, 1, 1])
		material?.getBaseColorTexture()?.setName(`piece-${part.id}`)
	}
}
for (const sceneOf of operatorScenes) {
	const copy = merged.get(sceneOf) as Scene
	for (const child of copy.listChildren()) child.traverse(node => node.dispose())
	copy.dispose()
}
// ---- the other classes' people: each a whole figure (face, clothes, boots), bound in its own pose ----

const operatorArms = arms.map(arm => [...arm.getRotation()] as [number, number, number, number])
// where the operator's head is (the helmets were placed on it): its top, and the middle of its top 20 cm
const operatorHead = (() => {
	const face = scene.listChildren().find(node => node.getName() === 'skin-face')
	const position = face?.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION')
	if (!position) throw new Error('the operator has no face')
	const p: number[] = []
	let top = 0
	for (let v = 0; v < position.getCount(); v++) top = Math.max(top, position.getElement(v, p)[1] as number)
	let x = 0
	let z = 0
	let count = 0
	for (let v = 0; v < position.getCount(); v++) {
		position.getElement(v, p)
		if ((p[1] as number) < top - 0.2) continue
		x += p[0] as number
		z += p[2] as number
		count++
	}
	return { top, x: x / count, z: z / count }
})()
const point = (m: mat4, p: number[]): [number, number, number] => [
	(m[0] as number) * (p[0] as number) +
		(m[4] as number) * (p[1] as number) +
		(m[8] as number) * (p[2] as number) +
		(m[12] as number),
	(m[1] as number) * (p[0] as number) +
		(m[5] as number) * (p[1] as number) +
		(m[9] as number) * (p[2] as number) +
		(m[13] as number),
	(m[2] as number) * (p[0] as number) +
		(m[6] as number) * (p[1] as number) +
		(m[10] as number) * (p[2] as number) +
		(m[14] as number)
]
const people: Person[] = config.people
for (const person of people) {
	const source = await io.read(await sketchfabModel(person.uid))
	const sourceRoot = source.getRoot()
	const pattern = new RegExp(person.material)
	const kept = sourceRoot
		.listNodes()
		.filter(node => pattern.test(node.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() ?? ''))
	if (kept.length === 0) throw new Error(`${person.id}: nothing matches ${person.material}`)
	for (const node of sourceRoot.listNodes()) if (node.getMesh() && !kept.includes(node)) node.setMesh(null)
	// stand the figure on the ground as tall as the operator, its head where the operator's is
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
	const p: number[] = []
	for (const node of kept) {
		node.setSkin(null)
		const world = node.getWorldMatrix()
		for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
			primitive.setAttribute('JOINTS_0', null).setAttribute('WEIGHTS_0', null)
			const position = primitive.getAttribute('POSITION') as Accessor
			for (let v = 0; v < position.getCount(); v++) {
				const at = point(world, position.getElement(v, p))
				for (let i = 0; i < 3; i++) {
					min[i] = Math.min(min[i] as number, at[i] as number)
					max[i] = Math.max(max[i] as number, at[i] as number)
				}
			}
		}
	}
	const scale = operatorHead.top / ((max[1] as number) - (min[1] as number))
	let headX = 0
	let headZ = 0
	let headCount = 0
	for (const node of kept) {
		const world = node.getWorldMatrix()
		for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
			const position = primitive.getAttribute('POSITION') as Accessor
			for (let v = 0; v < position.getCount(); v++) {
				const at = point(world, position.getElement(v, p))
				if (at[1] < (max[1] as number) - 0.2 / scale) continue
				headX += at[0]
				headZ += at[2]
				headCount++
			}
		}
	}
	const fit = MathUtils.compose(
		[
			operatorHead.x - (headX / headCount) * scale,
			-(min[1] as number) * scale,
			operatorHead.z - (headZ / headCount) * scale
		],
		[0, 0, 0, 1],
		[scale, scale, scale],
		[] as unknown as mat4
	)
	const sourceScene = (sourceRoot.getDefaultScene() ?? sourceRoot.listScenes()[0]) as Scene
	for (const node of kept) {
		const placed = multiply(fit, node.getWorldMatrix())
		node.getParentNode()?.removeChild(node)
		for (const sceneOf of sourceRoot.listScenes()) sceneOf.removeChild(node)
		sourceScene.addChild(node)
		node.setMatrix(placed)
		const count = triangles(node)
		if (count > person.triangles)
			for (const primitive of node.getMesh()?.listPrimitives() ?? [])
				simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio: person.triangles / count, error: 0.01 })
	}
	// arms bent to this figure's: aim each upper arm at its hand (the outermost few centimetres)
	for (const [index, arm] of arms.entries()) arm.setRotation(restArms[index] as [number, number, number, number])
	const reach = (max[0] as number) * scale + (fit[12] as number)
	let sumX = 0
	let sumY = 0
	let count = 0
	for (const node of kept) {
		const world = node.getMatrix()
		for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
			const position = primitive.getAttribute('POSITION') as Accessor
			for (let v = 0; v < position.getCount(); v++) {
				const at = point(world, position.getElement(v, p))
				if (at[0] < reach - 0.12) continue
				sumX += at[0]
				sumY += at[1]
				count++
			}
		}
	}
	const shoulder = jointPosition(joints.get('upperarm_l') as Node)
	const angle = Math.atan2(shoulder[1] - sumY / count, sumX / count - shoulder[0])
	turnJoint(joints.get('upperarm_l') as Node, [0, 0, 1], -angle)
	turnJoint(joints.get('upperarm_r') as Node, [0, 0, 1], angle)
	const personPosed = poseBody(bodyPrimitive, baseSkin, baseBind)
	const personSkin = document.createSkin(`person-${person.id}`).setSkeleton(baseSkin.getSkeleton())
	for (const joint of jointList) personSkin.addJoint(joint)
	const personBind = new Float32Array(jointList.length * 16)
	for (const [index, joint] of jointList.entries())
		personBind.set(invert(joint.getWorldMatrix()) as unknown as number[], index * 16)
	personSkin.setInverseBindMatrices(
		document
			.createAccessor(`bind-${person.id}`)
			.setType('MAT4')
			.setArray(personBind)
			.setBuffer(root.listBuffers()[0] ?? null)
	)
	const merged = mergeDocuments(document, source)
	for (const source of kept) {
		const node = merged.get(source) as Node
		bindMesh(document, node, personSkin, personPosed, { kind: 'transfer', stiffFingers: true })
		node.getParentNode()?.removeChild(node)
		for (const sceneOf of root.listScenes()) sceneOf.removeChild(node)
		scene.addChild(node)
		node.setName(`person-${person.id}`)
		for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
			const material = primitive.getMaterial()
			material?.setName(`person-${person.id}`)
			material?.getBaseColorTexture()?.setName(`piece-person-${person.id}`)
		}
	}
	for (const sceneOf of sourceRoot.listScenes()) {
		const copy = merged.get(sceneOf) as Scene
		for (const child of copy.listChildren()) child.traverse(node => node.dispose())
		copy.dispose()
	}
	process.stdout.write(`${person.id}: arms lowered ${((angle * 180) / Math.PI).toFixed(1)}°\n`)
}
for (const [index, arm] of arms.entries()) arm.setRotation(operatorArms[index] as [number, number, number, number])

// the base body was only the source of the weights
for (const node of root.listNodes()) if (node.getMesh() && node.getSkin() === baseSkin) node.dispose()
baseSkin.dispose()

// ---- gear from Sketchfab, fixed to bones ----

const credits: { name: string; author: string; page: string; licence: string }[] = [
	{
		name: config.operator.name,
		author: config.operator.author,
		page: `https://sketchfab.com/3d-models/${config.operator.uid}`,
		licence: 'CC0 1.0'
	},
	{
		name: config.skeleton.name,
		author: config.skeleton.author,
		page: config.skeleton.page,
		licence: config.skeleton.licence
	},
	{
		name: config.animations.name,
		author: config.animations.author,
		page: config.animations.page,
		licence: config.animations.licence
	}
]
for (const person of people)
	credits.push({
		name: person.name,
		author: person.author,
		page: `https://sketchfab.com/3d-models/${person.uid}`,
		licence: person.licence
	})
for (const [id, gear] of Object.entries(config.gear)) {
	const source = await io.read(await sketchfabModel(gear.uid))
	const sourceRoot = source.getRoot()
	if (gear.nodes) {
		const keep = gear.nodes
		for (const node of sourceRoot.listNodes())
			if (node.getMesh() && !keep.some(name => node.getName().startsWith(name))) node.setMesh(null)
	}
	await source.transform(flatten(), prune(), weld())
	const count = sourceRoot
		.listNodes()
		.filter(node => node.getMesh())
		.reduce((sum, node) => sum + triangles(node), 0)
	if (count > gear.triangles)
		await source.transform(simplify({ simplifier: MeshoptSimplifier, ratio: gear.triangles / count, error: 0.06 }))
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
	const centre: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
	const copies = mergeDocuments(document, source)
	const copy = copies.get(sourceScene) as Scene
	const joint = joints.get(gear.joint)
	if (!joint) throw new Error(`${id}: no joint ${gear.joint}`)
	const jointWorld = joint.getWorldMatrix()
	const at: [number, number, number] = [
		(jointWorld[12] as number) + gear.offset[0],
		(jointWorld[13] as number) + gear.offset[1],
		(jointWorld[14] as number) + gear.offset[2]
	]
	const [ex, ey, ez] = gear.rotation.map(angle => (angle * Math.PI) / 360) as [number, number, number]
	const rotation: [number, number, number, number] = [
		Math.sin(ex) * Math.cos(ey) * Math.cos(ez) + Math.cos(ex) * Math.sin(ey) * Math.sin(ez),
		Math.cos(ex) * Math.sin(ey) * Math.cos(ez) - Math.sin(ex) * Math.cos(ey) * Math.sin(ez),
		Math.cos(ex) * Math.cos(ey) * Math.sin(ez) + Math.sin(ex) * Math.sin(ey) * Math.cos(ez),
		Math.cos(ex) * Math.cos(ey) * Math.cos(ez) - Math.sin(ex) * Math.sin(ey) * Math.sin(ez)
	]
	// where the gear sits in the soldier's space, then the same relative to its joint
	const placed = multiply(
		MathUtils.compose(at, rotation, [scale, scale, scale], [] as unknown as mat4),
		MathUtils.compose([-centre[0], -centre[1], -centre[2]], [0, 0, 0, 1], [1, 1, 1], [] as unknown as mat4)
	)
	const local = multiply(invert(jointWorld), placed)
	const t: [number, number, number] = [0, 0, 0]
	const r: [number, number, number, number] = [0, 0, 0, 1]
	const s: [number, number, number] = [1, 1, 1]
	MathUtils.decompose(local, t, r, s)
	const wrapper = document.createNode(id).setTranslation(t).setRotation(r).setScale(s)
	for (const part of copy.listChildren()) wrapper.addChild(part)
	joint.addChild(wrapper)
	copy.dispose()
	if (!credits.some(credit => credit.page.endsWith(gear.uid)))
		credits.push({
			name: gear.name,
			author: gear.author,
			page: `https://sketchfab.com/3d-models/${gear.uid}`,
			licence: 'CC BY 4.0'
		})
	process.stdout.write(`${id}: ${Math.min(count, gear.triangles)} triangles\n`)
}

// ---- animations ----

await mergeClips(
	io,
	document,
	joints,
	{ animations: config.animations },
	config.animations.clips.map(clip => ({ pack: 'animations', clip, as: clip }))
)
root.setDefaultScene(scene)

plainMaterials(document)
await document.transform(
	// every merged source brought its own buffer; a .glb holds one
	unpartition(),
	resample(),
	dedup(),
	prune(),
	// close-ups in the lobby and armory: faces, clothes and gear keep their detail
	textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82, pattern: /^gear-/ }),
	textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 85, pattern: /^piece-/ }),
	textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80, formats: /png|jpe?g/ }),
	// quantised and packed vertices and keyframes (the client loads it with the meshopt decoder)
	meshopt({ encoder: MeshoptEncoder, level: 'medium' })
)
const target = join(out, 'soldier.glb')
writeFileSync(target, await io.writeBinary(document))
writeFileSync(join(out, 'credits.json'), `${JSON.stringify({ models: credits }, null, '\t')}\n`)
process.stdout.write(
	`soldier: ${(readFileSync(target).byteLength / 1024).toFixed(0)} KB, ${root.listAnimations().length} clips, ${root
		.listNodes()
		.filter(node => node.getMesh())
		.reduce((sum, node) => sum + triangles(node), 0)} triangles\n`
)
