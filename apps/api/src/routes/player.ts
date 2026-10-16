import { AVATAR_SEED_MAX, AVATAR_STYLES } from '@rotline/constants'
import { Prisma } from '@rotline/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { grantStarterKit } from '../lib/build.ts'
import { checkPlayerName, playerNameKey } from '../lib/player-name.ts'

const createPlayer = z.object({
	name: z.string().trim(),
	avatarStyle: z.enum(AVATAR_STYLES),
	avatarSeed: z.string().trim().min(1).max(AVATAR_SEED_MAX)
})

const updateAvatar = createPlayer.omit({ name: true })

export function playerRoutes({ db }: Services) {
	const toProfile = (player: {
		name: string
		avatarStyle: string
		avatarSeed: string
		activeClass: string
		salvage: bigint
		isAdmin: boolean
	}) => ({
		name: player.name,
		avatarStyle: player.avatarStyle,
		avatarSeed: player.avatarSeed,
		activeClass: player.activeClass,
		salvage: Number(player.salvage),
		isAdmin: player.isAdmin
	})

	return new Hono<AppEnv>()
		.get('/me', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const player = await db.player.findUnique({ where: { userId: user.id } })
			return c.json({ user: { id: user.id, email: user.email }, player: player ? toProfile(player) : null }, 200)
		})
		.get('/player/name-check', zValidator('query', z.object({ name: z.string() })), async c => {
			const { name } = c.req.valid('query')
			const problem = checkPlayerName(name)
			if (problem) return c.json({ available: false, problem }, 200)
			const taken = await db.player.findUnique({ where: { nameKey: playerNameKey(name) }, select: { userId: true } })
			return c.json(taken ? { available: false, problem: 'taken' as const } : { available: true, problem: null }, 200)
		})
		.post('/player', zValidator('json', createPlayer), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const input = c.req.valid('json')
			const problem = checkPlayerName(input.name)
			if (problem) return c.json({ error: 'invalid-name' as const, problem }, 422)
			try {
				// the player, their three classes and the starter kit arrive together
				const player = await db.$transaction(async tx => {
					const created = await tx.player.create({
						data: {
							userId: user.id,
							name: input.name,
							nameKey: playerNameKey(input.name),
							avatarStyle: input.avatarStyle,
							avatarSeed: input.avatarSeed
						}
					})
					await grantStarterKit(tx, user.id)
					return created
				})
				return c.json({ player: toProfile(player) }, 201)
			} catch (error) {
				if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
					// Unique violation: either this user already has a player, or the name is taken
					const existing = await db.player.findUnique({ where: { userId: user.id }, select: { userId: true } })
					return existing
						? c.json({ error: 'already-exists' as const }, 409)
						: c.json({ error: 'invalid-name' as const, problem: 'taken' as const }, 409)
				}
				throw error
			}
		})
		.patch('/player/avatar', zValidator('json', updateAvatar), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const input = c.req.valid('json')
			const result = await db.player.updateMany({ where: { userId: user.id }, data: input })
			if (result.count === 0) return c.json({ error: 'no-player' as const }, 404)
			return c.json({ ok: true }, 200)
		})
}
