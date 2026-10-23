import type { MapDef } from '@rotline/game-data'

/**
 * What lies beyond a map's border, so its edge is a wall in a town rather than the end of the world:
 * a street running round the map, then a ring of buildings of different widths and heights with
 * alleys between them, and on the street parked and burnt-out cars, lamps, barriers and rubbish.
 * Drawing only (nothing out there can be reached), placed the same way every time for a map.
 */

export type Building = { x: number; y: number; w: number; h: number; height: number }
type DecorEntry = NonNullable<MapDef['decor']>[number]

/** how wide the street round the map is (metres from the border wall to the buildings) */
const STREET = 5
/** how far the ground reaches beyond the map, so the camera never sees past it */
export const OUTSIDE = 40

function random(seed: string): () => number {
	let state = 2166136261
	for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 4294967296
	}
}

export function surroundings(map: MapDef): { buildings: Building[]; decor: DecorEntry[] } {
	const rng = random(`${map.id}:outside`)
	const between = (low: number, high: number) => low + rng() * (high - low)
	const buildings: Building[] = []
	const decor: DecorEntry[] = []
	const W = map.width
	const H = map.height

	// one side at a time: buildings stand in a row along it, facing the map across the street
	type Side = {
		/** where along the side the row starts and ends */
		from: number
		to: number
		/** a building at `along`, `width` wide and `depth` deep */
		place: (along: number, width: number, depth: number) => { x: number; y: number; w: number; h: number }
		/** a point on the street at `along`, `out` metres from the border, and the street's direction (degrees) */
		street: (along: number, out: number) => { x: number; y: number }
		turn: number
	}
	const reach = STREET + 16
	const sides: Side[] = [
		{
			from: -reach,
			to: W + reach,
			place: (a, w, d) => ({ x: a, y: -STREET - d, w, h: d }),
			street: (a, out) => ({ x: a, y: -out }),
			turn: 90
		},
		{
			from: -reach,
			to: W + reach,
			place: (a, w, d) => ({ x: a, y: H + STREET, w, h: d }),
			street: (a, out) => ({ x: a, y: H + out }),
			turn: 90
		},
		{
			from: -STREET,
			to: H + STREET,
			place: (a, w, d) => ({ x: -STREET - d, y: a, w: d, h: w }),
			street: (a, out) => ({ x: -out, y: a }),
			turn: 0
		},
		{
			from: -STREET,
			to: H + STREET,
			place: (a, w, d) => ({ x: W + STREET, y: a, w: d, h: w }),
			street: (a, out) => ({ x: W + out, y: a }),
			turn: 0
		}
	]
	for (const side of sides) {
		let along = side.from
		while (along < side.to) {
			const width = Math.round(between(6, 15))
			const depth = Math.round(between(9, 15))
			const rect = side.place(along, Math.min(width, side.to - along), depth)
			// low sheds, houses, blocks of flats
			const height = [4.5, 6.5, 6.5, 9.5, 9.5, 12.5][Math.floor(rng() * 6)] as number
			if (rect.w > 2 && rect.h > 2) buildings.push({ ...rect, height })
			// an alley now and then
			along += width + (rng() < 0.35 ? Math.round(between(2, 4)) : 0)
		}
		// the street: lamps along the map's side, cars and rubbish along the buildings' side
		for (let a = side.from + 6; a < side.to - 4; a += between(11, 16)) {
			const at = side.street(a, 1.6)
			decor.push({ model: rng() < 0.5 ? 'scene-lamp' : 'scene-lamp2', x: at.x, y: at.y, rotation: [0, side.turn, 0] })
		}
		for (let a = side.from + 4; a < side.to - 4; a += between(5, 11)) {
			const roll = rng()
			const at = side.street(a, between(STREET - 2.2, STREET - 1.2))
			if (roll < 0.45) {
				const burnt = rng() < 0.3
				decor.push({
					model: 'scene-car',
					x: at.x,
					y: at.y,
					rotation: [0, side.turn + (rng() < 0.5 ? 0 : 180) + between(-12, 12), 0],
					...(burnt ? { fire: between(0.6, 1.1) } : {})
				})
			} else if (roll < 0.6) {
				decor.push({ model: 'scene-barrier', x: at.x, y: at.y, rotation: [0, side.turn + between(-20, 20), 0] })
			} else {
				const litter = ['scene-trash', 'scene-bin', 'scene-cardboard', 'scene-tyre'][Math.floor(rng() * 4)] as string
				decor.push({ model: litter, x: at.x, y: at.y, rotation: [0, rng() * 360, 0] })
			}
		}
	}
	return { buildings, decor }
}
