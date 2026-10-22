/**
 * The hub's background, in the spirit of the games it takes after: no scene, a dark field with a
 * faint grid, a slow glow in the middle and the Rotline mark large behind the menus.
 */
export function HubBackdrop() {
	return (
		<div className="absolute inset-0 overflow-hidden bg-rot-black" aria-hidden="true">
			{/* the grid, fading out toward the edges */}
			<div
				className="absolute inset-0 opacity-[0.07] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
				style={{
					backgroundImage:
						'linear-gradient(var(--color-rot-lime) 1px, transparent 1px), linear-gradient(90deg, var(--color-rot-lime) 1px, transparent 1px)',
					backgroundSize: '48px 48px'
				}}
			/>
			{/* the glow, breathing slowly */}
			<div className="absolute top-1/2 left-1/2 size-[70vmin] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-[radial-gradient(circle,rgb(184_242_60/0.12),transparent_65%)] [animation-duration:6s]" />
			{/* rings like a scope, and the mark inside them */}
			<div className="absolute top-1/2 left-1/2 size-[64vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-rot-lime/10" />
			<div className="absolute top-1/2 left-1/2 size-[48vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-rot-lime/10 border-dashed" />
			<img
				src="/brand/svg/rotline-mark-onecolor-light.svg"
				alt=""
				className="absolute top-1/2 left-1/2 w-[30vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.05]"
			/>
			{/* darker corners */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgb(0_0_0/0.75))]" />
		</div>
	)
}
