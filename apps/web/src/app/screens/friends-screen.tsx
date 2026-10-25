import { useEffect, useId, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import { AvatarFrame, Badge, Button, cn, Input, Label, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { useAvatar } from '../../lib/avatar.ts'
import {
	type FoundPlayer,
	type FriendCard,
	type FriendProblem,
	formatCode,
	friendActions,
	friendLink,
	friendsQuery,
	type PresenceStatus,
	searchPlayers
} from '../../lib/friends.ts'
import { partyQuery } from '../../lib/party.ts'
import { canShare, copyText, shareLink } from '../../lib/share.ts'
import { GameShell } from './game-shell.tsx'
import { pane, panes } from './layout.ts'
import { StableLabel } from './stable-label.tsx'

const t = en.app.friends
const classes = en.app.progression.classes

const dot: Record<PresenceStatus, string> = {
	lobby: 'bg-rot-lime',
	mission: 'bg-warning',
	queue: 'bg-bone',
	range: 'bg-rot-lime',
	offline: 'bg-line'
}

type Tab = 'friends' | 'find' | 'recent' | 'blocked'

function Row({
	card,
	status,
	note,
	children
}: {
	card: FriendCard
	status?: PresenceStatus | undefined
	note?: string | undefined
	children?: React.ReactNode
}) {
	const avatar = useAvatar(card.avatarStyle as AvatarStyle, card.avatarSeed)
	return (
		<li
			className={cn(
				'frame cut-sm flex items-center gap-3 px-3 py-2 [--frame-fill:rgb(13_16_14/0.7)]',
				status === 'offline' && 'opacity-60'
			)}
		>
			<AvatarFrame src={avatar} alt="" size={40} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-bold">{card.name}</span>
				<span className="flex items-center gap-1.5 text-muted text-xs">
					{status && <span className={cn('inline-block size-2', dot[status])} aria-hidden="true" />}
					{status ? t.presence[status] : classes[card.activeClass].name}
					{note ? <span className="text-rot-lime">· {note}</span> : null}
				</span>
			</div>
			<div className="flex shrink-0 flex-wrap justify-end gap-1">{children}</div>
		</li>
	)
}

/** The player's own code, to copy or send from the device's share sheet. */
function CodeCard({ code }: { code: string }) {
	const [done, setDone] = useState<'code' | 'link' | null>(null)
	const flash = (which: 'code' | 'link') => {
		setDone(which)
		setTimeout(() => setDone(current => (current === which ? null : current)), 1500)
	}
	const share = async () => {
		const result = await shareLink({
			title: t.shareTitle,
			text: format(t.shareText, { code: formatCode(code) }),
			url: friendLink(code)
		})
		if (result === 'copied') flash('link')
	}
	return (
		<Panel>
			<PanelHeader>
				<PanelTitle>{t.yourCode}</PanelTitle>
			</PanelHeader>
			<span data-testid="friend-code" className="font-display text-4xl text-rot-lime tracking-[0.12em]">
				{code ? formatCode(code) : '····-····'}
			</span>
			<p className="text-muted text-sm">{t.codeHint}</p>
			<div className="grid grid-cols-2 gap-2">
				<Button
					variant="secondary"
					size="sm"
					disabled={!code}
					onClick={() => void copyText(formatCode(code)).then(() => flash('code'))}
				>
					<StableLabel labels={[t.copyCode, t.copied]} current={done === 'code' ? t.copied : t.copyCode} />
				</Button>
				<Button size="sm" disabled={!code} onClick={() => void share()}>
					<StableLabel
						labels={[t.share, t.copyLink, t.copied]}
						current={done === 'link' ? t.copied : canShare() ? t.share : t.copyLink}
					/>
				</Button>
			</div>
		</Panel>
	)
}

/** Searching players by name (or a close spelling, or a code), with an action for each. */
function FindPlayers({ onAct }: { onAct: (action: () => ReturnType<typeof friendActions.accept>) => Promise<void> }) {
	const searchId = useId()
	const [query, setQuery] = useState('')
	const [found, setFound] = useState<FoundPlayer[] | null>(null)
	const [busy, setBusy] = useState(false)
	useEffect(() => {
		const text = query.trim()
		if (text.length < 2) {
			setFound(null)
			return
		}
		// wait for a pause in typing, and ignore answers to older searches
		let current = true
		setBusy(true)
		const timer = setTimeout(() => {
			void searchPlayers(text).then(players => {
				if (!current) return
				setFound(players)
				setBusy(false)
			})
		}, 300)
		return () => {
			current = false
			clearTimeout(timer)
		}
	}, [query])

	const act = async (action: () => ReturnType<typeof friendActions.accept>) => {
		await onAct(action)
		const text = query.trim()
		if (text.length >= 2) setFound(await searchPlayers(text))
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={searchId}>{t.search}</Label>
				<Input
					id={searchId}
					type="search"
					value={query}
					maxLength={32}
					autoComplete="off"
					placeholder={t.searchPlaceholder}
					onChange={event => setQuery(event.target.value)}
				/>
				<span className="text-muted text-xs">{busy ? t.searching : t.searchHint}</span>
			</div>
			{found && found.length === 0 && !busy && <p className="text-muted text-sm">{t.noResults}</p>}
			<ul className="flex flex-col gap-2">
				{found?.map(player => (
					<Row key={player.id} card={player} note={t.relation[player.relation] || undefined}>
						{player.relation === 'none' && (
							<Button size="sm" onClick={() => void act(() => friendActions.request(player.name))}>
								{t.addFriend}
							</Button>
						)}
						{player.relation === 'incoming' && (
							<Button size="sm" onClick={() => void act(() => friendActions.accept(player.id))}>
								{t.accept}
							</Button>
						)}
						{player.relation === 'outgoing' && (
							<Button size="sm" variant="ghost" onClick={() => void act(() => friendActions.remove(player.id))}>
								{t.cancel}
							</Button>
						)}
						{player.relation !== 'friend' && (
							<Button size="sm" variant="ghost" onClick={() => void act(() => friendActions.block(player.id))}>
								{t.block}
							</Button>
						)}
					</Row>
				))}
			</ul>
		</div>
	)
}

/** Friends in full: your code, requests, everyone you know, finding new players, recent squadmates, blocks. */
export function FriendsScreen() {
	const friends = useQuery(friendsQuery)
	const party = useQuery(partyQuery)
	const queryClient = useQueryClient()
	const nameId = useId()
	const [tab, setTab] = useState<Tab>('friends')
	const [name, setName] = useState('')
	const [note, setNote] = useState<{ text: string; tone: 'ok' | 'alert' } | null>(null)
	const [invited, setInvited] = useState<ReadonlySet<string>>(new Set())
	const view = friends.data
	const squad = party.data?.members.map(member => member.id) ?? []

	const refresh = () => void queryClient.invalidateQueries({ queryKey: friendsQuery.queryKey })
	const problemText = (error: FriendProblem) =>
		error === 'full' || error === 'in-mission' ? en.app.lobby.problems[error] : t.notFound
	async function act(action: () => ReturnType<typeof friendActions.accept>) {
		setNote(null)
		const result = await action()
		if ('error' in result) setNote({ text: problemText(result.error), tone: 'alert' })
		refresh()
		return result
	}
	const quiet = async (action: () => ReturnType<typeof friendActions.accept>) => {
		await act(action)
	}

	const online = view?.friends.filter(friend => friend.presence.status !== 'offline').length ?? 0
	const tabs: { id: Tab; label: string; count?: number }[] = [
		{ id: 'friends', label: t.tabs.friends, count: view?.friends.length ?? 0 },
		{ id: 'find', label: t.tabs.find },
		{ id: 'recent', label: t.tabs.recent, count: view?.recent.length ?? 0 },
		{ id: 'blocked', label: t.tabs.blocked, count: view?.blocked.length ?? 0 }
	]

	return (
		<GameShell>
			<h1 className="sr-only">{t.title}</h1>
			<div className={cn(panes, 'lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]')}>
				{/* left: your code, adding someone, and requests */}
				<div className={pane}>
					<CodeCard code={view?.code ?? ''} />
					<Panel>
						<form
							className="flex flex-col gap-2"
							onSubmit={event => {
								event.preventDefault()
								if (!name.trim()) return
								void act(() => friendActions.request(name.trim())).then(result => {
									if ('status' in result) {
										setNote({ text: result.status === 'friends' ? t.alreadyFriends : t.requested, tone: 'ok' })
										setName('')
									}
								})
							}}
						>
							<Label htmlFor={nameId}>{t.addByName}</Label>
							<div className="flex gap-2">
								<Input
									id={nameId}
									value={name}
									maxLength={32}
									placeholder={t.addPlaceholder2}
									autoComplete="off"
									onChange={event => setName(event.target.value)}
								/>
								<Button type="submit" variant="secondary" disabled={!name.trim()}>
									{t.send}
								</Button>
							</div>
						</form>
						{note && (
							<p role="status" className={cn('text-sm', note.tone === 'alert' ? 'text-alert' : 'text-rot-lime')}>
								{note.text}
							</p>
						)}
					</Panel>
					<Panel>
						<PanelHeader>
							<PanelTitle>{t.incoming}</PanelTitle>
							{view && view.incoming.length > 0 && <Badge tone="lime">{view.incoming.length}</Badge>}
						</PanelHeader>
						{view && view.incoming.length === 0 && view.outgoing.length === 0 && (
							<p className="text-muted text-sm">{t.noRequests}</p>
						)}
						<ul className="flex flex-col gap-2">
							{view?.incoming.map(card => (
								<Row key={card.id} card={card}>
									<Button size="sm" onClick={() => void quiet(() => friendActions.accept(card.id))}>
										{t.accept}
									</Button>
									<Button size="sm" variant="ghost" onClick={() => void quiet(() => friendActions.remove(card.id))}>
										{t.decline}
									</Button>
								</Row>
							))}
						</ul>
						{view && view.outgoing.length > 0 && (
							<>
								<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.outgoing}</span>
								<ul className="flex flex-col gap-2">
									{view.outgoing.map(card => (
										<Row key={card.id} card={card}>
											<Button size="sm" variant="ghost" onClick={() => void quiet(() => friendActions.remove(card.id))}>
												{t.cancel}
											</Button>
										</Row>
									))}
								</ul>
							</>
						)}
					</Panel>
				</div>

				{/* right: the lists */}
				<div className={pane}>
					<Panel>
						<PanelHeader>
							<PanelTitle>{t.title}</PanelTitle>
							<span className="font-bold text-muted text-sm">{format(t.online, { count: String(online) })}</span>
						</PanelHeader>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label={t.title}>
							{tabs.map(entry => (
								<button
									key={entry.id}
									type="button"
									role="tab"
									aria-selected={tab === entry.id}
									onClick={() => setTab(entry.id)}
									className={cn(
										'frame cut-sm flex items-center justify-between gap-2 px-3 py-2 font-bold text-sm uppercase tracking-[0.15em]',
										tab === entry.id
											? 'text-rot-lime [--frame-color:var(--color-rot-lime)]'
											: 'text-muted hover:text-bone hover:[--frame-color:var(--color-bone)]'
									)}
								>
									{entry.label}
									{entry.count !== undefined && <span className="tabular-nums">{entry.count}</span>}
								</button>
							))}
						</div>

						{tab === 'friends' && (
							<ul className="flex flex-col gap-2">
								{view?.friends.length === 0 && <li className="text-muted text-sm">{t.none}</li>}
								{view?.friends.map(friend => {
									const together = squad.includes(friend.id)
									const isOnline = friend.presence.status !== 'offline'
									return (
										<Row
											key={friend.id}
											card={friend}
											status={friend.presence.status}
											note={friend.presence.detail || undefined}
										>
											{isOnline && !together && friend.presence.status !== 'mission' && (
												<Button
													size="sm"
													variant="secondary"
													disabled={invited.has(friend.id)}
													onClick={() =>
														void act(() => friendActions.invite(friend.id)).then(result => {
															if ('status' in result) setInvited(previous => new Set(previous).add(friend.id))
														})
													}
												>
													{invited.has(friend.id) ? t.invited : t.invite}
												</Button>
											)}
											{friend.presence.status === 'lobby' && !together && (
												<Button
													size="sm"
													variant="ghost"
													onClick={() =>
														void act(() => friendActions.join(friend.id)).then(() =>
															queryClient.invalidateQueries({ queryKey: partyQuery.queryKey })
														)
													}
												>
													{t.joinThem}
												</Button>
											)}
											<Button
												size="sm"
												variant="ghost"
												onClick={() => void quiet(() => friendActions.remove(friend.id))}
											>
												{t.remove}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => void quiet(() => friendActions.block(friend.id))}
											>
												{t.block}
											</Button>
										</Row>
									)
								})}
							</ul>
						)}

						{tab === 'find' && <FindPlayers onAct={quiet} />}

						{tab === 'recent' && (
							<ul className="flex flex-col gap-2">
								{view?.recent.length === 0 && <li className="text-muted text-sm">{t.noRecent}</li>}
								{view?.recent.map(card => (
									<Row key={card.id} card={card}>
										<Button
											size="sm"
											variant="secondary"
											onClick={() => void quiet(() => friendActions.request(card.name))}
										>
											{t.addFriend}
										</Button>
										<Button size="sm" variant="ghost" onClick={() => void quiet(() => friendActions.block(card.id))}>
											{t.block}
										</Button>
									</Row>
								))}
							</ul>
						)}

						{tab === 'blocked' && (
							<ul className="flex flex-col gap-2">
								{view?.blocked.length === 0 && <li className="text-muted text-sm">{t.noBlocked}</li>}
								{view?.blocked.map(card => (
									<Row key={card.id} card={card}>
										<Button size="sm" variant="ghost" onClick={() => void quiet(() => friendActions.unblock(card.id))}>
											{t.unblock}
										</Button>
									</Row>
								))}
							</ul>
						)}
					</Panel>
				</div>
			</div>
		</GameShell>
	)
}
