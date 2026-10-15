import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { maps, zombieIndex } from '@rotline/game-data'
import { describe, expect, it } from 'vitest'
import { angleToAim, Button, type PlayerInput, World } from '../src/index.ts'
import { input, quietWorld, steps } from './helpers.ts'

describe('zombies', () => {
	it('walk to the player around walls and attack', () => {
		const world = quietWorld()
		const player = world.addPlayer(1)
		const zombie = world.spawnZombie(zombieIndex('bolter'), { x: 4, y: 4 })
		steps(world, 30 * 20)
		expect(Math.hypot((world.x[zombie] as number) - player.x, (world.y[zombie] as number) - player.y)).toBeLessThan(1.5)
		expect(player.health).toBeLessThan(100)
	})

	it('take damage and die from shots, and the kill is counted', () => {
		const world = quietWorld()
		const player = world.addPlayer(1)
		const zombie = world.spawnZombie(zombieIndex('drudge'), { x: player.x + 6, y: player.y })
		const fire = new Map<number, PlayerInput>([[1, input({ buttons: Button.fire, aim: angleToAim(0) })]])
		steps(world, 30, () => fire)
		expect(world.alive[zombie]).toBe(0)
		expect(world.kills).toBe(1)
		expect(world.score).toBe(10)
	})

	it('Swell bursts on death, hurting nearby players and leaving a pool', () => {
		const world = quietWorld()
		const player = world.addPlayer(1)
		const swell = world.spawnZombie(zombieIndex('swell'), { x: player.x + 1.2, y: player.y })
		world.damageZombie(swell, 1000, 1)
		expect(world.events.some(event => event.type === 'burst')).toBe(true)
		expect(player.health).toBeLessThan(100)
		expect(world.pools.length).toBe(1)
		const before = player.health
		steps(world, 30)
		expect(player.health).toBeLessThan(before)
		steps(world, 30 * 8)
		expect(world.pools.length).toBe(0)
	})

	it('walls stop bullets', () => {
		const world = quietWorld()
		const player = world.addPlayer(1)
		player.x = 18
		player.y = 8
		// wall cells y 10..11 lie between the player and the zombie
		const zombie = world.spawnZombie(zombieIndex('drudge'), { x: 18, y: 14 })
		const fire = new Map<number, PlayerInput>([[1, input({ buttons: Button.fire, aim: angleToAim(Math.PI / 2) })]])
		steps(world, 10, () => fire)
		expect(world.health[zombie]).toBe(60)
	})
})

describe('players', () => {
	it('go down at zero health and come back after the respawn delay', () => {
		const world = quietWorld()
		const player = world.addPlayer(1)
		for (let i = 0; i < 20; i++) world.spawnZombie(zombieIndex('drudge'), { x: player.x + 0.5, y: player.y + 0.5 })
		let downed = false
		for (let i = 0; i < 30 * 30 && !downed; i++) {
			world.step(new Map())
			if (world.events.some(event => event.type === 'player-down')) downed = true
		}
		expect(downed).toBe(true)
		let back = false
		for (let i = 0; i < 30 * 4 && !back; i++) {
			world.step(new Map())
			if (world.events.some(event => event.type === 'player-up')) back = true
		}
		expect(back).toBe(true)
		// protected for two seconds while the horde is still there
		steps(world, 30)
		expect(player.alive).toBe(true)
		expect(player.health).toBe(100)
	})
})

describe('waves', () => {
	it('spawns the first wave after the delay, then the next one after the break', () => {
		const world = new World({ seed: 3, map: maps.yard as NonNullable<typeof maps.yard> })
		const player = world.addPlayer(1)
		player.x = 32
		steps(world, 30 * 3 + 30 * 6)
		expect(world.wave).toBe(0)
		expect(world.aliveCount).toBeGreaterThan(0)
		// clear the wave by force
		for (let i = 0; i < 300; i++) if (world.alive[i] === 1) world.damageZombie(i, 1e6, 1)
		for (let i = 0; i < 30 * 30; i++) {
			world.step(new Map())
			for (let z = 0; z < 300; z++) if (world.alive[z] === 1) world.damageZombie(z, 1e6, 1)
			if (world.wave >= 1 && world.aliveCount > 0) break
		}
		expect(world.wave).toBeGreaterThanOrEqual(1)
	})
})

describe('determinism', () => {
	function run(seed: number): number {
		const world = new World({ seed, map: maps.yard as NonNullable<typeof maps.yard> })
		world.addPlayer(1)
		world.addPlayer(2)
		for (let t = 0; t < 30 * 40; t++) {
			const aim = angleToAim(t * 0.05)
			world.step(
				new Map([
					[1, input({ seq: t, moveX: Math.round(Math.sin(t / 20) * 127), aim, buttons: Button.fire })],
					[
						2,
						input({
							seq: t,
							moveY: Math.round(Math.cos(t / 25) * 127),
							aim: (aim + 30000) & 0xffff,
							buttons: t % 200 < 100 ? Button.fire : Button.reload
						})
					]
				])
			)
		}
		return world.checksum()
	}

	it('produces identical results from the same seed and inputs', () => {
		expect(run(42)).toBe(run(42))
		expect(run(42)).not.toBe(run(43))
	})

	it('uses no wall-clock time or Math.random in the simulation source', () => {
		const dir = join(import.meta.dirname, '..', 'src')
		for (const file of readdirSync(dir)) {
			const source = readFileSync(join(dir, file), 'utf8')
			expect(source, file).not.toMatch(/Math\.random|Date\.now|performance\.now/)
		}
	})
})
