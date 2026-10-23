import { useEffect, useRef } from 'react'
import type { DifficultyId } from '@rotline/game-data'
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'
import { friendsQuery } from './friends.ts'
import { progressQuery } from './progress.ts'

export type PartyMember = {
	id: string
	name: string
	avatarStyle: string
	avatarSeed: string
	activeClass: 'assault' | 'medic' | 'heavy'
	level: number
	ready: boolean
	leader: boolean
}

export type PartyView = {
	id: string
	code: string
	state: 'lobby' | 'mission'
	/** what the leader chose for the next mission */
	mission: { id: string; difficulty: DifficultyId }
	you: string
	leader: string
	members: PartyMember[]
	canStart: boolean
}

export type PartyProblem =
	| 'not-found'
	| 'full'
	| 'in-mission'
	| 'not-leader'
	| 'not-ready'
	| 'not-member'
	| 'changed'
	| 'elsewhere'
	| 'locked'
	| 'cooldown'

export const partyQuery = queryOptions({
	queryKey: ['party'],
	queryFn: async (): Promise<PartyView> => {
		const response = await api.api.party.$get()
		if (response.status !== 200) throw new Error(`party ${response.status}`)
		return (await response.json()) as PartyView
	}
})

async function send(path: string, body?: unknown): Promise<PartyView | { error: PartyProblem }> {
	const response = await fetch(`/api/party/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body ?? {})
	})
	return (await response.json()) as PartyView | { error: PartyProblem }
}

/** A player's records on one mission, one per difficulty played. */
export type MissionRecord = {
	id: string
	/** opened in the campaign (the mission before it is done) */
	open: boolean
	difficulties: {
		difficulty: DifficultyId
		completions: number
		bestTimeMs: number | null
		bestScore: number
		/** 0 none, 1 bronze, 2 silver, 3 gold */
		mastery: number
	}[]
}

/** The best mastery and the best time across difficulties. */
export function bestOf(record: MissionRecord | undefined): {
	mastery: number
	bestTimeMs: number | null
	completions: number
} {
	let mastery = 0
	let bestTimeMs: number | null = null
	let completions = 0
	for (const entry of record?.difficulties ?? []) {
		mastery = Math.max(mastery, entry.mastery)
		completions += entry.completions
		if (entry.bestTimeMs !== null && (bestTimeMs === null || entry.bestTimeMs < bestTimeMs))
			bestTimeMs = entry.bestTimeMs
	}
	return { mastery, bestTimeMs, completions }
}

export const missionsQuery = queryOptions({
	queryKey: ['missions'],
	queryFn: async (): Promise<MissionRecord[]> => {
		const response = await fetch('/api/missions')
		if (response.status !== 200) throw new Error(`missions ${response.status}`)
		return (await response.json()) as MissionRecord[]
	}
})

export type Ticket = {
	ticket: string
	path: string
	/** a direct address for the game connection, tried before `path` on the site itself */
	direct?: string | null
	mission: { id: string; difficulty: DifficultyId } | null
}

export async function fetchTicket(): Promise<Ticket | null> {
	const response = await fetch('/api/game/ticket', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}'
	})
	if (response.status !== 200) return null
	return (await response.json()) as Ticket
}

/** A ticket into the firing range (a solo room that earns nothing). */
export async function fetchRangeTicket(): Promise<Ticket | null> {
	const response = await fetch('/api/game/range', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}'
	})
	if (response.status !== 200) return null
	return { ...((await response.json()) as Omit<Ticket, 'mission'>), mission: null }
}

export const partyActions = {
	join: (code: string) => send('join', { code }),
	leave: () => send('leave'),
	kick: (userId: string) => send('kick', { userId }),
	/** `seen`: the mission the player is looking at; the server refuses if it has changed meanwhile */
	ready: (ready: boolean, seen?: PartyView['mission']) =>
		send('ready', { ready, ...(seen ? { seen: { mission: seen.id, difficulty: seen.difficulty } } : {}) }),
	start: (seen?: PartyView['mission']) =>
		send('start', seen ? { seen: { mission: seen.id, difficulty: seen.difficulty } } : {}),
	/** leave the mission for good: a squad of one ends it, otherwise the player leaves the squad */
	abandon: () => send('abandon'),
	mission: (mission: string, difficulty: DifficultyId) => send('mission', { mission, difficulty })
}

export type Invite = { from: string; code: string }

/** Listens to the API's event stream and refreshes whatever changed. Reconnects on its own. */
export function usePlayerEvents(onInvite?: (invite: Invite) => void): void {
	const queryClient = useQueryClient()
	const inviteHandler = useRef(onInvite)
	inviteHandler.current = onInvite
	useEffect(() => {
		const source = new EventSource('/api/events')
		const refreshParty = () => void queryClient.invalidateQueries({ queryKey: partyQuery.queryKey })
		const refreshFriends = () => void queryClient.invalidateQueries({ queryKey: friendsQuery.queryKey })
		source.addEventListener('party', refreshParty)
		source.addEventListener('friends', refreshFriends)
		source.addEventListener('presence', refreshFriends)
		// rewards from a mission (XP, levels, Salvage)
		source.addEventListener('progress', () => {
			void queryClient.invalidateQueries({ queryKey: progressQuery.queryKey })
			void queryClient.invalidateQueries({ queryKey: missionsQuery.queryKey })
			// squad cards show class levels
			refreshParty()
		})
		source.addEventListener('invite', event => {
			const invite = JSON.parse((event as MessageEvent<string>).data) as Invite
			inviteHandler.current?.(invite)
		})
		// after a reconnect anything may have changed
		source.addEventListener('hello', () => {
			refreshParty()
			refreshFriends()
			void queryClient.invalidateQueries({ queryKey: progressQuery.queryKey })
		})
		return () => source.close()
	}, [queryClient])
}
