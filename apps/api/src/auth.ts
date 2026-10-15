import type { Database } from '@rotline/db'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import type { Env } from './env.ts'

export const TEST_PROVIDER_ID = 'test'

export type SignInProvider = 'github' | 'google' | typeof TEST_PROVIDER_ID

/** Providers that have credentials configured, in the order the sign-in page shows them. */
export function enabledProviders(env: Env): SignInProvider[] {
	const list: SignInProvider[] = []
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) list.push('github')
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) list.push('google')
	if (env.AUTH_TEST_PROVIDER_ISSUER) list.push(TEST_PROVIDER_ID)
	return list
}

export function createAuth(env: Env, db: Database) {
	const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {}
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		socialProviders.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
	}
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
	}

	const plugins = env.AUTH_TEST_PROVIDER_ISSUER
		? [
				genericOAuth({
					config: [
						{
							providerId: TEST_PROVIDER_ID,
							discoveryUrl: `${env.AUTH_TEST_PROVIDER_ISSUER}/.well-known/openid-configuration`,
							clientId: env.AUTH_TEST_PROVIDER_CLIENT_ID ?? 'rotline-local',
							clientSecret: env.AUTH_TEST_PROVIDER_CLIENT_SECRET ?? 'rotline-local',
							scopes: ['openid', 'email', 'profile'],
							pkce: true
						}
					]
				})
			]
		: []

	return betterAuth({
		appName: 'Rotline',
		baseURL: env.PUBLIC_ORIGIN,
		basePath: '/api/auth',
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.PUBLIC_ORIGIN],
		database: prismaAdapter(db, { provider: 'postgresql' }),
		socialProviders,
		plugins,
		session: {
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24
		},
		account: {
			// A second provider is linked only by a signed-in player from settings, never by matching email
			accountLinking: { enabled: true, disableImplicitLinking: true }
		},
		advanced: {
			database: { generateId: 'uuid' },
			useSecureCookies: env.NODE_ENV === 'production'
		},
		databaseHooks: {
			// Keep only what the game needs from the provider: no real name, no photo, no tokens
			user: {
				create: {
					before: async user => ({ data: { ...user, name: '', image: null } })
				},
				update: {
					before: async user => ({ data: { ...user, name: '', image: null } })
				}
			},
			account: {
				create: {
					before: async account => ({
						data: { ...account, accessToken: null, refreshToken: null, idToken: null }
					})
				},
				update: {
					before: async account => ({
						data: { ...account, accessToken: null, refreshToken: null, idToken: null }
					})
				}
			}
		}
	})
}

export type Auth = ReturnType<typeof createAuth>
