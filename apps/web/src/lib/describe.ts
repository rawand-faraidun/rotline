import type { Effect } from '@rotline/game-data'
import { en, format } from '../i18n/en.ts'

const t = en.app.progression

/** Stats whose values are flat amounts rather than fractions. */
const FLAT = new Set(['pierce', 'pellets', 'chains', 'utilityCharges', 'armour', 'killHeal', 'bleedout', 'reviveTime'])

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`

export function formatValue(stat: string, value: number): string {
	if (FLAT.has(stat)) return signed(Math.round(value * 10) / 10)
	return `${signed(Math.round(value * 1000) / 10)} %`
}

/** "+4 % movement speed", "+6 % explosive damage", "+5 % damage with LMG, Minigun". */
export function describeEffect(effect: Effect, rank = 1): string {
	const value = effect.value * rank
	const template = t.stats[effect.stat]
	let text = format(template, {
		value: effect.stat === 'killHeal' ? String(Math.round(value * 10) / 10) : formatValue(effect.stat, value),
		type: effect.damageType ? t.damageTypes[effect.damageType] : ''
	})
	if (effect.damageType && effect.stat !== 'resist') {
		text = format(t.typed, { type: t.damageTypes[effect.damageType], effect: text })
	}
	if (effect.kinds)
		text = format(t.withKinds, { effect: text, kinds: effect.kinds.map(kind => t.kinds[kind]).join(', ') })
	return text
}

export const salvage = (amount: number) => amount.toLocaleString('en')

export const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toString()
