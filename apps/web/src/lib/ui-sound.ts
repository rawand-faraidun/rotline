import { type AudioEngine, sharedAudio } from '@rotline/client/audio'

/**
 * Interface sounds for the screens around the game (lobby, armory, shop): a click for every button
 * and link, a firmer sound when something is bought or changed, a call for invites. They use the
 * same settings as the game's sound (the interface volume).
 */
let engine: AudioEngine | null = null

function audio(): AudioEngine | null {
	if (typeof window === 'undefined') return null
	engine ??= sharedAudio('/assets/audio')
	return engine
}

export type UiSound = 'ui-click' | 'ui-select' | 'ui-confirm' | 'ui-inspect' | 'ui-notify'

export function uiSound(name: UiSound, volume = 0.6): void {
	audio()?.play(name, { bus: 'interface', volume })
}

/** Clicks for every enabled button and link on the page; returns a function that stops it. */
export function listenForClicks(): () => void {
	// fetch and decode the game's sounds now, while the player is in the lobby, not when they deploy
	audio()?.preload()
	const press = (event: PointerEvent) => {
		const sound = audio()
		sound?.unlock()
		const target = (event.target as Element | null)?.closest('button, a[href], [role="button"], select, summary')
		if (!target || (target as HTMLButtonElement).disabled || target.getAttribute('aria-disabled') === 'true') return
		uiSound(target.matches('select, [aria-pressed]') ? 'ui-select' : 'ui-click', 0.5)
	}
	window.addEventListener('pointerdown', press)
	return () => window.removeEventListener('pointerdown', press)
}
