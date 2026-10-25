import { enabledProviders } from '@rotline/auth'
import { allow } from '@rotline/state'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv, Services } from './context.ts'
import { adminRoutes } from './routes/admin.ts'
import { friendRoutes } from './routes/friends.ts'
import { partyRoutes } from './routes/party.ts'
import { playerRoutes } from './routes/player.ts'
import { progressRoutes } from './routes/progress.ts'

/** Limits by path: player search, progress changes, game tickets, and everything else social. */
function writeLimit(path: string): { name: string; count: number; windowMs: number } | null {
	if (path === '/api/friends/search') return { name: 'search', count: 30, windowMs: 10_000 }
	if (path.startsWith('/api/progress/')) return { name: 'progress', count: 20, windowMs: 1000 }
	if (path.startsWith('/api/game/')) return { name: 'game', count: 6, windowMs: 10_000 }
	if (path.startsWith('/api/party') || path.startsWith('/api/friends'))
		return { name: 'social', count: 20, windowMs: 10_000 }
	return null
}

export function createApp(services: Services) {
	const { auth, db, env, log } = services

	const api = new Hono<AppEnv>()
		.basePath('/api')
		.use(secureHeaders())
		// cookies are SameSite=Lax; also refuse state-changing requests from other origins
		.use(async (c, next) => {
			const safe = c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS'
			const requestOrigin = c.req.header('origin')
			if (!safe && requestOrigin !== undefined && requestOrigin !== env.PUBLIC_ORIGIN) {
				return c.json({ error: 'forbidden-origin' }, 403)
			}
			await next()
		})
		.use(async (c, next) => {
			const session = await auth.api.getSession({ headers: c.req.raw.headers })
			c.set('user', session ? { id: session.user.id, email: session.user.email } : null)
			await next()
		})
		// per-player limits on writes, so one client cannot flood the database or the game servers
		.use(async (c, next) => {
			const user = c.get('user')
			const write = c.req.method === 'POST' || c.req.method === 'PUT'
			// searching for players reads, but each search is a database query: it is limited too
			const limit = user && (write || c.req.path === '/api/friends/search') ? writeLimit(c.req.path) : null
			if (limit && !(await allow(services.valkey, `rl:${limit.name}:${user?.id}`, limit.count, limit.windowMs))) {
				return c.json({ error: 'slow-down' as const }, 429)
			}
			await next()
		})
		.on(['GET', 'POST'], '/auth/*', c => auth.handler(c.req.raw))
		.get('/config', c => c.json({ providers: enabledProviders(env) }, 200))
		.get('/health', async c => {
			try {
				await db.$queryRaw`select 1`
				return c.json({ status: 'ok' as const }, 200)
			} catch (error) {
				log.error({ err: error }, 'health check failed')
				return c.json({ status: 'error' as const }, 503)
			}
		})
		.route('/', playerRoutes(services))
		.route('/', partyRoutes(services))
		.route('/', friendRoutes(services))
		.route('/', adminRoutes(services))
		.route('/', progressRoutes(services))

	api.onError((error, c) => {
		log.error({ err: error, path: c.req.path }, 'unhandled error')
		return c.json({ error: 'internal' }, 500)
	})

	return api
}

export type App = ReturnType<typeof createApp>
