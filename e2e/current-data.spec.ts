import { expect, test, type Page } from '@playwright/test'
import { createInitialHabits } from '../src/db/seed'
import { isLocalDate } from '../src/lib/local-date'
import type { BackupData } from '../src/models/backup'
import { downloadBackup, expectNoOverflow, instant, readDatabase, restoreBackup } from '../scripts/pwa-test/helpers'
import { legacyBackup } from '../scripts/pwa-test/legacy-backup'

const errorsByPage = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  errorsByPage.set(page, errors)
  await page.clock.setFixedTime(instant)
})
test.afterEach(async ({ page }) => { expect(errorsByPage.get(page)).toEqual([]) })

function date(value: string) {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

function emptyCurrentData(createdAt = '2026-10-01T09:00:00.000Z'): BackupData {
  return { habits: createInitialHabits(createdAt), habitEntries: [], tasks: [], goals: [], goalMilestones: [] }
}

async function restoreCurrent(page: Page, data: BackupData) {
  await page.goto('/#settings')
  await restoreBackup(page, { app: 'zadachnik', formatVersion: 4, exportedAt: instant.toISOString(), data })
}

async function choose(page: Page, id: string, label: string) {
  const button = page.locator(`[data-habit-id="${id}"]`).getByRole('button', { name: label, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

test('imports a pre-training v1 backup and restores all current system habits without changing history or custom lifecycle', async ({ page }) => {
  const legacy = legacyBackup()
  await page.goto('/#settings')
  await restoreBackup(page, legacy)
  const restored = await readDatabase(page)
  expect(restored.habits).toHaveLength(24)
  expect(new Set(restored.habits.map((habit) => habit.id)).size).toBe(24)
  for (const name of ['habitEntries', 'tasks', 'goals', 'goalMilestones'] as const) {
    expect(restored[name]).toEqual(expect.arrayContaining(legacy.data[name]))
    expect(restored[name]).toHaveLength(legacy.data[name].length)
  }
  expect(restored.habits.find((habit) => habit.id === 'english')).toMatchObject({ name: 'Мой английский', missingDataPolicy: 'assume_not_done' })
  expect(restored.habits.find((habit) => habit.id === 'reading')).toMatchObject({ archivedAt: '2026-10-20T10:00:00.000Z' })
  for (const id of ['push-ups', 'abs', 'squats', 'pull-ups', 'walk-10km', 'workout', 'no-alcohol', 'breakfast', 'lunch', 'dinner', 'cleaning', 'coffee']) {
    expect(restored.habits.find((habit) => habit.id === id)).toMatchObject({ createdAt: instant.toISOString() })
  }
  expect(restored.habits.find((habit) => habit.id === 'cleaning')).toMatchObject({ schedule: { type: 'weekly' } })
  expect(restored.habits.find((habit) => habit.id === 'coffee')).toMatchObject({ booleanMode: 'observation', missingDataPolicy: 'assume_not_occurred' })
  await page.goto('/#today')
  for (const id of ['push-ups', 'abs', 'squats', 'pull-ups']) await expect(page.locator(`[data-amount-habit-id="${id}"]`)).toBeVisible()
  for (const id of ['walk-10km', 'workout', 'no-alcohol', 'breakfast', 'lunch', 'dinner', 'cleaning', 'coffee']) await expect(page.locator(`[data-habit-id="${id}"]`)).toBeVisible()
  await page.locator('[data-amount-habit-id="push-ups"]').getByRole('button', { name: /^\+10/ }).click()
  await page.locator('[data-amount-habit-id="pull-ups"]').getByRole('button', { name: /^\+1\s/ }).click()
  await expect(page.locator('[data-amount-habit-id="pull-ups"]').getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 / 15 повт., 7%')
  await page.reload()
  const after = await readDatabase(page)
  expect(after.habitEntries).toEqual(expect.arrayContaining(restored.habitEntries))
  expect(after.habitEntries).toHaveLength(restored.habitEntries.length + 2)
  expect(after.habitEntries.find((entry) => entry.habitId === 'push-ups')).toMatchObject({ value: 10, date: '2026-10-23' })
  expect(after.habitEntries.find((entry) => entry.habitId === 'pull-ups')).toMatchObject({ value: 1, date: '2026-10-23' })
  await page.goto('/#calendar?date=2026-10-22')
  await expect(page.locator('[data-habit-id="coffee"]')).toHaveAttribute('data-result-source', 'no-data')
  await expect(page.locator('[data-amount-habit-id="push-ups"]')).not.toContainText('По правилу')
  await page.goto('/#statistics?period=day&date=2026-10-22&section=training')
  await expect(page.locator('[data-amount-statistics-id="push-ups"]')).toHaveCount(0)
  await page.goto('/#settings')
  await expect(page.locator('article[data-habit-id="reading"]')).toContainText('В архиве')
  for (const id of ['push-ups', 'coffee', 'cleaning']) await expect(page.locator(`article[data-habit-id="${id}"]`)).toBeVisible()
  const backup = await downloadBackup(page)
  expect(backup.formatVersion).toBe(4)
  await restoreBackup(page, backup)
  await page.reload()
  expect(await readDatabase(page)).toEqual(after)
})

test('persists neutral coffee choices and excludes all three states from day score, coverage and success statistics', async ({ page }) => {
  await page.goto('/#today')
  const coffee = page.locator('[data-habit-id="coffee"]')
  await expect(coffee).toHaveClass(/habit-observation/)
  const beforeScore = await page.getByTestId('day-score-value').textContent()
  const beforeCoverage = await page.getByTestId('day-coverage').textContent()
  const beforeFilled = await page.getByTestId('day-filled').textContent()
  for (const [label, status] of [['Пил', 'success'], ['Не пил', 'failure'], ['Нет данных', 'no-data']] as const) {
    await choose(page, 'coffee', label)
    await expect(coffee).toHaveAttribute('data-result-source', 'explicit')
    await expect(coffee).not.toContainText(/Успех|Неудача/)
    await expect(page.getByTestId('day-score-value')).toHaveText(beforeScore!)
    await expect(page.getByTestId('day-coverage')).toHaveText(beforeCoverage!)
    await expect(page.getByTestId('day-filled')).toHaveText(beforeFilled!)
    await page.reload()
    await expect(coffee.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect((await readDatabase(page)).habitEntries.filter((entry) => entry.habitId === 'coffee')).toEqual([
      expect.objectContaining({ type: 'boolean', status, date: '2026-10-23' }),
    ])
  }
  await choose(page, 'coffee', 'Пил')
  await page.goto('/#statistics?period=day&date=2026-10-23&section=nutrition')
  const stats = page.getByTestId('coffee-statistics')
  await expect(stats.locator('[data-statistic="coffee-days"]')).toHaveText('1 дн. из 1')
  await expect(stats.locator('[data-statistic="coffee-frequency"]')).toHaveText('100%')
  await page.getByRole('tab', { name: 'Привычки', exact: true }).click()
  await expect(page.locator('[data-boolean-statistics-id="coffee"]')).toHaveCount(0)
})

test('shows coffee counts, 61 percent monthly frequency, weekly dynamics and every selected period', async ({ page }, testInfo) => {
  const data = emptyCurrentData(instant.toISOString())
  const coffee = data.habits.find((habit) => habit.id === 'coffee')!
  coffee.createdAt = '2026-07-01T09:00:00.000Z'
  coffee.missingDataPolicy = 'manual'
  const drank = new Set([1, 2, 3, 4, 6, 7, 8, 9, 14, 15, 16, 17, 18, 19, 20, 21, 22])
  data.habitEntries = Array.from({ length: 31 }, (_, index) => ({ habitId: 'coffee', type: 'boolean',
    date: date(`2026-07-${String(index + 1).padStart(2, '0')}`), status: index >= 28 ? 'no-data' : drank.has(index + 1) ? 'success' : 'failure',
    createdAt: coffee.createdAt, updatedAt: coffee.createdAt }))
  await restoreCurrent(page, data)
  const expected = await readDatabase(page)
  await page.goto('/#statistics?period=month&date=2026-07-15&section=nutrition')
  const stats = page.getByTestId('coffee-statistics')
  await expect(stats.locator('[data-statistic="coffee-days"]')).toHaveText('17 дн. из 31')
  await expect(stats.locator('[data-statistic="coffee-free-days"]')).toHaveText('11 дн.')
  await expect(stats.locator('[data-statistic="coffee-no-data"]')).toHaveText('3 дн.')
  await expect(stats.locator('[data-statistic="coffee-frequency"]')).toHaveText('61%')
  await expect(stats.getByRole('img', { name: 'Количество дней с кофе' })).toBeVisible()
  await stats.getByText('Значения по периодам', { exact: true }).click()
  await expect(stats.locator('tbody tr')).toHaveCount(5)
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expectNoOverflow(page)
    if (width === 375) await stats.screenshot({ path: `.artifacts/coffee-statistics-${testInfo.project.name}.png` })
  }
  await page.goto('/#statistics?period=week&date=2026-07-08&section=nutrition')
  await expect(stats.locator('[data-statistic="coffee-days"]')).toHaveText('4 дн. из 7')
  await page.goto('/#statistics?period=day&date=2026-07-10&section=nutrition')
  await expect(stats.locator('[data-statistic="coffee-free-days"]')).toHaveText('1 дн.')
  for (const preset of ['3m', '6m', 'year']) {
    await page.goto(`/#statistics?period=${preset}&date=2026-07-31&section=nutrition`)
    await expect(stats.locator('[data-statistic="coffee-days"]')).toHaveText('17 дн. из 31')
  }
  await page.goto('/#statistics?period=custom&from=2026-07-01&to=2026-07-31&section=nutrition')
  await expect(stats.locator('[data-statistic="coffee-frequency"]')).toHaveText('61%')
  await page.reload()
  await expect(stats.locator('[data-statistic="coffee-frequency"]')).toHaveText('61%')
  expect(await readDatabase(page)).toEqual(expected)
})

test('infers only completed local days, preserves manual unknowns and explicit no-data, and allows correcting inferred results', async ({ page }) => {
  await restoreCurrent(page, emptyCurrentData())
  await page.goto('/#today')
  for (const id of ['coffee', 'no-alcohol', 'no-sweets', 'english', 'workout']) {
    await expect(page.locator(`[data-habit-id="${id}"]`).getByRole('button', { name: 'Нет данных', exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(page.getByTestId('day-filled')).toHaveText('0 / 22')
  await page.goto('/#calendar?date=2026-10-22')
  for (const [id, label] of [['coffee', 'Не пил'], ['no-alcohol', 'Не пил'], ['no-sweets', 'Не ел'], ['english', 'Неудача'], ['workout', 'Неудача']] as const) {
    const row = page.locator(`[data-habit-id="${id}"]`)
    await expect(row).toHaveAttribute('data-result-source', 'inferred')
    await expect(row.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  for (const id of ['push-ups', 'abs', 'squats', 'pull-ups']) await expect(page.locator(`[data-amount-habit-id="${id}"]`)).toContainText('По правилу: 0')
  await expect(page.locator('[data-amount-habit-id="water"]')).toContainText('Пока нет записей')
  for (const id of ['gaming', 'social-media']) await expect(page.locator(`[data-duration-habit-id="${id}"]`).locator('.duration-total')).toHaveText('Нет данных')
  for (const id of ['breakfast', 'lunch', 'dinner', 'early-rising']) await expect(page.locator(`[data-habit-id="${id}"]`).getByRole('button', { name: 'Нет данных', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('day-filled')).toHaveText('14 / 22')
  expect((await readDatabase(page)).habitEntries).toEqual([])
  await choose(page, 'coffee', 'Пил')
  await choose(page, 'english', 'Нет данных')
  await expect(page.getByTestId('day-filled')).toHaveText('13 / 22')
  await page.reload()
  await expect(page.locator('[data-habit-id="coffee"]')).toHaveAttribute('data-result-source', 'explicit')
  await expect(page.locator('[data-habit-id="english"]').getByRole('button', { name: 'Нет данных', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await readDatabase(page)).habitEntries).toHaveLength(2)
  await page.goto('/#settings')
  await page.locator('article[data-habit-id="no-sweets"]').getByRole('button', { name: /^Редактировать / }).click()
  const dialog = page.getByRole('dialog', { name: 'Редактировать привычку', exact: true })
  await dialog.getByLabel('Если день не заполнен', { exact: true }).selectOption({ label: 'Оставить без данных' })
  await dialog.getByRole('button', { name: 'Сохранить привычку', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.goto('/#calendar?date=2026-10-22')
  await expect(page.locator('[data-habit-id="no-sweets"]').getByRole('button', { name: 'Нет данных', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/#calendar?date=2026-09-30')
  await expect(page.locator('[data-habit-id="coffee"]')).toHaveAttribute('data-result-source', 'no-data')
  await expect(page.locator('[data-habit-id="english"]')).toHaveAttribute('data-result-source', 'no-data')
  expect((await readDatabase(page)).habitEntries).toHaveLength(2)
})

test('refreshes an open historical calendar at the local midnight boundary without writing inferred rows', async ({ page }) => {
  await restoreCurrent(page, emptyCurrentData())
  await page.clock.setFixedTime(new Date('2026-10-23T20:59:59.000Z'))
  await page.goto('/#calendar?date=2026-10-23')
  const coffee = page.locator('[data-habit-id="coffee"]')
  await expect(coffee).toHaveAttribute('data-result-source', 'no-data')
  await page.clock.setFixedTime(new Date('2026-10-23T21:00:01.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(coffee).toHaveAttribute('data-result-source', 'inferred')
  await expect(coffee.getByRole('button', { name: 'Не пил', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('day-filled')).toHaveText('14 / 22')
  expect((await readDatabase(page)).habitEntries).toEqual([])
})
