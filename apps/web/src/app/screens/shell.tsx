import type { ReactNode } from 'react'

/**
 * Shared frame for the app's screens: hazard strip, logo, content. `fill` screens are game screens:
 * they use the whole window edge to edge and never scroll as a page; `nav` sits in the header row.
 */
export function Shell({
	children,
	aside,
	nav,
	backdrop,
	home = '/',
	fill = false
}: {
	children: ReactNode
	aside?: ReactNode
	nav?: ReactNode
	/** a scene drawn behind the whole screen (the lobby's squad) */
	backdrop?: ReactNode
	/** where the logo leads: inside the game it stays in the game */
	home?: string
	fill?: boolean
}) {
	const width = fill ? 'w-full px-4 lg:px-8' : 'mx-auto w-full max-w-6xl px-6'
	return (
		<div className={fill ? 'game-ui relative isolate flex h-dvh flex-col overflow-hidden' : 'contents'}>
			{backdrop && <div className="absolute inset-0 -z-10">{backdrop}</div>}
			<div className="hazard h-1.5 w-full shrink-0 opacity-80" aria-hidden="true" />
			<header
				className={`${width} flex shrink-0 items-center justify-between gap-4 ${fill ? 'border-line border-b border-dashed py-2' : 'py-5'} ${backdrop ? 'bg-gradient-to-b from-rot-black/90 to-rot-black/40' : ''}`}
			>
				<div className="flex min-w-0 items-center gap-6">
					<a href={home} aria-label={home === '/' ? 'Rotline home' : 'Lobby'} className="shrink-0">
						<img
							src="/brand/svg/rotline-logo-horizontal.svg"
							alt="Rotline"
							width={148}
							height={32}
							className={fill ? 'h-7 w-auto' : 'h-8 w-auto'}
						/>
					</a>
					{nav}
				</div>
				{aside}
			</header>
			<main className={fill ? `${width} flex min-h-0 flex-1 flex-col py-4` : `${width} flex flex-1 flex-col pb-16`}>
				{children}
			</main>
		</div>
	)
}
