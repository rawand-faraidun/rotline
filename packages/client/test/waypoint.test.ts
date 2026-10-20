import type { Prop } from '@rotline/sim'
import { PropState } from '@rotline/sim'
import { describe, expect, it } from 'vitest'
import { objectiveTarget, screenWaypoint } from '../src/waypoint.ts'

const prop = (id: string, x: number, y: number, state: number = PropState.idle) =>
	({ def: { id }, x, y, state }) as unknown as Prop

describe('objective targets', () => {
	const from = { x: 0, y: 0 }

	it('is the area for places to reach, hold or extract from', () => {
		const area = { x: 5, y: 6, radius: 3 }
		expect(objectiveTarget({ type: 'reach', label: '', area } as never, [], from)).toEqual(area)
		expect(objectiveTarget({ type: 'extract', label: '', area, seconds: 90 } as never, [], from)).toEqual(area)
	})

	it('is the nearest nest still standing', () => {
		const props = [prop('a', 20, 0), prop('b', 4, 3), prop('c', 1, 1, PropState.destroyed)]
		expect(objectiveTarget({ type: 'destroy', label: '', props: ['a', 'b', 'c'] } as never, props, from)).toEqual({
			x: 4,
			y: 3
		})
	})

	it('is nothing once every nest is down, or for kill and survive', () => {
		const props = [prop('a', 2, 2, PropState.destroyed)]
		expect(objectiveTarget({ type: 'destroy', label: '', props: ['a'] } as never, props, from)).toBeNull()
		expect(objectiveTarget({ type: 'kill', label: '', count: 10 } as never, props, from)).toBeNull()
	})

	it('leads to the survivors still waiting, then to safety', () => {
		const area = { x: 30, y: 30, radius: 4 }
		const objective = { type: 'rescue', label: '', survivors: ['s1', 's2'], area } as never
		expect(objectiveTarget(objective, [prop('s1', 3, 0), prop('s2', 9, 0)], from)).toEqual({ x: 3, y: 0 })
		const freed = [prop('s1', 3, 0, PropState.following), prop('s2', 9, 0, PropState.following)]
		expect(objectiveTarget(objective, freed, from)).toEqual(area)
	})

	it('points at the object, then where it goes once carried', () => {
		const area = { x: 10, y: 0, radius: 2 }
		const objective = { type: 'retrieve', label: '', item: 'box', area } as never
		expect(objectiveTarget(objective, [prop('box', -4, 2)], from)).toEqual({ x: -4, y: 2 })
		expect(objectiveTarget(objective, [prop('box', -4, 2, PropState.carried)], from)).toEqual(area)
	})
})

describe('screen waypoints', () => {
	it('stay where they are when on screen', () => {
		expect(screenWaypoint(0.3, 0.6, false)).toMatchObject({ x: 0.3, y: 0.6, onScreen: true })
	})

	it('pin to the edge toward the target when off screen', () => {
		const right = screenWaypoint(1.8, 0.5, false)
		expect(right.onScreen).toBe(false)
		expect(right.x).toBeCloseTo(0.94)
		expect(right.y).toBeCloseTo(0.5)
		expect(right.angle).toBeCloseTo(0)
		const up = screenWaypoint(0.5, -2, false)
		expect(up.y).toBeCloseTo(0.06)
		expect(up.angle).toBeCloseTo(-Math.PI / 2)
	})

	it('point the other way for targets behind the camera', () => {
		const behind = screenWaypoint(0.7, 0.5, true)
		expect(behind.onScreen).toBe(false)
		expect(behind.x).toBeLessThan(0.5)
	})
})
