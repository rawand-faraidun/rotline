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

/** When this tab last knew it held a seat (from taking one or a heartbeat). */
let admittedAt = 0
/** A seat known that recently is not asked about again on every screen change. */
const KNOWN_SEAT_MS = 60_000

/**
 * Route guard: players without a seat wait on the queue page. Only a definite answer that the player
 * is in the queue sends them there: a hover that preloads a screen asks nothing, a seat confirmed in
 * the last minute is not asked about again, and a failed or refused request (a network blip, a rate
 * limit) leaves the player where they are. The API checks the seat again before any game starts.
 */
export async function requireSeat(preload = false): Promise<void> {
	if (preload || Date.now() - admittedAt < KNOWN_SEAT_MS) return
	const seat = await enterSeat()
	if (seat?.state === 'admitted') {
		admittedAt = Date.now()
		return
	}
	if (seat?.state !== 'queued') return
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
			if (result.state === 'lost') {
				admittedAt = 0
				location.replace(`/queue?lost=${result.reason}`)
			} else {
				admittedAt = Date.now()
				setIdleWarning(result.state === 'warning')
			}
		}
		const timer = setInterval(() => void beat(), HEARTBEAT_MS)
		return () => {
			clearInterval(timer)
			for (const name of events) removeEventListener(name, active)
		}
	}, [])
	return { idleWarning }
}
