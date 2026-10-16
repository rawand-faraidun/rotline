import type { Page } from '@playwright/test'

/** Frees the seats at once (closed tabs would hold them for the 120-second reconnect grace). */
export async function releaseSeats(...pages: Page[]) {
	for (const page of pages) await page.request.post('/api/queue/leave')
}
