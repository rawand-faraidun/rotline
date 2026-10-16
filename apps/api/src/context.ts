import type { Auth } from '@rotline/auth'
import type { Database } from '@rotline/db'
import type { PartyStore, Seats, Valkey } from '@rotline/state'
import type { Logger } from 'pino'
import type { Env } from './env.ts'
import type { EventHub } from './events.ts'

export type Services = {
	env: Env
	db: Database
	auth: Auth
	log: Logger
	valkey: Valkey
	parties: PartyStore
	seats: Seats
	events: EventHub
}

export type SessionUser = { id: string; email: string }

export type AppEnv = {
	Variables: {
		user: SessionUser | null
	}
}
