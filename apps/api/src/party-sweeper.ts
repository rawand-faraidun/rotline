import { notify, type PartyStore, type Valkey } from '@rotline/state'
import type { Logger } from 'pino'

const SWEEP_EVERY_MS = 30_000

/**
 * Closes the gaps players leave: anyone away from the game for a few minutes is taken out of their
 * squad, and a squad left empty is closed. Whoever is still in it sees the squad change at once.
 */
export function startPartySweeper(parties: PartyStore, valkey: Valkey, log: Logger): () => void {
	const sweep = async () => {
		const removed = await parties.sweep()
		for (const { userId, partyId } of removed) {
			const party = await parties.get(partyId)
			await notify(valkey, [userId, ...(party?.members ?? [])], { type: 'party' })
		}
		if (removed.length > 0) log.info({ count: removed.length }, 'took players who were away out of their squads')
	}
	const timer = setInterval(() => {
		sweep().catch(error => log.error({ err: error }, 'party sweep failed'))
	}, SWEEP_EVERY_MS)
	timer.unref()
	return () => clearInterval(timer)
}
