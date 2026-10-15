// Copies the brand pack's web files into public/brand, so pages can use /brand/... paths.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, '..', '..', 'brand')
const target = join(root, 'public', 'brand')

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const folder of ['svg', 'png']) cpSync(join(source, folder), join(target, folder), { recursive: true })
