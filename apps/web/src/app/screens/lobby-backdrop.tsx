import { useEffect, useRef } from 'react'
import type { LobbyHandle, LobbyMember } from '@rotline/client/lobby'

/** The lobby's 3D scene behind the menus: the squad standing ready. three.js loads with it. */
export function LobbyBackdrop({ members }: { members: readonly LobbyMember[] }) {
	const canvas = useRef<HTMLCanvasElement>(null)
	const lobby = useRef<LobbyHandle | null>(null)
	const latest = useRef(members)
	latest.current = members

	useEffect(() => {
		let cancelled = false
		void import('@rotline/client/lobby').then(({ mountLobby }) => {
			if (cancelled || !canvas.current) return
			lobby.current = mountLobby(canvas.current)
			lobby.current.setSquad(latest.current)
		})
		return () => {
			cancelled = true
			lobby.current?.dispose()
			lobby.current = null
		}
	}, [])

	useEffect(() => {
		lobby.current?.setSquad(members)
	}, [members])

	return (
		<div className="absolute inset-0" aria-hidden="true">
			<canvas ref={canvas} className="block h-full w-full" />
		</div>
	)
}
