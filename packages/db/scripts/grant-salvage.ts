// Gives a player Salvage as an admin grant, through the ledger like every other change to a balance:
// `pnpm --filter @rotline/db grant <email or player name> <amount>` (reads DATABASE_URL from .env).
// Safe to run twice: each grant has its own key, so a retry with the same key pays nothing.
import { createDatabase } from '../src/index.ts'

const [who, amountText, key] = process.argv.slice(2)
const amount = Number(amountText)
if (!who || !Number.isInteger(amount) || amount <= 0) {
	process.stderr.write('usage: grant <email or player name> <amount> [grant key]\n')
	process.exit(1)
}
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const db = createDatabase(url)
try {
	const user = await db.user.findFirst({ where: { email: who } })
	const player = user
		? await db.player.findUnique({ where: { userId: user.id } })
		: await db.player.findUnique({ where: { nameKey: who.toLowerCase() } })
	if (!player) throw new Error(`no player for ${who}`)
	const grantKey = key ?? `admin-grant:${player.userId}:${Date.now()}`
	const after = await db.$transaction(async tx => {
		const updated = await tx.player.update({
			where: { userId: player.userId },
			data: { salvage: { increment: BigInt(amount) } }
		})
		await tx.ledgerEntry.create({
			data: {
				playerId: player.userId,
				amount: BigInt(amount),
				balanceAfter: updated.salvage,
				reason: 'admin',
				refType: 'grant',
				grantKey
			}
		})
		return updated.salvage
	})
	process.stdout.write(`${player.name}: +${amount} Salvage, now ${after}\n`)
} finally {
	await db.$disconnect()
}
