import { expect, test, type Page } from '@playwright/test'
import { downloadBackup, expectNoOverflow, instant, readDatabase, restoreBackup, seed } from '../scripts/pwa-test/helpers'
import { selectStatisticsPeriod, selectStatisticsSection, type StatisticsSection } from './statistics-navigation'

const errorsByPage = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  errorsByPage.set(page, errors)
  await page.clock.setFixedTime(instant)
})
test.afterEach(async ({ page }) => { expect(errorsByPage.get(page)).toEqual([]) })

test('records sweets success, failure and no-data through Today and Calendar, includes it in statistics/settings and exact backup restore', async ({ page }) => {
  await page.goto('/#today')
  const habit = page.locator('[data-habit-id="no-sweets"]')
  await expect(habit).toContainText('Без сладкого / шоколада')
  for (const [label, status] of [['Не ел', 'success'], ['Ел', 'failure'], ['Нет данных', 'no-data'], ['Не ел', 'success']] as const) {
    await habit.getByRole('button', { name: label, exact: true }).click()
    await expect(habit.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect((await readDatabase(page)).habitEntries.filter((entry) => entry.habitId === 'no-sweets')).toEqual([
      expect.objectContaining({ type: 'boolean', status, date: '2026-10-23' }),
    ])
  }
  await page.reload()
  await expect(habit.getByRole('button', { name: 'Не ел', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/#calendar?date=2026-10-22')
  await habit.getByRole('button', { name: 'Ел', exact: true }).click()
  await page.goto('/#statistics?period=day&date=2026-10-22')
  await selectStatisticsSection(page, 'Привычки')
  const stats = page.locator('[data-boolean-statistics-id="no-sweets"]')
  await expect(stats.locator('[data-statistic="failure"]')).toHaveText('1')
  await expect(stats.locator('[data-statistic="no-data"]')).toHaveText('0')
  await page.goto('/#settings')
  await expect(page.locator('article[data-habit-id="no-sweets"]')).toContainText('Без сладкого / шоколада')
  const before = await readDatabase(page)
  expect(before.habits).toHaveLength(24)
  const backup = await downloadBackup(page)
  expect(backup.formatVersion).toBe(4)
  expect(backup.data).toEqual(before)
  await restoreBackup(page, backup)
  await page.reload()
  expect(await readDatabase(page)).toEqual(before)
})

test('selects a concrete day, week and month with accurate daily facts, bounded future navigation and reload/back restoration', async ({ page }) => {
  await seed(page)
  await page.locator('[data-habit-id="cleaning"]').getByRole('button', { name: 'Выполнено', exact: true }).click()
  await page.goto('/#statistics')
  await expect(page.getByRole('button', { name: 'Неделя', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('dashboard-score-value')).toHaveText('100%')
  await expect(page.getByTestId('statistics-period-label')).toHaveText(/19 окт\. 2026 — 23 окт\. 2026/)
  await selectStatisticsPeriod(page, 'day')
  await expect(page.getByTestId('dashboard-score-value')).toHaveText('75%')
  await expect(page.getByTestId('dashboard-filled')).toHaveText('3 / 22')
  await expect(page.getByTestId('dashboard-screen-time')).toContainText('2 ч')
  await page.getByLabel('Опорная дата', { exact: true }).fill('2026-10-22')
  await expect(page.getByTestId('dashboard-score-value')).toHaveText('Нет данных')
  await expect(page.getByTestId('dashboard-filled')).toHaveText('0 / 22')
  await expect(page.getByTestId('dashboard-cleaning')).toContainText('Выполнена')
  await page.reload()
  await expect(page.getByLabel('Опорная дата', { exact: true })).toHaveValue('2026-10-22')
  await page.getByRole('button', { name: 'Предыдущий период', exact: true }).click()
  await expect(page.getByLabel('Опорная дата', { exact: true })).toHaveValue('2026-10-21')
  await page.goBack()
  await expect(page.getByLabel('Опорная дата', { exact: true })).toHaveValue('2026-10-22')
  await page.getByRole('button', { name: 'К текущему периоду', exact: true }).click()
  await expect(page.getByTestId('dashboard-score-value')).toHaveText('75%')
  await expect(page.getByRole('button', { name: 'Следующий период', exact: true })).toBeDisabled()
  await selectStatisticsPeriod(page, 'week')
  await page.getByRole('button', { name: 'Предыдущий период', exact: true }).click()
  await expect(page.getByTestId('statistics-period-label')).toHaveText(/12 окт\. 2026 — 18 окт\. 2026/)
  // A fully elapsed, tracked week has an inferred cleaning result.
  await expect(page.getByTestId('dashboard-score-value')).toHaveText('0%')
  await expect(page.getByTestId('dashboard-cleaning')).toContainText('Не выполнена')
  await page.getByRole('button', { name: 'Следующий период', exact: true }).click()
  await expect(page.getByTestId('dashboard-score-value')).toHaveText('100%')
  await selectStatisticsPeriod(page, 'month')
  await page.getByLabel('Выбранный месяц', { exact: true }).fill('2026-09')
  await expect(page.getByTestId('statistics-period-label')).toHaveText(/1 сент\. 2026 — 30 сент\. 2026/)
  await expect(page.getByTestId('statistics-empty')).toBeVisible()
  await page.getByRole('button', { name: 'Следующий период', exact: true }).click()
  await expect(page.getByTestId('statistics-period-label')).toHaveText(/1 окт\. 2026 — 23 окт\. 2026/)
  await expect(page.getByRole('button', { name: 'Следующий период', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByLabel('Выбранный месяц', { exact: true })).toHaveValue('2026-10')
})

test('opens the matching day and week from compact Today cards and expands calculation details only on demand', async ({ page }) => {
  await seed(page)
  for (const [id, name] of [['day-score', 'Подробнее об оценке дня'], ['weekly-score', 'Подробнее об оценке недели']] as const) {
    const card = page.getByTestId(id)
    const details = card.locator('details')
    await expect(details).not.toHaveAttribute('open', '')
    await card.getByLabel(name, { exact: true }).click()
    await expect(details).toHaveAttribute('open', '')
    await card.getByLabel(name, { exact: true }).click()
    await expect(details).not.toHaveAttribute('open', '')
  }
  await page.getByRole('link', { name: 'Открыть статистику за день', exact: true }).click()
  await expect(page).toHaveURL(/#statistics\?period=day&date=2026-10-23$/)
  await expect(page.getByTestId('dashboard-score-value')).toHaveText('75%')
  await page.reload()
  await expect(page.getByLabel('Опорная дата', { exact: true })).toHaveValue('2026-10-23')
  await page.goBack()
  await expect(page.getByRole('heading', { name: /^Сегодня/, level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Открыть статистику за неделю', exact: true }).click()
  await expect(page).toHaveURL(/#statistics\?period=week&date=2026-10-23$/)
  await expect(page.getByTestId('statistics-period-label')).toHaveText(/19 окт\. 2026 — 23 окт\. 2026/)
})

test('keeps one detail section mounted, restores tabs, and exposes long-range trends only after expansion', async ({ page }) => {
  await seed(page)
  await page.goto('/#statistics?period=month&date=2026-10-23')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Обзор')
  await expect(page.getByRole('tabpanel')).toHaveCount(1)
  for (const id of ['score', 'coverage', 'habits', 'training', 'screen-time', 'tasks']) {
    await expect(page.getByTestId(`dashboard-${id}`)).toBeVisible()
  }
  await expect(page.getByTestId('dashboard-category-food_water')).toBeVisible()
  const sections: [StatisticsSection, string][] = [
    ['Привычки', '[data-boolean-statistics-id="english"]'], ['Питание', '[data-amount-statistics-id="water"]'],
    ['Тренировка', '[data-amount-statistics-id="push-ups"]'], ['Экранное время', '[data-duration-statistics-id="gaming"]'],
    ['Задачи', '[data-testid="task-statistics"]'], ['Цели', '[data-testid="goal-statistics"]'],
  ]
  for (const [name, selector] of sections) {
    await selectStatisticsSection(page, name)
    await expect(page.locator(selector)).toBeVisible()
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
    for (const [other, otherSelector] of sections) if (other !== name) await expect(page.locator(otherSelector)).toHaveCount(0)
  }
  await page.reload()
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Цели')
  await page.getByRole('tab', { name: 'Цели', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Задачи', exact: true })).toBeFocused()
  await expect(page.getByTestId('task-statistics')).toBeVisible()
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toBeFocused()
  await selectStatisticsSection(page, 'Обзор')
  await selectStatisticsPeriod(page, '3m')
  const details = page.locator('details').filter({ has: page.getByText('Подробная динамика по неделям', { exact: true }) })
  await expect(details).not.toHaveAttribute('open', '')
  await details.locator(':scope > summary').click()
  await expect(details).toHaveAttribute('open', '')
  await expect(page.getByTestId('weekly-statistics')).toBeVisible()
  await details.locator(':scope > summary').click()
  await expect(page.getByTestId('weekly-statistics')).not.toBeVisible()
})

test('keeps dashboard scroll bounded, charts and touch controls usable at 320/375/390px including compact empty states', async ({ page }, testInfo) => {
  await seed(page)
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#today')
    for (const id of ['day-score', 'weekly-score']) {
      const card = page.getByTestId(id)
      await expect(card).toBeVisible()
      expect((await card.boundingBox())?.height).toBeLessThan(420)
    }
    await page.goto('/#statistics?period=month&date=2026-10-23')
    await expect(page.getByTestId('dashboard-score')).toBeVisible()
    await expectNoOverflow(page)
    const height = await page.locator('.statistics-page').evaluate((element) => element.scrollHeight)
    // The former page rendered every chart/table; overview now stays within three phone screens.
    expect(height).toBeLessThan(2532)
    await testInfo.attach(`overview-height-${width}`, { body: String(height), contentType: 'text/plain' })
    const controls = await page.locator('main button, main select, main input, main summary, main [role="tab"]').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }).filter((box) => box.width && box.height))
    expect(controls.every((box) => box.width >= 44 && box.height >= 44)).toBe(true)
    await page.screenshot({ path: `.artifacts/dashboard-${testInfo.project.name}-${width}.png`, fullPage: true })
    await selectStatisticsPeriod(page, 'day')
    await page.getByLabel('Опорная дата', { exact: true }).fill('2026-10-22')
    const empty = page.getByTestId('statistics-empty')
    await expect(empty).toBeVisible()
    expect((await empty.boundingBox())?.height).toBeLessThan(150)
    await expectNoOverflow(page)
  }
})
