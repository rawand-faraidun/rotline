import { useEffect, useId, useRef, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import { AvatarFrame, Badge, Button, cn, Input, Label, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { useAvatar } from '../../lib/avatar.ts'
import { type PartyMember, type PartyProblem, type PartyView, partyActions, partyQuery } from '../../lib/party.ts'
import { meQuery } from '../app.tsx'
import { AdminPanel } from './admin-panel.tsx'
import { ClassPanel, LoadoutSummary } from './class-panel.tsx'
import { FriendsPanel } from './friends-panel.tsx'
import { GameShell } from './game-shell.tsx'
import { pane, panes } from './layout.ts'
import { MissionPanel } from './mission-panel.tsx'
import { StableLabel } from './stable-label.tsx'

const t = en.app.lobby

function MemberCard({
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
				'frame cut flex flex-col items-center gap-3 p-4',
				you ? '[--frame-color:var(--color-rot-lime)]' : member.ready ? '[--frame-color:var(--color-bone)]' : ''
			)}
		>
			<AvatarFrame src={avatar} alt="" size={88} />
			<span className="max-w-full truncate font-bold">{member.name}</span>
			<div className="flex flex-wrap justify-center gap-1.5">
				<Badge tone="lime">
					{t.classes[member.activeClass]} · {format(en.app.progression.level, { level: String(member.level) })}
				</Badge>
				{member.leader && <Badge tone="bone">{t.leader}</Badge>}
			</div>
			<Badge tone={member.ready ? 'lime' : 'warning'}>{member.ready ? t.ready : t.notReady}</Badge>
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

	return (
		<GameShell>
			<h1 className="mb-6 shrink-0 font-display text-5xl uppercase md:text-6xl">{t.title}</h1>
			<div className={cn(panes, 'lg:grid-cols-[2fr_1fr]')}>
				<div className={pane}>
					<Panel>
						<PanelHeader>
							<PanelTitle>{t.squad}</PanelTitle>
							<span className="font-bold text-muted text-sm">{view?.members.length ?? 1} / 4</span>
						</PanelHeader>
						<ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
							{view?.members.map(member => (
								<MemberCard
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
									className="frame cut flex min-h-52 items-center justify-center p-4 text-muted text-xs uppercase tracking-[0.2em] [--frame-fill:var(--color-rot-black)]"
								>
									{t.slotOpen}
								</li>
							))}
						</ul>
						<div className="flex flex-wrap items-center gap-3">
							{view?.state === 'mission' ? (
								<>
									<p className="text-warning">{t.inMission}</p>
									<Button onClick={() => void navigate({ to: '/play/mission' })}>{t.rejoin}</Button>
									<Button variant="ghost" onClick={() => void act(() => partyActions.abandon())}>
										{solo ? t.abandon : t.abandonSquad}
									</Button>
								</>
							) : isLeader ? (
								<Button
									size="lg"
									disabled={!view?.canStart}
									onClick={() => void act(() => partyActions.start(view?.mission))}
								>
									{solo ? t.deploy : t.deploySquad}
								</Button>
							) : (
								<Button
									size="lg"
									variant={youMember?.ready ? 'secondary' : 'primary'}
									onClick={() => void act(() => partyActions.ready(!youMember?.ready, view?.mission))}
								>
									<StableLabel labels={[t.markReady, t.unready]} current={youMember?.ready ? t.unready : t.markReady} />
								</Button>
							)}
							{isLeader && !solo && !view?.canStart && <p className="text-muted text-sm">{t.waiting}</p>}
							{!solo && (
								<Button variant="ghost" size="sm" onClick={() => void act(() => partyActions.leave())}>
									{t.leaveParty}
								</Button>
							)}
						</div>
						{problem && (
							<p role="alert" className="text-alert text-sm">
								{t.problems[problem]}
							</p>
						)}
					</Panel>
					{view && <MissionPanel view={view} />}
				</div>

				<div className={pane}>
					<Panel>
						<PanelHeader>
							<PanelTitle>{t.invite}</PanelTitle>
						</PanelHeader>
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-1">
								<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.inviteCode}</span>
								<span data-testid="party-code" className="font-display text-4xl text-rot-lime tracking-[0.15em]">
									{view?.code ?? '······'}
								</span>
							</div>
							<div className="grid grid-cols-2 gap-2">
								<Button
									variant="secondary"
									size="sm"
									disabled={!view}
									onClick={() => void copy(view?.code ?? '', 'code')}
								>
									<StableLabel labels={[t.copyCode, t.copied]} current={copied === 'code' ? t.copied : t.copyCode} />
								</Button>
								<Button variant="ghost" size="sm" disabled={!view} onClick={() => void copy(inviteLink, 'link')}>
									<StableLabel labels={[t.copyLink, t.copied]} current={copied === 'link' ? t.copied : t.copyLink} />
								</Button>
							</div>
						</div>
						<form
							className="flex flex-col gap-2"
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
					<ClassPanel />
					<LoadoutSummary />
					<FriendsPanel squad={view?.members.map(member => member.id) ?? []} />
					{player.isAdmin && <AdminPanel />}
				</div>
			</div>
		</GameShell>
	)
}
