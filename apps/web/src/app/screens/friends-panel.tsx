import { useId, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import { AvatarFrame, Button, cn, Input, Label, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { en } from '../../i18n/en.ts'
import { useAvatar } from '../../lib/avatar.ts'
import {
	type FriendCard,
	type FriendProblem,
	friendActions,
	friendsQuery,
	type PresenceStatus
} from '../../lib/friends.ts'
import { partyQuery } from '../../lib/party.ts'

const t = en.app.friends

const dot: Record<PresenceStatus, string> = {
	lobby: 'bg-rot-lime',
	mission: 'bg-warning',
	queue: 'bg-bone',
	range: 'bg-rot-lime',
	offline: 'bg-line'
}

function Row({ card, status, children }: { card: FriendCard; status?: PresenceStatus; children: React.ReactNode }) {
	const avatar = useAvatar(card.avatarStyle as AvatarStyle, card.avatarSeed)
	return (
		<li className={cn('flex items-center gap-3', status === 'offline' && 'opacity-60')}>
			<AvatarFrame src={avatar} alt="" size={36} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-bold">{card.name}</span>
				{status && (
					<span className="flex items-center gap-1.5 text-muted text-xs">
						<span className={cn('inline-block size-2', dot[status])} aria-hidden="true" />
						{t.presence[status]}
					</span>
				)}
			</div>
			<div className="flex shrink-0 gap-1">{children}</div>
		</li>
	)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{title}</span>
			<ul className="flex flex-col gap-2">{children}</ul>
		</div>
	)
}

/** Friends with live presence, requests, invites and recent squadmates. */
export function FriendsPanel({ squad }: { squad: readonly string[] }) {
	const friends = useQuery(friendsQuery)
	const queryClient = useQueryClient()
	const nameId = useId()
	const [name, setName] = useState('')
	const [note, setNote] = useState<{ text: string; tone: 'ok' | 'alert' } | null>(null)
	const [invited, setInvited] = useState<ReadonlySet<string>>(new Set())
	const view = friends.data

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

	return (
		<Panel>
			<PanelHeader>
				<PanelTitle>{t.title}</PanelTitle>
				<span className="font-bold text-muted text-sm">
					{view?.friends.filter(friend => friend.presence.status !== 'offline').length ?? 0} /{' '}
					{view?.friends.length ?? 0}
				</span>
			</PanelHeader>
			<Link to="/play/friends" className="font-bold text-rot-lime text-xs uppercase tracking-[0.2em] hover:text-bone">
				{t.manage} →
			</Link>
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
				<Label htmlFor={nameId}>{t.add}</Label>
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

			{view && view.incoming.length > 0 && (
				<Section title={t.incoming}>
					{view.incoming.map(card => (
						<Row key={card.id} card={card}>
							<Button size="sm" onClick={() => void act(() => friendActions.accept(card.id))}>
								{t.accept}
							</Button>
							<Button size="sm" variant="ghost" onClick={() => void act(() => friendActions.remove(card.id))}>
								{t.decline}
							</Button>
						</Row>
					))}
				</Section>
			)}

			{view && (
				<Section title={t.title}>
					{view.friends.length === 0 && <li className="text-muted text-sm">{t.none}</li>}
					{view.friends.map(friend => {
						const together = squad.includes(friend.id)
						const online = friend.presence.status !== 'offline'
						return (
							<Row key={friend.id} card={friend} status={friend.presence.status}>
								{online && !together && friend.presence.status !== 'mission' && (
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
									aria-label={`${t.remove} ${friend.name}`}
									title={t.remove}
									onClick={() => void act(() => friendActions.remove(friend.id))}
								>
									×
								</Button>
							</Row>
						)
					})}
				</Section>
			)}

			{view && view.outgoing.length > 0 && (
				<Section title={t.outgoing}>
					{view.outgoing.map(card => (
						<Row key={card.id} card={card}>
							<Button size="sm" variant="ghost" onClick={() => void act(() => friendActions.remove(card.id))}>
								{t.cancel}
							</Button>
						</Row>
					))}
				</Section>
			)}

			{view && view.recent.length > 0 && (
				<Section title={t.recent}>
					{view.recent.slice(0, 8).map(card => (
						<Row key={card.id} card={card}>
							<Button size="sm" variant="secondary" onClick={() => void act(() => friendActions.request(card.name))}>
								{t.addFriend}
							</Button>
							<Button size="sm" variant="ghost" onClick={() => void act(() => friendActions.block(card.id))}>
								{t.block}
							</Button>
						</Row>
					))}
				</Section>
			)}

			{view && view.blocked.length > 0 && (
				<details className="group">
					<summary className="cursor-pointer font-bold text-muted text-xs uppercase tracking-[0.2em] hover:text-bone">
						{t.blocked} ({view.blocked.length})
					</summary>
					<ul className="mt-2 flex flex-col gap-2">
						{view.blocked.map(card => (
							<Row key={card.id} card={card}>
								<Button size="sm" variant="ghost" onClick={() => void act(() => friendActions.unblock(card.id))}>
									{t.unblock}
								</Button>
							</Row>
						))}
					</ul>
				</details>
			)}
		</Panel>
	)
}
