import type { Database } from '@rotline/db'
import type { Seats } from '@rotline/state'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'

export const CAPACITY_SETTING = 'capacity'

/** Copies database-held settings into Valkey, where the queue service reads them. */
export async function mirrorSettings(db: Database, seats: Seats): Promise<void> {
	const row = await db.adminSetting.findUnique({ where: { key: CAPACITY_SETTING } })
	const capacity = z.number().int().positive().safeParse(row?.value)
	if (capacity.success) await seats.setCapacity(capacity.data)
}

export function adminRoutes({ db, seats }: Services) {
	return new Hono<AppEnv>()
		.use('/admin/*', async (c, next) => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const player = await db.player.findUnique({ where: { userId: user.id }, select: { isAdmin: true } })
			if (!player?.isAdmin) return c.json({ error: 'forbidden' as const }, 403)
			await next()
		})
		.get('/admin/settings', async c => {
			const [capacity, effective, counts] = await Promise.all([
				seats.capacity(),
				seats.effectiveCapacity(),
				seats.counts()
			])
			return c.json({ capacity, effective, ...counts }, 200)
		})
		.put('/admin/capacity', zValidator('json', z.object({ capacity: z.number().int().min(1).max(1000) })), async c => {
			const { capacity } = c.req.valid('json')
			const updatedBy = c.get('user')?.id ?? null
			await db.adminSetting.upsert({
				where: { key: CAPACITY_SETTING },
				create: { key: CAPACITY_SETTING, value: capacity, updatedBy },
				update: { value: capacity, updatedBy }
			})
			await seats.setCapacity(capacity)
			return c.json({ capacity }, 200)
		})
}
