import type { ComponentProps } from 'react'
import { Label as LabelPrimitive } from 'radix-ui'
import { cn } from '../lib/cn.ts'

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
	return (
		<LabelPrimitive.Root
			data-slot="label"
			className={cn('font-bold text-muted text-xs uppercase tracking-[0.2em]', className)}
			{...props}
		/>
	)
}
