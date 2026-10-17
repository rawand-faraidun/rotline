import type { ReactNode } from 'react'

/** A screen's title on one compact line with the screen's own controls beside it (the tabs say where you are). */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
	return (
		<div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
			<h1 className="font-display text-3xl uppercase md:text-4xl">{title}</h1>
			{children}
		</div>
	)
}
