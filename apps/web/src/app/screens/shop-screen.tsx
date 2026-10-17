import { useEffect, useRef, useState } from 'react'
import { type ItemSlot, items, weapons } from '@rotline/game-data'
import { Badge, Button, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { salvage } from '../../lib/describe.ts'
import { itemStatRows } from '../../lib/item-stats.ts'
import { type ProgressProblem, progressActions, progressQuery, runAction } from '../../lib/progress.ts'
import { GameShell } from './game-shell.tsx'
import { scroller } from './layout.ts'
import { WeaponViewer } from './model-viewer.tsx'

const t = en.app.shop
const p = en.app.progression
const GROUPS: ItemSlot[] = ['main', 'pistol', 'armour', 'utility']

/** Every item at a fixed, visible price. Nothing random is ever sold. */
export function ShopScreen() {
	const progress = useQuery(progressQuery)
	const queryClient = useQueryClient()
	const [confirming, setConfirming] = useState<string | null>(null)
	const [problem, setProblem] = useState<ProgressProblem | null>(null)
	const [inspecting, setInspecting] = useState<string | null>(null)
	const view = progress.data
	if (!view) return <GameShell>{null}</GameShell>
	const owned = new Set(view.inventory.map(entry => entry.itemId))

	return (
		<GameShell>
			<h1 className="mb-2 font-display text-5xl uppercase md:text-6xl">{t.title}</h1>
			<p className="mb-8 text-muted">{t.intro}</p>
			{problem && (
				<p role="alert" className="mb-4 text-alert text-sm">
					{p.problems[problem]}
				</p>
			)}
			<div className={cn(scroller, 'flex flex-col gap-8')}>
				{GROUPS.map(group => (
					<section key={group} className="flex flex-col gap-3">
						<h2 className="font-display text-2xl uppercase">{t.categories[group]}</h2>
						<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{items
								.filter(entry => entry.slot === group)
								.sort((a, b) => a.price - b.price)
								.map(entry => {
									const has = owned.has(entry.id)
									const affordable = view.salvage >= entry.price
									const weapon = weapons.find(candidate => candidate.id === entry.id)
									return (
										<li key={entry.id} data-testid={`shop-${entry.id}`}>
											<Panel className={cn('h-full gap-3 p-4', has && 'opacity-70')}>
												<PanelHeader>
													<PanelTitle className="text-lg">{entry.name}</PanelTitle>
													{has && <Badge tone="lime">{t.owned}</Badge>}
												</PanelHeader>
												<div className="flex items-center justify-between gap-2">
													<p className="text-muted text-xs uppercase tracking-[0.16em]">
														{weapon ? p.kinds[weapon.kind] : p.slotNames[entry.slot]}
													</p>
													{weapon && (
														<Button size="sm" variant="ghost" onClick={() => setInspecting(entry.id)}>
															{t.inspect}
														</Button>
													)}
												</div>
												<dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
													{itemStatRows(entry.id, 0, []).map(row => (
														<div key={row.key} className="contents">
															<dt className="text-muted">{row.label}</dt>
															<dd className="text-right font-bold tabular-nums">{row.value}</dd>
														</div>
													))}
												</dl>
												<div className="mt-auto flex items-center justify-between gap-2 pt-2">
													<span className="font-display text-2xl text-rot-lime tabular-nums">
														{salvage(entry.price)}
													</span>
													{!has &&
														(confirming === entry.id ? (
															<span className="flex gap-1">
																<Button
																	size="sm"
																	onClick={async () => {
																		setConfirming(null)
																		setProblem(
																			(await runAction(queryClient, progressActions.buy(entry.id)))?.error ?? null
																		)
																	}}
																>
																	{format(t.confirmBuy, { price: salvage(entry.price) })}
																</Button>
																<Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
																	{p.cancel}
																</Button>
															</span>
														) : (
															<Button
																size="sm"
																variant="secondary"
																disabled={!affordable}
																onClick={() => setConfirming(entry.id)}
															>
																{t.buy}
															</Button>
														))}
												</div>
											</Panel>
										</li>
									)
								})}
						</ul>
					</section>
				))}
			</div>
			{inspecting && <Inspector id={inspecting} onClose={() => setInspecting(null)} />}
		</GameShell>
	)
}

/** One weapon's model in a modal window: only one 3D view is ever live in the shop. */
function Inspector({ id, onClose }: { id: string; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null)
	const item = items.find(entry => entry.id === id)
	useEffect(() => {
		dialog.current?.showModal()
	}, [])
	if (!item) return null
	return (
		<dialog
			ref={dialog}
			aria-label={item.name}
			onClose={onClose}
			className="m-auto w-full max-w-2xl bg-transparent p-4 backdrop:bg-black/70"
		>
			<Panel className="gap-3 p-4">
				<PanelHeader>
					<PanelTitle className="text-lg">{item.name}</PanelTitle>
					<Button size="sm" variant="ghost" onClick={() => dialog.current?.close()}>
						{t.close}
					</Button>
				</PanelHeader>
				<WeaponViewer id={id} label={format(en.app.armory.modelOf, { name: item.name })} />
			</Panel>
		</dialog>
	)
}
