import { queryOptions } from '@tanstack/react-query'

export type PresenceStatus = 'lobby' | 'mission' | 'queue' | 'range' | 'offline'

export type FriendCard = {
	id: string
	name: string
	avatarStyle: string
	avatarSeed: string
	activeClass: 'assault' | 'medic' | 'heavy'
}

export type FriendsView = {
	/** the player's own code, to hand out (8 characters, shown as XXXX-XXXX) */
	code: string
	friends: (FriendCard & { presence: { status: PresenceStatus; detail: string } })[]
	incoming: FriendCard[]
	outgoing: FriendCard[]
	blocked: FriendCard[]
	recent: (FriendCard & { playedAt: string })[]
}

export const friendsQuery = queryOptions({
	queryKey: ['friends'],
	queryFn: async (): Promise<FriendsView> => {
		const response = await fetch('/api/friends')
		if (response.status !== 200) throw new Error(`friends ${response.status}`)
		return (await response.json()) as FriendsView
	},
	// friends coming online arrive on the event stream; this catches anything missed
	refetchInterval: 30_000
})

export type FriendProblem = 'not-found' | 'not-friends' | 'full' | 'in-mission'

/** "A1B2C3D4" as "A1B2-C3D4", easier to read out and type. */
export const formatCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code)

/** A player code as typed or pasted, or null if the text cannot be one. */
export function asPlayerCode(text: string): string | null {
	const code = text.replace(/[\s-]/g, '').toUpperCase()
	return /^[0-9A-F]{8}$/.test(code) ? code : null
}

/** The link that adds a player as a friend when opened. */
export const friendLink = (code: string): string => `${location.origin}/play/lobby?friend=${code}`

export type Relation = 'none' | 'friend' | 'incoming' | 'outgoing'
export type FoundPlayer = FriendCard & { relation: Relation }

/** Players by part of their name, a close spelling, or their code. */
export async function searchPlayers(query: string): Promise<FoundPlayer[]> {
	const response = await fetch(`/api/friends/search?q=${encodeURIComponent(query)}`)
	if (response.status !== 200) return []
	return ((await response.json()) as { players: FoundPlayer[] }).players
}

async function send(path: string, body: unknown): Promise<{ status: string } | { error: FriendProblem }> {
	const response = await fetch(`/api/friends/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})
	return (await response.json()) as { status: string } | { error: FriendProblem }
}

export const friendActions = {
	/** by name or player code, whichever the text is (the server tries the name first) */
	request: (nameOrCode: string) => send('request', { name: nameOrCode }),
	/** from a shared link: by code only */
	requestByCode: (code: string) => send('request', { code }),
	accept: (userId: string) => send('accept', { userId }),
	remove: (userId: string) => send('remove', { userId }),
	block: (userId: string) => send('block', { userId }),
	unblock: (userId: string) => send('unblock', { userId }),
	invite: (userId: string) => send('invite', { userId }),
	join: (userId: string) => send('join', { userId })
}
