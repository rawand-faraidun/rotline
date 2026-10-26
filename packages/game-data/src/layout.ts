import type { MapDef, MapProp } from './schema.ts'

/**
 * A map drawn as text, one character per metre: `#` wall, `x` blocker (solid, not drawn: under
 * scenery), `.` floor, `P` player spawn, `Z` or a digit zombie spawn (the digit is its section),
 * `b` barrel, `c` crate, `s` sandbags, `h` a cracked stretch of wall hiding a secret (shoot it down),
 * `%` hedge, `=` shipping container (solid, drawn as such; touching cells of one make one block). Named,
 * interactive props come in `props`, scenery in `decor`.
 */
export type MapSource = {
	id: string
	name: string
	layout: string[]
	props?: MapProp[]
	range?: MapDef['range']
	look?: MapDef['look']
	decor?: MapDef['decor']
	patches?: MapDef['patches']
}

const PROP_CHARS: Record<string, MapProp['kind']> = { b: 'barrel', c: 'crate', s: 'sandbags' }

export function fromLayout(source: MapSource): MapDef {
	const height = source.layout.length
	const width = source.layout[0]?.length ?? 0
	const walls: MapDef['walls'] = []
	const blockers: MapDef['walls'] = []
	const playerSpawns: MapDef['playerSpawns'] = []
	const zombieSpawns: MapDef['zombieSpawns'] = []
	const props: MapProp[] = []
	const weak = new Set<number>()
	const solidCells: Record<'hedge' | 'container', Set<number>> = { hedge: new Set(), container: new Set() }
	for (const [y, row] of source.layout.entries()) {
		if (row.length !== width)
			throw new Error(`game data maps/${source.id}: row ${y} is ${row.length} wide, not ${width}`)
		let run = -1
		let blocked = -1
		for (let x = 0; x <= width; x++) {
			const ch = row[x] ?? '.'
			if (ch !== '#' && run >= 0) {
				walls.push({ x: run, y, w: x - run, h: 1 })
				run = -1
			}
			if (ch !== 'x' && blocked >= 0) {
				blockers.push({ x: blocked, y, w: x - blocked, h: 1 })
				blocked = -1
			}
			if (ch === '#') {
				if (run < 0) run = x
				continue
			}
			if (ch === 'x') {
				if (blocked < 0) blocked = x
				continue
			}
			if (x === width) break
			if (ch === 'P') playerSpawns.push({ x: x + 0.5, y: y + 0.5 })
			else if (ch === 'Z') zombieSpawns.push({ x: x + 0.5, y: y + 0.5, section: 0 })
			else if (ch >= '0' && ch <= '9') zombieSpawns.push({ x: x + 0.5, y: y + 0.5, section: Number(ch) })
			else if (ch === 'h') weak.add(y * width + x)
			else if (ch === '%') solidCells.hedge.add(y * width + x)
			else if (ch === '=') solidCells.container.add(y * width + x)
			else if (PROP_CHARS[ch]) props.push({ id: `${PROP_CHARS[ch]}-${x}-${y}`, kind: PROP_CHARS[ch], x, y })
			else if (ch !== '.') throw new Error(`game data maps/${source.id}: unknown character '${ch}' at ${x}, ${y}`)
		}
	}
	props.push(...weakWalls(weak, width))
	const solids = (['hedge', 'container'] as const).flatMap(kind =>
		blocks(solidCells[kind], width).map(block => ({ ...block, kind }))
	)
	blockers.push(...solids.map(({ x, y, w, h }) => ({ x, y, w, h })))
	return {
		id: source.id,
		name: source.name,
		width,
		height,
		walls,
		playerSpawns,
		zombieSpawns,
		props: [...props, ...(source.props ?? [])],
		...(blockers.length > 0 ? { blockers } : {}),
		...(solids.length > 0 ? { solids } : {}),
		...(source.decor ? { decor: source.decor } : {}),
		...(source.patches ? { patches: source.patches } : {}),
		...(source.range ? { range: source.range } : {}),
		...(source.look ? { look: source.look } : {})
	}
}

/**
 * Joins touching `h` cells into stretches of weak wall, one prop each (a row first, else a column), so a
 * cracked wall comes down in one piece and opens the whole gap.
 */
function weakWalls(cells: Set<number>, width: number): MapProp[] {
	const walls: MapProp[] = []
	for (const cell of [...cells].sort((a, b) => a - b)) {
		if (!cells.has(cell)) continue
		const x = cell % width
		const y = Math.floor(cell / width)
		let w = 1
		while (x + w < width && cells.has(cell + w)) w++
		let h = 1
		if (w === 1) while (cells.has(cell + h * width)) h++
		for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.delete(cell + dy * width + dx)
		walls.push({ id: `weakwall-${x}-${y}`, kind: 'weakwall', x, y, ...(w > 1 ? { w } : {}), ...(h > 1 ? { h } : {}) })
	}
	return walls
}

/**
 * Cuts cells into rectangles: runs along each row, joined with the same runs in the rows below
 * (a hedge or a stack of containers drawn as a block becomes one piece).
 */
function blocks(cells: Set<number>, width: number): { x: number; y: number; w: number; h: number }[] {
	const out: { x: number; y: number; w: number; h: number }[] = []
	for (const cell of [...cells].sort((a, b) => a - b)) {
		if (!cells.has(cell)) continue
		const x = cell % width
		const y = Math.floor(cell / width)
		let w = 1
		while (x + w < width && cells.has(cell + w)) w++
		let h = 1
		const fullRow = (row: number) => {
			for (let dx = 0; dx < w; dx++) if (!cells.has(row * width + x + dx)) return false
			// the run must end there too, or it belongs to a wider block
			return !cells.has(row * width + x + w) && (x === 0 || !cells.has(row * width + x - 1))
		}
		while (fullRow(y + h)) h++
		for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.delete(cell + dy * width + dx)
		out.push({ x, y, w, h })
	}
	return out
}
