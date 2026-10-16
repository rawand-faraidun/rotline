import { writeFileSync } from 'node:fs'
import { economySheet } from './economy-sheet.ts'

writeFileSync(new URL('../economy.csv', import.meta.url), economySheet())
