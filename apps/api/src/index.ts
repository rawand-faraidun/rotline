import { hostname } from 'node:os'
import { createAuth } from '@rotline/auth'
import { createDatabase } from '@rotline/db'
import { createValkey, PartyStore, Seats } from '@rotline/state'
import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { createApp } from './app.ts'
import { readEnv } from './env.ts'
import { EventHub } from './events.ts'
import { RewardWorker } from './rewards.ts'
import { mirrorSettings } from './routes/admin.ts'

const env = readEnv()
const log = pino({
	level: env.LOG_LEVEL,
	...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {})
})
const db = createDatabase(env.DATABASE_URL)
const auth = createAuth(env, db)
const valkey = createValkey(env.VALKEY_URL, 'rotline-api')
const events = new EventHub(env.VALKEY_URL)
const seats = new Seats(valkey)
const app = createApp({ env, db, auth, log, valkey, parties: new PartyStore(valkey), seats, events })

// Valkey is rebuildable: the admin capacity setting lives in the database and is mirrored there
await mirrorSettings(db, seats).catch(error => log.error({ err: error }, 'could not mirror admin settings'))

const rewards = new RewardWorker(db, valkey, env.VALKEY_URL, log, `${hostname()}-${process.pid}`)
await rewards.start()

const server = serve({ fetch: app.fetch, port: env.API_PORT }, info => {
	log.info({ port: info.port }, 'api listening')
})

const shutdown = async (signal: string) => {
	log.info({ signal }, 'shutting down')
	server.close()
	await rewards.stop()
	await db.$disconnect()
	await Promise.allSettled([valkey.quit(), events.close()])
	process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
