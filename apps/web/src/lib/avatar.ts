import { useEffect, useState } from 'react'
import type { AvatarStyle } from '@rotline/constants'
import { Avatar, Style } from '@dicebear/core'

type StyleModule = { default: ConstructorParameters<typeof Style>[0] }

// Loaded on demand, so only the styles a player sees are downloaded
const loaders: Record<AvatarStyle, () => Promise<StyleModule>> = {
	'pixel-art': () => import('@dicebear/styles/pixel-art.json'),
	'pixel-art-neutral': () => import('@dicebear/styles/pixel-art-neutral.json'),
	pixelbot: () => import('@dicebear/styles/pixelbot.json'),
	lorelei: () => import('@dicebear/styles/lorelei.json'),
	notionists: () => import('@dicebear/styles/notionists.json'),
	'open-peeps': () => import('@dicebear/styles/open-peeps.json')
}

const styles = new Map<AvatarStyle, Promise<Style>>()
const rendered = new Map<string, string>()

function loadStyle(name: AvatarStyle): Promise<Style> {
	let style = styles.get(name)
	if (!style) {
		style = loaders[name]().then(module => new Style(module.default))
		styles.set(name, style)
	}
	return style
}

export async function avatarDataUri(style: AvatarStyle, seed: string): Promise<string> {
	const key = `${style}:${seed}`
	const cached = rendered.get(key)
	if (cached) return cached
	const uri = new Avatar(await loadStyle(style), { seed }).toDataUri()
	rendered.set(key, uri)
	return uri
}

/** A data URI for the avatar, or a blank pixel while it renders. */
export function useAvatar(style: AvatarStyle, seed: string): string {
	const [uri, setUri] = useState(() => rendered.get(`${style}:${seed}`) ?? BLANK)
	useEffect(() => {
		let live = true
		void avatarDataUri(style, seed).then(next => live && setUri(next))
		return () => {
			live = false
		}
	}, [style, seed])
	return uri
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='

export function randomSeed(): string {
	return crypto.randomUUID().slice(0, 12)
}
