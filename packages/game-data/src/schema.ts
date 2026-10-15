import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9-]+$/, 'ids are lowercase kebab-case')

export const damageType = z.enum(['ballistic', 'explosive', 'fire', 'shock', 'chemical'])

export const weaponSchema = z
	.object({
		id,
		name: z.string().min(1),
		slot: z.enum(['main', 'pistol']),
		damageType,
		damage: z.number().positive(),
		pellets: z.number().int().min(1),
		/** rounds per minute */
		fireRate: z.number().positive().max(3000),
		automatic: z.boolean(),
		magazine: z.number().int().min(1),
		/** carried ammunition beyond the magazine; null = unlimited (pistols only) */
		maxReserve: z.number().int().min(0).nullable(),
		reloadSeconds: z.number().positive(),
		spreadDegrees: z.number().min(0).max(45),
		range: z.number().positive().max(80)
	})
	.refine(weapon => (weapon.slot === 'pistol') === (weapon.maxReserve === null), {
		message: 'pistols have unlimited reserve ammunition (null); main weapons have a number',
		path: ['maxReserve']
	})

export const zombieSchema = z.object({
	id,
	name: z.string().min(1),
	health: z.number().positive(),
	/** metres per second */
	speed: z.number().positive().max(12),
	radius: z.number().positive().max(2),
	meleeDamage: z.number().min(0),
	meleeRange: z.number().positive(),
	meleeCooldownSeconds: z.number().positive(),
	score: z.number().int().min(0),
	tint: z.string().regex(/^#[0-9a-f]{6}$/i),
	scale: z.number().positive().max(4),
	deathBurst: z
		.object({
			damage: z.number().min(0),
			radius: z.number().positive(),
			poolDamagePerSecond: z.number().min(0),
			poolRadius: z.number().positive(),
			poolSeconds: z.number().positive()
		})
		.nullable()
})

export const playerSchema = z.object({
	health: z.number().positive(),
	radius: z.number().positive(),
	speed: z.number().positive(),
	respawnSeconds: z.number().min(0),
	loadout: z.object({ main: z.tuple([id, id]), pistol: id })
})

const point = z.object({ x: z.number(), y: z.number() })
const rect = z.object({
	x: z.number().int(),
	y: z.number().int(),
	w: z.number().int().positive(),
	h: z.number().int().positive()
})

export const mapSchema = z.object({
	id,
	name: z.string(),
	width: z.number().int().positive().max(1000),
	height: z.number().int().positive().max(1000),
	walls: z.array(rect),
	playerSpawns: z.array(point).min(4),
	zombieSpawns: z.array(point).min(1)
})

export const wavesSchema = z.object({
	firstWaveDelaySeconds: z.number().min(0),
	breakSeconds: z.number().min(0),
	spawnPerSecond: z.number().positive(),
	maxAlive: z.number().int().positive().max(300),
	waves: z.array(z.record(id, z.number().int().min(0))).min(1),
	growthPerWave: z.number().min(1)
})

export type DamageType = z.infer<typeof damageType>
export type WeaponDef = z.infer<typeof weaponSchema>
export type ZombieDef = z.infer<typeof zombieSchema>
export type PlayerDef = z.infer<typeof playerSchema>
export type MapDef = z.infer<typeof mapSchema>
export type WavesDef = z.infer<typeof wavesSchema>
