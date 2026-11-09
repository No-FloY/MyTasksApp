import { describe, expect, it } from 'vitest'
import { getStatisticsSection, getStatisticsSectionLink } from './statistics-navigation'

describe('statistics section navigation', () => {
  it('opens the overview for missing or invalid sections', () => {
    expect(getStatisticsSection(null)).toBe('overview')
    expect(getStatisticsSection('unknown')).toBe('overview')
    expect(getStatisticsSection('screen-time')).toBe('screen-time')
  })

  it('preserves the selected day when opening and leaving a detail section', () => {
    const details = getStatisticsSectionLink('#statistics?period=day&date=2026-10-22', 'nutrition')
    expect(details).toBe('#statistics?period=day&date=2026-10-22&section=nutrition')
    expect(getStatisticsSectionLink(details, 'overview')).toBe('#statistics?period=day&date=2026-10-22')
  })

  it('keeps both custom boundaries and avoids accumulating section parameters', () => {
    const hash = '#statistics?period=custom&from=2026-09-08&to=2026-10-11&section=habits'
    const target = getStatisticsSectionLink(hash, 'goals')
    const params = new URLSearchParams(target.split('?')[1])
    expect(Object.fromEntries(params)).toEqual({ period: 'custom', from: '2026-09-08', to: '2026-10-11', section: 'goals' })
    expect(params.getAll('section')).toEqual(['goals'])
    expect(getStatisticsSectionLink('#statistics', 'overview')).toBe('#statistics')
  })
})
