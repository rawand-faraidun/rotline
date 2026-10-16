import { useEffect } from 'react'
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'

export type PartyMember = {
	id: string
	name: string
	avatarStyle: string
	avatarSeed: string
	activeClass: 'assault' | 'medic' | 'heavy'
	ready: boolean
	leader: boolean
}

export type PartyView = {
	id: string
	code: string
	state: 'lobby' | 'mission'
	you: string
	leader: string
	members: PartyMember[]
	canStart: boolean
}

export type PartyProblem = 'not-found' | 'full' | 'in-mission' | 'not-leader' | 'not-ready' | 'not-member'

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

export async function fetchTicket(): Promise<{ ticket: string; path: string } | null> {
	const response = await fetch('/api/game/ticket', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}'
	})
	if (response.status !== 200) return null
	return (await response.json()) as { ticket: string; path: string }
}

export const partyActions = {
	join: (code: string) => send('join', { code }),
	leave: () => send('leave'),
	kick: (userId: string) => send('kick', { userId }),
	ready: (ready: boolean) => send('ready', { ready }),
	start: () => send('start')
}

/** Listens to the API's event stream and refreshes whatever changed. Reconnects on its own. */
export function usePlayerEvents(): void {
	const queryClient = useQueryClient()
	useEffect(() => {
		const source = new EventSource('/api/events')
		const refreshParty = () => void queryClient.invalidateQueries({ queryKey: partyQuery.queryKey })
		source.addEventListener('party', refreshParty)
		// after a reconnect anything may have changed
		source.addEventListener('hello', refreshParty)
		return () => source.close()
	}, [queryClient])
}
