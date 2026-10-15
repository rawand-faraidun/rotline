import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
	return (
		<span
			data-slot="input-frame"
			className="frame cut-sm block h-11 w-full [--frame-color:var(--color-line)] [--frame-fill:var(--color-rot-black)] focus-within:[--frame-color:var(--color-rot-lime)] has-aria-invalid:[--frame-color:var(--color-alert)]"
		>
			<input
				data-slot="input"
				type={type}
				className={cn(
					'h-full w-full bg-transparent px-3 font-medium text-bone tracking-wide outline-none placeholder:text-muted/60 disabled:opacity-40',
					className
				)}
				{...props}
			/>
		</span>
	)
}
