import { createDatabase } from '@rotline/db'
import { createValkey, PartyStore } from '@rotline/state'
import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { createApp } from './app.ts'
import { createAuth } from './auth.ts'
import { readEnv } from './env.ts'
import { EventHub } from './events.ts'

const env = readEnv()
const log = pino({
	level: env.LOG_LEVEL,
	...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {})
})
const db = createDatabase(env.DATABASE_URL)
const auth = createAuth(env, db)
const valkey = createValkey(env.VALKEY_URL, 'rotline-api')
const events = new EventHub(env.VALKEY_URL)
const app = createApp({ env, db, auth, log, valkey, parties: new PartyStore(valkey), events })

const server = serve({ fetch: app.fetch, port: env.API_PORT }, info => {
	log.info({ port: info.port }, 'api listening')
})

const shutdown = async (signal: string) => {
	log.info({ signal }, 'shutting down')
	server.close()
	await db.$disconnect()
	await Promise.allSettled([valkey.quit(), events.close()])
	process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
