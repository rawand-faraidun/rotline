import { useEffect, useRef } from 'react'
import type { ShowOptions, ViewerHandle } from '@rotline/client/viewer'
import { weapons } from '@rotline/game-data'
import { cn } from '@rotline/ui'

/** Weapons with a model (others show no viewer). */
const MODELLED = new Set(weapons.map(weapon => weapon.id))

/** A turning 3D view of one model; three.js loads only when a viewer is shown. */
function ModelViewer({
	url,
	options,
	label,
	className
}: {
	url: string
	options?: ShowOptions
	label: string
	className?: string
}) {
	const canvas = useRef<HTMLCanvasElement>(null)
	const viewer = useRef<ViewerHandle | null>(null)
	// the viewer is made once, showing the model of the moment; the effect below swaps models after
	const shown = useRef({ url, options })
	shown.current = { url, options }

	useEffect(() => {
		let cancelled = false
		void import('@rotline/client/viewer').then(({ mountViewer }) => {
			if (cancelled || !canvas.current) return
			viewer.current = mountViewer(canvas.current)
			viewer.current.show(shown.current.url, shown.current.options)
		})
		return () => {
			cancelled = true
			viewer.current?.dispose()
			viewer.current = null
		}
	}, [])

	const only = options?.only
	const clip = options?.clip
	useEffect(() => {
		viewer.current?.show(url, { only, clip })
	}, [url, only, clip])

	return (
		<canvas
			ref={canvas}
			className={cn(
				'frame cut-sm block w-full cursor-grab touch-none [--frame-fill:rgb(13_16_14)] active:cursor-grabbing',
				className
			)}
			aria-label={label}
			role="img"
		/>
	)
}

/** A weapon's model, turning side on. */
export function WeaponViewer({ id, label }: { id: string; label: string }) {
	if (!MODELLED.has(id)) return null
	return <ModelViewer url={`/assets/models/weapons/${id}.glb`} label={label} className="aspect-[16/9]" />
}

/** A class's soldier, standing at ease. */
export function CharacterViewer({ classId, label }: { classId: string; label: string }) {
	return (
		<ModelViewer
			url="/assets/models/characters/soldier.glb"
			options={{ only: classId, clip: 'Idle_Loop' }}
			label={label}
			className="aspect-[4/3]"
		/>
	)
}
