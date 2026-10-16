import { expect, type Page, test } from '@playwright/test'

const run = Math.random().toString(36).slice(2, 8)

async function signInWithTestProvider(page: Page, username: string) {
	await page.getByRole('button', { name: /test account/i }).click()
	// the OAuth mock's own login form
	await page.locator('input[name="username"]').fill(username)
	await page
		.locator('textarea[name="claims"]')
		.fill(JSON.stringify({ email: `${username}@e2e.rotline.test`, email_verified: true }))
	await page
		.getByRole('button', { name: /sign-in/i })
		.or(page.locator('input[type="submit"]'))
		.first()
		.click()
}

test('landing page loads without game code and links to play', async ({ page }) => {
	const scripts: string[] = []
	page.on('request', request => request.resourceType() === 'script' && scripts.push(request.url()))
	await page.goto('/')
	await expect(page.getByRole('img', { name: /hold the line against the rot/i })).toBeVisible()
	// against the built site the landing page ships no JavaScript at all (the dev server injects its own)
	if (process.env.E2E_STATIC) expect(scripts).toEqual([])
	await page.getByRole('link', { name: /play now/i }).click()
	await expect(page).toHaveURL(/\/play$/)
})

test('a new player signs in, enlists and reaches the lobby', async ({ page }) => {
	const name = `Recruit${run}`
	await page.goto('/play')
	await signInWithTestProvider(page, `recruit-${run}`)

	await expect(page).toHaveURL(/\/play\/welcome$/)
	await page.getByLabel(/player name/i).fill('admin')
	await expect(page.getByText(/that name is reserved/i)).toBeVisible()
	await page.getByLabel(/player name/i).fill(name)
	await expect(page.getByText(/^available$/i)).toBeVisible()
	await page.getByRole('button', { name: 'lorelei' }).click()
	await page.getByRole('button', { name: /enlist/i }).click()

	await expect(page).toHaveURL(/\/play\/lobby$/)
	await expect(page.getByRole('heading', { name: /lobby/i })).toBeVisible()
	await expect(page.getByText(name).first()).toBeVisible()

	await page.reload()
	await expect(page).toHaveURL(/\/play\/lobby$/)

	// deploy into a solo mission: the engine loads, the HUD appears, firing spends ammunition
	await page.getByRole('button', { name: /^deploy$/i }).click()
	await expect(page).toHaveURL(/\/play\/mission$/)
	await expect(page.getByText(/^wave$/i)).toBeVisible({ timeout: 45_000 })
	const magazine = page.locator('li', { hasText: 'Vex-9' }).locator('[data-slot="magazine"]')
	await expect(magazine).toHaveText('32')
	await page.mouse.move(900, 300)
	await page.mouse.down()
	await expect(magazine).not.toHaveText('32', { timeout: 10_000 })
	await page.mouse.up()
	await page.keyboard.press('Escape')
	await expect(page).toHaveURL(/\/play\/lobby$/)

	await page.getByRole('button', { name: /sign out/i }).click()
	await expect(page).toHaveURL(/\/play$/)
	await expect(page.getByRole('button', { name: /test account/i })).toBeVisible()
})

test('two players form a squad by code and deploy together', async ({ browser }) => {
	async function enlist(tag: string) {
		const context = await browser.newContext()
		const page = await context.newPage()
		const username = `${tag}-${run}`
		await page.goto('/play')
		await signInWithTestProvider(page, username)
		await expect(page).toHaveURL(/\/play\/welcome$/)
		await page.getByLabel(/player name/i).fill(`${tag}${run}`)
		await expect(page.getByText(/^available$/i)).toBeVisible()
		await page.getByRole('button', { name: /enlist/i }).click()
		await expect(page).toHaveURL(/\/play\/lobby$/)
		return page
	}
	const host = await enlist('Lead')
	const guest = await enlist('Wing')
	const code = (await host.getByTestId('party-code').innerText()).trim()
	await guest.getByLabel(/join a squad/i).fill(code)
	await guest.getByRole('button', { name: /^join$/i }).click()
	await expect(host.getByText('2 / 4')).toBeVisible()
	await expect(host.getByRole('button', { name: /deploy squad/i })).toBeDisabled()
	await guest.getByRole('button', { name: /i am ready/i }).click()
	await host.getByRole('button', { name: /deploy squad/i }).click()
	await expect(host).toHaveURL(/\/play\/mission$/)
	await expect(guest).toHaveURL(/\/play\/mission$/, { timeout: 15_000 })
	await expect(host.getByText(`Wing${run}`)).toBeVisible({ timeout: 45_000 })
	await expect(guest.getByText(`Lead${run}`)).toBeVisible({ timeout: 45_000 })
})
