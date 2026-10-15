import type { ComponentProps } from 'react'
import { Separator as SeparatorPrimitive } from 'radix-ui'
import { cn } from '../lib/cn.ts'

export function Separator({ className, ...props }: ComponentProps<typeof SeparatorPrimitive.Root>) {
	return (
		<SeparatorPrimitive.Root
			data-slot="separator"
			className={cn(
				'shrink-0 border-line border-dashed data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=horizontal]:border-t data-[orientation=vertical]:border-l',
				className
			)}
			{...props}
		/>
	)
}
