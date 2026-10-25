/** Copies text to the clipboard, with a fallback for browsers that refuse the clipboard API. */
export async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text)
	} catch {
		// no clipboard permission (or not a secure page): fall back to a hidden text field
		const field = document.createElement('textarea')
		field.value = text
		field.style.position = 'fixed'
		field.style.opacity = '0'
		document.body.append(field)
		field.select()
		document.execCommand('copy')
		field.remove()
	}
}

/** Can this device open its own share sheet (phones, tablets, some desktops)? */
export const canShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/**
 * Opens the device's share sheet with a link; where there is none, copies the link instead.
 * Returns what happened, so the button can say "Copied" when it copied.
 */
export async function shareLink(share: {
	title: string
	text: string
	url: string
}): Promise<'shared' | 'copied' | 'cancelled'> {
	if (canShare()) {
		try {
			await navigator.share(share)
			return 'shared'
		} catch (error) {
			// the player closed the sheet: nothing to do
			if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
		}
	}
	await copyText(share.url)
	return 'copied'
}
