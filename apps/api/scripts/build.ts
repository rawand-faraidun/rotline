// Bundles the API and the workspace packages it uses into dist/index.js.
// npm dependencies stay external and are installed in the image by `pnpm deploy`.
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

type Manifest = { dependencies?: Record<string, string> }
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Manifest

const external = new Set<string>()
// the API lists every runtime dependency of the workspace packages it bundles
for (const manifest of [read('package.json')]) {
	for (const name of Object.keys(manifest.dependencies ?? {})) if (!name.startsWith('@rotline/')) external.add(name)
}

await build({
	entryPoints: ['src/index.ts'],
	outfile: 'dist/index.js',
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node26',
	sourcemap: true,
	external: [...external].flatMap(name => [name, `${name}/*`]),
	banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }
})
