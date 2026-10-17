import { type ReactNode, useEffect, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import { AvatarFrame, Button, cn, Panel } from '@rotline/ui'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { en, format } from '../../i18n/en.ts'
import { signOut } from '../../lib/api.ts'
import { useAvatar } from '../../lib/avatar.ts'
import { salvage } from '../../lib/describe.ts'
import { type Invite, partyActions, partyQuery, usePlayerEvents } from '../../lib/party.ts'
import { progressQuery } from '../../lib/progress.ts'
import { leaveSeat } from '../../lib/seat.ts'
import { listenForClicks, uiSound } from '../../lib/ui-sound.ts'
import { meQuery } from '../app.tsx'
import { SeatKeeper } from './seat-keeper.tsx'
import { Shell } from './shell.tsx'

const t = en.app.progression

const tabs = [
	{ to: '/play/lobby', label: t.nav.lobby },
	{ to: '/play/skills', label: t.nav.skills },
	{ to: '/play/armory', label: t.nav.armory },
	{ to: '/play/shop', label: t.nav.shop },
	{ to: '/play/range', label: en.app.range.enter }
] as const

/**
 * The frame around the lobby, skills, armory and shop: navigation, Salvage, the player, the
 * event stream (squad, friends, invites, rewards) and the seat heartbeat.
 */
export function GameShell({ children }: { children: ReactNode }) {
	const { data: me } = useSuspenseQuery(meQuery)
	const progress = useQuery(progressQuery)
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const [invite, setInvite] = useState<Invite | null>(null)
	usePlayerEvents(invite => {
		uiSound('ui-notify')
		setInvite(invite)
	})
	useEffect(() => listenForClicks(), [])
	const player = me.status === 'signed-in' ? me.player : null
	const avatar = useAvatar((player?.avatarStyle ?? 'pixel-art') as AvatarStyle, player?.avatarSeed ?? '')
	if (!player) return null

	const leave = async () => {
		await leaveSeat()
		await signOut()
		queryClient.clear()
		await navigate({ to: '/play' })
	}

	return (
		<Shell
			fill
			aside={
				<div className="flex items-center gap-3">
					<span className="flex items-baseline gap-2" data-testid="salvage">
						<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.salvage}</span>
						<span className="font-display text-2xl text-rot-lime tabular-nums">
							{salvage(progress.data?.salvage ?? player.salvage)}
						</span>
					</span>
					<AvatarFrame src={avatar} alt="" size={40} />
					<span className="hidden font-bold tracking-wide sm:inline">{player.name}</span>
					<Button variant="ghost" size="sm" onClick={() => void leave()}>
						{en.app.lobby.signOut}
					</Button>
				</div>
			}
		>
			<SeatKeeper />
			<nav className="mb-6 flex shrink-0 flex-wrap gap-1 border-line border-b border-dashed" aria-label="Game">
				{tabs.map(tab => (
					<Link
						key={tab.to}
						to={tab.to}
						className={cn(
							'cut-sm -mb-px border-transparent border-b-2 px-4 py-2.5 font-bold text-muted text-sm uppercase tracking-[0.18em] hover:text-bone',
							'data-[status=active]:border-rot-lime data-[status=active]:text-rot-lime'
						)}
					>
						{tab.label}
					</Link>
				))}
			</nav>
			<div className="flex min-h-0 flex-1 flex-col">{children}</div>
			{invite && (
				<div role="status" className="fixed right-4 bottom-4 z-40 w-80">
					<Panel className="gap-3 [--frame-color:var(--color-rot-lime)]">
						<p className="font-bold">{format(en.app.friends.inviteToast, { name: invite.from })}</p>
						<div className="flex gap-2">
							<Button
								size="sm"
								onClick={() => {
									setInvite(null)
									void partyActions.join(invite.code).then(result => {
										if (!('error' in result)) queryClient.setQueryData(partyQuery.queryKey, result)
										void navigate({ to: '/play/lobby' })
									})
								}}
							>
								{en.app.friends.joinSquad}
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setInvite(null)}>
								{en.app.friends.dismiss}
							</Button>
						</div>
					</Panel>
				</div>
			)}
		</Shell>
	)
}
