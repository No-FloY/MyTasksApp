import { expect, test, type Page } from '@playwright/test'
import type { Habit } from '../src/models/habit'
import type { HabitEntry } from '../src/models/habit-entry'

const booleanNames = [
  'Воздержание',
  'Английский каждый день',
  'Чтение книги каждый день',
  'Подъём до 8:00',
  'Без чипсов',
  'Без газировок и соков',
  'Без энергетиков',
  'Без фастфуда',
] as const

function habitCard(page: Page, name: string = 'Воздержание') {
  return page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) })
}

async function readDatabase(page: Page) {
  return page.evaluate(async () => {
    return new Promise<{ habits: Habit[]; entries: HabitEntry[]; stores: string[] }>((resolve, reject) => {
      const request = indexedDB.open('zadachnik')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(['habits', 'habitEntries'], 'readonly')
        const habits = transaction.objectStore('habits').getAll()
        const entries = transaction.objectStore('habitEntries').getAll()

        transaction.oncomplete = () => {
          const result = {
            habits: habits.result as Habit[],
            entries: entries.result as HabitEntry[],
            stores: Array.from(database.objectStoreNames),
          }
          database.close()
          resolve(result)
        }
        transaction.onerror = () => {
          database.close()
          reject(transaction.error)
        }
      }
    })
  })
}

test('seeds universal habits once and preserves all three boolean states after reload', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'))
  await page.goto('/')

  for (const name of booleanNames) {
    await expect(habitCard(page, name)).toBeVisible()
    await expect(habitCard(page, name).getByRole('button', { name: 'Нет данных', exact: true }))
      .toHaveAttribute('aria-pressed', 'true')
  }

  const initial = await readDatabase(page)
  expect(initial.stores.sort()).toEqual(['habitEntries', 'habits'])
  expect(initial.habits).toHaveLength(11)
  expect(initial.habits.filter((habit) => habit.type === 'boolean')).toHaveLength(8)
  expect(initial.habits).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'water', name: 'Вода', type: 'amount', target: 2000 }),
    expect.objectContaining({ id: 'gaming', type: 'duration' }),
    expect.objectContaining({ id: 'social-media', type: 'duration' }),
  ]))
  // Missing entries remain unknown; merely viewing the day must not record failures.
  expect(initial.entries).toEqual([])

  for (const [label, status] of [
    ['Успех', 'success'],
    ['Неудача', 'failure'],
    ['Нет данных', 'no-data'],
  ] as const) {
    await habitCard(page).getByRole('button', { name: label, exact: true }).click()
    await expect.poll(async () => (await readDatabase(page)).entries).toEqual([
      expect.objectContaining({ habitId: 'abstinence', date: '2026-10-02', type: 'boolean', status }),
    ])

    await page.reload()
    await expect(habitCard(page).getByRole('button', { name: label, exact: true }))
      .toHaveAttribute('aria-pressed', 'true')
    expect((await readDatabase(page)).habits).toHaveLength(11)
  }

  // Explicit no-data remains a single persisted record, rather than a deleted row.
  expect((await readDatabase(page)).entries).toHaveLength(1)
})

for (const { timezoneId, instant, date, nextDate } of [
  {
    timezoneId: 'Europe/Moscow',
    instant: '2026-10-01T21:30:00Z',
    date: '2026-10-02',
    nextDate: '2026-10-03',
  },
  {
    timezoneId: 'America/Los_Angeles',
    instant: '2026-10-02T00:30:00Z',
    date: '2026-10-01',
    nextDate: '2026-10-02',
  },
]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId })

    test('uses the local day near a UTC boundary and keeps different days independent', async ({ page }) => {
      await page.clock.setFixedTime(new Date(instant))
      await page.goto('/')
      await habitCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
      await expect.poll(async () => (await readDatabase(page)).entries).toEqual([
        expect.objectContaining({ habitId: 'abstinence', date, status: 'success' }),
      ])

      await page.clock.setFixedTime(new Date(new Date(instant).getTime() + 24 * 60 * 60 * 1000))
      await page.reload()
      await expect(habitCard(page).getByRole('button', { name: 'Нет данных', exact: true }))
        .toHaveAttribute('aria-pressed', 'true')
      await habitCard(page).getByRole('button', { name: 'Неудача', exact: true }).click()
      await expect.poll(async () => (await readDatabase(page)).entries).toEqual([
        expect.objectContaining({ habitId: 'abstinence', date, status: 'success' }),
        expect.objectContaining({ habitId: 'abstinence', date: nextDate, status: 'failure' }),
      ])
    })
  })
}

test('switches to a new local day at midnight without a reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T20:50:00Z') })
  await page.goto('/')
  await habitCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
  await expect.poll(async () => (await readDatabase(page)).entries).toEqual([
    expect.objectContaining({ date: '2026-10-01', status: 'success' }),
  ])

  await page.clock.pauseAt(new Date('2026-10-01T20:59:50Z'))
  await page.clock.fastForward(20_000)
  // Let Dexie's scheduled live-query delivery run after the local-day timer fires.
  await page.clock.resume()
  await expect(habitCard(page).getByRole('button', { name: 'Нет данных', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  await habitCard(page).getByRole('button', { name: 'Неудача', exact: true }).click()
  await expect.poll(async () => (await readDatabase(page)).entries).toEqual([
    expect.objectContaining({ date: '2026-10-01', status: 'success' }),
    expect.objectContaining({ date: '2026-10-02', status: 'failure' }),
  ])
})

test('shows a recoverable error when the browser denies IndexedDB access', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'open', {
      value() {
        throw new DOMException('Storage access denied for this test', 'SecurityError')
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: /Повторить|Попробовать снова/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Успех', exact: true })).toHaveCount(0)
})

test('handles a browser without the IndexedDB API', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Успех', exact: true })).toHaveCount(0)
})

test('keeps all six navigation items usable on a narrow screen without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await expect(habitCard(page)).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'Разделы приложения' })
  await expect(navigation.getByRole('link')).toHaveCount(6)

  for (const name of ['Календарь', 'Задачи', 'Цели', 'Статистика', 'Настройки']) {
    await navigation.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
    if (name === 'Статистика') {
      await expect(page.locator('[data-duration-statistics-id="gaming"]')).toBeVisible()
    } else if (name === 'Календарь') {
      await expect(page.getByTestId('calendar-month')).toBeVisible()
      await expect(page.locator('[data-calendar-date][aria-current="date"]')).toBeVisible()
    } else {
      await expect(page.getByText('Этот раздел появится на следующих этапах разработки.', { exact: false }))
        .toBeVisible()
    }
    await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  const currentRoute = page.url()
  const skipLink = page.getByRole('link', { name: 'Перейти к содержимому' })
  await skipLink.focus()
  await skipLink.press('Enter')
  await expect(page.locator('main')).toBeFocused()
  expect(page.url()).toBe(currentRoute)

  await navigation.getByRole('link', { name: 'Сегодня', exact: true }).click()
  await expect(habitCard(page)).toBeVisible()
  await habitCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
  await expect(habitCard(page).getByRole('button', { name: 'Успех', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('fits 320–375px screens with finger-sized controls and touch input', async ({ page, isMobile }, testInfo) => {
  await page.goto('/')
  await expect(habitCard(page)).toBeVisible()
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 })
    const sizes = await page.locator('.status-button, .navigation-link').evaluateAll((elements) =>
      elements.map((element) => {
        const rectangle = element.getBoundingClientRect()
        return { width: rectangle.width, height: rectangle.height }
      }),
    )
    expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    const horizontalOverflow = await page.locator('body, nav, main, .habits-card, .status-control').evaluateAll((elements) =>
      elements.some((element) => element.scrollWidth > element.clientWidth + 1),
    )
    expect(horizontalOverflow).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `.artifacts/${testInfo.project.name}-${width}.png`, fullPage: true })
  }

  const success = habitCard(page).getByRole('button', { name: 'Успех', exact: true })
  if (isMobile) await success.tap()
  else await success.click()
  await expect(success).toHaveAttribute('aria-pressed', 'true')

  if (!isMobile) {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.screenshot({ path: '.artifacts/today-desktop-final.png', fullPage: true })
  }
})
