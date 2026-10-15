import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

/** Square, cut-corner frame for generated avatars. */
export function AvatarFrame({
	src,
	alt,
	size = 64,
	className,
	...props
}: Omit<ComponentProps<'span'>, 'children'> & { src: string; alt: string; size?: number }) {
	return (
		<span
			data-slot="avatar"
			className={cn('frame cut-sm inline-block shrink-0 p-[3px] [--frame-color:var(--color-line)]', className)}
			style={{ width: size, height: size }}
			{...props}
		>
			<img
				src={src}
				alt={alt}
				width={size - 6}
				height={size - 6}
				className="cut-sm block size-full bg-surface-raised"
			/>
		</span>
	)
}
