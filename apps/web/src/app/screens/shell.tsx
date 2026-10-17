import type { ReactNode } from 'react'

/** Shared frame for the app's screens: hazard strip, logo, centred content. */
export function Shell({ children, aside, fill = false }: { children: ReactNode; aside?: ReactNode; fill?: boolean }) {
	// `fill`: the screen is exactly the window; its sections scroll, the page never does
	return (
		<div className={fill ? 'flex h-dvh flex-col overflow-hidden' : 'contents'}>
			<div className="hazard h-1.5 w-full opacity-80" aria-hidden="true" />
			<header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5">
				<a href="/" aria-label="Rotline home">
					<img
						src="/brand/svg/rotline-logo-horizontal.svg"
						alt="Rotline"
						width={148}
						height={32}
						className="h-8 w-auto"
					/>
				</a>
				{aside}
			</header>
			<main
				className={
					fill
						? 'mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6'
						: 'mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-16'
				}
			>
				{children}
			</main>
		</div>
	)
}
