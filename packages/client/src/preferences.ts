/** Small choices a player makes in the pause menu, kept in this browser. */

const DAMAGE_NUMBERS_KEY = 'rotline.damageNumbers'

/** Floating damage numbers over what you hit: on unless switched off. */
export function loadDamageNumbers(): boolean {
	try {
		return localStorage.getItem(DAMAGE_NUMBERS_KEY) !== 'off'
	} catch {
		return true
	}
}

export function saveDamageNumbers(on: boolean): void {
	try {
		if (on) localStorage.removeItem(DAMAGE_NUMBERS_KEY)
		else localStorage.setItem(DAMAGE_NUMBERS_KEY, 'off')
	} catch {
		// not kept
	}
}
