import { type Database, ItemSource, LedgerReason, PlayerClass, Prisma } from '@rotline/db'
import {
	abilitySlotsAtLevel,
	allocationProblem,
	type ClassId,
	classId,
	discardValue,
	economy,
	item,
	itemById,
	levelFromXp,
	perkOptions,
	pointsAtLevel,
	skillNodes,
	spentPoints,
	upgradeCost,
	upgradeTotal,
	validateAbilities
} from '@rotline/game-data'
import { notify } from '@rotline/state'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono, type Next } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { grantStarterKit } from '../lib/build.ts'
import { changeSalvage, lockPlayer, NotEnoughSalvage, type Tx } from '../lib/ledger.ts'

/** A rule the request broke; turned into a 409 with this code. */
export class Refused extends Error {
	readonly code: string
	readonly details: Record<string, unknown>
	constructor(code: string, details: Record<string, unknown> = {}) {
		super(code)
		this.code = code
		this.details = details
	}
}

const itemId = z.string().regex(/^[a-z0-9-]+$/)

/** Everything the lobby, skills, armory and shop screens show, in one read. */
export async function progressView(db: Database, playerId: string, inMission: boolean) {
	await ensureStarterKit(db, playerId)
	const player = await db.player.findUnique({
		where: { userId: playerId },
		include: {
			classes: true,
			skills: true,
			abilities: true,
			inventory: { orderBy: { acquiredAt: 'asc' } },
			duplicates: { orderBy: { foundAt: 'asc' } },
			loadout: true
		}
	})
	if (!player?.loadout) return null
	const classes = Object.fromEntries(
		Object.values(PlayerClass).map(cls => {
			const xp = Number(player.classes.find(entry => entry.class === cls)?.xp ?? 0)
			const { level, into, next } = levelFromXp(xp)
			const skills = Object.fromEntries(
				player.skills.filter(skill => skill.class === cls).map(skill => [skill.nodeId, skill.rank])
			)
			return [
				cls,
				{
					xp,
					level,
					into,
					next,
					points: pointsAtLevel(level),
					spent: spentPoints(skills),
					skills,
					abilities: player.abilities
						.filter(slot => slot.class === cls)
						.sort((a, b) => a.slot - b.slot)
						.map(slot => slot.abilityId),
					slots: abilitySlotsAtLevel(level)
				}
			]
		})
	) as Record<
		ClassId,
		{
			xp: number
			level: number
			into: number
			next: number | null
			points: number
			spent: number
			skills: Record<string, number>
			abilities: string[]
			slots: number
		}
	>
	const { loadout } = player
	return {
		activeClass: player.activeClass as ClassId,
		salvage: Number(player.salvage),
		inMission,
		classes,
		inventory: player.inventory.map(entry => ({
			itemId: entry.itemId,
			level: entry.upgradeLevel,
			perks: entry.perks,
			source: entry.source
		})),
		duplicates: player.duplicates.map(entry => ({ id: entry.id, itemId: entry.itemId })),
		loadout: {
			main1: loadout.main1,
			main2: loadout.main2,
			pistol: loadout.pistol,
			armour: loadout.armour,
			utility1: loadout.utility1,
			utility2: loadout.utility2
		}
	}
}

export type ProgressView = NonNullable<Awaited<ReturnType<typeof progressView>>>

/**
 * A player without a loadout (made by an older release during a deploy) gets the starter kit now.
 * Idempotent: everything it writes skips what already exists.
 */
export async function ensureStarterKit(db: Database, playerId: string): Promise<void> {
	if (await db.loadout.findUnique({ where: { playerId }, select: { playerId: true } })) return
	if (!(await db.player.findUnique({ where: { userId: playerId }, select: { userId: true } }))) return
	await db.$transaction(async tx => {
		await lockPlayer(tx, playerId)
		await grantStarterKit(tx, playerId)
	})
}

const equippedSlots = (loadout: ProgressView['loadout']) =>
	[loadout.main1, loadout.main2, loadout.pistol, loadout.armour, loadout.utility1, loadout.utility2].filter(
		(id): id is string => id !== null
	)

/**
 * Classes, skills, abilities, inventory, loadout, upgrades, perks, the shop and discards.
 * Every Salvage change goes through the ledger in the same transaction as what it paid for.
 */
export function progressRoutes(services: Services) {
	const { db, parties, valkey } = services

	async function inMission(userId: string) {
		return (await parties.current(userId)).state === 'mission'
	}

	/** Runs a change in a transaction and answers with the new view; refusals become 409s. */
	async function change(
		userId: string,
		options: { lockedInMission: boolean },
		work: (tx: Tx) => Promise<void>
	): Promise<{ status: 200; body: ProgressView } | { status: 409; body: { error: string; [key: string]: unknown } }> {
		const busy = await inMission(userId)
		if (options.lockedInMission && busy) return { status: 409, body: { error: 'in-mission' } }
		try {
			await db.$transaction(
				async tx => {
					// one change per player at a time: every check below sees the result of the last change
					await lockPlayer(tx, userId)
					await work(tx)
				},
				{ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
			)
		} catch (error) {
			if (error instanceof Refused) return { status: 409, body: { error: error.code, ...error.details } }
			if (error instanceof NotEnoughSalvage) return { status: 409, body: { error: 'not-enough-salvage' } }
			// a concurrent request bought or changed the same thing first
			if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2025'].includes(error.code)) {
				return { status: 409, body: { error: 'conflict' } }
			}
			throw error
		}
		return { status: 200, body: (await progressView(db, userId, busy)) as ProgressView }
	}

	const guard = async (c: Context<AppEnv>, next: Next) => {
		const user = c.get('user')
		if (!user) return c.json({ error: 'unauthenticated' }, 401)
		if (!(await db.player.findUnique({ where: { userId: user.id }, select: { userId: true } }))) {
			return c.json({ error: 'no-player' }, 404)
		}
		await next()
	}

	const routes = new Hono<AppEnv>()
		.use('/progress', guard)
		.use('/progress/*', guard)
		.get('/progress', async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			return c.json((await progressView(db, user.id, await inMission(user.id))) as ProgressView, 200)
		})
		.post('/progress/class', zValidator('json', z.object({ class: classId })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const result = await change(user.id, { lockedInMission: true }, async tx => {
				await tx.player.update({ where: { userId: user.id }, data: { activeClass: c.req.valid('json').class } })
			})
			if (result.status === 200) await notify(valkey, [user.id], { type: 'party' })
			return c.json(result.body, result.status)
		})
		.post('/progress/skills', zValidator('json', z.object({ nodeId: itemId })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { nodeId } = c.req.valid('json')
			const result = await change(user.id, { lockedInMission: true }, async tx => {
				const entry = skillNodes.get(nodeId)
				if (!entry) throw new Refused('unknown-node')
				const cls = entry.class
				const progress = await tx.classProgress.findUniqueOrThrow({
					where: { playerId_class: { playerId: user.id, class: cls } }
				})
				const rows = await tx.skillAllocation.findMany({ where: { playerId: user.id, class: cls } })
				const skills = Object.fromEntries(rows.map(row => [row.nodeId, row.rank]))
				const problem = allocationProblem(cls, skills, levelFromXp(Number(progress.xp)).level, nodeId)
				if (problem) throw new Refused(problem)
				await tx.skillAllocation.upsert({
					where: { playerId_class_nodeId: { playerId: user.id, class: cls, nodeId } },
					create: { playerId: user.id, class: cls, nodeId, rank: 1 },
					update: { rank: { increment: 1 } }
				})
			})
			return c.json(result.body, result.status)
		})
		.post('/progress/respec', zValidator('json', z.object({ class: classId })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const cls = c.req.valid('json').class
			const result = await change(user.id, { lockedInMission: true }, async tx => {
				const removed = await tx.skillAllocation.deleteMany({ where: { playerId: user.id, class: cls } })
				if (removed.count === 0) throw new Refused('nothing-to-refund')
				await tx.abilitySlot.deleteMany({ where: { playerId: user.id, class: cls } })
				await changeSalvage(tx, user.id, -economy.respecPrice, LedgerReason.respec, { type: 'class', id: cls })
			})
			return c.json(result.body, result.status)
		})
		.put(
			'/progress/abilities',
			zValidator('json', z.object({ class: classId, abilities: z.array(itemId).max(3) })),
			async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const { class: cls, abilities } = c.req.valid('json')
				const result = await change(user.id, { lockedInMission: true }, async tx => {
					const progress = await tx.classProgress.findUniqueOrThrow({
						where: { playerId_class: { playerId: user.id, class: cls } }
					})
					const rows = await tx.skillAllocation.findMany({ where: { playerId: user.id, class: cls } })
					const skills = Object.fromEntries(rows.map(row => [row.nodeId, row.rank]))
					if (!validateAbilities(skills, levelFromXp(Number(progress.xp)).level, abilities)) {
						throw new Refused('invalid-abilities')
					}
					await tx.abilitySlot.deleteMany({ where: { playerId: user.id, class: cls } })
					await tx.abilitySlot.createMany({
						data: abilities.map((abilityId, index) => ({ playerId: user.id, class: cls, slot: index + 1, abilityId }))
					})
				})
				return c.json(result.body, result.status)
			}
		)
		.put(
			'/progress/loadout',
			zValidator(
				'json',
				z.object({
					main1: itemId,
					main2: itemId,
					pistol: itemId,
					armour: itemId.nullable(),
					utility1: itemId.nullable(),
					utility2: itemId.nullable()
				})
			),
			async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const loadout = c.req.valid('json')
				const result = await change(user.id, { lockedInMission: true }, async tx => {
					const owned = new Set(
						(await tx.inventoryItem.findMany({ where: { playerId: user.id }, select: { itemId: true } })).map(
							row => row.itemId
						)
					)
					const wants: [string | null, string][] = [
						[loadout.main1, 'main'],
						[loadout.main2, 'main'],
						[loadout.pistol, 'pistol'],
						[loadout.armour, 'armour'],
						[loadout.utility1, 'utility'],
						[loadout.utility2, 'utility']
					]
					for (const [id, slot] of wants) {
						if (id === null) continue
						if (!owned.has(id)) throw new Refused('not-owned')
						if (itemById.get(id)?.slot !== slot) throw new Refused('wrong-slot')
					}
					if (loadout.main1 === loadout.main2) throw new Refused('duplicate')
					if (loadout.utility1 && loadout.utility1 === loadout.utility2) throw new Refused('duplicate')
					await tx.loadout.update({ where: { playerId: user.id }, data: loadout })
				})
				return c.json(result.body, result.status)
			}
		)
		.post('/progress/buy', zValidator('json', z.object({ itemId })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { itemId: id } = c.req.valid('json')
			const result = await change(user.id, { lockedInMission: false }, async tx => {
				const def = itemById.get(id)
				if (!def) throw new Refused('unknown-item')
				if (await tx.inventoryItem.findUnique({ where: { playerId_itemId: { playerId: user.id, itemId: id } } })) {
					throw new Refused('owned')
				}
				const { entryId } = await changeSalvage(tx, user.id, -def.price, LedgerReason.purchase, { type: 'item', id })
				if (entryId !== null) {
					await tx.purchase.create({
						data: { playerId: user.id, sku: id, price: BigInt(def.price), ledgerEntryId: entryId }
					})
				}
				await tx.inventoryItem.create({ data: { playerId: user.id, itemId: id, source: ItemSource.shop } })
			})
			return c.json(result.body, result.status)
		})
		.post('/progress/upgrade', zValidator('json', z.object({ itemId })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { itemId: id } = c.req.valid('json')
			const result = await change(user.id, { lockedInMission: true }, async tx => {
				const owned = await tx.inventoryItem.findUnique({
					where: { playerId_itemId: { playerId: user.id, itemId: id } }
				})
				if (!owned) throw new Refused('not-owned')
				const level = owned.upgradeLevel + 1
				if (level > economy.upgrade.maxLevel) throw new Refused('max-level')
				await changeSalvage(tx, user.id, -upgradeCost(id, level), LedgerReason.upgrade, { type: 'item', id })
				// optimistic: a concurrent upgrade of the same item makes this one fail instead of skipping a level
				const updated = await tx.inventoryItem.updateMany({
					where: { playerId: user.id, itemId: id, upgradeLevel: owned.upgradeLevel },
					data: { upgradeLevel: level }
				})
				if (updated.count !== 1) throw new Refused('conflict')
			})
			return c.json(result.body, result.status)
		})
		.post(
			'/progress/perk',
			zValidator('json', z.object({ itemId, level: z.number().int().positive(), perkId: itemId })),
			async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const { itemId: id, level, perkId } = c.req.valid('json')
				const result = await change(user.id, { lockedInMission: true }, async tx => {
					const owned = await tx.inventoryItem.findUnique({
						where: { playerId_itemId: { playerId: user.id, itemId: id } }
					})
					if (!owned) throw new Refused('not-owned')
					const options = perkOptions(id, level)
					if (!options?.some(option => option.id === perkId)) throw new Refused('unknown-perk')
					if (owned.upgradeLevel < level) throw new Refused('level-too-low')
					const other = options.find(option => option.id !== perkId)?.id
					if (owned.perks.includes(perkId)) return
					// the first choice at a level is free; switching later costs a small fee
					if (other && owned.perks.includes(other)) {
						await changeSalvage(tx, user.id, -economy.upgrade.perkSwitchPrice, LedgerReason.perk, { type: 'item', id })
					}
					await tx.inventoryItem.update({
						where: { playerId_itemId: { playerId: user.id, itemId: id } },
						data: { perks: [...owned.perks.filter(existing => existing !== other), perkId] }
					})
				})
				return c.json(result.body, result.status)
			}
		)
		.post(
			'/progress/discard',
			zValidator('json', z.object({ itemId, confirm: z.boolean().default(false) })),
			async c => {
				const user = c.get('user')
				if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
				const { itemId: id, confirm } = c.req.valid('json')
				const result = await change(user.id, { lockedInMission: true }, async tx => {
					const inventory = await tx.inventoryItem.findMany({ where: { playerId: user.id } })
					const owned = inventory.find(row => row.itemId === id)
					if (!owned) throw new Refused('not-owned')
					const slot = item(id).slot
					const sameSlot = inventory.filter(row => itemById.get(row.itemId)?.slot === slot)
					// a loadout always needs a pistol and two main weapons
					if (slot === 'pistol' && sameSlot.length <= 1) throw new Refused('last-pistol')
					if (slot === 'main' && sameSlot.length <= 2) throw new Refused('last-mains')
					const loadout = await tx.loadout.findUniqueOrThrow({ where: { playerId: user.id } })
					const equipped = equippedSlots(loadout).includes(id)
					if ((equipped || owned.upgradeLevel > 0) && !confirm) {
						throw new Refused('needs-confirmation', {
							equipped,
							level: owned.upgradeLevel,
							spent: upgradeTotal(id, owned.upgradeLevel),
							value: discardValue(id)
						})
					}
					if (equipped) {
						const used = new Set(equippedSlots(loadout))
						const spare = sameSlot.find(row => !used.has(row.itemId))?.itemId ?? null
						const field = (Object.entries(loadout) as [string, string | null][]).find(
							([key, value]) => key !== 'playerId' && value === id
						)?.[0]
						if (!field) throw new Error('equipped item not in loadout')
						if (spare === null && (slot === 'main' || slot === 'pistol')) throw new Refused('last-mains')
						await tx.loadout.update({ where: { playerId: user.id }, data: { [field]: spare } })
					}
					await tx.inventoryItem.delete({ where: { playerId_itemId: { playerId: user.id, itemId: id } } })
					await changeSalvage(tx, user.id, discardValue(id), LedgerReason.discard, { type: 'item', id })
				})
				return c.json(result.body, result.status)
			}
		)
		.post('/progress/discard-duplicate', zValidator('json', z.object({ id: z.uuid() })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const result = await change(user.id, { lockedInMission: false }, async tx => {
				const duplicate = await tx.itemDuplicate.findFirst({ where: { id: c.req.valid('json').id, playerId: user.id } })
				if (!duplicate) throw new Refused('not-found')
				await tx.itemDuplicate.delete({ where: { id: duplicate.id } })
				await changeSalvage(tx, user.id, discardValue(duplicate.itemId), LedgerReason.discard, {
					type: 'duplicate',
					id: duplicate.id
				})
			})
			return c.json(result.body, result.status)
		})
		.get('/progress/ledger', zValidator('query', z.object({ before: z.coerce.bigint().optional() })), async c => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'unauthenticated' as const }, 401)
			const { before } = c.req.valid('query')
			const rows = await db.ledgerEntry.findMany({
				where: { playerId: user.id, ...(before ? { id: { lt: before } } : {}) },
				orderBy: { id: 'desc' },
				take: 50
			})
			return c.json(
				rows.map(row => ({
					id: String(row.id),
					amount: Number(row.amount),
					balanceAfter: Number(row.balanceAfter),
					reason: row.reason,
					refId: row.refId,
					createdAt: row.createdAt.toISOString()
				})),
				200
			)
		})
	return routes
}
