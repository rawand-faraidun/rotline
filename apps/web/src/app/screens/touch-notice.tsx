import { buttonVariants, cn } from '@rotline/ui'
import { en } from '../../i18n/en.ts'

const t = en.touchOnly

/**
 * Shown instead of the game on a device with no mouse or trackpad (a phone or a tablet): the game
 * is played with a keyboard and mouse, so nobody signs in only to find they cannot play.
 */
export function TouchNotice() {
	return (
		<div className="fixed inset-0 z-50 touch-only:flex hidden flex-col items-center justify-center gap-6 bg-rot-black px-6 text-center">
			<div className="hazard absolute inset-x-0 top-0 h-1.5 opacity-80" aria-hidden="true" />
			<img src="/brand/svg/rotline-mark.svg" alt="" width={72} height={72} className="size-18" />
			<p className="cut-sm bg-warning px-3 py-1 font-bold text-rot-black text-xs uppercase tracking-[0.3em]">
				{t.kicker}
			</p>
			<h1 className="max-w-sm font-display text-3xl uppercase">{t.title}</h1>
			<p className="max-w-sm text-bone/85 leading-relaxed">{t.body}</p>
			<a href="/" className={cn(buttonVariants({ variant: 'secondary' }))}>
				{t.home}
			</a>
		</div>
	)
}
