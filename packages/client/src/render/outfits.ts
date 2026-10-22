import { ARMOUR_PIECES, type ArmourPiece, gear } from '@rotline/game-data'
import * as THREE from 'three'

/** One worn piece: which model in soldier.glb, and the colour its paint is multiplied by. */
export type Piece = { id: string; tint?: number }

/** What a soldier wears: the five armour places and a pack, on a person (face, hands, own clothes). */
export type Outfit = Record<ArmourPiece, Piece | null> & { pack: Piece | null; person: Piece[] }

/** every worn piece in soldier.glb is a node named `<place>-<id>` */
const PIECE = /^(head|vest|body|legs|feet|pack|skin|person)-/

/** the operator: face, eyes and hands, dressed by the torso, legs and feet places */
const OPERATOR: Piece[] = [{ id: 'skin-face' }, { id: 'skin-eyes' }, { id: 'skin-glasses' }, { id: 'skin-hands' }]

/**
 * Who each class is: the same kitted soldier (masked, gloved, glasses), told apart by what they wear.
 */
const PEOPLE: Record<string, Piece[]> = {
	assault: OPERATOR,
	medic: OPERATOR,
	heavy: OPERATOR,
	survivor: OPERATOR
}
const CLOTHES: readonly ArmourPiece[] = ['torso', 'legs', 'feet']

/** what shows where nothing is worn: plain clothes (a soldier is never drawn bare) */
const UNDERNEATH: Record<ArmourPiece, Piece | null> = {
	head: null,
	torso: { id: 'body-ubacs', tint: 0x6e6a60 },
	vest: null,
	legs: { id: 'legs-combat', tint: 0x55534c },
	feet: { id: 'feet-boots', tint: 0x3a3632 }
}

/** the pack each class carries (survivors carry nothing) */
const PACKS: Record<string, Piece | null> = {
	assault: null,
	medic: { id: 'pack-medical' },
	heavy: { id: 'pack-military' },
	survivor: null
}

/** the class's look before any armour is known (others in the lobby, bots) */
const CLASS_ARMOUR: Record<string, (string | null)[]> = {
	assault: ['field-helmet', 'field-shirt', 'kevlar-vest', 'field-trousers', 'field-boots'],
	medic: ['ridge-helmet', 'padded-jacket', 'assault-rig', 'field-trousers', 'runner-boots'],
	heavy: ['bastion-helmet', 'field-shirt', 'siege-plates', 'armoured-trousers', 'steel-toe-boots'],
	survivor: [null, null, null, null, null]
}

const SURVIVOR: Partial<Record<ArmourPiece, Piece>> = {
	torso: { id: 'body-ubacs', tint: 0x9a4a3a },
	legs: { id: 'legs-combat', tint: 0x5a6a8a },
	feet: { id: 'feet-boots', tint: 0x3e3228 }
}

/**
 * The outfit for a class wearing these armour items (ids in head, torso, vest, legs, feet order;
 * `undefined` uses the class's usual kit).
 */
export function outfitFor(classId: string, armour?: readonly (string | null)[]): Outfit {
	const ids = armour ?? CLASS_ARMOUR[classId] ?? CLASS_ARMOUR.assault ?? []
	const person = PEOPLE[classId] ?? OPERATOR
	const outfit = { pack: PACKS[classId] ?? null, person } as Outfit
	for (const [index, place] of ARMOUR_PIECES.entries()) {
		if (person !== OPERATOR && CLOTHES.includes(place)) {
			outfit[place] = null
			continue
		}
		const def = gear.armour.find(entry => entry.id === ids[index])
		outfit[place] = def
			? { id: def.look.model, ...(def.look.tint ? { tint: Number.parseInt(def.look.tint.slice(1), 16) } : {}) }
			: classId === 'survivor'
				? (SURVIVOR[place] ?? null)
				: UNDERNEATH[place]
	}
	return outfit
}

/**
 * Shows the pieces of `outfit` on a cloned soldier and hides the rest; tinted pieces get their own
 * material copies so other soldiers keep their colours.
 */
export function wear(model: THREE.Object3D, outfit: Outfit): void {
	const worn = new Map<string, Piece>()
	for (const piece of [...ARMOUR_PIECES.map(place => outfit[place]), outfit.pack, ...outfit.person])
		if (piece) worn.set(piece.id, piece)
	model.traverse(object => {
		if (!PIECE.test(object.name)) return
		// a piece made of several meshes arrives as `name`, `name_1`, `name_2`… (three.js keeps names unique)
		const piece = worn.get(object.name.replace(/_\d+$/, ''))
		object.visible = piece !== undefined
		if (!piece) return
		object.traverse(node => {
			const mesh = node as THREE.Mesh
			if (!mesh.isMesh) return
			// the piece's own paint, kept so a later outfit can tint it again from the start
			if (!mesh.userData.paint) mesh.userData.paint = mesh.material
			const original = mesh.userData.paint as THREE.MeshStandardMaterial
			if (piece.tint === undefined) {
				mesh.material = original
				return
			}
			const paint = original.clone()
			paint.color.setHex(piece.tint)
			// the kit's own paint is dark olive, which hides any colour put over it: dye a pale copy instead
			if (original.map) paint.map = undyed(original.map)
			mesh.material = paint
		})
	})
}

const pale = new WeakMap<THREE.Texture, THREE.Texture>()

/**
 * A grey copy of a cloth texture, brightened to a mid tone, so a tint gives the cloth that colour
 * while the folds, seams and wear stay (made once per texture).
 */
function undyed(texture: THREE.Texture): THREE.Texture {
	const known = pale.get(texture)
	if (known) return known
	const image = texture.image as CanvasImageSource & { width: number; height: number }
	if (!image?.width) return texture
	const canvas = document.createElement('canvas')
	canvas.width = image.width
	canvas.height = image.height
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) return texture
	ctx.drawImage(image, 0, 0)
	const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
	const data = pixels.data
	let sum = 0
	for (let i = 0; i < data.length; i += 4)
		sum += 0.3 * (data[i] as number) + 0.59 * (data[i + 1] as number) + 0.11 * (data[i + 2] as number)
	// the average brought up to a light grey, the contrast kept
	const gain = 175 / Math.max(1, sum / (data.length / 4))
	for (let i = 0; i < data.length; i += 4) {
		const grey = Math.min(
			255,
			(0.3 * (data[i] as number) + 0.59 * (data[i + 1] as number) + 0.11 * (data[i + 2] as number)) * gain
		)
		data[i] = data[i + 1] = data[i + 2] = grey
	}
	ctx.putImageData(pixels, 0, 0)
	const copy = new THREE.CanvasTexture(canvas)
	copy.colorSpace = texture.colorSpace
	copy.flipY = texture.flipY
	copy.wrapS = texture.wrapS
	copy.wrapT = texture.wrapT
	copy.channel = texture.channel
	copy.anisotropy = texture.anisotropy
	pale.set(texture, copy)
	return copy
}
