/** What the HUD shows. The game writes it; React reads it through `subscribe` + `getSnapshot`. */
export type HudState = {
	/** 'over': the mission is complete and the room has closed; the game is paused while 'paused' */
	/** 'elsewhere': the player joined another squad room, so this one let them go */
	status: 'connecting' | 'playing' | 'down' | 'out' | 'disconnected' | 'kicked' | 'over' | 'elsewhere'
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
	/** short announcements: new wave, squad wiped, objective done, checkpoint, mission complete */
	banner: {
		text: 'wave' | 'wipe' | 'objective' | 'checkpoint' | 'complete' | 'run-over'
		wave: number
		at: number
	} | null
	/** the mission being played, null outside missions */
	mission: MissionHud | null
	/** this player's kill chain, its multiplier, the chain timer left (0..1) and mission score */
	chain: number
	multiplier: number
	chainLeft: number
	missionScore: number
	/** buffs running for this player: name and seconds left */
	buffs: { id: string; name: string; seconds: number }[]
	/** things found or picked up, newest last; the HUD shows each for a few seconds */
	toasts: Toast[]
	/** the results screen, once the mission is complete */
	results: Results | null
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

export type MissionHud = {
	id: string
	name: string
	difficulty: string
	/** current objective, 0-based, out of `count` */
	objective: number
	count: number
	label: string
	type: 'kill' | 'reach' | 'hold' | 'survive'
	/** kills, or seconds for hold and survive */
	progress: number
	goal: number
	complete: boolean
}

export type Toast = {
	id: number
	kind: 'item' | 'buff' | 'threshold'
	/** the item or buff name, or the Salvage paid for a threshold */
	text: string
	/** who picked a buff up (teammates' pickups help everyone) */
	by: string | null
	at: number
}

export type Results = {
	success: boolean
	/** Survival: rounds survived */
	rounds: number
	timeMs: number
	score: number
	kills: number
	xp: number
	salvage: number
	downs: number
	items: string[]
	mastery: number
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
	mission: null,
	chain: 0,
	multiplier: 1,
	chainLeft: 0,
	missionScore: 0,
	buffs: [],
	toasts: [],
	results: null,
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
