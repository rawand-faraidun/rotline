import { describe, expect, it } from 'vitest'
import { readEnv } from '../../src/env.ts'

const base = {
	DATABASE_URL: 'postgresql://u:p@localhost:6440/rotline',
	VALKEY_URL: 'redis://localhost:6379',
	PUBLIC_ORIGIN: 'http://localhost:4321',
	BETTER_AUTH_SECRET: 'x'.repeat(32),
	GAME_TICKET_PRIVATE_KEY: 'k'.repeat(48),
	GAME_REWARD_PUBLIC_KEY: 'p'.repeat(48)
}

describe('readEnv', () => {
	it('applies defaults', () => {
		const env = readEnv(base)
		expect(env.API_PORT).toBe(3100)
		expect(env.NODE_ENV).toBe('development')
	})

	it('treats empty provider credentials as missing', () => {
		expect(readEnv({ ...base, GITHUB_CLIENT_ID: '' }).GITHUB_CLIENT_ID).toBeUndefined()
	})

	it('lists every invalid variable', () => {
		expect(() => readEnv({ PUBLIC_ORIGIN: 'nope' })).toThrow(
			/DATABASE_URL[\s\S]*PUBLIC_ORIGIN[\s\S]*BETTER_AUTH_SECRET/
		)
	})

	it('refuses the test sign-in provider in production', () => {
		expect(() =>
			readEnv({ ...base, NODE_ENV: 'production', AUTH_TEST_PROVIDER_ISSUER: 'http://localhost:8090/rotline' })
		).toThrow(/production/)
	})
})
