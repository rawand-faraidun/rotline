import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GameHandle, HudState } from '@rotline/client'
import { Badge, Button, cn, Panel, PanelTitle } from '@rotline/ui'
import { useNavigate } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { fetchTicket, usePlayerEvents } from '../../lib/party.ts'

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

export function MissionScreen() {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [handle, setHandle] = useState<GameHandle | null>(null)
	const [loaded, setLoaded] = useState(false)
	const [failed, setFailed] = useState(false)
	const navigate = useNavigate()
	const hud = useHud(handle)
	usePlayerEvents()

	useEffect(() => {
		let game: GameHandle | null = null
		let cancelled = false
		void (async () => {
			try {
				const issued = await fetchTicket()
				if (!issued) {
					// no mission to join (it ended, or the squad never deployed)
					if (!cancelled) void navigate({ to: '/play/lobby' })
					return
				}
				const { ticket, path } = issued
				// the engine and its assets load only now, never on the landing page or lobby
				const { startGame } = await import('@rotline/client')
				if (cancelled || !canvasRef.current) return
				const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
				game = startGame({
					canvas: canvasRef.current,
					url: `${protocol}//${location.host}${path}`,
					ticket,
					assets: '/assets'
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
	}, [navigate])

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.code === 'Escape') void navigate({ to: '/play/lobby' })
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [navigate])

	const ended = failed || hud?.status === 'disconnected' || hud?.status === 'kicked'

	return (
		<div className="fixed inset-0 select-none overflow-hidden bg-rot-black">
			<canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" aria-label="Game" />

			{!loaded && !ended && (
				<div className="absolute inset-0 grid place-items-center bg-rot-black">
					<div className="flex flex-col items-center gap-4">
						<img src="/brand/svg/rotline-mark.svg" alt="" width={72} height={72} className="animate-pulse" />
						<p className="font-display text-3xl uppercase tracking-wider">{t.loading}</p>
					</div>
				</div>
			)}

			{hud && loaded && (
				<>
					<div className="pointer-events-none absolute top-4 left-1/2 flex -translate-x-1/2 items-stretch gap-3">
						{[
							[t.wave, hud.wave],
							[t.kills, hud.kills],
							[t.score, hud.score]
						].map(([label, value]) => (
							<div
								key={label}
								className="frame cut-sm flex min-w-24 flex-col items-center px-4 py-1.5 [--frame-fill:rgb(13_16_14/0.8)]"
							>
								<span className="font-bold text-[10px] text-muted uppercase tracking-[0.25em]">{label}</span>
								<span className="font-display text-2xl tabular-nums">{value}</span>
							</div>
						))}
					</div>

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

					{hud.reviveHint && hud.status === 'playing' && (
						<p className="pointer-events-none absolute top-[58%] left-1/2 -translate-x-1/2 bg-rot-black/80 px-3 py-1 font-bold text-rot-lime uppercase tracking-widest">
							{format(t.reviveHint, { name: hud.reviveHint })}
						</p>
					)}

					{hud.banner && performance.now() - hud.banner.at < 2500 && (
						<p
							className={cn(
								'pointer-events-none absolute top-28 left-1/2 -translate-x-1/2 font-display text-4xl uppercase',
								hud.banner.text === 'wipe' ? 'text-alert' : 'text-warning'
							)}
							aria-live="polite"
						>
							{format(hud.banner.text === 'wipe' ? t.wipeBanner : t.waveBanner, { wave: String(hud.banner.wave) })}
						</p>
					)}

					<div className="frame cut pointer-events-none absolute bottom-6 left-6 p-4 [--frame-fill:rgb(13_16_14/0.85)]">
						<HealthBar health={hud.health} max={hud.maxHealth} />
					</div>

					<div className="pointer-events-none absolute right-6 bottom-6">
						<Weapons hud={hud} />
					</div>

					<div className="absolute top-4 left-4 flex items-center gap-3">
						<Button variant="secondary" size="sm" onClick={() => void navigate({ to: '/play/lobby' })}>
							{t.leave}
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
							{hud.respawnSeconds > 0 ? format(t.backIn, { seconds: String(hud.respawnSeconds) }) : t.outBack}
						</p>
					</div>
				</div>
			)}

			{ended && (
				<div className="absolute inset-0 grid place-items-center bg-rot-black/80">
					<Panel className="w-full max-w-sm [--frame-color:var(--color-alert)]">
						<PanelTitle>{hud?.status === 'kicked' ? t.kicked : t.lost}</PanelTitle>
						<Button onClick={() => void navigate({ to: '/play/lobby' })}>{t.backToLobby}</Button>
					</Panel>
				</div>
			)}
		</div>
	)
}
