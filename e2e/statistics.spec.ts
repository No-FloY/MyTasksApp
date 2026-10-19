import { expect, test, type Locator, type Page } from '@playwright/test'
import { createInitialHabits } from '../src/db/seed'
import { isLocalDate } from '../src/lib/local-date'
import type { Goal, GoalMilestone } from '../src/models/goal'
import type { Habit } from '../src/models/habit'
import type { HabitEntry } from '../src/models/habit-entry'
import type { Task } from '../src/models/task'

const instant = new Date('2026-10-15T09:00:00.000Z')
const timestamp = '2026-09-01T09:00:00.000Z'
const today = localDate('2026-10-15')
const errorsByPage = new WeakMap<Page, string[]>()

interface StatisticsFixture {
  habits: Habit[]
  entries: HabitEntry[]
  tasks: Task[]
  goals: Goal[]
  milestones: GoalMilestone[]
}

function localDate(value: string) {
  if (!isLocalDate(value)) throw new Error(`Invalid fixture date: ${value}`)
  return value
}

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  errorsByPage.set(page, errors)
  return errors
}

test.beforeEach(async ({ page }) => {
  watchErrors(page)
  await page.clock.setFixedTime(instant)
})

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page)).toEqual([])
})

function fixture(): StatisticsFixture {
  const habits = createInitialHabits(timestamp).filter((habit) =>
    ['abstinence', 'english', 'reading', 'water', 'gaming', 'social-media'].includes(habit.id))
    .map((habit) => habit.id === 'reading' ? { ...habit, archivedAt: '2026-10-11T18:00:00.000Z' } : habit)
  const entryBase = { createdAt: timestamp, updatedAt: timestamp }
  const entries: HabitEntry[] = [
    ...(['09', '10', '14', '15'] as const).map((day) => ({
      ...entryBase, habitId: 'abstinence', date: localDate(`2026-10-${day}`), type: 'boolean' as const, status: 'success' as const,
    })),
    { ...entryBase, habitId: 'abstinence', date: localDate('2026-10-11'), type: 'boolean', status: 'failure' },
    { ...entryBase, habitId: 'abstinence', date: localDate('2026-10-12'), type: 'boolean', status: 'no-data' },
    { ...entryBase, habitId: 'reading', date: localDate('2026-10-09'), type: 'boolean', status: 'success' },
    { ...entryBase, habitId: 'reading', date: localDate('2026-10-11'), type: 'boolean', status: 'failure' },
    ...([['09', 0], ['11', 1000], ['13', 2000], ['15', 3000]] as const).map(([day, value]) => ({
      ...entryBase, habitId: 'water', date: localDate(`2026-10-${day}`), type: 'amount' as const, value,
    })),
    ...([['09', 0], ['11', 120], ['13', 180], ['15', 420]] as const).map(([day, minutes]) => ({
      ...entryBase, habitId: 'gaming', date: localDate(`2026-10-${day}`), type: 'duration' as const, minutes,
    })),
    ...([['09', 0], ['11', 60], ['13', 90], ['15', 120]] as const).map(([day, minutes]) => ({
      ...entryBase, habitId: 'social-media', date: localDate(`2026-10-${day}`), type: 'duration' as const, minutes,
    })),
    // Outside the default week: period switches must query these persisted rows.
    { ...entryBase, habitId: 'water', date: localDate('2026-09-15'), type: 'amount', value: 4000 },
    { ...entryBase, habitId: 'water', date: localDate('2026-10-01'), type: 'amount', value: 1000 },
  ]
  const taskBase: Task = { id: '', title: '', description: '', date: today, time: null, priority: 'medium',
    status: 'active', createdAt: timestamp, updatedAt: timestamp, completedAt: null }
  const tasks: Task[] = [
    { ...taskBase, id: 'on-time', title: 'Сделано вовремя', date: localDate('2026-10-12'), status: 'completed', completedAt: '2026-10-12T18:00:00.000Z' },
    { ...taskBase, id: 'late', title: 'Сделано поздно', date: localDate('2026-10-13'), time: '12:00', status: 'completed', completedAt: '2026-10-13T09:00:00.001Z' },
    { ...taskBase, id: 'overdue', title: 'Просроченная задача', date: localDate('2026-10-14') },
    { ...taskBase, id: 'failed', title: 'Не выполнена', status: 'failed' },
    { ...taskBase, id: 'cancelled', title: 'Отменена', date: localDate('2026-10-14'), status: 'cancelled' },
    { ...taskBase, id: 'unknown', title: 'Старая запись без времени выполнения', status: 'completed' },
    { ...taskBase, id: 'pending-time', title: 'Сегодня в 13 часов', time: '13:00' },
    { ...taskBase, id: 'pending-day', title: 'Сегодня без времени' },
    { ...taskBase, id: 'outside', title: 'За пределами недели', date: localDate('2026-10-01'), status: 'completed', completedAt: '2026-10-01T08:00:00.000Z' },
  ]
  const goalBase: Goal = { id: '', title: '', description: '', deadline: null, status: 'active', progressMode: 'auto',
    manualProgress: 0, archived: false, createdAt: timestamp, updatedAt: timestamp }
  const goals: Goal[] = [
    { ...goalBase, id: 'auto-goal', title: 'Автоматическая цель', deadline: localDate('2026-10-14') },
    { ...goalBase, id: 'manual-goal', title: 'Ручная цель', progressMode: 'manual', manualProgress: 25 },
    { ...goalBase, id: 'completed-goal', title: 'Завершённая цель', status: 'completed' },
    { ...goalBase, id: 'failed-goal', title: 'Незавершённая цель', status: 'failed' },
    { ...goalBase, id: 'cancelled-goal', title: 'Отменённая цель', status: 'cancelled' },
    { ...goalBase, id: 'archived-goal', title: 'Архивная цель', archived: true, progressMode: 'manual', manualProgress: 100 },
  ]
  const milestones: GoalMilestone[] = [
    { id: 'boolean-stage', goalId: 'auto-goal', title: 'Готовый этап', order: 0, type: 'boolean', completed: true, createdAt: timestamp, updatedAt: timestamp },
    { id: 'amount-stage', goalId: 'auto-goal', title: 'Числовой этап', order: 1, type: 'amount', current: 1, target: 2, createdAt: timestamp, updatedAt: timestamp },
  ]
  return { habits, entries, tasks, goals, milestones }
}

/** Each Playwright test owns a fresh browser context. Never touches the user's profile. */
async function seedDatabase(page: Page, source: StatisticsFixture) {
  await page.route('**/statistics-fixture', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Statistics fixture</body></html>',
  }))
  await page.goto('/statistics-fixture')
  await page.evaluate(async (source) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik', 40)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      const habits = database.createObjectStore('habits', { keyPath: 'id' })
      for (const key of ['type', 'order']) habits.createIndex(key, key)
      const entries = database.createObjectStore('habitEntries', { keyPath: ['habitId', 'date'] })
      for (const key of ['habitId', 'date', 'type']) entries.createIndex(key, key)
      const tasks = database.createObjectStore('tasks', { keyPath: 'id' })
      for (const key of ['date', 'status', 'goalId']) tasks.createIndex(key, key)
      const goals = database.createObjectStore('goals', { keyPath: 'id' })
      for (const key of ['status', 'deadline']) goals.createIndex(key, key)
      const milestones = database.createObjectStore('goalMilestones', { keyPath: 'id' })
      milestones.createIndex('goalId', 'goalId')
      milestones.createIndex('[goalId+order]', ['goalId', 'order'])
      for (const row of source.habits) habits.put(row)
      for (const row of source.entries) entries.put(row)
      for (const row of source.tasks) tasks.put(row)
      for (const row of source.goals) goals.put(row)
      for (const row of source.milestones) milestones.put(row)
    }
    request.onsuccess = () => { request.result.close(); resolve() }
  }), source)
}

async function readSnapshot(page: Page) {
  return page.evaluate(async () => new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const names = Array.from(database.objectStoreNames)
      const transaction = database.transaction(names, 'readonly')
      const reads = names.map((name) => [name, transaction.objectStore(name).getAll()] as const)
      transaction.oncomplete = () => {
        const result = { version: database.version, ...Object.fromEntries(reads.map(([name, read]) => [name, read.result])) }
        database.close()
        resolve(result)
      }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    }
  }))
}

async function openStatistics(page: Page, hash = '#statistics') {
  await page.goto(`/${hash}`)
  await expect(page.getByRole('heading', { level: 1, name: /^Статистика/ })).toBeVisible()
  await expect(page.getByTestId('statistics-period-label')).toBeVisible()
}

function metric(scope: Page | Locator, name: string) {
  return scope.locator(`[data-statistic="${name}"]`)
}

function habit(scope: Page, kind: 'boolean' | 'amount' | 'duration', id: string) {
  return scope.locator(`[data-${kind}-statistics-id="${id}"]`)
}

test('uses saved boolean, water and duration facts, distinguishes zero from missing, and preserves the database after reload', async ({ page }, testInfo) => {
  await seedDatabase(page, fixture())
  const before = await readSnapshot(page)
  await openStatistics(page)
  await expect(page.getByRole('button', { name: '7 дней', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('statistics-period-label')).toHaveText(/9 окт\. 2026 — 15 окт\. 2026/)
  const boolean = habit(page, 'boolean', 'abstinence')
  for (const [name, value] of Object.entries({ success: '4', failure: '1', 'no-data': '2', 'success-rate': '80%', 'current-streak': '2 дн.', 'best-streak': '2 дн.' })) {
    await expect(metric(boolean, name)).toHaveText(value)
  }
  await expect(boolean.getByRole('meter')).toHaveAttribute('aria-valuenow', '80')
  await expect(metric(habit(page, 'boolean', 'english'), 'success-rate')).toHaveText('Нет данных')
  const water = habit(page, 'amount', 'water')
  await expect(metric(water, 'total')).toHaveText(/6\s000/)
  await expect(metric(water, 'average')).toHaveText(/1\s500\s(?:ml|мл)/)
  await expect(metric(water, 'maximum')).toHaveText(/3\s000\s(?:ml|мл)/)
  await expect(metric(water, 'successful')).toHaveText('2 / 4 дн.')
  await expect(metric(water, 'success-rate')).toHaveText('50%')
  await expect(water.getByRole('img', { name: 'Вода по дням', exact: true })).toBeVisible()
  await expect(water.locator('tbody tr')).toHaveCount(7)
  await expect(water.locator('tr[data-amount-value="0"]')).toContainText('Ниже цели')
  await expect(water.locator('tr[data-amount-value="missing"]')).toHaveCount(3)
  await expect(water.locator('tr[data-amount-value="3000"]')).toContainText('Достигнута')
  const gaming = habit(page, 'duration', 'gaming')
  await expect(metric(gaming, 'total')).toHaveText('12 ч 0 мин')
  await expect(metric(gaming, 'average')).toHaveText('3 ч 0 мин')
  await expect(metric(gaming, 'missing')).toHaveText('3')
  await expect(gaming.locator('[data-rating-count="excellent"]')).toHaveText('2')
  await expect(gaming.locator('[data-rating-count="good"]')).toHaveText('1')
  await expect(gaming.locator('[data-rating-count="very-poor"]')).toHaveText('1')
  await expect(gaming.locator('tr[data-duration-minutes="0"]')).toContainText('0 ч 0 мин')
  const social = habit(page, 'duration', 'social-media')
  await expect(metric(social, 'total')).toHaveText('4 ч 30 мин')
  await expect(metric(social, 'average')).toHaveText('≈ 1 ч 8 мин')
  await expect(social.locator('[data-rating-count="poor"]')).toHaveText('1')
  await page.screenshot({ path: `.artifacts/statistics-${testInfo.project.name}.png`, fullPage: true })
  await page.reload()
  await expect(metric(habit(page, 'amount', 'water'), 'total')).toHaveText(/6\s000/)
  await expect(metric(habit(page, 'duration', 'gaming'), 'total')).toHaveText('12 ч 0 мин')
  expect(await readSnapshot(page)).toEqual(before)
  expect(before.version).toBe(40)
  expect(Object.keys(before).sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks', 'version'])
})

test('counts task outcomes by deadline and shows current goal progress independently of the selected period', async ({ page }) => {
  await seedDatabase(page, fixture())
  await openStatistics(page)
  const tasks = page.getByTestId('task-statistics')
  for (const [name, value] of Object.entries({ 'tasks-due': '8', relevant: '4', 'on-time': '1', late: '1', overdue: '1', failed: '1', cancelled: '1', unknown: '1', pending: '2', 'on-time-rate': '25%', 'deviation-rate': '75%' })) {
    await expect(metric(tasks, name)).toHaveText(value)
  }
  const goals = page.getByTestId('goal-statistics')
  for (const [name, value] of Object.entries({ total: '5', active: '2', completed: '1', failed: '1', cancelled: '1', overdue: '1', archived: '1', 'average-progress': '50%' })) {
    await expect(metric(goals, name)).toHaveText(value)
  }
  await page.getByRole('button', { name: 'Предыдущий месяц', exact: true }).click()
  await expect(metric(tasks, 'tasks-due')).toHaveText('0')
  await expect(metric(tasks, 'on-time-rate')).toHaveText('Нет данных')
  await expect(metric(tasks, 'deviation-rate')).toHaveText('Нет данных')
  await expect(metric(goals, 'average-progress')).toHaveText('50%')
  await expect(metric(goals, 'overdue')).toHaveText('1')
})

test('selects every inclusive period, restores custom dates, distinguishes years, and validates malformed or future dates', async ({ page, isMobile }) => {
  await seedDatabase(page, fixture())
  await openStatistics(page)
  const water = habit(page, 'amount', 'water')
  const periods = [
    ['Месяц', 'month', /1 окт\. 2026 — 15 окт\. 2026/, 15, /7\s000/],
    ['Предыдущий месяц', 'previous-month', /1 сент\. 2026 — 30 сент\. 2026/, 30, /4\s000/],
    ['3 месяца', '3m', /16 июл\. 2026 — 15 окт\. 2026/, 92, /11\s000/],
    ['6 месяцев', '6m', /16 апр\. 2026 — 15 окт\. 2026/, 183, /11\s000/],
    ['Год', 'year', /16 окт\. 2025 — 15 окт\. 2026/, 365, /11\s000/],
    ['7 дней', '7d', /9 окт\. 2026 — 15 окт\. 2026/, 7, /6\s000/],
  ] as const
  for (const [name, preset, label, rows, total] of periods) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#statistics\\?period=${preset}$`))
    await expect(page.getByTestId('statistics-period-label')).toHaveText(label)
    await expect(metric(water, 'total')).toHaveText(total)
    // Table preserves every calendar date, including gaps before habit creation.
    await expect(water.locator('tbody tr')).toHaveCount(rows)
  }
  await page.getByRole('button', { name: 'Свой период', exact: true }).click()
  const from = page.getByLabel('С даты', { exact: true })
  const to = page.getByLabel('По дату', { exact: true })
  const apply = page.getByRole('button', { name: 'Применить период', exact: true })
  for (const [startDate, endDate, message] of [
    ['', today, /корректные даты/],
    [today, '2026-10-09', /позже окончания/],
    ['2026-10-09', '2026-10-16', /позже сегодняшнего дня/],
    ['2010-01-01', today, /10 лет/],
  ] as const) {
    await from.fill(startDate)
    await to.fill(endDate)
    await apply.click()
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(from).toHaveAttribute('aria-invalid', 'true')
    await expect(metric(water, 'total')).toHaveText(/6\s000/)
    await expect(page).toHaveURL(/period=7d$/)
  }
  await from.fill('2026-10-11')
  await to.fill('2026-10-13')
  await apply.click()
  await expect(page).toHaveURL(/period=custom&from=2026-10-11&to=2026-10-13$/)
  await expect(metric(water, 'total')).toHaveText(/3\s000/)
  await expect(water.locator('tbody tr')).toHaveCount(3)
  await page.reload()
  await expect(from).toHaveValue('2026-10-11')
  await expect(to).toHaveValue('2026-10-13')
  await expect(metric(water, 'total')).toHaveText(/3\s000/)

  await from.fill('2025-10-09')
  await to.fill(today)
  await apply.click()
  await expect(water.locator('tbody tr')).toHaveCount(372)
  for (const scope of [water, habit(page, 'duration', 'gaming'), habit(page, 'duration', 'social-media')]) {
    await scope.locator('summary').click()
    const table = scope.getByRole('table')
    await expect(table.getByRole('rowheader', { name: '09.10.2025', exact: true })).toHaveCount(1)
    await expect(table.getByRole('rowheader', { name: '09.10.2026', exact: true })).toHaveCount(1)
    await expect(table.getByRole('row', { name: /^09\.10\.2025 / })).toContainText('Нет данных')
    await expect(table.getByRole('row', { name: /^09\.10\.2026 / })).not.toContainText('Нет данных')
  }
  const chart = water.getByRole('img', { name: 'Вода по дням', exact: true })
  const lastPoint = chart.locator('.recharts-line-dot').last()
  if (isMobile) await lastPoint.tap()
  else await lastPoint.click()
  await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText('15.10.2026')
  await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText(/3\s000/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const [preset, firstWeek, count] of [
  ['3 месяца', '16.07–19.07', 14],
  ['6 месяцев', '16.04–19.04', 27],
  ['Год', '16.10.2025–19.10.2025', 53],
] as const) {
  test(`shows independent weekly trends with clipped boundaries and missing weeks: ${preset}`, async ({ page, isMobile }) => {
    await seedDatabase(page, fixture())
    await openStatistics(page)
    const weekly = page.getByTestId('weekly-statistics')
    await expect(weekly).toHaveCount(0)

    const series = [
      ['Успехи привычек', '60%', '100%', 'Нет данных'],
      ['Задачи вовремя', 'Нет данных', '25%', 'Нет данных'],
      ['Дни с целью воды', '0%', '100%', '100%'],
      ['Игры: среднее время', '1 ч 0 мин', '5 ч 0 мин', 'Нет данных'],
      ['Соцсети: среднее время', '0 ч 30 мин', '1 ч 45 мин', 'Нет данных'],
    ] as const
    await page.getByRole('button', { name: preset, exact: true }).click()
    await expect(weekly).toBeVisible()
    for (const [index, [name, earlierValue, latestValue, septemberValue]] of series.entries()) {
      // Keep each locator scoped to its card: repeated accessible-name searches
      // through a full year of tables are unnecessarily expensive in WebKit.
      const card = weekly.locator('.statistics-card').nth(index)
      await expect(card.getByRole('heading', { level: 3 })).toHaveText(name)
      const details = card.locator('details')
      if (!(await details.evaluate((element) => element.hasAttribute('open')))) {
        if (isMobile) await details.locator('summary').tap()
        else await details.locator('summary').click()
      }
      const table = card.locator('table')
      await expect(table).toHaveAccessibleName(name)
      const rows = table.locator('tbody tr')
      // Read one DOM snapshot per table; keep every value/boundary assertion
      // without dozens of browser round trips and full-page trace snapshots.
      await expect.poll(async () => {
        const values = await rows.evaluateAll((elements) => elements.map((element) => ({
          date: element.querySelector('th')?.textContent,
          value: element.querySelector('td')?.textContent,
        })))
        return {
          count: values.length, first: values[0], last: values.at(-1),
          earlier: values.find((row) => row.date === (preset === 'Год' ? '05.10.2026–11.10.2026' : '05.10–11.10'))?.value,
          september: values.find((row) => row.date === (preset === 'Год' ? '14.09.2026–20.09.2026' : '14.09–20.09'))?.value,
        }
      }).toEqual({
        count, first: { date: firstWeek, value: 'Нет данных' },
        last: { date: preset === 'Год' ? '12.10.2026–15.10.2026' : '12.10–15.10', value: latestValue },
        earlier: earlierValue, september: septemberValue,
      })
      await expect(card.getByRole('img', { name: `${name} по неделям`, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: '7 дней', exact: true }).click()
    await expect(weekly).toHaveCount(0)
  })
}

test('falls back safely from malformed period hashes and recovers through normal navigation', async ({ page }) => {
  await seedDatabase(page, fixture())
  const before = await readSnapshot(page)
  for (const [hash, message] of [
    ['#statistics?period=unknown', /Неизвестный период/],
    ['#statistics?period=custom&from=2026-02-30&to=2026-10-15', /корректные даты/],
    ['#statistics?period=custom&from=2026-10-09', /корректные даты/],
    ['#statistics?period=custom&from=2026-10-15&to=2026-10-09', /позже окончания/],
    ['#statistics?period=custom&from=2026-10-09&to=2026-10-16', /позже сегодняшнего дня/],
    ['#statistics?period=custom&from=2010-01-01&to=2026-10-15', /10 лет/],
  ] as const) {
    await openStatistics(page, hash)
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.getByRole('alert')).toContainText('Показаны последние 7 дней.')
    await expect(page.getByRole('button', { name: '7 дней', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('statistics-period-label')).toHaveText(/9 окт\. 2026 — 15 окт\. 2026/)
    await expect(metric(habit(page, 'amount', 'water'), 'total')).toHaveText(/6\s000/)
    await expect(habit(page, 'amount', 'water').locator('tbody tr')).toHaveCount(7)
  }
  await page.getByRole('button', { name: 'Месяц', exact: true }).click()
  await expect(page).toHaveURL(/#statistics\?period=month$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(metric(habit(page, 'amount', 'water'), 'total')).toHaveText(/7\s000/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Месяц', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await readSnapshot(page)).toEqual(before)
})

test('reveals chart values by tap or click at mobile width without hover', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await seedDatabase(page, fixture())
  await openStatistics(page)
  const chart = habit(page, 'amount', 'water').getByRole('img', { name: 'Вода по дням', exact: true })
  const lastBar = chart.locator('.recharts-bar-rectangle path').last()
  await expect(lastBar).toBeVisible()
  if (isMobile) await lastBar.tap()
  else await lastBar.click()
  const tooltip = chart.locator('.recharts-tooltip-wrapper')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('15.10')
  await expect(tooltip).toContainText(/3\s000\s(?:ml|мл)/)
  const bounds = await tooltip.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('keeps archived habit history, excludes days after archival, and distinguishes empty data from recorded zero', async ({ page }) => {
  const source = fixture()
  source.tasks = []
  source.goals = []
  source.milestones = []
  source.entries = source.entries.filter((entry) => entry.habitId === 'reading')
  await seedDatabase(page, source)
  await openStatistics(page)
  const archived = habit(page, 'boolean', 'reading')
  await expect(archived).toContainText('Архив')
  await expect(metric(archived, 'success-rate')).toHaveText('50%')
  await expect(metric(archived, 'no-data')).toHaveText('1')
  const water = habit(page, 'amount', 'water')
  await expect(metric(water, 'average')).toHaveText('Нет данных')
  await expect(metric(water, 'maximum')).toHaveText('Нет данных')
  await expect(water.getByRole('img')).toHaveCount(0)
  await expect(metric(habit(page, 'duration', 'gaming'), 'average')).toHaveText('Нет данных')
  await expect(metric(page.getByTestId('goal-statistics'), 'average-progress')).toHaveText('Нет данных')
  await page.getByRole('button', { name: 'Свой период', exact: true }).click()
  await page.getByLabel('С даты', { exact: true }).fill('2026-10-12')
  await page.getByLabel('По дату', { exact: true }).fill(today)
  await page.getByRole('button', { name: 'Применить период', exact: true }).click()
  await expect(archived).toHaveCount(0)
  await expect(page.getByTestId('statistics-empty')).toBeVisible()
  await expect(metric(habit(page, 'boolean', 'abstinence'), 'failure')).toHaveText('0')
  await expect(metric(habit(page, 'boolean', 'abstinence'), 'no-data')).toHaveText('4')
  await page.reload()
  expect((await readSnapshot(page)).habitEntries).toEqual(expect.arrayContaining(source.entries))
})

test('updates all statistic sections after edits in another tab through liveQuery', async ({ page, context }) => {
  await seedDatabase(page, fixture())
  await openStatistics(page)
  const other = await context.newPage()
  const otherErrors = watchErrors(other)
  await other.clock.setFixedTime(instant)
  await other.goto('/#today')
  await other.locator('[data-habit-id="abstinence"]').getByRole('button', { name: 'Неудача', exact: true }).click()
  await expect(metric(habit(page, 'boolean', 'abstinence'), 'success-rate')).toHaveText('60%')
  await other.locator('[data-amount-habit-id="water"]').getByRole('button', { name: '+200 мл', exact: true }).click()
  await expect(metric(habit(page, 'amount', 'water'), 'total')).toHaveText(/6\s200/)
  const gaming = other.locator('[data-duration-habit-id="gaming"]')
  await gaming.getByRole('textbox', { name: 'Часы', exact: true }).fill('1')
  await gaming.getByRole('textbox', { name: 'Минуты', exact: true }).fill('0')
  await gaming.getByRole('button', { name: 'Сохранить время', exact: true }).click()
  await expect(metric(habit(page, 'duration', 'gaming'), 'total')).toHaveText('6 ч 0 мин')
  await other.goto('/#tasks')
  await other.getByRole('button', { name: 'Выполнить задачу «Сегодня без времени»', exact: true }).click()
  await expect(metric(page.getByTestId('task-statistics'), 'on-time-rate')).toHaveText('40%')
  await other.goto('/#goals?id=auto-goal')
  await other.getByRole('button', { name: 'Вернуть этап «Готовый этап» в работу', exact: true }).click()
  await expect(metric(page.getByTestId('goal-statistics'), 'average-progress')).toHaveText('25%')
  expect(otherErrors).toEqual([])
  await other.close()
})

test('refreshes local deadlines and the seven-day range after returning to the tab across midnight', async ({ page }) => {
  await seedDatabase(page, fixture())
  await openStatistics(page)
  const tasks = page.getByTestId('task-statistics')
  await expect(metric(tasks, 'overdue')).toHaveText('1')
  // 13:00 Moscow: equality is on time, one millisecond after is overdue.
  await page.clock.setFixedTime(new Date('2026-10-15T10:00:00.001Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(metric(tasks, 'overdue')).toHaveText('2')
  await expect(metric(tasks, 'relevant')).toHaveText('5')
  // UTC is still October 15; the local calendar day is already October 16.
  await page.clock.setFixedTime(new Date('2026-10-15T21:00:00.100Z'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByTestId('statistics-period-label')).toHaveText(/10 окт\. 2026 — 16 окт\. 2026/)
  await expect(metric(tasks, 'overdue')).toHaveText('3')
  await expect(metric(tasks, 'pending')).toHaveText('0')
  await expect(metric(habit(page, 'boolean', 'abstinence'), 'success')).toHaveText('3')
  await expect(metric(habit(page, 'boolean', 'abstinence'), 'current-streak')).toHaveText('0 дн.')
})

test('recovers from an IndexedDB read error without showing stale or fabricated results', async ({ page }) => {
  await seedDatabase(page, fixture())
  const before = await readSnapshot(page)
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.getAll
    Object.defineProperty(IDBObjectStore.prototype, 'getAll', {
      configurable: true,
      value(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['getAll']>) {
        if (this.name === 'habits' && sessionStorage.getItem('statistics-read-blocked') === 'yes') {
          throw new DOMException('Чтение хранилища временно недоступно.', 'UnknownError')
        }
        return original.apply(this, args)
      },
    })
  })
  await page.evaluate(() => sessionStorage.setItem('statistics-read-blocked', 'yes'))
  await openStatistics(page)
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить статистику')
  await expect(habit(page, 'amount', 'water')).toHaveCount(0)
  await page.evaluate(() => sessionStorage.removeItem('statistics-read-blocked'))
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(metric(habit(page, 'amount', 'water'), 'total')).toHaveText(/6\s000/)
  expect(await readSnapshot(page)).toEqual(before)
})

test('fits 320, 375 and 390px, keeps touch targets usable, and exposes tables without hover', async ({ page, isMobile }, testInfo) => {
  const source = fixture()
  source.habits = source.habits.map((item) => item.id === 'abstinence'
    ? { ...item, name: 'Оченьдлинноеназваниепривычкибезпробелов'.repeat(4) } : item)
  await seedDatabase(page, source)
  await openStatistics(page)
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const month = page.getByRole('button', { name: 'Месяц', exact: true })
    if (isMobile) await month.tap()
    else await month.click()
    await expect(metric(habit(page, 'amount', 'water'), 'total')).toHaveText(/7\s000/)
    const details = habit(page, 'amount', 'water').locator('details')
    const summary = details.locator('summary')
    if (!(await details.evaluate((element) => element.hasAttribute('open')))) {
      if (isMobile) await summary.tap()
      else await summary.click()
    }
    await expect(habit(page, 'amount', 'water').getByRole('table')).toBeVisible()
    const custom = page.getByRole('button', { name: 'Свой период', exact: true })
    if (isMobile) await custom.tap()
    else await custom.click()
    await expect(page.getByLabel('С даты', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const sizes = await page.locator('main button, main input, main summary').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }).filter((size) => size.width > 0 && size.height > 0))
    expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    await page.screenshot({ path: `.artifacts/statistics-${testInfo.project.name}-${width}.png`, fullPage: true })
    const week = page.getByRole('button', { name: '7 дней', exact: true })
    if (isMobile) await week.tap()
    else await week.click()
    await expect(metric(habit(page, 'amount', 'water'), 'total')).toHaveText(/6\s000/)
  }
})
