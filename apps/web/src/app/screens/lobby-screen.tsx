import { useEffect, useId, useRef, useState } from 'react'
import type { LobbyMember } from '@rotline/client/lobby'
import type { AvatarStyle } from '@rotline/constants'
import { difficulties, missionById, SURVIVAL } from '@rotline/game-data'
import { AvatarFrame, Badge, Button, cn, Input, Label, Panel } from '@rotline/ui'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { useAvatar } from '../../lib/avatar.ts'
import { type PartyMember, type PartyProblem, type PartyView, partyActions, partyQuery } from '../../lib/party.ts'
import { progressQuery } from '../../lib/progress.ts'
import { meQuery } from '../app.tsx'
import { AdminPanel } from './admin-panel.tsx'
import { glass, LoadoutSummary } from './class-panel.tsx'
import { FriendsPanel } from './friends-panel.tsx'
import { GameShell } from './game-shell.tsx'
import { pane, panes } from './layout.ts'
import { LobbyBackdrop } from './lobby-backdrop.tsx'
import { MissionPanel } from './mission-panel.tsx'
import { StableLabel } from './stable-label.tsx'

const t = en.app.lobby

/** what other squad members hold in the scene (their loadout is theirs to know) */
const CLASS_WEAPON: Record<string, string> = { assault: 'k-71', medic: 'vex-9', heavy: 'mower' }

function MemberRow({
	member,
	you,
	canKick,
	onKick
}: {
	member: PartyMember
	you: boolean
	canKick: boolean
	onKick: () => void
}) {
	const avatar = useAvatar(member.avatarStyle as AvatarStyle, member.avatarSeed)
	return (
		<li
			className={cn(
				'frame cut-sm flex items-center gap-3 p-2',
				you ? '[--frame-color:var(--color-rot-lime)]' : member.ready ? '[--frame-color:var(--color-bone)]' : ''
			)}
		>
			<AvatarFrame src={avatar} alt="" size={40} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-bold">
					{member.name}
					{you && <span className="text-muted"> {t.you}</span>}
				</span>
				<span className="text-muted text-xs uppercase tracking-wider">
					{t.classes[member.activeClass]} · {format(en.app.progression.level, { level: String(member.level) })}
				</span>
			</span>
			<span className="flex shrink-0 flex-col items-end gap-1">
				<Badge tone={member.ready ? 'lime' : 'warning'}>{member.ready ? t.ready : t.notReady}</Badge>
				{member.leader && <Badge tone="bone">{t.leader}</Badge>}
			</span>
			{canKick && (
				<Button variant="ghost" size="sm" onClick={onKick}>
					{t.kick}
				</Button>
			)}
		</li>
	)
}

export function LobbyScreen() {
	const { data: me } = useSuspenseQuery(meQuery)
	// while the squad is in a mission, check now and then whether it has ended
	const party = useQuery({
		...partyQuery,
		refetchInterval: query => (query.state.data?.state === 'mission' ? 10_000 : false)
	})
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const codeId = useId()
	const [code, setCode] = useState('')
	const [problem, setProblem] = useState<PartyProblem | null>(null)
	const [copied, setCopied] = useState<'code' | 'link' | null>(null)
	const [side, setSide] = useState<'squad' | 'friends'>('squad')
	const [picking, setPicking] = useState(false)
	const progress = useQuery(progressQuery)
	const player = me.status === 'signed-in' ? me.player : null

	const view = party.data
	// when the leader deploys, everyone in the squad follows (but returning to the lobby does not bounce back)
	const previousState = useRef(view?.state)
	useEffect(() => {
		if (previousState.current === 'lobby' && view?.state === 'mission') void navigate({ to: '/play/mission' })
		previousState.current = view?.state
	}, [view?.state, navigate])

	// invite links: /play/lobby?join=CODE
	useEffect(() => {
		const join = new URLSearchParams(location.search).get('join')
		if (!join) return
		history.replaceState(null, '', '/play/lobby')
		void partyActions.join(join).then(result => {
			if ('error' in result) setProblem(result.error)
			else queryClient.setQueryData(partyQuery.queryKey, result)
		})
	}, [queryClient])

	if (!player) return null

	async function act(action: () => Promise<PartyView | { error: PartyProblem }>) {
		setProblem(null)
		const result = await action()
		if ('error' in result) setProblem(result.error)
		else queryClient.setQueryData(partyQuery.queryKey, result)
	}

	/** Copies the squad code or the invite link, and says so on that button for a moment. */
	async function copy(text: string, which: 'code' | 'link') {
		if (!text) return
		try {
			await navigator.clipboard.writeText(text)
		} catch {
			// no clipboard permission (or not a secure page): fall back to a hidden text field
			const field = document.createElement('textarea')
			field.value = text
			field.style.position = 'fixed'
			field.style.opacity = '0'
			document.body.append(field)
			field.select()
			document.execCommand('copy')
			field.remove()
		}
		setCopied(which)
		setTimeout(() => setCopied(current => (current === which ? null : current)), 1500)
	}

	const youMember = view?.members.find(member => member.id === view.you)
	const isLeader = view?.leader === view?.you
	const solo = (view?.members.length ?? 1) === 1
	const inviteLink = view ? `${location.origin}/play/lobby?join=${view.code}` : ''
	const missionName =
		view?.mission.id === SURVIVAL ? en.app.missions.survival : (missionById(view?.mission.id ?? '')?.name ?? '')
	const difficultyName = difficulties.tiers.find(tier => tier.id === view?.mission.difficulty)?.name ?? ''

	const deployBar = (
		// what the squad is about to do and the one button that does it, always in reach
		<div className={cn('frame cut flex shrink-0 flex-col gap-3 p-4 [--frame-color:var(--color-rot-lime)]', glass)}>
			<div className="flex flex-wrap items-center gap-3">
				{view?.state === 'mission' ? (
					<>
						<p className="w-full text-warning">{t.inMission}</p>
						<Button onClick={() => void navigate({ to: '/play/mission' })}>{t.rejoin}</Button>
						<Button variant="ghost" onClick={() => void act(() => partyActions.abandon())}>
							{solo ? t.abandon : t.abandonSquad}
						</Button>
					</>
				) : isLeader ? (
					<Button
						size="lg"
						className="flex-1"
						disabled={!view?.canStart}
						onClick={() => void act(() => partyActions.start(view?.mission))}
					>
						{solo ? t.deploy : t.deploySquad}
					</Button>
				) : (
					<Button
						size="lg"
						className="flex-1"
						variant={youMember?.ready ? 'secondary' : 'primary'}
						onClick={() => void act(() => partyActions.ready(!youMember?.ready, view?.mission))}
					>
						<StableLabel labels={[t.markReady, t.unready]} current={youMember?.ready ? t.unready : t.markReady} />
					</Button>
				)}
				{!solo && (
					<Button variant="ghost" size="sm" onClick={() => void act(() => partyActions.leave())}>
						{t.leaveParty}
					</Button>
				)}
			</div>
			{isLeader && !solo && !view?.canStart && <p className="text-muted text-sm">{t.waiting}</p>}
			{problem && (
				<p role="alert" className="text-alert text-sm">
					{t.problems[problem]}
				</p>
			)}
		</div>
	)

	// the soldiers standing in the scene: you with your own gun, the others with their class's usual one
	const members: LobbyMember[] = (view?.members ?? []).map((member, index) => {
		const you = member.id === view?.you
		const weaponId = (you ? progress.data?.loadout.main1 : null) ?? CLASS_WEAPON[member.activeClass] ?? 'k-71'
		const loadout = progress.data?.loadout
		// your own soldier wears what you equipped; the others wear their class's usual kit
		const armour =
			you && loadout
				? [loadout.armourHead, loadout.armourTorso, loadout.armourVest, loadout.armourLegs, loadout.armourFeet]
				: undefined
		return { slot: index + 1, classId: member.activeClass, weaponId, pistol: false, you, ...(armour ? { armour } : {}) }
	})

	return (
		<GameShell backdrop={<LobbyBackdrop members={members} />}>
			<h1 className="sr-only">{t.title}</h1>
			<div
				className={cn(
					panes,
					'lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(20rem,25rem)] lg:grid-rows-[minmax(0,1fr)]'
				)}
			>
				{/* left: the squad and the way in for others, or friends */}
				<div className={pane}>
					<div className="flex shrink-0 gap-1" role="tablist" aria-label={t.sideTabs}>
						{(['squad', 'friends'] as const).map(tab => (
							<button
								key={tab}
								type="button"
								role="tab"
								aria-selected={side === tab}
								onClick={() => setSide(tab)}
								className={cn(
									'frame cut-sm flex-1 px-3 py-2 font-bold text-xs uppercase tracking-[0.2em]',
									glass,
									side === tab ? 'text-rot-lime [--frame-color:var(--color-rot-lime)]' : 'text-muted hover:text-bone'
								)}
							>
								{tab === 'squad' ? `${t.squad} ${view?.members.length ?? 1}/4` : en.app.friends.title}
							</button>
						))}
					</div>
					{side === 'squad' ? (
						<Panel className={cn('shrink-0 gap-3 p-4', glass)}>
							<h2 className="sr-only">{t.squad}</h2>
							<ul className="flex flex-col gap-1.5">
								{view?.members.map(member => (
									<MemberRow
										key={member.id}
										member={member}
										you={member.id === view.you}
										canKick={isLeader && member.id !== view.you}
										onKick={() => void act(() => partyActions.kick(member.id))}
									/>
								))}
								{Array.from({ length: 4 - (view?.members.length ?? 1) }, (_, i) => (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: empty slots have no identity
										key={i}
										className="frame cut-sm flex min-h-14 items-center justify-between gap-2 px-3 [--frame-fill:rgb(13_16_14/0.6)]"
									>
										<span className="text-muted text-xs uppercase tracking-[0.2em]">{t.slotOpen}</span>
										{i === 0 && view?.state === 'lobby' && (
											<Button variant="ghost" size="sm" onClick={() => void copy(inviteLink, 'link')}>
												<StableLabel
													labels={[t.inviteSomeone, t.copied]}
													current={copied === 'link' ? t.copied : t.inviteSomeone}
												/>
											</Button>
										)}
									</li>
								))}
							</ul>
							<div className="flex items-center justify-between gap-2 border-line border-t border-dashed pt-3">
								<span className="flex flex-col">
									<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.inviteCode}</span>
									<span data-testid="party-code" className="font-display text-2xl text-rot-lime tracking-[0.15em]">
										{view?.code ?? '······'}
									</span>
								</span>
								<Button
									variant="secondary"
									size="sm"
									disabled={!view}
									onClick={() => void copy(view?.code ?? '', 'code')}
								>
									<StableLabel labels={[t.copyCode, t.copied]} current={copied === 'code' ? t.copied : t.copyCode} />
								</Button>
							</div>
							<form
								className="flex flex-col gap-1.5"
								onSubmit={event => {
									event.preventDefault()
									if (code.trim().length === 6) void act(() => partyActions.join(code.trim().toUpperCase()))
								}}
							>
								<Label htmlFor={codeId}>{t.joinCode}</Label>
								<div className="flex gap-2">
									<Input
										id={codeId}
										value={code}
										maxLength={6}
										placeholder={t.joinPlaceholder}
										autoComplete="off"
										className="font-bold uppercase tracking-[0.3em]"
										onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, ''))}
									/>
									<Button type="submit" variant="secondary" disabled={code.trim().length !== 6}>
										{t.join}
									</Button>
								</div>
							</form>
						</Panel>
					) : (
						<FriendsPanel squad={view?.members.map(member => member.id) ?? []} />
					)}
					{player.isAdmin && <AdminPanel />}
				</div>

				{/* middle: the squad stands in the scene; the class and kit sit at their feet (changed in the armory) */}
				<div className="flex min-h-0 flex-col justify-end gap-3 max-lg:min-h-[60dvh]">
					<LoadoutSummary />
				</div>

				{/* right: where to go, and going */}
				<div className={cn(pane, 'lg:overflow-hidden')}>
					<div className="flex-1" />
					{view && (
						// the mode card: what the squad is about to play; it opens the mission picker
						<button
							type="button"
							onClick={() => setPicking(true)}
							className={cn(
								'frame cut flex shrink-0 flex-col gap-1 p-4 text-left hover:[--frame-color:var(--color-bone)]',
								glass
							)}
						>
							<span className="flex items-center justify-between gap-2">
								<span className="text-muted text-xs uppercase tracking-[0.2em]">{en.app.missions.title}</span>
								<span className="font-bold text-rot-lime text-xs uppercase tracking-[0.2em]">
									{isLeader && view.state === 'lobby' ? t.changeMission : t.seeMission}
								</span>
							</span>
							<span className="font-display text-3xl uppercase">{missionName}</span>
							<span className="text-muted text-sm">
								{view.mission.id === SURVIVAL
									? en.app.missions.endless
									: `${difficultyName} · ${missionById(view.mission.id)?.description ?? ''}`}
							</span>
						</button>
					)}
					{deployBar}
				</div>
			</div>
			{picking && view && <MissionPicker view={view} onClose={() => setPicking(false)} />}
		</GameShell>
	)
}

/** Choosing where to go: the campaign, Survival and the difficulty, over the lobby. */
function MissionPicker({ view, onClose }: { view: PartyView; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null)
	useEffect(() => {
		dialog.current?.showModal()
	}, [])
	return (
		<dialog
			ref={dialog}
			aria-label={en.app.missions.title}
			onClose={onClose}
			className="no-scrollbar m-auto max-h-[92dvh] w-[min(64rem,96vw)] overflow-y-auto bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
		>
			<div className="flex flex-col gap-3">
				<MissionPanel view={view} />
				<Button className="self-end" onClick={() => dialog.current?.close()}>
					{t.done}
				</Button>
			</div>
		</dialog>
	)
}
