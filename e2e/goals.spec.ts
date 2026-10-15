import { expect, test, type Locator, type Page } from '@playwright/test'
import { createInitialHabits } from '../src/db/seed'
import type { Goal, GoalMilestone } from '../src/models/goal'
import type { Habit } from '../src/models/habit'
import type { HabitEntry } from '../src/models/habit-entry'
import type { Task } from '../src/models/task'

const instant = new Date('2026-10-15T09:00:00Z')
const today = '2026-10-15'
const errorsByPage = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  errorsByPage.set(page, errors)
  await page.clock.setFixedTime(instant)
})

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page)).toEqual([])
})

interface GoalValues {
  title: string
  description?: string
  deadline?: string
  mode?: 'auto' | 'manual'
  progress?: string
}

interface MilestoneValues {
  title: string
  type?: 'boolean' | 'amount'
  current?: string
  target?: string
}

function goalCard(page: Page, title: string) {
  return page.locator('[data-goal-id]').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

function milestone(page: Page, title: string) {
  return page.locator('[data-milestone-id]').filter({ hasText: title })
}

async function openGoals(page: Page) {
  await page.goto('/#goals')
  await expect(page.getByRole('heading', { name: 'Цели', level: 1, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Добавить цель', exact: true })).toBeEnabled()
}

async function fillGoal(dialog: Locator, values: GoalValues) {
  await dialog.getByLabel('Название', { exact: true }).fill(values.title)
  if (values.description !== undefined) await dialog.getByLabel(/^Описание/).fill(values.description)
  if (values.deadline !== undefined) await dialog.getByLabel(/^Дедлайн/).fill(values.deadline)
  if (values.mode !== undefined) await dialog.getByLabel('Режим прогресса', { exact: true }).selectOption(values.mode)
  if (values.progress !== undefined) await dialog.getByLabel(/^Ручной прогресс/).fill(values.progress)
}

async function createGoal(page: Page, values: GoalValues) {
  await page.getByRole('button', { name: 'Добавить цель', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая цель', exact: true })
  await fillGoal(dialog, values)
  await dialog.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/#goals\?id=/)
  await expect(page.getByRole('heading', { name: values.title.trim(), exact: true })).toBeVisible()
}

async function fillMilestone(dialog: Locator, values: MilestoneValues) {
  await dialog.getByLabel('Название этапа', { exact: true }).fill(values.title)
  if (values.type !== undefined) await dialog.getByLabel('Тип этапа', { exact: true }).selectOption(values.type)
  if (values.current !== undefined) await dialog.getByLabel('Текущее значение', { exact: true }).fill(values.current)
  if (values.target !== undefined) await dialog.getByLabel('Целевое значение', { exact: true }).fill(values.target)
}

async function addMilestone(page: Page, values: MilestoneValues) {
  await page.getByRole('button', { name: 'Добавить этап', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новый этап', exact: true })
  await fillMilestone(dialog, values)
  await dialog.getByRole('button', { name: 'Сохранить этап', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(milestone(page, values.title)).toBeVisible()
}

async function editMilestone(page: Page, originalTitle: string, values: MilestoneValues) {
  await page.getByRole('button', { name: `Редактировать этап «${originalTitle}»`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Редактировать этап', exact: true })
  await fillMilestone(dialog, values)
  await dialog.getByRole('button', { name: 'Сохранить этап', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function expectProgress(page: Page, progress: number) {
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', String(progress))
}

async function readDatabase(page: Page) {
  return page.evaluate(async () => new Promise<{
    goals: Goal[]; milestones: GoalMilestone[]; tasks: Task[]; habits: Habit[]; entries: HabitEntry[]
    version: number; stores: string[]
  }>((resolve, reject) => {
    const request = indexedDB.open('zadachnik')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(['goals', 'goalMilestones', 'tasks', 'habits', 'habitEntries'], 'readonly')
      const goals = transaction.objectStore('goals').getAll()
      const milestones = transaction.objectStore('goalMilestones').getAll()
      const tasks = transaction.objectStore('tasks').getAll()
      const habits = transaction.objectStore('habits').getAll()
      const entries = transaction.objectStore('habitEntries').getAll()
      transaction.oncomplete = () => {
        const result = {
          goals: goals.result as Goal[], milestones: milestones.result as GoalMilestone[],
          tasks: tasks.result as Task[], habits: habits.result as Habit[], entries: entries.result as HabitEntry[],
          version: database.version, stores: Array.from(database.objectStoreNames),
        }
        database.close()
        resolve(result)
      }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    }
  }))
}

async function createTask(page: Page, title: string) {
  await page.goto('/#tasks')
  await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true })
  await dialog.getByLabel('Название', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
}

async function linkTask(page: Page, taskId: string) {
  await page.getByRole('button', { name: 'Привязать задачу', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Привязать задачу', exact: true })
  await dialog.getByLabel('Задача', { exact: true }).selectOption(taskId)
  await dialog.getByRole('button', { name: 'Привязать', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test('computes equal-weight milestone progress, preserves order and supports editing, toggling and deleting the last milestone', async ({ page }, testInfo) => {
  await openGoals(page)
  await createGoal(page, { title: '  Освоить новую профессию  ', description: 'Большая цель\nНесколько измеримых шагов' })
  await expectProgress(page, 0)
  await expect(page.getByText('Без дедлайна', { exact: true })).toBeVisible()
  expect((await readDatabase(page)).goals).toEqual([
    expect.objectContaining({ title: 'Освоить новую профессию', description: 'Большая цель\nНесколько измеримых шагов',
      deadline: null, status: 'active', progressMode: 'auto', manualProgress: 0, archived: false, createdAt: instant.toISOString() }),
  ])
  await addMilestone(page, { title: 'Сделать резюме' })
  await addMilestone(page, { title: 'Отправить отклики', type: 'amount', current: '10', target: '20' })
  await expectProgress(page, 25)
  await page.getByRole('button', { name: 'Выполнить этап «Сделать резюме»', exact: true }).click()
  await expectProgress(page, 75)
  // Safari pointer clicks may retain focus on <main>; the skip link must stay offscreen.
  const skipLink = page.getByRole('link', { name: 'Перейти к содержимому', exact: true })
  await expect(skipLink).not.toBeFocused()
  expect(await skipLink.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(0)
  await page.screenshot({ path: `.artifacts/goals-detail-${testInfo.project.name}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Редактировать цель', exact: true }).click()
  const goalDialog = page.getByRole('dialog', { name: 'Редактировать цель', exact: true })
  await page.screenshot({ path: `.artifacts/goals-dialog-${testInfo.project.name}.png` })
  await goalDialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await editMilestone(page, 'Сделать резюме', { title: 'Подготовить резюме' })
  await expect(page.getByRole('button', { name: 'Все цели', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Вернуть этап «Подготовить резюме» в работу', exact: true }).click()
  await expectProgress(page, 25)
  await editMilestone(page, 'Отправить отклики', { title: 'Отправить отклики', current: '25' })
  await expectProgress(page, 50)
  await expect(milestone(page, 'Отправить отклики')).toContainText(/25\s*\/\s*20/)
  const beforeReload = (await readDatabase(page)).milestones.sort((left, right) => left.order - right.order)
  expect(beforeReload.map((item) => item.title)).toEqual(['Подготовить резюме', 'Отправить отклики'])
  expect(beforeReload[1]).toMatchObject({ type: 'amount', current: 25, target: 20 })
  await page.reload()
  await expectProgress(page, 50)
  expect((await readDatabase(page)).milestones.sort((left, right) => left.order - right.order)).toEqual(beforeReload)
  await page.getByRole('button', { name: 'Выполнить этап «Подготовить резюме»', exact: true }).click()
  await expectProgress(page, 100)
  // Reaching 100% does not silently replace the user's chosen lifecycle status.
  await expect(page.getByLabel('Статус цели', { exact: true })).toHaveValue('active')
  for (const title of ['Подготовить резюме', 'Отправить отклики']) {
    await page.getByRole('button', { name: `Удалить этап «${title}»`, exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Удалить этап?', exact: true })
    await confirmation.getByRole('button', { name: 'Удалить этап', exact: true }).click()
    await expect(milestone(page, title)).toHaveCount(0)
  }
  await expectProgress(page, 0)
  expect((await readDatabase(page)).milestones).toEqual([])
})

test('links the existing task, navigates both ways, persists data and clears relationships while retaining the task on goal deletion', async ({ page }) => {
  const taskTitle = 'Позвонить наставнику'
  const goalTitle = 'Найти работу'
  await createTask(page, taskTitle)
  const task = (await readDatabase(page)).tasks[0]!
  await openGoals(page)
  await createGoal(page, { title: goalTitle, deadline: '2026-12-31' })
  await addMilestone(page, { title: 'Собрать портфолио' })
  const goal = (await readDatabase(page)).goals[0]!
  await linkTask(page, task.id)
  await expect.poll(async () => (await readDatabase(page)).tasks[0]?.goalId).toBe(goal.id)
  await page.getByRole('link', { name: taskTitle, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#tasks\\?task=${task.id}$`))
  const taskCard = page.locator(`[data-task-id="${task.id}"]`)
  await expect(taskCard).toBeVisible()
  await taskCard.getByRole('link', { name: 'Перейти к цели', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#goals\\?id=${goal.id}$`))
  await page.getByRole('button', { name: `Отвязать задачу «${taskTitle}»`, exact: true }).click()
  await expect(page.getByRole('link', { name: taskTitle, exact: true })).toHaveCount(0)
  await expect.poll(async () => (await readDatabase(page)).tasks[0]?.goalId).toBeUndefined()
  await linkTask(page, task.id)
  await page.reload()
  await expect(page.getByRole('heading', { name: goalTitle, exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: taskTitle, exact: true })).toBeVisible()
  await expect(milestone(page, 'Собрать портфолио')).toBeVisible()
  await expect(page.getByText(/31 декабря 2026/)).toBeVisible()
  await page.getByLabel('Статус цели', { exact: true }).selectOption('completed')
  await expect.poll(async () => (await readDatabase(page)).goals[0]?.status).toBe('completed')
  await page.reload()
  await expect(page.getByLabel('Статус цели', { exact: true })).toHaveValue('completed')
  await page.getByRole('button', { name: 'Удалить цель', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Удалить цель?', exact: true })
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await readDatabase(page)).goals).toHaveLength(1)
  await page.getByRole('button', { name: 'Удалить цель', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Удалить цель', exact: true }).click()
  await expect(page).toHaveURL(/#goals$/)
  const afterDeletion = await readDatabase(page)
  expect(afterDeletion.goals).toEqual([])
  expect(afterDeletion.milestones).toEqual([])
  expect(afterDeletion.tasks).toEqual([task])
  await page.goto('/#tasks')
  await expect(page.locator(`[data-task-id="${task.id}"]`)).toContainText(taskTitle)
  await expect(page.getByRole('link', { name: 'Перейти к цели', exact: true })).toHaveCount(0)
})

test('supports manual progress, overdue deadlines, all lifecycle statuses and reversible archiving', async ({ page }) => {
  await openGoals(page)
  await createGoal(page, { title: 'Закончить исследование', deadline: '2026-10-14', mode: 'manual', progress: '35' })
  await expectProgress(page, 35)
  await expect(page.getByText('Просрочена', { exact: true })).toBeVisible()
  await addMilestone(page, { title: 'Промежуточный результат' })
  await page.getByRole('button', { name: 'Выполнить этап «Промежуточный результат»', exact: true }).click()
  await expectProgress(page, 35)
  for (const status of ['completed', 'failed', 'cancelled', 'active']) {
    await page.getByLabel('Статус цели', { exact: true }).selectOption(status)
    await expect.poll(async () => (await readDatabase(page)).goals[0]?.status).toBe(status)
    await expectProgress(page, 35)
  }
  await page.getByRole('button', { name: 'Редактировать цель', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Редактировать цель', exact: true })
  await fillGoal(edit, { title: 'Исследование без срока', deadline: '', progress: '67' })
  await edit.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expectProgress(page, 67)
  await expect(page.getByText('Без дедлайна', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'В архив', exact: true }).click()
  await expect.poll(async () => (await readDatabase(page)).goals[0]?.archived).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Вернуть из архива', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть из архива', exact: true }).click()
  await expect.poll(async () => (await readDatabase(page)).goals[0]?.archived).toBe(false)
  await page.getByRole('button', { name: 'Редактировать цель', exact: true }).click()
  await edit.getByLabel('Режим прогресса', { exact: true }).selectOption('auto')
  await edit.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expectProgress(page, 100)
  await page.goto('/#goals')
  await expect(goalCard(page, 'Исследование без срока')).toBeVisible()
  await expect(goalCard(page, 'Исследование без срока').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
})

test('updates goal details and progress in another tab through liveQuery', async ({ page, context }) => {
  await openGoals(page)
  await createGoal(page, { title: 'Общая цель в двух вкладках' })
  await addMilestone(page, { title: 'Проверить синхронизацию' })
  const goalUrl = page.url()
  const other = await context.newPage()
  const errors: string[] = []
  other.on('pageerror', (error) => errors.push(error.message))
  await other.clock.setFixedTime(instant)
  await other.goto(goalUrl)
  await expectProgress(other, 0)
  await page.getByRole('button', { name: 'Выполнить этап «Проверить синхронизацию»', exact: true }).click()
  await expectProgress(other, 100)
  await addMilestone(other, { title: 'Числовой результат', type: 'amount', current: '2', target: '4' })
  await expectProgress(page, 75)
  await expect(milestone(page, 'Числовой результат')).toBeVisible()
  await editMilestone(page, 'Числовой результат', { title: 'Уточнённый результат', current: '4' })
  await expect(milestone(other, 'Уточнённый результат')).toBeVisible()
  await expectProgress(other, 100)
  await other.getByLabel('Статус цели', { exact: true }).selectOption('completed')
  await expect(page.getByLabel('Статус цели', { exact: true })).toHaveValue('completed')
  expect(errors).toEqual([])
  await other.close()
})

test('validates goal and numeric milestone drafts, traps keyboard focus and restores it after cancellation', async ({ page }) => {
  await openGoals(page)
  const add = page.getByRole('button', { name: 'Добавить цель', exact: true })
  await add.click()
  const dialog = page.getByRole('dialog', { name: 'Новая цель', exact: true })
  const title = dialog.getByLabel('Название', { exact: true })
  await expect(title).toBeFocused()
  await title.fill('   ')
  await dialog.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAccessibleDescription(/название цели/i)
  expect((await readDatabase(page)).goals).toEqual([])
  await fillGoal(dialog, { title: 'Проверка формы', mode: 'manual', progress: '101' })
  await dialog.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel(/^Ручной прогресс/)).toHaveAttribute('aria-invalid', 'true')
  expect((await readDatabase(page)).goals).toEqual([])
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press(key)
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(add).toBeFocused()
  await add.click()
  await fillGoal(dialog, { title: 'Проверка этапов', mode: 'manual', progress: '101' })
  await dialog.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(dialog.getByLabel(/^Ручной прогресс/)).toHaveAttribute('aria-invalid', 'true')
  await dialog.getByLabel('Режим прогресса', { exact: true }).selectOption('auto')
  await dialog.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Проверка этапов', exact: true })).toBeVisible()
  await expectProgress(page, 0)
  await page.getByRole('button', { name: 'Добавить этап', exact: true }).click()
  const stage = page.getByRole('dialog', { name: 'Новый этап', exact: true })
  await fillMilestone(stage, { title: 'Неверные границы', type: 'amount', current: '-1', target: '0' })
  await stage.getByRole('button', { name: 'Сохранить этап', exact: true }).click()
  await expect(stage.getByRole('alert')).toHaveCount(2)
  await expect(stage.getByLabel('Текущее значение', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(stage.getByLabel('Текущее значение', { exact: true })).toHaveAccessibleDescription(/нуля|неотрицательное/i)
  expect((await readDatabase(page)).milestones).toEqual([])
  await stage.getByLabel('Текущее значение', { exact: true }).fill('0')
  await stage.getByRole('button', { name: 'Сохранить этап', exact: true }).click()
  await expect(stage.getByLabel('Целевое значение', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(stage.getByLabel('Целевое значение', { exact: true })).toHaveAccessibleDescription(/нуля/i)
  await fillMilestone(stage, { title: 'Корректный ноль', current: '0', target: '10' })
  await stage.getByRole('button', { name: 'Сохранить этап', exact: true }).click()
  await expect(stage).toHaveCount(0)
  await expectProgress(page, 0)
  expect((await readDatabase(page)).milestones).toEqual([
    expect.objectContaining({ type: 'amount', current: 0, target: 10 }),
  ])
})

test('preserves goal and milestone form values after failed writes and saves each record exactly once on retry', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.add
    Object.defineProperty(IDBObjectStore.prototype, 'add', {
      configurable: true,
      value(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (['goals', 'goalMilestones'].includes(this.name) && sessionStorage.getItem('goal-write-blocked') === 'yes') {
          throw new DOMException('Не удалось записать данные: хранилище заполнено.', 'QuotaExceededError')
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key)
      },
    })
  })
  await openGoals(page)
  await page.getByRole('button', { name: 'Добавить цель', exact: true }).click()
  const goalDialog = page.getByRole('dialog', { name: 'Новая цель', exact: true })
  await fillGoal(goalDialog, { title: 'Не потерять черновик', description: 'Первая строка\nВторая строка', deadline: '2026-12-31', mode: 'manual', progress: '42' })
  await page.evaluate(() => sessionStorage.setItem('goal-write-blocked', 'yes'))
  await goalDialog.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(goalDialog.getByRole('alert')).toContainText('хранилище заполнено')
  await expect(goalDialog.getByLabel('Название', { exact: true })).toHaveValue('Не потерять черновик')
  await expect(goalDialog.getByLabel(/^Описание/)).toHaveValue('Первая строка\nВторая строка')
  await expect(goalDialog.getByLabel(/^Дедлайн/)).toHaveValue('2026-12-31')
  await expect(goalDialog.getByLabel(/^Ручной прогресс/)).toHaveValue('42')
  expect((await readDatabase(page)).goals).toEqual([])
  await page.evaluate(() => sessionStorage.removeItem('goal-write-blocked'))
  await goalDialog.getByRole('button', { name: 'Сохранить цель', exact: true }).click()
  await expect(goalDialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Добавить этап', exact: true }).click()
  const stage = page.getByRole('dialog', { name: 'Новый этап', exact: true })
  await fillMilestone(stage, { title: 'Сохранить числовой этап', type: 'amount', current: '7', target: '12' })
  await page.evaluate(() => sessionStorage.setItem('goal-write-blocked', 'yes'))
  await stage.getByRole('button', { name: 'Сохранить этап', exact: true }).click()
  await expect(stage.getByRole('alert')).toContainText('хранилище заполнено')
  await expect(stage.getByLabel('Название этапа', { exact: true })).toHaveValue('Сохранить числовой этап')
  await expect(stage.getByLabel('Текущее значение', { exact: true })).toHaveValue('7')
  await expect(stage.getByLabel('Целевое значение', { exact: true })).toHaveValue('12')
  expect((await readDatabase(page)).milestones).toEqual([])
  await page.evaluate(() => sessionStorage.removeItem('goal-write-blocked'))
  await stage.getByRole('button', { name: 'Сохранить этап', exact: true }).click()
  await expect(stage).toHaveCount(0)
  await page.reload()
  await expect(milestone(page, 'Сохранить числовой этап')).toBeVisible()
  const saved = await readDatabase(page)
  expect(saved.goals).toHaveLength(1)
  expect(saved.milestones).toHaveLength(1)
})

test('fits long goal and milestone text at 320, 375 and 390px with touch controls and forms above the keyboard', async ({ page, isMobile }, testInfo) => {
  await openGoals(page)
  const title = 'Длинноеназваниецелибезпробелов'.repeat(6)
  const stageTitle = 'Оченьдлинноеназваниеэтапабезпробелов'.repeat(5)
  const description = 'Подробноеописаниебезпробелов'.repeat(30) + '\nСледующая строка.'
  await createGoal(page, { title, description, deadline: '2026-12-31' })
  await addMilestone(page, { title: stageTitle })
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(milestone(page, stageTitle)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const sizes = await page.locator('main button, main select, main a').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }).filter((size) => size.width > 0 && size.height > 0))
    expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    await page.screenshot({ path: `.artifacts/goals-detail-${testInfo.project.name}-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Редактировать цель', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Редактировать цель', exact: true })
    await expect(dialog.getByLabel(/^Описание/)).toHaveValue(description)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const formSizes = await dialog.locator('input, textarea, select, button').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
    expect(formSizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    await page.screenshot({ path: `.artifacts/goals-dialog-${testInfo.project.name}-${width}.png` })
    await page.setViewportSize({ width, height: 420 })
    await dialog.getByLabel(/^Описание/).focus()
    const save = dialog.getByRole('button', { name: 'Сохранить цель', exact: true })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeInViewport()
    if (isMobile) await save.tap()
    else await save.click()
    await expect(dialog).toHaveCount(0)
    await page.setViewportSize({ width, height: 844 })
  }
  const complete = page.getByRole('button', { name: `Выполнить этап «${stageTitle}»`, exact: true })
  if (isMobile) await complete.tap()
  else await complete.click()
  await expectProgress(page, 100)
})

test('upgrades native version 30 preserving active and completed tasks, habit history and settings before linking a migrated task', async ({ page }) => {
  const timestamp = '2026-10-01T09:00:00.000Z'
  const habits = createInitialHabits(timestamp)
  const entries = [
    { habitId: 'abstinence', date: today, type: 'boolean', status: 'success', note: 'История до целей', createdAt: timestamp, updatedAt: timestamp },
    { habitId: 'water', date: today, type: 'amount', value: 2400, createdAt: timestamp, updatedAt: timestamp },
  ]
  const tasks = [
    { id: 'legacy-active', title: 'Старая активная задача', description: 'Сохранить полностью', date: today, time: '18:30', priority: 'high', status: 'active', createdAt: timestamp, updatedAt: timestamp, completedAt: null },
    { id: 'legacy-completed', title: 'Старая завершённая задача', description: '', date: '2026-10-01', time: null, priority: 'low', status: 'completed', createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp },
  ]
  await page.route('**/goals-migration-setup', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Migration setup</body></html>',
  }))
  await page.goto('/goals-migration-setup')
  await page.evaluate(async ({ habits, entries, tasks }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zadachnik', 30)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      const habitStore = database.createObjectStore('habits', { keyPath: 'id' })
      habitStore.createIndex('type', 'type')
      habitStore.createIndex('order', 'order')
      const entryStore = database.createObjectStore('habitEntries', { keyPath: ['habitId', 'date'] })
      for (const index of ['habitId', 'date', 'type']) entryStore.createIndex(index, index)
      const taskStore = database.createObjectStore('tasks', { keyPath: 'id' })
      for (const index of ['date', 'status']) taskStore.createIndex(index, index)
      for (const habit of habits) habitStore.put(habit)
      for (const entry of entries) entryStore.put(entry)
      for (const task of tasks) taskStore.put(task)
    }
    request.onsuccess = () => { request.result.close(); resolve() }
  }), { habits, entries, tasks })
  await openGoals(page)
  const migrated = await readDatabase(page)
  expect(migrated.version).toBe(40)
  expect(migrated.stores.sort()).toEqual(['goalMilestones', 'goals', 'habitEntries', 'habits', 'tasks'])
  expect(migrated.tasks).toEqual(tasks)
  expect(migrated.tasks.every((task) => !Object.hasOwn(task, 'goalId'))).toBe(true)
  expect(migrated.habits).toHaveLength(habits.length)
  expect(migrated.habits).toEqual(expect.arrayContaining(habits))
  expect(migrated.entries).toHaveLength(entries.length)
  expect(migrated.entries).toEqual(expect.arrayContaining(entries))
  expect(migrated.goals).toEqual([])
  expect(migrated.milestones).toEqual([])
  await createGoal(page, { title: 'Цель после обновления' })
  await linkTask(page, 'legacy-active')
  await page.reload()
  await expect(page.getByRole('link', { name: 'Старая активная задача', exact: true })).toBeVisible()
  const saved = await readDatabase(page)
  expect(saved.entries).toEqual(expect.arrayContaining(entries))
  expect(saved.tasks.find((task) => task.id === 'legacy-active')).toMatchObject({ ...tasks[0], updatedAt: instant.toISOString(), goalId: saved.goals[0]?.id })
  expect(saved.tasks.find((task) => task.id === 'legacy-completed')).toEqual(tasks[1])
})
