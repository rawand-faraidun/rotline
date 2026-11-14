import { Button } from '@rotline/sim'

/** Stick travel below this is noise. */
const DEAD_ZONE = 0.22
/** How far ahead a thrown grenade lands at full right-stick travel, in metres. */
const STICK_REACH = 12

/**
 * Standard gamepad layout (the browser's "standard" mapping): what each button does.
 * RT fires, LT sprints, the bumpers and Y are the three abilities, the d-pad's up and down the two
 * utilities, A works things and revives, X reloads, B swaps weapons, Start opens the menu.
 */
const PAD_BUTTONS: readonly [number, number][] = [
	[7, Button.fire],
	[6, Button.sprint],
	[10, Button.sprint],
	[4, Button.ability1],
	[5, Button.ability2],
	[3, Button.ability3],
	[12, Button.utility1],
	[13, Button.utility2],
	[0, Button.interact],
	[2, Button.reload],
	[1, Button.swap],
	[14, Button.slot1],
	[15, Button.slot2]
]
const PAD_START = 9

/**
 * Keyboard, mouse and gamepad state, read once per input tick. A gamepad takes over aiming while
 * its right stick is pushed; the mouse takes it back as soon as it moves.
 */
export class Controls {
	private readonly keys = new Set<string>()
	private mouseButtons = 0
	readonly pointer = { x: 0, y: 0, inside: false }
	/** the right stick, while it is pushed: the angle on the ground (sim axes) and how far */
	readonly stick = { active: false, angle: 0, reach: 0 }
	/** a gamepad is in use (for the HUD to show its buttons) */
	padInUse = false
	private startHeld = false
	private readonly target: HTMLElement
	private readonly listeners: [EventTarget, string, EventListener][] = []

	constructor(target: HTMLElement) {
		this.target = target
		this.on(window, 'keydown', event => {
			// a key the page sent itself (the gamepad's Start as Esc) is no key held down
			if (!event.isTrusted) return
			const key = (event as KeyboardEvent).code
			if (GAME_KEYS.has(key)) event.preventDefault()
			this.keys.add(key)
			this.padInUse = false
		})
		this.on(window, 'keyup', event => this.keys.delete((event as KeyboardEvent).code))
		this.on(window, 'blur', () => {
			this.keys.clear()
			this.mouseButtons = 0
		})
		this.on(target, 'pointermove', event => this.move(event as PointerEvent))
		this.on(target, 'pointerdown', event => {
			this.move(event as PointerEvent)
			this.mouseButtons = (event as PointerEvent).buttons
			target.setPointerCapture((event as PointerEvent).pointerId)
		})
		this.on(target, 'pointerup', event => {
			this.mouseButtons = (event as PointerEvent).buttons
		})
		this.on(target, 'contextmenu', event => event.preventDefault())
	}

	private on(target: EventTarget, type: string, listener: EventListener): void {
		target.addEventListener(type, listener)
		this.listeners.push([target, type, listener])
	}

	private move(event: PointerEvent): void {
		const rect = this.target.getBoundingClientRect()
		this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
		this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
		this.pointer.inside = true
		this.stick.active = false
		this.padInUse = false
	}

	/** The first connected gamepad with the standard layout, if any. */
	private pad(): Gamepad | null {
		if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
		for (const pad of navigator.getGamepads()) if (pad?.connected && pad.mapping === 'standard') return pad
		return null
	}

	/**
	 * Reads the gamepad once per input tick: the right stick aims (screen up is the map's north,
	 * as the camera looks), and Start opens or closes the menu like Esc.
	 */
	poll(): void {
		const pad = this.pad()
		if (!pad) return
		const rx = pad.axes[2] ?? 0
		const ry = pad.axes[3] ?? 0
		const push = Math.hypot(rx, ry)
		if (push > DEAD_ZONE) {
			this.stick.active = true
			this.stick.angle = Math.atan2(ry, rx)
			this.stick.reach = Math.min(1, push) * STICK_REACH
			this.pointer.inside = false
			this.padInUse = true
		}
		const start = pad.buttons[PAD_START]?.pressed ?? false
		if (start && !this.startHeld) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
		this.startHeld = start
	}

	/** -1..1 on each axis, from WASD, the arrow keys or the left stick. */
	movement(): { x: number; y: number } {
		const x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0)
		const y = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0)
		if (x !== 0 || y !== 0) return { x, y }
		const pad = this.pad()
		const lx = pad?.axes[0] ?? 0
		const ly = pad?.axes[1] ?? 0
		const push = Math.hypot(lx, ly)
		if (push < DEAD_ZONE) return { x: 0, y: 0 }
		this.padInUse = true
		// past the dead zone the stick's travel is the speed, up to full
		const scale = Math.min(1, (push - DEAD_ZONE) / (1 - DEAD_ZONE)) / push
		return { x: lx * scale, y: ly * scale }
	}

	buttons(): number {
		let buttons = 0
		if (this.mouseButtons & 1 || this.keys.has('Space')) buttons |= Button.fire
		if (this.keys.has('KeyR')) buttons |= Button.reload
		if (this.keys.has('Digit1')) buttons |= Button.slot1
		if (this.keys.has('Digit2')) buttons |= Button.slot2
		if (this.keys.has('Digit3')) buttons |= Button.slot3
		if (this.keys.has('KeyQ')) buttons |= Button.swap
		if (this.keys.has('KeyE')) buttons |= Button.interact
		if (this.keys.has('KeyF')) buttons |= Button.ability1
		if (this.keys.has('KeyC')) buttons |= Button.ability2
		if (this.keys.has('KeyV')) buttons |= Button.ability3
		if (this.keys.has('KeyG')) buttons |= Button.utility1
		if (this.keys.has('KeyT')) buttons |= Button.utility2
		if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) buttons |= Button.sprint
		const pad = this.pad()
		if (pad)
			for (const [index, bit] of PAD_BUTTONS) {
				const button = pad.buttons[index]
				// triggers are analogue: half way counts
				if (button && (button.pressed || button.value > 0.5)) {
					buttons |= bit
					this.padInUse = true
				}
			}
		return buttons
	}

	private down(...codes: string[]): boolean {
		return codes.some(code => this.keys.has(code))
	}

	dispose(): void {
		for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener)
	}
}

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
