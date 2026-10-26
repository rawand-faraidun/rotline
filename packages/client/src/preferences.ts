/** Small choices a player makes in the pause menu, and the notes they have found, kept in this browser. */

const NOTES_KEY = 'rotline.notes'

/** Notes read so far, as "mission:note" ids. */
export function loadReadNotes(): Set<string> {
	try {
		const list = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '[]')
		return new Set(Array.isArray(list) ? list.filter(entry => typeof entry === 'string') : [])
	} catch {
		return new Set()
	}
}

export function saveReadNotes(read: ReadonlySet<string>): void {
	try {
		localStorage.setItem(NOTES_KEY, JSON.stringify([...read]))
	} catch {
		// not kept
	}
}

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
