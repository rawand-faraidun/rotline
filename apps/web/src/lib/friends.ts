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
	}
})

export type FriendProblem = 'not-found' | 'not-friends' | 'full' | 'in-mission'

async function send(path: string, body: unknown): Promise<{ status: string } | { error: FriendProblem }> {
	const response = await fetch(`/api/friends/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})
	return (await response.json()) as { status: string } | { error: FriendProblem }
}

export const friendActions = {
	request: (name: string) => send('request', { name }),
	accept: (userId: string) => send('accept', { userId }),
	remove: (userId: string) => send('remove', { userId }),
	block: (userId: string) => send('block', { userId }),
	unblock: (userId: string) => send('unblock', { userId }),
	invite: (userId: string) => send('invite', { userId }),
	join: (userId: string) => send('join', { userId })
}
