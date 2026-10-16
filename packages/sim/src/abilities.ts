import {
	abilities,
	abilityById,
	type DamageType,
	player as playerDef,
	type ZombieDef,
	zombies as zombieDefs
} from '@rotline/game-data'
import { DT, MAX_ZOMBIES, NEVER, TICK_RATE } from './constants.ts'
import type { Grid } from './grid.ts'
import { aimToAngle, type PlayerInput, REACH_STEP } from './input.ts'
import type { PlayerState } from './player.ts'
import { ObjectKind, type World, type WorldObject } from './world.ts'

const ticks = (seconds: number) => Math.round(seconds * TICK_RATE)

/** Where the player aims, clamped to `range` and to the first wall. */
function targetPoint(world: World, state: PlayerState, input: PlayerInput, range: number): { x: number; y: number } {
	const angle = aimToAngle(input.aim)
	const dirX = Math.cos(angle)
	const dirY = Math.sin(angle)
	const wanted = Math.min(range, Math.max(1.5, input.reach * REACH_STEP))
	const distance = Math.max(0, world.grid.rayToWall(state.x, state.y, dirX, dirY, wanted) - 0.3)
	return { x: state.x + dirX * distance, y: state.y + dirY * distance }
}

/** The grid cells of a barricade `width` metres wide, across the aim, 1.5 m ahead of (x, y). */
export function barricadeCells(grid: Grid, x: number, y: number, angle: number, width: number): number[] {
	const cx = x + Math.cos(angle) * 1.5
	const cy = y + Math.sin(angle) * 1.5
	const px = -Math.sin(angle)
	const py = Math.cos(angle)
	const cells = new Set<number>()
	for (let step = -width / 2; step <= width / 2; step += 0.5) {
		const gx = Math.floor(cx + px * step)
		const gy = Math.floor(cy + py * step)
		if (gx < 0 || gy < 0 || gx >= grid.width || gy >= grid.height) continue
		cells.add(gy * grid.width + gx)
	}
	return [...cells]
}

function zone(
	world: World,
	owner: PlayerState,
	kind: number,
	x: number,
	y: number,
	radius: number,
	seconds: number,
	perSecond: number,
	damageType: DamageType
): WorldObject {
	return world.addObject({
		kind,
		owner: owner.id,
		x,
		y,
		radius,
		angle: 0,
		untilTick: world.tick + ticks(seconds),
		health: 0,
		maxHealth: 0,
		amount: perSecond * DT,
		damageType,
		cells: [],
		nextTick: 0,
		interval: 0,
		trigger: 0
	})
}

/** A cell (a 1 m box) against a circle. */
function cellTouchesCircle(grid: Grid, cell: number, x: number, y: number, radius: number): boolean {
	const cx = cell % grid.width
	const cy = Math.floor(cell / grid.width)
	const nx = Math.max(cx, Math.min(x, cx + 1))
	const ny = Math.max(cy, Math.min(y, cy + 1))
	return (x - nx) ** 2 + (y - ny) ** 2 < radius * radius
}

/**
 * Resolves the world side of an ability: blasts, zones, heals, statuses, barricades. Returns false
 * when it had nothing to act on (the caller then gives the cooldown back).
 */
export function useAbility(world: World, state: PlayerState, id: string, input: PlayerInput): boolean {
	const ability = abilityById.get(id)
	if (!ability) return false
	const p = ability.params
	const n = (key: string) => p[key] ?? 0
	const angle = aimToAngle(input.aim)
	const scale = (type: DamageType) => state.stats.damageByType[type]
	const blastRadius = state.stats.blastRadius
	world.events.push({
		type: 'ability',
		player: state.id,
		ability: abilities.indexOf(ability),
		x: state.x,
		y: state.y,
		angle
	})
	switch (id) {
		case 'stim':
			world.heal(state, n('heal'), state)
			break
		case 'cluster-grenade': {
			const target = targetPoint(world, state, input, n('throwRange'))
			world.lob(state, target.x, target.y, (w, x, y) => {
				for (let b = 0; b < n('bomblets'); b++) {
					const spread = b === 0 ? 0 : 1.6
					const a = (b / Math.max(1, n('bomblets') - 1)) * Math.PI * 2 + w.rng.next() * 0.5
					w.pendingBlasts.push({
						tick: w.tick + 2 + b * 2,
						x: x + Math.cos(a) * spread,
						y: y + Math.sin(a) * spread,
						radius: n('radius') * blastRadius,
						damage: n('damage') * scale('explosive'),
						type: 'explosive',
						owner: state.id,
						stunTicks: 0,
						marker: 0
					})
				}
			})
			break
		}
		case 'breaching-charge': {
			const half = (n('angleDegrees') * Math.PI) / 360
			const length = n('length') * blastRadius
			for (let i = 0; i < MAX_ZOMBIES; i++) {
				if (world.alive[i] === 0) continue
				const dx = (world.x[i] as number) - state.x
				const dy = (world.y[i] as number) - state.y
				const d = Math.hypot(dx, dy)
				if (d > length || d < 1e-6) continue
				let off = Math.abs(Math.atan2(dy, dx) - angle) % (Math.PI * 2)
				if (off > Math.PI) off = Math.PI * 2 - off
				if (off > half) continue
				world.damageZombie(i, n('damage') * scale('explosive'), state.id, 'explosive')
				if (world.alive[i] === 0) continue
				const push = n('knockback') * (1 - d / length)
				const moved = { x: 0, y: 0 }
				world.grid.moveCircle(world.x[i] as number, world.y[i] as number, (dx / d) * push, (dy / d) * push, 0.3, moved)
				world.x[i] = moved.x
				world.y[i] = moved.y
			}
			world.events.push({
				type: 'explode',
				id: 0,
				x: state.x + Math.cos(angle) * 2,
				y: state.y + Math.sin(angle) * 2,
				radius: 2
			})
			break
		}
		case 'mark-target': {
			const target = world.zombieOnRay(state.x, state.y, angle, n('range'))
			if (target >= 0) world.mark(target, n('damageTaken'), ticks(n('durationSeconds')))
			break
		}
		case 'medkit-drop':
			zone(
				world,
				state,
				ObjectKind.heal,
				state.x,
				state.y,
				n('radius'),
				n('durationSeconds'),
				n('heal') / n('durationSeconds'),
				'chemical'
			)
			break
		case 'healing-field':
			zone(
				world,
				state,
				ObjectKind.heal,
				state.x,
				state.y,
				n('radius'),
				n('durationSeconds'),
				n('healPerSecond'),
				'chemical'
			)
			break
		case 'toxin-grenade': {
			const target = targetPoint(world, state, input, n('throwRange'))
			world.lob(state, target.x, target.y, (w, x, y) => {
				zone(
					w,
					state,
					ObjectKind.toxin,
					x,
					y,
					n('radius') * blastRadius,
					n('durationSeconds'),
					n('damagePerSecond') * scale('chemical'),
					'chemical'
				)
			})
			break
		}
		case 'antidote-shot':
			for (const player of world.players.values()) player.immuneUntil = world.tick + ticks(n('immunitySeconds'))
			break
		case 'defibrillator': {
			if (state.defibUsed) return false
			let best: PlayerState | null = null
			let bestDistance = n('range')
			for (const other of world.players.values()) {
				if (other === state || !other.alive || !other.downed) continue
				const d = Math.hypot(other.x - state.x, other.y - state.y)
				if (d <= bestDistance) {
					best = other
					bestDistance = d
				}
			}
			if (!best) return false
			world.revive(best, state)
			state.defibUsed = true
			break
		}
		case 'deploy-barricade': {
			const cells = barricadeCells(world.grid, state.x, state.y, angle, n('width')).filter(cell => {
				if (world.grid.walls[cell] !== 0) return false
				// never wall anyone in: no cell may touch a player or a zombie
				for (const player of world.players.values()) {
					if (cellTouchesCircle(world.grid, cell, player.x, player.y, playerDef.radius)) return false
				}
				for (let i = 0; i < MAX_ZOMBIES; i++) {
					if (world.alive[i] === 0) continue
					const radius = (zombieDefs[world.type[i] as number] as ZombieDef).radius
					if (cellTouchesCircle(world.grid, cell, world.x[i] as number, world.y[i] as number, radius)) return false
				}
				return true
			})
			if (cells.length === 0) return false
			for (const cell of cells) world.grid.walls[cell] = 2
			world.addObject({
				kind: ObjectKind.barricade,
				owner: state.id,
				x: state.x + Math.cos(angle) * 1.5,
				y: state.y + Math.sin(angle) * 1.5,
				radius: n('width') / 2,
				angle,
				untilTick: NEVER,
				health: n('health'),
				maxHealth: n('health'),
				amount: 0,
				damageType: 'ballistic',
				cells,
				nextTick: 0,
				interval: 0,
				trigger: 0
			})
			break
		}
		case 'taunt':
			world.taunt(state.x, state.y, n('radius'), ticks(n('durationSeconds')), state.id)
			break
		case 'aerial-bombardment': {
			const shells = n('shells')
			for (let b = 0; b < shells; b++) {
				const along = 3 + (n('length') * b) / Math.max(1, shells - 1)
				world.pendingBlasts.push({
					tick: world.tick + Math.round((ticks(n('durationSeconds')) * (b + 1)) / shells),
					x: state.x + Math.cos(angle) * along,
					y: state.y + Math.sin(angle) * along,
					radius: n('radius') * blastRadius,
					damage: n('damage') * scale('explosive'),
					type: 'explosive',
					owner: state.id,
					stunTicks: 0,
					marker: 0
				})
			}
			break
		}
		case 'mortar-shot': {
			const target = targetPoint(world, state, input, n('throwRange'))
			const radius = n('radius') * blastRadius
			const marker = zone(
				world,
				state,
				ObjectKind.marker,
				target.x,
				target.y,
				radius,
				n('delaySeconds'),
				0,
				'explosive'
			)
			world.pendingBlasts.push({
				tick: world.tick + ticks(n('delaySeconds')),
				x: target.x,
				y: target.y,
				radius,
				damage: n('damage') * scale('explosive'),
				type: 'explosive',
				owner: state.id,
				stunTicks: 0,
				marker: marker.id
			})
			break
		}
		case 'shock-pulse':
			world.blast(state.x, state.y, n('radius'), n('damage') * scale('shock'), 'shock', state.id, {
				stunTicks: ticks(n('stunSeconds'))
			})
			break
	}
	return true
}

/** Throws a grenade or places a mine, decoy or sentry from a utility slot. */
export function useUtility(world: World, state: PlayerState, slot: 0 | 1, input: PlayerInput): void {
	const utility = state.stats.utilities[slot]
	if (!utility) return
	const scale = state.stats.damageByType[utility.damageType]
	const base = {
		owner: state.id,
		angle: 0,
		health: 0,
		maxHealth: 0,
		damageType: utility.damageType,
		cells: [] as number[]
	}
	switch (utility.type) {
		case 'grenade': {
			const target = targetPoint(world, state, input, utility.throwRange)
			world.lob(state, target.x, target.y, (w, x, y) => {
				if (utility.damageType === 'fire') {
					zone(w, state, ObjectKind.fire, x, y, utility.radius, utility.seconds, utility.damage * scale, 'fire')
					w.events.push({ type: 'explode', id: 0, x, y, radius: utility.radius })
				} else {
					w.blast(x, y, utility.radius, utility.damage * scale, utility.damageType, state.id, {
						stunTicks: utility.damageType === 'shock' ? ticks(utility.seconds) : 0
					})
				}
			})
			break
		}
		case 'mine':
			world.addObject({
				...base,
				kind: ObjectKind.mine,
				x: state.x,
				y: state.y,
				radius: utility.radius,
				untilTick: world.tick + ticks(utility.seconds),
				amount: utility.damage * scale,
				nextTick: world.tick + ticks(utility.armSeconds),
				interval: 0,
				trigger: utility.triggerRadius
			})
			break
		case 'decoy': {
			const target = targetPoint(world, state, input, utility.throwRange)
			world.addObject({
				...base,
				kind: ObjectKind.decoy,
				x: target.x,
				y: target.y,
				radius: utility.radius,
				untilTick: world.tick + ticks(utility.seconds),
				amount: 0,
				nextTick: 0,
				interval: 0,
				trigger: 0
			})
			world.taunt(target.x, target.y, utility.radius, ticks(utility.seconds), 0)
			break
		}
		case 'sentry':
			world.addObject({
				...base,
				kind: ObjectKind.sentry,
				x: state.x,
				y: state.y,
				radius: utility.radius,
				untilTick: world.tick + ticks(utility.seconds),
				amount: utility.damage * scale,
				nextTick: world.tick,
				interval: Math.max(1, Math.round(TICK_RATE / utility.shotsPerSecond)),
				trigger: 0
			})
			break
	}
}

/** Zones heal or hurt, mines wait, sentries shoot; anything expired is removed. */
export function stepObjects(world: World): void {
	for (let o = world.objects.length - 1; o >= 0; o--) {
		const object = world.objects[o] as WorldObject
		if (world.tick >= object.untilTick) {
			world.removeObject(object)
			continue
		}
		switch (object.kind) {
			case ObjectKind.heal: {
				const healer = world.players.get(object.owner) ?? null
				for (const player of world.players.values()) {
					if (Math.hypot(player.x - object.x, player.y - object.y) <= object.radius)
						world.heal(player, object.amount, healer)
				}
				break
			}
			case ObjectKind.toxin:
			case ObjectKind.fire:
				for (let i = 0; i < MAX_ZOMBIES; i++) {
					if (world.alive[i] === 0) continue
					if (Math.hypot((world.x[i] as number) - object.x, (world.y[i] as number) - object.y) > object.radius) continue
					world.damageZombie(i, object.amount, object.owner, object.damageType, false)
				}
				break
			case ObjectKind.mine: {
				if (world.tick < object.nextTick) break
				let triggered = false
				for (let i = 0; i < MAX_ZOMBIES && !triggered; i++) {
					if (world.alive[i] === 0) continue
					if (Math.hypot((world.x[i] as number) - object.x, (world.y[i] as number) - object.y) <= object.trigger)
						triggered = true
				}
				if (triggered) {
					world.removeObject(object)
					world.blast(object.x, object.y, object.radius, object.amount, object.damageType, object.owner)
				}
				break
			}
			case ObjectKind.sentry: {
				if (world.tick < object.nextTick) break
				let best = -1
				let bestDistance = object.radius
				for (let i = 0; i < MAX_ZOMBIES; i++) {
					if (world.alive[i] === 0) continue
					const d = Math.hypot((world.x[i] as number) - object.x, (world.y[i] as number) - object.y)
					if (d >= bestDistance) continue
					const a = Math.atan2((world.y[i] as number) - object.y, (world.x[i] as number) - object.x)
					if (world.grid.rayToWall(object.x, object.y, Math.cos(a), Math.sin(a), d) < d - 0.4) continue
					best = i
					bestDistance = d
				}
				if (best < 0) break
				object.nextTick = world.tick + object.interval
				const a = Math.atan2((world.y[best] as number) - object.y, (world.x[best] as number) - object.x)
				object.angle = a
				// player 0: every client draws it, the owner's too
				world.events.push({
					type: 'shot',
					player: 0,
					x: object.x,
					y: object.y,
					angle: a,
					length: bestDistance,
					weapon: 0
				})
				world.damageZombie(best, object.amount, object.owner, object.damageType)
				break
			}
		}
	}
}
