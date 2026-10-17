/**
 * The game's sound: recorded sounds from the asset manifest (weapons, reloads, zombies) and a few
 * made on the fly with Web Audio (explosions, flames, clicks, chimes) until recordings replace them.
 * Positional by hand for a top-down view: left/right pan from the horizontal offset, volume from the
 * distance to the listener. Each sound has a voice limit, so a horde never clips the mix.
 */

export type AudioSettings = {
	/** 0..1 */
	master: number
	effects: number
	interface: number
	music: number
	ambience: number
	muted: boolean
}

export const defaultAudioSettings: AudioSettings = {
	master: 0.8,
	effects: 1,
	interface: 0.8,
	music: 0.45,
	ambience: 0.7,
	muted: false
}

type Bus = 'effects' | 'interface' | 'music' | 'ambience'

const SETTINGS_KEY = 'rotline.audio'

/** The player's sound settings (kept per browser; nothing important if they are lost). */
export function loadAudioSettings(): AudioSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY)
		if (raw) return { ...defaultAudioSettings, ...(JSON.parse(raw) as Partial<AudioSettings>) }
	} catch {
		// private window or blocked storage: the defaults
	}
	return { ...defaultAudioSettings }
}

export function saveAudioSettings(settings: AudioSettings): void {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
	} catch {
		// not saved; it still applies for this session
	}
}

/** Sounds made with Web Audio instead of a recording. */
export type SynthName =
	| 'explosion'
	| 'thump'
	| 'flame'
	| 'zap'
	| 'click'
	| 'empty'
	| 'hit'
	| 'chime'
	| 'pickup'
	| 'thud'
	| 'door'
	| 'power'
	| 'alarm'
	| 'body'

export type PlayOptions = {
	/** world position; omitted for sounds that belong to the player (their own gun, the interface) */
	x?: number
	y?: number
	volume?: number
	/** playback rate (pitch); a little random variation is added unless `exact` */
	rate?: number
	exact?: boolean
	bus?: Bus
}

/** A looping sound (music, ambience) that can be faded and stopped. */
export type LoopHandle = {
	/** fades to `volume` over `seconds` */
	fade(volume: number, seconds?: number): void
	stop(seconds?: number): void
}

const SYNTHS = new Set<string>([
	'explosion',
	'thump',
	'flame',
	'zap',
	'click',
	'empty',
	'hit',
	'chime',
	'pickup',
	'thud',
	'door',
	'power',
	'alarm',
	'body'
])

/** Long files (music, ambience) load the first time they are played, not with the rest. */
const LAZY = /^(music|ambience)-/
/** How long the two copies of a loop overlap where it wraps around. */
const LOOP_CROSSFADE = 2.5

/** How many of one sound may play at once; the oldest stops for a new one. */
const VOICES: Record<string, number> = {
	default: 6,
	zombie: 4,
	'zombie-fast': 3,
	'zombie-pain': 3,
	'zombie-death': 3,
	flesh: 4,
	explosion: 4,
	flame: 2,
	body: 3
}
/** Full volume within this distance (metres), then falling off; silent past MAX_DISTANCE. */
const NEAR = 6
const MAX_DISTANCE = 45
/** Left/right pan reaches full at this horizontal offset. */
const PAN_DISTANCE = 22

type Voice = { source: AudioScheduledSourceNode; started: number }

export class AudioEngine {
	private context: AudioContext | null = null
	private master: GainNode | null = null
	private buses: Record<Bus, GainNode> | null = null
	private readonly buffers = new Map<string, AudioBuffer[]>()
	private manifest: Record<string, string[]> = {}
	private readonly lazy = new Map<string, Promise<AudioBuffer[]>>()
	private readonly voices = new Map<string, Voice[]>()
	private noise: AudioBuffer | null = null
	private settings: AudioSettings
	private listenerX = 0
	private listenerY = 0
	private readonly base: string
	private loading: Promise<void> | null = null
	private markUnlocked: () => void = () => {}
	/** resolves at the first click or key press, when sound may start */
	private readonly unlocked = new Promise<void>(resolve => {
		this.markUnlocked = resolve
	})

	constructor(base: string, settings: AudioSettings = loadAudioSettings()) {
		this.base = base
		this.settings = settings
	}

	/** Browsers only allow sound after a click or key press: call this from one. */
	unlock(): void {
		if (typeof AudioContext === 'undefined') return
		if (!this.context) {
			this.context = new AudioContext()
			const context = this.context
			this.master = context.createGain()
			// a gentle compressor glues gunfire and horde together and keeps peaks from clipping
			const compressor = context.createDynamicsCompressor()
			compressor.threshold.value = -16
			compressor.knee.value = 12
			compressor.ratio.value = 4
			compressor.attack.value = 0.004
			compressor.release.value = 0.2
			this.master.connect(compressor)
			compressor.connect(context.destination)
			const bus = () => {
				const gain = context.createGain()
				gain.connect(this.master as GainNode)
				return gain
			}
			this.buses = { effects: bus(), interface: bus(), music: bus(), ambience: bus() }
			// effects get a little of a dark, open space around them
			const reverb = context.createConvolver()
			reverb.buffer = this.impulse(context, 1.8)
			const send = context.createGain()
			send.gain.value = 0.16
			this.buses.effects.connect(send)
			send.connect(reverb)
			reverb.connect(this.master)
			this.applySettings()
			this.loading = this.load()
			this.markUnlocked()
		}
		if (this.context.state === 'suspended') void this.context.resume()
	}

	get ready(): Promise<void> {
		return this.loading ?? Promise.resolve()
	}

	private async load(): Promise<void> {
		const context = this.context
		if (!context) return
		try {
			const manifest = (await (await fetch(`${this.base}/manifest.json`)).json()) as Record<string, string[]>
			this.manifest = manifest
			await Promise.all(
				Object.entries(manifest)
					.filter(([group]) => !LAZY.test(group))
					.map(async ([group, files]) => this.buffers.set(group, await this.decode(context, files)))
			)
		} catch {
			// no sound files (offline, blocked): the made-up sounds still play
		}
	}

	private decode(context: AudioContext, files: readonly string[]): Promise<AudioBuffer[]> {
		return Promise.all(
			files.map(async file => context.decodeAudioData(await (await fetch(`${this.base}/${file}`)).arrayBuffer()))
		)
	}

	/** A long sound's buffers, fetched the first time they are asked for. */
	private async lazyBuffers(group: string): Promise<AudioBuffer[]> {
		await this.unlocked
		await this.loading
		const context = this.context
		const files = this.manifest[group]
		if (!context || !files) return []
		let pending = this.lazy.get(group)
		if (!pending) {
			pending = this.decode(context, files).catch(() => [])
			this.lazy.set(group, pending)
		}
		return pending
	}

	/**
	 * Loops a long sound (music, ambience) on its bus, fading in. Where it wraps around, two copies
	 * overlap and crossfade, so the seam is not heard. Returns a handle to fade or stop it.
	 */
	loop(group: string, options: { bus?: Bus; volume?: number; fadeIn?: number } = {}): LoopHandle {
		const state = { volume: options.volume ?? 1, stopped: false, gain: null as GainNode | null, timer: 0 }
		const handle: LoopHandle = {
			fade: (volume, seconds = 1) => {
				state.volume = volume
				const context = this.context
				if (!state.gain || !context) return
				state.gain.gain.cancelScheduledValues(context.currentTime)
				state.gain.gain.setValueAtTime(state.gain.gain.value, context.currentTime)
				state.gain.gain.linearRampToValueAtTime(volume, context.currentTime + seconds)
			},
			stop: (seconds = 1) => {
				state.stopped = true
				window.clearTimeout(state.timer)
				const context = this.context
				if (!state.gain || !context) return
				const gain = state.gain
				gain.gain.cancelScheduledValues(context.currentTime)
				gain.gain.setValueAtTime(gain.gain.value, context.currentTime)
				gain.gain.linearRampToValueAtTime(0, context.currentTime + seconds)
				window.setTimeout(() => gain.disconnect(), seconds * 1000 + 100)
			}
		}
		void this.lazyBuffers(group).then(buffers => {
			const context = this.context
			const buses = this.buses
			const buffer = buffers[Math.floor(Math.random() * buffers.length)]
			if (!buffer || !context || !buses || state.stopped) return
			const gain = context.createGain()
			gain.gain.setValueAtTime(0, context.currentTime)
			gain.gain.linearRampToValueAtTime(state.volume, context.currentTime + (options.fadeIn ?? 2))
			gain.connect(buses[options.bus ?? 'ambience'])
			state.gain = gain
			const overlap = Math.min(LOOP_CROSSFADE, buffer.duration / 4)
			const play = (at: number) => {
				if (state.stopped) return
				const source = context.createBufferSource()
				source.buffer = buffer
				const envelope = context.createGain()
				envelope.gain.setValueAtTime(0, at)
				envelope.gain.linearRampToValueAtTime(1, at + overlap)
				envelope.gain.setValueAtTime(1, at + buffer.duration - overlap)
				envelope.gain.linearRampToValueAtTime(0, at + buffer.duration)
				source.connect(envelope)
				envelope.connect(gain)
				source.start(at)
				source.addEventListener('ended', () => envelope.disconnect())
				const next = at + buffer.duration - overlap
				// schedule the next copy a little before it is due
				state.timer = window.setTimeout(() => play(next), Math.max(0, (next - context.currentTime - 1) * 1000))
			}
			play(context.currentTime + 0.05)
		})
		return handle
	}

	/** A short burst of decaying noise, used as the room the effects ring in. */
	private impulse(context: AudioContext, seconds: number): AudioBuffer {
		const length = Math.floor(context.sampleRate * seconds)
		const buffer = context.createBuffer(2, length, context.sampleRate)
		let seed = 777
		for (let channel = 0; channel < 2; channel++) {
			const data = buffer.getChannelData(channel)
			for (let i = 0; i < length; i++) {
				seed = (seed * 1664525 + 1013904223) >>> 0
				data[i] = (seed / 2147483648 - 1) * (1 - i / length) ** 3
			}
		}
		return buffer
	}

	getSettings(): AudioSettings {
		return { ...this.settings }
	}

	setSettings(settings: AudioSettings): void {
		this.settings = { ...settings }
		saveAudioSettings(this.settings)
		this.applySettings()
	}

	private applySettings(): void {
		if (!this.master || !this.buses) return
		this.master.gain.value = this.settings.muted ? 0 : this.settings.master
		this.buses.effects.gain.value = this.settings.effects
		this.buses.interface.gain.value = this.settings.interface
		this.buses.music.gain.value = this.settings.music
		this.buses.ambience.gain.value = this.settings.ambience
	}

	/** Where the player is: positional sounds are heard from here. */
	setListener(x: number, y: number): void {
		this.listenerX = x
		this.listenerY = y
	}

	/** A recorded sound if there is one by that name, otherwise the made-up sound of that name. */
	sound(name: string, options: PlayOptions = {}): void {
		if (this.buffers.has(name)) this.play(name, options)
		else if (SYNTHS.has(name)) this.synth(name as SynthName, options)
	}

	/** Plays a recorded sound (a random one of its variants); falls back to nothing if it is missing. */
	play(group: string, options: PlayOptions = {}): void {
		const variants = this.buffers.get(group)
		const buffer = variants?.[Math.floor(Math.random() * variants.length)]
		if (!buffer) return
		this.start(group, options, (context, destination) => {
			const source = context.createBufferSource()
			source.buffer = buffer
			source.playbackRate.value = this.rate(options)
			source.connect(destination)
			return source
		})
	}

	/** Plays a sound made with Web Audio. */
	synth(name: SynthName, options: PlayOptions = {}): void {
		this.start(name, options, (context, destination) => this.make(context, destination, name, this.rate(options)))
	}

	private rate(options: PlayOptions): number {
		const rate = options.rate ?? 1
		return options.exact ? rate : rate * (0.94 + Math.random() * 0.12)
	}

	private start(
		key: string,
		options: PlayOptions,
		build: (context: AudioContext, destination: AudioNode) => AudioScheduledSourceNode
	): void {
		const context = this.context
		const buses = this.buses
		if (!context || !buses || context.state !== 'running' || this.settings.muted) return
		let volume = options.volume ?? 1
		let pan = 0
		if (options.x !== undefined && options.y !== undefined) {
			const dx = options.x - this.listenerX
			const dy = options.y - this.listenerY
			const distance = Math.hypot(dx, dy)
			if (distance > MAX_DISTANCE) return
			volume *= distance <= NEAR ? 1 : (NEAR / distance) ** 1.3
			pan = Math.max(-1, Math.min(1, dx / PAN_DISTANCE))
		}
		if (volume < 0.01) return
		const gain = context.createGain()
		gain.gain.value = volume
		const panner = context.createStereoPanner()
		panner.pan.value = pan
		gain.connect(panner)
		panner.connect(buses[options.bus ?? 'effects'])
		const source = build(context, gain)
		const voices = this.voices.get(key) ?? []
		const limit = VOICES[key] ?? VOICES.default ?? 6
		while (voices.length >= limit) {
			const oldest = voices.shift()
			try {
				oldest?.source.stop()
			} catch {
				// already ended
			}
		}
		const voice = { source, started: context.currentTime }
		voices.push(voice)
		this.voices.set(key, voices)
		source.addEventListener('ended', () => {
			const index = voices.indexOf(voice)
			if (index >= 0) voices.splice(index, 1)
			panner.disconnect()
		})
	}

	private noiseBuffer(context: AudioContext): AudioBuffer {
		if (this.noise) return this.noise
		const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
		const data = buffer.getChannelData(0)
		let seed = 12345
		for (let i = 0; i < data.length; i++) {
			seed = (seed * 1664525 + 1013904223) >>> 0
			data[i] = seed / 2147483648 - 1
		}
		this.noise = buffer
		return buffer
	}

	/** The made-up sounds: filtered noise and simple tones with short envelopes. */
	private make(context: AudioContext, destination: AudioNode, name: SynthName, rate: number): AudioScheduledSourceNode {
		const now = context.currentTime
		const envelope = context.createGain()
		envelope.connect(destination)
		const shape = (attack: number, hold: number, release: number, peak = 1) => {
			envelope.gain.setValueAtTime(0, now)
			envelope.gain.linearRampToValueAtTime(peak, now + attack)
			envelope.gain.setValueAtTime(peak, now + attack + hold)
			envelope.gain.exponentialRampToValueAtTime(0.001, now + attack + hold + release)
			return attack + hold + release
		}
		const noise = (type: BiquadFilterType, frequency: number, q = 0.8) => {
			const source = context.createBufferSource()
			source.buffer = this.noiseBuffer(context)
			source.loop = true
			const filter = context.createBiquadFilter()
			filter.type = type
			filter.frequency.value = frequency * rate
			filter.Q.value = q
			source.connect(filter)
			filter.connect(envelope)
			return { source, filter }
		}
		const tone = (type: OscillatorType, frequency: number) => {
			const oscillator = context.createOscillator()
			oscillator.type = type
			oscillator.frequency.value = frequency * rate
			oscillator.connect(envelope)
			return oscillator
		}
		let source: AudioScheduledSourceNode
		let length = 0.2
		switch (name) {
			case 'explosion': {
				const { source: s, filter } = noise('lowpass', 900, 0.7)
				filter.frequency.setValueAtTime(1600 * rate, now)
				filter.frequency.exponentialRampToValueAtTime(120, now + 1.1)
				length = shape(0.005, 0.08, 1.2)
				source = s
				break
			}
			case 'thump': {
				const { source: s } = noise('lowpass', 300, 1)
				length = shape(0.003, 0.02, 0.18)
				source = s
				break
			}
			case 'flame': {
				const { source: s } = noise('bandpass', 700, 0.6)
				length = shape(0.02, 0.06, 0.15, 0.6)
				source = s
				break
			}
			case 'zap': {
				const oscillator = tone('sawtooth', 220)
				oscillator.frequency.setValueAtTime(900 * rate, now)
				oscillator.frequency.exponentialRampToValueAtTime(140 * rate, now + 0.18)
				length = shape(0.002, 0.04, 0.16, 0.5)
				source = oscillator
				break
			}
			case 'click':
			case 'empty': {
				const oscillator = tone('square', name === 'empty' ? 1800 : 1200)
				length = shape(0.001, 0.005, name === 'empty' ? 0.04 : 0.03, 0.35)
				source = oscillator
				break
			}
			case 'hit': {
				const oscillator = tone('triangle', 2200)
				length = shape(0.001, 0.004, 0.05, 0.4)
				source = oscillator
				break
			}
			case 'chime':
			case 'pickup': {
				const oscillator = tone('sine', name === 'pickup' ? 880 : 660)
				oscillator.frequency.setValueAtTime(oscillator.frequency.value, now)
				oscillator.frequency.linearRampToValueAtTime(oscillator.frequency.value * 1.5, now + 0.12)
				length = shape(0.005, 0.08, 0.35, 0.45)
				source = oscillator
				break
			}
			case 'thud': {
				const oscillator = tone('sine', 90)
				oscillator.frequency.exponentialRampToValueAtTime(45, now + 0.2)
				length = shape(0.002, 0.03, 0.22, 0.8)
				source = oscillator
				break
			}
			case 'door': {
				const { source: s } = noise('lowpass', 500, 2)
				length = shape(0.004, 0.05, 0.25, 0.8)
				source = s
				break
			}
			case 'power': {
				const oscillator = tone('sawtooth', 55)
				oscillator.frequency.linearRampToValueAtTime(110 * rate, now + 0.8)
				length = shape(0.1, 0.5, 0.6, 0.35)
				source = oscillator
				break
			}
			case 'body': {
				// the chest-thump under a gunshot that small speakers lose from the recording
				const oscillator = tone('sine', 78)
				oscillator.frequency.setValueAtTime(78 * rate, now)
				oscillator.frequency.exponentialRampToValueAtTime(38 * rate, now + 0.14)
				length = shape(0.001, 0.015, 0.16, 0.9)
				source = oscillator
				break
			}
			case 'alarm': {
				const oscillator = tone('square', 520)
				oscillator.frequency.setValueAtTime(520 * rate, now)
				oscillator.frequency.setValueAtTime(390 * rate, now + 0.2)
				length = shape(0.005, 0.35, 0.1, 0.3)
				source = oscillator
				break
			}
		}
		source.start(now)
		source.stop(now + length + 0.05)
		return source
	}

	dispose(): void {
		void this.context?.close()
		this.context = null
	}
}
