import { createValkey, Seats } from '@rotline/state'
import { type Browser, expect, type Page, test } from '@playwright/test'
import { releaseSeats, runTag } from './helpers.ts'

const run = runTag()

async function enlist(browser: Browser, tag: string): Promise<Page> {
	const context = await browser.newContext()
	const page = await context.newPage()
	const username = `${tag}-${run}`
	await page.goto('/play')
	await page.getByRole('button', { name: /test account/i }).click()
	await page.locator('input[name="username"]').fill(username)
	await page
		.locator('textarea[name="claims"]')
		.fill(JSON.stringify({ email: `${username}@e2e.rotline.test`, email_verified: true }))
	await page
		.getByRole('button', { name: /sign-in/i })
		.or(page.locator('input[type="submit"]'))
		.first()
		.click()
	await expect(page).toHaveURL(/\/play\/welcome$/)
	await page.getByLabel(/player name/i).fill(`${tag}${run}`)
	await expect(page.getByText(/^available$/i)).toBeVisible()
	await page.getByRole('button', { name: /enlist/i }).click()
	return page
}

test('friends: request, accept, see presence, invite into the squad', async ({ browser }) => {
	const ana = await enlist(browser, 'Ana')
	const ben = await enlist(browser, 'Ben')
	await expect(ana).toHaveURL(/\/play\/lobby$/)
	await expect(ben).toHaveURL(/\/play\/lobby$/)

	// friends live behind the lobby's Friends tab
	await ana.getByRole('tab', { name: /^friends$/i }).click()
	await ana.getByLabel(/add a friend/i).fill(`Ben${run}`)
	await ana.getByRole('button', { name: /^send$/i }).click()
	await expect(ana.getByText(/request sent/i)).toBeVisible()

	// the request arrives live
	await ben.getByRole('tab', { name: /^friends$/i }).click()
	await ben.getByRole('button', { name: /^accept$/i }).click()
	await expect(ana.getByText(/in the lobby/i)).toBeVisible()

	await ana.getByRole('button', { name: /^invite$/i }).click()
	await expect(ben.getByText(`Ana${run} invited you to their squad`)).toBeVisible()
	await ben.getByRole('button', { name: /join squad/i }).click()
	await expect(ana.getByRole('tab', { name: /squad 2\/4/i })).toBeVisible()
	await releaseSeats(ana, ben)
})

test('a full game queues new players and lets them in when a seat frees', async ({ browser }) => {
	test.skip(!process.env.VALKEY_URL, 'needs VALKEY_URL to set the capacity')
	// it shrinks the game's capacity for a moment: anyone playing on the same stack would be queued,
	// so it runs only where asked (CI), never against a local stack someone is playing on
	test.skip(!process.env.E2E_QUEUE, 'set E2E_QUEUE=1 to run the queue test (it changes the capacity)')
	const valkey = createValkey(process.env.VALKEY_URL as string, 'rotline-e2e')
	const seats = new Seats(valkey)
	const before = await seats.capacity()
	try {
		const first = await enlist(browser, 'Ira')
		// the lobby renders only once the seat is taken (the address changes before that)
		await expect(first.getByRole('heading', { name: /lobby/i })).toBeVisible()
		// exactly full: everyone already seated, including the first player
		const { seats: seated, passes } = await seats.counts()
		expect(seated).toBeGreaterThan(0)
		await seats.setCapacity(seated + passes)

		const second = await enlist(browser, 'Jon')
		await expect(second).toHaveURL(/\/queue$/, { timeout: 15_000 })
		await expect(second.getByTestId('queue-position')).toHaveText('1')
		await expect(second.getByRole('heading', { name: /holding position/i })).toBeVisible()

		// the first player leaves; the next in line gets a pass
		await first.getByRole('button', { name: /sign out/i }).click()
		await expect(second.getByRole('heading', { name: /your seat is ready/i })).toBeVisible({ timeout: 15_000 })
		await second.getByRole('button', { name: /enter rotline/i }).click()
		await expect(second).toHaveURL(/\/play\/lobby$/)
		await expect(second.getByRole('heading', { name: /lobby/i })).toBeVisible()
		await releaseSeats(second)
	} finally {
		await seats.setCapacity(before)
		await valkey.quit()
	}
})
