import { useState } from 'react'
import { item } from '@rotline/game-data'
import { cn } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { partyQuery } from '../../lib/party.ts'
import { type ClassName, type ProgressProblem, progressActions, progressQuery, runAction } from '../../lib/progress.ts'

const t = en.app.progression
const CLASSES = ['assault', 'medic', 'heavy'] as const satisfies readonly ClassName[]

/** Glass for menus laid over the lobby scene. */
export const glass = '[--frame-fill:rgb(13_16_14/0.74)] backdrop-blur-sm'

/**
 * The three classes under the soldier in the lobby, with their levels and progress; picking one
 * makes it the class for the next mission (the soldier changes with it).
 */
export function ClassPanel() {
	const progress = useQuery(progressQuery)
	const queryClient = useQueryClient()
	const [problem, setProblem] = useState<ProgressProblem | null>(null)
	const view = progress.data
	if (!view) return null
	return (
		<div className="flex flex-col items-center gap-2">
			<h2 className="sr-only">{t.classTitle}</h2>
			<ul className="grid w-full max-w-xl grid-cols-3 gap-2">
				{CLASSES.map(cls => {
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
									'frame cut flex w-full cursor-pointer flex-col gap-1.5 px-3 py-2 text-left disabled:cursor-default',
									glass,
									active ? '[--frame-color:var(--color-rot-lime)]' : 'hover:[--frame-color:var(--color-bone)]'
								)}
							>
								<span className="flex items-baseline justify-between gap-2">
									<span className="font-bold uppercase tracking-[0.12em]">{t.classes[cls].name}</span>
									<span className={cn('font-display text-lg', active ? 'text-rot-lime' : 'text-bone')}>
										{format(t.level, { level: String(entry.level) })}
									</span>
								</span>
								<span className="h-1 w-full bg-rot-black" aria-hidden="true">
									<span className="block h-full bg-rot-lime" style={{ width: `${Math.round(share * 100)}%` }} />
								</span>
								<span className="truncate text-muted text-xs">{active ? t.activeClass : t.classes[cls].role}</span>
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
		</div>
	)
}

/** What the player takes into the next mission, as a strip of names, with a way to change it. */
export function LoadoutSummary() {
	const progress = useQuery(progressQuery)
	const view = progress.data
	if (!view) return null
	const slots = [
		view.loadout.main1,
		view.loadout.main2,
		view.loadout.pistol,
		view.loadout.armour,
		view.loadout.utility1,
		view.loadout.utility2
	].filter((id): id is string => id !== null)
	return (
		<div className="flex flex-wrap items-center justify-center gap-1.5">
			<h2 className="sr-only">{t.loadoutTitle}</h2>
			{slots.map(id => (
				<span key={id} className={cn('frame cut-sm px-2 py-1 font-bold text-xs uppercase tracking-wider', glass)}>
					{item(id).name}
				</span>
			))}
			<Link
				to="/play/armory"
				className="px-2 py-1 font-bold text-rot-lime text-xs uppercase tracking-[0.2em] hover:text-bone"
			>
				{t.nav.armory}
			</Link>
		</div>
	)
}
