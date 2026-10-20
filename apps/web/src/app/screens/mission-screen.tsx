import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
	type AudioSettings,
	type GameHandle,
	type GraphicsSetting,
	type HudState,
	loadGraphicsSetting,
	saveGraphicsSetting
} from '@rotline/client'
import { missionById, zombies } from '@rotline/game-data'
import { Badge, Button, cn, Panel, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { fetchRangeTicket, fetchTicket, partyActions, partyQuery, usePlayerEvents } from '../../lib/party.ts'
import { clock, masteryTone } from './mission-panel.tsx'
import { SeatKeeper } from './seat-keeper.tsx'

const t = en.app.mission

const noop = () => () => {}
const empty = (): HudState | null => null

function useHud(handle: GameHandle | null): HudState | null {
	return useSyncExternalStore(handle ? handle.hud.subscribe : noop, handle ? handle.hud.getSnapshot : empty)
}

function HealthBar({ health, max }: { health: number; max: number }) {
	const ratio = Math.max(0, Math.min(1, health / max))
	const segments = 20
	const lit = Math.ceil(ratio * segments)
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-6">
				<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.health}</span>
				<span className={cn('font-display text-3xl tabular-nums', ratio < 0.3 ? 'text-alert' : 'text-bone')}>
					{health}
				</span>
			</div>
			<meter className="sr-only" min={0} max={max} value={health} aria-label={t.health} />
			<div className="flex gap-0.5" aria-hidden="true">
				{Array.from({ length: segments }, (_, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed segments
						key={i}
						className={cn(
							'h-3 w-3 skew-x-[-20deg]',
							i < lit ? (ratio < 0.3 ? 'bg-alert' : 'bg-rot-lime') : 'bg-surface-raised'
						)}
					/>
				))}
			</div>
		</div>
	)
}

function Weapons({ hud }: { hud: HudState }) {
	return (
		<ol className="flex flex-col items-end gap-2">
			{hud.weapons.map((weapon, slot) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: slots are fixed positions
					key={slot}
					className={cn(
						'frame cut flex min-w-56 items-center justify-between gap-6 px-4 py-2 [--frame-fill:rgb(13_16_14/0.85)]',
						weapon.active ? '[--frame-color:var(--color-rot-lime)]' : 'opacity-60'
					)}
				>
					<span className="flex items-center gap-2">
						<span className="font-bold text-muted text-xs">{slot + 1}</span>
						<span className="font-bold uppercase tracking-wide">{weapon.name}</span>
					</span>
					<span className="font-display text-2xl tabular-nums">
						<span data-slot="magazine" className={cn(weapon.mag === 0 && 'text-alert')}>
							{weapon.mag}
						</span>
						<span className="text-lg text-muted"> / {weapon.reserve === null ? t.unlimited : weapon.reserve}</span>
					</span>
				</li>
			))}
			{hud.reloading !== null && (
				<li>
					<Badge tone="warning" className="animate-blink">
						{t.reloading}
					</Badge>
				</li>
			)}
		</ol>
	)
}

/** Abilities with their keys and cooldowns, and utilities with their charges. */
function Abilities({ hud }: { hud: HudState }) {
	if (hud.abilities.length === 0 && hud.utilities.length === 0) return null
	return (
		<ol className="flex items-end gap-2" aria-label={t.abilities}>
			{hud.abilities.map(ability => {
				const ready = ability.seconds === 0
				return (
					<li
						key={ability.key}
						className={cn(
							'frame cut-sm relative flex w-28 flex-col gap-0.5 overflow-hidden px-2.5 py-1.5 [--frame-fill:rgb(13_16_14/0.85)]',
							ready ? '[--frame-color:var(--color-rot-lime)]' : 'opacity-75'
						)}
					>
						{!ready && (
							<span
								className="absolute inset-x-0 bottom-0 bg-surface-raised/80"
								style={{ height: `${Math.min(100, (ability.seconds / ability.cooldown) * 100)}%` }}
								aria-hidden="true"
							/>
						)}
						<span className="relative flex items-center justify-between">
							<span className="cut-sm bg-bone px-1.5 font-bold text-rot-black text-xs">{ability.key}</span>
							<span className={cn('font-display text-lg tabular-nums', ready ? 'text-rot-lime' : 'text-bone')}>
								{ready ? t.ready : ability.seconds}
							</span>
						</span>
						<span className="relative truncate font-bold text-[11px] uppercase tracking-wide">{ability.name}</span>
					</li>
				)
			})}
			{hud.utilities.map(utility => (
				<li
					key={utility.key}
					className={cn(
						'frame cut-sm flex w-28 flex-col gap-0.5 px-2.5 py-1.5 [--frame-fill:rgb(13_16_14/0.85)]',
						utility.charges === 0 && 'opacity-50'
					)}
				>
					<span className="flex items-center justify-between">
						<span className="cut-sm bg-bone px-1.5 font-bold text-rot-black text-xs">{utility.key}</span>
						<span className="font-display text-lg tabular-nums">
							{utility.charges === null ? t.unlimited : `×${utility.charges}`}
						</span>
					</span>
					<span className="truncate font-bold text-[11px] uppercase tracking-wide">{utility.name}</span>
				</li>
			))}
		</ol>
	)
}

/** "23 / 40", "12 / 45 s", "Get there", "38 s left"… for each objective type. */
function objectiveProgress(mission: NonNullable<HudState['mission']>): string {
	const values = { progress: String(mission.progress), goal: String(mission.goal) }
	switch (mission.type) {
		case 'reach':
		case 'retrieve':
			return mission.type === 'reach' ? t.progressReach : t.progressCarry
		case 'hold':
		case 'survive':
		case 'defend':
			return format(t.progressSeconds, values)
		case 'extract':
			return format(t.progressLeft, values)
		default:
			return format(t.progressKills, values)
	}
}

/** The last radio message, for a few seconds after it came in: who speaks and what they say. */
function Radio({ hud }: { hud: HudState }) {
	const [now, setNow] = useState(() => performance.now())
	const radio = hud.radio
	useEffect(() => {
		if (!radio) return
		const timer = window.setInterval(() => setNow(performance.now()), 500)
		return () => window.clearInterval(timer)
	}, [radio])
	if (!radio || now - radio.at > RADIO_MS) return null
	return (
		<section
			role="status"
			aria-live="polite"
			className="frame cut pointer-events-none absolute bottom-36 left-4 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-1 px-4 py-3 [--frame-color:var(--color-rot-lime)] [--frame-fill:rgb(13_16_14/0.88)]"
		>
			<span className="flex items-center gap-2 font-bold text-[11px] text-rot-lime uppercase tracking-[0.25em]">
				<span className="inline-block size-2 animate-pulse bg-rot-lime" aria-hidden="true" />
				{radio.speaker}
			</span>
			<span className="text-sm leading-snug">{radio.text}</span>
		</section>
	)
}

const RADIO_MS = 9000

/** An elite in the fight: its name and a long health bar at the top of the screen. */
function BossBar({ hud }: { hud: HudState }) {
	if (!hud.boss) return null
	return (
		<section
			aria-label={hud.boss.name}
			className="pointer-events-none absolute top-28 left-1/2 flex w-[min(36rem,80vw)] -translate-x-1/2 flex-col gap-1"
		>
			<span className="text-center font-display text-alert text-xl uppercase tracking-wider">{hud.boss.name}</span>
			<span className="h-2.5 border border-alert/60 bg-rot-black/80">
				<span className="block h-full bg-alert" style={{ width: `${Math.round(hud.boss.health * 100)}%` }} />
			</span>
		</section>
	)
}

/**
 * Where the objective is: a pulsing marker over it with the distance, or, when it is off screen, an
 * arrow at the edge pointing the way.
 */
function Waypoint({ hud }: { hud: HudState }) {
	const point = hud.waypoint
	if (!point) return null
	const metres = `${Math.round(point.distance)} m`
	return (
		<div
			className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
			style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
			aria-hidden="true"
		>
			{point.onScreen ? (
				<span className="block size-4 rotate-45 animate-pulse border-2 border-rot-lime bg-rot-lime/25 shadow-[0_0_12px_var(--color-rot-lime)]" />
			) : (
				<svg
					viewBox="0 0 24 24"
					className="size-9 text-rot-lime drop-shadow-[0_0_6px_var(--color-rot-lime)]"
					style={{ transform: `rotate(${point.angle}rad)` }}
				>
					<path d="M4 4 L22 12 L4 20 L9 12 Z" fill="currentColor" />
				</svg>
			)}
			<span className="bg-rot-black/70 px-1.5 font-bold text-rot-lime text-xs tabular-nums">{metres}</span>
		</div>
	)
}

/** The current objective, top right: what to do and how far along. */
function ObjectiveTracker({ hud }: { hud: HudState }) {
	const mission = hud.mission
	if (!mission) return null
	const fraction = mission.goal > 0 ? Math.min(1, mission.progress / mission.goal) : 0
	return (
		<section
			aria-label={mission.name}
			className="frame cut pointer-events-none absolute top-4 right-4 flex w-72 flex-col gap-1.5 px-4 py-3 [--frame-fill:rgb(13_16_14/0.85)]"
		>
			<span className="flex items-baseline justify-between gap-3">
				<span className="truncate font-display text-xl uppercase">{mission.name}</span>
				<span className="text-muted text-xs uppercase tracking-wider">{mission.difficulty}</span>
			</span>
			<span className="font-bold text-[10px] text-muted uppercase tracking-[0.25em]">
				{format(t.objective, { index: String(Math.max(1, mission.step)), count: String(mission.count) })}
			</span>
			<span className="font-bold text-rot-lime uppercase tracking-wide" aria-live="polite">
				{mission.label}
			</span>
			<span className="flex items-center gap-3">
				<span className="h-1.5 flex-1 bg-surface-raised">
					<span className="block h-full bg-rot-lime" style={{ width: `${fraction * 100}%` }} />
				</span>
				<span className="font-display text-lg tabular-nums">{objectiveProgress(mission)}</span>
			</span>
		</section>
	)
}

/** The score multiplier, large in the top centre, with the chain timer draining under it (and the round in Survival). */
function Multiplier({ hud, round }: { hud: HudState; round: number | null }) {
	return (
		<div className="pointer-events-none absolute top-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
			<div className="flex items-end gap-4">
				{round !== null && (
					<span className="flex flex-col items-center">
						<span className="font-bold text-[10px] text-muted uppercase tracking-[0.25em]">{t.round}</span>
						<span className="font-display text-3xl tabular-nums">{round}</span>
					</span>
				)}
				<span className="flex flex-col items-center">
					<span className="font-bold text-[10px] text-muted uppercase tracking-[0.25em]">{t.multiplier}</span>
					<span
						className={cn(
							'font-display text-5xl tabular-nums leading-none',
							hud.multiplier > 1 ? 'text-warning' : 'text-bone/70'
						)}
					>
						×{hud.multiplier}
					</span>
				</span>
				<span className="flex flex-col items-center">
					<span className="font-bold text-[10px] text-muted uppercase tracking-[0.25em]">{t.score}</span>
					<span className="font-display text-3xl tabular-nums">{hud.missionScore.toLocaleString('en')}</span>
				</span>
			</div>
			<span className="h-1 w-48 bg-surface-raised" aria-hidden="true">
				<span className="block h-full bg-warning" style={{ width: `${hud.chainLeft * 100}%` }} />
			</span>
			{hud.chain > 0 && (
				<span className="text-muted text-xs tabular-nums">{format(t.chain, { chain: String(hud.chain) })}</span>
			)}
			{hud.buffs.length > 0 && (
				<ul className="mt-1 flex gap-2">
					{hud.buffs.map(buff => (
						<li key={buff.id}>
							<Badge tone="lime">
								{buff.name} {buff.seconds}s
							</Badge>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

/** Items found, buffs picked up and score bonuses, for a few seconds each. */
function Toasts({ hud }: { hud: HudState }) {
	const now = performance.now()
	const live = hud.toasts.filter(toast => now - toast.at < 4000)
	if (live.length === 0) return null
	return (
		<ul className="pointer-events-none absolute top-1/3 right-4 flex w-72 flex-col gap-2" aria-live="polite">
			{live.map(toast => (
				<li
					key={toast.id}
					className={cn(
						'frame cut-sm flex flex-col px-3 py-2 [--frame-fill:rgb(13_16_14/0.9)]',
						toast.kind === 'item' && '[--frame-color:var(--color-warning)]'
					)}
				>
					{toast.kind === 'item' && (
						<>
							<span className="font-bold text-[10px] text-warning uppercase tracking-[0.25em]">{t.itemFound}</span>
							<span className="font-bold uppercase tracking-wide">{toast.text}</span>
						</>
					)}
					{toast.kind === 'buff' && (
						<span className="font-bold text-rot-lime uppercase tracking-wide">
							{toast.by
								? format(t.buffBy, { name: toast.text, by: toast.by })
								: format(t.buffPicked, { name: toast.text })}
						</span>
					)}
					{toast.kind === 'threshold' && (
						<span className="font-bold text-warning">{format(t.threshold, { salvage: toast.text })}</span>
					)}
				</li>
			))}
		</ul>
	)
}

/**
 * The pause menu. Alone the game is paused; in a squad it goes on and you stand still. Leaving keeps
 * your place (rejoin from the lobby); abandoning gives it up.
 */
/** Sound volumes, saved in this browser. */
function SoundSettings({ handle }: { handle: GameHandle }) {
	const [settings, setSettings] = useState<AudioSettings>(() => handle.audio.get())
	const change = (patch: Partial<AudioSettings>) => {
		const next = { ...settings, ...patch }
		setSettings(next)
		handle.audio.set(next)
	}
	const s = t.sound
	const slider = (key: 'master' | 'effects' | 'music' | 'ambience' | 'interface', label: string) => (
		<label className="flex items-center justify-between gap-3 text-sm">
			<span className="text-muted text-xs uppercase tracking-[0.2em]">{label}</span>
			<input
				type="range"
				min={0}
				max={100}
				value={Math.round(settings[key] * 100)}
				onChange={event => change({ [key]: Number(event.target.value) / 100 })}
				className="w-40 accent-rot-lime"
				aria-label={label}
			/>
		</label>
	)
	return (
		<fieldset className="flex flex-col gap-2">
			<legend className="mb-1 font-bold text-muted text-xs uppercase tracking-[0.2em]">{s.title}</legend>
			{slider('master', s.master)}
			{slider('effects', s.effects)}
			{slider('music', s.music)}
			{slider('ambience', s.ambience)}
			{slider('interface', s.interface)}
			<label className="flex items-center gap-2 text-sm">
				<input type="checkbox" checked={settings.muted} onChange={event => change({ muted: event.target.checked })} />
				{s.mute}
			</label>
		</fieldset>
	)
}

/** Graphics detail: automatic (light on devices without a graphics card), high or low. */
function GraphicsSettings() {
	const [setting, setSetting] = useState<GraphicsSetting>(() => loadGraphicsSetting())
	const g = t.graphics
	return (
		<label className="flex items-center justify-between gap-3 text-sm">
			<span className="flex flex-col">
				<span className="text-muted text-xs uppercase tracking-[0.2em]">{g.title}</span>
				<span className="text-muted text-xs">{g.hint}</span>
			</span>
			<select
				value={setting}
				onChange={event => {
					const next = event.target.value as GraphicsSetting
					setSetting(next)
					saveGraphicsSetting(next)
				}}
				className="frame cut-sm bg-rot-black px-2 py-1 text-sm"
			>
				<option value="auto">{g.auto}</option>
				<option value="high">{g.high}</option>
				<option value="low">{g.low}</option>
			</select>
		</label>
	)
}

function PauseMenu({
	handle,
	range,
	squad,
	onResume,
	onLobby,
	onAbandon
}: {
	handle: GameHandle
	range: boolean
	squad: boolean
	onResume: () => void
	onLobby: () => void
	onAbandon: () => void
}) {
	const p = t.pause
	return (
		<div className="absolute inset-0 grid place-items-center bg-rot-black/75 p-4">
			<Panel role="dialog" aria-modal="true" aria-label={p.title} className="w-full max-w-sm">
				<PanelTitle>{squad ? p.squadTitle : p.title}</PanelTitle>
				{squad && <p className="text-muted text-sm">{p.squadNote}</p>}
				<div className="flex flex-col gap-2">
					<Button autoFocus onClick={onResume}>
						{p.resume}
					</Button>
					{range ? (
						<Button variant="secondary" onClick={onLobby}>
							{p.leaveRange}
						</Button>
					) : (
						<>
							<Button variant="secondary" onClick={onLobby}>
								{p.lobby}
							</Button>
							<Button variant="ghost" onClick={onAbandon}>
								{squad ? p.abandonSquad : p.abandon}
							</Button>
						</>
					)}
				</div>
				<SoundSettings handle={handle} />
				<GraphicsSettings />
				<p className="text-muted text-xs">{t.controls}</p>
			</Panel>
		</div>
	)
}

/** The results screen: what the mission paid and found, and the mastery reached; or how long a Survival run lasted. */
function ResultsPanel({ results, onDone }: { results: NonNullable<HudState['results']>; onDone: () => void }) {
	const r = t.results
	const survival = !results.success
	const rows: [string, string][] = [
		...(survival ? [[r.rounds, String(results.rounds)] as [string, string]] : []),
		[r.time, clock(results.timeMs / 1000)],
		[r.score, results.score.toLocaleString('en')],
		[r.kills, String(results.kills)],
		[r.xp, `+${Math.floor(results.xp).toLocaleString('en')}`],
		[r.salvage, `+${Math.floor(results.salvage).toLocaleString('en')}`],
		[r.downs, String(results.downs)]
	]
	return (
		<div className="absolute inset-0 grid place-items-center bg-rot-black/85 p-4">
			<Panel className="w-full max-w-lg [--frame-color:var(--color-rot-lime)]">
				<PanelTitle>{survival ? r.runOver : r.title}</PanelTitle>
				<dl className="grid grid-cols-2 gap-x-6 gap-y-2">
					{rows.map(([label, value]) => (
						<div key={label} className="flex items-baseline justify-between gap-3 border-surface-raised border-b pb-1">
							<dt className="text-muted text-xs uppercase tracking-[0.2em]">{label}</dt>
							<dd className="font-display text-2xl tabular-nums">{value}</dd>
						</div>
					))}
				</dl>
				<div className={cn('flex items-center justify-between gap-3', survival && 'hidden')}>
					<span className="text-muted text-xs uppercase tracking-[0.2em]">{r.mastery}</span>
					<Badge tone={masteryTone[results.mastery] ?? 'muted'}>{en.app.missions.mastery[results.mastery]}</Badge>
				</div>
				<div className={cn('flex flex-col gap-1.5', survival && 'hidden')}>
					<span className="text-muted text-xs uppercase tracking-[0.2em]">{r.items}</span>
					{results.items.length > 0 ? (
						<ul className="flex flex-wrap gap-2">
							{results.items.map((name, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: the same item can drop twice
								<li key={index}>
									<Badge tone="warning">{name}</Badge>
								</li>
							))}
						</ul>
					) : (
						<span className="text-bone/70 text-sm">{r.noItems}</span>
					)}
					{results.items.length > 0 && <p className="text-muted text-xs">{r.saved}</p>}
				</div>
				<Button onClick={onDone}>{t.backToLobby}</Button>
			</Panel>
		</div>
	)
}

/** Firing-range controls: spawn zombies to practise on, clear them, and the damage meter. */
function RangePanel({ handle, hud }: { handle: GameHandle; hud: HudState }) {
	const r = en.app.range
	return (
		<Panel className="absolute top-16 right-4 w-64 gap-3 p-4 [--frame-fill:rgb(13_16_14/0.85)]">
			<span className="flex items-baseline justify-between">
				<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{r.dps}</span>
				<span className="font-display text-3xl text-rot-lime tabular-nums" data-testid="dps">
					{hud.dps}
				</span>
			</span>
			<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{r.spawn}</span>
			<div className="grid grid-cols-2 gap-1.5">
				{zombies.map((zombie, index) =>
					zombie.dummy ? null : (
						<Button key={zombie.id} size="sm" variant="secondary" onClick={() => handle.range('spawn', index, 5)}>
							{zombie.name} ×5
						</Button>
					)
				)}
			</div>
			<Button size="sm" variant="ghost" onClick={() => handle.range('clear')}>
				{r.clear}
			</Button>
			<p className="text-muted text-xs">{r.hint}</p>
		</Panel>
	)
}

export function RangeScreen() {
	return <MissionScreen mode="range" />
}

export function MissionScreen({ mode = 'mission' }: { mode?: 'mission' | 'range' } = {}) {
	const range = mode === 'range'
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [handle, setHandle] = useState<GameHandle | null>(null)
	const [loaded, setLoaded] = useState(false)
	const [failed, setFailed] = useState(false)
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const hud = useHud(handle)
	usePlayerEvents()
	const party = useQuery({ ...partyQuery, enabled: !range })
	const briefing = range ? undefined : missionById(party.data?.mission.id ?? '')

	useEffect(() => {
		let game: GameHandle | null = null
		let cancelled = false
		void (async () => {
			try {
				const issued = range ? await fetchRangeTicket() : await fetchTicket()
				if (!issued) {
					// no mission to join (it ended, or the squad never deployed)
					if (!cancelled) void navigate({ to: '/play/lobby' })
					return
				}
				const { ticket, path } = issued
				const map = range ? 'range' : (missionById(issued.mission?.id ?? '')?.map ?? 'yard')
				// the engine and its assets load only now, never on the landing page or lobby
				const { startGame } = await import('@rotline/client')
				if (cancelled || !canvasRef.current) return
				const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
				game = startGame({
					canvas: canvasRef.current,
					url: `${protocol}//${location.host}${path}`,
					ticket,
					assets: '/assets',
					map
				})
				setHandle(game)
				await game.ready
				if (!cancelled) setLoaded(true)
			} catch {
				if (!cancelled) setFailed(true)
			}
		})()
		return () => {
			cancelled = true
			game?.stop()
		}
	}, [navigate, range])

	const [menuOpen, setMenuOpen] = useState(false)
	// the pause menu: Esc opens and closes it (alone in the room the game really pauses)
	useEffect(() => {
		handle?.menu(menuOpen)
	}, [handle, menuOpen])
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.code === 'Escape') setMenuOpen(open => !open)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	const ended =
		!hud?.results &&
		(failed ||
			hud?.status === 'disconnected' ||
			hud?.status === 'kicked' ||
			hud?.status === 'over' ||
			hud?.status === 'elsewhere' ||
			hud?.status === 'outdated')
	const inMission = hud?.mission !== null && hud?.mission !== undefined

	return (
		<div className="fixed inset-0 select-none overflow-hidden bg-rot-black">
			<canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" aria-label="Game" />
			<SeatKeeper />

			{!loaded && !ended && (
				<div className="absolute inset-0 grid place-items-center bg-rot-black">
					<div className="flex max-w-2xl flex-col items-center gap-4 px-6 text-center">
						<img src="/brand/svg/rotline-mark.svg" alt="" width={72} height={72} className="animate-pulse" />
						<p className="font-display text-3xl uppercase tracking-wider">{t.loading}</p>
						{briefing && (
							<div className="flex flex-col gap-3">
								<p className="font-display text-5xl text-rot-lime uppercase">{briefing.name}</p>
								{(briefing.briefing ?? [briefing.description]).map(paragraph => (
									<p key={paragraph} className="text-bone/85 leading-relaxed">
										{paragraph}
									</p>
								))}
							</div>
						)}
					</div>
				</div>
			)}

			{hud && loaded && (
				<>
					{range && handle && <RangePanel handle={handle} hud={hud} />}
					{!range && <Multiplier hud={hud} round={inMission ? null : hud.wave} />}
					<ObjectiveTracker hud={hud} />
					<Waypoint hud={hud} />
					<BossBar hud={hud} />
					<Radio hud={hud} />
					<Toasts hud={hud} />
					{hud.teammates.length > 0 && (
						<ul className="pointer-events-none absolute top-16 left-4 flex flex-col gap-2">
							{hud.teammates.map(mate => (
								<li
									key={mate.slot}
									className={cn(
										'frame cut-sm flex min-w-52 flex-col gap-1 px-3 py-2 [--frame-fill:rgb(13_16_14/0.8)]',
										mate.downed && '[--frame-color:var(--color-alert)]'
									)}
								>
									<span className="flex items-center justify-between gap-3 text-sm">
										<span className="truncate font-bold">{mate.name}</span>
										<span className={cn('text-xs uppercase tracking-wider', mate.downed ? 'text-alert' : 'text-muted')}>
											{!mate.connected
												? t.disconnected
												: mate.out
													? t.teammateOut
													: mate.downed
														? format(t.teammateDown, { seconds: String(mate.bleedoutSeconds) })
														: `${mate.health}`}
										</span>
									</span>
									<span className="h-1.5 bg-surface-raised">
										<span
											className={cn('block h-full', mate.downed ? 'bg-rot-lime' : 'bg-bone')}
											style={{ width: `${(mate.downed ? mate.revive : mate.health / 100) * 100}%` }}
										/>
									</span>
								</li>
							))}
						</ul>
					)}

					{!hud.reviveHint && hud.interactHint && hud.status === 'playing' && (
						<p className="pointer-events-none absolute top-[58%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 bg-rot-black/80 px-3 py-1 font-bold text-rot-lime uppercase tracking-widest">
							<span>{t.interact[hud.interactHint.action]}</span>
							{hud.interactHint.progress > 0 && (
								<span className="h-1 w-40 bg-surface-raised" aria-hidden="true">
									<span className="block h-full bg-rot-lime" style={{ width: `${hud.interactHint.progress * 100}%` }} />
								</span>
							)}
						</p>
					)}

					{hud.reviveHint && hud.status === 'playing' && (
						<p className="pointer-events-none absolute top-[58%] left-1/2 -translate-x-1/2 bg-rot-black/80 px-3 py-1 font-bold text-rot-lime uppercase tracking-widest">
							{format(t.reviveHint, { name: hud.reviveHint })}
						</p>
					)}

					{hud.banner && performance.now() - hud.banner.at < 2500 && (
						<p
							className={cn(
								'pointer-events-none absolute top-36 left-1/2 -translate-x-1/2 font-display text-4xl uppercase',
								hud.banner.text === 'wipe'
									? 'text-alert'
									: hud.banner.text === 'wave'
										? 'text-warning'
										: 'text-rot-lime'
							)}
							aria-live="polite"
						>
							{hud.banner.text === 'wave'
								? format(t.waveBanner, { wave: String(hud.banner.wave) })
								: hud.banner.text === 'wipe'
									? inMission
										? t.missionWipeBanner
										: format(t.wipeBanner, { wave: String(hud.banner.wave) })
									: hud.banner.text === 'objective'
										? t.objectiveBanner
										: hud.banner.text === 'checkpoint'
											? t.checkpointBanner
											: hud.banner.text === 'failed'
												? t.failedBanner
												: hud.banner.text === 'run-over'
													? format(t.runOverBanner, { wave: String(hud.banner.wave) })
													: t.completeBanner}
						</p>
					)}

					<div className="frame cut pointer-events-none absolute bottom-6 left-6 p-4 [--frame-fill:rgb(13_16_14/0.85)]">
						<HealthBar health={hud.health} max={hud.maxHealth} />
					</div>

					<div className="pointer-events-none absolute right-6 bottom-6">
						<Weapons hud={hud} />
					</div>

					<div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
						<Abilities hud={hud} />
					</div>

					{range && (
						<p className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 font-display text-3xl text-warning uppercase">
							{en.app.range.title}
						</p>
					)}

					<div className="absolute top-4 left-4 flex items-center gap-3">
						<Button variant="secondary" size="sm" onClick={() => setMenuOpen(true)}>
							{t.menu}
						</Button>
						<span className="text-muted text-xs tabular-nums">
							{format(t.ping, { ms: String(hud.pingMs) })} · {format(t.fps, { fps: String(hud.fps) })}
						</span>
					</div>

					<p className="pointer-events-none absolute right-0 bottom-1 left-0 text-center text-[11px] text-muted/70 uppercase tracking-[0.2em]">
						{t.controls}
					</p>

					{hud.status === 'down' && (
						<div className="pointer-events-none absolute inset-0 grid place-items-center bg-alert/10">
							<div className="hazard cut px-1 py-1 [--hazard-a:var(--color-alert)]">
								<div className="cut flex flex-col items-center bg-rot-black px-10 py-6">
									<p className="font-display text-5xl text-alert uppercase">{t.down}</p>
									<p className="text-bone/80 tabular-nums" aria-live="polite">
										{hud.beingRevived > 0
											? `${t.beingRevived} ${Math.round(hud.beingRevived * 100)} %`
											: format(t.bleedout, { seconds: String(hud.bleedoutSeconds) })}
									</p>
									<p className="text-muted text-sm">{t.waitForRevive}</p>
								</div>
							</div>
						</div>
					)}
				</>
			)}

			{hud && loaded && hud.status === 'out' && (
				<div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center">
					<div className="cut flex flex-col items-center bg-rot-black/85 px-10 py-5">
						<p className="font-display text-4xl text-muted uppercase">{t.out}</p>
						<p className="text-bone/80 tabular-nums" aria-live="polite">
							{hud.respawnSeconds > 0
								? format(t.backIn, { seconds: String(hud.respawnSeconds) })
								: inMission
									? t.outCheckpoint
									: t.outBack}
						</p>
					</div>
				</div>
			)}

			{menuOpen && hud && handle && loaded && !hud.results && !ended && (
				<PauseMenu
					handle={handle}
					range={range}
					squad={hud.teammates.length > 0}
					onResume={() => setMenuOpen(false)}
					onLobby={() => void navigate({ to: '/play/lobby' })}
					onAbandon={() => {
						void partyActions.abandon().then(result => {
							// the lobby shows the squad as it is now, not the mission it just left
							if (!('error' in result)) queryClient.setQueryData(partyQuery.queryKey, result)
							return navigate({ to: '/play/lobby' })
						})
					}}
				/>
			)}

			{hud?.results && <ResultsPanel results={hud.results} onDone={() => void navigate({ to: '/play/lobby' })} />}

			{ended && (
				<div className="absolute inset-0 grid place-items-center bg-rot-black/80">
					<Panel className="w-full max-w-sm [--frame-color:var(--color-alert)]">
						<PanelTitle>
							{hud?.status === 'outdated'
								? t.outdated
								: hud?.status === 'over'
									? t.over
									: hud?.status === 'elsewhere'
										? t.elsewhere
										: hud?.status === 'kicked'
											? t.kicked
											: t.lost}
						</PanelTitle>
						{hud?.status === 'outdated' ? (
							<Button onClick={() => location.reload()}>{t.reload}</Button>
						) : (
							<Button onClick={() => void navigate({ to: '/play/lobby' })}>{t.backToLobby}</Button>
						)}
					</Panel>
				</div>
			)}
		</div>
	)
}
