# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflows/core-workflows.e2e.spec.ts >> room workflow: create room + send chat + verify toolbar hooks
- Location: e2e_tests/workflows/core-workflows.e2e.spec.ts:44:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.unlock-form')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('.unlock-form')

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - heading "ForgeRoom" [level=1] [ref=e6]
    - paragraph [ref=e7]: Local workspace — no account required
  - heading "Create profile" [level=2] [ref=e8]
  - generic [ref=e9]:
    - generic [ref=e10]:
      - generic [ref=e11]: Display name
      - textbox "Display name" [ref=e12]:
        - /placeholder: Your name in this workspace
        - text: E2E Host 1776486082910
    - group "Avatar color" [ref=e14]:
      - generic [ref=e15]: Avatar color
      - generic [ref=e16]:
        - generic [ref=e17] [cursor=pointer]:
          - radio [checked]
        - generic [ref=e19] [cursor=pointer]:
          - radio
        - generic [ref=e21] [cursor=pointer]:
          - radio
        - generic [ref=e23] [cursor=pointer]:
          - radio
        - generic [ref=e25] [cursor=pointer]:
          - radio
        - generic [ref=e27] [cursor=pointer]:
          - radio
        - generic [ref=e29] [cursor=pointer]:
          - radio
        - generic [ref=e31] [cursor=pointer]:
          - radio
    - generic [ref=e33]:
      - generic [ref=e34]: Passphrase
      - textbox "Passphrase" [ref=e35]:
        - /placeholder: Min. 8 characters
        - text: Password123!
    - generic [ref=e36]:
      - generic [ref=e37]: Confirm passphrase
      - textbox "Confirm passphrase" [ref=e38]:
        - /placeholder: Re-enter passphrase
        - text: Password123!
    - alert [ref=e39]: crypto.randomUUID is not a function
    - paragraph [ref=e40]: Passphrase is stored as a local verifier only — it is never sent anywhere. If you forget it, you will need to create a new profile.
    - generic [ref=e41]:
      - button "Back" [ref=e42] [cursor=pointer]
      - button "Create profile" [ref=e43] [cursor=pointer]
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test'
  2  | 
  3  | async function createAndUnlockProfile(page: Page, name = 'E2E User', passphrase = 'Password123!'): Promise<void> {
  4  |   await page.goto('/profile')
  5  | 
  6  |   await page.getByRole('button', { name: /create new profile/i }).click()
  7  |   await page.locator('#create-name').fill(name)
  8  |   await page.locator('.avatar-picker__swatch').first().click()
  9  |   await page.locator('#create-passphrase').fill(passphrase)
  10 |   await page.locator('#create-passphrase-confirm').fill(passphrase)
  11 |   await page.locator('.create-form button[type="submit"]').click()
  12 | 
> 13 |   await expect(page.locator('.unlock-form')).toBeVisible({ timeout: 15000 })
     |                                              ^ Error: expect(locator).toBeVisible() failed
  14 | 
  15 |   await page.locator('#unlock-passphrase').fill(passphrase)
  16 |   await page.locator('.unlock-form button[type="submit"]').click()
  17 | 
  18 |   await expect(page).toHaveURL('/rooms', { timeout: 15000 })
  19 | }
  20 | 
  21 | async function createRoomFromRoomsPage(page: Page, roomName: string): Promise<string> {
  22 |   await page.getByRole('link', { name: /create room/i }).click()
  23 |   await expect(page).toHaveURL('/rooms/create')
  24 | 
  25 |   await page.locator('#room-name').fill(roomName)
  26 |   await page.locator('#room-desc').fill('Room created by Playwright workflow suite.')
  27 |   await page.getByRole('button', { name: /create room/i }).click()
  28 | 
  29 |   await expect(page).toHaveURL(/\/workspace\//)
  30 |   const url = new URL(page.url())
  31 |   const parts = url.pathname.split('/')
  32 |   return parts[2] ?? ''
  33 | }
  34 | 
  35 | test('profile lifecycle: create + unlock + session persisted', async ({ page }: { page: Page }) => {
  36 |   await createAndUnlockProfile(page, `E2E User ${Date.now()}`)
  37 | 
  38 |   await expect(page.getByRole('heading', { name: 'My Rooms' })).toBeVisible()
  39 | 
  40 |   const activeProfileId = await page.evaluate(() => localStorage.getItem('forgeroom:activeProfileId'))
  41 |   expect(activeProfileId).toBeTruthy()
  42 | })
  43 | 
  44 | test('room workflow: create room + send chat + verify toolbar hooks', async ({ page }: { page: Page }) => {
  45 |   await createAndUnlockProfile(page, `E2E Host ${Date.now()}`)
  46 |   const roomId = await createRoomFromRoomsPage(page, `Sprint ${Date.now()}`)
  47 | 
  48 |   expect(roomId).toBeTruthy()
  49 | 
  50 |   const chatMessage = `Hello from E2E ${Date.now()}`
  51 |   await page.locator('.chat-panel__input').fill(chatMessage)
  52 |   await page.locator('[data-testid="send-btn"]').click()
  53 | 
  54 |   await expect(page.locator('.chat-panel__message .chat-panel__text').last()).toContainText(chatMessage)
  55 | 
  56 |   await expect(page.locator('[data-testid="tool-select"]')).toBeVisible()
  57 |   await expect(page.locator('[data-testid="tool-sticky"]')).toBeVisible()
  58 |   await expect(page.locator('[data-testid="tool-arrow"]')).toBeVisible()
  59 |   await expect(page.locator('[data-testid="tool-pen"]')).toBeVisible()
  60 |   await expect(page.locator('[data-testid="tool-image"]')).toBeVisible()
  61 | })
  62 | 
  63 | test('backup workflow: invalid import reports validation + row errors', async ({ page }: { page: Page }) => {
  64 |   await createAndUnlockProfile(page, `E2E Backup ${Date.now()}`)
  65 |   const roomId = await createRoomFromRoomsPage(page, `Backup Room ${Date.now()}`)
  66 | 
  67 |   await page.locator('[data-testid="backup-btn"]').click()
  68 |   await expect(page).toHaveURL(new RegExp(`/workspace/${roomId}/backup$`))
  69 | 
  70 |   await page.locator('[data-testid="file-input"]').setInputFiles({
  71 |     name: 'invalid-backup.json',
  72 |     mimeType: 'application/json',
  73 |     buffer: Buffer.from('not-valid-json'),
  74 |   })
  75 | 
  76 |   await expect(page.locator('[data-testid="validation-result"]')).toBeVisible()
  77 |   await expect(page.locator('[data-testid="validation-result"]')).toContainText('Validation failed')
  78 |   await expect(page.locator('[data-testid="row-errors"]')).toBeVisible()
  79 | })
  80 | 
```