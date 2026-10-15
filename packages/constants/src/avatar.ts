// DiceBear styles offered to players. All are CC0, so no attribution is needed.
export const AVATAR_STYLES = [
	'pixel-art',
	'pixel-art-neutral',
	'pixelbot',
	'lorelei',
	'notionists',
	'open-peeps'
] as const

export type AvatarStyle = (typeof AVATAR_STYLES)[number]

export const AVATAR_SEED_MAX = 64

export function isAvatarStyle(value: string): value is AvatarStyle {
	return (AVATAR_STYLES as readonly string[]).includes(value)
}
