import type { MapDef, MapProp } from './schema.ts'

/**
 * A map drawn as text, one character per metre: `#` wall, `x` blocker (solid, not drawn: under
 * scenery), `.` floor, `P` player spawn, `Z` or a digit zombie spawn (the digit is its section),
 * `b` barrel, `c` crate, `s` sandbags. Named, interactive props come in `props`, scenery in `decor`.
 */
export type MapSource = {
	id: string
	name: string
	layout: string[]
	props?: MapProp[]
	range?: MapDef['range']
	look?: MapDef['look']
	decor?: MapDef['decor']
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
			else if (PROP_CHARS[ch]) props.push({ id: `${PROP_CHARS[ch]}-${x}-${y}`, kind: PROP_CHARS[ch], x, y })
			else if (ch !== '.') throw new Error(`game data maps/${source.id}: unknown character '${ch}' at ${x}, ${y}`)
		}
	}
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
		...(source.decor ? { decor: source.decor } : {}),
		...(source.range ? { range: source.range } : {}),
		...(source.look ? { look: source.look } : {})
	}
}
