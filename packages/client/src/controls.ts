import { Button } from '@rotline/sim'

/** Keyboard and mouse state, read once per input tick. Gamepad support comes with the settings screen. */
export class Controls {
	private readonly keys = new Set<string>()
	private mouseButtons = 0
	readonly pointer = { x: 0, y: 0, inside: false }
	private readonly target: HTMLElement
	private readonly listeners: [EventTarget, string, EventListener][] = []

	constructor(target: HTMLElement) {
		this.target = target
		this.on(window, 'keydown', event => {
			const key = (event as KeyboardEvent).code
			if (GAME_KEYS.has(key)) event.preventDefault()
			this.keys.add(key)
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
	}

	/** -1..1 on each axis, from WASD or the arrow keys. */
	movement(): { x: number; y: number } {
		const x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0)
		const y = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0)
		return { x, y }
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
