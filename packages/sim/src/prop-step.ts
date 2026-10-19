import { player as playerDef, propsDef, zombies as zombieDefs, zombieIndex } from '@rotline/game-data'
import { DT, MAX_ZOMBIES, REVIVE_RANGE } from './constants.ts'
import type { PlayerState } from './player.ts'
import { holdStep, type Prop, PropState, reach, setPropState, ticks } from './props.ts'
import type { World } from './world.ts'

const TURRET_INTERVAL = ticks(1 / propsDef.turret.shotsPerSecond)

/** Turrets, traps, survivors and carried objects; called once a tick after the players moved. */
export function stepProps(world: World): void {
	for (const prop of world.props) {
		switch (prop.def.kind) {
			case 'turret':
			case 'floodlight': {
				const source = prop.powerBy >= 0 ? world.props[prop.powerBy] : undefined
				prop.powered = source ? source.state === PropState.done : true
				if (prop.def.kind === 'turret' && prop.powered && prop.state !== PropState.destroyed) turret(world, prop)
				break
			}
			case 'trap':
				if (prop.state === PropState.active) {
					if (world.tick >= prop.untilTick) {
						prop.state = PropState.idle
						world.events.push({ type: 'prop', index: prop.index, state: prop.state })
					} else trap(world, prop)
				}
				break
			case 'survivor':
				if (prop.state === PropState.following) follow(world, prop)
				break
			case 'generator':
				if (prop.state === PropState.active && world.tick >= prop.untilTick) {
					prop.state = PropState.done
					world.events.push({ type: 'prop', index: prop.index, state: prop.state })
				}
				break
			case 'carry':
				if (prop.state === PropState.carried) carried(world, prop)
				break
			case 'nest':
				if (prop.state !== PropState.destroyed) nest(world, prop)
				break
		}
		// a hold is only kept by someone holding it this tick
		if (prop.holder === 0 && prop.progress > 0 && !keepsProgress(prop)) prop.progress = 0
		prop.holder = 0
	}
}

/** Generators and terminals keep partial work when let go; the rest start over. */
const keepsProgress = (prop: Prop) => prop.def.kind === 'generator' || prop.def.kind === 'terminal'

function turret(world: World, prop: Prop): void {
	if (world.tick < prop.readyTick) return
	let best = -1
	let bestDistance = propsDef.turret.range
	for (let i = 0; i < MAX_ZOMBIES; i++) {
		if (world.alive[i] === 0) continue
		const d = Math.hypot((world.x[i] as number) - prop.x, (world.y[i] as number) - prop.y)
		if (d >= bestDistance) continue
		const a = Math.atan2((world.y[i] as number) - prop.y, (world.x[i] as number) - prop.x)
		// the turret's own cell does not block its sight
		const from = 0.75
		if (
			world.grid.rayToWall(
				prop.x + Math.cos(a) * from,
				prop.y + Math.sin(a) * from,
				Math.cos(a),
				Math.sin(a),
				d - from
			) <
			d - from - 0.4
		)
			continue
		best = i
		bestDistance = d
	}
	if (best < 0) return
	prop.readyTick = world.tick + TURRET_INTERVAL
	const angle = Math.atan2((world.y[best] as number) - prop.y, (world.x[best] as number) - prop.x)
	world.events.push({ type: 'shot', player: 0, x: prop.x, y: prop.y, angle, length: bestDistance, weapon: 0 })
	world.damageZombie(best, propsDef.turret.damage, 0, propsDef.turret.damageType)
}

const NEST_INTERVAL = ticks(propsDef.nest.spawnEverySeconds)
let nestPool: { type: number; upTo: number }[] | null = null
let nestTotal = 0

/** A nest sends a zombie out every so often while players are near and the horde is not too big. */
function nest(world: World, prop: Prop): void {
	if (world.tick < prop.readyTick) return
	prop.readyTick = world.tick + NEST_INTERVAL
	let near = false
	for (const state of world.players.values())
		if (state.alive && Math.hypot(state.x - prop.x, state.y - prop.y) < propsDef.nest.wakeRange) near = true
	if (!near || world.aliveCount >= MAX_ZOMBIES - 16) return
	if (!nestPool) {
		nestPool = Object.entries(propsDef.nest.composition).map(([id, weight]) => {
			nestTotal += weight
			return { type: zombieIndex(id), upTo: nestTotal }
		})
	}
	const roll = world.rng.next() * nestTotal
	const pick = nestPool.find(entry => roll < entry.upTo) ?? nestPool[0]
	// out of the nest's far side from the nearest player, so it never crawls out on top of anyone
	let away = world.rng.next() * Math.PI * 2
	let nearest = Number.POSITIVE_INFINITY
	for (const state of world.players.values()) {
		const distance = Math.hypot(state.x - prop.x, state.y - prop.y)
		if (!state.alive || distance >= nearest) continue
		nearest = distance
		away = Math.atan2(prop.y - state.y, prop.x - state.x) + (world.rng.next() - 0.5) * 1.6
	}
	const half = Math.max(prop.def.w ?? 1, prop.def.h ?? 1) / 2 + 0.7
	const at = { x: prop.x + Math.cos(away) * half, y: prop.y + Math.sin(away) * half }
	if (!pick || world.grid.isWall(Math.floor(at.x), Math.floor(at.y))) return
	if (world.nearestPlayerDistance(at.x, at.y) < 2.5) return
	world.spawnZombie(pick.type, at)
}

function trap(world: World, prop: Prop): void {
	const radius = propsDef.trap.radius
	for (let i = 0; i < MAX_ZOMBIES; i++) {
		if (world.alive[i] === 0) continue
		if (Math.hypot((world.x[i] as number) - prop.x, (world.y[i] as number) - prop.y) > radius) continue
		world.damageZombie(i, propsDef.trap.damagePerSecond * DT, prop.with, propsDef.trap.damageType, false)
	}
}

const moved = { x: 0, y: 0 }

/** A freed survivor walks after the player they follow (or the nearest one standing). */
function follow(world: World, prop: Prop): void {
	let leader = world.players.get(prop.with)
	if (!leader?.alive || leader.downed) {
		leader = undefined
		let nearest = Number.POSITIVE_INFINITY
		for (const state of world.players.values()) {
			if (!state.alive || state.downed) continue
			const d = Math.hypot(state.x - prop.x, state.y - prop.y)
			if (d < nearest) {
				nearest = d
				leader = state
			}
		}
		if (leader) prop.with = leader.id
	}
	if (!leader) return
	const dx = leader.x - prop.x
	const dy = leader.y - prop.y
	const d = Math.hypot(dx, dy)
	if (d <= propsDef.survivor.followDistance) return
	const step = Math.min(d - propsDef.survivor.followDistance, propsDef.survivor.speed * DT)
	world.grid.moveCircle(prop.x, prop.y, (dx / d) * step, (dy / d) * step, propsDef.survivor.radius, moved)
	// stuck behind a corner for a while: catch up with the leader
	const progress = Math.hypot(moved.x - prop.x, moved.y - prop.y)
	prop.x = moved.x
	prop.y = moved.y
	prop.readyTick = progress < step * 0.25 ? prop.readyTick + 1 : 0
	if (prop.readyTick > ticks(propsDef.survivor.stuckSeconds)) {
		prop.readyTick = 0
		const spot = world.freeSpotNear(leader.x, leader.y, propsDef.survivor.radius)
		prop.x = spot.x
		prop.y = spot.y
	}
}

/** A clear line from the player to the nearest point of the prop (its own cells do not count). */
function inSight(world: World, prop: Prop, player: PlayerState): boolean {
	const halfW = prop.cells.length > 0 ? (prop.def.w ?? 1) / 2 : 0
	const halfH = prop.cells.length > 0 ? (prop.def.h ?? 1) / 2 : 0
	const tx = Math.max(prop.x - halfW, Math.min(prop.x + halfW, player.x))
	const ty = Math.max(prop.y - halfH, Math.min(prop.y + halfH, player.y))
	const d = Math.hypot(tx - player.x, ty - player.y)
	if (d < 0.05) return true
	// stop just short of the prop, so its own cells do not block the line
	const length = Math.max(0, d - 0.1)
	return world.grid.rayToWall(player.x, player.y, (tx - player.x) / d, (ty - player.y) / d, length) >= length - 1e-6
}

/** A carried object goes where its carrier goes; it drops where they fall. */
function carried(world: World, prop: Prop): void {
	const carrier = world.players.get(prop.with)
	if (!carrier?.alive || carrier.downed) {
		drop(world, prop, carrier)
		return
	}
	prop.x = carrier.x
	prop.y = carrier.y
}

export function drop(world: World, prop: Prop, carrier: PlayerState | undefined): void {
	if (carrier) carrier.carrying = false
	prop.with = 0
	prop.state = PropState.idle
	prop.progress = 0
	world.events.push({ type: 'prop', index: prop.index, state: prop.state })
}

/** Is a downed teammate in reach? Then interact revives them instead of working a prop. */
function reviving(world: World, player: PlayerState): boolean {
	for (const other of world.players.values()) {
		if (other === player || !other.alive || !other.downed) continue
		if (Math.hypot(other.x - player.x, other.y - player.y) <= REVIVE_RANGE) return true
	}
	return false
}

/**
 * A player's interact button against props: a press opens or closes a door or sets off a trap; a
 * hold welds a closed door, frees a survivor, picks something up or works a generator or terminal.
 */
export function interactProps(world: World, player: PlayerState, held: boolean, pressed: boolean): void {
	if (!held || !player.alive || player.downed || world.props.length === 0) return
	if (reviving(world, player)) return
	let target: Prop | null = null
	let nearest = propsDef.interactRange
	for (const prop of world.props) {
		if (!usable(world, prop, player)) continue
		const d = reach(prop, player)
		// within reach, and nothing in between (no working anything through a wall)
		if (d <= nearest && inSight(world, prop, player)) {
			nearest = d
			target = prop
		}
	}
	if (!target) return
	if (pressed) press(world, target)
	hold(world, target, player)
}

function usable(world: World, prop: Prop, player: PlayerState): boolean {
	const tick = world.tick
	// objective props can only be worked while their objective is on (no working ahead)
	const allowed = world.workableProps === null || world.workableProps.has(prop)
	switch (prop.def.kind) {
		case 'door':
			if (prop.state === PropState.welded) return prop.health < prop.maxHealth
			return (prop.state === PropState.open || prop.state === PropState.closed) && tick >= prop.readyTick
		case 'generator':
		case 'terminal':
			return allowed && prop.state === PropState.idle
		case 'trap':
			return prop.state === PropState.idle && tick >= prop.readyTick
		case 'survivor':
			return allowed && prop.state === PropState.idle
		case 'carry':
			return allowed && prop.state === PropState.idle && !player.carrying
		case 'defend':
			return prop.state !== PropState.destroyed && prop.health < prop.maxHealth
		default:
			return false
	}
}

function press(world: World, prop: Prop): void {
	if (prop.def.kind === 'door') {
		if (prop.state === PropState.open) {
			// a door does not close on anyone standing in it
			if (occupied(world, prop)) return
			setPropState(world.grid, prop, PropState.closed)
		} else if (prop.state === PropState.closed) setPropState(world.grid, prop, PropState.open)
		prop.progress = 0
		// a door cannot be flicked faster than it swings
		prop.readyTick = world.tick + ticks(propsDef.door.toggleSeconds)
		world.events.push({ type: 'prop', index: prop.index, state: prop.state })
		world.propsChanged = true
	} else if (prop.def.kind === 'trap') {
		prop.state = PropState.active
		prop.untilTick = world.tick + ticks(propsDef.trap.activeSeconds)
		prop.readyTick = prop.untilTick + ticks(propsDef.trap.cooldownSeconds)
		world.events.push({ type: 'prop', index: prop.index, state: prop.state })
	}
}

function hold(world: World, prop: Prop, player: PlayerState): void {
	// mending: a welded door or a defend target with damage
	if ((prop.def.kind === 'door' && prop.state === PropState.welded) || prop.def.kind === 'defend') {
		prop.health = Math.min(prop.maxHealth, prop.health + propsDef.repairPerSecond * DT)
		return
	}
	// welding only works on a closed door
	if (prop.def.kind === 'door' && prop.state !== PropState.closed) return
	if (prop.def.kind === 'trap') return
	if (prop.holder !== 0 && prop.holder !== player.id) return
	prop.holder = player.id
	prop.progress = Math.min(1, prop.progress + holdStep(prop))
	if (prop.progress < 1 - 1e-9) return
	prop.progress = 0
	switch (prop.def.kind) {
		case 'door':
			prop.health = propsDef.door.weldedHealth
			setPropState(world.grid, prop, PropState.welded)
			world.propsChanged = true
			break
		case 'generator':
			// it runs up for a while before it is on; zombies come for it meanwhile
			prop.state = propsDef.generator.startSeconds > 0 ? PropState.active : PropState.done
			prop.untilTick = world.tick + ticks(propsDef.generator.startSeconds)
			break
		case 'terminal':
			prop.state = PropState.done
			break
		case 'survivor':
			prop.state = PropState.following
			prop.with = player.id
			break
		case 'carry':
			prop.state = PropState.carried
			prop.with = player.id
			player.carrying = true
			break
	}
	world.events.push({ type: 'prop', index: prop.index, state: prop.state })
}

/** Is a player or zombie standing in the prop's cells? */
function occupied(world: World, prop: Prop): boolean {
	const width = world.grid.width
	const inside = (x: number, y: number, r: number) =>
		prop.cells.some(cell => {
			const cx = (cell % width) + 0.5
			const cy = Math.floor(cell / width) + 0.5
			return Math.abs(x - cx) < 0.5 + r && Math.abs(y - cy) < 0.5 + r
		})
	for (const state of world.players.values()) if (state.alive && inside(state.x, state.y, playerDef.radius)) return true
	for (const other of world.props) {
		if (other.def.kind === 'survivor' && other.cells.length === 0 && inside(other.x, other.y, propsDef.survivor.radius))
			return true
	}
	for (let i = 0; i < MAX_ZOMBIES; i++) {
		if (world.alive[i] === 0) continue
		const radius = zombieDefs[world.type[i] as number]?.radius ?? 0.5
		if (inside(world.x[i] as number, world.y[i] as number, radius)) return true
	}
	return false
}

/**
 * Damage to a prop: barrels go off, cover and doors break, survivors and defend targets can be lost
 * (the mission then fails back to the checkpoint).
 */
export function damageProp(world: World, prop: Prop, amount: number, by: number): void {
	if (amount <= 0 || prop.state === PropState.destroyed || prop.maxHealth <= 0) return
	switch (prop.def.kind) {
		case 'door':
			// open doors take no damage; locked gates cannot be broken
			if (prop.state !== PropState.closed && prop.state !== PropState.welded) return
			break
		case 'survivor':
			if (prop.state === PropState.delivered) return
			break
		case 'barrel':
		case 'crate':
		case 'sandbags':
		case 'defend':
		case 'nest':
			break
		case 'generator':
			// only while it runs up; broken then, it stops and must be started again
			if (prop.state !== PropState.active) return
			prop.health -= amount
			if (prop.health > 0) return
			prop.health = prop.maxHealth
			prop.state = PropState.idle
			prop.progress = 0
			world.events.push({ type: 'prop', index: prop.index, state: prop.state })
			return
		default:
			return
	}
	prop.health -= amount
	if (prop.health > 0) return
	prop.health = 0
	setPropState(world.grid, prop, PropState.destroyed)
	world.propsChanged = true
	world.events.push({ type: 'prop', index: prop.index, state: prop.state })
	if (prop.def.kind === 'barrel') {
		const barrel = propsDef.barrel
		// it hurts whoever set it off (no setting off barrels next to teammates)
		world.blast(prop.x, prop.y, barrel.blastRadius, barrel.blastDamage, 'explosive', by, {
			playerDamage: barrel.blastDamage * barrel.playerDamageShare,
			playerOnly: by
		})
	}
	if (prop.def.kind === 'survivor' || prop.def.kind === 'defend') world.propLost(prop)
}

/** Back to how it started (a restart from the checkpoint). */
export function resetProp(world: World, prop: Prop): void {
	if (prop.def.kind === 'carry' && prop.with) {
		const carrier = world.players.get(prop.with)
		if (carrier) carrier.carrying = false
	}
	prop.x = prop.home.x
	prop.y = prop.home.y
	prop.health = prop.home.health
	prop.progress = 0
	prop.with = 0
	prop.holder = 0
	setPropState(world.grid, prop, prop.home.state)
	world.propsChanged = true
}
