import { classes, skillNodes, skillTrees } from './data.ts'
import type { ClassId } from './schema.ts'

const progression = classes.progression

/** Class XP needed to go from `level` to `level + 1`: xpBase × growth^(level − 1). */
export function xpToNext(level: number): number {
	return Math.round(progression.xpBase * progression.xpGrowth ** (level - 1))
}

/** Level and progress from a class's running XP total. */
export function levelFromXp(xp: number): { level: number; into: number; next: number | null } {
	let level = 1
	let rest = xp
	while (level < progression.maxLevel && rest >= xpToNext(level)) {
		rest -= xpToNext(level)
		level++
	}
	return { level, into: rest, next: level < progression.maxLevel ? xpToNext(level) : null }
}

/** Skill points earned by `level`: one per level, more at the bonus levels (55 at level 50). */
export function pointsAtLevel(level: number): number {
	const bonus = progression.bonusPointLevels.filter(bonusLevel => bonusLevel <= level).length
	return level * progression.pointsPerLevel + bonus * (progression.bonusPoints - progression.pointsPerLevel)
}

export function abilitySlotsAtLevel(level: number): number {
	let slots = 0
	for (const entry of progression.abilitySlots) if (entry.level <= level) slots = entry.slots
	return slots
}

/** Every rank of every skill in a class's tree: what an unrestricted test account may spend. */
export function allSkillPoints(classId: ClassId): number {
	return skillTrees[classId].branches.reduce(
		(sum, branch) => sum + branch.nodes.reduce((total, node) => total + node.maxRank, 0),
		0
	)
}

export type Skills = Readonly<Record<string, number>>

export const spentPoints = (skills: Skills): number => Object.values(skills).reduce((sum, rank) => sum + rank, 0)

export type SkillProblem = 'unknown-node' | 'wrong-class' | 'rank' | 'points' | 'tier-locked'

/**
 * Checks a whole allocation against the rules: nodes of this class, ranks within limits, no more
 * points than the level gives (or `points`, for an unrestricted test account), and each tier opened by enough points in
 * the branch's earlier tiers.
 */
export function validateSkills(
	classId: ClassId,
	skills: Skills,
	level: number,
	points = pointsAtLevel(level)
): SkillProblem | null {
	for (const [id, rank] of Object.entries(skills)) {
		const entry = skillNodes.get(id)
		if (!entry) return 'unknown-node'
		if (entry.class !== classId) return 'wrong-class'
		if (!Number.isInteger(rank) || rank < 1 || rank > entry.node.maxRank) return 'rank'
	}
	if (spentPoints(skills) > points) return 'points'
	for (const branch of skillTrees[classId].branches) {
		for (const node of branch.nodes) {
			if (!skills[node.id] || node.tier === 1) continue
			const earlier = branch.nodes
				.filter(other => other.tier < node.tier)
				.reduce((sum, other) => sum + (skills[other.id] ?? 0), 0)
			if (earlier < progression.pointsPerTier * (node.tier - 1)) return 'tier-locked'
		}
	}
	return null
}

/** The problem with adding one rank to `nodeId`, or null if it can be bought. */
export function allocationProblem(
	classId: ClassId,
	skills: Skills,
	level: number,
	nodeId: string,
	points = pointsAtLevel(level)
): SkillProblem | null {
	return validateSkills(classId, { ...skills, [nodeId]: (skills[nodeId] ?? 0) + 1 }, level, points)
}

/** Active abilities unlocked by the allocation. */
export function unlockedAbilities(skills: Skills): string[] {
	const result: string[] = []
	for (const id of Object.keys(skills)) {
		const ability = skillNodes.get(id)?.node.ability
		if (ability) result.push(ability)
	}
	return result
}

export function validateAbilities(skills: Skills, level: number, equipped: readonly string[]): boolean {
	const unlocked = new Set(unlockedAbilities(skills))
	return (
		equipped.length <= abilitySlotsAtLevel(level) &&
		new Set(equipped).size === equipped.length &&
		equipped.every(id => unlocked.has(id))
	)
}
