import type { KeyObject } from 'node:crypto'
import { type Database, LedgerReason, PlayerClass, Prisma } from '@rotline/db'
import { economy } from '@rotline/game-data'
import { createValkey, notify, REWARDS_STREAM, type RewardReport, type Valkey } from '@rotline/state'
import { verifyMessage } from '@rotline/ticket'
import type { Logger } from 'pino'
import { z } from 'zod'
import { changeSalvage, PlayerMissing } from './lib/ledger.ts'

const GROUP = 'api'
/** room:player:membership:sequence, from squad rooms only (the firing range reports nothing) */
const GRANT_KEY = /^squad-[0-9a-f-]{36}:([0-9a-f-]{36}):[0-9a-f]{8}:\d{1,6}$/
/** Reports a crashed consumer left unacknowledged are taken over after this long. */
const CLAIM_IDLE_MS = 60_000

const report = z.object({
	grantKey: z.string().min(1).max(200),
	userId: z.uuid(),
	class: z.enum(PlayerClass),
	xp: z.number().int().min(0).max(1_000_000),
	salvage: z.number().int().min(0).max(1_000_000),
	kills: z.number().int().min(0)
})

/**
 * Applies one reward report in one transaction: the grant key is recorded first, so a report
 * delivered twice changes nothing the second time. Returns false for a repeat.
 */
export async function grantReward(db: Database, valkey: Valkey | null, input: RewardReport): Promise<boolean> {
	// a deleted player cannot be paid; nothing is recorded for them
	if (!(await db.player.findUnique({ where: { userId: input.userId }, select: { userId: true } }))) return false
	try {
		await db.$transaction(async tx => {
			await tx.rewardGrant.create({
				data: {
					grantKey: input.grantKey,
					playerId: input.userId,
					class: input.class,
					xp: BigInt(input.xp),
					salvage: BigInt(input.salvage)
				}
			})
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
		})
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
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
			// the key must name this player, and no report may grant more than one wave plausibly can
			const owner = parsed.success ? GRANT_KEY.exec(parsed.data.grantKey)?.[1] : undefined
			const plausible =
				parsed.success &&
				owner === parsed.data.userId &&
				parsed.data.xp <= economy.rewards.maxPerReport.xp &&
				parsed.data.salvage <= economy.rewards.maxPerReport.salvage
			if (!parsed.success || !plausible) {
				this.log.error({ id }, 'malformed reward report dropped')
				await this.valkey.xack(this.stream, GROUP, id)
				continue
			}
			try {
				await grantReward(this.db, this.valkey, parsed.data)
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
