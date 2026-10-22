import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createInitialHabits } from '../src/db/seed'
import { isLocalDate } from '../src/lib/local-date'
import type { BackupData, BackupSnapshot } from '../src/models/backup'

const instant = new Date('2026-10-20T09:00:00.000Z')
const timestamp = '2026-10-01T09:00:00.000Z'
const errorsByPage = new WeakMap<Page, string[]>()

function day(value: string) {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}

function fixture(): BackupData {
  const stamps = { createdAt: timestamp, updatedAt: timestamp }
  return {
    habits: createInitialHabits(timestamp),
    habitEntries: [
      { ...stamps, habitId: 'english', date: day('2026-10-20'), type: 'boolean', status: 'success', note: 'Практика и заметка' },
      { ...stamps, habitId: 'reading', date: day('2026-10-19'), type: 'boolean', status: 'no-data' },
      { ...stamps, habitId: 'water', date: day('2026-10-19'), type: 'amount', value: 2600 },
      { ...stamps, habitId: 'water', date: day('2026-10-20'), type: 'amount', value: 2200, note: 'Не менять число' },
      { ...stamps, habitId: 'gaming', date: day('2026-10-20'), type: 'duration', minutes: 120, note: 'Фактическое время' },
      { ...stamps, habitId: 'social-media', date: day('2026-10-20'), type: 'duration', minutes: 0 },
    ],
    tasks: [
      { ...stamps, id: 'linked-task', title: 'Задача из копии', description: 'Строка 1\nСтрока 2', date: day('2026-10-20'),
        time: '18:30', priority: 'high', status: 'active', completedAt: null, goalId: 'saved-goal' },
      { ...stamps, id: 'legacy-task', title: 'Старая выполненная задача', description: '', date: day('2026-10-19'),
        time: null, priority: 'low', status: 'completed', completedAt: null },
    ],
    goals: [
      { ...stamps, id: 'saved-goal', title: 'Цель из копии', description: 'Сохранить связи', deadline: day('2026-11-01'),
        status: 'active', progressMode: 'auto', manualProgress: 0, archived: false },
    ],
    goalMilestones: [
      { ...stamps, id: 'boolean-stage', goalId: 'saved-goal', title: 'Пройденный этап', order: 0, type: 'boolean', completed: true },
      { ...stamps, id: 'amount-stage', goalId: 'saved-goal', title: 'Числовой этап', order: 1, type: 'amount', current: 2.5, target: 5 },
    ],
  }
}

function snapshot(data = fixture()): BackupSnapshot {
  return { app: 'zadachnik', formatVersion: 1, exportedAt: instant.toISOString(), data }
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
test.afterEach(async ({ page }) => { expect(errorsByPage.get(page)).toEqual([]) })

async function openSettings(page: Page) {
  await page.goto('/#settings')
  await expect(page.getByRole('heading', { name: 'Настройки', level: 1, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Скачать резервную копию', exact: true })).toBeEnabled()
}

function card(page: Page, id: string) {
  return page.locator(`article[data-habit-id="${id}"]`)
}

async function seed(page: Page, data = fixture()) {
  await openSettings(page)
  await expect(card(page, 'water')).toBeVisible()
  // This browser context is private to this test; the user's storage is never used.
  await page.evaluate(async (data) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(Object.keys(data), 'readwrite')
      for (const [name, rows] of Object.entries(data)) {
        const store = transaction.objectStore(name)
        store.clear()
        for (const row of rows) store.put(row)
      }
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
  }), data)
  await page.reload()
  await expect(card(page, 'water')).toBeVisible()
}

async function readDatabase(page: Page): Promise<BackupData> {
  return page.evaluate(async () => new Promise<BackupData>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const names = ['habits', 'habitEntries', 'tasks', 'goals', 'goalMilestones']
      const transaction = database.transaction(names, 'readonly')
      const reads = names.map((name) => [name, transaction.objectStore(name).getAll()] as const)
      transaction.oncomplete = () => {
        database.close()
        resolve(Object.fromEntries(reads.map(([name, read]) => [name, read.result])) as unknown as BackupData)
      }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
  }))
}

async function edit(page: Page, id: string) {
  await card(page, id).getByRole('button', { name: /^Редактировать / }).click()
  return page.getByRole('dialog', { name: 'Редактировать привычку', exact: true })
}

async function save(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Сохранить привычку', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function selectBackup(page: Page, data: unknown, name = 'копия.json') {
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  })
}

async function confirmImport(page: Page) {
  await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Заменить текущие данные?', exact: true })
  await expect(dialog).toContainText(/заменены|заменит/i)
  await dialog.getByRole('button', { name: 'Заменить данные', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Данные успешно восстановлены.', { exact: true })).toBeVisible()
}

async function downloadBackup(page: Page, button = 'Скачать резервную копию') {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('zadachnik-backup-2026-10-20.json')
  const path = await download.path()
  if (!path) throw new Error('Download is unavailable')
  return JSON.parse(await readFile(path, 'utf8')) as BackupSnapshot
}

test('renames, archives and restores habits while keeping history, calendar notes and statistics', async ({ page }) => {
  await seed(page)
  const before = await readDatabase(page)
  const dialog = await edit(page, 'english')
  await dialog.getByLabel('Название', { exact: true }).fill('Мой английский')
  await dialog.getByLabel(/^Описание/).fill('Ежедневная практика')
  await save(dialog)
  await page.reload()
  await expect(card(page, 'english')).toContainText('Мой английский')
  await card(page, 'english').getByRole('button', { name: 'Архивировать Мой английский', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Архивированные привычки', exact: true })).toContainText('Мой английский')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Сегодня.', exact: true, level: 1 })).toBeVisible()
  await expect(page.locator('[data-habit-id="english"]')).toHaveCount(0)
  await page.goto('/#calendar?date=2026-10-20')
  const archived = page.locator('[data-archived-habit-id="english"]')
  await expect(archived).toContainText('Мой английский')
  await expect(archived).toContainText('Практика и заметка')
  await expect(archived).toContainText('Успех')
  await page.goto('/#statistics')
  await expect(page.locator('[data-boolean-statistics-id="english"]')).toContainText('Архив')
  expect((await readDatabase(page)).habitEntries).toEqual(before.habitEntries)
  await openSettings(page)
  await card(page, 'english').getByRole('button', { name: 'Восстановить Мой английский', exact: true }).click()
  await page.goto('/')
  await expect(page.locator('[data-habit-id="english"]')).toContainText('Мой английский')
  await expect(page.locator('[data-habit-id="english"]').getByRole('button', { name: 'Успех', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await readDatabase(page)).habitEntries).toEqual(before.habitEntries)
})

test('changes the water target and duration boundaries without rewriting recorded amounts or minutes', async ({ page }) => {
  await seed(page)
  const entries = (await readDatabase(page)).habitEntries
  let dialog = await edit(page, 'water')
  await expect(dialog).toContainText(/прошл|истор/i)
  await dialog.getByLabel(/^Дневная цель/).fill('2500')
  await save(dialog)
  dialog = await edit(page, 'gaming')
  await dialog.getByLabel('До, минут — диапазон 1', { exact: true }).fill('119')
  await dialog.getByRole('button', { name: 'Сохранить привычку', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible() // A one-minute gap must not save.
  await dialog.getByLabel('От, минут — диапазон 2', { exact: true }).fill('120')
  await dialog.getByLabel('Название категории 2', { exact: true }).fill('Мой баланс')
  await save(dialog)
  dialog = await edit(page, 'social-media')
  await dialog.getByLabel('Название категории 1', { exact: true }).fill('Без лишнего времени')
  await save(dialog)
  await page.reload()
  await page.goto('/')
  const water = page.locator('[data-amount-habit-id="water"]')
  await expect(water.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '88')
  await expect(page.locator('[data-duration-habit-id="gaming"]')).toContainText('Мой баланс')
  await expect(page.locator('[data-duration-habit-id="social-media"]')).toContainText('Без лишнего времени')
  await page.goto('/#statistics')
  await expect(page.locator('[data-amount-statistics-id="water"] [data-statistic="successful"]')).toHaveText('1 / 2 дн.')
  expect((await readDatabase(page)).habitEntries).toEqual(entries)
})

test('downloads all tables and restores an exact snapshot, including links and milestones, through the file picker', async ({ page }) => {
  await seed(page)
  const before = await readDatabase(page)
  const backup = await downloadBackup(page)
  expect(backup.app).toBe('zadachnik')
  expect(backup.formatVersion).toBe(1)
  expect(backup.exportedAt).toBe(instant.toISOString())
  expect(backup.data).toEqual(before)
  let dialog = await edit(page, 'english')
  await dialog.getByLabel('Название', { exact: true }).fill('Изменено после копии')
  await save(dialog)
  const changed = await readDatabase(page)
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Восстановить из файла', exact: true }).click()
  await (await picker).setFiles({ name: 'previous.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  const preview = page.getByRole('region', { name: 'Предпросмотр резервной копии', exact: true })
  await expect(preview).toContainText('11')
  await expect(preview).toContainText('6')
  expect(await readDatabase(page)).toEqual(changed) // Preview must be read-only.
  expect((await downloadBackup(page, 'Скачать текущую копию')).data).toEqual(changed)
  await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Заменить текущие данные?', exact: true })
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await readDatabase(page)).toEqual(changed)
  await confirmImport(page)
  expect(await readDatabase(page)).toEqual(before)
  await page.reload()
  expect(await readDatabase(page)).toEqual(before)
  await page.goto('/#goals?id=saved-goal')
  await expect(page.getByRole('heading', { name: 'Цель из копии', exact: true })).toBeVisible()
  await expect(page.getByText('Пройденный этап', { exact: true })).toBeVisible()
  await expect(page.getByText('Задача из копии', { exact: true })).toBeVisible()
  await openSettings(page)
  await selectBackup(page, backup)
  await confirmImport(page)
  expect(await readDatabase(page)).toEqual(before)
})

test('rejects invalid JSON, foreign apps, unsupported versions and broken links without changing any table', async ({ page }) => {
  await seed(page)
  const before = await readDatabase(page)
  const badLink = snapshot()
  const linkedTask = badLink.data.tasks[0]
  if (!linkedTask) throw new Error('Missing linked task fixture')
  linkedTask.goalId = 'absent-goal'
  for (const value of [
    '{broken', { ...snapshot(), app: 'another-app' },
    { ...snapshot(), formatVersion: 999 },
    { app: 'zadachnik', exportedAt: instant.toISOString(), data: before },
    { ...snapshot(), data: { ...before, habits: [{ id: 'broken' }] } }, badLink,
  ]) {
    await selectBackup(page, value)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Продолжить импорт', exact: true })).toHaveCount(0)
    expect(await readDatabase(page)).toEqual(before)
  }
  await selectBackup(page, { ...snapshot(), formatVersion: 999 })
  await expect(page.getByRole('alert')).toContainText(/более новой версией/)
  // A new valid choice must recover from the error without a reload.
  await selectBackup(page, snapshot())
  await expect(page.getByRole('region', { name: 'Предпросмотр резервной копии', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить импорт', exact: true }).click()
  expect(await readDatabase(page)).toEqual(before)
})

test('restores and exports an empty snapshot without repopulating seed habits after reload', async ({ page }) => {
  await seed(page)
  const empty: BackupData = { habits: [], habitEntries: [], tasks: [], goals: [], goalMilestones: [] }
  await selectBackup(page, snapshot(empty))
  await confirmImport(page)
  expect(await readDatabase(page)).toEqual(empty)
  await page.reload()
  expect((await downloadBackup(page)).data).toEqual(empty)
  await page.goto('/')
  await expect(page.locator('[data-habit-id], [data-amount-habit-id], [data-duration-habit-id]')).toHaveCount(0)
  await openSettings(page)
  await selectBackup(page, snapshot())
  await confirmImport(page)
  await expect(card(page, 'water')).toBeVisible()
})

test('rolls back every table after an import write error and permits retry of the same preview', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['add', 'put'] as const) {
      const original = IDBObjectStore.prototype[method]
      Object.defineProperty(IDBObjectStore.prototype, method, { configurable: true,
        value(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
          if (this.name === 'goals' && sessionStorage.getItem('backup-write-blocked') === 'yes') {
            throw new DOMException('Не удалось восстановить: хранилище заполнено.', 'QuotaExceededError')
          }
          return key === undefined ? original.call(this, value) : original.call(this, value, key)
        },
      })
    }
  })
  await seed(page)
  const backup = await downloadBackup(page)
  const dialog = await edit(page, 'english')
  await dialog.getByLabel('Название', { exact: true }).fill('Данные до неудачного импорта')
  await save(dialog)
  const before = await readDatabase(page)
  await selectBackup(page, backup)
  await page.evaluate(() => sessionStorage.setItem('backup-write-blocked', 'yes'))
  await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Заменить текущие данные?', exact: true })
  await confirmation.getByRole('button', { name: 'Заменить данные', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/заполнено|восстанов/i)
  expect(await readDatabase(page)).toEqual(before)
  await page.evaluate(() => sessionStorage.removeItem('backup-write-blocked'))
  if (await confirmation.count()) {
    await confirmation.getByRole('button', { name: 'Заменить данные', exact: true }).click()
    await expect(page.getByText('Данные успешно восстановлены.', { exact: true })).toBeVisible()
  } else await confirmImport(page)
  expect(await readDatabase(page)).toEqual(backup.data)
})

test('keeps the edit draft after validation and storage errors and preserves keyboard focus', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put
    Object.defineProperty(IDBObjectStore.prototype, 'put', { configurable: true,
      value(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (this.name === 'habits' && sessionStorage.getItem('settings-write-blocked') === 'yes') {
          throw new DOMException('Хранилище заполнено.', 'QuotaExceededError')
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key)
      },
    })
  })
  await seed(page)
  const before = await readDatabase(page)
  let dialog = await edit(page, 'water')
  await dialog.getByLabel(/^Дневная цель/).fill('0')
  await dialog.getByRole('button', { name: 'Сохранить привычку', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(await readDatabase(page)).toEqual(before)
  await dialog.getByLabel(/^Дневная цель/).fill('3000')
  await page.evaluate(() => sessionStorage.setItem('settings-write-blocked', 'yes'))
  await dialog.getByRole('button', { name: 'Сохранить привычку', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Хранилище заполнено')
  await expect(dialog.getByLabel(/^Дневная цель/)).toHaveValue('3000')
  expect(await readDatabase(page)).toEqual(before)
  await page.evaluate(() => sessionStorage.removeItem('settings-write-blocked'))
  await save(dialog)
  dialog = await edit(page, 'water')
  const controls = dialog.locator('button, input, textarea, select').filter({ visible: true })
  await controls.last().focus()
  await page.keyboard.press('Tab')
  await expect(controls.first()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(controls.last()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')

  const archive = card(page, 'water').getByRole('button', { name: /^Архивировать / })
  const beforeArchive = await readDatabase(page)
  await page.evaluate(() => sessionStorage.setItem('settings-write-blocked', 'yes'))
  await archive.focus()
  await archive.click()
  await expect(page.getByRole('alert')).toContainText('Хранилище заполнено')
  await expect(archive).toBeFocused()
  expect(await readDatabase(page)).toEqual(beforeArchive)
  await page.evaluate(() => sessionStorage.removeItem('settings-write-blocked'))
  await archive.click()
  await expect(page.getByRole('region', { name: 'Архивированные привычки', exact: true })).toContainText('Вода')
  expect((await readDatabase(page)).habitEntries).toEqual(beforeArchive.habitEntries)
})

test('updates settings, Today and backup replacements in another open tab', async ({ page, context }) => {
  await seed(page)
  const other = await context.newPage()
  const otherErrors = watchErrors(other)
  await other.clock.setFixedTime(instant)
  await other.goto('/')
  const dialog = await edit(page, 'water')
  await dialog.getByLabel(/^Дневная цель/).fill('2500')
  await save(dialog)
  await expect(other.locator('[data-amount-habit-id="water"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '88')
  await card(page, 'english').getByRole('button', { name: /^Архивировать / }).click()
  await expect(other.locator('[data-habit-id="english"]')).toHaveCount(0)
  await selectBackup(page, snapshot())
  await confirmImport(page)
  await expect(other.locator('[data-habit-id="english"]')).toBeVisible()
  await expect(other.locator('[data-amount-habit-id="water"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  expect(otherErrors).toEqual([])
  await other.close()
})

test('wraps edited category labels and symbols in daily trackers, calendar and statistics on mobile', async ({ page }) => {
  await seed(page)
  const label = 'К'.repeat(100)
  const emoji = 'М'.repeat(32)
  const dialog = await edit(page, 'gaming')
  await dialog.getByLabel('Название категории 1', { exact: true }).fill(label)
  await dialog.getByLabel('Эмодзи категории 1', { exact: true }).fill(emoji)
  await save(dialog)

  async function assertLayout() {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    const overflow = await page.locator('.duration-rating, .duration-range, .rating-distribution li').evaluateAll((elements) =>
      elements.filter((element) => element.getClientRects().length > 0)
        .some((element) => element.scrollWidth > element.clientWidth + 1))
    expect(overflow).toBe(false)
  }

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 640 })
    for (const address of ['/', '/#calendar?date=2026-10-20']) {
      await page.goto(address)
      const tracker = page.locator('[data-duration-habit-id="gaming"]')
      await expect(tracker.locator('.duration-rating')).toContainText(label)
      await expect(tracker.locator('.duration-rating')).toContainText(emoji)
      await tracker.getByText('Как считается оценка', { exact: true }).click()
      await assertLayout()
    }
    await page.goto('/#statistics')
    const statistics = page.locator('[data-duration-statistics-id="gaming"]')
    await expect(statistics.locator('.rating-distribution')).toContainText(label)
    await expect(statistics.getByRole('table')).toBeVisible()
    await assertLayout()
  }
})

test('fits habit forms, long names, backup preview and confirmation at mobile widths with touch targets', async ({ page }, testInfo) => {
  const data = fixture()
  const firstHabit = data.habits[0]
  if (!firstHabit) throw new Error('Missing habit fixture')
  firstHabit.name = 'Длинноеназвание'.repeat(12)
  await seed(page, data)
  async function assertLayout() {
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      targets: Array.from(document.querySelectorAll('main button, main input:not([type=file]), main textarea, dialog button, dialog input, dialog textarea'))
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        }),
      dialogs: Array.from(document.querySelectorAll('dialog[open]')).map((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: window.innerWidth, innerOverflow: element.scrollWidth > element.clientWidth + 1 }
      }),
    }))
    expect(result.overflow).toBe(false)
    expect(result.targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
    expect(result.dialogs.every(({ left, right, width, innerOverflow }) => left >= 0 && right <= width && !innerOverflow)).toBe(true)
  }
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 640 })
    await assertLayout()
    const dialog = await edit(page, 'gaming')
    await assertLayout()
    await page.screenshot({ path: `.artifacts/settings-ranges-${testInfo.project.name}-${width}.png` })
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await selectBackup(page, snapshot(data), `${'ОченьДлинноеИмя'.repeat(12)}.json`)
    await expect(page.getByRole('region', { name: 'Предпросмотр резервной копии', exact: true })).toBeVisible()
    await assertLayout()
    await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
    await assertLayout()
    await page.screenshot({ path: `.artifacts/settings-import-${testInfo.project.name}-${width}.png` })
    const confirmation = page.getByRole('dialog', { name: 'Заменить текущие данные?', exact: true })
    await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.getByRole('button', { name: 'Отменить импорт', exact: true }).click()
  }
  await page.screenshot({ path: `.artifacts/settings-${testInfo.project.name}-390.png`, fullPage: true })
})
