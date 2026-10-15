// Tags the current commit vX.Y.Z (the shared @rotline/* version) if that tag does not exist yet.
// Prints "tag=vX.Y.Z" and "created=true|false" for GitHub Actions outputs.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url), 'utf8')) as {
	version: string
}
const tag = `v${version}`
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const exists = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== ''
if (!exists && version !== '0.0.0') {
	git('tag', '-a', tag, '-m', `Rotline ${tag}`)
	git('push', 'origin', tag)
}
process.stdout.write(`tag=${tag}\ncreated=${!exists && version !== '0.0.0'}\n`)
