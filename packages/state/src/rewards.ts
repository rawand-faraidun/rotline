import type { Valkey } from './client.ts'

/** Game servers append reward reports here; the API turns them into XP and Salvage. */
export const REWARDS_STREAM = 'rewards'
/** Trimmed approximately; the API acknowledges reports within seconds. */
const STREAM_MAX = 100_000

export type ClassName = 'assault' | 'medic' | 'heavy'

/**
 * XP and Salvage a player earned since the previous report, items found (at checkpoints) and, at
 * a mission's end, its result. `grantKey` makes the grant idempotent.
 */
export type RewardReport = {
	grantKey: string
	userId: string
	class: ClassName
	xp: number
	salvage: number
	kills: number
	items?: string[] | undefined
	result?:
		| {
				missionId: string
				difficulty: 'recruit' | 'veteran' | 'nightmare' | 'apocalypse'
				success: boolean
				timeMs: number
				score: number
				downs: number
				squad: number
				optionalDone: number
		  }
		| undefined
}

/**
 * Appends a report with its signature: the API pays only reports signed by a game server's key, so
 * write access to Valkey alone cannot mint XP or Salvage.
 */
export async function publishReward(
	valkey: Valkey,
	report: RewardReport,
	sign: (text: string) => string
): Promise<void> {
	const text = JSON.stringify(report)
	await valkey.xadd(REWARDS_STREAM, 'MAXLEN', '~', STREAM_MAX, '*', 'report', text, 'sig', sign(text))
}
