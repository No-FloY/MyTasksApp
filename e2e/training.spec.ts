import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createInitialHabits } from '../src/db/seed'
import { fixture, readDatabase, expectNoOverflow, waitForServiceWorker } from '../scripts/pwa-test/helpers'

const instant = new Date('2026-10-24T09:00:00.000Z')
const date = '2026-10-24'
const created = '2026-10-01T09:00:00.000Z'
const newIds = ['no-sweets', 'push-ups', 'abs', 'squats', 'pull-ups', 'walk-10km', 'workout', 'no-alcohol', 'breakfast', 'lunch', 'dinner', 'cleaning']
const additionIds = ['no-alcohol', 'breakfast', 'lunch', 'dinner', 'cleaning']

function oldBackupData(includeStageTen = false) {
  const source = fixture()
  return { ...source, habits: createInitialHabits(created).filter((habit) => !(includeStageTen ? additionIds : newIds).includes(habit.id)).map((habit) => {
    const legacy: Record<string, unknown> = { ...habit }
    if (!includeStageTen) {
      delete legacy.category
      delete legacy.quickActions
      delete legacy.manualMode
    }
    delete legacy.schedule
    if (habit.id === 'water') { legacy.name = 'Моя вода'; legacy.target = 2700 }
    if (habit.id === 'english') { legacy.name = 'Мой английский'; legacy.archivedAt = '2026-10-22T10:00:00.000Z' }
    return legacy
  }) }
}

async function seedOldDatabase(page: Page, version = 40) {
  const data = oldBackupData(version === 50)
  await page.route('**/training-migration-setup', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="icon" href="data:,"><p>Migration setup</p>' }))
  await page.goto('/training-migration-setup')
  await page.evaluate(({ data, version }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik', version)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const db = request.result
      const stores = {
        habits: db.createObjectStore('habits', { keyPath: 'id' }),
        habitEntries: db.createObjectStore('habitEntries', { keyPath: ['habitId', 'date'] }),
        tasks: db.createObjectStore('tasks', { keyPath: 'id' }),
        goals: db.createObjectStore('goals', { keyPath: 'id' }),
        goalMilestones: db.createObjectStore('goalMilestones', { keyPath: 'id' }),
      }
      for (const key of ['type', 'order']) stores.habits.createIndex(key, key)
      for (const key of ['habitId', 'date', 'type']) stores.habitEntries.createIndex(key, key)
      for (const key of ['date', 'status', 'goalId']) stores.tasks.createIndex(key, key)
      for (const key of ['status', 'deadline']) stores.goals.createIndex(key, key)
      stores.goalMilestones.createIndex('goalId', 'goalId')
      stores.goalMilestones.createIndex('[goalId+order]', ['goalId', 'order'])
      for (const name of Object.keys(stores) as (keyof typeof stores)[]) for (const row of data[name]) stores[name].put(row)
    }
    request.onsuccess = () => { request.result.close(); resolve() }
  }), { data, version })
  return data
}

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(instant) })

for (const version of [40, 50]) test(`upgrades a real schema-v${version / 10} database without losing renamed/archived habits, records or task-goal links`, async ({ page }) => {
  const before = await seedOldDatabase(page, version)
  await page.goto('/#today')
  await expect(page.locator('[data-amount-habit-id="push-ups"]')).toBeVisible()
  const after = await readDatabase(page)
  expect(after.habits).toHaveLength(23)
  for (const habit of before.habits) expect(after.habits.find((item) => item.id === habit.id)).toMatchObject(habit)
  expect(after.habits.find((habit) => habit.id === 'water')).toMatchObject({ name: 'Моя вода', target: 2700, category: 'food_water', quickActions: [200, 400], manualMode: 'add' })
  expect(after.habits.find((habit) => habit.id === 'english')).toMatchObject({ name: 'Мой английский', category: 'self_development', archivedAt: '2026-10-22T10:00:00.000Z' })
  expect(after.habitEntries).toEqual(before.habitEntries.sort((a, b) => a.habitId.localeCompare(b.habitId) || a.date.localeCompare(b.date)))
  for (const name of ['tasks', 'goals', 'goalMilestones'] as const) expect(after[name]).toEqual(before[name])
  for (const id of newIds.filter((id) => !before.habits.some((habit) => habit.id === id))) {
    expect(after.habits.find((habit) => habit.id === id)).toMatchObject({ createdAt: instant.toISOString() })
  }
  expect(after.habits.find((habit) => habit.id === 'cleaning')).toMatchObject({ schedule: { type: 'weekly' }, category: 'routine' })
  await page.reload()
  expect(await readDatabase(page)).toEqual(after)
  await page.goto('/#calendar?date=2026-10-23')
  await expect(page.locator('[data-amount-habit-id="water"]')).toContainText(/600/)
})

test('records categorized training, computes transparent scores, edits history/settings and round-trips all facts', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#today')
  await expect(page.locator('[data-amount-habit-id="water"]')).toBeVisible()
  // Establish a seven-day history without fabricating any recorded results.
  await page.evaluate((created) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('habits', 'readwrite')
      const cursor = transaction.objectStore('habits').openCursor()
      cursor.onsuccess = () => { const item = cursor.result; if (item) { item.update({ ...item.value, createdAt: created }); item.continue() } }
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => reject(transaction.error)
    }
  }), created)
  await page.reload()
  for (const heading of ['Еда и вода', 'Тренировка', 'Быт и режим', 'Саморазвитие', 'Экранное время']) {
    await expect(page.locator('.habit-category-heading').getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  const boolean = (id: string) => page.locator(`[data-habit-id="${id}"]`)
  const amount = (id: string) => page.locator(`[data-amount-habit-id="${id}"]`)
  await boolean('no-sweets').getByRole('button', { name: 'Неудача', exact: true }).click()
  await boolean('no-chips').getByRole('button', { name: 'Успех', exact: true }).click()
  await boolean('breakfast').getByRole('button', { name: 'Был', exact: true }).click()
  await boolean('lunch').getByRole('button', { name: 'Не было', exact: true }).click()
  await amount('water').getByLabel('Сколько добавить, мл', { exact: true }).fill('1000')
  await amount('water').getByRole('button', { name: 'Добавить', exact: true }).click()
  for (const [id, value, increment] of [['push-ups', 130, 10], ['abs', 30, 10], ['squats', 100, 10], ['pull-ups', 17, 1]] as const) {
    const card = amount(id)
    await card.getByRole('button', { name: new RegExp(`^\\+${increment}(?:\\s|$)`) }).click()
    await card.getByRole('button', { name: new RegExp(`^\\+${increment}(?:\\s|$)`) }).click()
    await card.getByText('Указать итог дня', { exact: true }).click()
    await card.getByLabel(/^Итог за день/).fill(String(value))
    await card.getByRole('button', { name: 'Сохранить количество', exact: true }).click()
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(Math.min(value / (id === 'pull-ups' ? 15 : 100) * 100, 100)))
  }
  await expect(amount('push-ups')).toContainText(/130\s*%/)
  await boolean('walk-10km').getByRole('button', { name: 'Успех', exact: true }).click()
  await boolean('workout').getByRole('button', { name: 'Неудача', exact: true }).click()
  await expect(page.getByTestId('day-score')).toContainText('61')
  await expect(page.getByTestId('day-coverage')).toContainText('50')
  const before = await readDatabase(page)
  expect(before.habitEntries).toHaveLength(11)
  await page.reload()
  expect(await readDatabase(page)).toEqual(before)
  await page.goto('/#statistics')
  await expect(page.getByTestId('weekly-score')).toContainText('61')
  const pushups = page.locator('[data-amount-statistics-id="push-ups"]')
  await expect(pushups.locator('[data-statistic="total"]')).toHaveText('130')
  await expect(pushups.locator('[data-statistic="successful"]')).toContainText('1 / 1')
  await page.goto(`/#calendar?date=${date}`)
  await expect(amount('push-ups')).toContainText('130')
  await page.goto('/#settings')
  await page.locator('article[data-habit-id="push-ups"]').getByRole('button', { name: /^Редактировать / }).click()
  const dialog = page.getByRole('dialog', { name: 'Редактировать привычку', exact: true })
  await dialog.getByLabel('Категория привычки', { exact: true }).selectOption('routine')
  await dialog.getByRole('button', { name: 'Сохранить привычку', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const categorized = await readDatabase(page)
  expect(categorized.habitEntries).toEqual(before.habitEntries)
  expect(categorized.habits.find((habit) => habit.id === 'push-ups')?.category).toBe('routine')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать резервную копию', exact: true }).click()
  const file = await (await downloadEvent).path()
  if (!file) throw new Error('Missing backup download')
  const backup = JSON.parse(await readFile(file, 'utf8'))
  expect(backup.formatVersion).toBe(3)
  expect(backup.data).toEqual(categorized)
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles(file)
  await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
  await page.getByRole('button', { name: 'Заменить данные', exact: true }).click()
  await expect(page.getByText('Данные успешно восстановлены.', { exact: true })).toBeVisible()
  await page.reload()
  expect(await readDatabase(page)).toEqual(categorized)
  for (const viewport of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/#today')
    await expectNoOverflow(page)
    for (const id of ['push-ups', 'abs', 'squats', 'pull-ups']) {
      const box = await amount(id).getByRole('button', { name: /^\+/ }).boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
  }
  expect(errors).toEqual([])
})

for (const version of [1, 2]) test(`imports a real format-v${version} snapshot and preserves old facts while enriching only its definitions`, async ({ page }) => {
  const data = oldBackupData(version === 2)
  await page.goto('/#settings')
  const backupInput = page.getByLabel('Файл резервной копии', { exact: true })
  // File selection does not wait for enabled controls; initial database loading does.
  await expect(backupInput).toBeEnabled()
  await backupInput.setInputFiles({ name: `old-v${version}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'zadachnik', formatVersion: version, exportedAt: created, data })) })
  await expect(page.getByRole('region', { name: 'Предпросмотр резервной копии', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
  await page.getByRole('button', { name: 'Заменить данные', exact: true }).click()
  await expect(page.getByText('Данные успешно восстановлены.', { exact: true })).toBeVisible()
  await page.reload()
  const after = await readDatabase(page)
  expect(after.habits).toHaveLength(version === 1 ? 11 : 18)
  for (const habit of data.habits) expect(after.habits.find((item) => item.id === habit.id)).toMatchObject(habit)
  const sortRows = (rows: readonly unknown[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  for (const name of ['habitEntries', 'tasks', 'goals', 'goalMilestones'] as const) expect(sortRows(after[name])).toEqual(sortRows(data[name]))
})

test('uses training quick actions and totals offline after a real production precache', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit setOffline transport limitation #42775; server-outage coverage is in the PWA update suite.')
  await page.goto('/#today')
  await waitForServiceWorker(page)
  await context.setOffline(true)
  await page.reload()
  const pullups = page.locator('[data-amount-habit-id="pull-ups"]')
  await pullups.getByRole('button', { name: /^\+1(?:\s|$)/ }).click()
  await pullups.getByText('Указать итог дня', { exact: true }).click()
  await pullups.getByLabel(/^Итог за день/).fill('17')
  await pullups.getByRole('button', { name: 'Сохранить количество', exact: true }).click()
  await page.reload()
  expect((await readDatabase(page)).habitEntries.find((entry) => entry.habitId === 'pull-ups')).toMatchObject({ value: 17 })
})
