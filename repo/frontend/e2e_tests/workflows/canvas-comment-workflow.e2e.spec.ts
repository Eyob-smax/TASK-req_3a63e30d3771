import { expect, test, type Page } from '@playwright/test'

async function createAndUnlockProfile(page: Page, name = 'Canvas User', passphrase = 'Password123!'): Promise<void> {
  await page.goto('/profile')

  await page.getByRole('button', { name: /create new profile/i }).click()
  await page.locator('#create-name').fill(name)
  await page.locator('.avatar-picker__swatch').first().click()
  await page.locator('#create-passphrase').fill(passphrase)
  await page.locator('#create-passphrase-confirm').fill(passphrase)
  await page.locator('.create-form button[type="submit"]').click()

  await expect(page.locator('.unlock-form')).toBeVisible({ timeout: 15000 })

  await page.locator('#unlock-passphrase').fill(passphrase)
  await page.locator('.unlock-form button[type="submit"]').click()
  await expect(page).toHaveURL('/rooms', { timeout: 15000 })
}

async function createRoom(page: Page, roomName: string): Promise<void> {
  await page.getByRole('link', { name: /create room/i }).click()
  await expect(page).toHaveURL('/rooms/create')

  await page.locator('#room-name').fill(roomName)
  await page.locator('#room-desc').fill('Canvas and comment workflow room.')
  await page.getByRole('button', { name: /create room/i }).click()
  await expect(page).toHaveURL(/\/workspace\//)
}

test('canvas + comments workflow: create sticky then post comment', async ({ page }: { page: Page }) => {
  await createAndUnlockProfile(page, `Canvas User ${Date.now()}`)
  await createRoom(page, `Canvas Room ${Date.now()}`)

  await expect(page.locator('[data-testid="tool-sticky"]')).toBeVisible()
  await page.locator('[data-testid="tool-sticky"]').click()

  await page.locator('.canvas-host').dblclick({ position: { x: 180, y: 160 } })
  await expect(page.locator('.canvas-host__sticky-editor')).toBeVisible()

  const stickyText = `Sticky ${Date.now()}`
  await page.locator('.canvas-host__sticky-textarea').fill(stickyText)
  await page.locator('.canvas-host__sticky-confirm').click()

  const sticky = page.locator('.canvas-host__sticky', { hasText: stickyText }).first()
  await expect(sticky).toBeVisible()
  await sticky.click()

  await page.locator('[data-testid="canvas-comment-btn"]').click()
  await expect(page.locator('.comment-drawer')).toBeVisible()

  const commentText = `Comment ${Date.now()}`
  await page.locator('[data-testid="comment-input"]').fill(commentText)
  await page.locator('[data-testid="comment-submit"]').click()

  await expect(page.locator('.comment-drawer__comment-text').last()).toContainText(commentText)
})
