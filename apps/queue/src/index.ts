import { hostname } from 'node:os'
import { createAuth } from '@rotline/auth'
import { createDatabase } from '@rotline/db'
import { createValkey, Seats } from '@rotline/state'
import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { createQueueApp } from './app.ts'
import { readQueueEnv } from './env.ts'
import { startTicker } from './ticker.ts'

const env = readQueueEnv()
const log = pino({
	level: env.LOG_LEVEL,
	...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {})
})
const db = createDatabase(env.DATABASE_URL)
const valkey = createValkey(env.VALKEY_URL, 'rotline-queue')
const seats = new Seats(valkey)
const app = createQueueApp({ auth: createAuth(env, db), db, seats, valkey, origin: env.PUBLIC_ORIGIN })
const stopTicker = startTicker(valkey, seats, log, `${hostname()}-${process.pid}`)
const server = serve({ fetch: app.fetch, port: env.QUEUE_PORT }, info =>
	log.info({ port: info.port }, 'queue listening')
)

const shutdown = async () => {
	stopTicker()
	server.close()
	await Promise.allSettled([valkey.quit(), db.$disconnect()])
	process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
