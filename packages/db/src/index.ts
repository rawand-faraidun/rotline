import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.ts'

export type { Player, User } from './generated/prisma/client.ts'
export {
	Difficulty,
	FriendshipStatus,
	ItemSource,
	LedgerReason,
	Mastery,
	PlayerClass,
	Prisma,
	PrismaClient
} from './generated/prisma/client.ts'
export { friendIds } from './queries.ts'

/** Connects through the pooler URL; migrations use their own direct URL (see prisma.config.ts). */
export function createDatabase(url: string): PrismaClient {
	return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
}

export type Database = PrismaClient
