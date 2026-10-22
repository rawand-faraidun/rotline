import * as THREE from 'three'

/**
 * How a soldier holds a gun, made up on top of the walking and idle clips (the animation library
 * has no gun poses beyond a pistol aim): the torso turns to the aim, the gun is placed where a
 * trained shooter holds it, each hand is put on it (two-bone IK) and turned so it wraps the gun, and
 * the fingers close.
 */

export type Arm = {
	clavicle: THREE.Object3D
	upper: THREE.Object3D
	lower: THREE.Object3D
	hand: THREE.Object3D
	/** index, middle, ring, pinky (each three joints from the knuckle), then the thumb */
	fingers: THREE.Object3D[][]
	thumb: THREE.Object3D[]
}

export type Rig = {
	spine: THREE.Object3D[]
	head: THREE.Object3D | null
	right: Arm
	left: Arm
}

export type Hold = 'rifle' | 'pistol' | 'low'

const UP = new THREE.Vector3(0, 1, 0)
const v = Array.from({ length: 12 }, () => new THREE.Vector3())
const q = new THREE.Quaternion()
const qParent = new THREE.Quaternion()
const qLocal = new THREE.Quaternion()
const basisFrom = new THREE.Matrix4()
const basisTo = new THREE.Matrix4()

/** The arm of a skeleton (UE-style bone names, `_r` or `_l`). */
export function findArm(root: THREE.Object3D, side: 'r' | 'l'): Arm | null {
	const get = (name: string) => root.getObjectByName(`${name}_${side}`) ?? null
	const clavicle = get('clavicle')
	const upper = get('upperarm')
	const lower = get('lowerarm')
	const hand = get('hand')
	if (!clavicle || !upper || !lower || !hand) return null
	const fingers = ['index', 'middle', 'ring', 'pinky'].map(finger =>
		[1, 2, 3].map(joint => get(`${finger}_0${joint}`)).filter((bone): bone is THREE.Object3D => bone !== null)
	)
	const thumb = [1, 2, 3].map(joint => get(`thumb_0${joint}`)).filter((bone): bone is THREE.Object3D => bone !== null)
	return { clavicle, upper, lower, hand, fingers, thumb }
}

/** Turns a bone by a world rotation, kept in its parent's frame. */
function turnWorld(bone: THREE.Object3D, turn: THREE.Quaternion): void {
	bone.parent?.getWorldQuaternion(qParent)
	qLocal.copy(qParent).invert().multiply(turn).multiply(qParent)
	bone.quaternion.premultiply(qLocal)
	bone.updateMatrixWorld(true)
}

/** Turns `bone` so the world direction `from` becomes `to`. */
function swing(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
	if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return
	q.setFromUnitVectors(from.normalize(), to.normalize())
	turnWorld(bone, q)
}

/** Two-bone IK: the hand reaches `target`, the elbow bends toward `pole`. */
function reach(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3): void {
	const a = arm.upper.getWorldPosition(v[0] as THREE.Vector3)
	const b = arm.lower.getWorldPosition(v[1] as THREE.Vector3)
	const c = arm.hand.getWorldPosition(v[2] as THREE.Vector3)
	const upper = a.distanceTo(b)
	const lower = b.distanceTo(c)
	const toTarget = (v[3] as THREE.Vector3).subVectors(target, a)
	const distance = Math.min(Math.max(toTarget.length(), Math.abs(upper - lower) + 1e-3), upper + lower - 1e-3)
	const dir = toTarget.normalize()
	const toPole = (v[4] as THREE.Vector3).subVectors(pole, a)
	const normal = (v[5] as THREE.Vector3).crossVectors(dir, toPole).normalize()
	const angle = Math.acos(
		THREE.MathUtils.clamp((upper ** 2 + distance ** 2 - lower ** 2) / (2 * upper * distance), -1, 1)
	)
	const elbow = (v[6] as THREE.Vector3).copy(dir).applyAxisAngle(normal, angle).multiplyScalar(upper).add(a)
	swing(arm.upper, (v[7] as THREE.Vector3).subVectors(b, a), (v[8] as THREE.Vector3).subVectors(elbow, a))
	const bNow = arm.lower.getWorldPosition(v[1] as THREE.Vector3)
	const cNow = arm.hand.getWorldPosition(v[2] as THREE.Vector3)
	swing(arm.lower, (v[7] as THREE.Vector3).subVectors(cNow, bNow), (v[8] as THREE.Vector3).subVectors(target, bNow))
}

/**
 * Turns the hand so its fingers point along `fingers` and the line of its knuckles (pinky to index)
 * along `knuckles` (both world directions).
 */
function orientHand(arm: Arm, fingers: THREE.Vector3, knuckles: THREE.Vector3): void {
	const middle = arm.fingers[1]?.[0]
	const index = arm.fingers[0]?.[0]
	const pinky = arm.fingers[3]?.[0]
	if (!middle || !index || !pinky) return
	const origin = arm.hand.getWorldPosition(v[0] as THREE.Vector3)
	const f0 = middle
		.getWorldPosition(v[1] as THREE.Vector3)
		.sub(origin)
		.normalize()
	const k0 = index.getWorldPosition(v[2] as THREE.Vector3).sub(pinky.getWorldPosition(v[3] as THREE.Vector3))
	// make both bases orthonormal (fingers first), then turn one onto the other
	k0.addScaledVector(f0, -k0.dot(f0)).normalize()
	const n0 = (v[4] as THREE.Vector3).crossVectors(f0, k0)
	const f1 = (v[5] as THREE.Vector3).copy(fingers).normalize()
	const k1 = (v[6] as THREE.Vector3).copy(knuckles)
	k1.addScaledVector(f1, -k1.dot(f1)).normalize()
	const n1 = (v[7] as THREE.Vector3).crossVectors(f1, k1)
	basisFrom.makeBasis(f0, k0, n0)
	basisTo.makeBasis(f1, k1, n1)
	q.setFromRotationMatrix(basisTo.multiply(basisFrom.transpose()))
	turnWorld(arm.hand, q)
}

/** Closes the fingers (and the thumb a little) toward the palm, `amount` radians per joint. */
function grip(arm: Arm, amount: number, sideSign: number): void {
	const index = arm.fingers[0]?.[0]
	const pinky = arm.fingers[3]?.[0]
	if (!index || !pinky) return
	// the curl turns about the knuckle line; which way round depends on the hand
	const axis = (v[9] as THREE.Vector3)
		.subVectors(index.getWorldPosition(v[1] as THREE.Vector3), pinky.getWorldPosition(v[2] as THREE.Vector3))
		.normalize()
		.multiplyScalar(sideSign)
	for (const finger of arm.fingers)
		for (const joint of finger) {
			q.setFromAxisAngle(axis, amount)
			turnWorld(joint, q)
		}
	for (const joint of arm.thumb) {
		q.setFromAxisAngle(axis, amount * 0.35)
		turnWorld(joint, q)
	}
}

/** Turns the chest about the vertical so it faces `yaw` (world, radians), shared over the spine bones. */
function faceChest(rig: Rig, direction: THREE.Vector3): void {
	const right = rig.right.upper.getWorldPosition(v[0] as THREE.Vector3)
	const left = rig.left.upper.getWorldPosition(v[1] as THREE.Vector3)
	// the chest's forward: square to the line of the shoulders, level
	const across = (v[2] as THREE.Vector3).subVectors(left, right).setY(0).normalize()
	const forward = (v[3] as THREE.Vector3).crossVectors(across, UP).normalize()
	const target = (v[4] as THREE.Vector3).copy(direction).setY(0).normalize()
	const angle = Math.atan2(forward.x * target.z - forward.z * target.x, forward.x * target.x + forward.z * target.z)
	const share = -angle / Math.max(1, rig.spine.length)
	q.setFromAxisAngle(UP, share)
	for (const bone of rig.spine) turnWorld(bone, q)
}

/**
 * Puts the gun (its length along local +X, centred) and both hands where they belong for `hold`,
 * aiming along `aim` (world angle: x = cos, z = sin). Returns nothing; the weapon's position and
 * rotation are written in its parent's frame.
 */
export function holdGun(
	rig: Rig,
	weapon: THREE.Object3D,
	length: number,
	aim: number,
	hold: Hold,
	/** 0..1: the gun just fired (pushed back, muzzle up); 0..1: how far into a reload (gun tipped, hand at the magazine) */
	motion: { kick?: number; reload?: number } = {}
): void {
	const kick = motion.kick ?? 0
	const reloading = motion.reload ?? 0
	// a reload tips the gun down and in for most of its length
	const tip = reloading > 0 ? Math.sin(Math.min(1, reloading) * Math.PI) : 0
	const d = (v[10] as THREE.Vector3).set(Math.cos(aim), 0, Math.sin(aim))
	const right = (v[11] as THREE.Vector3).set(-d.z, 0, d.x)
	if (hold === 'low') {
		// at ease (low ready): square to the front, stock at the right of the chest, the muzzle down and
		// across the body to the front left, both hands on the gun
		faceChest(rig, d)
		const shoulderR = rig.right.upper.getWorldPosition(new THREE.Vector3())
		const shoulderL = rig.left.upper.getWorldPosition(new THREE.Vector3())
		const g = new THREE.Vector3()
			.addScaledVector(d, 0.62)
			.addScaledVector(right, -0.42)
			.addScaledVector(UP, -0.66)
			.normalize()
		const gunUp = UP.clone().addScaledVector(g, -UP.dot(g)).normalize()
		const side = new THREE.Vector3().crossVectors(g, gunUp)
		const stock = shoulderR.clone().addScaledVector(d, 0.12).addScaledVector(UP, -0.12).addScaledVector(right, -0.05)
		const centre = stock.clone().addScaledVector(g, length / 2)
		weapon.position.copy(weapon.parent ? weapon.parent.worldToLocal(centre) : centre)
		weapon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(g, gunUp, side))
		const gripAt = stock
			.clone()
			.addScaledVector(g, length * 0.3)
			.addScaledVector(gunUp, -0.06)
		const foreAt = stock
			.clone()
			.addScaledVector(g, Math.min(0.6, length * 0.62))
			.addScaledVector(gunUp, -0.04)
		reach(rig.right, gripAt, shoulderR.clone().addScaledVector(right, 0.45).addScaledVector(UP, -0.6))
		reach(
			rig.left,
			foreAt,
			shoulderL.clone().addScaledVector(right, -0.25).addScaledVector(UP, -0.7).addScaledVector(d, 0.1)
		)
		orientHand(rig.right, new THREE.Vector3().addScaledVector(side, -0.75).addScaledVector(g, 0.55), gunUp)
		orientHand(rig.left, new THREE.Vector3().addScaledVector(side, 0.8).addScaledVector(gunUp, 0.35), g)
		grip(rig.right, 0.95, 1)
		grip(rig.left, 0.85, -1)
		return
	}
	// bladed for a rifle (left shoulder toward the target), square for a pistol
	const blade = hold === 'rifle' ? 0.45 : 0.1
	const chestTo = new THREE.Vector3().copy(d).applyAxisAngle(UP, blade)
	faceChest(rig, chestTo)
	const shoulderR = rig.right.upper.getWorldPosition(new THREE.Vector3())
	const shoulderL = rig.left.upper.getWorldPosition(new THREE.Vector3())
	const chest = new THREE.Vector3().addVectors(shoulderR, shoulderL).multiplyScalar(0.5)
	let stock: THREE.Vector3
	let gripAt: THREE.Vector3
	let foreAt: THREE.Vector3
	if (hold === 'rifle') {
		// stock in the pocket of the right shoulder, the gun level along the aim at cheek height
		stock = shoulderR.clone().addScaledVector(d, 0.04).addScaledVector(right, -0.06).addScaledVector(UP, 0.04)
		gripAt = stock
			.clone()
			.addScaledVector(d, length * 0.3)
			.addScaledVector(UP, -0.07)
		foreAt = stock
			.clone()
			.addScaledVector(d, Math.min(0.62, length * 0.62))
			.addScaledVector(UP, -0.05)
	} else {
		// both arms out, the pistol in front of the face
		stock = chest.clone().addScaledVector(d, 0.42).addScaledVector(UP, 0.02)
		gripAt = stock.clone().addScaledVector(UP, -0.05)
		foreAt = gripAt.clone().addScaledVector(right, -0.04).addScaledVector(UP, -0.02).addScaledVector(d, -0.02)
	}
	// firing pushes everything back a little; a reload brings the gun down off the shoulder
	stock.addScaledVector(d, -kick * 0.05).addScaledVector(UP, -tip * 0.16)
	gripAt.addScaledVector(d, -kick * 0.05).addScaledVector(UP, -tip * 0.16)
	foreAt.addScaledVector(d, -kick * 0.05).addScaledVector(UP, -tip * 0.16)
	const pitch = kick * 0.08 - tip * 0.45
	if (tip > 0) {
		// the support hand goes to the magazine, under the middle of the gun
		foreAt
			.copy(stock)
			.addScaledVector(d, length * 0.4 * Math.cos(tip * 0.45))
			.addScaledVector(UP, -0.14 - length * 0.15 * tip)
	}
	// the gun: along the aim (pitched by the kick or the reload), its rear at the stock point
	const reach0 = hold === 'rifle' ? length / 2 : length * 0.35
	const centre = stock
		.clone()
		.addScaledVector(d, reach0 * Math.cos(pitch))
		.addScaledVector(UP, reach0 * Math.sin(pitch))
	weapon.position.copy(weapon.parent ? weapon.parent.worldToLocal(centre) : centre)
	weapon.rotation.set(0, -aim, pitch)
	// elbows: the right one out and down, the left one under the gun
	reach(
		rig.right,
		gripAt,
		shoulderR.clone().addScaledVector(right, 0.5).addScaledVector(UP, -0.55).addScaledVector(d, -0.1)
	)
	reach(
		rig.left,
		foreAt,
		shoulderL
			.clone()
			.addScaledVector(right, hold === 'rifle' ? 0.05 : -0.45)
			.addScaledVector(UP, -0.7)
	)
	// the right hand wraps the grip: knuckles up the grip, fingers round its front
	orientHand(rig.right, new THREE.Vector3().addScaledVector(right, -0.75).addScaledVector(d, 0.55), UP)
	if (hold === 'rifle') {
		// the left hand under the handguard, palm up, fingers round its far side
		orientHand(rig.left, new THREE.Vector3().addScaledVector(right, 0.8).addScaledVector(UP, 0.35), d)
	} else {
		// the left hand cups the right
		orientHand(rig.left, new THREE.Vector3().addScaledVector(right, 0.85).addScaledVector(d, 0.3), UP)
	}
	grip(rig.right, 0.95, 1)
	grip(rig.left, 0.85, -1)
}
