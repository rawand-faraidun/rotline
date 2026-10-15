import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '../lib/cn.ts'

// Restyled from shadcn/ui's Button: hard edges, cut corners, stepped motion.
const buttonVariants = cva(
	'cut inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap font-bold uppercase tracking-[0.12em] transition-[background-color,color,translate] duration-100 ease-(--ease-snap) active:translate-y-px disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				primary: 'bg-rot-lime text-rot-black hover:bg-bone',
				secondary:
					'frame text-bone [--frame-color:var(--color-bone)] [--frame-fill:var(--color-rot-black)] hover:text-rot-lime hover:[--frame-color:var(--color-rot-lime)]',
				ghost: 'text-muted hover:bg-surface hover:text-bone',
				danger:
					'hazard text-rot-black [--hazard-a:var(--color-alert)] [--hazard-b:#c9401f] hover:[--hazard-a:var(--color-bone)]'
			},
			size: {
				sm: 'cut-sm h-8 px-3 text-xs',
				md: 'h-11 px-5 text-sm',
				lg: 'cut-lg h-14 px-8 text-base'
			}
		},
		defaultVariants: { variant: 'primary', size: 'md' }
	}
)

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
	const Comp = asChild ? Slot.Root : 'button'
	return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
