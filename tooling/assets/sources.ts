// Downloads shared by the asset scripts. Everything is fetched once into node_modules/.cache and
// unpacked there; delete the cache folder to fetch again.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Document } from '@gltf-transform/core'

const here = dirname(fileURLToPath(import.meta.url))
export const cacheRoot = join(here, 'node_modules', '.cache')
export const publicAssets = join(here, '..', '..', 'apps', 'web', 'public', 'assets')

/** A Sketchfab model's glTF on disk, through the download API (needs SKETCHFAB_API_TOKEN). */
export async function sketchfabModel(uid: string): Promise<string> {
	const folder = join(cacheRoot, 'models', uid)
	if (!existsSync(folder)) {
		const token = process.env.SKETCHFAB_API_TOKEN
		if (!token) throw new Error('set SKETCHFAB_API_TOKEN (from the setup secrets) to download models')
		mkdirSync(dirname(folder), { recursive: true })
		const response = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
			headers: { authorization: `Token ${token}` }
		})
		if (!response.ok) throw new Error(`${uid}: download link refused (${response.status})`)
		const links = (await response.json()) as { gltf?: { url: string } }
		if (!links.gltf) throw new Error(`${uid}: no glTF download`)
		const archive = await fetch(links.gltf.url)
		const zip = `${folder}.zip`
		writeFileSync(zip, Buffer.from(await archive.arrayBuffer()))
		execFileSync('unzip', ['-q', '-o', zip, '-d', folder])
	}
	const gltf = readdirSync(folder).find(file => file.endsWith('.gltf'))
	if (!gltf) throw new Error(`${uid}: no .gltf in the archive`)
	return join(folder, gltf)
}

/**
 * A free itch.io download, unpacked: the same steps the page's "No thanks, just take me to the
 * downloads" button takes. If itch changes its page, download the file by hand into
 * node_modules/.cache/itch/<game>/ and unpack it into x/.
 */
export async function itchDownload(creator: string, game: string, file: string): Promise<string> {
	const folder = join(cacheRoot, 'itch', game)
	const unpacked = join(folder, 'x')
	if (existsSync(unpacked)) return unpacked
	mkdirSync(folder, { recursive: true })
	const base = `https://${creator}.itch.io/${game}`
	let cookies = ''
	const get = async (url: string, init: RequestInit = {}) => {
		const response = await fetch(url, { ...init, headers: { ...init.headers, cookie: cookies }, redirect: 'follow' })
		const set = response.headers.getSetCookie().map(cookie => cookie.split(';')[0])
		if (set.length > 0) cookies = [cookies, ...set].filter(Boolean).join('; ')
		return response
	}
	const csrfOf = (html: string) => /csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? ''
	const form = (csrf: string) => ({
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ csrf_token: csrf })
	})
	// the game page hands out a download page, which lists the files
	const gamePage = await (await get(base)).text()
	const link = (await (await get(`${base}/download_url`, form(csrfOf(gamePage)))).json()) as { url?: string }
	if (!link.url) throw new Error(`${game}: itch gave no download page`)
	const page = await (await get(link.url)).text()
	const csrf = csrfOf(page)
	const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const upload = new RegExp(`data-upload_id="(\\d+)"[\\s\\S]{0,400}?title="${escaped}"`).exec(page)?.[1]
	if (!csrf || !upload) throw new Error(`${game}: no free download of ${file} on the page`)
	const response = await get(
		`${base}/file/${upload}?source=view_game&as_props=1&after_download_lightbox=true`,
		form(csrf)
	)
	const { url } = (await response.json()) as { url?: string }
	if (!url) throw new Error(`${game}: itch refused the download`)
	const zip = join(folder, 'pack.zip')
	writeFileSync(zip, Buffer.from(await (await fetch(url)).arrayBuffer()))
	execFileSync('unzip', ['-q', '-o', zip, '-d', unpacked])
	return unpacked
}

/**
 * Drops material extensions that make three.js use its costly physical material (transmission, for
 * one, renders the whole scene a second time every frame). Game assets look the same without them
 * from the camera's height. Emissive strength is cheap and kept.
 */
export function plainMaterials(document: Document): void {
	for (const extension of document.getRoot().listExtensionsUsed())
		if (
			extension.extensionName.startsWith('KHR_materials_') &&
			extension.extensionName !== 'KHR_materials_emissive_strength'
		)
			extension.dispose()
}
