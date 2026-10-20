import { useEffect, useRef } from 'react'
import type { LobbyHandle, LobbyMember, LobbyView } from '@rotline/client/lobby'

/**
 * The lobby's 3D scene: the squad standing ready behind the menus, or (`portrait`) one soldier close
 * up that the player turns by dragging. three.js loads with it.
 */
export function LobbyBackdrop({
	members,
	view = 'squad',
	turn = 0
}: {
	members: readonly LobbyMember[]
	view?: LobbyView
	turn?: number
}) {
	const canvas = useRef<HTMLCanvasElement>(null)
	const lobby = useRef<LobbyHandle | null>(null)
	const latest = useRef(members)
	latest.current = members
	const turnRef = useRef(turn)
	turnRef.current = turn

	useEffect(() => {
		let cancelled = false
		void import('@rotline/client/lobby').then(({ mountLobby }) => {
			if (cancelled || !canvas.current) return
			lobby.current = mountLobby(canvas.current, '/assets', view)
			lobby.current.setSquad(latest.current)
			lobby.current.setTurn(turnRef.current)
		})
		return () => {
			cancelled = true
			lobby.current?.dispose()
			lobby.current = null
		}
	}, [view])

	useEffect(() => {
		lobby.current?.setSquad(members)
	}, [members])

	useEffect(() => {
		lobby.current?.setTurn(turn)
	}, [turn])

	return (
		<div className="absolute inset-0" aria-hidden="true">
			<canvas ref={canvas} className="block h-full w-full" />
		</div>
	)
}
