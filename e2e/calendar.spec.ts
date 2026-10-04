import { expect, test, type Locator, type Page } from '@playwright/test'
import type { HabitEntry } from '../src/models/habit-entry'

const instant = new Date('2026-10-07T09:00:00Z')
const today = '2026-10-07'
const past = '2026-10-02'

function day(page: Page, date: string) {
  return page.locator(`[data-calendar-date="${date}"]`)
}

function selectedDay(page: Page, date: string) {
  return page.locator(`[data-selected-date="${date}"]`)
}

function booleanCard(page: Page, habitId = 'abstinence') {
  return page.locator(`[data-habit-id="${habitId}"]`)
}

function waterCard(page: Page) {
  return page.locator('[data-amount-habit-id="water"]')
}

function durationCard(page: Page, habitId = 'gaming') {
  return page.locator(`[data-duration-habit-id="${habitId}"]`)
}

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function openCalendar(page: Page) {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Разделы приложения' })
    .getByRole('link', { name: 'Календарь', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Календарь', exact: true })).toBeVisible()
  await expect(page.getByTestId('calendar-month')).toBeVisible()
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

async function saveAmount(page: Page, value: string) {
  const water = waterCard(page)
  await water.getByRole('textbox', { name: 'Итог за день, мл', exact: true }).fill(value)
  await water.getByRole('button', { name: 'Сохранить количество', exact: true }).click()
}

async function expectAmount(page: Page, amount: number, progress: number) {
  await expect(waterCard(page).locator('.amount-total strong')).toHaveText(new Intl.NumberFormat('ru-RU').format(amount))
  await expect(waterCard(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(progress))
}

async function saveTime(card: Locator, hours: string, minutes: string) {
  await card.getByRole('textbox', { name: 'Часы', exact: true }).fill(hours)
  await card.getByRole('textbox', { name: 'Минуты', exact: true }).fill(minutes)
  await card.getByRole('button', { name: 'Сохранить время', exact: true }).click()
}

test('opens the Russian Monday-first month, navigates across years and returns to today', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  const month = page.getByTestId('calendar-month')
  const main = page.getByRole('main')
  await expect(month).toHaveText(/октябрь 2026/i)
  await expect(page.locator('[data-calendar-date^="2026-10-"]')).toHaveCount(31)
  await expect(day(page, today)).toHaveAttribute('aria-current', 'date')
  await expect(day(page, today)).toHaveAttribute('aria-pressed', 'true')
  await expect(selectedDay(page, today)).toBeVisible()
  const weekdayPositions: number[] = []
  for (const name of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) {
    const label = main.getByText(name, { exact: true })
    await expect(label).toBeVisible()
    weekdayPositions.push(await label.evaluate((element) => element.getBoundingClientRect().left))
  }
  expect(weekdayPositions).toEqual([...weekdayPositions].sort((a, b) => a - b))

  await main.getByRole('button', { name: 'Предыдущий месяц', exact: true }).click()
  await expect(month).toHaveText(/сентябрь 2026/i)
  await expect(page.locator('[data-calendar-date^="2026-09-"]')).toHaveCount(30)
  await main.getByRole('button', { name: 'Следующий месяц', exact: true }).click()
  await expect(month).toHaveText(/октябрь 2026/i)
  for (const expected of [/ноябрь 2026/i, /декабрь 2026/i, /январь 2027/i]) {
    await main.getByRole('button', { name: 'Следующий месяц', exact: true }).click()
    await expect(month).toHaveText(expected)
  }
  await page.reload()
  await expect(month).toHaveText(/январь 2027/i)
  await main.getByRole('button', { name: 'Предыдущий месяц', exact: true }).click()
  await expect(month).toHaveText(/декабрь 2026/i)
  await main.getByRole('button', { name: 'Сегодня', exact: true }).click()
  await expect(month).toHaveText(/октябрь 2026/i)
  await expect(day(page, today)).toHaveAttribute('aria-pressed', 'true')
  await expect(selectedDay(page, today)).toBeVisible()
  expect(await readEntries(page)).toEqual([])
  expect(errors).toEqual([])
})

test('edits all tracker types in a past day, replaces totals and restores history and statistics after reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  await day(page, past).click()
  await expect(selectedDay(page, past).getByRole('heading', { level: 2 }).first()).toContainText('2 октября 2026')
  await expect(day(page, past)).toHaveAttribute('aria-pressed', 'true')
  await expect(day(page, today)).toHaveAttribute('aria-current', 'date')
  await expect(day(page, today)).toHaveAttribute('aria-pressed', 'false')

  for (const [label, status] of [
    ['Успех', 'success'], ['Неудача', 'failure'], ['Нет данных', 'no-data'], ['Успех', 'success'],
  ] as const) {
    await booleanCard(page).getByRole('button', { name: label, exact: true }).click()
    await expect(booleanCard(page).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await readEntries(page)).find((entry) => entry.habitId === 'abstinence'))
      .toMatchObject({ date: past, type: 'boolean', status })
  }

  await expect(waterCard(page).getByRole('button', { name: '+200 мл', exact: true })).toHaveCount(0)
  await saveAmount(page, '1200')
  await expectAmount(page, 1200, 60)
  const firstWater = (await readEntries(page)).find((entry) => entry.habitId === 'water')
  await saveAmount(page, '1800')
  await expectAmount(page, 1800, 90)
  await saveTime(durationCard(page), '2', '35')
  await expect(durationCard(page).locator('.duration-rating')).toContainText('Хорошо')
  await saveTime(durationCard(page), '1', '30')
  await expect(durationCard(page).locator('.duration-total')).toHaveText('1 ч 30 мин')
  await expect(durationCard(page).locator('.duration-rating')).toContainText('Отлично')
  await expect(durationCard(page).locator('.duration-rating')).toContainText('😄')
  await saveTime(durationCard(page, 'social-media'), '1', '15')
  await expect(durationCard(page, 'social-media').locator('.duration-rating')).toContainText('Хорошо')

  await page.reload()
  await expect(selectedDay(page, past)).toBeVisible()
  await expect(day(page, past)).toHaveAttribute('aria-pressed', 'true')
  await expect(booleanCard(page).getByRole('button', { name: 'Успех', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expectAmount(page, 1800, 90)
  await expect(waterCard(page).getByRole('textbox', { name: 'Итог за день, мл', exact: true })).toHaveValue('1800')
  await expect(durationCard(page).locator('.duration-total')).toHaveText('1 ч 30 мин')
  await expect(durationCard(page, 'social-media').locator('.duration-total')).toHaveText('1 ч 15 мин')
  const entries = await readEntries(page)
  expect(entries).toHaveLength(4)
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ habitId: 'abstinence', date: past, type: 'boolean', status: 'success' }),
    expect.objectContaining({ habitId: 'water', date: past, type: 'amount', value: 1800, createdAt: firstWater?.createdAt }),
    expect.objectContaining({ habitId: 'gaming', date: past, type: 'duration', minutes: 90 }),
    expect.objectContaining({ habitId: 'social-media', date: past, type: 'duration', minutes: 75 }),
  ]))
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'partial')
  await expect(day(page, today)).toHaveAttribute('data-day-status', 'no-data')

  await day(page, '2026-10-03').click()
  await expect(booleanCard(page).getByRole('button', { name: 'Нет данных', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expectAmount(page, 0, 0)
  await expect(durationCard(page).locator('.duration-total')).toHaveText('Нет данных')
  expect(await readEntries(page)).toHaveLength(4)

  await page.getByRole('navigation', { name: 'Разделы приложения' })
    .getByRole('link', { name: 'Статистика', exact: true }).click()
  const gamingStatistics = page.locator('[data-duration-statistics-id="gaming"]')
  await expect(gamingStatistics.locator('[data-statistic="total"]')).toContainText('1 ч 30 мин')
  await expect(gamingStatistics.locator('[data-statistic="average"]')).toContainText('1 ч 30 мин')
  await expect(gamingStatistics.locator('[data-statistic="missing"]')).toContainText('6')
  await expect(gamingStatistics.locator('tbody tr').filter({ hasText: '02.10' })).toHaveAttribute('data-duration-minutes', '90')
  await expect(page.locator('[data-duration-statistics-id="social-media"] [data-statistic="total"]')).toContainText('1 ч 15 мин')
  expect(errors).toEqual([])
})

test('derives empty, partial and complete day summaries from real records and keeps explicit no-data unknown', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  await day(page, past).click()
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'no-data')
  expect(await readEntries(page)).toEqual([])
  await booleanCard(page).getByRole('button', { name: 'Нет данных', exact: true }).click()
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'abstinence', date: past, status: 'no-data' }),
  ])
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'no-data')
  await booleanCard(page).getByRole('button', { name: 'Неудача', exact: true }).click()
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'partial')

  const rows = page.locator('[data-habit-id]')
  await expect(rows).toHaveCount(8)
  for (const row of await rows.all()) {
    await row.getByRole('button', { name: 'Успех', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Успех', exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  await saveAmount(page, '2400')
  await expectAmount(page, 2400, 100)
  await saveTime(durationCard(page), '0', '0')
  await saveTime(durationCard(page, 'social-media'), '0', '0')
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'complete')
  await page.reload()
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'complete')
  await expect(day(page, '2026-10-03')).toHaveAttribute('data-day-status', 'no-data')
  await booleanCard(page).getByRole('button', { name: 'Нет данных', exact: true }).click()
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'partial')
  const entries = await readEntries(page)
  expect(entries).toHaveLength(11)
  for (const entry of entries) {
    expect(entry).not.toHaveProperty('dayStatus')
    expect(entry).not.toHaveProperty('completionPercent')
    expect(entry).not.toHaveProperty('color')
  }
  expect(errors).toEqual([])
})

test('rejects invalid amounts, saves zero and preserves unsaved drafts only for the selected date', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  await day(page, past).click()
  await saveAmount(page, '1200')
  await expectAmount(page, 1200, 60)
  for (const invalid of ['', '-1', '1.5', '1e3', '9007199254740992']) {
    await saveAmount(page, invalid)
    await expect(waterCard(page).getByRole('alert')).toBeVisible()
    await expectAmount(page, 1200, 60)
    expect(await readEntries(page)).toEqual([
      expect.objectContaining({ habitId: 'water', date: past, type: 'amount', value: 1200 }),
    ])
  }
  await saveAmount(page, '0')
  await expectAmount(page, 0, 0)
  await expect(waterCard(page).getByRole('alert')).toHaveCount(0)
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'partial')
  await page.reload()
  await expect(waterCard(page).getByRole('textbox', { name: 'Итог за день, мл', exact: true })).toHaveValue('0')
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'water', date: past, type: 'amount', value: 0 }),
  ])

  await waterCard(page).getByRole('textbox', { name: 'Итог за день, мл', exact: true }).fill('700')
  await durationCard(page).getByRole('textbox', { name: 'Часы', exact: true }).fill('3')
  await durationCard(page).getByRole('textbox', { name: 'Минуты', exact: true }).fill('15')
  await page.getByRole('combobox', { name: 'Привычка для заметки', exact: true }).selectOption('water')
  const note = page.getByRole('textbox', { name: 'Заметка', exact: true })
  await note.fill('Черновик заметки к воде.')
  for (const [name, expectedMonth] of [
    ['Предыдущий месяц', /сентябрь 2026/i], ['Следующий месяц', /октябрь 2026/i],
  ] as const) {
    await page.getByRole('main').getByRole('button', { name, exact: true }).click()
    await expect(page.getByTestId('calendar-month')).toHaveText(expectedMonth)
    await expect(page.getByRole('group', { name: 'Дни месяца', exact: true })).toHaveAttribute('aria-busy', 'false')
    await expect(selectedDay(page, past)).toBeVisible()
    await expect(waterCard(page).getByRole('textbox', { name: 'Итог за день, мл', exact: true })).toHaveValue('700')
    await expect(durationCard(page).getByRole('textbox', { name: 'Часы', exact: true })).toHaveValue('3')
    await expect(durationCard(page).getByRole('textbox', { name: 'Минуты', exact: true })).toHaveValue('15')
    await expect(note).toHaveValue('Черновик заметки к воде.')
  }
  const beforeSavingDrafts = await readEntries(page)
  expect(beforeSavingDrafts).toEqual([
    expect.objectContaining({ habitId: 'water', date: past, value: 0 }),
  ])
  expect(beforeSavingDrafts[0]).not.toHaveProperty('note')
  await day(page, '2026-10-03').click()
  await expectAmount(page, 0, 0)
  await expect(waterCard(page).getByRole('textbox', { name: 'Итог за день, мл', exact: true })).not.toHaveValue('700')
  await expect(durationCard(page).getByRole('textbox', { name: 'Часы', exact: true })).not.toHaveValue('3')
  await expect(durationCard(page).getByRole('textbox', { name: 'Минуты', exact: true })).not.toHaveValue('15')
  await expect(note).toHaveCount(0)
  await saveAmount(page, '400')
  await expectAmount(page, 400, 20)
  await day(page, past).click()
  await expectAmount(page, 0, 0)
  expect(await readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'water', date: past, value: 0 }),
    expect.objectContaining({ habitId: 'water', date: '2026-10-03', value: 400 }),
  ])
  expect(errors).toEqual([])
})

test('allows selecting future days but exposes no writing controls, including after a direct reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  await day(page, '2026-10-08').click()
  await expect(day(page, '2026-10-08')).toHaveAttribute('aria-pressed', 'true')
  await expect(selectedDay(page, '2026-10-08')).toContainText('Этот день ещё не наступил')
  await expect(selectedDay(page, '2026-10-08').locator('input, textarea, form')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Успех', exact: true })).toHaveCount(0)
  expect(await readEntries(page)).toEqual([])
  await page.reload()
  await expect(selectedDay(page, '2026-10-08')).toContainText('Этот день ещё не наступил')
  await expect(selectedDay(page, '2026-10-08').locator('input, textarea, form')).toHaveCount(0)
  expect(await readEntries(page)).toEqual([])
  await page.getByRole('main').getByRole('button', { name: 'Сегодня', exact: true }).click()
  await expect(selectedDay(page, today)).toBeVisible()
  await booleanCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'abstinence', date: today, status: 'success' }),
  ])
  expect(errors).toEqual([])
})

test('saves notes on existing results, preserves them when correcting trackers and removes only the note', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  await day(page, past).click()
  await expect(page.getByRole('textbox', { name: 'Заметка', exact: true })).toHaveCount(0)
  await booleanCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
  await saveAmount(page, '1200')
  await expectAmount(page, 1200, 60)
  await saveTime(durationCard(page), '2', '0')
  await expect(durationCard(page).locator('.duration-total')).toHaveText('2 ч 0 мин')

  const selection = page.getByRole('combobox', { name: 'Привычка для заметки', exact: true })
  const note = page.getByRole('textbox', { name: 'Заметка', exact: true })
  const save = page.getByRole('button', { name: 'Сохранить заметку', exact: true })
  for (const [habitId, text] of [
    ['abstinence', 'Помогла вечерняя прогулка.'],
    ['water', 'Взял бутылку воды с собой.'],
    ['gaming', 'Играли с друзьями.'],
  ] as const) {
    await selection.selectOption(habitId)
    await note.fill(text)
    await save.click()
    await expect.poll(async () => (await readEntries(page)).find((entry) => entry.habitId === habitId)?.note).toBe(text)
  }
  const originalEntries = await readEntries(page)
  await booleanCard(page).getByRole('button', { name: 'Неудача', exact: true }).click()
  await saveAmount(page, '1800')
  await expectAmount(page, 1800, 90)
  await saveTime(durationCard(page), '1', '30')
  await expect(durationCard(page).locator('.duration-total')).toHaveText('1 ч 30 мин')
  await page.reload()
  await expect(selectedDay(page, past)).toBeVisible()
  for (const entry of originalEntries) {
    await selection.selectOption(entry.habitId)
    await expect(note).toHaveValue(entry.note ?? '')
    expect((await readEntries(page)).find((saved) => saved.habitId === entry.habitId))
      .toMatchObject({ note: entry.note, createdAt: entry.createdAt })
  }
  await selection.selectOption('water')
  await note.fill('')
  await save.click()
  await expect.poll(async () => (await readEntries(page)).find((entry) => entry.habitId === 'water')?.note).toBeUndefined()
  await expectAmount(page, 1800, 90)
  await page.reload()
  await selection.selectOption('water')
  await expect(note).toHaveValue('')
  expect(await readEntries(page)).toHaveLength(3)
  expect((await readEntries(page)).find((entry) => entry.habitId === 'water')).toMatchObject({ date: past, value: 1800 })
  await day(page, '2026-10-03').click()
  await expect(note).toHaveCount(0)
  expect(errors).toEqual([])
})

test('recalculates streaks and success rate from corrected history while excluding missing and no-data days', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  function statisticRow(name: string) {
    return page.locator('.day-streak-row').filter({ has: page.getByRole('heading', { name, exact: true }) })
  }
  async function expectStatistics(current: number, best: number, rate: string) {
    const row = statisticRow('Воздержание')
    for (const [label, expected] of [
      ['Серия на выбранную дату', `${current} дн.`], ['Лучшая серия', `${best} дн.`], ['Доля успехов', rate],
    ] as const) {
      await expect(row.locator('dl > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd')).toHaveText(expected)
    }
  }
  for (const [date, label, current, best, rate] of [
    ['2026-10-01', 'Успех', 1, 1, '100%'],
    ['2026-10-02', 'Успех', 2, 2, '100%'],
    ['2026-10-03', 'Нет данных', 0, 2, '100%'],
    ['2026-10-04', 'Неудача', 0, 2, '67%'],
    ['2026-10-05', 'Успех', 1, 2, '75%'],
    ['2026-10-06', 'Успех', 2, 2, '80%'],
  ] as const) {
    await day(page, date).click()
    await booleanCard(page).getByRole('button', { name: label, exact: true }).click()
    await expectStatistics(current, best, rate)
  }
  await day(page, '2026-10-03').click()
  await booleanCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
  await expectStatistics(3, 3, '100%')
  await day(page, '2026-10-06').click()
  await expectStatistics(2, 3, '83%')
  await day(page, '2026-10-04').click()
  await booleanCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
  await expectStatistics(4, 4, '100%')
  await day(page, '2026-10-06').click()
  await expectStatistics(6, 6, '100%')
  await page.reload()
  await expectStatistics(6, 6, '100%')
  await day(page, today).click()
  await expectStatistics(0, 6, '100%')
  await expect(statisticRow('Английский каждый день').locator('dl > div').filter({ hasText: 'Доля успехов' }).locator('dd'))
    .toHaveText('Нет данных')
  expect(await readEntries(page)).toHaveLength(6)
  expect(errors).toEqual([])
})

test('updates the calendar and weekly statistics live when the same records change in another tab', async ({ page, context }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  await expectAmount(page, 0, 0)
  const otherPage = await context.newPage()
  const otherErrors = watchErrors(otherPage)
  await otherPage.clock.setFixedTime(instant)
  await otherPage.goto('/')
  await waterCard(otherPage).getByRole('button', { name: '+400 мл', exact: true }).click()
  await expectAmount(page, 400, 20)
  await expect(day(page, today)).toHaveAttribute('data-day-status', 'partial')
  await booleanCard(otherPage, 'english').getByRole('button', { name: 'Неудача', exact: true }).click()
  await expect(booleanCard(page, 'english').getByRole('button', { name: 'Неудача', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')

  await otherPage.getByRole('navigation', { name: 'Разделы приложения' })
    .getByRole('link', { name: 'Статистика', exact: true }).click()
  const statistic = otherPage.locator('[data-duration-statistics-id="gaming"] [data-statistic="total"]')
  await day(page, past).click()
  await saveTime(durationCard(page), '2', '0')
  await expect(statistic).toContainText('2 ч 0 мин')
  await saveTime(durationCard(page), '1', '0')
  await expect(statistic).toContainText('1 ч 0 мин')
  await expect(day(page, past)).toHaveAttribute('data-day-status', 'partial')
  expect(await readEntries(page)).toHaveLength(3)
  expect([...errors, ...otherErrors]).toEqual([])
  await otherPage.close()
})

test('fits 320, 375 and 390px, supports touch selection and keyboard activation without JavaScript errors', async ({ page, isMobile }, testInfo) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(instant)
  await openCalendar(page)
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const days = page.locator('[data-calendar-date]')
    const sizes = await days.evaluateAll((elements) => elements.map((element) => {
      const rectangle = element.getBoundingClientRect()
      const number = element.querySelector('.calendar-day-number')
      return {
        width: rectangle.width, height: rectangle.height,
        fontSize: number ? Number.parseFloat(getComputedStyle(number).fontSize) : 0,
      }
    }))
    expect(sizes.length).toBeGreaterThanOrEqual(31)
    expect(sizes.every((size) => size.width >= 44 && size.height >= 44 && size.fontSize >= 14)).toBe(true)
    for (const name of ['Предыдущий месяц', 'Следующий месяц', 'Сегодня']) {
      const size = await page.getByRole('main').getByRole('button', { name, exact: true }).boundingBox()
      expect(size?.width).toBeGreaterThanOrEqual(44)
      expect(size?.height).toBeGreaterThanOrEqual(44)
    }
    const date = day(page, past)
    if (isMobile) await date.tap()
    else await date.click()
    await expect(date).toHaveAttribute('aria-pressed', 'true')
    await expect(date).toHaveAccessibleName(/2 октября 2026/)
    await expect(booleanCard(page)).toBeVisible()
    await expect(waterCard(page)).toBeVisible()
    await expect(durationCard(page)).toBeVisible()
    await expect(durationCard(page, 'social-media')).toBeVisible()
    const trackerSizes = await selectedDay(page, past).locator('input, button').evaluateAll((elements) => elements.map((element) => {
      const rectangle = element.getBoundingClientRect()
      return { width: rectangle.width, height: rectangle.height }
    }))
    expect(trackerSizes.length).toBeGreaterThan(10)
    expect(trackerSizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.getByRole('main').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: `.artifacts/calendar-${testInfo.project.name}-${width}.png`, fullPage: true })
    await page.getByRole('main').getByRole('button', { name: 'Сегодня', exact: true }).click()
  }
  await day(page, past).focus()
  await expect(day(page, past)).toBeFocused()
  await day(page, past).press('Enter')
  await expect(day(page, past)).toHaveAttribute('aria-pressed', 'true')
  await expect(selectedDay(page, past)).toBeVisible()
  expect(errors).toEqual([])
})

test('recovers a direct calendar visit after IndexedDB access is restored', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await page.addInitScript(() => {
    const originalOpen = IDBFactory.prototype.open
    Object.defineProperty(IDBFactory.prototype, 'open', {
      configurable: true,
      value(this: IDBFactory, name: string, version?: number) {
        if (sessionStorage.getItem('calendar-storage-allowed') !== 'yes') {
          throw new DOMException('Storage access denied for this test', 'SecurityError')
        }
        return version === undefined ? originalOpen.call(this, name) : originalOpen.call(this, name, version)
      },
    })
  })
  await page.goto(`/#calendar?date=${past}&month=2026-10-01`)
  await expect(page.getByRole('heading', { level: 1, name: 'Календарь', exact: true })).toBeVisible()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Успех', exact: true })).toHaveCount(0)
  await page.evaluate(() => sessionStorage.setItem('calendar-storage-allowed', 'yes'))
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).first().click()
  await expect(booleanCard(page)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(selectedDay(page, past)).toBeVisible()
  await booleanCard(page).getByRole('button', { name: 'Успех', exact: true }).click()
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'abstinence', date: past, status: 'success' }),
  ])
})

for (const { timezoneId, time, localDay, month, futureDay } of [
  {
    timezoneId: 'Europe/Moscow', time: '2026-09-30T21:30:00Z', localDay: '2026-10-01',
    month: /октябрь 2026/i, futureDay: '2026-10-02',
  },
  {
    timezoneId: 'America/Los_Angeles', time: '2026-10-01T00:30:00Z', localDay: '2026-09-30',
    month: /сентябрь 2026/i, futureDay: '2026-10-01',
  },
]) {
  test.describe(`calendar ${timezoneId}`, () => {
    test.use({ timezoneId })
    test('uses the local month and day at a UTC month boundary for selection and writes', async ({ page }) => {
      const errors = watchErrors(page)
      await page.clock.setFixedTime(new Date(time))
      await openCalendar(page)
      await expect(page.getByTestId('calendar-month')).toHaveText(month)
      await expect(day(page, localDay)).toHaveAttribute('aria-current', 'date')
      await expect(day(page, localDay)).toHaveAttribute('aria-pressed', 'true')
      await saveAmount(page, '200')
      await expectAmount(page, 200, 10)
      await expect.poll(async () => readEntries(page)).toEqual([
        expect.objectContaining({ habitId: 'water', date: localDay, type: 'amount', value: 200 }),
      ])
      if (futureDay.slice(0, 7) !== localDay.slice(0, 7)) {
        await page.getByRole('main').getByRole('button', { name: 'Следующий месяц', exact: true }).click()
      }
      await day(page, futureDay).click()
      await expect(selectedDay(page, futureDay)).toContainText('Этот день ещё не наступил')
      await expect(selectedDay(page, futureDay).locator('input, form')).toHaveCount(0)
      await page.getByRole('main').getByRole('button', { name: 'Сегодня', exact: true }).click()
      await expect(day(page, localDay)).toHaveAttribute('aria-pressed', 'true')
      await expectAmount(page, 200, 10)
      expect(errors).toEqual([])
    })
  })
}
