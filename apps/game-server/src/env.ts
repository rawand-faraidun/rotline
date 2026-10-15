import { z } from 'zod'

const schema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	GAME_PORT: z.coerce.number().int().positive().default(3200),
	/** base64 DER (SPKI) Ed25519 public key matching the API's GAME_TICKET_PRIVATE_KEY */
	GAME_TICKET_PUBLIC_KEY: z.string().min(40),
	/** this process's name in tickets and the room registry */
	GAME_INSTANCE_ID: z.string().min(1).default('local-1'),
	GAME_MAX_ROOMS: z.coerce.number().int().positive().default(64),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
})

export type GameEnv = z.infer<typeof schema>

export function readGameEnv(source: Record<string, string | undefined> = process.env): GameEnv {
	const parsed = schema.safeParse(source)
	if (!parsed.success) {
		const problems = parsed.error.issues.map(issue => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')
		throw new Error(`Invalid environment:\n${problems}`)
	}
	return parsed.data
}
