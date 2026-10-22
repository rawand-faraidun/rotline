import { useState } from 'react'
import { ARMOUR_PIECES, items, weapons } from '@rotline/game-data'
import { Badge, Button, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { salvage } from '../../lib/describe.ts'
import { itemStatRows } from '../../lib/item-stats.ts'
import { type ProgressProblem, progressActions, progressQuery, runAction } from '../../lib/progress.ts'
import { TABS, type Tab } from './armory-screen.tsx'
import { itemPicture } from './character-stage.tsx'
import { GameShell } from './game-shell.tsx'
import { scroller } from './layout.ts'
import { PageHeader } from './page-header.tsx'

const t = en.app.shop
const p = en.app.progression

/** Every item at a fixed, visible price. Nothing random is ever sold. */
export function ShopScreen() {
	const progress = useQuery(progressQuery)
	const queryClient = useQueryClient()
	const [confirming, setConfirming] = useState<string | null>(null)
	const [problem, setProblem] = useState<ProgressProblem | null>(null)
	const opened = useSearch({ strict: false }) as { tab?: Tab }
	const [tab, setTab] = useState<Tab>(opened.tab ?? 'weapons')
	const view = progress.data
	if (!view) return <GameShell>{null}</GameShell>
	const owned = new Set(view.inventory.map(entry => entry.itemId))
	// the tab's sections: weapons by slot, armour by where it is worn, utilities as one
	const sections: { key: string; title: string; ids: string[] }[] =
		tab === 'armour'
			? ARMOUR_PIECES.map(piece => ({
					key: piece,
					title: p.pieces[piece],
					ids: items.filter(entry => entry.slot === 'armour' && entry.piece === piece).map(entry => entry.id)
				}))
			: TABS[tab].slots.map(slot => ({
					key: slot,
					title: t.categories[slot],
					ids: items.filter(entry => entry.slot === slot).map(entry => entry.id)
				}))

	return (
		<GameShell>
			<PageHeader title={t.title}>
				<p className="text-muted text-sm">{t.intro}</p>
			</PageHeader>
			{problem && (
				<p role="alert" className="mb-4 text-alert text-sm">
					{p.problems[problem]}
				</p>
			)}
			<div className="mb-4 flex shrink-0 gap-1" role="tablist" aria-label={en.app.armory.tabsLabel}>
				{(Object.keys(TABS) as Tab[]).map(key => (
					<button
						key={key}
						type="button"
						role="tab"
						aria-selected={tab === key}
						onClick={() => setTab(key)}
						className={cn(
							'frame cut-sm min-w-32 px-4 py-2.5 font-bold text-xs uppercase tracking-[0.2em]',
							tab === key
								? 'text-rot-lime [--frame-color:var(--color-rot-lime)]'
								: 'text-muted [--frame-fill:var(--color-rot-black)] hover:text-bone'
						)}
					>
						{t.tabs[key]}
					</button>
				))}
			</div>
			<div className={cn(scroller, 'flex flex-col gap-8')}>
				{sections.map(section => (
					<section key={section.key} className="flex flex-col gap-3">
						<h2 className="font-display text-2xl uppercase">{section.title}</h2>
						<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{items
								.filter(entry => section.ids.includes(entry.id))
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
												{itemPicture(entry.id) && (
													<img
														src={itemPicture(entry.id) ?? ''}
														alt=""
														width={480}
														height={270}
														loading="lazy"
														className="aspect-[16/9] w-full object-contain"
													/>
												)}
												<div className="flex items-center justify-between gap-2">
													<p className="text-muted text-xs uppercase tracking-[0.16em]">
														{weapon
															? p.kinds[weapon.kind]
															: entry.piece
																? p.pieces[entry.piece]
																: p.slotNames[entry.slot]}
													</p>
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
													<span className="flex flex-col">
														<span className="font-display text-2xl text-rot-lime tabular-nums">
															{salvage(entry.price)}
														</span>
														{!has && !affordable && (
															<span className="text-muted text-xs">
																{format(t.needMore, { amount: salvage(entry.price - view.salvage) })}
															</span>
														)}
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
		</GameShell>
	)
}
