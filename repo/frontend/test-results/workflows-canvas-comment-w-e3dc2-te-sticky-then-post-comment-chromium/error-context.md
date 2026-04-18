# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflows/canvas-comment-workflow.e2e.spec.ts >> canvas + comments workflow: create sticky then post comment
- Location: e2e_tests/workflows/canvas-comment-workflow.e2e.spec.ts:30:1

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
        - text: Canvas User 1776486049997
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
  3  | async function createAndUnlockProfile(page: Page, name = 'Canvas User', passphrase = 'Password123!'): Promise<void> {
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
  17 |   await expect(page).toHaveURL('/rooms', { timeout: 15000 })
  18 | }
  19 | 
  20 | async function createRoom(page: Page, roomName: string): Promise<void> {
  21 |   await page.getByRole('link', { name: /create room/i }).click()
  22 |   await expect(page).toHaveURL('/rooms/create')
  23 | 
  24 |   await page.locator('#room-name').fill(roomName)
  25 |   await page.locator('#room-desc').fill('Canvas and comment workflow room.')
  26 |   await page.getByRole('button', { name: /create room/i }).click()
  27 |   await expect(page).toHaveURL(/\/workspace\//)
  28 | }
  29 | 
  30 | test('canvas + comments workflow: create sticky then post comment', async ({ page }: { page: Page }) => {
  31 |   await createAndUnlockProfile(page, `Canvas User ${Date.now()}`)
  32 |   await createRoom(page, `Canvas Room ${Date.now()}`)
  33 | 
  34 |   await expect(page.locator('[data-testid="tool-sticky"]')).toBeVisible()
  35 |   await page.locator('[data-testid="tool-sticky"]').click()
  36 | 
  37 |   await page.locator('.canvas-host').dblclick({ position: { x: 180, y: 160 } })
  38 |   await expect(page.locator('.canvas-host__sticky-editor')).toBeVisible()
  39 | 
  40 |   const stickyText = `Sticky ${Date.now()}`
  41 |   await page.locator('.canvas-host__sticky-textarea').fill(stickyText)
  42 |   await page.locator('.canvas-host__sticky-confirm').click()
  43 | 
  44 |   const sticky = page.locator('.canvas-host__sticky', { hasText: stickyText }).first()
  45 |   await expect(sticky).toBeVisible()
  46 |   await sticky.click()
  47 | 
  48 |   await page.locator('[data-testid="canvas-comment-btn"]').click()
  49 |   await expect(page.locator('.comment-drawer')).toBeVisible()
  50 | 
  51 |   const commentText = `Comment ${Date.now()}`
  52 |   await page.locator('[data-testid="comment-input"]').fill(commentText)
  53 |   await page.locator('[data-testid="comment-submit"]').click()
  54 | 
  55 |   await expect(page.locator('.comment-drawer__comment-text').last()).toContainText(commentText)
  56 | })
  57 | 
```