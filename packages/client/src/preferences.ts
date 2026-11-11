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

const TIPS_KEY = 'rotline.tips'

/** Tips already shown in this browser (each is shown once), or null when tips are switched off. */
export function loadTipsSeen(): Set<string> | null {
	try {
		const raw = localStorage.getItem(TIPS_KEY)
		if (raw === 'off') return null
		const list = JSON.parse(raw ?? '[]')
		return new Set(Array.isArray(list) ? list.filter(entry => typeof entry === 'string') : [])
	} catch {
		return new Set()
	}
}

export function saveTipsSeen(seen: ReadonlySet<string> | null): void {
	try {
		localStorage.setItem(TIPS_KEY, seen ? JSON.stringify([...seen]) : 'off')
	} catch {
		// not kept
	}
}

/** Tips on (each shown once more from the start) or off. */
export function setTips(on: boolean): void {
	saveTipsSeen(on ? new Set() : null)
}

export function tipsOn(): boolean {
	return loadTipsSeen() !== null
}
