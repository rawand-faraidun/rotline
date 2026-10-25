import { type MapDef, type MapProp, type PropKindId, propsDef } from '@rotline/game-data'
import { DT, NEVER, TICK_RATE } from './constants.ts'
import type { Grid } from './grid.ts'
import type { PlayerState } from './player.ts'

/** Kinds of map props, as numbers for the protocol. */
export const PropKind: Record<PropKindId, number> = {
	barrel: 1,
	crate: 2,
	sandbags: 3,
	door: 4,
	generator: 5,
	terminal: 6,
	turret: 7,
	floodlight: 8,
	trap: 9,
	survivor: 10,
	carry: 11,
	defend: 12,
	nest: 13,
	ammo: 14,
	weakwall: 15
}

/** What a prop is doing. Not every state applies to every kind. */
export const PropState = {
	idle: 0,
	open: 1,
	closed: 2,
	welded: 3,
	destroyed: 4,
	/** a generator or terminal that has been worked, a trap that has been set off */
	done: 5,
	/** a trap going off */
	active: 6,
	/** a freed survivor walking with the squad */
	following: 7,
	/** an object a player is carrying */
	carried: 8,
	/** a survivor who reached safety, an object delivered */
	delivered: 9,
	/** a mission gate: closed and impossible to open until the mission opens it */
	locked: 10
} as const

/** Grid cell value for cells a prop blocks (the map's own walls are 1, barricades 2). */
export const PROP_CELL = 3

export type Prop = {
	index: number
	def: MapProp
	kind: number
	/** centre, metres; survivors and carried objects move */
	x: number
	y: number
	/** cells the prop occupies when it blocks */
	cells: number[]
	health: number
	maxHealth: number
	state: number
	/** 0..1 for hold interactions (weld, free, power up, hack, pick up) */
	progress: number
	/** player slot holding interact on it this tick (0 nobody) */
	holder: number
	/** traps: active until; turrets: next shot */
	untilTick: number
	readyTick: number
	/** player slot carrying it or followed by it */
	with: number
	/** generators: worked; turrets and lights: their generator is */
	powered: boolean
	/** generator prop index powering this one (-1 none) */
	powerBy: number
	/** where and how it started, for a restart from a checkpoint */
	home: { x: number; y: number; state: number; health: number }
}

const cellsOf = (def: MapProp, width: number): number[] => {
	const cells: number[] = []
	const w = def.w ?? 1
	const h = def.h ?? 1
	for (let y = def.y; y < def.y + h; y++) for (let x = def.x; x < def.x + w; x++) cells.push(y * width + x)
	return cells
}

/** Kinds standing on cells (top-left x, y and a size); the others stand on a point. */
const CELL_KINDS = new Set<PropKindId>([
	'barrel',
	'crate',
	'weakwall',
	'sandbags',
	'door',
	'generator',
	'terminal',
	'turret',
	'defend',
	'nest',
	'ammo'
])

function startState(def: MapProp): number {
	switch (def.kind) {
		case 'door':
			return def.locked ? PropState.locked : def.closed ? PropState.closed : PropState.open
		default:
			return PropState.idle
	}
}

function startHealth(def: MapProp): number {
	switch (def.kind) {
		case 'barrel':
			return propsDef.barrel.health
		case 'crate':
			return propsDef.crate.health
		case 'weakwall':
			return propsDef.weakwall.health
		case 'sandbags':
			return propsDef.sandbags.health
		case 'door':
			return propsDef.door.closedHealth
		case 'survivor':
			return propsDef.survivor.health
		case 'generator':
			return propsDef.generator.health
		case 'defend':
			return def.health ?? propsDef.defend.health
		case 'nest':
			return def.health ?? propsDef.nest.health
		default:
			return 0
	}
}

/** The map's props in their starting state; blocking ones are written into the grid. */
export function createProps(map: MapDef, grid: Grid): Prop[] {
	const props: Prop[] = (map.props ?? []).map((def, index) => {
		const onCells = CELL_KINDS.has(def.kind)
		const x = onCells ? def.x + (def.w ?? 1) / 2 : def.x
		const y = onCells ? def.y + (def.h ?? 1) / 2 : def.y
		const state = startState(def)
		const health = startHealth(def)
		return {
			index,
			def,
			kind: PropKind[def.kind],
			x,
			y,
			cells: onCells ? cellsOf(def, grid.width) : [],
			health,
			maxHealth: def.kind === 'door' ? propsDef.door.weldedHealth : health,
			state,
			progress: 0,
			holder: 0,
			untilTick: 0,
			readyTick: 0,
			with: 0,
			powered: false,
			powerBy: -1,
			home: { x, y, state, health }
		}
	})
	const byId = new Map(props.map(prop => [prop.def.id, prop.index]))
	for (const prop of props) {
		if (prop.def.powerBy) prop.powerBy = byId.get(prop.def.powerBy) ?? -1
		// a turret or light with no generator is always on
		if ((prop.def.kind === 'turret' || prop.def.kind === 'floodlight') && prop.powerBy < 0) prop.powered = true
		applyCells(grid, prop)
	}
	return props
}

/** Does the prop block movement, shots and pathing right now? */
export function blocks(prop: Prop): boolean {
	if (prop.cells.length === 0 || prop.state === PropState.destroyed) return false
	if (prop.def.kind === 'door') return prop.state !== PropState.open
	return true
}

/** Writes (or clears) the prop's cells in the grid; the client calls it too, so both grids agree. */
export function applyCells(grid: Grid, prop: Prop): void {
	const value = blocks(prop) ? PROP_CELL : 0
	for (const cell of prop.cells) {
		const current = grid.walls[cell] as number
		// never clear the map's own walls or a barricade
		if (current === 0 || current === PROP_CELL) grid.walls[cell] = value
	}
}

/** Sets a prop's state (and its cells); the one place blocking changes. */
export function setPropState(grid: Grid, prop: Prop, state: number): void {
	prop.state = state
	applyCells(grid, prop)
}

/** How far a player may be from a prop's edge to work it. */
export function reach(prop: Prop, player: PlayerState): number {
	const halfW = prop.cells.length > 0 ? (prop.def.w ?? 1) / 2 : 0
	const halfH = prop.cells.length > 0 ? (prop.def.h ?? 1) / 2 : 0
	const dx = Math.max(0, Math.abs(player.x - prop.x) - halfW)
	const dy = Math.max(0, Math.abs(player.y - prop.y) - halfH)
	return Math.hypot(dx, dy)
}

export const ticks = (seconds: number): number => Math.max(1, Math.round(seconds * TICK_RATE))

/** Seconds of holding each hold interaction takes. */
export function holdSeconds(prop: Prop): number {
	switch (prop.def.kind) {
		case 'door':
			return propsDef.door.weldSeconds
		case 'generator':
			return propsDef.generator.holdSeconds
		case 'terminal':
			return propsDef.terminal.holdSeconds
		case 'survivor':
			return propsDef.survivor.freeSeconds
		case 'carry':
			return propsDef.carry.pickupSeconds
		case 'ammo':
			return propsDef.ammo.holdSeconds
		default:
			return 0
	}
}

/** Per-tick progress of a hold interaction. */
export const holdStep = (prop: Prop): number => DT / Math.max(DT, holdSeconds(prop))

export { NEVER }
