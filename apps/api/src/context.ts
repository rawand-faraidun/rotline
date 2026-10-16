import type { Database } from '@rotline/db'
import type { PartyStore, Valkey } from '@rotline/state'
import type { Logger } from 'pino'
import type { Auth } from './auth.ts'
import type { Env } from './env.ts'
import type { EventHub } from './events.ts'

export type Services = {
	env: Env
	db: Database
	auth: Auth
	log: Logger
	valkey: Valkey
	parties: PartyStore
	events: EventHub
}

export type SessionUser = { id: string; email: string }

export type AppEnv = {
	Variables: {
		user: SessionUser | null
	}
}
