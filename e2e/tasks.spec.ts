import { expect, test, type Locator, type Page } from '@playwright/test'
import { createInitialHabits } from '../src/db/seed'
import type { Habit } from '../src/models/habit'
import type { HabitEntry } from '../src/models/habit-entry'
import type { Task } from '../src/models/task'

const instant = new Date('2026-10-07T09:00:00Z')
const today = '2026-10-07'
const errorsByPage = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  errorsByPage.set(page, errors)
})

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page)).toEqual([])
})

function card(page: Page, title: string) {
  return page.locator('[data-task-id]').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

function group(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Разделы приложения' })
    .getByRole('link', { name, exact: true }).click()
  const heading = name === 'Сегодня' ? `${name}.` : name
  await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible()
}

async function openTasks(page: Page) {
  await page.goto('/#tasks')
  await expect(page.getByRole('heading', { name: 'Задачи', level: 1, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Добавить задачу', exact: true })).toBeEnabled()
}

async function readDatabase(page: Page) {
  return page.evaluate(async () => new Promise<{
    tasks: Task[]; habits: Habit[]; entries: HabitEntry[]; version: number; stores: string[]; indexes: string[]
  }>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(['tasks', 'habits', 'habitEntries'], 'readonly')
      const tasks = transaction.objectStore('tasks').getAll()
      const habits = transaction.objectStore('habits').getAll()
      const entries = transaction.objectStore('habitEntries').getAll()
      const indexes = Array.from(transaction.objectStore('tasks').indexNames)
      transaction.oncomplete = () => {
        const result = {
          tasks: tasks.result as Task[], habits: habits.result as Habit[], entries: entries.result as HabitEntry[],
          version: database.version, stores: Array.from(database.objectStoreNames), indexes,
        }
        database.close()
        resolve(result)
      }
      transaction.onerror = () => {
        database.close()
        reject(transaction.error)
      }
    }
  }))
}

interface TaskFormValues {
  title: string
  description?: string
  date?: string
  time?: string
  priority?: 'low' | 'medium' | 'high'
}

async function fillTaskForm(dialog: Locator, values: TaskFormValues) {
  await dialog.getByLabel('Название', { exact: true }).fill(values.title)
  if (values.description !== undefined) await dialog.getByLabel('Описание необязательно', { exact: true }).fill(values.description)
  if (values.date !== undefined) await dialog.getByLabel('Дата', { exact: true }).fill(values.date)
  if (values.time !== undefined) await dialog.getByLabel('Время необязательно', { exact: true }).fill(values.time)
  if (values.priority !== undefined) await dialog.getByLabel('Приоритет', { exact: true }).selectOption(values.priority)
}

async function createTask(page: Page, values: TaskFormValues) {
  await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true })
  await expect(dialog).toBeVisible()
  await fillTaskForm(dialog, values)
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(card(page, values.title.trim())).toBeVisible()
}

async function taskAction(page: Page, title: string, action: 'Редактировать' | 'Удалить' | 'Отметить как не выполненную' | 'Отменить') {
  await card(page, title).getByRole('button', { name: `Действия для задачи «${title}»`, exact: true }).click()
  await page.getByRole('button', { name: action, exact: true }).click()
}

test('confirms terminal task outcomes, restores dialog focus and persists them in Tasks and Calendar', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  const add = page.getByRole('button', { name: 'Добавить задачу', exact: true })
  for (const scenario of [
    { title: 'Не удалось закончить', action: 'Отметить как не выполненную', dialog: 'Отметить задачу как не выполненную?', confirm: 'Отметить как не выполненную', status: 'failed', group: 'Не выполненные', label: 'Не выполнена' },
    { title: 'Планы изменились', action: 'Отменить', dialog: 'Отменить задачу?', confirm: 'Отменить задачу', status: 'cancelled', group: 'Отменённые', label: 'Отменена' },
  ] as const) {
    await createTask(page, { title: scenario.title, description: 'Сохранить факты задачи', time: '10:00' })
    const original = (await readDatabase(page)).tasks.find((task) => task.title === scenario.title)
    const trigger = card(page, scenario.title).getByRole('button', { name: `Действия для задачи «${scenario.title}»`, exact: true })
    await taskAction(page, scenario.title, scenario.action)
    const dialog = page.getByRole('dialog', { name: scenario.dialog, exact: true })
    await expect(dialog).toHaveAccessibleDescription(/конечное состояние/)
    await expect(dialog.getByRole('button', { name: 'Оставить задачу', exact: true })).toBeFocused()
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    expect((await readDatabase(page)).tasks.find((task) => task.id === original?.id)).toEqual(original)

    await taskAction(page, scenario.title, scenario.action)
    await dialog.getByRole('button', { name: 'Оставить задачу', exact: true }).click()
    await expect(trigger).toBeFocused()
    await taskAction(page, scenario.title, scenario.action)
    await dialog.getByRole('button', { name: scenario.confirm, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(group(page, scenario.group)).toContainText(scenario.title)
    await expect(add).toBeFocused()
    await expect(card(page, scenario.title)).toContainText(scenario.label)
    await expect(card(page, scenario.title).getByRole('button', { name: /Выполнить задачу|Вернуть в активные/ })).toHaveCount(0)
    await trigger.click()
    await expect(card(page, scenario.title).getByRole('button', { name: /Выполнить$|Отметить как не выполненную|^Отменить$/ })).toHaveCount(0)
    await trigger.click()
    expect((await readDatabase(page)).tasks.find((task) => task.id === original?.id))
      .toEqual({ ...original, status: scenario.status, updatedAt: instant.toISOString() })
  }
  const stored = await readDatabase(page)
  expect(stored.tasks.every((task) => task.completedAt === null && !Object.hasOwn(task, 'outcome'))).toBe(true)
  await page.reload()
  await expect(group(page, 'Не выполненные')).toContainText('Не удалось закончить')
  await expect(group(page, 'Отменённые')).toContainText('Планы изменились')
  expect((await readDatabase(page)).tasks).toEqual(stored.tasks)
  await navigate(page, 'Сегодня')
  await expect(page.getByRole('region', { name: 'Задачи на сегодня', exact: true })).toContainText('На сегодня задач нет')
  await navigate(page, 'Календарь')
  const panel = page.getByRole('region', { name: 'Задачи выбранного дня', exact: true })
  await expect(panel).toContainText('Не выполнена')
  await expect(panel).toContainText('Отменена')
  await expect(panel).toContainText('Всего: 2 · Выполнено: 0')
})

test('keeps a terminal confirmation open after a storage failure and retries without losing task data', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      configurable: true,
      value(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (this.name === 'tasks' && sessionStorage.getItem('task-close-blocked') === 'yes') {
          throw new DOMException('Не удалось закрыть задачу: хранилище заполнено.', 'QuotaExceededError')
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key)
      },
    })
  })
  await openTasks(page)
  const title = 'Закрыть после ошибки'
  await createTask(page, { title, description: 'Исходное описание', time: '18:00', priority: 'high' })
  const original = (await readDatabase(page)).tasks[0]
  await taskAction(page, title, 'Отменить')
  const dialog = page.getByRole('dialog', { name: 'Отменить задачу?', exact: true })
  const confirm = dialog.getByRole('button', { name: 'Отменить задачу', exact: true })
  await page.evaluate(() => sessionStorage.setItem('task-close-blocked', 'yes'))
  await confirm.click()
  await expect(dialog.getByRole('alert')).toContainText('хранилище заполнено')
  await expect(confirm).toBeEnabled()
  await expect(confirm).toBeFocused()
  expect((await readDatabase(page)).tasks).toEqual([original])
  await page.evaluate(() => sessionStorage.removeItem('task-close-blocked'))
  await confirm.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(group(page, 'Отменённые')).toContainText(title)
  await expect(page.getByRole('button', { name: 'Добавить задачу', exact: true })).toBeFocused()
  await page.reload()
  expect((await readDatabase(page)).tasks).toEqual([{ ...original, status: 'cancelled', updatedAt: instant.toISOString() }])
})

test('refreshes timed deadlines while open and derives on-time versus late completion without storing computed outcomes', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  await createTask(page, { title: 'Ровно к сроку', time: '12:00' })
  await createTask(page, { title: 'После срока', time: '12:00' })
  await createTask(page, { title: 'В течение дня' })
  await expect(group(page, 'Сегодня').locator('[data-task-id]')).toHaveCount(3)
  await card(page, 'Ровно к сроку').getByRole('button', { name: 'Выполнить задачу «Ровно к сроку»', exact: true }).click()
  await expect(card(page, 'Ровно к сроку')).toContainText('Выполнена вовремя')
  await page.clock.setFixedTime(new Date(instant.getTime() + 1))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(group(page, 'Просроченные')).toContainText('После срока')
  await expect(group(page, 'Сегодня')).toContainText('В течение дня')
  await card(page, 'После срока').getByRole('button', { name: 'Выполнить задачу «После срока»', exact: true }).click()
  await expect(card(page, 'После срока')).toContainText('Выполнена с опозданием')
  const stored = (await readDatabase(page)).tasks
  expect(stored.find((task) => task.title === 'Ровно к сроку')).toMatchObject({ status: 'completed', completedAt: instant.toISOString() })
  expect(stored.find((task) => task.title === 'После срока')).toMatchObject({ status: 'completed', completedAt: new Date(instant.getTime() + 1).toISOString() })
  expect(stored.every((task) => !Object.hasOwn(task, 'outcome') && !Object.hasOwn(task, 'overdue'))).toBe(true)
  await page.reload()
  await expect(card(page, 'Ровно к сроку')).toContainText('Выполнена вовремя')
  await expect(card(page, 'После срока')).toContainText('Выполнена с опозданием')
  expect((await readDatabase(page)).tasks).toEqual(stored)
})

test('retains goal links when closing tasks and shows terminal labels in goal details and linking choices', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  await createTask(page, { title: 'Связанная неудача' })
  await createTask(page, { title: 'Отменённый план' })
  const tasks = (await readDatabase(page)).tasks
  const failedId = tasks.find((task) => task.title === 'Связанная неудача')!.id
  const cancelledId = tasks.find((task) => task.title === 'Отменённый план')!.id
  await taskAction(page, 'Отменённый план', 'Отменить')
  await page.getByRole('dialog', { name: 'Отменить задачу?', exact: true }).getByRole('button', { name: 'Отменить задачу', exact: true }).click()
  await navigate(page, 'Цели')
  await page.getByRole('button', { name: 'Добавить цель', exact: true }).click()
  const goalForm = page.getByRole('dialog', { name: 'Новая цель', exact: true })
  await goalForm.getByLabel('Название', { exact: true }).fill('Цель с историей задач')
  await goalForm.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(goalForm).toHaveCount(0)
  const goalUrl = page.url()
  const goalId = new URLSearchParams(goalUrl.split('?')[1]).get('id')
  for (const id of [failedId, cancelledId]) {
    await page.getByRole('button', { name: 'Привязать задачу', exact: true }).click()
    const link = page.getByRole('dialog', { name: 'Привязать задачу', exact: true })
    if (id === cancelledId) await expect(link.locator(`option[value="${cancelledId}"]`)).toHaveText(/отменена/)
    await link.getByLabel('Задача', { exact: true }).selectOption(id)
    await link.getByRole('button', { name: 'Привязать', exact: true }).click()
    await expect(link).toHaveCount(0)
  }
  await page.getByRole('link', { name: 'Связанная неудача', exact: true }).click()
  await expect(card(page, 'Связанная неудача')).toBeFocused()
  await taskAction(page, 'Связанная неудача', 'Отметить как не выполненную')
  await page.getByRole('dialog', { name: 'Отметить задачу как не выполненную?', exact: true })
    .getByRole('button', { name: 'Отметить как не выполненную', exact: true }).click()
  await card(page, 'Связанная неудача').getByRole('link', { name: 'Перейти к цели', exact: true }).click()
  await expect(page).toHaveURL(goalUrl)
  await expect(page.locator('.goal-linked-task').filter({ hasText: 'Связанная неудача' })).toContainText('Не выполнена')
  await expect(page.locator('.goal-linked-task').filter({ hasText: 'Отменённый план' })).toContainText('Отменена')
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '0')
  await page.reload()
  expect((await readDatabase(page)).tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: failedId, goalId, status: 'failed', completedAt: null }),
    expect.objectContaining({ id: cancelledId, goalId, status: 'cancelled', completedAt: null }),
  ]))
  await page.getByRole('button', { name: 'Отвязать задачу «Связанная неудача»', exact: true }).click()
  await page.getByRole('button', { name: 'Привязать задачу', exact: true }).click()
  const link = page.getByRole('dialog', { name: 'Привязать задачу', exact: true })
  await expect(link.locator(`option[value="${failedId}"]`)).toHaveText(/не выполнена/)
  await link.getByRole('button', { name: 'Отмена', exact: true }).click()
})

test('creates a local task with defaults and optional time, then edits all fields without duplicating the record', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true })
  await expect(dialog.getByLabel('Дата', { exact: true })).toHaveValue(today)
  await expect(dialog.getByLabel('Приоритет', { exact: true })).toHaveValue('medium')
  await expect(dialog.getByLabel('Время необязательно', { exact: true })).toHaveValue('')
  await fillTaskForm(dialog, { title: '  Купить продукты  ', description: 'Молоко\nХлеб' })
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(group(page, 'Сегодня')).toContainText('Купить продукты')
  await expect.poll(async () => (await readDatabase(page)).tasks).toEqual([
    expect.objectContaining({ title: 'Купить продукты', description: 'Молоко\nХлеб', date: today,
      time: null, priority: 'medium', status: 'active', completedAt: null }),
  ])
  const original = (await readDatabase(page)).tasks[0]
  expect(original?.createdAt).toBe(instant.toISOString())
  await page.reload()
  await expect(card(page, 'Купить продукты')).toBeVisible()
  await page.clock.setFixedTime(new Date('2026-10-07T09:01:00Z'))
  await taskAction(page, 'Купить продукты', 'Редактировать')
  const edit = page.getByRole('dialog', { name: 'Редактировать задачу', exact: true })
  await expect(edit.getByLabel('Название', { exact: true })).toHaveValue('Купить продукты')
  await expect(edit.getByLabel('Описание необязательно', { exact: true })).toHaveValue('Молоко\nХлеб')
  await fillTaskForm(edit, { title: 'Купить продукты завтра', description: 'Молоко\nХлеб\nЯблоки',
    date: '2026-10-08', time: '18:30', priority: 'high' })
  await page.screenshot({ path: `.artifacts/tasks-dialog-${testInfo.project.name}.png` })
  await edit.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(group(page, 'Предстоящие')).toContainText('Купить продукты завтра')
  await expect(card(page, 'Купить продукты завтра')).toContainText('18:30')
  await expect(card(page, 'Купить продукты завтра')).toContainText('Приоритет: высокий')
  await page.reload()
  await expect(card(page, 'Купить продукты завтра')).toContainText('Яблоки')
  await page.screenshot({ path: `.artifacts/tasks-page-${testInfo.project.name}.png`, fullPage: true })
  expect((await readDatabase(page)).tasks).toEqual([
    expect.objectContaining({ id: original?.id, createdAt: original?.createdAt,
      title: 'Купить продукты завтра', description: 'Молоко\nХлеб\nЯблоки', date: '2026-10-08',
      time: '18:30', priority: 'high', status: 'active', completedAt: null, updatedAt: '2026-10-07T09:01:00.000Z' }),
  ])
  await taskAction(page, 'Купить продукты завтра', 'Редактировать')
  await fillTaskForm(edit, { title: 'Купить продукты завтра', description: '', date: '2026-10-06', time: '', priority: 'low' })
  await edit.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(group(page, 'Просроченные')).toContainText('Купить продукты завтра')
  expect((await readDatabase(page)).tasks).toEqual([
    expect.objectContaining({ id: original?.id, date: '2026-10-06', description: '', time: null, priority: 'low' }),
  ])
})

test('persists completion, reopens tasks and deletes only after explicit confirmation', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  const title = 'Оплатить интернет'
  await createTask(page, { title, date: '2026-10-06', time: '10:00', priority: 'low' })
  await expect(group(page, 'Просроченные')).toContainText(title)
  await card(page, title).getByRole('button', { name: `Выполнить задачу «${title}»`, exact: true }).click()
  await expect(group(page, 'Выполненные')).toContainText(title)
  await expect.poll(async () => (await readDatabase(page)).tasks[0]).toMatchObject({ status: 'completed', completedAt: instant.toISOString() })
  await page.reload()
  await expect(group(page, 'Выполненные')).toContainText(title)
  await card(page, title).getByRole('button', { name: `Вернуть в активные «${title}»`, exact: true }).click()
  await expect(group(page, 'Просроченные')).toContainText(title)
  await expect.poll(async () => (await readDatabase(page)).tasks[0]).toMatchObject({ status: 'active', completedAt: null })
  await taskAction(page, title, 'Удалить')
  const confirmation = page.getByRole('dialog', { name: 'Удалить задачу?', exact: true })
  await expect(confirmation).toContainText(title)
  expect((await readDatabase(page)).tasks).toHaveLength(1)
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(card(page, title)).toBeVisible()
  expect((await readDatabase(page)).tasks).toHaveLength(1)
  await taskAction(page, title, 'Удалить')
  await confirmation.getByRole('button', { name: 'Удалить задачу', exact: true }).click()
  await expect(card(page, title)).toHaveCount(0)
  await expect.poll(async () => (await readDatabase(page)).tasks).toEqual([])
  await page.reload()
  await expect(page.locator('[data-task-id]')).toHaveCount(0)
})

test('groups dates and consistently sorts active tasks by date, time, priority and creation order', async ({ page }) => {
  test.setTimeout(90_000)
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  const fixtures: TaskFormValues[] = [
    { title: 'Позже без времени', date: '2026-10-09', priority: 'high' },
    { title: 'Без времени низкий', priority: 'low' },
    { title: 'В десять средний', time: '10:00', priority: 'medium' },
    { title: 'В десять высокий первый', time: '10:00', priority: 'high' },
    { title: 'В восемь низкий', time: '08:00', priority: 'low' },
    { title: 'В десять высокий второй', time: '10:00', priority: 'high' },
    { title: 'Без времени высокий', priority: 'high' },
    { title: 'Завтра поздно', date: '2026-10-08', time: '23:30' },
    { title: 'Просроченная', date: '2026-10-06' },
  ]
  for (const [index, fixture] of fixtures.entries()) {
    await page.clock.setFixedTime(new Date(instant.getTime() + index * 1000))
    await createTask(page, fixture)
  }
  const expected = ['Без времени высокий', 'Без времени низкий']
  const overdue = ['Просроченная', 'В восемь низкий', 'В десять высокий первый', 'В десять высокий второй', 'В десять средний']
  await expect(group(page, 'Сегодня').locator('[data-task-id]').getByRole('heading')).toHaveText(expected)
  await expect(group(page, 'Предстоящие').locator('[data-task-id]').getByRole('heading'))
    .toHaveText(['Завтра поздно', 'Позже без времени'])
  await expect(group(page, 'Просроченные').locator('[data-task-id]').getByRole('heading')).toHaveText(overdue)
  await page.reload()
  await expect(group(page, 'Сегодня').locator('[data-task-id]').getByRole('heading')).toHaveText(expected)
  await expect(group(page, 'Просроченные').locator('[data-task-id]').getByRole('heading')).toHaveText(overdue)
  const stored = (await readDatabase(page)).tasks
  expect(stored).toHaveLength(9)
  expect(stored.every((task) => task.status === 'active')).toBe(true)
  expect(stored.every((task) => !Object.hasOwn(task, 'overdue'))).toBe(true)
})

test('shows only active current-day tasks on Today and completes them there', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  await createTask(page, { title: 'Сегодня утром', time: '08:00', priority: 'high' })
  await createTask(page, { title: 'Сегодня без времени' })
  await createTask(page, { title: 'Вчерашняя', date: '2026-10-06' })
  await createTask(page, { title: 'Завтрашняя', date: '2026-10-08' })
  await navigate(page, 'Сегодня')
  const panel = page.getByRole('region', { name: 'Задачи на сегодня', exact: true })
  await expect(panel.locator('[data-task-id]')).toHaveCount(2)
  await expect(panel).toContainText('Сегодня утром')
  await expect(panel).toContainText('08:00')
  await expect(panel).toContainText('Приоритет: высокий')
  await expect(panel).not.toContainText('Вчерашняя')
  await expect(panel).not.toContainText('Завтрашняя')
  await panel.getByRole('button', { name: 'Выполнить задачу «Сегодня утром»', exact: true }).click()
  await expect(panel.locator('[data-task-id]')).toHaveCount(1)
  await expect.poll(async () => (await readDatabase(page)).tasks.find((task) => task.title === 'Сегодня утром'))
    .toMatchObject({ status: 'completed', completedAt: instant.toISOString() })
  await page.reload()
  await expect(panel.locator('[data-task-id]')).toHaveCount(1)
  await panel.getByRole('button', { name: 'Выполнить задачу «Сегодня без времени»', exact: true }).click()
  await expect(panel).toContainText('На сегодня задач нет')
  await panel.getByRole('link', { name: 'Все задачи', exact: true }).click()
  await expect(group(page, 'Выполненные').locator('[data-task-id]')).toHaveCount(2)
})

test('reads past, present and future task dates in the calendar, including completed status after reload', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  await createTask(page, { title: 'Встреча в будущем', date: '2026-10-12', time: '18:30', priority: 'high' })
  await createTask(page, { title: 'Сделано заранее', date: '2026-10-12' })
  await card(page, 'Сделано заранее').getByRole('button', { name: 'Выполнить задачу «Сделано заранее»', exact: true }).click()
  await createTask(page, { title: 'Дело прошлого дня', date: '2026-10-06' })
  await navigate(page, 'Календарь')
  const panel = page.getByRole('region', { name: 'Задачи выбранного дня', exact: true })
  await expect(panel.locator('[data-task-id]')).toHaveCount(0)
  await page.locator('[data-calendar-date="2026-10-12"]').click()
  await expect(panel.locator('[data-task-id]')).toHaveCount(2)
  await expect(panel).toContainText('Встреча в будущем')
  await expect(panel).toContainText('18:30')
  await expect(panel).toContainText(/Выполнена/)
  await expect(panel.getByRole('button', { name: /Выполнить задачу|Вернуть в активные/ })).toHaveCount(0)
  await expect(page.locator('[data-selected-date="2026-10-12"]')).toContainText('Этот день ещё не наступил')
  await page.reload()
  await expect(panel.locator('[data-task-id]')).toHaveCount(2)
  await page.locator('[data-calendar-date="2026-10-06"]').click()
  await expect(panel.locator('[data-task-id]')).toHaveCount(1)
  await expect(panel).toContainText('Дело прошлого дня')
  await expect(panel).not.toContainText('Встреча в будущем')
  expect((await readDatabase(page)).tasks).toHaveLength(3)
  expect((await readDatabase(page)).entries).toEqual([])
})

for (const { timezoneId, time, localDay, yesterday, tomorrow } of [
  { timezoneId: 'Europe/Moscow', time: '2026-09-30T21:30:00Z', localDay: '2026-10-01', yesterday: '2026-09-30', tomorrow: '2026-10-02' },
  { timezoneId: 'America/Los_Angeles', time: '2026-10-01T00:30:00Z', localDay: '2026-09-30', yesterday: '2026-09-29', tomorrow: '2026-10-01' },
]) {
  test.describe(`tasks ${timezoneId}`, () => {
    test.use({ timezoneId })
    test('derives overdue and the default task date from the local day across UTC month boundaries', async ({ page }) => {
      await page.clock.setFixedTime(new Date(time))
      await openTasks(page)
      await createTask(page, { title: 'Текущий локальный день' })
      await createTask(page, { title: 'Срок в начале локального дня', time: '00:01' })
      await createTask(page, { title: 'Предыдущий локальный день', date: yesterday })
      await createTask(page, { title: 'Следующий локальный день', date: tomorrow })
      await expect(group(page, 'Сегодня')).toContainText('Текущий локальный день')
      await expect(group(page, 'Просроченные')).toContainText('Предыдущий локальный день')
      await expect(group(page, 'Просроченные')).toContainText('Срок в начале локального дня')
      await expect(group(page, 'Предстоящие')).toContainText('Следующий локальный день')
      expect((await readDatabase(page)).tasks.find((task) => task.title === 'Текущий локальный день'))
        .toMatchObject({ date: localDay, status: 'active' })
      await page.reload()
      await expect(group(page, 'Сегодня')).toContainText('Текущий локальный день')
      await expect(group(page, 'Просроченные')).toContainText('Срок в начале локального дня')
    })
  })
}

test('moves active tasks between overdue, today and upcoming at local midnight without writing derived state', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T20:50:00Z') })
  await openTasks(page)
  await createTask(page, { title: 'Сегодня до полуночи' })
  await createTask(page, { title: 'Завтра после полуночи', date: '2026-10-07' })
  await expect(group(page, 'Сегодня')).toContainText('Сегодня до полуночи')
  await expect(group(page, 'Предстоящие')).toContainText('Завтра после полуночи')
  const before = (await readDatabase(page)).tasks
  await page.clock.pauseAt(new Date('2026-10-06T20:59:50Z'))
  await page.clock.fastForward(20_000)
  await page.clock.resume()
  await expect(group(page, 'Просроченные')).toContainText('Сегодня до полуночи')
  await expect(group(page, 'Сегодня')).toContainText('Завтра после полуночи')
  expect((await readDatabase(page)).tasks).toEqual(before)
  await navigate(page, 'Сегодня')
  const panel = page.getByRole('region', { name: 'Задачи на сегодня', exact: true })
  await expect(panel).toContainText('Завтра после полуночи')
  await expect(panel).not.toContainText('Сегодня до полуночи')
})

test('propagates create, edit, complete, reopen and delete between tabs without reload', async ({ page, context }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  const other = await context.newPage()
  const errors: string[] = []
  other.on('pageerror', (error) => errors.push(error.message))
  other.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await other.clock.setFixedTime(instant)
  await other.goto('/')
  const todayPanel = other.getByRole('region', { name: 'Задачи на сегодня', exact: true })
  await expect(todayPanel).toContainText('На сегодня задач нет')
  await createTask(page, { title: 'Общая задача' })
  await expect(todayPanel).toContainText('Общая задача')
  await taskAction(page, 'Общая задача', 'Редактировать')
  const dialog = page.getByRole('dialog', { name: 'Редактировать задачу', exact: true })
  await fillTaskForm(dialog, { title: 'Уточнённая задача', time: '19:00' })
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(todayPanel).toContainText('Уточнённая задача')
  await expect(todayPanel).toContainText('19:00')
  await todayPanel.getByRole('button', { name: 'Выполнить задачу «Уточнённая задача»', exact: true }).click()
  await expect(group(page, 'Выполненные')).toContainText('Уточнённая задача')
  await card(page, 'Уточнённая задача').getByRole('button', { name: 'Вернуть в активные «Уточнённая задача»', exact: true }).click()
  await expect(todayPanel).toContainText('Уточнённая задача')
  await taskAction(page, 'Уточнённая задача', 'Удалить')
  await page.getByRole('dialog', { name: 'Удалить задачу?', exact: true }).getByRole('button', { name: 'Удалить задачу', exact: true }).click()
  await expect(todayPanel).toContainText('На сегодня задач нет')
  expect(errors).toEqual([])
  await other.close()
})

test('associates validation errors with inputs, traps dialog focus and restores focus on cancel and save', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  const add = page.getByRole('button', { name: 'Добавить задачу', exact: true })
  await add.click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true })
  const title = dialog.getByLabel('Название', { exact: true })
  await expect(title).toBeFocused()
  await title.fill('   ')
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAccessibleDescription(/название/i)
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect((await readDatabase(page)).tasks).toEqual([])
  await title.fill('Корректная задача')
  await dialog.getByLabel('Дата', { exact: true }).fill('')
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(dialog.getByLabel('Дата', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByLabel('Дата', { exact: true })).toHaveAccessibleDescription(/дат/i)
  expect((await readDatabase(page)).tasks).toEqual([])
  await dialog.getByLabel('Дата', { exact: true }).fill(today)
  // Keyboard traversal must never enter the page underneath the modal.
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(add).toBeFocused()
  await add.press('Enter')
  await title.fill('Сохранено клавиатурой')
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(card(page, 'Сохранено клавиатурой')).toBeVisible()
  await expect(add).toBeFocused()
})

test('restores task action focus on cancel and keeps focus on Add after a saved move or deletion', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  const title = 'Задача с переносом даты'
  const add = page.getByRole('button', { name: 'Добавить задачу', exact: true })
  const actions = card(page, title).getByRole('button', { name: `Действия для задачи «${title}»`, exact: true })
  await createTask(page, { title })

  await taskAction(page, title, 'Редактировать')
  const edit = page.getByRole('dialog', { name: 'Редактировать задачу', exact: true })
  await edit.getByLabel('Дата', { exact: true }).fill('2026-10-08')
  await page.keyboard.press('Escape')
  await expect(edit).toHaveCount(0)
  await expect(group(page, 'Сегодня')).toContainText(title)
  await expect(actions).toBeFocused()

  await taskAction(page, title, 'Редактировать')
  await edit.getByLabel('Дата', { exact: true }).fill('2026-10-08')
  await edit.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(edit).toHaveCount(0)
  // Wait for liveQuery to move the card before checking focus: its old opener is unmounted.
  await expect(group(page, 'Предстоящие')).toContainText(title)
  await expect(group(page, 'Сегодня').locator('[data-task-id]')).toHaveCount(0)
  await expect(add).toBeFocused()

  await taskAction(page, title, 'Удалить')
  const confirmation = page.getByRole('dialog', { name: 'Удалить задачу?', exact: true })
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(actions).toBeFocused()

  await taskAction(page, title, 'Удалить')
  await confirmation.getByRole('button', { name: 'Удалить задачу', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(card(page, title)).toHaveCount(0)
  await expect(add).toBeFocused()
})

test('rejects unfinished native time without discarding it and still allows an intentionally empty time', async ({ page, browserName }) => {
  // WebKit does not expose Chromium's segmented time editor to keyboard input.
  test.skip(browserName !== 'chromium', 'Partial native time editing is reproduced with the Chromium keyboard editor.')
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true })
  const title = 'Задача с незавершённым временем'
  await fillTaskForm(dialog, { title })
  const time = dialog.getByLabel('Время необязательно', { exact: true })
  await time.focus()
  await time.press('ArrowUp')
  expect(await time.evaluate((element: HTMLInputElement) => ({ value: element.value, badInput: element.validity.badInput })))
    .toEqual({ value: '', badInput: true })
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(time).toHaveAttribute('aria-invalid', 'true')
  await expect(time).toHaveAccessibleDescription(/врем/i)
  await expect(time).toBeFocused()
  expect((await readDatabase(page)).tasks).toEqual([])
  await time.fill('18:30')
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await readDatabase(page)).tasks).toEqual([
    expect.objectContaining({ title, time: '18:30' }),
  ])

  await taskAction(page, title, 'Редактировать')
  const edit = page.getByRole('dialog', { name: 'Редактировать задачу', exact: true })
  const editedTime = edit.getByLabel('Время необязательно', { exact: true })
  await editedTime.focus()
  await editedTime.press('Home')
  await editedTime.press('Backspace')
  expect(await editedTime.evaluate((element: HTMLInputElement) => element.validity.badInput)).toBe(true)
  await edit.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(editedTime).toHaveAttribute('aria-invalid', 'true')
  expect((await readDatabase(page)).tasks[0]?.time).toBe('18:30')
  await editedTime.fill('')
  expect(await editedTime.evaluate((element: HTMLInputElement) => element.validity.badInput)).toBe(false)
  await edit.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(edit).toHaveCount(0)
  await expect.poll(async () => (await readDatabase(page)).tasks).toEqual([
    expect.objectContaining({ title, time: null }),
  ])
})

test('preserves the task form after a storage write failure and saves it once on retry', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.add
    Object.defineProperty(IDBObjectStore.prototype, 'add', {
      configurable: true,
      value(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (this.name === 'tasks' && sessionStorage.getItem('tasks-write-blocked') === 'yes') {
          throw new DOMException('Не удалось записать задачу: хранилище заполнено.', 'QuotaExceededError')
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key)
      },
    })
  })
  await openTasks(page)
  await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true })
  const values = { title: 'Сохранить после ошибки', description: 'Важный черновик\nВторая строка',
    date: '2026-10-08', time: '19:45', priority: 'high' as const }
  await fillTaskForm(dialog, values)
  await page.evaluate(() => sessionStorage.setItem('tasks-write-blocked', 'yes'))
  const save = dialog.getByRole('button', { name: 'Сохранить задачу', exact: true })
  await save.click()
  await expect(dialog.getByRole('alert')).toContainText('хранилище заполнено')
  await expect(save).toBeEnabled()
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue(values.title)
  await expect(dialog.getByLabel('Описание необязательно', { exact: true })).toHaveValue(values.description)
  await expect(dialog.getByLabel('Дата', { exact: true })).toHaveValue(values.date)
  await expect(dialog.getByLabel('Время необязательно', { exact: true })).toHaveValue(values.time)
  await expect(dialog.getByLabel('Приоритет', { exact: true })).toHaveValue(values.priority)
  expect((await readDatabase(page)).tasks).toEqual([])
  await page.evaluate(() => sessionStorage.removeItem('tasks-write-blocked'))
  await save.click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await readDatabase(page)).tasks).toEqual([
    expect.objectContaining({ ...values, status: 'active', completedAt: null }),
  ])
  await page.reload()
  await expect(card(page, values.title)).toBeVisible()
  expect((await readDatabase(page)).tasks).toHaveLength(1)
})

test('fits long task titles and descriptions at 320, 375 and 390px with touch and usable scrolled forms', async ({ page, isMobile }, testInfo) => {
  await page.clock.setFixedTime(instant)
  await openTasks(page)
  const title = 'Длинноеназваниебезпробелов'.repeat(7)
  const description = 'Описаниебезпробелов'.repeat(50) + '\nВторая строка подробного описания.'
  await createTask(page, { title, description, time: '23:59', priority: 'high' })
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const task = card(page, title)
    await expect(task).toContainText(title)
    await expect(task).toContainText('Вторая строка')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await task.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const controls = await task.getByRole('button').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
    expect(controls.length).toBeGreaterThanOrEqual(2)
    expect(controls.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    await page.screenshot({ path: `.artifacts/tasks-${testInfo.project.name}-${width}.png`, fullPage: true })
    await taskAction(page, title, 'Редактировать')
    const dialog = page.getByRole('dialog', { name: 'Редактировать задачу', exact: true })
    await expect(dialog.getByLabel('Описание необязательно', { exact: true })).toHaveValue(description)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const sizes = await dialog.locator('input, textarea, select, button').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
    expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    await page.screenshot({ path: `.artifacts/tasks-dialog-${testInfo.project.name}-${width}.png` })
    // A short viewport models the space remaining above the on-screen keyboard.
    await page.setViewportSize({ width, height: 420 })
    await dialog.getByLabel('Описание необязательно', { exact: true }).focus()
    const save = dialog.getByRole('button', { name: 'Сохранить задачу', exact: true })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeInViewport()
    if (isMobile) await save.tap()
    else await save.click()
    await expect(dialog).toHaveCount(0)
    await page.setViewportSize({ width, height: 844 })
  }
  const complete = card(page, title).getByRole('button', { name: `Выполнить задачу «${title}»`, exact: true })
  if (isMobile) await complete.tap()
  else await complete.click()
  await expect(group(page, 'Выполненные')).toContainText(title)
})

test('migrates version two without losing habit history, notes or rating settings and then stores tasks', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  const timestamp = '2026-10-01T09:00:00.000Z'
  const habits = createInitialHabits(timestamp)
  const entries = [
    { habitId: 'abstinence', date: '2026-10-05', type: 'boolean', status: 'success', note: 'Историческая заметка', createdAt: timestamp, updatedAt: timestamp },
    { habitId: 'abstinence', date: '2026-10-06', type: 'boolean', status: 'success', createdAt: timestamp, updatedAt: timestamp },
    { habitId: 'water', date: today, type: 'amount', value: 2400, note: 'Вода сохранена', createdAt: timestamp, updatedAt: timestamp },
    { habitId: 'gaming', date: today, type: 'duration', minutes: 155, note: 'Игры сохранены', createdAt: timestamp, updatedAt: timestamp },
    { habitId: 'social-media', date: today, type: 'duration', minutes: 0, createdAt: timestamp, updatedAt: timestamp },
  ]
  await page.route('**/tasks-migration-setup', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Migration setup</body></html>',
  }))
  await page.goto('/tasks-migration-setup')
  await page.evaluate(async ({ habits, entries }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik', 20)
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
    request.onsuccess = () => { request.result.close(); resolve() }
  }), { habits, entries })
  await page.goto('/')
  await expect(page.locator('[data-amount-habit-id="water"]')).toContainText(/2\s*400\s*\/\s*2\s*000\s*мл/)
  await expect(page.locator('[data-duration-habit-id="gaming"] .duration-total')).toHaveText('2 ч 35 мин')
  await expect(page.locator('[data-duration-habit-id="social-media"] .duration-total')).toHaveText('0 ч 0 мин')
  const migrated = await readDatabase(page)
  expect(migrated.version).toBe(40)
  expect(migrated.stores.sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks'])
  expect(migrated.indexes.sort()).toEqual(['date', 'goalId', 'status'])
  expect(migrated.habits).toEqual(expect.arrayContaining(habits))
  expect(migrated.habits).toHaveLength(habits.length)
  expect(migrated.entries).toEqual(expect.arrayContaining(entries))
  expect(migrated.entries).toHaveLength(entries.length)
  expect(migrated.tasks).toEqual([])
  await navigate(page, 'Календарь')
  await page.locator('[data-calendar-date="2026-10-06"]').click()
  const streak = page.locator('.day-streak-row').filter({ has: page.getByRole('heading', { name: 'Воздержание', exact: true }) })
  await expect(streak).toContainText('2 дн.')
  await page.locator('[data-calendar-date="2026-10-05"]').click()
  await expect(page.getByRole('textbox', { name: 'Заметка', exact: true })).toHaveValue('Историческая заметка')
  await navigate(page, 'Задачи')
  await createTask(page, { title: 'Задача после миграции' })
  await page.reload()
  await expect(card(page, 'Задача после миграции')).toBeVisible()
  expect((await readDatabase(page)).entries).toEqual(expect.arrayContaining(entries))
})

test('recovers the Tasks page after IndexedDB access is restored', async ({ page }) => {
  await page.clock.setFixedTime(instant)
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open
    Object.defineProperty(IDBFactory.prototype, 'open', {
      configurable: true,
      value(this: IDBFactory, name: string, version?: number) {
        if (sessionStorage.getItem('tasks-storage-allowed') !== 'yes') throw new DOMException('Storage access denied for this test', 'SecurityError')
        return version === undefined ? original.call(this, name) : original.call(this, name, version)
      },
    })
  })
  await page.goto('/#tasks')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('tasks-storage-allowed', 'yes'))
  await page.getByRole('button', { name: /Повторить/, exact: false }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await createTask(page, { title: 'После восстановления хранилища' })
  expect((await readDatabase(page)).tasks).toHaveLength(1)
})
