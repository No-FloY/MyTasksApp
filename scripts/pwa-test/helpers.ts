import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import { createInitialHabits } from '../../src/db/seed'
import { isLocalDate } from '../../src/lib/local-date'
import type { BackupData, BackupSnapshot } from '../../src/models/backup'

export const instant = new Date('2026-10-23T09:00:00.000Z')
export const date = '2026-10-23'

export function fixture(): BackupData {
  if (!isLocalDate(date)) throw new Error('Invalid fixture date')
  const stamps = { createdAt: '2026-10-01T09:00:00.000Z', updatedAt: instant.toISOString() }
  const habits = createInitialHabits(stamps.createdAt)
  const water = habits.find((habit) => habit.id === 'water')
  if (water?.type !== 'amount') throw new Error('Missing water fixture')
  water.target = 2400
  return {
    habits,
    habitEntries: [
      { ...stamps, habitId: 'english', date, type: 'boolean', status: 'success', note: 'Сохранить при обновлении PWA' },
      { ...stamps, habitId: 'water', date, type: 'amount', value: 600 },
      { ...stamps, habitId: 'gaming', date, type: 'duration', minutes: 120 },
    ],
    tasks: [{ ...stamps, id: 'pwa-task', title: 'Сохранённая задача', description: 'Локальная задача PWA', date,
      time: null, priority: 'medium', status: 'active', completedAt: null, goalId: 'pwa-goal' }],
    goals: [{ ...stamps, id: 'pwa-goal', title: 'Сохранённая цель', description: 'Данные остаются локальными', deadline: null,
      status: 'active', progressMode: 'auto', manualProgress: 0, archived: false }],
    goalMilestones: [{ ...stamps, id: 'pwa-milestone', goalId: 'pwa-goal', title: 'Сохранённый этап', order: 0,
      type: 'amount', current: 2, target: 5 }],
  }
}

export async function seed(page: Page) {
  await page.goto('/#today')
  await expect(page.locator('[data-amount-habit-id="water"]')).toBeVisible()
  // Every caller owns an isolated Playwright context, never the user's browser profile.
  await page.evaluate((data) => new Promise<void>((resolve, reject) => {
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
  }), fixture())
  await page.reload()
  await expect(page.locator('[data-amount-habit-id="water"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
}

export async function readDatabase(page: Page): Promise<BackupData> {
  return page.evaluate(() => new Promise<BackupData>((resolve, reject) => {
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

export async function waitForServiceWorker(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return registration?.active?.state
  }), { message: 'Production service worker must activate', timeout: 30_000 }).toBe('activated')
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
    message: 'The real service worker must control this page', timeout: 15_000,
  }).toBe(true)
}

export async function downloadBackup(page: Page) {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать резервную копию', exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('zadachnik-backup-2026-10-23.json')
  const path = await download.path()
  if (!path) throw new Error('Backup download unavailable')
  return JSON.parse(await readFile(path, 'utf8')) as BackupSnapshot
}

export async function restoreBackup(page: Page, snapshot: BackupSnapshot) {
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({
    name: 'pwa-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)),
  })
  await expect(page.getByRole('region', { name: 'Предпросмотр резервной копии', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить импорт', exact: true }).click()
  await page.getByRole('dialog', { name: 'Заменить текущие данные?', exact: true })
    .getByRole('button', { name: 'Заменить данные', exact: true }).click()
  await expect(page.getByText('Данные успешно восстановлены.', { exact: true })).toBeVisible()
}

export async function expectNoOverflow(page: Page) {
  // ResizeObserver-driven charts may need one frame after a viewport change.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
}
