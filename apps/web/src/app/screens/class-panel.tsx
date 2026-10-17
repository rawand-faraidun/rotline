import { useState } from 'react'
import { item } from '@rotline/game-data'
import { cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { partyQuery } from '../../lib/party.ts'
import { type ClassName, type ProgressProblem, progressActions, progressQuery, runAction } from '../../lib/progress.ts'
import { CharacterViewer } from './model-viewer.tsx'

const t = en.app.progression

/** The three classes with their levels; picking one makes it the class for the next mission. */
export function ClassPanel() {
	const progress = useQuery(progressQuery)
	const queryClient = useQueryClient()
	const [problem, setProblem] = useState<ProgressProblem | null>(null)
	const view = progress.data
	if (!view) return null
	return (
		<Panel>
			<PanelHeader>
				<PanelTitle>{t.classTitle}</PanelTitle>
			</PanelHeader>
			<CharacterViewer
				classId={view.activeClass}
				label={format(t.characterOf, { name: t.classes[view.activeClass].name })}
			/>
			<ul className="flex flex-col gap-2">
				{(['assault', 'medic', 'heavy'] as const satisfies readonly ClassName[]).map(cls => {
					const entry = view.classes[cls]
					const active = view.activeClass === cls
					const share = entry.next ? entry.into / entry.next : 1
					return (
						<li key={cls}>
							<button
								type="button"
								aria-pressed={active}
								disabled={active}
								onClick={async () => {
									setProblem(null)
									const refusal = await runAction(queryClient, progressActions.setClass(cls))
									if (refusal) setProblem(refusal.error)
									else void queryClient.invalidateQueries({ queryKey: partyQuery.queryKey })
								}}
								className={cn(
									'frame cut flex w-full cursor-pointer flex-col gap-2 p-3 text-left disabled:cursor-default',
									active
										? '[--frame-color:var(--color-rot-lime)]'
										: '[--frame-fill:var(--color-rot-black)] hover:[--frame-color:var(--color-bone)]'
								)}
							>
								<span className="flex items-baseline justify-between gap-3">
									<span className="font-bold uppercase tracking-[0.12em]">{t.classes[cls].name}</span>
									<span className={cn('font-display text-xl', active ? 'text-rot-lime' : 'text-bone')}>
										{format(t.level, { level: String(entry.level) })}
									</span>
								</span>
								<span className="text-muted text-xs">{active ? t.activeClass : t.classes[cls].role}</span>
								<span className="h-1.5 w-full bg-rot-black" aria-hidden="true">
									<span className="block h-full bg-rot-lime" style={{ width: `${Math.round(share * 100)}%` }} />
								</span>
								<span className="text-muted text-xs tabular-nums">
									{entry.next
										? format(t.xp, { into: entry.into.toLocaleString('en'), next: entry.next.toLocaleString('en') })
										: t.maxLevel}
								</span>
							</button>
						</li>
					)
				})}
			</ul>
			{problem && (
				<p role="alert" className="text-alert text-sm">
					{t.problems[problem]}
				</p>
			)}
		</Panel>
	)
}

/** What the player takes into the next mission, with a link to change it. */
export function LoadoutSummary() {
	const progress = useQuery(progressQuery)
	const view = progress.data
	if (!view) return null
	const levels = new Map(view.inventory.map(entry => [entry.itemId, entry.level]))
	const slots = [
		view.loadout.main1,
		view.loadout.main2,
		view.loadout.pistol,
		view.loadout.armour,
		view.loadout.utility1,
		view.loadout.utility2
	].filter((id): id is string => id !== null)
	return (
		<Panel>
			<PanelHeader>
				<PanelTitle>{t.loadoutTitle}</PanelTitle>
				<Link to="/play/armory" className="font-bold text-rot-lime text-xs uppercase tracking-[0.2em] hover:text-bone">
					{t.nav.armory}
				</Link>
			</PanelHeader>
			<ul className="flex flex-col gap-1.5">
				{slots.map(id => (
					<li key={id} className="flex items-baseline justify-between gap-3">
						<span className="truncate font-bold">{item(id).name}</span>
						<span className="text-muted text-xs tabular-nums">
							{format(en.app.armory.level, { level: String(levels.get(id) ?? 0), max: '10' })}
						</span>
					</li>
				))}
			</ul>
		</Panel>
	)
}
