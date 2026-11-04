import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoOverflow, readDatabase, waitForServiceWorker } from '../scripts/pwa-test/helpers'

const instant = new Date('2026-10-24T09:00:00.000Z')
const created = '2026-10-01T09:00:00.000Z'
const today = '2026-10-24'
const row = (page: Page, id: string) => page.locator(`[data-habit-id="${id}"]`)
const metric = (scope: Locator, name: string) => scope.locator(`[data-statistic="${name}"]`)

async function mark(page: Page, id: string, label: string) {
  const button = row(page, id).getByRole('button', { name: label, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function startTrackingInOctober(page: Page) {
  await page.goto('/#today')
  await expect(row(page, 'cleaning')).toBeVisible()
  // Modify only definitions in this test's isolated browser DB; all facts are entered in the UI.
  await page.evaluate((created) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('habits', 'readwrite')
      const cursor = transaction.objectStore('habits').openCursor()
      cursor.onsuccess = () => {
        const item = cursor.result
        if (item) { item.update({ ...item.value, createdAt: created }); item.continue() }
      }
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    }
  }), created)
  await page.reload()
  await expect(page.getByTestId('day-filled')).toHaveText('0 / 22')
}

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(instant) })

test('records meals and alcohol with balanced day scores, one weekly cleaning result, statistics and backup round-trip', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await startTrackingInOctober(page)
  await expect(page.locator('.habit-category-heading h3')).toHaveText([
    'Еда и вода', 'Тренировка', 'Быт и режим', 'Экранное время', 'Саморазвитие',
  ])
  await expect(page.locator('[data-habit-category="study_work"]')).toHaveCount(0)
  await expect(row(page, 'cleaning')).toContainText('1 раз в неделю')
  await mark(page, 'no-alcohol', 'Не пил')
  expect((await readDatabase(page)).habitEntries.find((entry) => entry.habitId === 'no-alcohol')).toMatchObject({ type: 'boolean', status: 'success', date: today })
  await mark(page, 'no-alcohol', 'Пил')
  await mark(page, 'breakfast', 'Был')
  await mark(page, 'lunch', 'Не было')
  await mark(page, 'dinner', 'Был')
  await mark(page, 'english', 'Успех')
  await expect(page.getByTestId('day-score-value')).toHaveText('75%')
  await expect(page.getByTestId('day-coverage')).toHaveText('23%')
  await expect(page.getByTestId('day-filled')).toHaveText('5 / 22')
  await mark(page, 'cleaning', 'Выполнено')
  await expect(page.getByTestId('day-score-value')).toHaveText('75%')
  await expect(page.getByTestId('day-filled')).toHaveText('5 / 22')
  await expect(page.getByTestId('weekly-score-value')).toHaveText('100%')
  const first = await readDatabase(page)
  expect(first.habitEntries.filter((entry) => entry.habitId === 'no-alcohol')).toHaveLength(1)
  expect(first.habitEntries.find((entry) => entry.habitId === 'cleaning')).toMatchObject({ type: 'boolean', status: 'success', date: '2026-10-19' })
  await page.reload()
  expect(await readDatabase(page)).toEqual(first)
  await expect(row(page, 'no-alcohol').getByRole('button', { name: 'Пил', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(row(page, 'cleaning').getByRole('button', { name: 'Выполнено', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/#calendar?date=2026-10-23')
  await mark(page, 'no-alcohol', 'Не пил')
  for (const id of ['breakfast', 'lunch', 'dinner']) await mark(page, id, 'Был')
  await expect(row(page, 'cleaning').getByRole('button', { name: 'Выполнено', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Any selected day of one week edits the same universal HabitEntry.
  await mark(page, 'cleaning', 'Не выполнено')
  await mark(page, 'cleaning', 'Выполнено')
  expect((await readDatabase(page)).habitEntries.filter((entry) => entry.habitId === 'cleaning')).toHaveLength(1)
  await page.goto('/#calendar?date=2026-10-14')
  await mark(page, 'cleaning', 'Нет данных')
  await page.goto('/#calendar?date=2026-10-07')
  await mark(page, 'cleaning', 'Не выполнено')

  await page.goto('/#statistics?period=month')
  const alcohol = page.getByTestId('alcohol-statistics')
  await expect(metric(alcohol, 'failure')).toHaveText('1')
  await expect(metric(alcohol, 'success')).toHaveText('1')
  await expect(metric(alcohol, 'no-data')).toHaveText('22')
  await expect(metric(alcohol, 'success-rate')).toHaveText('50%')
  await expect(metric(alcohol, 'current-month-drinking-days')).toHaveText('1')
  const meals = page.getByTestId('meal-statistics')
  for (const id of ['breakfast', 'lunch', 'dinner']) {
    const meal = meals.locator(`[data-meal-id="${id}"]`)
    await expect(metric(meal, 'success')).toHaveText(id === 'lunch' ? '1' : '2')
    await expect(metric(meal, 'failure')).toHaveText(id === 'lunch' ? '1' : '0')
    await expect(metric(meal, 'no-data')).toHaveText('22')
    await expect(metric(meal, 'success-rate')).toHaveText(id === 'lunch' ? '50%' : '100%')
  }
  await expect(metric(meals, 'full-meal-days')).toHaveText('1')
  const cleaning = page.getByTestId('cleaning-statistics')
  await expect(metric(cleaning, 'success')).toHaveText('1')
  // The first week is only partly tracked: it must not infer a full-week failure.
  await expect(metric(cleaning, 'failure')).toHaveText('1')
  await expect(metric(cleaning, 'no-data')).toHaveText('2')
  await expect(metric(cleaning, 'success-rate')).toHaveText('50%')
  await page.goto('/#statistics?period=custom&from=2026-10-01&to=2026-10-07')
  await expect(metric(alcohol, 'failure')).toHaveText('0')
  await expect(metric(alcohol, 'current-month-drinking-days')).toHaveText('1')

  await page.goto('/#settings')
  const expected = await readDatabase(page)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать резервную копию', exact: true }).click()
  const backupFile = await (await downloadEvent).path()
  if (!backupFile) throw new Error('Missing downloaded backup')
  const backup = JSON.parse(await readFile(backupFile, 'utf8'))
  expect(backup.data).toEqual(expected)
  expect(backup.data.habits.find((habit: { id: string }) => habit.id === 'cleaning')).toMatchObject({ schedule: { type: 'weekly' } })
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles(backupFile)
  await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
  await page.getByRole('button', { name: 'Заменить данные', exact: true }).click()
  await expect(page.getByText('Данные успешно восстановлены.', { exact: true })).toBeVisible()
  await page.reload()
  expect(await readDatabase(page)).toEqual(expected)
  expect(errors).toEqual([])
})

test('keeps unfilled category progress visible and new actions usable at 320/375/390px', async ({ page }, testInfo) => {
  await page.goto('/#today')
  await expect(row(page, 'breakfast')).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expectNoOverflow(page)
    for (const [id, action] of [['no-alcohol', 'Не пил'], ['breakfast', 'Был'], ['lunch', 'Был'], ['dinner', 'Был'], ['cleaning', 'Выполнено']] as const) {
      const button = row(page, id).getByRole('button', { name: action, exact: true })
      const box = await button.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(box?.width).toBeGreaterThanOrEqual(44)
      await mark(page, id, action)
    }
    await page.screenshot({ path: `.artifacts/food-routine-${testInfo.project.name}-${width}.png`, fullPage: true })
    const food = page.locator('[data-habit-category="food_water"]')
    const toggle = food.locator('header').getByRole('button')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(food.locator('header')).toContainText('4 / 10')
    await expect(row(page, 'breakfast')).not.toBeVisible()
    await toggle.click()
    await expect(row(page, 'breakfast')).toBeVisible()
    await page.goto('/#statistics?period=month')
    await expect(page.getByTestId('cleaning-statistics')).toBeVisible()
    await expectNoOverflow(page)
    await page.goto('/#today')
    await expect(row(page, 'cleaning')).toBeVisible()
  }
})

test('saves meals, alcohol and one weekly result offline with reload persistence', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit offline transport limitation #42775; real server-outage coverage is in PWA update suite.')
  await page.goto('/#today')
  await waitForServiceWorker(page)
  await context.setOffline(true)
  await page.reload()
  await mark(page, 'no-alcohol', 'Пил')
  for (const id of ['breakfast', 'lunch', 'dinner']) await mark(page, id, 'Был')
  await mark(page, 'cleaning', 'Выполнено')
  const saved = await readDatabase(page)
  await page.reload()
  expect(await readDatabase(page)).toEqual(saved)
  await expect(page.getByTestId('day-filled')).toHaveText('4 / 22')
  await page.goto('/#statistics?period=month')
  await expect(metric(page.getByTestId('alcohol-statistics'), 'current-month-drinking-days')).toHaveText('1')
  await expect(metric(page.getByTestId('meal-statistics'), 'full-meal-days')).toHaveText('1')
  await expect(metric(page.getByTestId('cleaning-statistics'), 'success')).toHaveText('1')
})
