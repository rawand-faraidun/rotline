import { useEffect, useRef, useState } from 'react'

export type SeatState =
	| { state: 'admitted' }
	| { state: 'pass'; expiresAt: number }
	| { state: 'queued'; position: number; total: number; estimateSeconds: number }
	| { state: 'none' }

const HEARTBEAT_MS = 30_000

async function post<T>(path: string, body?: unknown): Promise<T | null> {
	try {
		const response = await fetch(`/api/queue/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body ?? {})
		})
		return response.ok ? ((await response.json()) as T) : null
	} catch {
		return null
	}
}

/** Takes a seat, or joins the queue when the game is full. Null when the queue cannot be reached. */
export const enterSeat = () => post<SeatState>('enter')

export const leaveSeat = () => post<{ state: 'none' }>('leave')

/** Route guard: players without a seat wait on the queue page. */
export async function requireSeat(): Promise<void> {
	if ((await enterSeat())?.state === 'admitted') return
	location.replace('/queue')
	// the page is leaving; never let the route render
	await new Promise(() => {})
}

/**
 * Keeps the seat while the app is open: a heartbeat every 30 seconds carrying how long the player
 * has been idle. The queue service warns at 10 minutes and releases the seat at 12.
 */
export function useSeatKeeper(): { idleWarning: boolean } {
	const [idleWarning, setIdleWarning] = useState(false)
	const lastActive = useRef(Date.now())
	useEffect(() => {
		const active = () => {
			lastActive.current = Date.now()
			setIdleWarning(false)
		}
		const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
		for (const name of events) addEventListener(name, active, { passive: true })
		const beat = async () => {
			const idleSeconds = Math.round((Date.now() - lastActive.current) / 1000)
			const result = await post<{ state: 'ok' | 'warning' } | { state: 'lost'; reason: 'idle' | 'expired' }>(
				'heartbeat',
				{
					idleSeconds
				}
			)
			if (!result) return
			if (result.state === 'lost') location.replace(`/queue?lost=${result.reason}`)
			else setIdleWarning(result.state === 'warning')
		}
		const timer = setInterval(() => void beat(), HEARTBEAT_MS)
		return () => {
			clearInterval(timer)
			for (const name of events) removeEventListener(name, active)
		}
	}, [])
	return { idleWarning }
}
