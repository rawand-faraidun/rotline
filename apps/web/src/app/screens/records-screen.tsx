import { useEffect, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import {
	campaign,
	type DamageType,
	type DifficultyId,
	difficulties,
	missionById,
	SURVIVAL_ARENAS,
	zombies
} from '@rotline/game-data'
import { AvatarFrame, Badge, Button, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { useAvatar } from '../../lib/avatar.ts'
import { salvage } from '../../lib/describe.ts'
import {
	achievementsQuery,
	type BoardRow,
	bestiaryQuery,
	type Challenge,
	challengesQuery,
	missionBoardQuery,
	RECORDS,
	survivalBoardQuery,
	wearTitle
} from '../../lib/records.ts'
import { GameShell } from './game-shell.tsx'
import { pane, panes, scroller } from './layout.ts'
import { clock } from './mission-panel.tsx'
import { PageHeader } from './page-header.tsx'

const t = en.app.records
const arenas = en.app.missions.arenas
type Tab = keyof typeof t.tabs
const TABS = Object.keys(t.tabs) as Tab[]

/** How long until `at`, as hours and minutes (or minutes alone). */
function until(at: string, now: number): string {
	const minutes = Math.max(0, Math.round((Date.parse(at) - now) / 60_000))
	const days = Math.floor(minutes / 1440)
	const hours = Math.floor((minutes % 1440) / 60)
	return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** The clock, a tick a minute, for countdowns. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30_000)
		return () => window.clearInterval(timer)
	}, [])
	return now
}

function Meter({ value, max, done }: { value: number; max: number; done: boolean }) {
	const share = max > 0 ? Math.min(1, value / max) : 0
	return (
		<span className="h-1.5 w-full skew-x-[-20deg] bg-rot-black" aria-hidden="true">
			<span className={cn('block h-full', done ? 'bg-rot-lime' : 'bg-bone')} style={{ width: `${share * 100}%` }} />
		</span>
	)
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
	return (
		<li
			className={cn(
				'frame cut flex flex-col gap-2 p-4 [--frame-fill:var(--color-rot-black)]',
				challenge.done && '[--frame-color:var(--color-rot-lime)]'
			)}
		>
			<span className="flex items-start justify-between gap-3">
				<span className="font-bold text-lg uppercase tracking-wide">{challenge.text}</span>
				{challenge.done ? (
					<Badge tone="lime">{t.done}</Badge>
				) : (
					<Badge tone="warning">{format(t.reward, { salvage: salvage(challenge.reward) })}</Badge>
				)}
			</span>
			<Meter value={challenge.progress} max={challenge.target} done={challenge.done} />
			<meter className="sr-only" min={0} max={challenge.target} value={challenge.progress} />
			<span className="text-muted text-xs tabular-nums">
				{challenge.progress.toLocaleString('en')} / {challenge.target.toLocaleString('en')}
			</span>
		</li>
	)
}

function Challenges() {
	const list = useQuery(challengesQuery)
	const now = useNow()
	const kinds = (['daily', 'weekly'] as const).map(kind => ({
		kind,
		entries: (list.data ?? []).filter(entry => entry.kind === kind)
	}))
	return (
		<div className={cn(panes, 'lg:grid-cols-2')}>
			{kinds.map(({ kind, entries }) => (
				<div key={kind} className={pane}>
					<Panel className="gap-3">
						<PanelHeader className="flex items-baseline justify-between gap-3">
							<PanelTitle className="text-xl">{t[kind]}</PanelTitle>
							{entries[0] && (
								<span className="text-muted text-xs uppercase tracking-[0.15em]">
									{format(t.endsIn, { time: until(entries[0].endsAt, now) })}
								</span>
							)}
						</PanelHeader>
						<ul className="flex flex-col gap-3">
							{entries.map(entry => (
								<ChallengeCard key={entry.key} challenge={entry} />
							))}
						</ul>
					</Panel>
					{kind === 'daily' && <p className="text-muted text-sm">{t.challengesHint}</p>}
				</div>
			))}
		</div>
	)
}

function BoardLine({ row, survival }: { row: BoardRow; survival: boolean }) {
	const avatar = useAvatar(row.avatarStyle as AvatarStyle, row.avatarSeed)
	return (
		<tr className={cn('border-line border-t border-dashed', row.you && 'bg-rot-lime/10 text-rot-lime')}>
			<td className="py-2 pr-3 font-display text-xl tabular-nums">{row.rank}</td>
			<td className="py-2">
				<span className="flex items-center gap-3">
					<AvatarFrame src={avatar} alt="" size={32} />
					<span className="flex flex-col">
						<span className="font-bold">
							{row.name}
							{row.you && <span className="ml-2 text-xs uppercase tracking-[0.2em]">· {t.you}</span>}
						</span>
						{row.title && <span className="text-muted text-xs uppercase tracking-[0.15em]">{row.title}</span>}
					</span>
				</span>
			</td>
			{survival && <td className="py-2 text-right font-display text-xl tabular-nums">{row.rounds}</td>}
			{!survival && <td className="py-2 text-right tabular-nums">{clock(row.timeMs / 1000)}</td>}
			<td className="py-2 text-right tabular-nums">{row.score.toLocaleString('en')}</td>
		</tr>
	)
}

type Board = { kind: 'survival'; arena: string } | { kind: 'mission'; mission: string }

function Boards() {
	const [board, setBoard] = useState<Board>({ kind: 'survival', arena: SURVIVAL_ARENAS[0].id })
	const [period, setPeriod] = useState<'all' | 'week'>('week')
	const [difficulty, setDifficulty] = useState<DifficultyId>('veteran')
	const rows = useQuery(
		board.kind === 'survival' ? survivalBoardQuery(board.arena, period) : missionBoardQuery(board.mission, difficulty)
	)
	const survival = board.kind === 'survival'
	const missionIds = campaign.zones.flatMap(zone => [...zone.missions, ...(zone.boss ? [zone.boss] : [])])
	const pick = (next: Board, label: string, key: string) => {
		const chosen =
			next.kind === board.kind &&
			(next.kind === 'survival'
				? next.arena === (board as { arena?: string }).arena
				: next.mission === (board as { mission?: string }).mission)
		return (
			<li key={key}>
				<button
					type="button"
					aria-pressed={chosen}
					onClick={() => setBoard(next)}
					className={cn(
						'w-full px-3 py-1.5 text-left font-bold text-sm uppercase tracking-[0.12em]',
						chosen ? 'bg-rot-lime text-rot-black' : 'text-muted hover:text-bone'
					)}
				>
					{label}
				</button>
			</li>
		)
	}
	return (
		<div className={cn(panes, 'lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]')}>
			<div className={pane}>
				<Panel className="gap-2">
					<PanelTitle className="text-lg">{t.survival}</PanelTitle>
					<ul className="flex flex-col">
						{SURVIVAL_ARENAS.map(arena => pick({ kind: 'survival', arena: arena.id }, arenas[arena.id].name, arena.id))}
					</ul>
					<PanelTitle className="mt-3 text-lg">{t.missions}</PanelTitle>
					<ul className="flex flex-col">
						{missionIds.map(id => pick({ kind: 'mission', mission: id }, missionById(id)?.name ?? id, id))}
					</ul>
				</Panel>
			</div>
			<div className={pane}>
				<Panel className="gap-3">
					<PanelHeader className="flex flex-wrap items-center justify-between gap-3">
						<PanelTitle className="text-xl">
							{survival
								? arenas[(board as { arena: keyof typeof arenas }).arena].name
								: missionById((board as { mission: string }).mission)?.name}
						</PanelTitle>
						<div className="flex flex-wrap gap-1">
							{survival
								? (['week', 'all'] as const).map(value => (
										<Button
											key={value}
											size="sm"
											variant={period === value ? 'primary' : 'ghost'}
											aria-pressed={period === value}
											onClick={() => setPeriod(value)}
										>
											{value === 'week' ? t.thisWeek : t.allTime}
										</Button>
									))
								: difficulties.tiers.map(tier => (
										<Button
											key={tier.id}
											size="sm"
											variant={difficulty === tier.id ? 'primary' : 'ghost'}
											aria-pressed={difficulty === tier.id}
											onClick={() => setDifficulty(tier.id)}
										>
											{tier.name}
										</Button>
									))}
						</div>
					</PanelHeader>
					{rows.data && rows.data.length === 0 ? (
						<p className="text-muted">{t.noRuns}</p>
					) : (
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-muted text-xs uppercase tracking-[0.2em]">
									<th className="py-1 pr-3 font-bold">{t.rank}</th>
									<th className="py-1 font-bold">{t.player}</th>
									<th className="py-1 text-right font-bold">{survival ? t.rounds : t.time}</th>
									<th className="py-1 text-right font-bold">{t.score}</th>
								</tr>
							</thead>
							<tbody>
								{(rows.data ?? []).map(row => (
									<BoardLine key={`${row.rank}:${row.name}`} row={row} survival={survival} />
								))}
							</tbody>
						</table>
					)}
				</Panel>
			</div>
		</div>
	)
}

function Bestiary() {
	const list = useQuery(bestiaryQuery)
	const kills = new Map((list.data ?? []).map(entry => [entry.id, entry.kills]))
	const types = zombies.filter(zombie => !zombie.dummy)
	const known = types.filter(zombie => (kills.get(zombie.id) ?? 0) > 0).length
	return (
		<div className={cn(scroller, 'flex flex-col gap-3')}>
			<p className="text-muted text-sm uppercase tracking-[0.15em]">
				{format(t.found, { found: String(known), total: String(types.length) })}
			</p>
			<ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{types.map(zombie => {
					const count = kills.get(zombie.id) ?? 0
					const seen = count > 0
					const resists = Object.entries(zombie.resist ?? {}) as [DamageType, number][]
					return (
						<li
							key={zombie.id}
							className={cn(
								'frame cut flex flex-col gap-2 p-4 [--frame-fill:var(--color-rot-black)]',
								zombie.boss && '[--frame-color:var(--color-alert)]',
								!seen && 'opacity-60'
							)}
						>
							<span className="flex items-start justify-between gap-3">
								<span className="font-display text-2xl uppercase">{seen ? zombie.name : t.unknown}</span>
								{zombie.boss ? (
									<Badge tone="alert">{t.boss}</Badge>
								) : zombie.elite ? (
									<Badge tone="warning">{t.elite}</Badge>
								) : null}
							</span>
							{seen ? (
								<>
									<span className="text-bone/85 text-sm">{zombie.about}</span>
									{zombie.answer && (
										<span className="text-sm">
											<span className="font-bold text-rot-lime uppercase tracking-[0.12em]">{t.answer}: </span>
											{zombie.answer}
										</span>
									)}
									{resists.length > 0 && (
										<span className="text-muted text-xs">
											{t.resists}:{' '}
											{resists
												.map(([type, share]) =>
													share >= 1
														? format(t.immune, { type: t.damageTypes[type] })
														: format(t.resist, { share: String(Math.round(share * 100)), type: t.damageTypes[type] })
												)
												.join(', ')}
										</span>
									)}
									<span className="mt-auto text-muted text-xs uppercase tabular-nums tracking-[0.15em]">
										{format(t.kills, { kills: count.toLocaleString('en') })}
									</span>
								</>
							) : (
								<span className="text-muted text-sm">{t.unknownHint}</span>
							)}
						</li>
					)
				})}
			</ul>
		</div>
	)
}

function Achievements() {
	const view = useQuery(achievementsQuery)
	const queryClient = useQueryClient()
	const wearing = view.data?.achievements.find(entry => entry.id === view.data?.title)
	const wear = async (id: string | null) => {
		if (await wearTitle(id)) await queryClient.invalidateQueries({ queryKey: [RECORDS] })
	}
	return (
		<div className={cn(scroller, 'flex flex-col gap-3')}>
			<div className="flex flex-wrap items-center gap-3">
				<span className="text-muted text-xs uppercase tracking-[0.2em]">{t.wearing}</span>
				<span className="font-display text-2xl text-rot-lime uppercase">{wearing?.title ?? t.noTitle}</span>
				{wearing && (
					<Button size="sm" variant="ghost" onClick={() => void wear(null)}>
						{t.remove}
					</Button>
				)}
			</div>
			<ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{(view.data?.achievements ?? []).map(entry => {
					const earned = entry.unlockedAt !== null
					return (
						<li
							key={entry.id}
							className={cn(
								'frame cut flex flex-col gap-2 p-4 [--frame-fill:var(--color-rot-black)]',
								earned ? '[--frame-color:var(--color-rot-lime)]' : 'opacity-75'
							)}
						>
							<span className="font-display text-xl uppercase">{entry.name}</span>
							<span className="text-bone/85 text-sm">{entry.description}</span>
							<Meter value={entry.progress} max={entry.target} done={earned} />
							<span className="flex items-center justify-between gap-2 text-xs">
								<span className="text-muted uppercase tracking-[0.15em]">
									{earned
										? format(t.earned, { date: new Date(entry.unlockedAt ?? 0).toLocaleDateString('en-GB') })
										: `${entry.progress.toLocaleString('en')} / ${entry.target.toLocaleString('en')}`}
								</span>
								<span className="text-muted">{format(t.titleReward, { title: entry.title })}</span>
							</span>
							{earned && view.data?.title !== entry.id && (
								<Button size="sm" variant="secondary" onClick={() => void wear(entry.id)}>
									{t.wear}
								</Button>
							)}
						</li>
					)
				})}
			</ul>
		</div>
	)
}

/** Challenges, leaderboards, the bestiary and achievements, a tab each. */
export function RecordsScreen() {
	const [tab, setTab] = useState<Tab>('challenges')
	return (
		<GameShell>
			<PageHeader title={t.title}>
				<div className="flex flex-wrap gap-1" role="tablist">
					{TABS.map(id => (
						<Button
							key={id}
							role="tab"
							aria-selected={tab === id}
							size="sm"
							variant={tab === id ? 'primary' : 'ghost'}
							onClick={() => setTab(id)}
						>
							{t.tabs[id]}
						</Button>
					))}
				</div>
			</PageHeader>
			{tab === 'challenges' && <Challenges />}
			{tab === 'boards' && <Boards />}
			{tab === 'bestiary' && <Bestiary />}
			{tab === 'achievements' && <Achievements />}
		</GameShell>
	)
}
