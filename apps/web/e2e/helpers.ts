import { randomInt } from 'node:crypto'
import type { Page } from '@playwright/test'

/**
 * A tag that keeps one run's test accounts apart from another's: digits only, as random letters
 * can spell a word the name filter refuses.
 */
export const runTag = (): string => String(randomInt(1e6)).padStart(6, '0')

/** Frees the seats at once (closed tabs would hold them for the 120-second reconnect grace). */
export async function releaseSeats(...pages: Page[]) {
	for (const page of pages) await page.request.post('/api/queue/leave')
}
