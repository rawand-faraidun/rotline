import { createValkey, type PlayerEvent, userChannel, type Valkey } from '@rotline/state'

type Listener = (event: PlayerEvent) => void

/**
 * Fans Valkey pub/sub messages out to the event streams open on this API process. One subscriber
 * connection per process; a channel is subscribed while at least one of that player's tabs is open.
 */
export class EventHub {
	private readonly subscriber: Valkey
	private readonly listeners = new Map<string, Set<Listener>>()

	constructor(url: string) {
		this.subscriber = createValkey(url, 'rotline-api-events')
		this.subscriber.on('message', (channel: string, message: string) => {
			const userId = channel.slice('user:'.length)
			const set = this.listeners.get(userId)
			if (!set) return
			let event: PlayerEvent
			try {
				event = JSON.parse(message) as PlayerEvent
			} catch {
				return
			}
			for (const listener of set) listener(event)
		})
	}

	async subscribe(userId: string, listener: Listener): Promise<() => Promise<void>> {
		let set = this.listeners.get(userId)
		if (!set) {
			set = new Set()
			this.listeners.set(userId, set)
			await this.subscriber.subscribe(userChannel(userId))
		}
		set.add(listener)
		return async () => {
			const current = this.listeners.get(userId)
			if (!current) return
			current.delete(listener)
			if (current.size === 0) {
				this.listeners.delete(userId)
				await this.subscriber.unsubscribe(userChannel(userId))
			}
		}
	}

	get openStreams(): number {
		let count = 0
		for (const set of this.listeners.values()) count += set.size
		return count
	}

	async close(): Promise<void> {
		await this.subscriber.quit()
	}
}
