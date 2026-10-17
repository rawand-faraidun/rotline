// Builds the game's sound files from free, licence-checked sources: `pnpm assets:audio`.
// Downloads each source once (cached), cuts the listed pieces, cleans them (noise reduction, short
// fades, peak normalisation) and writes small mono MP3s plus a manifest the client loads.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string
const cache = join(here, 'node_modules', '.cache', 'audio')
const out = join(here, '..', '..', 'apps', 'web', 'public', 'assets', 'audio')

type Source = { id: string; url: string; page: string; author: string; licence: string }
type Cut = { out: string; source: string; file?: string; start: number; duration: number; denoise?: boolean }
const { sources, cuts } = JSON.parse(readFileSync(join(here, 'audio-sources.json'), 'utf8')) as {
	sources: Source[]
	cuts: Cut[]
}

mkdirSync(cache, { recursive: true })
mkdirSync(out, { recursive: true })

/** The source on disk: downloaded once and, for archives, unpacked once. */
async function fetchSource(source: Source): Promise<string> {
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
	const fade = Math.min(0.25, cut.duration / 3)
	const filters = [
		`atrim=start=${cut.start}:duration=${cut.duration}`,
		'asetpts=PTS-STARTPTS',
		'aformat=channel_layouts=mono',
		'highpass=f=50',
		// the field recordings carry steady background noise
		...(cut.denoise === false ? [] : ['afftdn=nf=-28']),
		'afade=t=in:d=0.004',
		`afade=t=out:st=${(cut.duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`
	].join(',')
	// measure, then bring the loudest sample to -1 dB
	const log = run(['-i', input, '-af', `${filters},volumedetect`, '-f', 'null', '-'])
	const max = Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1] ?? '0')
	run([
		'-loglevel',
		'error',
		'-y',
		'-i',
		input,
		'-af',
		`${filters},volume=${(-1 - max).toFixed(2)}dB`,
		'-ar',
		'44100',
		'-codec:a',
		'libmp3lame',
		'-b:a',
		'96k',
		join(out, `${cut.out}.mp3`)
	])
	const group = cut.out.replace(/-\d+$/, '')
	manifest[group] = [...(manifest[group] ?? []), `${cut.out}.mp3`]
}

writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`)
process.stdout.write(`wrote ${cuts.length} sounds in ${Object.keys(manifest).length} groups to ${out}\n`)
