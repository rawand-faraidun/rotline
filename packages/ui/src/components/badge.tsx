import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn.ts'

const badgeVariants = cva(
	'cut-sm cut inline-flex items-center gap-1 px-2 py-0.5 font-bold text-[11px] uppercase tracking-[0.15em]',
	{
		variants: {
			tone: {
				lime: 'bg-rot-lime text-rot-black',
				bone: 'bg-bone text-rot-black',
				muted: 'bg-surface-raised text-muted',
				alert: 'bg-alert text-rot-black',
				warning: 'bg-warning text-rot-black'
			}
		},
		defaultVariants: { tone: 'muted' }
	}
)

export function Badge({ className, tone, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
	return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}
