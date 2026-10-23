import { type Build, dataVersion } from '@rotline/game-data'
import {
	ProtocolError,
	Reader,
	type ResultsMessage,
	type RosterEntry,
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
	welcome(you: number, tick: number, mapId: string, build: Build, missionId: string, difficulty: string): void
	snapshot(frame: SnapshotFrame, table: ZombieTable, receivedAt: number): void
	events(events: SimEvent[]): void
	roster(entries: RosterEntry[]): void
	results(results: ResultsMessage): void
	/** the server runs other game data: the page must reload */
	outdated(): void
	kicked(reason: number): void
	closed(): void
}

/** How long a direct address gets to open before the next one is tried. */
const OPEN_TIMEOUT_MS = 5000

/**
 * The game's WebSocket: hello with the ticket, then binary inputs out and snapshots in. Given more
 * than one address, each is tried in turn until one opens (a direct address first, the one through
 * the site's proxy as the fallback).
 */
export class GameConnection {
	readonly table = new ZombieTable()
	private socket: WebSocket
	private readonly writer = new Writer(256)
	private lastSnapshotId = 0
	private finished = false

	constructor(url: string | readonly string[], ticket: string, handlers: ConnectionHandlers) {
		const urls = typeof url === 'string' ? [url] : url
		this.socket = this.open(urls, 0, ticket, handlers)
	}

	private open(urls: readonly string[], index: number, ticket: string, handlers: ConnectionHandlers): WebSocket {
		const socket = new WebSocket(urls[index] as string)
		const last = index >= urls.length - 1
		let opened = false
		// an address that never opens (blocked, unreachable) gives way to the next one
		const giveUp = last ? 0 : window.setTimeout(() => !opened && socket.close(), OPEN_TIMEOUT_MS)
		socket.binaryType = 'arraybuffer'
		socket.addEventListener('open', () => {
			opened = true
			window.clearTimeout(giveUp)
			socket.send(writeHello(this.writer, ticket))
		})
		socket.addEventListener('message', event => {
			if (!(event.data instanceof ArrayBuffer)) return
			try {
				const reader = new Reader(new Uint8Array(event.data))
				const message = readServerHeader(reader)
				switch (message.type) {
					case 'welcome':
						// built from other game data: prediction and props would not match the server
						if (message.dataVersion !== dataVersion) {
							this.finished = true
							handlers.outdated()
							socket.close()
							break
						}
						handlers.welcome(
							message.you,
							message.tick,
							message.mapId,
							message.build,
							message.missionId,
							message.difficulty
						)
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
						socket.send(writePong(this.writer, message.time))
						break
					case 'roster':
						handlers.roster(message.entries)
						break
					case 'results':
						handlers.results(message)
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
		socket.addEventListener('close', () => {
			window.clearTimeout(giveUp)
			if (!opened && !last && !this.finished) {
				this.socket = this.open(urls, index + 1, ticket, handlers)
				return
			}
			if (!this.finished) handlers.closed()
			this.finished = true
		})
		return socket
	}

	send(bytes: Uint8Array<ArrayBuffer>): void {
		if (this.socket.readyState === WebSocket.OPEN) this.socket.send(bytes)
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
