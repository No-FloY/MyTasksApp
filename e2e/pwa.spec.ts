import { expect, test } from '@playwright/test'
import { date, downloadBackup, expectNoOverflow, instant, readDatabase, restoreBackup, seed, waitForServiceWorker } from '../scripts/pwa-test/helpers'

const routes = [
  ['today', /^Сегодня/], ['calendar', /^Календарь/], ['tasks', /^Задачи/],
  ['goals', /^Цели/], ['statistics', /^Статистика/], ['settings', /^Настройки/],
] as const

test('serves the standalone manifest, local installation icons, iOS metadata and start URL', async ({ page, request }) => {
  await page.goto('/#today')
  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestPath).toBeTruthy()
  const manifestURL = new URL(manifestPath!, page.url())
  expect(manifestURL.origin).toBe(new URL(page.url()).origin)
  const response = await request.get(manifestURL.href)
  expect(response.ok()).toBe(true)
  const manifest = await response.json() as {
    name: string; short_name: string; display: string; start_url: string; scope: string;
    theme_color: string; background_color: string; icons: { src: string; sizes: string; type: string; purpose?: string }[]
  }
  expect(manifest).toMatchObject({ name: 'Задачник', short_name: 'Задачник', display: 'standalone', scope: '/', start_url: '/#today' })
  expect(manifest.theme_color).toMatch(/^#[\da-f]{6}$/i)
  expect(manifest.background_color).toMatch(/^#[\da-f]{6}$/i)
  expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true)
  expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true)
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestURL)
    expect(url.origin).toBe(manifestURL.origin)
    const image = await request.get(url.href)
    expect(image.ok()).toBe(true)
    expect(image.headers()['content-type']).toContain('image/')
    const size = await page.evaluate((src) => new Promise<string>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(`${image.naturalWidth}x${image.naturalHeight}`)
      image.onerror = () => reject(new Error(`Cannot decode installation icon ${src}`))
      image.src = src
    }), url.href)
    expect(icon.sizes.split(' ')).toContain(size)
  }
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  expect(appleIcon).toBeTruthy()
  const appleSize = await page.evaluate((src) => new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(`${image.naturalWidth}x${image.naturalHeight}`)
    image.onerror = () => reject(new Error('Cannot decode apple-touch-icon'))
    image.src = src
  }), new URL(appleIcon!, page.url()).href)
  expect(appleSize).toBe('180x180')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', manifest.theme_color)
  await page.goto(new URL(manifest.start_url, manifestURL).href)
  await expect(page.getByRole('heading', { name: /^Сегодня/, level: 1 })).toBeVisible()
})

test('reopens the precached app offline, visits lazy routes and preserves local data and backup round-trip', async ({ page, context, browserName }) => {
  test.setTimeout(90_000)
  test.skip(browserName === 'webkit', 'Playwright WebKit offline transport fails navigation with an internal error despite an activated controller and cached index.html. Real iPhone offline launch requires manual verification; Chromium exercises the full cold-reopen scenario.')
  await page.clock.setFixedTime(instant)
  await seed(page)
  const supported = await page.evaluate(() => 'serviceWorker' in navigator)
  test.skip(!supported, 'This browser runtime does not expose Service Worker; real iPhone standalone/offline remains a manual check.')
  await waitForServiceWorker(page)
  const before = await readDatabase(page)
  const url = new URL('/#today', page.url()).href
  await page.close() // Do not keep an already loaded application document alive.
  await context.setOffline(true)
  const offline = await context.newPage()
  const errors: string[] = []
  offline.on('pageerror', (error) => errors.push(error.message))
  await offline.clock.setFixedTime(instant)
  await offline.goto(url)
  await expect(offline.getByRole('heading', { name: /^Сегодня/, level: 1 })).toBeVisible()
  expect(await offline.evaluate(() => navigator.onLine)).toBe(false)
  expect(await readDatabase(offline)).toEqual(before)
  await offline.locator('[data-amount-habit-id="water"]').getByRole('button', { name: '+200 мл', exact: true }).click()
  await expect.poll(async () => Number(await offline.locator('[data-amount-habit-id="water"]').getByRole('progressbar').getAttribute('aria-valuenow'))).toBeCloseTo(100 / 3)
  await offline.locator('[data-habit-id="english"]').getByRole('button', { name: 'Неудача', exact: true }).click()
  await expect(offline.locator('[data-habit-id="english"]').getByRole('button', { name: 'Неудача', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Only Today was visited online: these lazy modules must come from the SW precache.
  for (const [route, heading] of routes.slice(1)) {
    await offline.goto(new URL(`/#${route}`, url).href)
    await expect(offline.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    await expectNoOverflow(offline)
  }
  await offline.goto(new URL('/#tasks', url).href)
  await offline.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
  const task = offline.getByRole('dialog', { name: 'Новая задача', exact: true })
  await task.getByLabel('Название', { exact: true }).fill('Создана без сети')
  await task.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(offline.getByRole('heading', { name: 'Создана без сети', exact: true })).toBeVisible()
  await offline.goto(new URL('/#goals?id=pwa-goal', url).href)
  await expect(offline.getByRole('heading', { name: 'Сохранённая цель', exact: true })).toBeVisible()
  await expect(offline.getByText('Сохранённый этап', { exact: true })).toBeVisible()
  await offline.goto(new URL('/#settings', url).href)
  const water = offline.locator('article[data-habit-id="water"]')
  await water.getByRole('button', { name: /^Редактировать / }).click()
  const settings = offline.getByRole('dialog', { name: 'Редактировать привычку', exact: true })
  await settings.getByLabel(/^Дневная цель/).fill('2500')
  await settings.getByRole('button', { name: 'Сохранить привычку', exact: true }).click()
  await expect(settings).toHaveCount(0)
  const changed = await readDatabase(offline)
  expect(changed.habitEntries.find((entry) => entry.habitId === 'water' && entry.date === date)).toMatchObject({ value: 800 })
  expect(changed.habits.find((habit) => habit.id === 'water')).toMatchObject({ target: 2500 })
  expect(changed.tasks.some((item) => item.title === 'Создана без сети')).toBe(true)
  expect(changed.goals).toEqual(before.goals)
  expect(changed.goalMilestones).toEqual(before.goalMilestones)
  const backup = await downloadBackup(offline)
  expect(backup.data).toEqual(changed)
  await restoreBackup(offline, backup)
  await offline.reload()
  expect(await readDatabase(offline)).toEqual(changed)
  const cachedURLs = await offline.evaluate(async () => {
    const names = await caches.keys()
    const keys = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))
    return keys.flat().map((request) => request.url)
  })
  expect(cachedURLs.length).toBeGreaterThan(0)
  expect(cachedURLs.every((cached) => new URL(cached).origin === new URL(url).origin && !cached.includes('pwa-backup.json'))).toBe(true)
  await context.setOffline(false)
  await offline.goto(new URL('/#today', url).href)
  await offline.locator('[data-amount-habit-id="water"]').getByRole('button', { name: '+200 мл', exact: true }).click()
  await expect(offline.locator('[data-amount-habit-id="water"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
  expect(errors).toEqual([])
})

test('keeps all routes, local backup and dialogs usable at narrow portrait and landscape sizes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.clock.setFixedTime(instant)
  await seed(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport)
    for (const [route, heading] of routes) {
      await page.goto(`/#${route}`)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expectNoOverflow(page)
    }
    await page.locator('article[data-habit-id="water"]').getByRole('button', { name: /^Редактировать / }).click()
    const dialog = page.getByRole('dialog', { name: 'Редактировать привычку', exact: true })
    await expect(dialog).toBeVisible()
    await expectNoOverflow(page)
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight,
        innerOverflow: element.scrollWidth > element.clientWidth + 1 }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(bounds.width)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height)
    expect(bounds.innerOverflow).toBe(false)
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  }
  const before = await readDatabase(page)
  const backup = await downloadBackup(page)
  expect(backup.data).toEqual(before)
  await restoreBackup(page, backup)
  await page.reload()
  expect(await readDatabase(page)).toEqual(before)
  expect(errors).toEqual([])
})
