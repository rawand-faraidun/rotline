import { createDatabase } from '@rotline/db'
import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { createApp } from './app.ts'
import { createAuth } from './auth.ts'
import { readEnv } from './env.ts'

const env = readEnv()
const log = pino({
	level: env.LOG_LEVEL,
	...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {})
})
const db = createDatabase(env.DATABASE_URL)
const auth = createAuth(env, db)
const app = createApp({ env, db, auth, log })

const server = serve({ fetch: app.fetch, port: env.API_PORT }, info => {
	log.info({ port: info.port }, 'api listening')
})

const shutdown = async (signal: string) => {
	log.info({ signal }, 'shutting down')
	server.close()
	await db.$disconnect()
	process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
