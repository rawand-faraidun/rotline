import type { Database } from '@rotline/db'
import type { Logger } from 'pino'
import type { Auth } from './auth.ts'
import type { Env } from './env.ts'

export type Services = {
	env: Env
	db: Database
	auth: Auth
	log: Logger
}

export type SessionUser = { id: string; email: string }

export type AppEnv = {
	Variables: {
		user: SessionUser | null
	}
}
