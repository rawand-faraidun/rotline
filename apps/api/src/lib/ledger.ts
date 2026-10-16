import type { LedgerReason, Prisma } from '@rotline/db'

export type Tx = Prisma.TransactionClient

export class NotEnoughSalvage extends Error {
	constructor() {
		super('not enough Salvage')
	}
}

/**
 * Changes a player's Salvage inside the caller's transaction: locks the player row, checks the
 * balance, appends a ledger row with the new balance and updates the cached balance. Prices and
 * rewards come from game data on the server, never from the client.
 */
export async function changeSalvage(
	tx: Tx,
	playerId: string,
	amount: number,
	reason: LedgerReason,
	ref: { type: string; id: string } | null = null,
	grantKey: string | null = null
): Promise<{ balance: bigint; entryId: bigint }> {
	const rows = await tx.$queryRaw<{ salvage: bigint }[]>`
		SELECT salvage FROM player WHERE user_id = ${playerId}::uuid FOR UPDATE`
	const current = rows[0]?.salvage
	if (current === undefined) throw new Error(`no player ${playerId}`)
	const balance = current + BigInt(Math.trunc(amount))
	if (balance < 0n) throw new NotEnoughSalvage()
	const entry = await tx.ledgerEntry.create({
		data: {
			playerId,
			amount: BigInt(Math.trunc(amount)),
			balanceAfter: balance,
			reason,
			refType: ref?.type ?? null,
			refId: ref?.id ?? null,
			grantKey
		}
	})
	await tx.player.update({ where: { userId: playerId }, data: { salvage: balance } })
	return { balance, entryId: entry.id }
}
