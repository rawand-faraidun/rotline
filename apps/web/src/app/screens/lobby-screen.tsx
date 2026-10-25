import { useEffect, useId, useRef, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import { difficulties, isSurvival, missionById, SURVIVAL } from '@rotline/game-data'
import { AvatarFrame, Badge, Button, cn, Input, Label, Panel } from '@rotline/ui'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { useAvatar } from '../../lib/avatar.ts'
import { salvage } from '../../lib/describe.ts'
import { asPlayerCode, friendActions, friendsQuery } from '../../lib/friends.ts'
import { takeLinkCodes } from '../../lib/link-codes.ts'
import { type PartyMember, type PartyProblem, type PartyView, partyActions, partyQuery } from '../../lib/party.ts'
import { progressQuery } from '../../lib/progress.ts'
import { canShare, copyText, shareLink } from '../../lib/share.ts'
import { meQuery } from '../app.tsx'
import { AdminPanel } from './admin-panel.tsx'
import { itemPicture } from './character-stage.tsx'
import { glass } from './class-panel.tsx'
import { FriendsPanel } from './friends-panel.tsx'
import { GameShell } from './game-shell.tsx'
import { HubBackdrop } from './hub-backdrop.tsx'
import { pane, panes } from './layout.ts'
import { isMode, MissionPanel, type MissionTab } from './mission-panel.tsx'
import { StableLabel } from './stable-label.tsx'

const t = en.app.lobby

const pictureOf = (id: string | null | undefined) => (id ? itemPicture(id) : null)
const isContract = (id: string) => !isSurvival(id) && isMode(id)

/** Simple line drawings for the hub tiles that have no item to show. */
const GLYPHS = {
	grenade: 'M9 3h6v3H9zM8 6h8l1 3a7 7 0 1 1-10 0z M12 11v6 M9 14h6',
	skills: 'M12 2l2.6 6.5L21 9l-5 4.4L17.4 20 12 16.6 6.6 20 8 13.4 3 9l6.4-.5z',
	shop: 'M4 7h16l-1.5 12h-13zM9 7a3 3 0 0 1 6 0',
	profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'
} as const

/** A hub tile: a picture of the thing (or a glyph) over its name, leading to its screen. */
function HubTile({
	to,
	tab,
	label,
	picture,
	glyph
}: {
	to: '/play/armory' | '/play/skills' | '/play/shop' | '/play/profile'
	tab?: 'weapons' | 'armour' | 'equipment'
	label: string
	picture?: string | null
	glyph?: keyof typeof GLYPHS
}) {
	return (
		<li className="flex">
			<Link
				to={to}
				search={tab ? { tab } : {}}
				className={cn(
					'frame cut group flex aspect-square w-full flex-col items-center justify-center gap-2 p-3 hover:[--frame-color:var(--color-rot-lime)]',
					glass
				)}
			>
				{picture ? (
					<img src={picture} alt="" width={160} height={90} className="h-16 w-full object-contain" />
				) : glyph ? (
					<svg
						viewBox="0 0 24 24"
						className="size-12 text-bone/80 group-hover:text-rot-lime"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.5}
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d={GLYPHS[glyph]} />
					</svg>
				) : null}
				<span className="font-bold text-sm uppercase tracking-[0.18em] group-hover:text-rot-lime">{label}</span>
			</Link>
		</li>
	)
}

/** The player's card: who they are, the class they go out as and how far into its next level, and Salvage. */
function PlayerCard() {
	const { data: me } = useSuspenseQuery(meQuery)
	const progress = useQuery(progressQuery)
	const player = me.status === 'signed-in' ? me.player : null
	const avatar = useAvatar((player?.avatarStyle ?? 'pixel-art') as AvatarStyle, player?.avatarSeed ?? '')
	const view = progress.data
	if (!player || !view) return null
	const cls = view.classes[view.activeClass]
	const share = cls.next ? cls.into / cls.next : 1
	return (
		<section
			aria-label={player.name}
			className={cn(
				'frame cut flex w-full max-w-lg items-center gap-4 p-3 [--frame-color:var(--color-rot-lime)]',
				glass
			)}
		>
			<AvatarFrame src={avatar} alt="" size={64} />
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="truncate font-display text-2xl uppercase">{player.name}</span>
				<span className="flex items-baseline justify-between gap-2 text-sm">
					<span className="font-bold text-rot-lime uppercase tracking-[0.12em]">
						{en.app.progression.classes[view.activeClass].name} ·{' '}
						{format(en.app.progression.level, { level: String(cls.level) })}
					</span>
					<span className="text-muted tabular-nums">{salvage(view.salvage)}</span>
				</span>
				<span className="h-1.5 w-full bg-rot-black" aria-hidden="true">
					<span className="block h-full bg-rot-lime" style={{ width: `${Math.round(share * 100)}%` }} />
				</span>
			</span>
		</section>
	)
}

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
	const party = useQuery(partyQuery)
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const codeId = useId()
	const [code, setCode] = useState('')
	const [problem, setProblem] = useState<PartyProblem | null>(null)
	const [copied, setCopied] = useState<'code' | 'link' | null>(null)
	const [side, setSide] = useState<'squad' | 'friends'>('squad')
	const [picking, setPicking] = useState<MissionTab | null>(null)
	const [friendNote, setFriendNote] = useState<'sent' | 'failed' | null>(null)
	const progress = useQuery(progressQuery)
	const player = me.status === 'signed-in' ? me.player : null

	const view = party.data
	// following the leader into a mission is the game shell's job (it works from every screen)

	// invite links: /play/lobby?join=SQUAD and /play/lobby?friend=PLAYER (kept through signing in)
	useEffect(() => {
		const { join, friend } = takeLinkCodes()
		if (join)
			void partyActions.join(join).then(result => {
				if ('error' in result) setProblem(result.error)
				else queryClient.setQueryData(partyQuery.queryKey, result)
			})
		const code = friend ? asPlayerCode(friend) : null
		if (code)
			void friendActions.requestByCode(code).then(result => {
				setFriendNote('error' in result ? 'failed' : 'sent')
				void queryClient.invalidateQueries({ queryKey: friendsQuery.queryKey })
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
		await copyText(text)
		setCopied(which)
		setTimeout(() => setCopied(current => (current === which ? null : current)), 1500)
	}

	const youMember = view?.members.find(member => member.id === view.you)
	const isLeader = view?.leader === view?.you
	const solo = (view?.members.length ?? 1) === 1
	const inviteLink = view ? `${location.origin}/play/lobby?join=${view.code}` : ''
	const missionName = isSurvival(view?.mission.id)
		? `${en.app.missions.survival} · ${en.app.missions.arenas[view.mission.id].name}`
		: (missionById(view?.mission.id ?? '')?.name ?? '')
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
			{friendNote && (
				<p role="status" className={cn('text-sm', friendNote === 'sent' ? 'text-rot-lime' : 'text-alert')}>
					{friendNote === 'sent' ? en.app.friends.fromLink : en.app.friends.fromLinkFailed}
				</p>
			)}
		</div>
	)

	return (
		<GameShell backdrop={<HubBackdrop />}>
			<h1 className="sr-only">{t.title}</h1>
			{/* the hub, as in the games it takes after: kit on the left, where to go in the middle with
			    the player's card under it, the squad and the way out on the right */}
			<div
				className={cn(
					panes,
					'lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)_minmax(19rem,23rem)] lg:grid-rows-[minmax(0,1fr)]'
				)}
			>
				{/* left: the kit */}
				<nav aria-label={t.kitTitle} className={cn(pane, 'justify-center')}>
					<ul className="grid grid-cols-2 gap-2">
						<HubTile
							to="/play/armory"
							tab="weapons"
							label={t.tiles.weapons}
							picture={pictureOf(progress.data?.loadout.main1)}
						/>
						<HubTile
							to="/play/armory"
							tab="armour"
							label={t.tiles.armour}
							picture={pictureOf(progress.data?.loadout.armourVest ?? progress.data?.loadout.armourHead)}
						/>
						<HubTile to="/play/armory" tab="equipment" label={t.tiles.equipment} glyph="grenade" />
						<HubTile to="/play/skills" label={t.tiles.skills} glyph="skills" />
						<HubTile to="/play/shop" label={t.tiles.shop} glyph="shop" />
						<HubTile to="/play/profile" label={t.tiles.profile} glyph="profile" />
					</ul>
				</nav>

				{/* middle: where to go, then the player's card */}
				<div className="no-scrollbar flex min-h-0 flex-col items-center justify-between gap-4 lg:overflow-y-auto">
					<div className="flex w-full max-w-lg flex-col gap-3 pt-2">
						{view && (
							// the campaign: what the squad is about to play; it opens the mission picker
							<button
								type="button"
								onClick={() => setPicking(view && isMode(view.mission.id) ? 'modes' : 'campaign')}
								className={cn(
									'frame cut flex shrink-0 flex-col gap-1 p-5 text-left [--frame-color:var(--color-rot-lime)] hover:[--frame-color:var(--color-bone)]',
									glass
								)}
							>
								<span className="flex items-center justify-between gap-2">
									<span className="text-muted text-xs uppercase tracking-[0.2em]">{en.app.missions.title}</span>
									<span className="font-bold text-rot-lime text-xs uppercase tracking-[0.2em]">
										{isLeader && view.state === 'lobby' ? t.changeMission : t.seeMission}
									</span>
								</span>
								<span className="font-display text-4xl uppercase">{missionName}</span>
								<span className="text-muted text-sm">
									{isSurvival(view.mission.id)
										? `${en.app.missions.endless} · ${en.app.missions.arenas[view.mission.id].description}`
										: `${difficultyName} · ${missionById(view.mission.id)?.description ?? ''}`}
								</span>
							</button>
						)}
						{/* the game modes, set apart from the campaign above */}
						<section aria-label={t.modes} className="mt-3 flex flex-col gap-2">
							<h2 className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.modes}</h2>
							<div className="grid grid-cols-3 gap-3">
								<button
									type="button"
									disabled={!view}
									onClick={() =>
										// the first arena straight away; the panel offers the others
										isLeader && view?.state === 'lobby' && !isSurvival(view.mission.id)
											? void act(() => partyActions.mission(SURVIVAL, view.mission.difficulty))
											: setPicking('modes')
									}
									className={cn(
										'frame cut flex flex-col gap-1 p-4 text-left disabled:cursor-default hover:[--frame-color:var(--color-bone)]',
										glass,
										isSurvival(view?.mission.id) && '[--frame-color:var(--color-rot-lime)]'
									)}
								>
									<span className="font-display text-2xl uppercase">{en.app.missions.survival}</span>
									<span className="text-muted text-xs">{t.survivalHint}</span>
								</button>
								<button
									type="button"
									disabled={!view}
									onClick={() => setPicking('modes')}
									className={cn(
										'frame cut flex flex-col gap-1 p-4 text-left disabled:cursor-default hover:[--frame-color:var(--color-bone)]',
										glass,
										view && isContract(view.mission.id) && '[--frame-color:var(--color-rot-lime)]'
									)}
								>
									<span className="font-display text-2xl uppercase">{t.contracts}</span>
									<span className="text-muted text-xs">{t.contractsHint}</span>
								</button>
								<Link
									to="/play/range"
									className={cn('frame cut flex flex-col gap-1 p-4 hover:[--frame-color:var(--color-bone)]', glass)}
								>
									<span className="font-display text-2xl uppercase">{en.app.range.title}</span>
									<span className="text-muted text-xs">{t.rangeHint}</span>
								</Link>
							</div>
						</section>
					</div>
					<PlayerCard />
				</div>

				{/* right: the squad and the way in for others, or friends */}
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
								<span className="flex gap-2">
									<Button
										variant="secondary"
										size="sm"
										disabled={!view}
										onClick={() => void copy(view?.code ?? '', 'code')}
									>
										<StableLabel labels={[t.copyCode, t.copied]} current={copied === 'code' ? t.copied : t.copyCode} />
									</Button>
									{canShare() && (
										<Button
											size="sm"
											disabled={view?.state !== 'lobby'}
											onClick={() =>
												void shareLink({
													title: t.shareInviteTitle,
													text: format(t.shareInviteText, { code: view?.code ?? '' }),
													url: inviteLink
												})
											}
										>
											{t.shareInvite}
										</Button>
									)}
								</span>
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
					<div className="flex-1" />
					{deployBar}
				</div>
			</div>
			{picking && view && <MissionPicker view={view} tab={picking} onClose={() => setPicking(null)} />}
		</GameShell>
	)
}

/** Choosing where to go: the campaign or a game mode, and the difficulty, over the lobby. */
function MissionPicker({ view, tab, onClose }: { view: PartyView; tab: MissionTab; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null)
	useEffect(() => {
		dialog.current?.showModal()
	}, [])
	return (
		<dialog
			ref={dialog}
			aria-label={en.app.missions.title}
			onClose={onClose}
			className="m-auto h-[92dvh] w-[min(64rem,96vw)] overflow-hidden bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
		>
			{/* the missions scroll; Done stays in view under them */}
			<div className="flex h-full flex-col gap-3">
				<div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
					<MissionPanel view={view} tab={tab} />
				</div>
				<Button className="shrink-0 self-end" onClick={() => dialog.current?.close()}>
					{t.done}
				</Button>
			</div>
		</dialog>
	)
}
