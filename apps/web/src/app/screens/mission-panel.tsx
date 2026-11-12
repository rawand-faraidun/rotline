import { useState } from 'react'
import {
	campaign,
	type DifficultyId,
	difficulties,
	isSurvival,
	type MissionDef,
	missionById,
	modifierBonus,
	modifiers,
	SURVIVAL_ARENAS,
	zombies
} from '@rotline/game-data'
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
import { bountyQuery } from '../../lib/records.ts'

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
export const isMode = (id: string) => isSurvival(id) || (campaign.contracts ?? []).includes(id)

/** One mission or contract to pick: its name, what it is, its numbers and the squad's record on it. */
function MissionCard({
	mission,
	number,
	open,
	chosen,
	editable,
	entry,
	boss = false,
	bounty = null,
	onChoose
}: {
	/** this week's bounty haunts this mission: its name and the difficulty */
	bounty?: string | null
	mission: MissionDef
	number?: number | undefined
	open: boolean
	/** the zone's boss: marked as such, and locked behind the zone's last mission */
	boss?: boolean
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
						: boss
							? '[--frame-color:var(--color-alert)]'
							: editable && open && 'hover:[--frame-color:var(--color-bone)]',
					(!open || (!editable && !chosen)) && 'opacity-50'
				)}
			>
				{boss && <span className="font-bold text-[10px] text-alert uppercase tracking-[0.25em]">{t.zoneBoss}</span>}
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
				{bounty && <span className="font-bold text-warning text-xs uppercase tracking-[0.15em]">{bounty}</span>}
				{!open && <span className="text-muted text-xs">{boss ? t.bossLockedHint : t.lockedHint}</span>}
			</button>
		</li>
	)
}

/** The leader picks the next mission or game mode and its difficulty; everyone else sees the choice. */
export function MissionPanel({ view, tab: initialTab }: { view: PartyView; tab?: MissionTab }) {
	const records = useQuery(missionsQuery)
	const bounty = useQuery(bountyQuery).data
	const bountyLabel = (id: string) =>
		bounty && bounty.mission === id
			? format(t.bountyHere, {
					name: zombies.find(entry => entry.id === bounty.zombie)?.name ?? bounty.zombie,
					difficulty: difficulties.tiers.find(tier => tier.id === bounty.difficulty)?.name ?? bounty.difficulty
				})
			: null
	const queryClient = useQueryClient()
	const [problem, setProblem] = useState<PartyProblem | null>(null)
	const [tab, setTab] = useState<MissionTab>(initialTab ?? (isMode(view.mission.id) ? 'modes' : 'campaign'))
	const leader = view.leader === view.you
	const editable = leader && view.state === 'lobby'
	const survival = isSurvival(view.mission.id)

	// a new mission keeps the modifiers chosen (Survival takes none)
	async function choose(mission: string, difficulty: DifficultyId, chosen = view.mission.modifiers) {
		setProblem(null)
		const result = await partyActions.mission(mission, difficulty, chosen)
		if ('error' in result) setProblem(result.error)
		else queryClient.setQueryData(partyQuery.queryKey, result)
	}

	const card = (id: string, number?: number, firstOpen = false, boss = false) => {
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
				boss={boss}
				bounty={bountyLabel(mission.id)}
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
							{zone.boss ? card(zone.boss, undefined, false, true) : null}
						</ul>
					</section>
				))}

			{tab === 'modes' && (
				<>
					<section className="flex flex-col gap-2">
						<h3 className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.survival}</h3>
						<p className="text-muted text-sm">{t.survivalDescription}</p>
						<ul className="grid gap-3 md:grid-cols-3">
							{SURVIVAL_ARENAS.map(arena => {
								const chosen = view.mission.id === arena.id
								return (
									<li key={arena.id}>
										<button
											type="button"
											aria-pressed={chosen}
											disabled={!editable}
											onClick={() => void choose(arena.id, view.mission.difficulty)}
											className={cn(
												'frame cut flex h-full w-full flex-col gap-2 p-4 text-left',
												chosen
													? '[--frame-color:var(--color-rot-lime)]'
													: editable && 'hover:[--frame-color:var(--color-bone)]',
												!editable && !chosen && 'opacity-60'
											)}
										>
											<span className="flex items-start justify-between gap-3">
												<span className="font-display text-2xl uppercase">{t.arenas[arena.id].name}</span>
												<Badge tone="alert">{t.endless}</Badge>
											</span>
											<span className="text-bone/80 text-sm">{t.arenas[arena.id].description}</span>
										</button>
									</li>
								)
							})}
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
			<fieldset className={cn('flex flex-col gap-2', survival && 'hidden')}>
				<legend className="mb-2 flex w-full items-baseline justify-between gap-3 font-bold text-muted text-xs uppercase tracking-[0.2em]">
					<span>{t.modifiers}</span>
					{view.mission.modifiers.length > 0 && (
						<span className="text-warning">
							{format(t.modifierBonus, { percent: String(Math.round(modifierBonus(view.mission.modifiers) * 100)) })}
						</span>
					)}
				</legend>
				<div className="grid grid-cols-1 gap-2 md:grid-cols-3">
					{modifiers.modifiers.map(modifier => {
						const on = view.mission.modifiers.includes(modifier.id)
						const next = on
							? view.mission.modifiers.filter(id => id !== modifier.id)
							: [...view.mission.modifiers, modifier.id]
						return (
							<button
								key={modifier.id}
								type="button"
								aria-pressed={on}
								disabled={!editable}
								onClick={() => void choose(view.mission.id, view.mission.difficulty, next)}
								className={cn(
									'frame cut-sm flex flex-col items-start gap-0.5 px-3 py-2 text-left',
									on ? '[--frame-color:var(--color-warning)]' : editable && 'hover:[--frame-color:var(--color-bone)]',
									!editable && !on && 'opacity-60'
								)}
							>
								<span className="flex w-full items-baseline justify-between gap-2">
									<span className="font-bold uppercase tracking-wide">{modifier.name}</span>
									<span className="text-warning text-xs">+{Math.round(modifier.bonus * 100)} %</span>
								</span>
								<span className="text-muted text-xs">{modifier.description}</span>
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
