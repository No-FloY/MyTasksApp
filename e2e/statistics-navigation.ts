import { expect, type Page } from '@playwright/test'

export type StatisticsSection = 'Обзор' | 'Привычки' | 'Питание' | 'Тренировка' | 'Экранное время' | 'Задачи' | 'Цели'

export async function selectStatisticsSection(page: Page, name: StatisticsSection) {
  const tab = page.getByRole('tab', { name, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

export async function selectStatisticsPeriod(page: Page, preset: string) {
  const primary: Record<string, string> = { day: 'День', week: 'Неделя', month: 'Месяц' }
  if (primary[preset]) await page.getByRole('button', { name: primary[preset], exact: true }).click()
  else await page.getByLabel('Другой период', { exact: true }).selectOption(preset)
}
