import { type MapDef, zombies as zombieDefs } from '@rotline/game-data'
import { type Prop, PropKind, PropState } from '@rotline/sim'
import type { ZombieView } from './interpolate.ts'
import { SLOT_COLOURS } from './render/players.ts'

/** Pixels per metre of the drawn map (the corner view scales it, the full view fits it). */
const SCALE = 4
/** How many metres around the player the corner map shows, edge to middle. */
const CORNER_RADIUS = 30

export type MinimapMode = 'corner' | 'full'

export type MinimapFrame = {
	/** the player's own place, facing (radians, screen-up is -y) and slot; null before spawning */
	me: { x: number; y: number; angle: number; slot: number; alive: boolean } | null
	others: readonly { x: number; y: number; slot: number; alive: boolean; downed: boolean }[]
	zombies: ZombieView
	/** the current objective's place, if it has one */
	target: { x: number; y: number } | null
	props: readonly Prop[]
}

const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`
const ELITES = new Set(zombieDefs.flatMap((zombie, index) => (zombie.elite ? [index] : [])))

/**
 * The map in small: walls drawn once, then each frame the doors that still bar the way, every zombie,
 * the squad (in their slot colours, the player as an arrow) and the objective. In the corner it
 * follows the player; opened up it shows the whole map.
 */
export class Minimap {
	private readonly base: HTMLCanvasElement
	private readonly width: number
	private readonly height: number

	constructor(map: MapDef) {
		this.width = map.width
		this.height = map.height
		this.base = document.createElement('canvas')
		this.base.width = map.width * SCALE
		this.base.height = map.height * SCALE
		const ctx = this.base.getContext('2d') as CanvasRenderingContext2D
		ctx.fillStyle = '#151a16'
		ctx.fillRect(0, 0, this.base.width, this.base.height)
		ctx.fillStyle = '#7d8676'
		for (const wall of map.walls) ctx.fillRect(wall.x * SCALE, wall.y * SCALE, wall.w * SCALE, wall.h * SCALE)
		// hedges and containers in their own colours, the scenery's blockers faintly
		ctx.fillStyle = '#3a4537'
		for (const block of map.blockers ?? [])
			ctx.fillRect(block.x * SCALE, block.y * SCALE, block.w * SCALE, block.h * SCALE)
		ctx.fillStyle = '#24404a'
		for (const pool of map.water ?? []) ctx.fillRect(pool.x * SCALE, pool.y * SCALE, pool.w * SCALE, pool.h * SCALE)
		for (const solid of map.solids ?? []) {
			ctx.fillStyle = solid.kind === 'hedge' ? '#3f6a32' : '#8a6a4a'
			ctx.fillRect(solid.x * SCALE, solid.y * SCALE, solid.w * SCALE, solid.h * SCALE)
		}
	}

	draw(canvas: HTMLCanvasElement, mode: MinimapMode, frame: MinimapFrame): void {
		const ratio = Math.min(2, window.devicePixelRatio || 1)
		const size = Math.round(canvas.clientWidth * ratio)
		const tall = Math.round(canvas.clientHeight * ratio)
		if (size === 0 || tall === 0) return
		if (canvas.width !== size || canvas.height !== tall) {
			canvas.width = size
			canvas.height = tall
		}
		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.fillStyle = '#0d100e'
		ctx.fillRect(0, 0, size, tall)

		// metres to pixels on this canvas, and the map point at its middle
		let scale: number
		let cx: number
		let cy: number
		if (mode === 'full' || !frame.me) {
			scale = Math.min(size / this.width, tall / this.height) * 0.96
			cx = this.width / 2
			cy = this.height / 2
		} else {
			scale = Math.min(size, tall) / (CORNER_RADIUS * 2)
			cx = frame.me.x
			cy = frame.me.y
		}
		const toX = (x: number) => size / 2 + (x - cx) * scale
		const toY = (y: number) => tall / 2 + (y - cy) * scale
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(this.base, toX(0), toY(0), this.width * scale, this.height * scale)

		// doors still shut or locked: a mission gate reads at a glance
		for (const prop of frame.props) {
			if (prop.kind !== PropKind.door) continue
			if (prop.state === PropState.open || prop.state === PropState.destroyed) continue
			const w = prop.def.w ?? 1
			const h = prop.def.h ?? 1
			ctx.fillStyle = prop.state === PropState.locked ? '#ff5630' : '#c9a25a'
			ctx.fillRect(toX(prop.def.x), toY(prop.def.y), w * scale, h * scale)
		}

		// the horde: a red dot each, larger for elites
		const dot = Math.max(2.2 * ratio, scale * 0.5)
		const view = frame.zombies
		ctx.fillStyle = '#ff4b3a'
		for (let n = 0; n < view.count; n++) {
			const elite = ELITES.has(view.type[n] as number)
			const r = elite ? dot * 2.2 : dot
			ctx.fillRect(toX(view.x[n] as number) - r / 2, toY(view.y[n] as number) - r / 2, r, r)
		}

		// the objective: a lime diamond (at the edge of the corner map when it is further away)
		if (frame.target) {
			let tx = toX(frame.target.x)
			let ty = toY(frame.target.y)
			const pad = 6 * ratio
			tx = Math.max(pad, Math.min(size - pad, tx))
			ty = Math.max(pad, Math.min(tall - pad, ty))
			const r = 5 * ratio
			ctx.fillStyle = '#b8f23c'
			ctx.strokeStyle = '#0d100e'
			ctx.lineWidth = ratio
			ctx.beginPath()
			ctx.moveTo(tx, ty - r)
			ctx.lineTo(tx + r, ty)
			ctx.lineTo(tx, ty + r)
			ctx.lineTo(tx - r, ty)
			ctx.closePath()
			ctx.fill()
			ctx.stroke()
		}

		// the squad: a ring in each player's colour (dim when out, blinking red when down)
		const blink = Math.floor(performance.now() / 300) % 2 === 0
		for (const other of frame.others) {
			const colour = hex(SLOT_COLOURS[(other.slot - 1) % SLOT_COLOURS.length] ?? 0xffffff)
			ctx.globalAlpha = other.alive ? 1 : 0.35
			ctx.fillStyle = other.downed && blink ? '#ff5630' : colour
			ctx.strokeStyle = '#0d100e'
			ctx.lineWidth = ratio * 1.5
			ctx.beginPath()
			ctx.arc(toX(other.x), toY(other.y), (mode === 'full' ? 6 : 4.5) * ratio, 0, Math.PI * 2)
			ctx.fill()
			ctx.stroke()
		}
		ctx.globalAlpha = 1
		// the player: an arrow pointing where they aim
		if (frame.me) {
			const colour = hex(SLOT_COLOURS[(frame.me.slot - 1) % SLOT_COLOURS.length] ?? 0xb8f23c)
			const x = toX(frame.me.x)
			const y = toY(frame.me.y)
			const r = (mode === 'full' ? 11 : 8) * ratio
			ctx.save()
			ctx.translate(x, y)
			ctx.rotate(frame.me.angle)
			ctx.beginPath()
			ctx.moveTo(r, 0)
			ctx.lineTo(-r * 0.7, r * 0.65)
			ctx.lineTo(-r * 0.35, 0)
			ctx.lineTo(-r * 0.7, -r * 0.65)
			ctx.closePath()
			ctx.fillStyle = frame.me.alive ? colour : '#6b7166'
			ctx.strokeStyle = '#0d100e'
			ctx.lineWidth = ratio * 1.5
			ctx.fill()
			ctx.stroke()
			ctx.restore()
		}
	}
}
