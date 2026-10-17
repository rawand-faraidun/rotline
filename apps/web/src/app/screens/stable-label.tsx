import { cn } from '@rotline/ui'

/**
 * Button text that changes (Copy → Copied, Ready → Not ready) without moving anything: every label
 * takes the same cell, so the button keeps the width of the longest one.
 */
export function StableLabel({ labels, current }: { labels: readonly string[]; current: string }) {
	return (
		<span className="inline-grid">
			{labels.map(label => (
				<span
					key={label}
					className={cn('col-start-1 row-start-1 text-center', label !== current && 'invisible')}
					aria-hidden={label !== current}
				>
					{label}
				</span>
			))}
		</span>
	)
}
