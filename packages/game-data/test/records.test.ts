import { describe, expect, it } from 'vitest'
import { bounties, challenges, currentBounty, currentChallenges, weekStart } from '../src/index.ts'

describe('challenges', () => {
	it('pick the same dailies all day and new ones at midnight UTC', () => {
		const morning = currentChallenges(new Date('2026-11-10T00:00:01Z'))
		const night = currentChallenges(new Date('2026-11-10T23:59:59Z'))
		const tomorrow = currentChallenges(new Date('2026-11-11T00:00:01Z'))
		const daily = (list: typeof morning) => list.filter(entry => entry.kind === 'daily').map(entry => entry.key)
		expect(daily(morning)).toEqual(daily(night))
		expect(daily(morning)).toHaveLength(challenges.daily.count)
		expect(new Set(daily(morning)).size).toBe(challenges.daily.count)
		expect(daily(tomorrow).every(key => key.startsWith('daily:2026-11-11:'))).toBe(true)
		expect(morning[0]?.endsAt.toISOString()).toBe('2026-11-11T00:00:00.000Z')
	})

	it('pick weeklies from Monday to Monday', () => {
		// 2026-11-09 is a Monday
		expect(weekStart(new Date('2026-11-15T23:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z')
		const sunday = currentChallenges(new Date('2026-11-15T23:00:00Z')).filter(entry => entry.kind === 'weekly')
		const monday = currentChallenges(new Date('2026-11-09T00:00:00Z')).filter(entry => entry.kind === 'weekly')
		expect(sunday.map(entry => entry.key)).toEqual(monday.map(entry => entry.key))
		expect(sunday[0]?.endsAt.toISOString()).toBe('2026-11-16T00:00:00.000Z')
		expect(sunday.every(entry => entry.reward === challenges.weekly.reward)).toBe(true)
	})
})

describe('bounties', () => {
	it('pick one named elite, one of its missions and a difficulty for the whole week', () => {
		const monday = currentBounty(new Date('2026-11-09T00:00:00Z'))
		const sunday = currentBounty(new Date('2026-11-15T23:59:00Z'))
		expect(sunday).toEqual(monday)
		expect(monday.key.startsWith('2026-11-09:')).toBe(true)
		expect(monday.bounty.missions).toContain(monday.mission)
		expect(bounties.difficulties).toContain(monday.difficulty)
		expect(monday.endsAt.toISOString()).toBe('2026-11-16T00:00:00.000Z')
		// over a year every bounty comes round
		const seen = new Set<string>()
		for (let week = 0; week < 52; week++) seen.add(currentBounty(new Date(Date.UTC(2026, 0, 5 + week * 7))).bounty.id)
		expect(seen.size).toBe(bounties.bounties.length)
	})
})
