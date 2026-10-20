// Builds the game's sound files from licence-checked sources: `pnpm assets:audio`.
// Most sounds come from the Sonniss GDC Game Audio Bundles (professional libraries, royalty-free in
// games; see sonniss.ts), a few from CC0 sources. Each source is fetched once (cached), the listed
// pieces are cut, brought to the loudness their kind of sound should have (guns loud, foley and
// interface quiet, so the game's mix starts balanced) with a limiter on the peaks, and written as
// small MP3s plus a manifest the client loads.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sonnissFile } from './sonniss.ts'

const here = dirname(fileURLToPath(import.meta.url))
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string
const cache = join(here, 'node_modules', '.cache', 'audio')
const out = join(here, '..', '..', 'apps', 'web', 'public', 'assets', 'audio')

type Source = {
	id: string
	/** a direct download, or a file inside a Sonniss bundle archive */
	url?: string
	sonniss?: { archive: string; path: string }
	page: string
	author: string
	licence: string
	title?: string
}
type Cut = {
	out: string
	source: string
	file?: string
	start: number
	duration: number
	denoise?: boolean
	/** ambience and music keep both channels */
	stereo?: boolean
	bitrate?: string
	/** played as a loop (the client crossfades the ends): only a tiny fade at each end */
	loop?: boolean
	/** loudness override (dBFS, see LOUDNESS) */
	level?: number
}

/**
 * How loud each kind of sound is made: the loudest 50 ms of a short sound (RMS, dBFS), or the
 * average of a loop. The client's volumes then only fine-tune; the starting mix is right.
 */
const LOUDNESS: [RegExp, number][] = [
	[/^(shotgun|sniper)$/, -10],
	[/^(pistol|pistol-heavy|rifle|smg|mg)$/, -11],
	[/^explosion$/, -9],
	[/^(thump|thud|stinger|stinger-high)$/, -13],
	[/^zap$/, -15],
	[/^gore$/, -14],
	[/^(zombie-roar|zombie-death|zombie-bite)$/, -15],
	[/^(flesh|metal|door|chime|zombie-fast)$/, -16],
	[/^zombie-pain$/, -17],
	[/^(zombie|bodyfall|impact|alarm|hit)$/, -18],
	[/^(reload-.*|pump|cock|pickup|ui-.*)$/, -19],
	[/^(splat|power|empty)$/, -20],
	[/^casing$/, -24],
	[/^ambience-/, -30],
	[/^music-/, -22]
]
const loudnessOf = (group: string) => LOUDNESS.find(([pattern]) => pattern.test(group))?.[1] ?? -18
const { sources, cuts } = JSON.parse(readFileSync(join(here, 'audio-sources.json'), 'utf8')) as {
	sources: Source[]
	cuts: Cut[]
}

mkdirSync(cache, { recursive: true })
mkdirSync(out, { recursive: true })

/** The source on disk: downloaded once and, for archives, unpacked once. */
async function fetchSource(source: Source): Promise<string> {
	if (source.sonniss) return sonnissFile(source.sonniss.archive, source.sonniss.path)
	if (!source.url) throw new Error(`${source.id}: no url`)
	const file = join(cache, `${source.id}-${basename(new URL(source.url).pathname)}`)
	if (!existsSync(file)) {
		const response = await fetch(source.url)
		if (!response.ok) throw new Error(`${source.id}: download failed (${response.status})`)
		writeFileSync(file, Buffer.from(await response.arrayBuffer()))
	}
	if (!file.endsWith('.zip')) return file
	const folder = `${file}.d`
	if (!existsSync(folder)) execFileSync('unzip', ['-q', '-o', file, '-d', folder])
	return folder
}

/** Runs ffmpeg and returns what it printed (it reports on stderr). */
function run(args: string[]): string {
	const result = spawnSync(ffmpeg, ['-hide_banner', ...args], { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(result.stderr)
	return result.stderr
}

const where = new Map<string, string>()
for (const source of sources) where.set(source.id, await fetchSource(source))

const manifest: Record<string, string[]> = {}
for (const cut of cuts) {
	const base = where.get(cut.source)
	if (!base) throw new Error(`unknown source ${cut.source}`)
	const input = cut.file ? join(base, cut.file) : base
	const group = cut.out.replace(/-\d+$/, '')
	const fade = cut.loop ? 0.05 : Math.min(0.25, cut.duration / 3)
	const filters = [
		`atrim=start=${cut.start}:duration=${cut.duration}`,
		'asetpts=PTS-STARTPTS',
		`aformat=channel_layouts=${cut.stereo ? 'stereo' : 'mono'}`,
		// rumble below what speakers play goes, except where the low end is the point
		`highpass=f=${/^(explosion|thump|thud|stinger)/.test(group) ? 25 : 50}`,
		// the field recordings carry steady background noise
		...(cut.denoise === false ? [] : ['afftdn=nf=-28']),
		'afade=t=in:d=0.004',
		`afade=t=out:st=${(cut.duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`
	].join(',')
	// measure (the loudest 50 ms, or the whole loop), then bring it to its kind's loudness; a limiter
	// catches the peaks the gain would push past -1 dBFS
	const log = run(['-i', input, '-af', `${filters},astats=measure_perchannel=none:length=0.05`, '-f', 'null', '-'])
	const rms = Number((cut.loop ? /RMS level dB: (-?[\d.]+)/ : /RMS peak dB: (-?[\d.]+)/).exec(log)?.[1] ?? '-20')
	const gain = (cut.level ?? loudnessOf(group)) - rms
	run([
		'-loglevel',
		'error',
		'-y',
		'-i',
		input,
		'-af',
		`${filters},volume=${gain.toFixed(2)}dB,alimiter=limit=0.891:attack=1:release=60:level=disabled`,
		'-ar',
		'44100',
		'-codec:a',
		'libmp3lame',
		'-b:a',
		cut.bitrate ?? '96k',
		join(out, `${cut.out}.mp3`)
	])
	manifest[group] = [...(manifest[group] ?? []), `${cut.out}.mp3`]
}

// files from cuts that no longer exist are removed
const written = new Set(cuts.map(cut => `${cut.out}.mp3`))
for (const file of readdirSync(out)) if (file.endsWith('.mp3') && !written.has(file)) rmSync(join(out, file))
// who made what is used, for the credits page
const usedSources = new Set(cuts.map(cut => cut.source))
const credits = sources
	.filter(source => usedSources.has(source.id))
	.map(source => ({
		name: source.title ?? source.id,
		author: source.author,
		page: source.page,
		licence: source.licence
	}))
writeFileSync(join(out, 'credits.json'), `${JSON.stringify({ sounds: credits }, null, '\t')}\n`)
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`)
process.stdout.write(`wrote ${cuts.length} sounds in ${Object.keys(manifest).length} groups to ${out}\n`)
