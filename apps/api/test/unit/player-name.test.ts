import { describe, expect, it } from 'vitest'
import { checkPlayerName, playerNameKey } from '../../src/lib/player-name.ts'

describe('checkPlayerName', () => {
	it.each(['Rook', 'night_owl', 'Gunner-7', 'abc', 'A234567890123456'])('accepts %s', name => {
		expect(checkPlayerName(name)).toBeNull()
	})

	it.each([
		['ab', 'too-short'],
		['A2345678901234567', 'too-long'],
		['7rook', 'invalid-characters'],
		['rook!', 'invalid-characters'],
		['ro ok', 'invalid-characters'],
		['Admin', 'reserved'],
		['the_Adm1n', 'reserved'],
		['RotlineStaff', 'reserved'],
		['mod', 'reserved'],
		['shithead', 'offensive'],
		['Fuck_you', 'offensive']
	] as const)('rejects %s as %s', (name, problem) => {
		expect(checkPlayerName(name)).toBe(problem)
	})

	it('trims surrounding spaces before checking', () => {
		expect(checkPlayerName('  Rook  ')).toBeNull()
	})
})

describe('playerNameKey', () => {
	it('makes names that differ only by case collide', () => {
		expect(playerNameKey('Rook')).toBe(playerNameKey('rOOK'))
	})
})
