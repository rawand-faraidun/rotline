import { ARMOUR_PIECES, type ArmourPiece, gear } from '@rotline/game-data'
import type * as THREE from 'three'

/** One worn piece: which model in soldier.glb, and the colour its paint is multiplied by. */
export type Piece = { id: string; tint?: number }

/** What a soldier wears: the five armour places and a pack. */
export type Outfit = Record<ArmourPiece, Piece | null> & { pack: Piece | null }

/** every worn piece in soldier.glb is a node named `<place>-<id>` */
const PIECE = /^(head|vest|body|legs|feet|pack)-/

/** what shows where nothing is worn: plain clothes (a soldier is never drawn bare) */
const UNDERNEATH: Record<ArmourPiece, Piece | null> = {
	head: null,
	torso: { id: 'body-ubacs', tint: 0x6e6a5e },
	vest: null,
	legs: { id: 'legs-combat', tint: 0x55584e },
	feet: { id: 'feet-boots', tint: 0x2e2a26 }
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
	const outfit = { pack: PACKS[classId] ?? null } as Outfit
	for (const [index, place] of ARMOUR_PIECES.entries()) {
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
	for (const piece of [...ARMOUR_PIECES.map(place => outfit[place]), outfit.pack]) if (piece) worn.set(piece.id, piece)
	model.traverse(object => {
		if (!PIECE.test(object.name)) return
		const piece = worn.get(object.name)
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
			mesh.material = paint
		})
	})
}
