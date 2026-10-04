import { expect, test, type Locator, type Page } from '@playwright/test'
import { createInitialHabits } from '../src/db/seed'
import { isLocalDate } from '../src/lib/local-date'
import type { DurationHabit, Habit } from '../src/models/habit'
import type { DurationHabitEntry, HabitEntry } from '../src/models/habit-entry'

type DurationHabitId = 'gaming' | 'social-media'

function durationCard(page: Page, habitId: DurationHabitId) {
  return page.locator(`[data-duration-habit-id="${habitId}"]`)
}

function statisticsCard(page: Page, habitId: DurationHabitId) {
  return page.locator(`[data-duration-statistics-id="${habitId}"]`)
}

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function readEntries(page: Page) {
  return page.evaluate(async () => new Promise<HabitEntry[]>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('habitEntries', 'readonly')
      const entries = transaction.objectStore('habitEntries').getAll()
      transaction.oncomplete = () => {
        database.close()
        resolve(entries.result as HabitEntry[])
      }
      transaction.onerror = () => {
        database.close()
        reject(transaction.error)
      }
    }
  }))
}

async function saveTime(card: Locator, hours: string, minutes: string) {
  await card.getByRole('textbox', { name: 'Часы', exact: true }).fill(hours)
  await card.getByRole('textbox', { name: 'Минуты', exact: true }).fill(minutes)
  await card.getByRole('button', { name: 'Сохранить время', exact: true }).click()
}

async function expectTime(card: Locator, minutes: number, rating: string) {
  await expect(card.locator('.duration-total')).toHaveText(`${Math.floor(minutes / 60)} ч ${minutes % 60} мин`)
  await expect(card.locator('.duration-rating')).toContainText(rating)
}

async function openStatistics(page: Page) {
  await page.getByRole('navigation', { name: 'Разделы приложения' })
    .getByRole('link', { name: 'Статистика', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Статистика', level: 1, exact: true })).toBeVisible()
}

function historyEntry(habitId: DurationHabitId, date: string, minutes: number): DurationHabitEntry {
  if (!isLocalDate(date)) throw new Error('Invalid fixture date')
  return {
    habitId,
    date,
    type: 'duration',
    minutes,
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T09:00:00.000Z`,
  }
}

async function writeHistory(page: Page, entries: DurationHabitEntry[]) {
  // This is the browser test's isolated IndexedDB, using the real app schema.
  // No mock storage, application seed data, or user's browser profile is changed.
  await page.evaluate(async (history) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('habitEntries', 'readwrite')
      const store = transaction.objectStore('habitEntries')
      for (const entry of history) store.put(entry)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => {
        database.close()
        reject(transaction.error)
      }
    }
  }), entries)
}

test('migrates the existing version-one database without losing boolean, water or duration history', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'))
  const timestamp = '2026-10-07T08:00:00.000Z'
  const initialHabits = createInitialHabits(timestamp)
  const legacyHabits = initialHabits.map((habit) => {
    if (habit.type !== 'duration') return habit
    const legacy: Omit<DurationHabit, 'ratingRanges'> & { ratingRanges?: DurationHabit['ratingRanges'] } = { ...habit }
    delete legacy.ratingRanges
    return legacy
  })
  const date = '2026-10-07'
  if (!isLocalDate(date)) throw new Error('Invalid fixture date')
  const shared = { date, createdAt: timestamp, updatedAt: timestamp }
  const legacyEntries: HabitEntry[] = [
    { ...shared, habitId: 'english', type: 'boolean', status: 'success' },
    { ...shared, habitId: 'water', type: 'amount', value: 2400 },
    { ...shared, habitId: 'gaming', type: 'duration', minutes: 155 },
    { ...shared, habitId: 'social-media', type: 'duration', minutes: 0 },
  ]

  // Establish the isolated test origin without loading the new application yet.
  await page.route('**/migration-setup', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Migration setup</body></html>',
  }))
  await page.goto('/migration-setup')
  await page.evaluate(async ({ habits, entries }) => new Promise<void>((resolve, reject) => {
    // Dexie multiplies its public schema version by ten for native IndexedDB.
    const request = indexedDB.open('zadachnik', 10)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      const habitStore = database.createObjectStore('habits', { keyPath: 'id' })
      habitStore.createIndex('type', 'type')
      habitStore.createIndex('order', 'order')
      const entryStore = database.createObjectStore('habitEntries', { keyPath: ['habitId', 'date'] })
      for (const index of ['habitId', 'date', 'type']) entryStore.createIndex(index, index)
      for (const habit of habits) habitStore.put(habit)
      for (const entry of entries) entryStore.put(entry)
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  }), { habits: legacyHabits, entries: legacyEntries })

  await page.goto('/')
  const english = page.locator('[data-habit-id="english"]')
  await expect(english.getByRole('button', { name: 'Успех', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const water = page.locator('[data-amount-habit-id="water"]')
  await expect(water).toContainText(/2\s*400\s*\/\s*2\s*000\s*мл/)
  await expect(water.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await expectTime(durationCard(page, 'gaming'), 155, 'Хорошо')
  await expectTime(durationCard(page, 'social-media'), 0, 'Отлично')

  const migrated = await page.evaluate(async () => new Promise<{ version: number; habits: Habit[]; stores: string[] }>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('habits', 'readonly')
      const habits = transaction.objectStore('habits').getAll()
      transaction.oncomplete = () => {
        const result = { version: database.version, habits: habits.result as Habit[], stores: Array.from(database.objectStoreNames) }
        database.close()
        resolve(result)
      }
      transaction.onerror = () => {
        database.close()
        reject(transaction.error)
      }
    }
  }))
  expect(migrated.version).toBe(20)
  expect(migrated.stores.sort()).toEqual(['habitEntries', 'habits'])
  expect(migrated.habits).toHaveLength(11)
  expect(migrated.habits).toEqual(expect.arrayContaining(initialHabits))
  expect(await readEntries(page)).toHaveLength(legacyEntries.length)
  expect(await readEntries(page)).toEqual(expect.arrayContaining(legacyEntries))
  await page.reload()
  await expectTime(durationCard(page, 'gaming'), 155, 'Хорошо')
  await expect(water).toContainText(/2\s*400\s*\/\s*2\s*000\s*мл/)
  expect(await readEntries(page)).toEqual(expect.arrayContaining(legacyEntries))
  expect(errors).toEqual([])
})

test('stores minutes for both duration habits, restores ratings, and allows editing to explicit zero', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'))
  await page.goto('/')
  const gaming = durationCard(page, 'gaming')
  const social = durationCard(page, 'social-media')
  await expect(gaming.locator('.duration-total')).toHaveText('Нет данных')
  await expect(social.locator('.duration-total')).toHaveText('Нет данных')
  expect(await readEntries(page)).toEqual([])

  await saveTime(gaming, '2', '35')
  await expectTime(gaming, 155, 'Хорошо')
  await saveTime(social, '1', '15')
  await expectTime(social, 75, 'Хорошо')
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'gaming', type: 'duration', minutes: 155, date: '2026-10-07' }),
    expect.objectContaining({ habitId: 'social-media', type: 'duration', minutes: 75, date: '2026-10-07' }),
  ])
  const first = (await readEntries(page)).find((entry) => entry.habitId === 'gaming')
  for (const entry of await readEntries(page)) {
    expect(entry).not.toHaveProperty('rating')
    expect(entry).not.toHaveProperty('status')
    expect(entry).not.toHaveProperty('emoji')
  }

  await page.reload()
  await expectTime(gaming, 155, 'Хорошо')
  await expectTime(social, 75, 'Хорошо')
  await expect(gaming.getByRole('textbox', { name: 'Часы', exact: true })).toHaveValue('2')
  await expect(gaming.getByRole('textbox', { name: 'Минуты', exact: true })).toHaveValue('35')
  await saveTime(gaming, '0', '0')
  await expectTime(gaming, 0, 'Отлично')
  await saveTime(social, '', '30')
  await expectTime(social, 30, 'Отлично')
  await page.reload()
  await expectTime(gaming, 0, 'Отлично')
  await expectTime(social, 30, 'Отлично')
  const final = await readEntries(page)
  expect(final).toHaveLength(2)
  expect(final.find((entry) => entry.habitId === 'gaming')).toMatchObject({
    minutes: 0,
    createdAt: first?.createdAt,
  })
  expect(errors).toEqual([])
})

test('uses unambiguous gaming and social ratings at the displayed boundaries', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  for (const [habitId, boundaries] of [
    ['gaming', [[120, 'Отлично'], [121, 'Хорошо'], [240, 'Хорошо'], [241, 'Нейтрально'],
      [329, 'Нейтрально'], [330, 'Плохо'], [360, 'Плохо'], [361, 'Очень плохо']]],
    ['social-media', [[60, 'Отлично'], [61, 'Хорошо'], [90, 'Хорошо'], [91, 'Плохо']]],
  ] as const) {
    const card = durationCard(page, habitId)
    for (const [minutes, rating] of boundaries) {
      await saveTime(card, String(Math.floor(minutes / 60)), String(minutes % 60))
      await expectTime(card, minutes, rating)
    }
  }
  expect(await readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'gaming', type: 'duration', minutes: 361 }),
    expect.objectContaining({ habitId: 'social-media', type: 'duration', minutes: 91 }),
  ])
  expect(errors).toEqual([])
})

test('rejects malformed and out-of-day input without losing a saved duration', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const card = durationCard(page, 'gaming')
  await saveTime(card, '2', '35')
  await expectTime(card, 155, 'Хорошо')
  for (const [hours, minutes] of [
    ['', ''], ['-1', '0'], ['1.5', '0'], ['1e2', '0'], ['0', '60'],
    ['0', '-1'], ['0', '2.5'], ['24', '1'], ['25', '0'], ['9007199254740992', '0'],
  ] as const) {
    await saveTime(card, hours, minutes)
    await expect(card.getByRole('alert')).toBeVisible()
    await expectTime(card, 155, 'Хорошо')
    expect(await readEntries(page)).toEqual([
      expect.objectContaining({ habitId: 'gaming', type: 'duration', minutes: 155 }),
    ])
  }
  await saveTime(card, '24', '0')
  await expectTime(card, 1440, 'Очень плохо')
  await expect(card.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('starts an unrecorded local day at midnight and retains the previous duration', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.install({ time: new Date('2026-10-06T20:50:00Z') })
  await page.goto('/')
  const card = durationCard(page, 'gaming')
  await saveTime(card, '2', '35')
  await expectTime(card, 155, 'Хорошо')
  await page.clock.pauseAt(new Date('2026-10-06T20:59:50Z'))
  await page.clock.fastForward(20_000)
  await page.clock.resume()
  await expect(card.locator('.duration-total')).toHaveText('Нет данных')
  await saveTime(card, '0', '0')
  await expectTime(card, 0, 'Отлично')
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'gaming', date: '2026-10-06', type: 'duration', minutes: 155 }),
    expect.objectContaining({ habitId: 'gaming', date: '2026-10-07', type: 'duration', minutes: 0 }),
  ])
  expect(errors).toEqual([])
})

test('calculates seven-day totals, averages and ratings from saved minutes without treating missing days as zero', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'))
  await page.goto('/')
  await expect(durationCard(page, 'gaming')).toBeVisible()
  const gamingMinutes = [0, 120, 180, 300, 360, 420]
  const socialMinutes = [0, 60, 75, 90, 100]
  const history = [
    ...gamingMinutes.map((minutes, index) => historyEntry('gaming', `2026-10-0${index + 1}`, minutes)),
    ...socialMinutes.map((minutes, index) => historyEntry('social-media', `2026-10-0${index + 1}`, minutes)),
    historyEntry('gaming', '2026-09-30', 1440),
    historyEntry('social-media', '2026-10-08', 1440),
  ]
  await writeHistory(page, history)
  await page.reload()
  await openStatistics(page)

  const gaming = statisticsCard(page, 'gaming')
  const social = statisticsCard(page, 'social-media')
  await expect(gaming.locator('[data-statistic="total"]')).toContainText('23 ч 0 мин')
  await expect(gaming.locator('[data-statistic="average"]')).toContainText('3 ч 50 мин')
  await expect(social.locator('[data-statistic="total"]')).toContainText('5 ч 25 мин')
  await expect(social.locator('[data-statistic="average"]')).toContainText('1 ч 5 мин')
  await expect(gaming.locator('[data-statistic="missing"]')).toContainText('1')
  await expect(social.locator('[data-statistic="missing"]')).toContainText('2')
  for (const [ratingId, count] of [
    ['excellent', 2], ['good', 1], ['neutral', 1], ['poor', 1], ['very-poor', 1],
  ] as const) {
    await expect(gaming.locator(`[data-rating-count="${ratingId}"]`)).toHaveText(String(count))
  }
  for (const [ratingId, count] of [['excellent', 2], ['good', 2], ['poor', 1]] as const) {
    await expect(social.locator(`[data-rating-count="${ratingId}"]`)).toHaveText(String(count))
  }

  for (const [card, minutesByDay] of [[gaming, gamingMinutes], [social, socialMinutes]] as const) {
    const rows = card.locator('tbody tr')
    await expect(rows).toHaveCount(7)
    for (let index = 0; index < 7; index += 1) {
      const row = rows.nth(index)
      await expect(row).toContainText(`0${index + 1}.10`)
      const minutes = minutesByDay[index]
      await expect(row).toHaveAttribute('data-duration-minutes', minutes === undefined ? 'missing' : String(minutes))
      await expect(row).toContainText(minutes === undefined
        ? 'Нет данных'
        : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`)
    }
    await expect(card.locator('.recharts-surface')).toBeVisible()
  }
  expect(await readEntries(page)).toHaveLength(history.length)
  await page.reload()
  await expect(gaming.locator('[data-statistic="total"]')).toContainText('23 ч 0 мин')
  await expect(social.locator('[data-statistic="average"]')).toContainText('1 ч 5 мин')
  expect(errors).toEqual([])
})

test('keeps empty weekly statistics distinct from an explicitly recorded zero day', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(durationCard(page, 'gaming')).toBeVisible()
  await openStatistics(page)
  for (const habitId of ['gaming', 'social-media'] as const) {
    const card = statisticsCard(page, habitId)
    await expect(card.locator('[data-statistic="average"]')).toContainText('Нет данных')
    await expect(card.locator('[data-statistic="missing"]')).toContainText('7')
  }
  expect(await readEntries(page)).toEqual([])
  await page.getByRole('navigation', { name: 'Разделы приложения' })
    .getByRole('link', { name: 'Сегодня', exact: true }).click()
  await saveTime(durationCard(page, 'gaming'), '0', '0')
  await expectTime(durationCard(page, 'gaming'), 0, 'Отлично')
  await openStatistics(page)
  const gaming = statisticsCard(page, 'gaming')
  await expect(gaming.locator('[data-statistic="average"]')).toContainText('0 ч 0 мин')
  await expect(gaming.locator('[data-statistic="missing"]')).toContainText('6')
  await expect(gaming.locator('[data-rating-count="excellent"]')).toHaveText('1')
  await expect(statisticsCard(page, 'social-media').locator('[data-statistic="average"]')).toContainText('Нет данных')
  expect(errors).toEqual([])
})

test('fits duration inputs and weekly statistics on 320, 375 and 390px screens', async ({ page, isMobile }, testInfo) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const gaming = durationCard(page, 'gaming')
  const social = durationCard(page, 'social-media')
  await expect(gaming).toBeVisible()
  await expect(social).toBeVisible()

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const card of [gaming, social]) {
      const sizes = await card.locator('input, button').evaluateAll((elements) => elements.map((element) => {
        const rectangle = element.getBoundingClientRect()
        return { width: rectangle.width, height: rectangle.height }
      }))
      expect(sizes).toHaveLength(3)
      expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
      expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await gaming.getByRole('textbox', { name: 'Часы', exact: true }).fill('2')
    await gaming.getByRole('textbox', { name: 'Минуты', exact: true }).fill('35')
    const save = gaming.getByRole('button', { name: 'Сохранить время', exact: true })
    if (isMobile) await save.tap()
    else await save.click()
    await expectTime(gaming, 155, 'Хорошо')
    await page.screenshot({ path: `.artifacts/duration-${testInfo.project.name}-${width}.png`, fullPage: true })

    await openStatistics(page)
    await expect(statisticsCard(page, 'gaming').locator('[data-statistic="total"]')).toContainText('2 ч 35 мин')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    for (const habitId of ['gaming', 'social-media'] as const) {
      expect(await statisticsCard(page, habitId).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    }
    await page.screenshot({ path: `.artifacts/duration-statistics-${testInfo.project.name}-${width}.png`, fullPage: true })
    await page.getByRole('navigation', { name: 'Разделы приложения' })
      .getByRole('link', { name: 'Сегодня', exact: true }).click()
    await expectTime(gaming, 155, 'Хорошо')
  }
  expect(errors).toEqual([])
})
