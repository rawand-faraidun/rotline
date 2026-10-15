import type { AppType } from '@rotline/api'
import { hc } from 'hono/client'

export const api = hc<AppType>('/')

export type SignInProvider = 'github' | 'google' | 'test'

export type Me =
	| { status: 'signed-out' }
	| {
			status: 'signed-in'
			user: { id: string; email: string }
			player: {
				name: string
				avatarStyle: string
				avatarSeed: string
				activeClass: 'assault' | 'medic' | 'heavy'
				salvage: number
			} | null
	  }

export async function fetchMe(): Promise<Me> {
	const response = await api.api.me.$get()
	if (response.status === 401) return { status: 'signed-out' }
	const body = await response.json()
	return { status: 'signed-in', ...body } as Me
}

export async function fetchProviders(): Promise<SignInProvider[]> {
	const response = await api.api.config.$get()
	if (!response.ok) throw new Error(`config: ${response.status}`)
	return (await response.json()).providers
}

/** Starts the OAuth flow; the browser leaves the page. */
export async function signIn(provider: SignInProvider): Promise<void> {
	const response = await fetch('/api/auth/sign-in/social', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ provider, callbackURL: `${location.origin}/play` })
	})
	const body = (await response.json()) as { url?: string }
	if (!body.url) throw new Error('sign-in did not return a provider URL')
	location.assign(body.url)
}

export async function signOut(): Promise<void> {
	await fetch('/api/auth/sign-out', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}'
	})
}
