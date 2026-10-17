import { useState } from 'react'
import { type DifficultyId, difficulties, missions, SURVIVAL } from '@rotline/game-data'
import { Badge, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { bestOf, missionsQuery, type PartyProblem, type PartyView, partyActions, partyQuery } from '../../lib/party.ts'

const t = en.app.missions

/** "8:00" from seconds or milliseconds. */
export function clock(seconds: number): string {
	const whole = Math.max(0, Math.round(seconds))
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export const masteryTone = ['muted', 'warning', 'bone', 'lime'] as const

/** The leader picks the next mission and its difficulty; everyone else sees the choice. */
export function MissionPanel({ view }: { view: PartyView }) {
	const records = useQuery(missionsQuery)
	const queryClient = useQueryClient()
	const [problem, setProblem] = useState<PartyProblem | null>(null)
	const leader = view.leader === view.you
	const editable = leader && view.state === 'lobby'
	const survival = view.mission.id === SURVIVAL

	async function choose(mission: string, difficulty: DifficultyId) {
		setProblem(null)
		const result = await partyActions.mission(mission, difficulty)
		if ('error' in result) setProblem(result.error)
		else queryClient.setQueryData(partyQuery.queryKey, result)
	}

	return (
		<Panel>
			<PanelHeader>
				<PanelTitle>{t.title}</PanelTitle>
				{!leader && <span className="text-muted text-sm">{t.leaderChooses}</span>}
			</PanelHeader>
			<ul className="grid gap-3 md:grid-cols-2">
				{missions.map(mission => {
					const chosen = view.mission.id === mission.id
					const record = bestOf(records.data?.find(entry => entry.id === mission.id))
					return (
						<li key={mission.id}>
							<button
								type="button"
								aria-pressed={chosen}
								disabled={!editable}
								onClick={() => void choose(mission.id, view.mission.difficulty)}
								className={cn(
									'frame cut flex h-full w-full flex-col gap-2 p-4 text-left',
									chosen
										? '[--frame-color:var(--color-rot-lime)]'
										: editable && 'hover:[--frame-color:var(--color-bone)]',
									!editable && !chosen && 'opacity-60'
								)}
							>
								<span className="flex items-start justify-between gap-3">
									<span className="font-display text-2xl uppercase">{mission.name}</span>
									<Badge tone={masteryTone[record.mastery] ?? 'muted'}>{t.mastery[record.mastery]}</Badge>
								</span>
								<span className="text-bone/80 text-sm">{mission.description}</span>
								<span className="flex flex-wrap gap-x-4 gap-y-1 text-muted text-xs uppercase tracking-wider">
									<span>{format(t.recommended, { level: String(mission.recommendedLevel) })}</span>
									<span>{format(t.par, { time: clock(mission.parTimeSeconds) })}</span>
									<span>{format(t.objectives, { count: String(mission.objectives.length) })}</span>
									{record.bestTimeMs ? <span>{format(t.best, { time: clock(record.bestTimeMs / 1000) })}</span> : null}
								</span>
							</button>
						</li>
					)
				})}
				<li>
					<button
						type="button"
						aria-pressed={survival}
						disabled={!editable}
						onClick={() => void choose(SURVIVAL, view.mission.difficulty)}
						className={cn(
							'frame cut flex h-full w-full flex-col gap-2 p-4 text-left',
							survival
								? '[--frame-color:var(--color-rot-lime)]'
								: editable && 'hover:[--frame-color:var(--color-bone)]',
							!editable && !survival && 'opacity-60'
						)}
					>
						<span className="flex items-start justify-between gap-3">
							<span className="font-display text-2xl uppercase">{t.survival}</span>
							<Badge tone="alert">{t.endless}</Badge>
						</span>
						<span className="text-bone/80 text-sm">{t.survivalDescription}</span>
					</button>
				</li>
			</ul>
			<fieldset className={cn('flex flex-col gap-2', survival && 'hidden')}>
				<legend className="mb-2 font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.difficulty}</legend>
				<div className="grid grid-cols-2 gap-2 md:grid-cols-4">
					{difficulties.tiers.map(tier => {
						const chosen = view.mission.difficulty === tier.id
						return (
							<button
								key={tier.id}
								type="button"
								aria-pressed={chosen}
								disabled={!editable}
								onClick={() => void choose(view.mission.id, tier.id)}
								className={cn(
									'frame cut-sm flex flex-col items-start gap-0.5 px-3 py-2 text-left',
									chosen
										? '[--frame-color:var(--color-rot-lime)]'
										: editable && 'hover:[--frame-color:var(--color-bone)]',
									!editable && !chosen && 'opacity-60'
								)}
							>
								<span className="font-bold uppercase tracking-wide">{tier.name}</span>
								<span className="text-muted text-xs">{format(t.rewards, { times: String(tier.rewards) })}</span>
							</button>
						)
					})}
				</div>
			</fieldset>
			{problem && (
				<p role="alert" className="text-alert text-sm">
					{en.app.lobby.problems[problem]}
				</p>
			)}
		</Panel>
	)
}
