import type { Valkey } from './client.ts'

/** Game servers append reward reports here; the API turns them into XP and Salvage. */
export const REWARDS_STREAM = 'rewards'
/** Trimmed approximately; the API acknowledges reports within seconds. */
const STREAM_MAX = 100_000

export type ClassName = 'assault' | 'medic' | 'heavy'

/** XP and Salvage a player earned since the previous report. `grantKey` makes the grant idempotent. */
export type RewardReport = {
	grantKey: string
	userId: string
	class: ClassName
	xp: number
	salvage: number
	kills: number
}

export async function publishReward(valkey: Valkey, report: RewardReport): Promise<void> {
	await valkey.xadd(REWARDS_STREAM, 'MAXLEN', '~', STREAM_MAX, '*', 'report', JSON.stringify(report))
}
