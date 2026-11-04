import { devices, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startDeployment } from './deployment'
import { downloadBackup, expectNoOverflow, instant, readDatabase, restoreBackup, seed, waitForServiceWorker } from './helpers'

test('detects a real second build and updates only after consent and closing another window, preserving IndexedDB', async ({ browser, browserName }) => {
  const deployment = await startDeployment()
  const context = await browser.newContext({
    ...(browserName === 'webkit' ? devices['iPhone SE'] : {}),
    baseURL: deployment.origin, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
    viewport: { width: 320, height: 640 }, serviceWorkers: 'allow',
  })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.setFixedTime(instant)
    await seed(page)
    const exercise = page.locator('[data-amount-habit-id="push-ups"]')
    await exercise.getByRole('button', { name: /^\+10/ }).click()
    await expect(exercise.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')
    await page.locator('[data-habit-id="no-alcohol"]').getByRole('button', { name: 'Не пил', exact: true }).click()
    await page.locator('[data-habit-id="breakfast"]').getByRole('button', { name: 'Был', exact: true }).click()
    await page.locator('[data-habit-id="cleaning"]').getByRole('button', { name: 'Выполнено', exact: true }).click()
    await expect(page.locator('[data-habit-id="cleaning"]').getByRole('button', { name: 'Выполнено', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const supported = await page.evaluate(() => 'serviceWorker' in navigator)
    test.skip(!supported, 'This browser runtime does not expose Service Worker; a real iPhone is required for standalone update verification.')
    await waitForServiceWorker(page)
    await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'a')
    await page.goto('/#settings')
    await expect(page.getByRole('button', { name: 'Скачать резервную копию', exact: true })).toBeEnabled()
    const before = await readDatabase(page)
    const originalURL = page.url()

    const other = await context.newPage()
    other.on('pageerror', (error) => errors.push(error.message))
    await other.clock.setFixedTime(instant)
    await other.goto('/#tasks')
    await other.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
    const draft = other.getByRole('dialog', { name: 'Новая задача', exact: true }).getByLabel('Название', { exact: true })
    await draft.fill('Несохранённый черновик в другом окне')
    let otherNavigations = 0
    other.on('framenavigated', (frame) => { if (frame === other.mainFrame()) otherNavigations += 1 })

    deployment.deploySecondBuild()
    // Use the browser's genuine update algorithm, never mock navigator.serviceWorker or registration.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) throw new Error('Missing production registration')
      await registration.update()
    })
    await expect(page.getByText('Доступна новая версия приложения', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed')
    await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'a')
    await expectNoOverflow(page)
    await page.getByRole('button', { name: 'Обновить', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Обновить приложение?', exact: true })
    await expect(confirmation).toContainText(/черновик|несохранён/i)
    await expectNoOverflow(page)
    await mkdir('.artifacts', { recursive: true })
    await confirmation.screenshot({ path: `.artifacts/pwa-update-dialog-${browserName}-320.png` })
    await page.keyboard.press('Escape')
    await expect(confirmation).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Обновить', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'a')
    expect(await readDatabase(page)).toEqual(before)

    await page.getByRole('button', { name: 'Обновить', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Обновить сейчас', exact: true }).click()
    await expect(page.getByText(/Закройте другие окна приложения/)).toBeVisible()
    await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'a')
    await expect(draft).toHaveValue('Несохранённый черновик в другом окне')
    expect(otherNavigations).toBe(0)
    expect(await readDatabase(page)).toEqual(before)

    await other.close()
    if (!await confirmation.isVisible()) await page.getByRole('button', { name: 'Обновить', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Обновить сейчас', exact: true }).click()
    await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'b', { timeout: 30_000 })
    await expect(page).toHaveURL(originalURL)
    await expect(page.getByRole('button', { name: 'Скачать резервную копию', exact: true })).toBeEnabled()
    await waitForServiceWorker(page)
    expect(await readDatabase(page)).toEqual(before)
    await expect(page.getByText('Доступна новая версия приложения', { exact: true })).toHaveCount(0)
    // Neither window visited Goals before updating. Stop the actual origin so
    // both engines must use precache, including WebKit where setOffline is broken.
    await deployment.close()
    if (browserName === 'chromium') await context.setOffline(true)
    await page.goto('/#goals?id=pwa-goal')
    await expect(page.getByRole('heading', { name: 'Сохранённая цель', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-pwa-test-lazy-build', 'b')
    await expectNoOverflow(page)
    expect(await readDatabase(page)).toEqual(before)
    await page.close()
    const reopened = await context.newPage()
    reopened.on('pageerror', (error) => errors.push(error.message))
    await reopened.clock.setFixedTime(instant)
    await reopened.goto('/#settings')
    await expect(reopened.getByRole('heading', { name: /^Настройки/, level: 1 })).toBeVisible()
    expect(await readDatabase(reopened)).toEqual(before)
    const backup = await downloadBackup(reopened)
    expect(backup.data).toEqual(before)
    await restoreBackup(reopened, backup)
    await reopened.reload()
    expect(await readDatabase(reopened)).toEqual(before)
    await reopened.goto('/#today')
    const offlineExercise = reopened.locator('[data-amount-habit-id="push-ups"]')
    await offlineExercise.getByRole('button', { name: /^\+10/ }).click()
    await expect(offlineExercise.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
    await offlineExercise.getByText('Указать итог дня', { exact: true }).click()
    await offlineExercise.getByLabel(/^Итог за день/).fill('130')
    await offlineExercise.getByRole('button', { name: 'Сохранить количество', exact: true }).click()
    await expect(offlineExercise.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    await reopened.locator('[data-habit-id="no-alcohol"]').getByRole('button', { name: 'Пил', exact: true }).click()
    for (const id of ['lunch', 'dinner']) {
      await reopened.locator(`[data-habit-id="${id}"]`).getByRole('button', { name: 'Был', exact: true }).click()
    }
    await reopened.locator('[data-habit-id="cleaning"]').getByRole('button', { name: 'Не выполнено', exact: true }).click()
    await reopened.reload()
    const offline = await readDatabase(reopened)
    expect(offline.habitEntries.find((entry) => entry.habitId === 'push-ups')).toMatchObject({ value: 130 })
    expect(offline.habitEntries.find((entry) => entry.habitId === 'no-alcohol')).toMatchObject({ status: 'failure' })
    expect(offline.habitEntries.filter((entry) => entry.habitId === 'cleaning')).toEqual([
      expect.objectContaining({ status: 'failure', date: '2026-10-19' }),
    ])
    for (const id of ['breakfast', 'lunch', 'dinner']) {
      expect(offline.habitEntries.find((entry) => entry.habitId === id)).toMatchObject({ status: 'success' })
    }
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await deployment.close()
  }
})
