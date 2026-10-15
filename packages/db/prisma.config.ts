import { defineConfig } from 'prisma/config'

// Migrations need a direct connection; PgBouncer in transaction mode cannot run them.
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
