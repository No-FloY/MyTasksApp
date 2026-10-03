import { expect, test, type Locator, type Page } from '@playwright/test'
import type { HabitEntry } from '../src/models/habit-entry'

function waterCard(page: Page) {
  return page.locator('[data-amount-habit-id="water"]')
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

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function expectAmount(card: Locator, value: number, percent: number) {
  const formattedValue = new Intl.NumberFormat('ru-RU').format(value).replace(/\s/g, '\\s*')
  await expect(card).toContainText(new RegExp(`${formattedValue}\\s*/\\s*2\\s*000\\s*мл`))
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(percent))
}

async function addCustom(card: Locator, value: string) {
  await card.getByRole('textbox', { name: 'Сколько добавить, мл', exact: true }).fill(value)
  await card.getByRole('button', { name: 'Добавить', exact: true }).click()
}

test('adds quick and custom amounts, reaches success, and preserves over-target water after reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'))
  await page.goto('/')
  const card = waterCard(page)
  await expectAmount(card, 0, 0)
  // Opening the tracker must not create a failed entry for an unrecorded day.
  expect(await readEntries(page)).toEqual([])

  await card.getByRole('button', { name: '+200 мл', exact: true }).click()
  await expectAmount(card, 200, 10)
  await card.getByRole('button', { name: '+400 мл', exact: true }).click()
  await expectAmount(card, 600, 30)
  await addCustom(card, '150')
  await expectAmount(card, 750, 37.5)
  await addCustom(card, '330')
  await expectAmount(card, 1080, 54)
  await expect(card.getByText('Цель достигнута', { exact: true })).toHaveCount(0)
  await addCustom(card, '920')
  await expectAmount(card, 2000, 100)
  await expect(card.getByText('Цель достигнута', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: '+400 мл', exact: true }).click()
  await expectAmount(card, 2400, 100)
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'water', date: '2026-10-02', type: 'amount', value: 2400 }),
  ])

  await page.reload()
  await expectAmount(card, 2400, 100)
  await expect(card.getByText('Цель достигнута', { exact: true })).toBeVisible()
  expect(await readEntries(page)).toHaveLength(1)
  expect(errors).toEqual([])
})

test('shows a quarter and half of the daily target in the progress bar', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const card = waterCard(page)
  await addCustom(card, '500')
  await expectAmount(card, 500, 25)
  await addCustom(card, '500')
  await expectAmount(card, 1000, 50)
  await expect(card.getByText('Цель достигнута', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('rejects invalid amounts without writing a record and accepts a corrected amount', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const card = waterCard(page)
  for (const value of ['', '0', '-1', '1.5', '1e3', '9007199254740992']) {
    await addCustom(card, value)
    await expect(card.getByRole('alert')).toBeVisible()
    await expectAmount(card, 0, 0)
    expect(await readEntries(page)).toEqual([])
  }

  await addCustom(card, '330')
  await expectAmount(card, 330, 16.5)
  await expect(card.getByRole('alert')).toHaveCount(0)
  expect(await readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'water', type: 'amount', value: 330 }),
  ])
  expect(errors).toEqual([])
})

test('resets the visible amount at local midnight while preserving the previous day', async ({ page }) => {
  const errors = watchErrors(page)
  await page.clock.install({ time: new Date('2026-10-01T20:50:00Z') })
  await page.goto('/')
  const card = waterCard(page)
  await card.getByRole('button', { name: '+200 мл', exact: true }).click()
  await expectAmount(card, 200, 10)

  await page.clock.pauseAt(new Date('2026-10-01T20:59:50Z'))
  await page.clock.fastForward(20_000)
  // Resume Dexie's scheduled delivery after the timer switches the local day.
  await page.clock.resume()
  await expectAmount(card, 0, 0)
  await card.getByRole('button', { name: '+400 мл', exact: true }).click()
  await expectAmount(card, 400, 20)
  await expect.poll(async () => readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'water', date: '2026-10-01', type: 'amount', value: 200 }),
    expect.objectContaining({ habitId: 'water', date: '2026-10-02', type: 'amount', value: 400 }),
  ])
  expect(errors).toEqual([])
})

test('accumulates additions made in separate tabs and updates both views', async ({ page, context }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const otherPage = await context.newPage()
  const otherErrors = watchErrors(otherPage)
  await otherPage.goto('/')
  await expectAmount(waterCard(page), 0, 0)
  await expectAmount(waterCard(otherPage), 0, 0)

  await Promise.all([
    waterCard(page).getByRole('button', { name: '+200 мл', exact: true }).click(),
    waterCard(otherPage).getByRole('button', { name: '+400 мл', exact: true }).click(),
  ])
  await expectAmount(waterCard(page), 600, 30)
  await expectAmount(waterCard(otherPage), 600, 30)
  expect(await readEntries(page)).toEqual([
    expect.objectContaining({ habitId: 'water', type: 'amount', value: 600 }),
  ])
  expect([...errors, ...otherErrors]).toEqual([])
  await otherPage.close()
})

test('fits 320, 375 and 390px screens with accessible touch controls', async ({ page, isMobile }, testInfo) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const card = waterCard(page)
  await expectAmount(card, 0, 0)

  for (const [index, width] of [320, 375, 390].entries()) {
    await page.setViewportSize({ width, height: 844 })
    const sizes = await card.locator('button, input').evaluateAll((elements) =>
      elements.map((element) => {
        const rectangle = element.getBoundingClientRect()
        return { width: rectangle.width, height: rectangle.height }
      }),
    )
    expect(sizes.length).toBeGreaterThanOrEqual(4)
    expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)

    const quickAdd = card.getByRole('button', { name: '+200 мл', exact: true })
    if (isMobile) await quickAdd.tap()
    else await quickAdd.click()
    await expectAmount(card, (index + 1) * 200, (index + 1) * 10)
    await page.screenshot({ path: `.artifacts/water-${testInfo.project.name}-${width}.png`, fullPage: true })
  }

  await card.getByRole('textbox', { name: 'Сколько добавить, мл', exact: true }).fill('330')
  const add = card.getByRole('button', { name: 'Добавить', exact: true })
  if (isMobile) await add.tap()
  else await add.click()
  await expectAmount(card, 930, 46.5)
  expect(errors).toEqual([])
})
