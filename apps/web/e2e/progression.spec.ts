import { expect, type Page, test } from '@playwright/test'
import { releaseSeats } from './helpers.ts'

const run = Math.random().toString(36).slice(2, 8)

async function enlist(page: Page, tag: string) {
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
	await page.getByLabel(/player name/i).fill(`${tag}${run}`)
	await expect(page.getByText(/^available$/i)).toBeVisible()
	await page.getByRole('button', { name: /enlist/i }).click()
	await expect(page.getByRole('heading', { name: /lobby/i })).toBeVisible()
}

test('classes, skills, armory and shop', async ({ page }) => {
	await enlist(page, 'Kit')

	// three classes at level 1; switching makes Medic the class for the next mission
	await page.getByRole('button', { name: /medic/i }).click()
	await expect(page.getByRole('button', { name: /medic/i })).toHaveAttribute('aria-pressed', 'true')

	// skills: the Medic's first point buys the Medkit Drop and it can be slotted
	await page.getByRole('link', { name: /^skills$/i }).click()
	await expect(page.getByTestId('points-left')).toHaveText('1 points to spend')
	await page.getByTestId('node-medkit-drop').click()
	await page.getByRole('button', { name: /^learn$/i }).click()
	await expect(page.getByTestId('points-left')).toHaveText('0 points to spend')
	await page.getByLabel(/slot 1/i).selectOption('medkit-drop')
	await expect(page.getByLabel(/slot 1/i)).toHaveValue('medkit-drop')

	// armory: the starter kit, and swapping the two main weapons
	await page.getByRole('link', { name: /^armory$/i }).click()
	await page.getByTestId('item-k-71').click()
	await expect(page.getByTestId('item-detail')).toContainText('K-71')
	await page.getByRole('button', { name: /equip as main 1/i }).click()
	await expect(page.getByRole('button', { name: /main 1.*k-71/i })).toBeVisible()
	// with no Salvage, the upgrade is refused
	await page.getByTestId('upgrade').click()
	await expect(page.getByRole('alert')).toHaveText(/not enough salvage/i)

	// shop: fixed prices, owned items marked, nothing affordable yet
	await page.getByRole('link', { name: /^shop$/i }).click()
	await expect(page.getByTestId('shop-k-71')).toContainText(/owned/i)
	await expect(page.getByTestId('shop-mower').getByRole('button', { name: /^buy$/i })).toBeDisabled()
	await expect(page.getByTestId('salvage')).toContainText('0')
	await releaseSeats(page)
})
