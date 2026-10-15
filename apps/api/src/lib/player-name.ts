import { PLAYER_NAME_MAX, PLAYER_NAME_MIN, PLAYER_NAME_SHAPE } from '@rotline/constants'
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity'

// Names that could pass as staff or the game itself
const RESERVED = [
	'admin',
	'administrator',
	'moderator',
	'official',
	'rotline',
	'staff',
	'support',
	'system',
	'developer',
	'owner',
	'server',
	'gamemaster'
]
const RESERVED_EXACT = ['mod', 'dev', 'gm', 'null', 'undefined', 'anonymous', 'player', 'root']

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' }

const profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })

export type NameProblem = 'too-short' | 'too-long' | 'invalid-characters' | 'offensive' | 'reserved'

/** Lower-cased key used for uniqueness, so names differing only by case collide. */
export function playerNameKey(name: string): string {
	return name.trim().toLowerCase()
}

function normalise(name: string): string {
	return name
		.toLowerCase()
		.replace(/[0-9]/g, digit => LEET[digit] ?? digit)
		.replace(/[_-]/g, '')
}

export function checkPlayerName(raw: string): NameProblem | null {
	const name = raw.trim()
	if (name.length < PLAYER_NAME_MIN) return 'too-short'
	if (name.length > PLAYER_NAME_MAX) return 'too-long'
	if (!PLAYER_NAME_SHAPE.test(name)) return 'invalid-characters'
	const plain = normalise(name)
	if (RESERVED_EXACT.includes(plain) || RESERVED.some(word => plain.includes(word))) return 'reserved'
	if (profanity.hasMatch(name) || profanity.hasMatch(plain)) return 'offensive'
	return null
}
