import { queryOptions } from '@tanstack/react-query'
import type { InferResponseType } from 'hono/client'
import type { api } from './api.ts'

export type Challenge = InferResponseType<(typeof api.api.records.challenges)['$get'], 200>[number]
export type AchievementsView = InferResponseType<(typeof api.api.records.achievements)['$get'], 200>
export type BestiaryEntry = InferResponseType<(typeof api.api.records.bestiary)['$get'], 200>[number]
export type BountyView = InferResponseType<(typeof api.api.records.bounty)['$get'], 200>
/** One place on a leaderboard: Survival rows carry rounds, mission rows a best time. */
export type BoardRow = {
	rank: number
	name: string
	avatarStyle: string
	avatarSeed: string
	title: string | null
	you: boolean
	rounds?: number
	score: number
	timeMs: number
}

async function read<T>(path: string): Promise<T> {
	const response = await fetch(path)
	if (response.status !== 200) throw new Error(`${path} ${response.status}`)
	return (await response.json()) as T
}

/** Everything under this key is refreshed when a mission's rewards arrive. */
export const RECORDS = 'records'

export const challengesQuery = queryOptions({
	queryKey: [RECORDS, 'challenges'],
	queryFn: () => read<Challenge[]>('/api/records/challenges')
})
export const achievementsQuery = queryOptions({
	queryKey: [RECORDS, 'achievements'],
	queryFn: () => read<AchievementsView>('/api/records/achievements')
})
export const bountyQuery = queryOptions({
	queryKey: [RECORDS, 'bounty'],
	queryFn: () => read<BountyView>('/api/records/bounty')
})
export const bestiaryQuery = queryOptions({
	queryKey: [RECORDS, 'bestiary'],
	queryFn: () => read<BestiaryEntry[]>('/api/records/bestiary')
})
export const survivalBoardQuery = (arena: string, period: 'all' | 'week') =>
	queryOptions({
		queryKey: [RECORDS, 'survival', arena, period],
		queryFn: () => read<BoardRow[]>(`/api/records/survival/${arena}?period=${period}`)
	})
export const missionBoardQuery = (mission: string, difficulty: string) =>
	queryOptions({
		queryKey: [RECORDS, 'mission', mission, difficulty],
		queryFn: () => read<BoardRow[]>(`/api/records/mission/${mission}/${difficulty}`)
	})

/** Wears an earned title (or none). */
export async function wearTitle(id: string | null): Promise<boolean> {
	const response = await fetch('/api/records/title', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id })
	})
	return response.status === 200
}
