import type { KeyObject } from 'node:crypto'
import { type Database, Difficulty, ItemSource, LedgerReason, PlayerClass, Prisma } from '@rotline/db'
import { economy, itemById, masteryFor, minimumSeconds, missionById } from '@rotline/game-data'
import { createValkey, notify, REWARDS_STREAM, type RewardReport, roomMission, type Valkey } from '@rotline/state'
import { verifyMessage } from '@rotline/ticket'
import type { Logger } from 'pino'
import { z } from 'zod'
import { changeSalvage, lockPlayer, PlayerMissing, type Tx } from './lib/ledger.ts'

const GROUP = 'api'
/** room:player:membership:sequence, from squad rooms only (the firing range reports nothing) */
const GRANT_KEY = /^(squad-[0-9a-f-]{36}):([0-9a-f-]{36}):[0-9a-f]{8}:\d{1,6}$/
const MAX_MISSION_MS = 6 * 60 * 60 * 1000
/** Reports a crashed consumer left unacknowledged are taken over after this long. */
const CLAIM_IDLE_MS = 60_000

const report = z.object({
	grantKey: z.string().min(1).max(200),
	userId: z.uuid(),
	class: z.enum(PlayerClass),
	xp: z.number().int().min(0).max(1_000_000),
	salvage: z.number().int().min(0).max(1_000_000),
	kills: z.number().int().min(0),
	/** only items that can drop (not starter items), at most a mission's worth */
	items: z
		.array(z.string().refine(id => (itemById.get(id)?.tier ?? 0) > 0, 'not a droppable item'))
		.max(economy.drops.maxPerMission)
		.optional(),
	result: z
		.object({
			missionId: z.string().refine(id => missionById(id) !== undefined, 'unknown mission'),
			difficulty: z.enum(Difficulty),
			success: z.boolean(),
			timeMs: z.number().int().positive().max(MAX_MISSION_MS),
			score: z.number().int().min(0),
			downs: z.number().int().min(0).max(100_000),
			squad: z.number().int().min(1).max(4),
			optionalDone: z.number().int().min(0).max(20)
		})
		.optional()
})

type Report = z.infer<typeof report>

/**
 * A mission result the room could really have produced: no faster than the mission's timed
 * objectives allow, no more score than that time could earn, no more optional objectives than exist.
 */
export function plausibleResult(result: NonNullable<Report['result']>): boolean {
	const mission = missionById(result.missionId)
	if (!mission) return false
	const optional = mission.objectives.filter(objective => objective.optional).length
	return (
		result.timeMs >= minimumSeconds(mission) * 1000 &&
		result.score <= (result.timeMs / 1000) * economy.rewards.maxScorePerSecond * result.squad &&
		result.optionalDone <= optional
	)
}

/**
 * The room's report agrees with what the API recorded when the squad started: the result names
 * that mission and difficulty, and items only of tiers that can drop at that difficulty.
 */
export async function matchesRoom(valkey: Valkey, room: string, input: Report): Promise<boolean> {
	if (!input.result && !input.items?.length) return true
	const recorded = await roomMission(valkey, room)
	if (!recorded || recorded === 'survival') return false
	if (input.result && (input.result.missionId !== recorded.id || input.result.difficulty !== recorded.difficulty))
		return false
	const weights = economy.drops.tierWeights[recorded.difficulty]
	if (!weights) return false
	return (input.items ?? []).every(id => (weights[(itemById.get(id)?.tier ?? 0) - 1] ?? 0) > 0)
}

/** Mastery levels in order, as the database names them (game data numbers them 0 to 3). */
const MASTERY = ['none', 'bronze', 'silver', 'gold'] as const

/** Found items: new ones join the inventory at level 0, ones already owned become duplicates. */
async function grantItems(tx: Tx, playerId: string, items: string[], room: string): Promise<void> {
	for (const itemId of items) {
		const owned = await tx.inventoryItem.findUnique({ where: { playerId_itemId: { playerId, itemId } } })
		// until match records exist, the duplicate remembers the room it was found in
		if (owned) await tx.itemDuplicate.create({ data: { playerId, itemId, matchId: room } })
		else await tx.inventoryItem.create({ data: { playerId, itemId, source: ItemSource.drop } })
	}
}

/** Completions, best time, best score and the best mastery, per mission and difficulty. */
async function recordResult(tx: Tx, playerId: string, result: NonNullable<Report['result']>): Promise<void> {
	const mission = missionById(result.missionId)
	if (!mission || !result.success) return
	const mastery = masteryFor(mission, result)
	const key = { playerId_missionId_difficulty: { playerId, missionId: mission.id, difficulty: result.difficulty } }
	const current = await tx.missionProgress.findUnique({ where: key })
	const data = {
		completions: (current?.completions ?? 0) + 1,
		bestTimeMs: Math.min(current?.bestTimeMs ?? Number.MAX_SAFE_INTEGER, result.timeMs),
		bestScore: current && current.bestScore > BigInt(result.score) ? current.bestScore : BigInt(result.score),
		mastery: MASTERY[Math.max(MASTERY.indexOf(current?.mastery ?? 'none'), mastery)] ?? 'none'
	}
	await tx.missionProgress.upsert({
		where: key,
		create: { playerId, missionId: mission.id, difficulty: result.difficulty, ...data },
		update: data
	})
}

/**
 * Applies one reward report in one transaction: the grant key is recorded first, so a report
 * delivered twice changes nothing the second time. Returns false for a repeat.
 */
export async function grantReward(db: Database, valkey: Valkey | null, input: RewardReport): Promise<boolean> {
	// a deleted player cannot be paid; nothing is recorded for them
	if (!(await db.player.findUnique({ where: { userId: input.userId }, select: { userId: true } }))) return false
	const room = input.grantKey.split(':')[0] ?? ''
	try {
		await db.$transaction(
			async tx => {
				// one player's grants, purchases and discards run one at a time (inventory checks stay true)
				await lockPlayer(tx, input.userId)
				let items = input.items ?? []
				let result = input.result
				if (items.length > 0 || result) {
					// drops are capped, and a result counts once, per room across every report from it
					const earlier = await tx.rewardGrant.findMany({
						where: { playerId: input.userId, room },
						select: { items: true, result: true }
					})
					const already = earlier.reduce((sum, grant) => sum + grant.items.length, 0)
					items = items.slice(0, Math.max(0, economy.drops.maxPerMission - already))
					if (earlier.some(grant => grant.result)) result = undefined
				}
				await tx.rewardGrant.create({
					data: {
						grantKey: input.grantKey,
						playerId: input.userId,
						class: input.class,
						xp: BigInt(input.xp),
						salvage: BigInt(input.salvage),
						room,
						items,
						result: result !== undefined
					}
				})
				await grantItems(tx, input.userId, items, room)
				if (result) await recordResult(tx, input.userId, result)
				if (input.xp > 0) {
					await tx.classProgress.upsert({
						where: { playerId_class: { playerId: input.userId, class: input.class } },
						create: { playerId: input.userId, class: input.class, xp: BigInt(input.xp) },
						update: { xp: { increment: BigInt(input.xp) } }
					})
				}
				if (input.salvage > 0) {
					await changeSalvage(
						tx,
						input.userId,
						input.salvage,
						LedgerReason.mission,
						{ type: 'grant', id: input.grantKey },
						input.grantKey
					)
				}
			},
			// the lock-then-read checks above rely on each statement seeing what committed before it
			{ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
		)
	} catch (error) {
		// a repeat only when this very report was granted before; any other conflict is retried
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === 'P2002' &&
			(await db.rewardGrant.findUnique({ where: { grantKey: input.grantKey }, select: { grantKey: true } }))
		)
			return false
		throw error
	}
	if (valkey) await notify(valkey, [input.userId], { type: 'progress' })
	return true
}

/**
 * Reads reward reports from the Valkey stream as part of a consumer group shared by every API
 * instance, grants them, and acknowledges each only after its transaction committed.
 */
export class RewardWorker {
	private readonly db: Database
	private readonly valkey: Valkey
	private readonly log: Logger
	private readonly consumer: string
	private readonly stream: string
	private readonly reader: Valkey
	private running = false
	private lastClaim = 0
	private readonly done: Promise<void>
	private resolveDone: () => void = () => {}

	private readonly rewardKey: KeyObject

	constructor(
		db: Database,
		valkey: Valkey,
		valkeyUrl: string,
		log: Logger,
		consumer: string,
		rewardKey: KeyObject,
		stream = REWARDS_STREAM
	) {
		this.rewardKey = rewardKey
		this.db = db
		this.valkey = valkey
		this.log = log
		this.consumer = consumer
		this.stream = stream
		this.reader = createValkey(valkeyUrl, `rotline-api-rewards-${consumer}`)
		this.done = new Promise(resolve => {
			this.resolveDone = resolve
		})
	}

	async start(): Promise<void> {
		try {
			await this.reader.xgroup('CREATE', this.stream, GROUP, '0', 'MKSTREAM')
		} catch (error) {
			if (!String(error).includes('BUSYGROUP')) throw error
		}
		this.running = true
		void this.loop()
	}

	async stop(): Promise<void> {
		this.running = false
		this.reader.disconnect()
		await this.done
	}

	private async loop(): Promise<void> {
		while (this.running) {
			try {
				if (Date.now() - this.lastClaim > CLAIM_IDLE_MS / 2) {
					this.lastClaim = Date.now()
					const claimed = (await this.reader.xautoclaim(
						this.stream,
						GROUP,
						this.consumer,
						CLAIM_IDLE_MS,
						'0-0',
						'COUNT',
						50
					)) as [string, [string, string[]][]]
					await this.handle(claimed[1])
				}
				const result = (await this.reader.xreadgroup(
					'GROUP',
					GROUP,
					this.consumer,
					'COUNT',
					50,
					'BLOCK',
					2000,
					'STREAMS',
					this.stream,
					'>'
				)) as [string, [string, string[]][]][] | null
				if (result) for (const [, entries] of result) await this.handle(entries)
			} catch (error) {
				if (!this.running) break
				this.log.error({ err: error }, 'reward stream read failed')
				await new Promise(resolve => setTimeout(resolve, 1000))
			}
		}
		this.resolveDone()
	}

	private async handle(entries: [string, string[]][]): Promise<void> {
		for (const [id, fields] of entries) {
			const at = fields.indexOf('report')
			const text = at >= 0 ? (fields[at + 1] ?? '') : ''
			const signatureAt = fields.indexOf('sig')
			const signature = signatureAt >= 0 ? (fields[signatureAt + 1] ?? '') : ''
			// only reports signed by a game server count: Valkey access alone cannot mint rewards
			if (!verifyMessage(this.rewardKey, text, signature)) {
				this.log.error({ id }, 'unsigned or forged reward report dropped')
				await this.valkey.xack(this.stream, GROUP, id)
				continue
			}
			let body: unknown = null
			try {
				body = JSON.parse(text)
			} catch {
				body = null
			}
			const parsed = report.safeParse(body)
			// the key must name this player, no report may grant more than a stretch of play plausibly
			// can, and a mission result must fit the mission
			const owner = parsed.success ? GRANT_KEY.exec(parsed.data.grantKey)?.[2] : undefined
			const plausible =
				parsed.success &&
				owner === parsed.data.userId &&
				parsed.data.xp <= economy.rewards.maxPerReport.xp &&
				parsed.data.salvage <= economy.rewards.maxPerReport.salvage &&
				(!parsed.data.result || plausibleResult(parsed.data.result))
			if (!parsed.success || !plausible) {
				this.log.error({ id }, 'malformed reward report dropped')
				await this.valkey.xack(this.stream, GROUP, id)
				continue
			}
			// items and a result must fit the room's recorded mission; if not they are dropped (and logged)
			let grant: Report = parsed.data
			const room = GRANT_KEY.exec(grant.grantKey)?.[1] ?? ''
			if (!(await matchesRoom(this.valkey, room, grant))) {
				this.log.error({ id, grantKey: grant.grantKey }, 'reward report items or result do not fit the room')
				const { items: _items, result: _result, ...rest } = grant
				grant = rest
			}
			try {
				await grantReward(this.db, this.valkey, grant)
				await this.valkey.xack(this.stream, GROUP, id)
			} catch (error) {
				// a player who no longer exists cannot be paid; anything else is retried later
				if (
					error instanceof PlayerMissing ||
					(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003')
				) {
					this.log.warn({ grantKey: parsed.data.grantKey }, 'reward for a deleted player dropped')
					await this.valkey.xack(this.stream, GROUP, id)
				} else {
					this.log.error({ err: error, grantKey: parsed.data.grantKey }, 'reward grant failed; will retry')
				}
			}
		}
	}
}
