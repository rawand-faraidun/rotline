import { FriendshipStatus, type PrismaClient } from './generated/prisma/client.ts'

/** Ids of the player's accepted friends. Friendships are stored once per pair, either side. */
export async function friendIds(db: PrismaClient, userId: string): Promise<string[]> {
	const rows = await db.friendship.findMany({
		where: { status: FriendshipStatus.accepted, OR: [{ playerA: userId }, { playerB: userId }] },
		select: { playerA: true, playerB: true }
	})
	return rows.map(row => (row.playerA === userId ? row.playerB : row.playerA))
}
