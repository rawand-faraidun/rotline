// Skins static character models onto the Universal Animation Library skeleton, so any posed model
// (a scanned or sculpted soldier, a piece of clothing or armour) can play the library's animations.
//
// The skeleton is first bent into the model's pose (an A-pose: arms down by some angle), then each
// model vertex takes the bone weights of the nearest vertices of the base body posed the same way.
// The posed skeleton becomes the bind pose. Animations replace every bone's rotation, so they play
// exactly as they do on the base body.
import type { Accessor, Document, mat4, Node, Primitive, Skin } from '@gltf-transform/core'
import { MathUtils } from '@gltf-transform/core'

type Vec3 = [number, number, number]
type Quat = [number, number, number, number]

export function multiply(a: mat4, b: mat4): mat4 {
	const out = new Array(16).fill(0) as unknown as mat4
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0
			for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number)
			out[c * 4 + r] = sum
		}
	return out
}

export function invert(m: mat4): mat4 {
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

function transformPoint(m: mat4, p: ArrayLike<number>): Vec3 {
	const [x, y, z] = [p[0] as number, p[1] as number, p[2] as number]
	return [
		(m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
		(m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
		(m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number)
	]
}

function transformDirection(m: mat4, p: ArrayLike<number>): Vec3 {
	const [x, y, z] = [p[0] as number, p[1] as number, p[2] as number]
	const v: Vec3 = [
		(m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z,
		(m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z,
		(m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z
	]
	const length = Math.hypot(...v) || 1
	return [v[0] / length, v[1] / length, v[2] / length]
}

function quatMultiply(a: Quat, b: Quat): Quat {
	const [ax, ay, az, aw] = a
	const [bx, by, bz, bw] = b
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz
	]
}

function quatAxisAngle(axis: Vec3, angle: number): Quat {
	const s = Math.sin(angle / 2)
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
}

function worldRotation(node: Node): Quat {
	const t: Vec3 = [0, 0, 0]
	const r: Quat = [0, 0, 0, 1]
	const s: Vec3 = [1, 1, 1]
	MathUtils.decompose(node.getWorldMatrix(), t, r, s)
	return r
}

/**
 * Turns a joint about a world axis (radians), keeping its children attached: the turn is written
 * into the joint's own rotation, in its parent's frame.
 */
export function turnJoint(joint: Node, axis: Vec3, angle: number): void {
	const parent = joint.getParentNode()
	const parentRotation = parent ? worldRotation(parent) : ([0, 0, 0, 1] as Quat)
	const inverseParent: Quat = [-parentRotation[0], -parentRotation[1], -parentRotation[2], parentRotation[3]]
	// local' = parent⁻¹ · turn · parent · local
	const turn = quatAxisAngle(axis, angle)
	const local = joint.getRotation() as Quat
	joint.setRotation(quatMultiply(quatMultiply(quatMultiply(inverseParent, turn), parentRotation), local))
}

/** Where a joint sits in the world (metres). */
export function jointPosition(joint: Node): Vec3 {
	const m = joint.getWorldMatrix()
	return [m[12] as number, m[13] as number, m[14] as number]
}

type Posed = { positions: Float32Array; joints: Uint16Array; weights: Float32Array; count: number }

/**
 * The base body's vertices in the skeleton's current pose, with their four bone weights (the source
 * of the weights the model vertices copy).
 */
export function poseBody(primitive: Primitive, skin: Skin, bind: readonly mat4[]): Posed {
	const position = primitive.getAttribute('POSITION') as Accessor
	const jointsOf = primitive.getAttribute('JOINTS_0') as Accessor
	const weightsOf = primitive.getAttribute('WEIGHTS_0') as Accessor
	const joints = skin.listJoints()
	const skinning = joints.map((joint, index) => multiply(joint.getWorldMatrix(), bind[index] as mat4))
	const count = position.getCount()
	const positions = new Float32Array(count * 3)
	const outJoints = new Uint16Array(count * 4)
	const outWeights = new Float32Array(count * 4)
	const p: number[] = []
	const j: number[] = []
	const w: number[] = []
	for (let v = 0; v < count; v++) {
		position.getElement(v, p)
		jointsOf.getElement(v, j)
		weightsOf.getElement(v, w)
		const sum: Vec3 = [0, 0, 0]
		for (let k = 0; k < 4; k++) {
			const weight = w[k] as number
			if (weight === 0) continue
			const moved = transformPoint(skinning[j[k] as number] as mat4, p)
			sum[0] += moved[0] * weight
			sum[1] += moved[1] * weight
			sum[2] += moved[2] * weight
			outJoints[v * 4 + k] = j[k] as number
			outWeights[v * 4 + k] = weight
		}
		positions.set(sum, v * 3)
	}
	return { positions, joints: outJoints, weights: outWeights, count }
}

/** A grid of points for nearest-neighbour lookups. */
class PointGrid {
	private readonly cells = new Map<string, number[]>()
	private readonly points: Float32Array
	private readonly size: number
	constructor(points: Float32Array, count: number, size: number) {
		this.points = points
		this.size = size
		for (let i = 0; i < count; i++) {
			const key = this.key(points[i * 3] as number, points[i * 3 + 1] as number, points[i * 3 + 2] as number)
			const cell = this.cells.get(key)
			if (cell) cell.push(i)
			else this.cells.set(key, [i])
		}
	}
	private key(x: number, y: number, z: number): string {
		return `${Math.floor(x / this.size)},${Math.floor(y / this.size)},${Math.floor(z / this.size)}`
	}
	/** the `k` nearest points to (x, y, z), searching outward ring by ring */
	nearest(x: number, y: number, z: number, k: number): { index: number; distance: number }[] {
		const cx = Math.floor(x / this.size)
		const cy = Math.floor(y / this.size)
		const cz = Math.floor(z / this.size)
		const found: { index: number; distance: number }[] = []
		for (let ring = 0; ring < 12; ring++) {
			for (let dx = -ring; dx <= ring; dx++)
				for (let dy = -ring; dy <= ring; dy++)
					for (let dz = -ring; dz <= ring; dz++) {
						if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue
						for (const index of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
							const px = (this.points[index * 3] as number) - x
							const py = (this.points[index * 3 + 1] as number) - y
							const pz = (this.points[index * 3 + 2] as number) - z
							found.push({ index, distance: Math.hypot(px, py, pz) })
						}
					}
			// a ring further out cannot hold anything nearer than (ring) cells away
			if (found.length >= k && ring > 0) {
				found.sort((a, b) => a.distance - b.distance)
				if ((found[k - 1]?.distance ?? Number.POSITIVE_INFINITY) <= ring * this.size) break
			}
		}
		found.sort((a, b) => a.distance - b.distance)
		return found.slice(0, k)
	}
}

export type Binding =
	/** copy weights from the nearest body vertices (clothes, skin) */
	| { kind: 'transfer'; stiffFingers?: boolean }
	/** follow one bone rigidly (helmets, plates, eyes) */
	| { kind: 'rigid'; joint: string }

/**
 * Binds a static mesh node to the skin: its vertices are moved into world space (the node's
 * transform baked in), given bone weights, and the node is parented to the scene root with the skin.
 */
export function bindMesh(
	document: Document,
	node: Node,
	skin: Skin,
	body: Posed,
	binding: Binding,
	grid?: PointGrid
): void {
	const world = node.getWorldMatrix()
	const names = skin.listJoints().map(joint => joint.getName())
	const rigid = binding.kind === 'rigid' ? names.indexOf(binding.joint) : -1
	// fingers of a model rarely line up with the skeleton's: they follow the hand instead
	const remap = names.map((name, index) => {
		if (binding.kind !== 'transfer' || !binding.stiffFingers) return index
		const finger = /^(index|middle|pinky|ring|thumb)_\d+(?:_leaf)?_([lr])$/.exec(name)
		return finger ? names.indexOf(`hand_${finger[2]}`) : index
	})
	if (binding.kind === 'rigid' && rigid < 0) throw new Error(`no joint ${binding.joint}`)
	const lookup = grid ?? new PointGrid(body.positions, body.count, 0.03)
	for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
		const position = primitive.getAttribute('POSITION') as Accessor
		const normal = primitive.getAttribute('NORMAL')
		const count = position.getCount()
		const positions = new Float32Array(count * 3)
		const normals = normal ? new Float32Array(count * 3) : null
		const joints = new Uint16Array(count * 4)
		const weights = new Float32Array(count * 4)
		const p: number[] = []
		for (let v = 0; v < count; v++) {
			position.getElement(v, p)
			const at = transformPoint(world, p)
			positions.set(at, v * 3)
			if (normal && normals) {
				normal.getElement(v, p)
				normals.set(transformDirection(world, p), v * 3)
			}
			if (rigid >= 0) {
				joints[v * 4] = rigid
				weights[v * 4] = 1
				continue
			}
			// blend the weights of the nearest few body vertices, nearer ones counting more
			const near = lookup.nearest(at[0], at[1], at[2], 6)
			const total = new Map<number, number>()
			for (const { index, distance } of near) {
				const share = 1 / (distance + 0.005) ** 2
				for (let k = 0; k < 4; k++) {
					const weight = body.weights[index * 4 + k] as number
					if (weight === 0) continue
					const joint = remap[body.joints[index * 4 + k] as number] as number
					total.set(joint, (total.get(joint) ?? 0) + weight * share)
				}
			}
			const best = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
			const sum = best.reduce((s, [, w]) => s + w, 0) || 1
			for (const [k, [joint, weight]] of best.entries()) {
				joints[v * 4 + k] = joint
				weights[v * 4 + k] = weight / sum
			}
		}
		primitive.setAttribute(
			'POSITION',
			document.createAccessor().setType('VEC3').setArray(positions).setBuffer(position.getBuffer())
		)
		if (normal && normals)
			primitive.setAttribute(
				'NORMAL',
				document.createAccessor().setType('VEC3').setArray(normals).setBuffer(normal.getBuffer())
			)
		primitive.setAttribute(
			'JOINTS_0',
			document.createAccessor().setType('VEC4').setArray(joints).setBuffer(position.getBuffer())
		)
		primitive.setAttribute(
			'WEIGHTS_0',
			document.createAccessor().setType('VEC4').setArray(weights).setBuffer(position.getBuffer())
		)
		// tangents were for the old orientation; three.js rebuilds what it needs
		primitive.setAttribute('TANGENT', null)
	}
	node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as unknown as mat4)
	node.setSkin(skin)
}

export { PointGrid }
