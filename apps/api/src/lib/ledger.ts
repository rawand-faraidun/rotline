import type { LedgerReason, Prisma } from '@rotline/db'

export type Tx = Prisma.TransactionClient

export class NotEnoughSalvage extends Error {
	constructor() {
		super('not enough Salvage')
	}
}

/** The player row is gone (the account was deleted while something was in flight). */
export class PlayerMissing extends Error {
	constructor(id: string) {
		super(`no player ${id}`)
	}
}

/**
 * Locks the player's row for the rest of the transaction, so every change to one player's
 * progress, inventory or Salvage runs one at a time. NO KEY UPDATE is the lock the balance update
 * takes anyway, and it does not block foreign-key checks from rows that reference the player.
 */
export async function lockPlayer(tx: Tx, playerId: string): Promise<bigint> {
	const rows = await tx.$queryRaw<{ salvage: bigint }[]>`
		SELECT salvage FROM player WHERE user_id = ${playerId}::uuid FOR NO KEY UPDATE`
	const current = rows[0]?.salvage
	if (current === undefined) throw new PlayerMissing(playerId)
	return current
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
): Promise<{ balance: bigint; entryId: bigint | null }> {
	const current = await lockPlayer(tx, playerId)
	// a free action (a price set to 0) changes nothing and records nothing
	if (Math.trunc(amount) === 0) return { balance: current, entryId: null }
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
