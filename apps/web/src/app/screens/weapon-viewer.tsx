import { useEffect, useRef } from 'react'
import { weapons } from '@rotline/game-data'

/** Weapons with a model (others show no viewer). */
const MODELLED = new Set(weapons.map(weapon => weapon.id))

/** A turning 3D view of a weapon; three.js loads only when one is shown. */
export function WeaponViewer({ id, label }: { id: string; label: string }) {
	const canvas = useRef<HTMLCanvasElement>(null)
	const viewer = useRef<{ show(url: string): void; dispose(): void } | null>(null)
	// the viewer is made once, showing the weapon of the moment; the effect below swaps models after
	const shown = useRef(id)
	shown.current = id

	useEffect(() => {
		let cancelled = false
		void import('@rotline/client/viewer').then(({ mountViewer }) => {
			if (cancelled || !canvas.current) return
			viewer.current = mountViewer(canvas.current)
			viewer.current.show(`/assets/models/weapons/${shown.current}.glb`)
		})
		return () => {
			cancelled = true
			viewer.current?.dispose()
			viewer.current = null
		}
	}, [])

	useEffect(() => {
		viewer.current?.show(`/assets/models/weapons/${id}.glb`)
	}, [id])

	if (!MODELLED.has(id)) return null
	return (
		<canvas
			ref={canvas}
			className="frame cut-sm block aspect-[16/9] w-full cursor-grab touch-none [--frame-fill:rgb(13_16_14)] active:cursor-grabbing"
			aria-label={label}
			role="img"
		/>
	)
}
