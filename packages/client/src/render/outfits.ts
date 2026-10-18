import type * as THREE from 'three'

/** One worn piece: which model in soldier.glb, and the colour its paint is multiplied by. */
export type Piece = { id: string; tint?: number }

/** What a soldier wears, slot by slot (the five armour slots and a pack). */
export type Outfit = {
	head: Piece | null
	vest: Piece | null
	body: Piece
	legs: Piece
	feet: Piece
	pack: Piece | null
}

/** every worn piece in soldier.glb is a node named `<slot>-<id>` */
const PIECE = /^(head|vest|body|legs|feet|pack)-/

/** Each class's look until players choose their own pieces (and survivors, who choose nothing). */
export const OUTFITS: Record<string, Outfit> = {
	assault: {
		head: { id: 'head-ops' },
		vest: { id: 'vest-carrier', tint: 0xa4a890 },
		body: { id: 'body-ubacs', tint: 0x8f9a72 },
		legs: { id: 'legs-combat', tint: 0x7c8664 },
		feet: { id: 'feet-boots', tint: 0x2e2a26 },
		pack: null
	},
	medic: {
		head: { id: 'head-mich' },
		vest: { id: 'vest-rig' },
		body: { id: 'body-ubacs', tint: 0xd6ccb4 },
		legs: { id: 'legs-combat', tint: 0xb8ab8c },
		feet: { id: 'feet-boots', tint: 0x4a3e32 },
		pack: { id: 'pack-medical' }
	},
	heavy: {
		head: { id: 'head-k6' },
		vest: { id: 'vest-heavy' },
		body: { id: 'body-ubacs', tint: 0x6a6e70 },
		legs: { id: 'legs-combat', tint: 0x5a5e62 },
		feet: { id: 'feet-boots', tint: 0x26262a },
		pack: { id: 'pack-military' }
	},
	survivor: {
		head: null,
		vest: null,
		body: { id: 'body-ubacs', tint: 0x9a4a3a },
		legs: { id: 'legs-combat', tint: 0x5a6a8a },
		feet: { id: 'feet-boots', tint: 0x3e3228 },
		pack: null
	}
}

/**
 * Shows the pieces of `outfit` on a cloned soldier and hides the rest; tinted pieces get their own
 * material copies so other soldiers keep their colours.
 */
export function wear(model: THREE.Object3D, outfit: Outfit): void {
	const worn = new Map<string, Piece>()
	for (const piece of [outfit.head, outfit.vest, outfit.body, outfit.legs, outfit.feet, outfit.pack])
		if (piece) worn.set(piece.id, piece)
	model.traverse(object => {
		if (!PIECE.test(object.name)) return
		const piece = worn.get(object.name)
		object.visible = piece !== undefined
		if (piece?.tint === undefined) return
		object.traverse(node => {
			const mesh = node as THREE.Mesh
			if (!mesh.isMesh) return
			const paint = (mesh.material as THREE.MeshStandardMaterial).clone()
			paint.color.setHex(piece.tint as number)
			mesh.material = paint
		})
	})
}
