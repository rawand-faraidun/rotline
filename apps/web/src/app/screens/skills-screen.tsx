import { useState } from 'react'
import {
	abilities,
	allocationProblem,
	type ClassId,
	classes,
	economy,
	pointsAtLevel,
	type SkillNode,
	skillTrees,
	unlockedAbilities
} from '@rotline/game-data'
import { Badge, Button, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { describeEffect, salvage } from '../../lib/describe.ts'
import { type ProgressProblem, progressActions, progressQuery, runAction } from '../../lib/progress.ts'
import { GameShell } from './game-shell.tsx'
import { panes } from './layout.ts'

const t = en.app.skills
const p = en.app.progression
const CLASSES: ClassId[] = ['assault', 'medic', 'heavy']
const TIERS = [1, 2, 3, 4, 5]

function nodeText(node: SkillNode): string[] {
	if (node.kind === 'active' && node.ability) {
		const ability = abilities.find(entry => entry.id === node.ability)
		return [
			p.abilities[node.ability as keyof typeof p.abilities],
			format(t.cooldown, { seconds: String(ability?.cooldownSeconds ?? 0) })
		]
	}
	if (node.kind === 'capstone' && node.special) return [p.specials[node.special as keyof typeof p.specials]]
	return node.effects.map(effect => describeEffect(effect))
}

export function SkillsScreen() {
	const progress = useQuery(progressQuery)
	const queryClient = useQueryClient()
	const [chosenClass, setChosenClass] = useState<ClassId | null>(null)
	const [selected, setSelected] = useState<string | null>(null)
	const [problem, setProblem] = useState<ProgressProblem | null>(null)
	const [confirmRespec, setConfirmRespec] = useState(false)
	// one change at a time: each is computed from the view the last one returned
	const [pending, setPending] = useState(false)
	const view = progress.data
	if (!view) return <GameShell>{null}</GameShell>

	const cls = chosenClass ?? view.activeClass
	const entry = view.classes[cls]
	const tree = skillTrees[cls]
	const left = entry.points - entry.spent
	const selectedNode = tree.branches.flatMap(branch => branch.nodes).find(node => node.id === selected)

	async function act(action: ReturnType<typeof progressActions.learn>) {
		setProblem(null)
		setPending(true)
		try {
			const refusal = await runAction(queryClient, action)
			if (refusal) setProblem(refusal.error)
		} finally {
			setPending(false)
		}
	}

	const learned = unlockedAbilities(entry.skills)
	const slots = Array.from({ length: entry.slots }, (_, index) => entry.abilities[index] ?? '')

	return (
		<GameShell>
			<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
				<h1 className="font-display text-5xl uppercase md:text-6xl">{t.title}</h1>
				<div className="flex flex-wrap gap-2" role="tablist">
					{CLASSES.map(option => (
						<Button
							key={option}
							role="tab"
							aria-selected={option === cls}
							variant={option === cls ? 'primary' : 'secondary'}
							size="sm"
							onClick={() => {
								setChosenClass(option)
								setSelected(null)
								setConfirmRespec(false)
							}}
						>
							{p.classes[option].name} · {view.classes[option].level}
						</Button>
					))}
				</div>
			</div>

			<div className="mb-6 flex flex-wrap items-center gap-4">
				<span className="font-display text-3xl text-rot-lime" data-testid="points-left">
					{format(t.pointsLeft, { points: String(left) })}
				</span>
				<span className="text-muted text-sm">
					{format(p.level, { level: String(entry.level) })} · {pointsAtLevel(entry.level)} /{' '}
					{pointsAtLevel(classes.progression.maxLevel)}
				</span>
				<span className="flex-1" />
				{confirmRespec ? (
					<span className="flex flex-wrap items-center gap-2">
						<span className="text-sm">
							{format(t.respecConfirm, { class: p.classes[cls].name, price: salvage(economy.respecPrice) })}
						</span>
						<Button
							size="sm"
							variant="danger"
							onClick={() => {
								setConfirmRespec(false)
								void act(progressActions.respec(cls))
							}}
						>
							{p.confirm}
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setConfirmRespec(false)}>
							{p.cancel}
						</Button>
					</span>
				) : (
					<Button size="sm" variant="secondary" disabled={entry.spent === 0} onClick={() => setConfirmRespec(true)}>
						{t.respec} · {salvage(economy.respecPrice)}
					</Button>
				)}
			</div>
			{problem && (
				<p role="alert" className="mb-4 text-alert text-sm">
					{p.problems[problem]}
				</p>
			)}

			<div className={cn(panes, 'lg:grid-rows-none xl:grid-cols-[1fr_20rem] xl:grid-rows-[minmax(0,1fr)]')}>
				<div className="grid content-start gap-4 md:grid-cols-3 xl:min-h-0 xl:overflow-y-auto xl:pr-1 xl:pb-6">
					{tree.branches.map(branch => {
						const spentIn = (tier: number) =>
							branch.nodes.filter(node => node.tier < tier).reduce((sum, node) => sum + (entry.skills[node.id] ?? 0), 0)
						return (
							<Panel key={branch.id} className="gap-3 p-4">
								<PanelHeader>
									<PanelTitle className="text-xl">{branch.name}</PanelTitle>
									<span className="font-bold text-muted text-sm tabular-nums">
										{branch.nodes.reduce((sum, node) => sum + (entry.skills[node.id] ?? 0), 0)}
									</span>
								</PanelHeader>
								{TIERS.map(tier => {
									const need = classes.progression.pointsPerTier * (tier - 1) - spentIn(tier)
									return (
										<div key={tier} className={cn('flex flex-col gap-1.5', need > 0 && 'opacity-45')}>
											<span className="flex justify-between font-bold text-[0.65rem] text-muted uppercase tracking-[0.2em]">
												<span>{format(t.tier, { tier: String(tier) })}</span>
												{need > 0 && <span>{format(t.tierLocked, { points: String(need) })}</span>}
											</span>
											<div className="grid grid-cols-2 gap-1.5">
												{branch.nodes
													.filter(node => node.tier === tier)
													.map(node => {
														const rank = entry.skills[node.id] ?? 0
														const open = allocationProblem(cls, entry.skills, entry.level, node.id) === null
														return (
															<button
																key={node.id}
																type="button"
																data-testid={`node-${node.id}`}
																onClick={() => setSelected(node.id)}
																className={cn(
																	'frame cut-sm flex min-h-14 cursor-pointer flex-col justify-between gap-1 px-2 py-1.5 text-left text-xs',
																	'[--frame-fill:var(--color-rot-black)]',
																	rank > 0 &&
																		'[--frame-color:var(--color-rot-lime)] [--frame-fill:var(--color-surface-raised)]',
																	rank === 0 && open && '[--frame-color:var(--color-bone)]',
																	node.kind === 'capstone' && 'col-span-2',
																	selected === node.id && 'outline-2 outline-rot-lime outline-offset-1'
																)}
															>
																<span className="flex items-start justify-between gap-1">
																	<span className={cn('font-bold leading-tight', rank > 0 && 'text-rot-lime')}>
																		{node.name}
																	</span>
																	{node.kind !== 'passive' && (
																		<span
																			className={cn(
																				'mt-0.5 size-2 shrink-0 rotate-45',
																				node.kind === 'active' ? 'bg-warning' : 'bg-alert'
																			)}
																			aria-hidden="true"
																		/>
																	)}
																</span>
																<span className="sr-only">
																	{format(t.rank, { rank: String(rank), max: String(node.maxRank) })}
																</span>
																<span className="flex gap-0.5" aria-hidden="true">
																	{Array.from({ length: node.maxRank }, (_, pip) => (
																		<span
																			// biome-ignore lint/suspicious/noArrayIndexKey: fixed pips
																			key={pip}
																			className={cn('h-1 w-3', pip < rank ? 'bg-rot-lime' : 'bg-line')}
																		/>
																	))}
																</span>
															</button>
														)
													})}
											</div>
										</div>
									)
								})}
							</Panel>
						)
					})}
				</div>

				<div className="flex flex-col gap-6 xl:min-h-0 xl:overflow-y-auto xl:pr-1 xl:pb-6">
					<Panel>
						{selectedNode ? (
							<>
								<PanelHeader>
									<PanelTitle className="text-xl">{selectedNode.name}</PanelTitle>
									<Badge
										tone={
											selectedNode.kind === 'passive' ? 'muted' : selectedNode.kind === 'active' ? 'warning' : 'alert'
										}
									>
										{t[selectedNode.kind]}
									</Badge>
								</PanelHeader>
								<ul className="flex flex-col gap-1">
									{nodeText(selectedNode).map(line => (
										<li key={line} className="text-bone/90">
											{line}
										</li>
									))}
								</ul>
								{selectedNode.maxRank > 1 && <p className="text-muted text-xs">{t.perRank}</p>}
								<p className="font-bold text-muted text-sm">
									{format(t.rank, {
										rank: String(entry.skills[selectedNode.id] ?? 0),
										max: String(selectedNode.maxRank)
									})}
								</p>
								<Button
									disabled={pending || allocationProblem(cls, entry.skills, entry.level, selectedNode.id) !== null}
									onClick={() => void act(progressActions.learn(selectedNode.id))}
								>
									{t.learn}
								</Button>
							</>
						) : (
							<p className="text-muted">{t.selectHint}</p>
						)}
					</Panel>

					<Panel>
						<PanelHeader>
							<PanelTitle className="text-xl">{t.abilitiesTitle}</PanelTitle>
						</PanelHeader>
						<p className="text-muted text-sm">{t.abilitiesHint}</p>
						{slots.map((current, index) => (
							<label
								// biome-ignore lint/suspicious/noArrayIndexKey: slots are positions
								key={index}
								className="flex flex-col gap-1"
							>
								<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">
									{format(t.slot, { slot: String(index + 1) })}
								</span>
								<select
									disabled={pending}
									className="cut-sm h-10 border border-line bg-rot-black px-3 font-bold text-bone"
									value={current}
									onChange={event => {
										const next = [...slots]
										next[index] = event.target.value
										// an ability moved into this slot leaves its old one
										const cleaned = next.map((id, position) =>
											position !== index && id === event.target.value ? '' : id
										)
										void act(progressActions.setAbilities(cls, cleaned.filter(Boolean)))
									}}
								>
									<option value="">{t.emptySlot}</option>
									{learned.map(id => (
										<option key={id} value={id}>
											{abilities.find(ability => ability.id === id)?.name ?? id}
										</option>
									))}
								</select>
							</label>
						))}
						<p className="text-muted text-xs">{t.abilitiesArrive}</p>
					</Panel>
				</div>
			</div>
		</GameShell>
	)
}
