import { expect, test, type Page } from '@playwright/test'

async function createAndUnlockProfile(page: Page, name = 'E2E User', passphrase = 'Password123!'): Promise<void> {
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

async function createRoomFromRoomsPage(page: Page, roomName: string): Promise<string> {
  await page.getByRole('link', { name: /create room/i }).click()
  await expect(page).toHaveURL('/rooms/create')

  await page.locator('#room-name').fill(roomName)
  await page.locator('#room-desc').fill('Room created by Playwright workflow suite.')
  await page.getByRole('button', { name: /create room/i }).click()

  await expect(page).toHaveURL(/\/workspace\//)
  const url = new URL(page.url())
  const parts = url.pathname.split('/')
  return parts[2] ?? ''
}

test('profile lifecycle: create + unlock + session persisted', async ({ page }: { page: Page }) => {
  await createAndUnlockProfile(page, `E2E User ${Date.now()}`)

  await expect(page.getByRole('heading', { name: 'My Rooms' })).toBeVisible()

  const activeProfileId = await page.evaluate(() => localStorage.getItem('forgeroom:activeProfileId'))
  expect(activeProfileId).toBeTruthy()
})

test('room workflow: create room + send chat + verify toolbar hooks', async ({ page }: { page: Page }) => {
  await createAndUnlockProfile(page, `E2E Host ${Date.now()}`)
  const roomId = await createRoomFromRoomsPage(page, `Sprint ${Date.now()}`)

  expect(roomId).toBeTruthy()

  const chatMessage = `Hello from E2E ${Date.now()}`
  await page.locator('.chat-panel__input').fill(chatMessage)
  await page.locator('[data-testid="send-btn"]').click()

  await expect(page.locator('.chat-panel__message .chat-panel__text').last()).toContainText(chatMessage)

  await expect(page.locator('[data-testid="tool-select"]')).toBeVisible()
  await expect(page.locator('[data-testid="tool-sticky"]')).toBeVisible()
  await expect(page.locator('[data-testid="tool-arrow"]')).toBeVisible()
  await expect(page.locator('[data-testid="tool-pen"]')).toBeVisible()
  await expect(page.locator('[data-testid="tool-image"]')).toBeVisible()
})

test('backup workflow: invalid import reports validation + row errors', async ({ page }: { page: Page }) => {
  await createAndUnlockProfile(page, `E2E Backup ${Date.now()}`)
  const roomId = await createRoomFromRoomsPage(page, `Backup Room ${Date.now()}`)

  await page.locator('[data-testid="backup-btn"]').click()
  await expect(page).toHaveURL(new RegExp(`/workspace/${roomId}/backup$`))

  await page.locator('[data-testid="file-input"]').setInputFiles({
    name: 'invalid-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not-valid-json'),
  })

  await expect(page.locator('[data-testid="validation-result"]')).toBeVisible()
  await expect(page.locator('[data-testid="validation-result"]')).toContainText('Validation failed')
  await expect(page.locator('[data-testid="row-errors"]')).toBeVisible()
})
