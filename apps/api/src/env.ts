import { z } from 'zod'

const optional = z
	.string()
	.trim()
	.transform(value => value || undefined)
	.optional()

const schema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	API_PORT: z.coerce.number().int().positive().default(3100),
	DATABASE_URL: z.url(),
	PUBLIC_ORIGIN: z.url(),
	BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
	GITHUB_CLIENT_ID: optional,
	GITHUB_CLIENT_SECRET: optional,
	GOOGLE_CLIENT_ID: optional,
	GOOGLE_CLIENT_SECRET: optional,
	AUTH_TEST_PROVIDER_ISSUER: optional,
	AUTH_TEST_PROVIDER_CLIENT_ID: optional,
	AUTH_TEST_PROVIDER_CLIENT_SECRET: optional,
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
})

export type Env = z.infer<typeof schema>

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
	const parsed = schema.safeParse(source)
	if (!parsed.success) {
		const problems = parsed.error.issues.map(issue => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')
		throw new Error(`Invalid environment:\n${problems}`)
	}
	const env = parsed.data
	if (env.NODE_ENV === 'production' && env.AUTH_TEST_PROVIDER_ISSUER) {
		throw new Error('AUTH_TEST_PROVIDER_ISSUER must not be set in production')
	}
	return env
}
