import { pino } from 'pino'
import { readGameEnv } from './env.ts'
import { GameServer } from './server.ts'

const env = readGameEnv()
const log = pino({
	level: env.LOG_LEVEL,
	...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {})
})
const server = new GameServer(env, log)
const port = await server.listen()
log.info({ port, instance: env.GAME_INSTANCE_ID }, 'game server listening')

const shutdown = (signal: string) => {
	log.info({ signal }, 'shutting down')
	server.close()
	process.exit(0)
}
// SIGUSR2: drain (take no new rooms, finish current missions); a deploy sends this to the old version
process.on('SIGUSR2', () => {
	log.info('draining')
	server.onDrained = () => shutdown('drained')
	server.drain()
})
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
