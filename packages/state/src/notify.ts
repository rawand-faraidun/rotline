import type { Valkey } from './client.ts'

/** Events pushed to a signed-in player's browser (through the API's event stream). */
export type PlayerEvent =
	| { type: 'party' }
	| { type: 'friends' }
	| { type: 'invite'; from: string; code: string }
	| { type: 'presence'; userId: string; status: string; detail: string }
	| { type: 'seat'; status: 'admitted' | 'lost' | 'idle-warning' }
	/** XP, levels or Salvage changed (rewards from a mission) */
	| { type: 'progress' }

export const userChannel = (userId: string) => `user:${userId}`

export async function notify(valkey: Valkey, userIds: Iterable<string>, event: PlayerEvent): Promise<void> {
	const payload = JSON.stringify(event)
	const pipeline = valkey.pipeline()
	for (const userId of userIds) pipeline.publish(userChannel(userId), payload)
	await pipeline.exec()
}
