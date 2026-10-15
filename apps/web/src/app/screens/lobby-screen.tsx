import type { AvatarStyle } from '@rotline/constants'
import { AvatarFrame, Badge, Button, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { en } from '../../i18n/en.ts'
import { signOut } from '../../lib/api.ts'
import { useAvatar } from '../../lib/avatar.ts'
import { meQuery } from '../app.tsx'
import { Shell } from './shell.tsx'

const t = en.app.lobby

export function LobbyScreen() {
	const { data: me } = useSuspenseQuery(meQuery)
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const player = me.status === 'signed-in' ? me.player : null
	const avatar = useAvatar((player?.avatarStyle ?? 'pixel-art') as AvatarStyle, player?.avatarSeed ?? '')
	if (!player) return null

	const leave = async () => {
		await signOut()
		queryClient.clear()
		await navigate({ to: '/play' })
	}

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
						<span className="font-bold text-muted text-sm">1 / 4</span>
					</PanelHeader>
					<ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
						<li className="frame cut flex flex-col items-center gap-3 p-4 [--frame-color:var(--color-rot-lime)]">
							<AvatarFrame src={avatar} alt="" size={88} />
							<span className="font-bold">{player.name}</span>
							<Badge tone="lime">{t.classes[player.activeClass]}</Badge>
						</li>
						{[1, 2, 3].map(slot => (
							<li
								key={slot}
								className="frame cut flex min-h-44 items-center justify-center p-4 text-muted text-xs uppercase tracking-[0.2em] [--frame-fill:var(--color-rot-black)]"
							>
								{t.slotOpen}
							</li>
						))}
					</ul>
				</Panel>
				<Panel>
					<PanelHeader>
						<PanelTitle>{t.salvage}</PanelTitle>
						<span className="font-display text-3xl text-rot-lime tabular-nums">{player.salvage}</span>
					</PanelHeader>
					<p className="text-muted">{t.deployHint}</p>
					<Button size="lg" onClick={() => void navigate({ to: '/play/mission' })}>
						{t.deploy}
					</Button>
				</Panel>
			</div>
		</Shell>
	)
}
