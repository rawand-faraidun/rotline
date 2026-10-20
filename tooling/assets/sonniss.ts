// Sonniss GDC Game Audio Bundle files, fetched one at a time from the public mirror by HTTP range
// requests (the bundles are 9–48 GB each; only the few files the game uses are downloaded). The
// files are royalty-free for use in games but may not be redistributed as sound files, so the
// originals stay in the git-ignored cache and only the cut, re-encoded game sounds are committed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { cacheRoot } from './sources.ts'

const MIRROR = 'https://ftpmirror.your.org/pub/misc'
const cache = join(cacheRoot, 'sonniss')

/** The archive of a bundle year and part, e.g. `2019-2` (2015 is one archive: `2015`). */
function archiveUrl(archive: string): string {
	const [year, part] = archive.split('-') as [string, string | undefined]
	if (year === '2015') return `${MIRROR}/sonniss/sonniss.zip`
	const parts: Record<string, number> = { '2016': 6, '2017': 9, '2018': 8, '2019': 8 }
	const total = parts[year]
	if (!total || !part) throw new Error(`unknown Sonniss archive ${archive}`)
	const name =
		year === '2016'
			? `Sonniss.com - GDC 2016- Game Audio Bundle Part ${part}of${total}.zip`
			: `Sonniss.com - GDC ${year} - Game Audio Bundle Part ${part}of${total}.zip`
	return `${MIRROR}/sonniss${year}/${encodeURIComponent(name)}`
}

async function range(url: string, start: number, end: number): Promise<Buffer> {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url, { headers: { range: `bytes=${start}-${end}` } })
		if (response.status === 206) return Buffer.from(await response.arrayBuffer())
		if (attempt >= 3) throw new Error(`${url}: range request failed (${response.status})`)
	}
}

async function size(url: string): Promise<number> {
	const response = await fetch(url, { method: 'HEAD' })
	if (!response.ok) throw new Error(`${url}: ${response.status}`)
	return Number(response.headers.get('content-length'))
}

type Entry = { name: string; method: number; compressed: number; offset: number }

/** The archive's central directory (cached), read from its end without downloading the rest. */
export async function directory(archive: string): Promise<Map<string, Entry>> {
	const file = join(cache, `directory-${archive}.json`)
	if (existsSync(file)) return new Map(JSON.parse(readFileSync(file, 'utf8')) as [string, Entry][])
	const url = archiveUrl(archive)
	const total = await size(url)
	const tail = await range(url, Math.max(0, total - 65_558), total - 1)
	const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
	if (eocd < 0) throw new Error(`${archive}: no end of central directory`)
	let count = tail.readUInt16LE(eocd + 10)
	let length = tail.readUInt32LE(eocd + 12)
	let start = tail.readUInt32LE(eocd + 16)
	// zip64: the real sizes are in the zip64 end record, found through its locator
	const locator = eocd - 20
	if (locator >= 0 && tail.readUInt32LE(locator) === 0x07064b50) {
		const at = Number(tail.readBigUInt64LE(locator + 8))
		const record = await range(url, at, at + 55)
		count = Number(record.readBigUInt64LE(32))
		length = Number(record.readBigUInt64LE(40))
		start = Number(record.readBigUInt64LE(48))
	}
	const data = await range(url, start, start + length - 1)
	const entries = new Map<string, Entry>()
	let at = 0
	for (let n = 0; n < count && data.readUInt32LE(at) === 0x02014b50; n++) {
		const method = data.readUInt16LE(at + 10)
		let compressed = data.readUInt32LE(at + 20)
		let uncompressed = data.readUInt32LE(at + 24)
		const nameLength = data.readUInt16LE(at + 28)
		const extraLength = data.readUInt16LE(at + 30)
		const commentLength = data.readUInt16LE(at + 32)
		let offset = data.readUInt32LE(at + 42)
		const name = data.toString('utf8', at + 46, at + 46 + nameLength)
		// zip64 extra field: 64-bit values for the fields that read 0xffffffff, in this order
		let extra = at + 46 + nameLength
		const extraEnd = extra + extraLength
		while (extra + 4 <= extraEnd) {
			const id = data.readUInt16LE(extra)
			const size = data.readUInt16LE(extra + 2)
			if (id === 0x0001) {
				let field = extra + 4
				if (uncompressed === 0xffffffff) {
					uncompressed = Number(data.readBigUInt64LE(field))
					field += 8
				}
				if (compressed === 0xffffffff) {
					compressed = Number(data.readBigUInt64LE(field))
					field += 8
				}
				if (offset === 0xffffffff) offset = Number(data.readBigUInt64LE(field))
			}
			extra += 4 + size
		}
		if (!name.endsWith('/')) entries.set(name, { name, method, compressed, offset })
		at = extraEnd + commentLength
	}
	mkdirSync(cache, { recursive: true })
	writeFileSync(file, JSON.stringify([...entries]))
	return entries
}

/** A file from a Sonniss bundle on disk (downloaded once into the cache). */
export async function sonnissFile(archive: string, path: string): Promise<string> {
	const target = join(cache, basename(path))
	if (existsSync(target)) return target
	const entry = (await directory(archive)).get(path)
	if (!entry) throw new Error(`${archive}: no ${path}`)
	const url = archiveUrl(archive)
	const header = await range(url, entry.offset, entry.offset + 29)
	if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${path}: bad local header`)
	const dataStart = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
	const raw = await range(url, dataStart, dataStart + entry.compressed - 1)
	const data = entry.method === 8 ? inflateRawSync(raw) : raw
	if (entry.method !== 0 && entry.method !== 8) throw new Error(`${path}: compression ${entry.method}`)
	mkdirSync(cache, { recursive: true })
	writeFileSync(target, data)
	return target
}
