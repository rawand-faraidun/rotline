import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

// Restyled from shadcn/ui's Card: a worn panel with cut corners and a hard border.
export function Panel({ className, ...props }: ComponentProps<'section'>) {
	return <section data-slot="panel" className={cn('frame cut-lg flex flex-col gap-5 p-6', className)} {...props} />
}

export function PanelHeader({ className, ...props }: ComponentProps<'header'>) {
	return (
		<header
			data-slot="panel-header"
			className={cn('flex items-baseline justify-between gap-4 border-line border-b border-dashed pb-3', className)}
			{...props}
		/>
	)
}

export function PanelTitle({ className, ...props }: ComponentProps<'h2'>) {
	return (
		<h2 data-slot="panel-title" className={cn('font-display text-2xl text-bone uppercase', className)} {...props} />
	)
}

export function PanelDescription({ className, ...props }: ComponentProps<'p'>) {
	return <p data-slot="panel-description" className={cn('text-muted text-sm', className)} {...props} />
}
