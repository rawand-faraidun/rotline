import type { MissionDef } from '@rotline/game-data'
import { type Prop, PropState } from '@rotline/sim'

type Objective = MissionDef['objectives'][number]
type Point = { x: number; y: number }

/**
 * Where the current objective wants the squad to go: its area, or the nearest of the props still to
 * be dealt with (a nest to burn, a generator to start, a survivor to free, the object to carry).
 * Null when the objective is not a place (kill so many, survive so long).
 */
export function objectiveTarget(
	objective: Objective,
	props: readonly Prop[],
	from: Point,
	state: { picked: number; areas: readonly number[] } = { picked: 0, areas: [] }
): Point | null {
	const byId = (id: string) => props.find(prop => prop.def.id === id)
	const nearest = (ids: readonly string[], wanted: (prop: Prop) => boolean): Point | null => {
		let best: Point | null = null
		let bestDistance = Number.POSITIVE_INFINITY
		for (const id of ids) {
			const prop = byId(id)
			if (!prop || !wanted(prop)) continue
			const distance = Math.hypot(prop.x - from.x, prop.y - from.y)
			if (distance < bestDistance) {
				bestDistance = distance
				best = { x: prop.x, y: prop.y }
			}
		}
		return best
	}
	switch (objective.type) {
		case 'reach':
		case 'hold':
		case 'extract':
			return objective.area
		case 'destroy':
			return nearest(objective.props, prop => prop.state !== PropState.destroyed)
		case 'interact':
			return nearest(objective.props, prop => prop.state !== PropState.done)
		case 'defend':
			return nearest([objective.prop], () => true)
		case 'rescue':
			// free the survivors still waiting, then walk the freed ones to safety
			return nearest(objective.survivors, prop => prop.state === PropState.idle) ?? objective.area
		case 'retrieve': {
			const item = byId(objective.item)
			return item && item.state !== PropState.carried ? { x: item.x, y: item.y } : objective.area
		}
		case 'escape':
			return objective.area
		case 'escort':
			return nearest([objective.prop], () => true)
		case 'gather':
		case 'capture': {
			// the nearest item still lying there, or the nearest area not yet taken
			const spots: Point[] =
				objective.type === 'gather'
					? objective.items.filter((_, index) => (state.picked & (1 << index)) === 0)
					: objective.areas.filter((_, index) => (state.areas[index] ?? 0) < 1)
			let best: Point | null = null
			for (const spot of spots)
				if (!best || Math.hypot(spot.x - from.x, spot.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y))
					best = spot
			return best
		}
		default:
			return null
	}
}

/**
 * Where a waypoint is drawn: its own place on screen when it is in view, else on an ellipse around
 * the middle of the screen (clear of the HUD in the corners) on the line toward it, with the angle it
 * points at. Coordinates are 0..1 of the screen.
 */
export function screenWaypoint(
	sx: number,
	sy: number,
	behind: boolean,
	margin = 0.08,
	ring = { x: 0.36, y: 0.34 }
): { x: number; y: number; onScreen: boolean; angle: number } {
	// behind the camera the projection is mirrored: point the other way
	let dx = sx - 0.5
	let dy = sy - 0.5
	if (behind) {
		dx = -dx
		dy = -dy
	}
	const angle = Math.atan2(dy, dx)
	const inside = !behind && sx >= margin && sx <= 1 - margin && sy >= margin && sy <= 1 - margin
	if (inside) return { x: sx, y: sy, onScreen: true, angle }
	return { x: 0.5 + Math.cos(angle) * ring.x, y: 0.5 + Math.sin(angle) * ring.y, onScreen: false, angle }
}
