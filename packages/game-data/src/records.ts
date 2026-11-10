import { challenges } from './data.ts'
import type { ChallengeTemplate } from './schema.ts'

/** One challenge running now: its key (which rotation it belongs to), what it asks, when it ends. */
export type ActiveChallenge = {
	key: string
	kind: 'daily' | 'weekly'
	template: ChallengeTemplate
	reward: number
	endsAt: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A small, stable hash of a string (FNV-1a), for picking a rotation's challenges. */
function hash(text: string): number {
	let value = 0x811c9dc5
	for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193)
	return value >>> 0
}

/** `count` of the templates, the same ones for everyone for the whole rotation. */
function pick(kind: 'daily' | 'weekly', seed: string, count: number): ChallengeTemplate[] {
	const pool = challenges.templates.filter(template => template.kind === kind)
	let state = hash(seed) || 1
	const next = () => {
		state ^= state << 13
		state ^= state >>> 17
		state ^= state << 5
		return (state >>> 0) / 4294967296
	}
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1))
		;[pool[i], pool[j]] = [pool[j] as ChallengeTemplate, pool[i] as ChallengeTemplate]
	}
	return pool.slice(0, count)
}

/**
 * The daily and weekly challenges at `now`: dailies change at 00:00 UTC, weeklies on Monday at
 * 00:00 UTC. They are worked out from the clock alone, so every server agrees without storing them.
 */
export function currentChallenges(now: Date): ActiveChallenge[] {
	const day = Math.floor(now.getTime() / DAY_MS)
	const dayKey = new Date(day * DAY_MS).toISOString().slice(0, 10)
	// 1970-01-01 was a Thursday: Monday is three days on
	const monday = day - ((day + 3) % 7)
	const weekKey = new Date(monday * DAY_MS).toISOString().slice(0, 10)
	const daily = pick('daily', `daily:${dayKey}`, challenges.daily.count).map(template => ({
		key: `daily:${dayKey}:${template.id}`,
		kind: 'daily' as const,
		template,
		reward: challenges.daily.reward,
		endsAt: new Date((day + 1) * DAY_MS)
	}))
	const weekly = pick('weekly', `weekly:${weekKey}`, challenges.weekly.count).map(template => ({
		key: `weekly:${weekKey}:${template.id}`,
		kind: 'weekly' as const,
		template,
		reward: challenges.weekly.reward,
		endsAt: new Date((monday + 7) * DAY_MS)
	}))
	return [...daily, ...weekly]
}

/** Monday 00:00 UTC of the week holding `now`: the start of this week's leaderboard. */
export function weekStart(now: Date): Date {
	const day = Math.floor(now.getTime() / DAY_MS)
	return new Date((day - ((day + 3) % 7)) * DAY_MS)
}
