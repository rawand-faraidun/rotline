// Builds the soldier: `pnpm assets:characters` (needs SKETCHFAB_API_TOKEN for the models).
//
// A kitted soldier (1799danly's "Soldier Full Tactical Gear", rigged in Character Creator: masked face,
// gloves, jacket, trousers, boots, helmet, plate carrier) keeps its own weights, moved bone by bone onto the
// Universal Animation Library skeleton, which is fitted to its joints (see rig.ts),
// and the extra helmets, vests and packs from Sketchfab are fixed to its bones. The other classes'
// figures are skinned the same way, each with its own bind pose. Every piece is its own
// node named `<slot>-<id>` (head, vest, body, legs, feet, pack, skin): the game shows the pieces a
// player wears and tints them. The library's clips are moved onto the skeleton by bone name.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	type Accessor,
	MathUtils,
	type mat4,
	type Node,
	NodeIO,
	type Primitive,
	type Scene,
	type Skin
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
	simplifyPrimitive,
	textureCompress,
	unpartition,
	weld
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mergeClips } from './clips.ts'
import { bakeToWorld, bindMesh, invert, jointPosition, multiply, PointGrid, poseBody, turnJoint } from './rig.ts'
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
type Figure = {
	id: string
	uid: string
	name: string
	author: string
	licence: string
	parts: Part[]
	/**
	 * the figure is rigged with a Character Creator skeleton: its own weights are kept (bone by bone
	 * onto ours) and our skeleton is fitted to its joints, instead of weights copied from a base body
	 */
	ownSkin?: 'character-creator'
}

/** Character Creator bones onto the animation skeleton's (by name; L/R are the character's own sides). */
const CC_BONES: [RegExp, string][] = [
	[/_(L|R)_(Upperarm)(Twist\d+)?_/, 'upperarm_$s'],
	[/_(L|R)_(Forearm(Twist\d+)?|ElbowShareBone)_/, 'lowerarm_$s'],
	[/_(L|R)_Hand_/, 'hand_$s'],
	[/_(L|R)_Clavicle_/, 'clavicle_$s'],
	[/_(L|R)_Index(\d)_/, 'index_0$2_$s'],
	[/_(L|R)_Mid(\d)_/, 'middle_0$2_$s'],
	[/_(L|R)_Ring(\d)_/, 'ring_0$2_$s'],
	[/_(L|R)_Pinky(\d)_/, 'pinky_0$2_$s'],
	[/_(L|R)_Thumb(\d)_/, 'thumb_0$2_$s'],
	[/_(L|R)_(Thigh(Twist\d+)?)_/, 'thigh_$s'],
	[/_(L|R)_(Calf(Twist\d+)?|KneeShareBone)_/, 'calf_$s'],
	[/_(L|R)_Foot_/, 'foot_$s'],
	[/_(L|R)_(ToeBase(ShareBone)?|\w+Toe\d)_/, 'ball_$s'],
	[/_(L|R)_(RibsTwist|Breast)_/, 'spine_03'],
	[/_(L|R)_Eye_/, 'Head'],
	[/_(Head|FacialBone|JawRoot|Tongue\d+|Teeth\d+|UpperJaw)_/, 'Head'],
	[/_NeckTwist\d+_/, 'neck_01'],
	[/_Spine02_/, 'spine_03'],
	[/_Spine01_/, 'spine_02'],
	[/_Waist_/, 'spine_01'],
	[/./, 'pelvis']
]
function ccBone(name: string): string {
	for (const [pattern, bone] of CC_BONES) {
		const match = pattern.exec(name)
		if (!match) continue
		const side = match[1] === 'L' ? 'l' : 'r'
		return bone.replace('$s', side).replace('$2', match[2] ?? '')
	}
	return 'pelvis'
}
/** where our joints are placed, from the Character Creator joints they stand for */
const CC_PLACES: Record<string, RegExp> = {
	pelvis: /_Hip_/,
	spine_01: /_Waist_/,
	spine_02: /_Spine01_/,
	spine_03: /_Spine02_/,
	neck_01: /_NeckTwist01_/,
	Head: /_Head_/,
	...Object.fromEntries(
		(['l', 'r'] as const).flatMap(side => {
			const S = side.toUpperCase()
			const at = (bone: string) => new RegExp(`_${S}_${bone}_`)
			return [
				[`clavicle_${side}`, at('Clavicle')],
				[`upperarm_${side}`, at('Upperarm')],
				[`lowerarm_${side}`, at('Forearm')],
				[`hand_${side}`, at('Hand')],
				[`thigh_${side}`, at('Thigh')],
				[`calf_${side}`, at('Calf')],
				[`foot_${side}`, at('Foot')],
				[`ball_${side}`, at('ToeBase')],
				...['Index', 'Mid', 'Ring', 'Pinky', 'Thumb'].flatMap(finger =>
					[1, 2, 3].map(n => [
						`${{ Index: 'index', Mid: 'middle', Ring: 'ring', Pinky: 'pinky', Thumb: 'thumb' }[finger]}_0${n}_${side}`,
						at(`${finger}${n}`)
					])
				)
			]
		})
	)
}
/** each joint's child that its bone points at */
const PRIMARY_CHILD: Record<string, string> = {
	pelvis: 'spine_01',
	spine_01: 'spine_02',
	spine_02: 'spine_03',
	spine_03: 'neck_01',
	neck_01: 'Head',
	...Object.fromEntries(
		(['l', 'r'] as const).flatMap(side => [
			[`clavicle_${side}`, `upperarm_${side}`],
			[`upperarm_${side}`, `lowerarm_${side}`],
			[`lowerarm_${side}`, `hand_${side}`],
			[`hand_${side}`, `middle_01_${side}`],
			[`thigh_${side}`, `calf_${side}`],
			[`calf_${side}`, `foot_${side}`],
			[`foot_${side}`, `ball_${side}`],
			...['index', 'middle', 'ring', 'pinky', 'thumb'].flatMap(finger => [
				[`${finger}_01_${side}`, `${finger}_02_${side}`],
				[`${finger}_02_${side}`, `${finger}_03_${side}`]
			])
		])
	)
}
type Pack = { creator: string; game: string; file: string; name: string; author: string; page: string; licence: string }
const config = JSON.parse(readFileSync(join(here, 'soldier-sources.json'), 'utf8')) as {
	skeleton: Pack & { gltf: string }
	animations: Pack & { glb: string; clips: string[] }
	/** the soldier kit (its parts are the worn pieces) and any whole figures, each skinned on its own */
	figures: Figure[]
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

// ---- the figures: the soldier kit, then any whole-figure people ----

// the base body as it stands (before any arm is bent): its height and where its head is
const restBody = poseBody(bodyPrimitive, baseSkin, baseBind)
const bodyHead = (() => {
	let top = 0
	for (let v = 0; v < restBody.count; v++) top = Math.max(top, restBody.positions[v * 3 + 1] as number)
	let x = 0
	let z = 0
	let count = 0
	for (let v = 0; v < restBody.count; v++) {
		if ((restBody.positions[v * 3 + 1] as number) < top - 0.2) continue
		x += restBody.positions[v * 3] as number
		z += restBody.positions[v * 3 + 2] as number
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
/** Every vertex of these (world-space, identity-transform) nodes. */
function* vertices(nodes: Node[]): Generator<[number, number, number]> {
	const p: number[] = []
	for (const node of nodes)
		for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
			const position = primitive.getAttribute('POSITION') as Accessor
			for (let v = 0; v < position.getCount(); v++) {
				position.getElement(v, p)
				yield [p[0] as number, p[1] as number, p[2] as number]
			}
		}
}

// the skeleton's own arms, before they are bent to any figure's
const arms = ['upperarm_l', 'upperarm_r'].map(name => joints.get(name) as Node)
const restArms = arms.map(arm => [...arm.getRotation()] as [number, number, number, number])
let firstArms: [number, number, number, number][] | null = null

/**
 * Fits the skeleton to a figure's joints (world positions by our joint names): each bone turned to
 * point where the figure's does and stretched to its length, and the bones off a chain (clavicles,
 * thighs, the thumb, fingers) moved to where the figure has them. The clips only turn bones, so the
 * new lengths stay.
 */
function fitSkeleton(places: Map<string, [number, number, number]>): void {
	const order: Node[] = []
	const walk = (node: Node) => {
		if (jointList.includes(node)) order.push(node)
		for (const child of node.listChildren()) walk(child)
	}
	walk(joints.get('pelvis') as Node)
	const setWorld = (node: Node, at: [number, number, number]) => {
		const parent = node.getParentNode()
		const inverse = parent
			? invert(parent.getWorldMatrix())
			: ([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as unknown as mat4)
		node.setTranslation(point(inverse, at))
	}
	const pelvisAt = places.get('pelvis')
	if (pelvisAt) setWorld(joints.get('pelvis') as Node, pelvisAt)
	for (const node of order) {
		const name = node.getName()
		const from = places.get(name)
		if (!from) continue
		const primary = PRIMARY_CHILD[name]
		for (const child of node.listChildren()) {
			const childName = child.getName()
			const to = places.get(childName)
			if (!to || childName === primary) continue
			setWorld(child, to)
		}
		const child = primary ? joints.get(primary) : undefined
		const to = primary ? places.get(primary) : undefined
		if (!child || !to) continue
		// turn the bone onto the figure's, then stretch it to the figure's length
		const here = jointPosition(node)
		const there = jointPosition(child)
		const now: [number, number, number] = [there[0] - here[0], there[1] - here[1], there[2] - here[2]]
		const want: [number, number, number] = [to[0] - here[0], to[1] - here[1], to[2] - here[2]]
		const nowLength = Math.hypot(...now)
		const wantLength = Math.hypot(...want)
		if (nowLength < 1e-6 || wantLength < 1e-6) continue
		const axis: [number, number, number] = [
			now[1] * want[2] - now[2] * want[1],
			now[2] * want[0] - now[0] * want[2],
			now[0] * want[1] - now[1] * want[0]
		]
		const axisLength = Math.hypot(...axis)
		if (axisLength > 1e-9) {
			const angle = Math.atan2(axisLength, now[0] * want[0] + now[1] * want[1] + now[2] * want[2])
			turnJoint(node, [axis[0] / axisLength, axis[1] / axisLength, axis[2] / axisLength], angle)
		}
		const t = child.getTranslation()
		const k = wantLength / nowLength
		child.setTranslation([t[0] * k, t[1] * k, t[2] * k])
	}
}

for (const figure of config.figures) {
	const source = await io.read(await sketchfabModel(figure.uid))
	const sourceRoot = source.getRoot()
	const partOf = (node: Node) => {
		const material = node.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() ?? ''
		return figure.parts.find(part => new RegExp(part.material).test(material))
	}
	const kept = sourceRoot.listNodes().filter(node => {
		const part = node.getMesh() ? partOf(node) : undefined
		return part !== undefined && part.id !== 'drop'
	})
	if (kept.length === 0) throw new Error(`${figure.id}: no parts`)
	// stood up as it stands in its own file (skinned or not), then the rest dropped
	const sourceScene = (sourceRoot.getDefaultScene() ?? sourceRoot.listScenes()[0]) as Scene
	// a rigged figure: its weights, moved onto our bones, and where its joints are
	const own = figure.ownSkin === 'character-creator'
	const ownPlaces = new Map<string, [number, number, number]>()
	const ownWeights = new Map<Primitive, { joints: Uint16Array; weights: Float32Array }>()
	if (own) {
		for (const node of kept) {
			const nodeSkin = node.getSkin()
			if (!nodeSkin) continue
			const names = nodeSkin.listJoints().map(joint => joint.getName())
			for (const [ours, pattern] of Object.entries(CC_PLACES)) {
				const joint = nodeSkin.listJoints().find(candidate => pattern.test(candidate.getName()))
				if (joint && !ownPlaces.has(ours)) ownPlaces.set(ours, jointPosition(joint))
			}
			const target = names.map(name => jointList.findIndex(joint => joint.getName() === ccBone(name)))
			for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
				const jointsOf = primitive.getAttribute('JOINTS_0') as Accessor
				const weightsOf = primitive.getAttribute('WEIGHTS_0') as Accessor
				const count = jointsOf.getCount()
				const joints = new Uint16Array(count * 4)
				const weights = new Float32Array(count * 4)
				const j: number[] = []
				const w: number[] = []
				for (let v = 0; v < count; v++) {
					jointsOf.getElement(v, j)
					weightsOf.getElement(v, w)
					// bones that land on the same joint add up; the four strongest are kept
					const total = new Map<number, number>()
					for (let k = 0; k < 4; k++) {
						const weight = w[k] as number
						if (!weight) continue
						const joint = target[j[k] as number] ?? -1
						if (joint >= 0) total.set(joint, (total.get(joint) ?? 0) + weight)
					}
					const best = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
					const sum = best.reduce((acc, [, weight]) => acc + weight, 0) || 1
					for (const [k, [joint, weight]] of best.entries()) {
						joints[v * 4 + k] = joint
						weights[v * 4 + k] = weight / sum
					}
				}
				ownWeights.set(primitive, { joints, weights })
			}
		}
	}
	for (const node of kept) bakeToWorld(source, node, own)
	if (own)
		for (const node of kept)
			for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
				const mapped = ownWeights.get(primitive)
				if (!mapped) continue
				const buffer = sourceRoot.listBuffers()[0] ?? null
				primitive.setAttribute(
					'JOINTS_0',
					source.createAccessor().setType('VEC4').setArray(mapped.joints).setBuffer(buffer)
				)
				primitive.setAttribute(
					'WEIGHTS_0',
					source.createAccessor().setType('VEC4').setArray(mapped.weights).setBuffer(buffer)
				)
			}
	for (const node of kept) {
		node.getParentNode()?.removeChild(node)
		for (const sceneOf of sourceRoot.listScenes()) sceneOf.removeChild(node)
		sourceScene.addChild(node)
	}
	for (const node of sourceRoot.listNodes()) if (node.getMesh() && !kept.includes(node)) node.setMesh(null)
	// fitted to the skeleton: as tall as the base body (to the crown of the head, not the helmet) and
	// with its head over the base body's head
	const measured = kept.filter(node => !partOf(node)?.joint)
	let low = Number.POSITIVE_INFINITY
	let high = Number.NEGATIVE_INFINITY
	for (const [, y] of vertices(measured)) {
		low = Math.min(low, y)
		high = Math.max(high, y)
	}
	const scale = bodyHead.top / (high - low)
	let headX = 0
	let headZ = 0
	let headCount = 0
	for (const [x, y, z] of vertices(measured)) {
		if (y < high - 0.2 / scale) continue
		headX += x
		headZ += z
		headCount++
	}
	const fit = MathUtils.compose(
		[bodyHead.x - (headX / headCount) * scale, -low * scale, bodyHead.z - (headZ / headCount) * scale],
		[0, 0, 0, 1],
		[scale, scale, scale],
		[] as unknown as mat4
	)
	for (const node of kept) {
		node.setMatrix(fit)
		bakeToWorld(source, node, own)
		const part = partOf(node)
		const count = triangles(node)
		if (part?.triangles && count > part.triangles)
			for (const primitive of node.getMesh()?.listPrimitives() ?? [])
				simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio: part.triangles / count, error: 0.01 })
	}
	if (own) fitSkeleton(new Map([...ownPlaces].map(([name, at]) => [name, point(fit, at)])))
	// arms bent to this figure's: aim each upper arm at its hand (the outermost few centimetres)
	else for (const [index, arm] of arms.entries()) arm.setRotation(restArms[index] as [number, number, number, number])
	// the hands: the figure's own hands (gloves) when it has them, else its outermost few centimetres
	const hands = kept.filter(node => partOf(node)?.id === 'skin-hands')
	let reach = Number.NEGATIVE_INFINITY
	for (const [x] of vertices(measured)) reach = Math.max(reach, x)
	let sumX = 0
	let sumY = 0
	let count = 0
	for (const [x, y] of vertices(hands.length > 0 ? hands : measured)) {
		if (hands.length > 0 ? x < 0.15 : x < reach - 0.12) continue
		sumX += x
		sumY += y
		count++
	}
	const shoulder = jointPosition(joints.get('upperarm_l') as Node)
	const angle = Math.atan2(shoulder[1] - sumY / count, sumX / count - shoulder[0])
	if (!own) {
		turnJoint(joints.get('upperarm_l') as Node, [0, 0, 1], -angle)
		turnJoint(joints.get('upperarm_r') as Node, [0, 0, 1], angle)
	}
	firstArms ??= arms.map(arm => [...arm.getRotation()] as [number, number, number, number])
	const posed = poseBody(bodyPrimitive, baseSkin, baseBind)
	const grid = new PointGrid(posed.positions, posed.count, 0.03)
	// this figure's bind pose is the skeleton bent to it
	const figureSkin = document.createSkin(figure.id).setSkeleton(baseSkin.getSkeleton())
	for (const joint of jointList) figureSkin.addJoint(joint)
	const bind = new Float32Array(jointList.length * 16)
	for (const [index, joint] of jointList.entries())
		bind.set(invert(joint.getWorldMatrix()) as unknown as number[], index * 16)
	figureSkin.setInverseBindMatrices(
		document
			.createAccessor(`bind-${figure.id}`)
			.setType('MAT4')
			.setArray(bind)
			.setBuffer(root.listBuffers()[0] ?? null)
	)
	const merged = mergeDocuments(document, source)
	for (const sourceNode of kept) {
		const part = partOf(sourceNode) as Part
		const node = merged.get(sourceNode) as Node
		bindMesh(
			document,
			node,
			figureSkin,
			posed,
			part.joint
				? { kind: 'rigid', joint: part.joint }
				: own
					? { kind: 'own' }
					: { kind: 'transfer', stiffFingers: part.stiffFingers ?? false },
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
	for (const sceneOf of sourceRoot.listScenes()) {
		const copy = merged.get(sceneOf) as Scene
		for (const child of copy.listChildren()) child.traverse(node => node.dispose())
		copy.dispose()
	}
	process.stdout.write(`${figure.id}: ${kept.length} parts, arms lowered ${((angle * 180) / Math.PI).toFixed(1)}°\n`)
}
// gear is placed on the skeleton as the first figure stands
for (const [index, arm] of arms.entries())
	arm.setRotation((firstArms ?? restArms)[index] as [number, number, number, number])

// the base body was only the source of the weights
for (const node of root.listNodes()) if (node.getMesh() && node.getSkin() === baseSkin) node.dispose()
baseSkin.dispose()

// ---- gear from Sketchfab, fixed to bones ----

const credits: { name: string; author: string; page: string; licence: string }[] = [
	...config.figures.map(figure => ({
		name: figure.name,
		author: figure.author,
		page: `https://sketchfab.com/3d-models/${figure.uid}`,
		licence: figure.licence
	})),
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
