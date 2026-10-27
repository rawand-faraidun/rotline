import type { MapDef } from '@rotline/game-data'

/** a cell of water: nobody walks through it, shots and thrown things cross it */
export const WATER_CELL = 4

/** The map as a 1 m occupancy grid. Walls are whole cells: 1 for the map, 2 for barricades, 3 for props, 4 for water. */
export class Grid {
	readonly width: number
	readonly height: number
	readonly walls: Uint8Array

	constructor(map: MapDef) {
		this.width = map.width
		this.height = map.height
		this.walls = new Uint8Array(map.width * map.height)
		// blockers (under scenery) stop movement and shots like walls
		for (const wall of [...map.walls, ...(map.blockers ?? [])]) {
			for (let y = wall.y; y < wall.y + wall.h; y++) {
				for (let x = wall.x; x < wall.x + wall.w; x++) {
					if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.walls[y * this.width + x] = 1
				}
			}
		}
		// water and fences: nobody walks through, shots and thrown things cross
		for (const pool of [...(map.water ?? []), ...(map.fences ?? [])]) {
			for (let y = pool.y; y < pool.y + pool.h; y++) {
				for (let x = pool.x; x < pool.x + pool.w; x++) {
					if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.walls[y * this.width + x] = WATER_CELL
				}
			}
		}
	}

	isWall(x: number, y: number): boolean {
		const cx = Math.floor(x)
		const cy = Math.floor(y)
		if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return true
		return this.walls[cy * this.width + cx] !== 0
	}

	/** True if a circle at (x, y) overlaps any wall cell. */
	circleHitsWall(x: number, y: number, r: number): boolean {
		const x0 = Math.floor(x - r)
		const x1 = Math.floor(x + r)
		const y0 = Math.floor(y - r)
		const y1 = Math.floor(y + r)
		for (let cy = y0; cy <= y1; cy++) {
			for (let cx = x0; cx <= x1; cx++) {
				if (cx >= 0 && cy >= 0 && cx < this.width && cy < this.height && this.walls[cy * this.width + cx] === 0) {
					continue
				}
				const nx = Math.max(cx, Math.min(x, cx + 1))
				const ny = Math.max(cy, Math.min(y, cy + 1))
				const dx = x - nx
				const dy = y - ny
				if (dx * dx + dy * dy < r * r) return true
			}
		}
		return false
	}

	/**
	 * Moves a circle by (dx, dy), one axis at a time so it slides along walls.
	 * When an axis is blocked it moves as far as it can (bisection), so it ends flush with the wall.
	 */
	moveCircle(x: number, y: number, dx: number, dy: number, r: number, out: { x: number; y: number }): void {
		let nx = x + dx
		if (this.circleHitsWall(nx, y, r)) nx = x + dx * this.freeFraction(x, y, dx, 0, r)
		let ny = y + dy
		if (this.circleHitsWall(nx, ny, r)) ny = y + dy * this.freeFraction(nx, y, 0, dy, r)
		out.x = nx
		out.y = ny
	}

	private freeFraction(x: number, y: number, dx: number, dy: number, r: number): number {
		let lo = 0
		let hi = 1
		for (let i = 0; i < 6; i++) {
			const mid = (lo + hi) / 2
			if (this.circleHitsWall(x + dx * mid, y + dy * mid, r)) hi = mid
			else lo = mid
		}
		return lo
	}

	/** Distance along a ray until it enters a wall cell, up to maxDistance (grid traversal); water is crossed. */
	rayToWall(x: number, y: number, dirX: number, dirY: number, maxDistance: number): number {
		let cx = Math.floor(x)
		let cy = Math.floor(y)
		const stepX = dirX > 0 ? 1 : -1
		const stepY = dirY > 0 ? 1 : -1
		const deltaX = dirX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirX)
		const deltaY = dirY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirY)
		let sideX = dirX === 0 ? Number.POSITIVE_INFINITY : (dirX > 0 ? cx + 1 - x : x - cx) * deltaX
		let sideY = dirY === 0 ? Number.POSITIVE_INFINITY : (dirY > 0 ? cy + 1 - y : y - cy) * deltaY
		let distance = 0
		while (distance < maxDistance) {
			if (sideX < sideY) {
				distance = sideX
				sideX += deltaX
				cx += stepX
			} else {
				distance = sideY
				sideY += deltaY
				cy += stepY
			}
			if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return Math.min(distance, maxDistance)
			const cell = this.walls[cy * this.width + cx] as number
			if (cell !== 0 && cell !== WATER_CELL) return Math.min(distance, maxDistance)
		}
		return maxDistance
	}
}
