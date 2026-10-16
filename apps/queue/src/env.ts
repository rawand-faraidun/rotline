import { z } from 'zod'

const optional = z
	.string()
	.trim()
	.transform(value => value || undefined)
	.optional()

const schema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	QUEUE_PORT: z.coerce.number().int().positive().default(3300),
	DATABASE_URL: z.url(),
	VALKEY_URL: z.url(),
	PUBLIC_ORIGIN: z.url(),
	BETTER_AUTH_SECRET: z.string().min(32),
	AUTH_TEST_PROVIDER_ISSUER: optional,
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
})

export type QueueEnv = z.infer<typeof schema>

export function readQueueEnv(source: Record<string, string | undefined> = process.env): QueueEnv {
	const parsed = schema.safeParse(source)
	if (!parsed.success) {
		throw new Error(
			`Invalid environment:\n${parsed.error.issues.map(issue => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')}`
		)
	}
	return parsed.data
}
