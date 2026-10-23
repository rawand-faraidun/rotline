import { useState } from 'react'
import { campaign, type DifficultyId, difficulties, type MissionDef, missionById, SURVIVAL } from '@rotline/game-data'
import { Badge, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import {
	bestOf,
	type MissionRecord,
	missionsQuery,
	type PartyProblem,
	type PartyView,
	partyActions,
	partyQuery
} from '../../lib/party.ts'

const t = en.app.missions

/** "8:00" from seconds or milliseconds. */
export function clock(seconds: number): string {
	const whole = Math.max(0, Math.round(seconds))
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export const masteryTone = ['muted', 'warning', 'bone', 'lime'] as const

/** The two places to choose from: the campaign, and the game modes beside it. */
export type MissionTab = 'campaign' | 'modes'

/** Is this a game mode (Survival or a contract) rather than a campaign mission? */
export const isMode = (id: string) => id === SURVIVAL || (campaign.contracts ?? []).includes(id)

/** One mission or contract to pick: its name, what it is, its numbers and the squad's record on it. */
function MissionCard({
	mission,
	number,
	open,
	chosen,
	editable,
	entry,
	onChoose
}: {
	mission: MissionDef
	number?: number | undefined
	open: boolean
	chosen: boolean
	editable: boolean
	entry: MissionRecord | undefined
	onChoose: () => void
}) {
	const record = bestOf(entry)
	return (
		<li>
			<button
				type="button"
				aria-pressed={chosen}
				disabled={!editable || !open}
				onClick={onChoose}
				className={cn(
					'frame cut flex h-full w-full flex-col gap-2 p-4 text-left',
					chosen
						? '[--frame-color:var(--color-rot-lime)]'
						: editable && open && 'hover:[--frame-color:var(--color-bone)]',
					(!open || (!editable && !chosen)) && 'opacity-50'
				)}
			>
				<span className="flex items-start justify-between gap-3">
					<span className="font-display text-2xl uppercase">
						{number !== undefined && <span className="text-muted">{number}.</span>} {mission.name}
					</span>
					{open ? (
						<Badge tone={masteryTone[record.mastery] ?? 'muted'}>
							{record.mastery === 0 && record.completions > 0 ? t.done : t.mastery[record.mastery]}
						</Badge>
					) : (
						<Badge tone="muted">{t.locked}</Badge>
					)}
				</span>
				<span className="text-bone/80 text-sm">{mission.description}</span>
				<span className="flex flex-wrap gap-x-4 gap-y-1 text-muted text-xs uppercase tracking-wider">
					<span>{format(t.recommended, { level: String(mission.recommendedLevel) })}</span>
					{mission.timeLimitSeconds ? (
						<span>{format(t.timeLimit, { time: clock(mission.timeLimitSeconds) })}</span>
					) : null}
					<span>{format(t.par, { time: clock(mission.parTimeSeconds) })}</span>
					<span>{format(t.objectives, { count: String(mission.objectives.length) })}</span>
					{record.bestTimeMs ? <span>{format(t.best, { time: clock(record.bestTimeMs / 1000) })}</span> : null}
				</span>
				{!open && <span className="text-muted text-xs">{t.lockedHint}</span>}
			</button>
		</li>
	)
}

/** The leader picks the next mission or game mode and its difficulty; everyone else sees the choice. */
export function MissionPanel({ view, tab: initialTab }: { view: PartyView; tab?: MissionTab }) {
	const records = useQuery(missionsQuery)
	const queryClient = useQueryClient()
	const [problem, setProblem] = useState<PartyProblem | null>(null)
	const [tab, setTab] = useState<MissionTab>(initialTab ?? (isMode(view.mission.id) ? 'modes' : 'campaign'))
	const leader = view.leader === view.you
	const editable = leader && view.state === 'lobby'
	const survival = view.mission.id === SURVIVAL

	async function choose(mission: string, difficulty: DifficultyId) {
		setProblem(null)
		const result = await partyActions.mission(mission, difficulty)
		if ('error' in result) setProblem(result.error)
		else queryClient.setQueryData(partyQuery.queryKey, result)
	}

	const card = (id: string, number?: number, firstOpen = false) => {
		const mission = missionById(id)
		if (!mission) return []
		const entry = records.data?.find(record => record.id === mission.id)
		return [
			<MissionCard
				key={mission.id}
				mission={mission}
				number={number}
				// until the records load, only the first mission is known to be open
				open={entry?.open ?? firstOpen}
				chosen={view.mission.id === mission.id}
				editable={editable}
				entry={entry}
				onChoose={() => void choose(mission.id, view.mission.difficulty)}
			/>
		]
	}

	let order = 0
	return (
		<Panel>
			<PanelHeader>
				<PanelTitle>{t.title}</PanelTitle>
				{!leader && <span className="text-muted text-sm">{t.leaderChooses}</span>}
			</PanelHeader>
			<div className="grid grid-cols-2 gap-2" role="tablist" aria-label={t.title}>
				{(['campaign', 'modes'] as const).map(id => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						className={cn(
							'frame cut-sm flex flex-col items-start gap-0.5 px-4 py-3 text-left',
							tab === id
								? '[--frame-color:var(--color-rot-lime)]'
								: 'opacity-70 hover:[--frame-color:var(--color-bone)]'
						)}
					>
						<span className="font-display text-2xl uppercase">{t.tabs[id]}</span>
						<span className="text-muted text-xs">{t.tabHints[id]}</span>
					</button>
				))}
			</div>

			{tab === 'campaign' &&
				campaign.zones.map(zone => (
					<section key={zone.id} className="flex flex-col gap-2">
						<h3 className="font-bold text-muted text-xs uppercase tracking-[0.2em]">
							{format(t.zone, { name: zone.name })} ·{' '}
							<span className="normal-case tracking-normal">{zone.description}</span>
						</h3>
						<ul className="grid gap-3 md:grid-cols-2">
							{zone.missions.flatMap(id => {
								order++
								return card(id, order, order === 1)
							})}
						</ul>
					</section>
				))}

			{tab === 'modes' && (
				<>
					<section className="flex flex-col gap-2">
						<h3 className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.survival}</h3>
						<ul className="grid gap-3">
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
					</section>
					<section className="flex flex-col gap-2">
						<h3 className="font-bold text-muted text-xs uppercase tracking-[0.2em]">
							{t.contracts} · <span className="normal-case tracking-normal">{t.contractsDescription}</span>
						</h3>
						<ul className="grid gap-3 md:grid-cols-2">
							{(campaign.contracts ?? []).flatMap(id => card(id, undefined, true))}
						</ul>
					</section>
				</>
			)}

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
