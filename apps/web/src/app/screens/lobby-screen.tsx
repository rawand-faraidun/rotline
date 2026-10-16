import { useEffect, useId, useRef, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import { AvatarFrame, Badge, Button, cn, Input, Label, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { en } from '../../i18n/en.ts'
import { signOut } from '../../lib/api.ts'
import { useAvatar } from '../../lib/avatar.ts'
import {
	type PartyMember,
	type PartyProblem,
	type PartyView,
	partyActions,
	partyQuery,
	usePlayerEvents
} from '../../lib/party.ts'
import { meQuery } from '../app.tsx'
import { Shell } from './shell.tsx'

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
				<Badge tone="lime">{t.classes[member.activeClass]}</Badge>
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
	const [copied, setCopied] = useState(false)
	const player = me.status === 'signed-in' ? me.player : null
	const avatar = useAvatar((player?.avatarStyle ?? 'pixel-art') as AvatarStyle, player?.avatarSeed ?? '')
	usePlayerEvents()

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

	const leave = async () => {
		await signOut()
		queryClient.clear()
		await navigate({ to: '/play' })
	}

	const youMember = view?.members.find(member => member.id === view.you)
	const isLeader = view?.leader === view?.you
	const solo = (view?.members.length ?? 1) === 1
	const inviteLink = view ? `${location.origin}/play/lobby?join=${view.code}` : ''

	return (
		<Shell
			aside={
				<div className="flex items-center gap-3">
					<AvatarFrame src={avatar} alt="" size={40} />
					<span className="font-bold tracking-wide">{player.name}</span>
					<Button variant="ghost" size="sm" onClick={() => void leave()}>
						{t.signOut}
					</Button>
				</div>
			}
		>
			<h1 className="mt-6 mb-8 font-display text-5xl uppercase md:text-6xl">{t.title}</h1>
			<div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
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
							</>
						) : isLeader ? (
							<Button size="lg" disabled={!view?.canStart} onClick={() => void act(() => partyActions.start())}>
								{solo ? t.deploy : t.deploySquad}
							</Button>
						) : (
							<Button
								size="lg"
								variant={youMember?.ready ? 'secondary' : 'primary'}
								onClick={() => void act(() => partyActions.ready(!youMember?.ready))}
							>
								{youMember?.ready ? t.unready : t.markReady}
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

				<div className="flex flex-col gap-6">
					<Panel>
						<PanelHeader>
							<PanelTitle>{t.invite}</PanelTitle>
						</PanelHeader>
						<div className="flex items-end justify-between gap-4">
							<div className="flex flex-col gap-1">
								<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.inviteCode}</span>
								<span data-testid="party-code" className="font-display text-4xl text-rot-lime tracking-[0.15em]">
									{view?.code ?? '······'}
								</span>
							</div>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => {
									void navigator.clipboard.writeText(inviteLink).then(() => {
										setCopied(true)
										setTimeout(() => setCopied(false), 1500)
									})
								}}
							>
								{copied ? t.copied : t.copyLink}
							</Button>
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
					<Panel>
						<PanelHeader>
							<PanelTitle>{t.salvage}</PanelTitle>
							<span className="font-display text-3xl text-rot-lime tabular-nums">{player.salvage}</span>
						</PanelHeader>
						<p className="text-muted">{t.deployHint}</p>
					</Panel>
				</div>
			</div>
		</Shell>
	)
}
