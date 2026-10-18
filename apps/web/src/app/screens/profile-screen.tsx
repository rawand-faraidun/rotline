import type { AvatarStyle } from '@rotline/constants'
import { campaign, missionById } from '@rotline/game-data'
import { AvatarFrame, Badge, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { useAvatar } from '../../lib/avatar.ts'
import { salvage } from '../../lib/describe.ts'
import { bestOf, missionsQuery } from '../../lib/party.ts'
import { progressQuery } from '../../lib/progress.ts'
import { meQuery } from '../app.tsx'
import { GameShell } from './game-shell.tsx'
import { pane, panes } from './layout.ts'
import { clock, masteryTone } from './mission-panel.tsx'

const t = en.app.profile
const p = en.app.progression
const CLASSES = ['assault', 'medic', 'heavy'] as const

/** The player's own record: who they are, their classes, their campaign and what they own. */
export function ProfileScreen() {
	const { data: me } = useSuspenseQuery(meQuery)
	const progress = useQuery(progressQuery)
	const records = useQuery(missionsQuery)
	const player = me.status === 'signed-in' ? me.player : null
	const avatar = useAvatar((player?.avatarStyle ?? 'pixel-art') as AvatarStyle, player?.avatarSeed ?? '')
	const view = progress.data
	if (!player || !view) return <GameShell>{null}</GameShell>

	const missionsDone = (records.data ?? []).reduce((sum, record) => sum + bestOf(record).completions, 0)
	const golds = (records.data ?? []).filter(record => bestOf(record).mastery === 3).length
	const totalLevel = CLASSES.reduce((sum, cls) => sum + view.classes[cls].level, 0)
	const stats = [
		{ label: t.totalLevel, value: String(totalLevel) },
		{ label: t.missionsDone, value: String(missionsDone) },
		{ label: t.golds, value: String(golds) },
		{ label: t.items, value: String(view.inventory.length) },
		{ label: p.salvage, value: salvage(view.salvage) }
	]

	return (
		<GameShell>
			<h1 className="sr-only">{t.title}</h1>
			<div className={cn(panes, 'lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]')}>
				<div className={pane}>
					<Panel className="items-center gap-4 text-center">
						<AvatarFrame src={avatar} alt="" size={120} />
						<span className="font-display text-4xl uppercase">{player.name}</span>
						<Badge tone="lime">
							{p.classes[view.activeClass].name} ·{' '}
							{format(p.level, { level: String(view.classes[view.activeClass].level) })}
						</Badge>
						<dl className="grid w-full grid-cols-2 gap-2 text-left">
							{stats.map(stat => (
								<div
									key={stat.label}
									className="frame cut-sm flex flex-col px-3 py-2 [--frame-fill:var(--color-rot-black)]"
								>
									<dt className="text-muted text-xs uppercase tracking-[0.2em]">{stat.label}</dt>
									<dd className="font-display text-2xl text-rot-lime tabular-nums">{stat.value}</dd>
								</div>
							))}
						</dl>
					</Panel>
					<Panel className="gap-3">
						<PanelHeader>
							<PanelTitle className="text-xl">{t.classes}</PanelTitle>
						</PanelHeader>
						<ul className="flex flex-col gap-2">
							{CLASSES.map(cls => {
								const entry = view.classes[cls]
								const share = entry.next ? entry.into / entry.next : 1
								return (
									<li key={cls} className="flex flex-col gap-1">
										<span className="flex items-baseline justify-between">
											<span className="font-bold uppercase tracking-[0.12em]">{p.classes[cls].name}</span>
											<span className="font-display text-lg">{format(p.level, { level: String(entry.level) })}</span>
										</span>
										<span className="h-1.5 w-full bg-rot-black" aria-hidden="true">
											<span className="block h-full bg-rot-lime" style={{ width: `${Math.round(share * 100)}%` }} />
										</span>
										<span className="text-muted text-xs tabular-nums">
											{entry.next
												? format(p.xp, { into: entry.into.toLocaleString('en'), next: entry.next.toLocaleString('en') })
												: p.maxLevel}
										</span>
									</li>
								)
							})}
						</ul>
					</Panel>
				</div>

				<div className={pane}>
					<Panel className="gap-3">
						<PanelHeader>
							<PanelTitle className="text-xl">{t.campaign}</PanelTitle>
						</PanelHeader>
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-muted text-xs uppercase tracking-[0.2em]">
									<th className="py-1 font-bold">{t.mission}</th>
									<th className="py-1 text-right font-bold">{t.completions}</th>
									<th className="py-1 text-right font-bold">{t.bestTime}</th>
									<th className="py-1 text-right font-bold">{t.mastery}</th>
								</tr>
							</thead>
							<tbody>
								{campaign.zones.flatMap(zone =>
									zone.missions.map(id => {
										const mission = missionById(id)
										const entry = records.data?.find(record => record.id === id)
										const best = bestOf(entry)
										return (
											<tr key={id} className={cn('border-line border-t border-dashed', !entry?.open && 'opacity-45')}>
												<td className="py-2 font-bold">{mission?.name ?? id}</td>
												<td className="py-2 text-right tabular-nums">{best.completions}</td>
												<td className="py-2 text-right tabular-nums">
													{best.bestTimeMs ? clock(best.bestTimeMs / 1000) : '—'}
												</td>
												<td className="py-2 text-right">
													{entry?.open ? (
														<Badge tone={masteryTone[best.mastery] ?? 'muted'}>
															{en.app.missions.mastery[best.mastery]}
														</Badge>
													) : (
														<Badge tone="muted">{en.app.missions.locked}</Badge>
													)}
												</td>
											</tr>
										)
									})
								)}
							</tbody>
						</table>
					</Panel>
				</div>
			</div>
		</GameShell>
	)
}
