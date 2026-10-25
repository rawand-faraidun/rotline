/**
 * Codes that arrive in a link: /play/lobby?join=SQUAD (join a squad) and /play/lobby?friend=PLAYER
 * (send a friend request). A player who is not signed in yet goes through signing in first, which
 * drops the address, so the codes are kept for this tab until the lobby takes them.
 */
const KEY = 'rotline.link-codes'

type LinkCodes = { join: string | null; friend: string | null }

/** Reads the codes from the address (once, at start-up), keeps them, and tidies the address. */
export function keepLinkCodes(): void {
	if (typeof location === 'undefined') return
	const params = new URLSearchParams(location.search)
	const codes: LinkCodes = { join: params.get('join'), friend: params.get('friend') }
	if (!codes.join && !codes.friend) return
	try {
		sessionStorage.setItem(KEY, JSON.stringify(codes))
	} catch {
		// storage blocked: the codes still work if the player is already signed in
	}
	params.delete('join')
	params.delete('friend')
	const rest = params.toString()
	history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)
}

/** The kept codes, handed over once. */
export function takeLinkCodes(): LinkCodes {
	try {
		const raw = sessionStorage.getItem(KEY)
		sessionStorage.removeItem(KEY)
		if (raw) return JSON.parse(raw) as LinkCodes
	} catch {
		// nothing kept
	}
	return { join: null, friend: null }
}
