/** What the HUD shows. The game writes it; React reads it through `subscribe` + `getSnapshot`. */
export type HudState = {
	status: 'connecting' | 'playing' | 'down' | 'out' | 'disconnected' | 'kicked'
	health: number
	maxHealth: number
	weapons: { name: string; mag: number; magazine: number; reserve: number | null; active: boolean }[]
	reloading: number | null
	wave: number
	kills: number
	score: number
	respawnSeconds: number
	/** seconds left before bleeding out, while downed */
	bleedoutSeconds: number
	/** 0..1 while a teammate is reviving you */
	beingRevived: number
	/** name of the downed teammate you can revive right now */
	reviveHint: string | null
	teammates: {
		slot: number
		name: string
		health: number
		downed: boolean
		out: boolean
		bleedoutSeconds: number
		revive: number
		connected: boolean
	}[]
	/** short announcements: new wave, squad wiped */
	banner: { text: 'wave' | 'wipe'; wave: number; at: number } | null
	/** equipped abilities: name, key and seconds until ready (0 = ready) */
	abilities: { name: string; key: string; seconds: number; cooldown: number }[]
	/** utilities: name, key and charges left (null = unlimited, in the firing range) */
	utilities: { name: string; key: string; charges: number | null }[]
	/** firing range: damage per second over the last three seconds */
	dps: number
	pingMs: number
	fps: number
	hitMarker: number
	kickReason: number | null
}

export const initialHud: HudState = {
	status: 'connecting',
	health: 100,
	maxHealth: 100,
	weapons: [],
	reloading: null,
	wave: 0,
	kills: 0,
	score: 0,
	respawnSeconds: 0,
	bleedoutSeconds: 0,
	beingRevived: 0,
	reviveHint: null,
	teammates: [],
	banner: null,
	abilities: [],
	utilities: [],
	dps: 0,
	pingMs: 0,
	fps: 0,
	hitMarker: 0,
	kickReason: null
}

/**
 * A tiny external store. Updates are batched: the game may call `set` every frame, but listeners
 * are notified at most 15 times a second, so React never runs inside the render loop.
 */
export class HudStore {
	private state: HudState = initialHud
	private readonly listeners = new Set<() => void>()
	private dirty = false
	private lastFlush = 0

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	readonly getSnapshot = (): HudState => this.state

	set(patch: Partial<HudState>, now: number, urgent = false): void {
		let changed = false
		for (const key of Object.keys(patch) as (keyof HudState)[]) {
			if (patch[key] !== this.state[key]) {
				changed = true
				break
			}
		}
		if (!changed) return
		this.state = { ...this.state, ...patch }
		this.dirty = true
		if (urgent || now - this.lastFlush > 1000 / 15) this.flush(now)
	}

	flush(now: number): void {
		if (!this.dirty) return
		this.dirty = false
		this.lastFlush = now
		for (const listener of this.listeners) listener()
	}
}
