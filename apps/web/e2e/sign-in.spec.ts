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

	await page.getByRole('button', { name: /sign out/i }).click()
	await expect(page).toHaveURL(/\/play$/)
	await expect(page.getByRole('button', { name: /test account/i })).toBeVisible()
})
