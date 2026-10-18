// Moves animation clips from the Universal Animation Library files onto a character's skeleton.
import { join } from 'node:path'
import type { Document, Node, NodeIO, Scene } from '@gltf-transform/core'
import { mergeDocuments } from '@gltf-transform/functions'
import { itchDownload } from './sources.ts'

export type Pack = { creator: string; game: string; file: string; glb: string }
export type Pick = { pack: string; clip: string; as: string }

/**
 * Brings the chosen clips into `document`, retargeted by bone name onto `joints`. Bones keep the
 * character's lengths: only rotations move, plus the hips' height. Fingers move only in clips
 * whose name starts with `fingers` (the gun grips); a top-down camera cannot see them otherwise.
 */
export async function mergeClips(
	io: NodeIO,
	document: Document,
	joints: Map<string, Node>,
	packs: Record<string, Pack>,
	picks: readonly Pick[],
	fingers = 'Pistol_'
): Promise<void> {
	const root = document.getRoot()
	for (const [name, pack] of Object.entries(packs)) {
		const chosen = picks.filter(entry => entry.pack === name)
		if (chosen.length === 0) continue
		const library = await io.read(join(await itchDownload(pack.creator, pack.game, pack.file), pack.glb))
		const libraryRoot = library.getRoot()
		for (const animation of libraryRoot.listAnimations()) {
			const pick = chosen.find(entry => entry.clip === animation.getName())
			if (!pick) {
				// samplers outlive their animation and would keep its keyframes in the file
				for (const sampler of animation.listSamplers()) sampler.dispose()
				animation.dispose()
				continue
			}
			animation.setName(pick.as)
			for (const channel of animation.listChannels()) {
				const path = channel.getTargetPath()
				const bone = channel.getTargetNode()?.getName() ?? ''
				const finger = /^(index|middle|pinky|ring|thumb)_/.test(bone)
				if (
					path === 'scale' ||
					(path === 'translation' && bone !== 'pelvis') ||
					(finger && !pick.as.startsWith(fingers))
				) {
					channel.getSampler()?.dispose()
					channel.dispose()
				}
			}
		}
		const libraryScenes = libraryRoot.listScenes()
		const merged = mergeDocuments(document, library)
		for (const animation of root.listAnimations())
			for (const channel of animation.listChannels()) {
				const target = channel.getTargetNode()
				const own = target && joints.get(target.getName())
				if (own && own !== target) channel.setTargetNode(own)
			}
		for (const scene of libraryScenes) {
			const copy = merged.get(scene) as Scene
			for (const node of copy.listChildren()) node.traverse(child => child.dispose())
			copy.dispose()
		}
	}
}
