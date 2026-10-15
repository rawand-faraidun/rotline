import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

// Local development reads the repository's .env; CI and servers set real environment variables,
// which take precedence over the file.
const localEnv = new URL('../../.env', import.meta.url)
if (existsSync(localEnv)) process.loadEnvFile(localEnv)

// Migrations need a direct connection, never a transaction-mode pooler.
// `prisma generate` needs no database, so the URL may be absent.
export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations'
	},
	datasource: {
		url: process.env.DATABASE_DIRECT_URL ?? ''
	}
})
