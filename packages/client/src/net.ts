import {
	ProtocolError,
	Reader,
	readServerHeader,
	readSnapshot,
	type SnapshotFrame,
	Writer,
	writeHello,
	writeInput,
	writePong,
	ZombieTable
} from '@rotline/protocol'
import type { PlayerInput, SimEvent } from '@rotline/sim'

export type ConnectionHandlers = {
	welcome(you: number, tick: number, mapId: string): void
	snapshot(frame: SnapshotFrame, table: ZombieTable, receivedAt: number): void
	events(events: SimEvent[]): void
	kicked(reason: number): void
	closed(): void
}

/** The game's WebSocket: hello with the ticket, then binary inputs out and snapshots in. */
export class GameConnection {
	readonly table = new ZombieTable()
	private readonly socket: WebSocket
	private readonly writer = new Writer(256)
	private lastSnapshotId = 0
	private finished = false

	constructor(url: string, ticket: string, handlers: ConnectionHandlers) {
		this.socket = new WebSocket(url)
		this.socket.binaryType = 'arraybuffer'
		this.socket.addEventListener('open', () => this.socket.send(writeHello(this.writer, ticket)))
		this.socket.addEventListener('message', event => {
			if (!(event.data instanceof ArrayBuffer)) return
			try {
				const reader = new Reader(new Uint8Array(event.data))
				const message = readServerHeader(reader)
				switch (message.type) {
					case 'welcome':
						handlers.welcome(message.you, message.tick, message.mapId)
						break
					case 'snapshot': {
						const frame = readSnapshot(reader, this.table)
						this.lastSnapshotId = frame.id
						handlers.snapshot(frame, this.table, performance.now())
						break
					}
					case 'events':
						handlers.events(message.events)
						break
					case 'ping':
						this.socket.send(writePong(this.writer, message.time))
						break
					case 'kick':
						this.finished = true
						handlers.kicked(message.reason)
						break
				}
			} catch (error) {
				if (!(error instanceof ProtocolError)) throw error
				this.close()
			}
		})
		this.socket.addEventListener('close', () => {
			if (!this.finished) handlers.closed()
			this.finished = true
		})
	}

	sendInputs(inputs: readonly PlayerInput[]): void {
		if (this.socket.readyState === WebSocket.OPEN)
			this.socket.send(writeInput(this.writer, this.lastSnapshotId, inputs))
	}

	close(): void {
		this.finished = true
		this.socket.close()
	}
}
