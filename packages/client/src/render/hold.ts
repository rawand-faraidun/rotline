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

/** each finger joint's open pose, kept from the first frame it is seen */
const restPose = new WeakMap<THREE.Object3D, THREE.Quaternion>()

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

/** How far an arm reaches from its shoulder to its wrist, straight. */
function reachOf(arm: Arm): number {
	const a = arm.upper.getWorldPosition(v[0] as THREE.Vector3)
	const b = arm.lower.getWorldPosition(v[1] as THREE.Vector3)
	const c = arm.hand.getWorldPosition(v[2] as THREE.Vector3)
	return a.distanceTo(b) + b.distanceTo(c)
}

/** Two-bone IK: the hand reaches `target`, the elbow bends toward `pole`. */
function reach(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3): void {
	shrug(arm, target)
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

/** how far the collarbone may turn to bring the shoulder forward (radians) */
const MAX_SHRUG = 0.2

/**
 * When the hand cannot reach `target` with the arm alone, the shoulder comes forward to it (the
 * collarbone turns toward it, as far as a real shoulder goes).
 */
function shrug(arm: Arm, target: THREE.Vector3): void {
	const base = arm.clavicle.getWorldPosition(v[0] as THREE.Vector3)
	const shoulder = arm.upper.getWorldPosition(v[1] as THREE.Vector3)
	const length =
		shoulder.distanceTo(arm.lower.getWorldPosition(v[2] as THREE.Vector3)) +
		arm.lower.getWorldPosition(v[2] as THREE.Vector3).distanceTo(arm.hand.getWorldPosition(v[3] as THREE.Vector3))
	const short = shoulder.distanceTo(target) - length * 0.97
	if (short <= 0) return
	const collar = shoulder.distanceTo(base)
	// the shoulder moved toward the target by what is missing, kept on the collarbone's circle
	const wanted = (v[4] as THREE.Vector3)
		.subVectors(target, shoulder)
		.setLength(Math.min(short, collar * 0.6))
		.add(shoulder)
		.sub(base)
	const from = (v[5] as THREE.Vector3).subVectors(shoulder, base)
	q.setFromUnitVectors(from.normalize(), wanted.normalize())
	// a little: more pulls the shoulder out of shape
	const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)))
	if (angle > MAX_SHRUG) q.slerp(new THREE.Quaternion(), 1 - MAX_SHRUG / angle)
	turnWorld(arm.clavicle, q)
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
	// no clip moves the fingers, so they start each frame from the open hand (else the curl adds up)
	for (const joint of [...arm.fingers.flat(), ...arm.thumb]) {
		const rest = restPose.get(joint)
		if (rest) joint.quaternion.copy(rest)
		else restPose.set(joint, joint.quaternion.clone())
	}
	arm.hand.updateMatrixWorld(true)
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
 * Where each gun is held, read off its side view: the right hand's grip and the left hand's place,
 * as [along, up]: tenths of the gun's length from its rear, and twentieths of its length above the
 * middle of its height (the model is centred on its bounding box).
 */
const HOLD_POINTS: Record<string, { grip: [number, number]; fore: [number, number]; hip?: boolean }> = {
	'p9-service': { grip: [2.5, -2], fore: [2.5, -2] },
	'halcyon-45': { grip: [2, -2], fore: [2, -2] },
	'vex-9': { grip: [4, -1], fore: [8.3, -1.6] },
	'k-71': { grip: [3, -1.3], fore: [5.8, 0.2] },
	'breacher-12': { grip: [2.7, -1.3], fore: [5.5, 0] },
	mower: { grip: [2.6, -1.6], fore: [5.2, -0.4] },
	longstride: { grip: [2.3, -0.5], fore: [5, -0.4] },
	kiln: { grip: [3.4, -2], fore: [5.5, 0] },
	thumper: { grip: [4.9, -2], fore: [8.3, -1.5] },
	arclight: { grip: [5, -1.5], fore: [7.6, -1.8] },
	viper: { grip: [3, -1.6], fore: [6, 0] },
	// too heavy to shoulder: carried at the hip
	minigun: { grip: [0.7, 0.2], fore: [3.4, 2.5], hip: true }
}
const DEFAULT_POINTS: { grip: [number, number]; fore: [number, number]; hip?: boolean } = {
	grip: [3, -1.2],
	fore: [6, -0.2]
}
/** A hold point in the gun's own frame (metres from its centre: along the barrel, up). */
function holdPoint(point: [number, number], length: number): [number, number] {
	return [(point[0] / 10 - 0.5) * length, (point[1] * length) / 20]
}

/**
 * Puts the gun (its length along local +X, centred) and both hands where they belong for `hold`,
 * aiming along `aim` (world angle: x = cos, z = sin): the gun is placed first, then each hand is
 * brought to its place on that gun (the wrist a little back from the palm), turned to wrap it, and
 * the fingers closed. The weapon's position and rotation are written in its parent's frame.
 */
export function holdGun(
	rig: Rig,
	weapon: THREE.Object3D,
	length: number,
	aim: number,
	hold: Hold,
	/** 0..1: the gun just fired (pushed back, muzzle up); 0..1: how far into a reload (gun tipped, hand at the magazine) */
	motion: { kick?: number; reload?: number; weaponId?: string } = {}
): void {
	const kick = motion.kick ?? 0
	const reloading = motion.reload ?? 0
	// a reload tips the gun down and in for most of its length
	const tip = reloading > 0 ? Math.sin(Math.min(1, reloading) * Math.PI) : 0
	const d = (v[10] as THREE.Vector3).set(Math.cos(aim), 0, Math.sin(aim))
	const right = (v[11] as THREE.Vector3).set(-d.z, 0, d.x)
	const points = HOLD_POINTS[motion.weaponId ?? ''] ?? DEFAULT_POINTS
	const pistol = hold === 'pistol'
	// the chest: square at ease and with a pistol, a little bladed for a long gun (turned to the right
	// of the aim, so the left shoulder comes forward toward the handguard)
	faceChest(rig, hold === 'rifle' ? d.clone().applyAxisAngle(UP, -0.3) : d)
	const shoulderR = rig.right.upper.getWorldPosition(new THREE.Vector3())
	const shoulderL = rig.left.upper.getWorldPosition(new THREE.Vector3())
	const chest = new THREE.Vector3().addVectors(shoulderR, shoulderL).multiplyScalar(0.5)
	// the gun's axis and its up
	let g: THREE.Vector3
	// at ease (the low ready): the right hand on the grip in front of the belly, the muzzle down and
	// forward across the body; the support hand finds the handguard where it can
	const lowGrip = shoulderR.clone().addScaledVector(d, 0.2).addScaledVector(right, -0.1).addScaledVector(UP, -0.3)
	if (hold === 'low') {
		g = new THREE.Vector3().addScaledVector(d, 0.5).addScaledVector(right, -0.55).addScaledVector(UP, -0.67).normalize()
	} else {
		const pitch = kick * 0.08 - tip * 0.45
		g = d.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch))
	}
	const gunUp = UP.clone().addScaledVector(g, -UP.dot(g)).normalize()
	const side = new THREE.Vector3().crossVectors(g, gunUp)
	// which point of the gun sits where: a long gun's butt in the shoulder (or at the chest at ease),
	// a pistol's grip out in front of the face
	const [gripAlong, gripUp] = holdPoint(points.grip, length)
	const [foreAlong, foreUp] = holdPoint(points.fore, length)
	let origin: THREE.Vector3
	if (pistol) {
		const hand = chest.clone().addScaledVector(d, 0.44).addScaledVector(UP, -0.02)
		origin = hand.addScaledVector(g, -gripAlong).addScaledVector(gunUp, -gripUp)
	} else {
		const butt =
			hold === 'rifle' && points.hip
				? shoulderR.clone().addScaledVector(d, -0.02).addScaledVector(UP, -0.42).addScaledVector(right, -0.04)
				: shoulderR.clone().addScaledVector(d, 0.04).addScaledVector(right, -0.07).addScaledVector(UP, -0.02)
		origin = butt.addScaledVector(g, length / 2)
	}
	if (hold === 'low') origin = lowGrip.clone().addScaledVector(g, -gripAlong).addScaledVector(gunUp, -gripUp)
	// firing pushes it all back a little; a reload brings it down off the shoulder
	origin.addScaledVector(d, -kick * 0.05).addScaledVector(UP, -tip * 0.16)
	weapon.position.copy(weapon.parent ? weapon.parent.worldToLocal(origin.clone()) : origin)
	weapon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(g, gunUp, side))
	const on = (along: number, up: number) => origin.clone().addScaledVector(g, along).addScaledVector(gunUp, up)
	const gripAt = on(gripAlong, gripUp)
	let foreAt = pistol
		? gripAt.clone().addScaledVector(side, -0.035).addScaledVector(gunUp, -0.015)
		: on(foreAlong, foreUp)
	// a support hand that cannot reach its place slides back along the gun until it can (short arms,
	// long guns): it stays on the gun instead of hanging in the air short of it
	if (!pistol) {
		const armLength = reachOf(rig.left) + 0.05
		let along = foreAlong
		while (along > gripAlong + length * 0.12 && on(along, foreUp).distanceTo(shoulderL) > armLength) along -= 0.01
		foreAt = on(along, foreUp)
	}
	// during a reload the support hand goes to the magazine, just ahead of the grip and below
	if (tip > 0 && !pistol) foreAt = on(gripAlong + length * 0.12, gripUp - length * 0.04 * tip)
	// how each hand wraps: the right round the grip (fingers across to the left, knuckles up the grip);
	// the left under the handguard (fingers round its far side, knuckles along it), or cupping the right
	const rightFingers = new THREE.Vector3().addScaledVector(side, -0.75).addScaledVector(g, 0.45).normalize()
	const leftFingers = pistol
		? new THREE.Vector3().addScaledVector(side, 0.85).addScaledVector(g, 0.3).normalize()
		: new THREE.Vector3().addScaledVector(side, 0.8).addScaledVector(gunUp, 0.4).normalize()
	// the wrist sits behind the palm: back from the point the hand closes on
	const rightWrist = gripAt.clone().addScaledVector(rightFingers, -0.055).addScaledVector(side, 0.02)
	const leftWrist = pistol
		? foreAt.clone().addScaledVector(leftFingers, -0.05)
		: foreAt.clone().addScaledVector(leftFingers, -0.05).addScaledVector(gunUp, -0.03)
	reach(
		rig.right,
		rightWrist,
		shoulderR.clone().addScaledVector(right, 0.5).addScaledVector(UP, -0.55).addScaledVector(d, -0.1)
	)
	reach(
		rig.left,
		leftWrist,
		shoulderL
			.clone()
			.addScaledVector(right, pistol ? -0.45 : 0.05)
			.addScaledVector(UP, -0.7)
	)
	orientHand(rig.right, rightFingers, gunUp)
	orientHand(rig.left, leftFingers, pistol ? gunUp : g)
	grip(rig.right, 0.95, 1)
	grip(rig.left, 0.85, -1)
}
