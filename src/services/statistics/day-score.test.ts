import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialHabits } from '../../db/seed'
import { getInitialDurationRanges } from '../../db/duration-defaults'
import { isLocalDate, type LocalDate } from '../../lib/local-date'
import type { AmountHabit, BooleanHabit, DurationHabit, Habit, RatingHabit } from '../../models/habit'
import type { BooleanHabitStatus, HabitEntry } from '../../models/habit-entry'
import { calculateDayScore, calculateWeeklyScore, getDayScoreInterpretation, getHabitScore, getRatingLevelScore } from './day-score'

const timestamp = '2026-10-01T10:00:00.000Z'
function date(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error('Invalid fixture date')
  return value
}
const today = date('2026-10-24')
function boolean(id = 'reading', fields: Partial<BooleanHabit> = {}): BooleanHabit {
  return { id, name: id, type: 'boolean', category: 'self_development', description: '', order: 0,
    createdAt: timestamp, updatedAt: timestamp, archivedAt: null, ...fields }
}
function amount(fields: Partial<AmountHabit> = {}): AmountHabit {
  return { ...boolean('push-ups'), type: 'amount', category: 'training', target: 100, unit: 'reps', quickActions: [10], manualMode: 'total', ...fields }
}
function duration(id = 'gaming'): DurationHabit {
  return { ...boolean(id), type: 'duration', category: 'screen_time', unit: 'minutes', ratingRanges: getInitialDurationRanges(id) }
}
function mark(habitId: string, status: BooleanHabitStatus = 'success', day = today): HabitEntry {
  return { habitId, type: 'boolean', status, date: day, createdAt: timestamp, updatedAt: timestamp }
}
function quantity(habitId: string, value: number, day = today): HabitEntry {
  return { habitId, type: 'amount', value, date: day, createdAt: timestamp, updatedAt: timestamp }
}
function time(habitId: string, minutes: number, day = today): HabitEntry {
  return { habitId, type: 'duration', minutes, date: day, createdAt: timestamp, updatedAt: timestamp }
}
afterEach(() => vi.unstubAllEnvs())

describe('normalized habit score', () => {
  it.each([['success', 100], ['failure', 0], ['no-data', null]] as const)('scores boolean %s without equating no-data with failure', (status, expected) => {
    expect(getHabitScore(boolean(), mark('reading', status))).toBe(expected)
  })
  it('returns no score for missing entries of every supported type', () => {
    for (const habit of [boolean(), amount(), duration()]) expect(getHabitScore(habit, undefined)).toBeNull()
  })
  it.each([[0, 0], [50, 50], [100, 100], [130, 100]])('scores quantity %i while retaining the actual value', (value, expected) => {
    const entry = quantity('push-ups', value)
    const original = structuredClone(entry)
    expect(getHabitScore(amount(), entry)).toBe(expected)
    expect(entry).toEqual(original)
  })
  it('uses the configured target for water and exercises without early rounding', () => {
    expect(getHabitScore(amount({ id: 'water', target: 2000 }), quantity('water', 1000))).toBe(50)
    expect(getHabitScore(amount({ id: 'pull-ups', target: 15 }), quantity('pull-ups', 1))).toBeCloseTo(100 / 15)
  })
  it.each([[0, 100], [120, 100], [121, 75], [240, 75], [241, 50], [329, 50], [330, 25], [360, 25], [361, 0], [1440, 0]])('maps gaming boundary %i to %i', (minutes, score) => {
    expect(getHabitScore(duration(), time('gaming', minutes))).toBe(score)
  })
  it.each([[0, 100], [60, 100], [61, 50], [90, 50], [91, 0]])('distributes three social-media levels at %i minutes', (minutes, score) => {
    expect(getHabitScore(duration('social-media'), time('social-media', minutes))).toBe(score)
  })
  it('handles a sole level explicitly and arbitrary numbers of ordered levels', () => {
    expect(getRatingLevelScore(0, 1)).toBe(100)
    expect(getRatingLevelScore(1, 4)).toBeCloseTo(200 / 3)
    expect(getRatingLevelScore(2, 4)).toBeCloseTo(100 / 3)
    expect(getRatingLevelScore(3, 4)).toBe(0)
    const habit = { ...duration(), ratingRanges: [{ id: 'only', label: 'Любое время', emoji: '●', minMinutes: 0, maxMinutes: null }] }
    expect(getHabitScore(habit, time('gaming', 1440))).toBe(100)
  })
  it.each([[-1, 3], [3, 3], [0, 0], [0.5, 3], [0, 2.5]])('rejects an invalid level %i/%i', (index, count) => {
    expect(() => getRatingLevelScore(index, count)).toThrow('уровень оценки')
  })
  it('rejects incompatible facts and invalid numerical data instead of producing an index', () => {
    expect(() => getHabitScore(boolean(), mark('other'))).toThrow('не соответствует')
    expect(() => getHabitScore(boolean(), quantity('reading', 1))).toThrow('не соответствует')
    expect(() => getHabitScore(amount({ target: 0 }), quantity('push-ups', 1))).toThrow()
    expect(() => getHabitScore(amount(), quantity('push-ups', -1))).toThrow()
    expect(() => getHabitScore(duration(), time('gaming', -1))).toThrow()
  })
})

describe('category weighting and daily data coverage', () => {
  it('gives represented categories equal weight regardless of habit counts', () => {
    const habits = [boolean('food-a', { category: 'food_water' }), boolean('food-b', { category: 'food_water' }),
      boolean('food-c', { category: 'food_water' }), amount(), boolean('empty', { category: 'routine' })]
    const entries = [mark('food-a'), mark('food-b'), mark('food-c', 'failure'), quantity('push-ups', 0)]
    const original = structuredClone({ habits, entries })
    const result = calculateDayScore(habits, entries, today)
    expect(result.categories).toEqual([
      { category: 'food_water', score: 200 / 3, filled: 3, eligible: 3 },
      { category: 'training', score: 0, filled: 1, eligible: 1 },
      { category: 'routine', score: null, filled: 0, eligible: 1 },
    ])
    expect(result).toMatchObject({ score: 100 / 3, filled: 4, eligible: 5, coverage: 80, sufficient: true })
    expect({ habits, entries }).toEqual(original)
  })
  it('excludes missing and explicit no-data marks from scores but includes them in eligible coverage', () => {
    const habits = [boolean('a'), boolean('b'), boolean('c')]
    const partial = calculateDayScore(habits, [mark('a'), mark('b', 'no-data')], today)
    expect(partial).toMatchObject({ score: 100, filled: 1, eligible: 3, sufficient: false })
    expect(partial.coverage).toBeCloseTo(100 / 3)
    expect(calculateDayScore(habits, [], today)).toMatchObject({ score: null, filled: 0, eligible: 3, coverage: 0, sufficient: false })
  })
  it('accepts exactly 50% coverage and keeps explicit zero as a filled result', () => {
    expect(calculateDayScore([amount(), boolean()], [quantity('push-ups', 0)], today))
      .toMatchObject({ score: 0, filled: 1, eligible: 2, coverage: 50, sufficient: true })
  })
  it('has no invented percentage or denominator on an empty day before any habits existed', () => {
    expect(calculateDayScore([], [], today)).toMatchObject({ score: null, coverage: null, eligible: 0, filled: 0, categories: [], sufficient: false })
    expect(calculateDayScore([boolean('new', { createdAt: '2026-10-25T12:00:00.000Z' })], [], today)).toMatchObject({ coverage: null, eligible: 0 })
  })
  it('excludes reserved standalone rating from the numerator and denominator while retaining its data', () => {
    const rating: RatingHabit = { ...boolean('mood'), type: 'rating' }
    const entry: HabitEntry = { habitId: rating.id, type: 'rating', value: 123, date: today, createdAt: timestamp, updatedAt: timestamp }
    const original = structuredClone(entry)
    expect(calculateDayScore([rating, boolean()], [entry, mark('reading')], today))
      .toMatchObject({ score: 100, eligible: 1, filled: 1, coverage: 100, unsupportedRatingCount: 1 })
    expect(calculateDayScore([rating], [entry], today)).toMatchObject({ score: null, coverage: null, eligible: 0, unsupportedRatingCount: 1 })
    expect(entry).toEqual(original)
  })
  it('uses current category definitions when regrouping historical results without changing facts', () => {
    const habits: Habit[] = [boolean('a'), boolean('b'), amount()]
    const entries = [mark('a'), mark('b', 'failure'), quantity('push-ups', 100)]
    const before = structuredClone(entries)
    expect(calculateDayScore(habits, entries, today).score).toBe(75)
    habits[0] = { ...habits[0]!, category: 'training' }
    expect(calculateDayScore(habits, entries, today).score).toBe(50)
    expect(entries).toEqual(before)
  })
  it('matches the training scenario with exact averages and schedule-aware coverage', () => {
    const result = calculateDayScore(createInitialHabits(timestamp), [quantity('water', 1000), mark('no-sweets', 'failure'), mark('no-chips'),
      quantity('push-ups', 130), quantity('abs', 30), quantity('squats', 100), quantity('pull-ups', 17), mark('walk-10km'), mark('workout', 'failure')], today)
    expect(result).toMatchObject({ filled: 9, eligible: 22, sufficient: false })
    expect(result.coverage).toBeCloseTo(9 / 22 * 100)
    expect(result.categories.find((category) => category.category === 'food_water')?.score).toBe(50)
    expect(result.categories.find((category) => category.category === 'training')?.score).toBeCloseTo(430 / 6)
    expect(result.score).toBeCloseTo((50 + 430 / 6) / 2)
  })
})

describe('score lifecycle and local dates', () => {
  it('does not let newly migrated habits lower coverage on earlier dates', () => {
    const old = boolean()
    const added = amount({ createdAt: '2026-10-24T12:00:00.000Z' })
    const yesterday = date('2026-10-23')
    expect(calculateDayScore([old, added], [mark(old.id, 'success', yesterday)], yesterday))
      .toMatchObject({ score: 100, coverage: 100, filled: 1, eligible: 1 })
    expect(calculateDayScore([old, added], [mark(old.id)], today)).toMatchObject({ coverage: 50, eligible: 2 })
  })
  it('omits archived empty days but preserves facts on and after the archive date', () => {
    const habit = boolean('reading', { archivedAt: '2026-10-23T12:00:00.000Z' })
    const archiveDate = date('2026-10-23')
    expect(calculateDayScore([habit], [], date('2026-10-22')).eligible).toBe(1)
    expect(calculateDayScore([habit], [], archiveDate).eligible).toBe(0)
    expect(calculateDayScore([habit], [], today).eligible).toBe(0)
    expect(calculateDayScore([habit], [mark(habit.id, 'failure', archiveDate)], archiveDate))
      .toMatchObject({ eligible: 1, score: 0, coverage: 100 })
    expect(calculateDayScore([habit], [mark(habit.id)], today)).toMatchObject({ eligible: 1, score: 100, coverage: 100 })
  })
  it('supports backdated entries and earlier lifecycle context consistently', () => {
    const habit = boolean('reading', { createdAt: '2026-10-25T12:00:00.000Z' })
    const early = date('2026-10-20')
    expect(calculateDayScore([habit], [mark(habit.id, 'success', early)], early)).toMatchObject({ score: 100, eligible: 1 })
    expect(calculateDayScore([habit], [], today, new Map([[habit.id, early]]))).toMatchObject({ score: null, coverage: 0, eligible: 1 })
  })
  it('resolves creation and archive boundaries in the local timezone', () => {
    const habit = boolean('reading', { createdAt: '2026-10-23T22:30:00.000Z', archivedAt: '2026-10-24T22:30:00.000Z' })
    vi.stubEnv('TZ', 'Europe/Moscow')
    expect(calculateDayScore([habit], [], date('2026-10-23')).eligible).toBe(0)
    expect(calculateDayScore([habit], [], today).eligible).toBe(1)
    expect(calculateDayScore([habit], [], date('2026-10-25')).eligible).toBe(0)
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(calculateDayScore([habit], [], date('2026-10-23')).eligible).toBe(1)
    expect(calculateDayScore([habit], [], today).eligible).toBe(0)
  })
})

describe('calendar-week score', () => {
  it('averages only sufficiently filled days while coverage includes missing days', () => {
    const habits = [boolean('a'), boolean('b'), amount(), amount({ id: 'squats' })]
    const entries = [mark('a', 'success', date('2026-10-19')), mark('b', 'failure', date('2026-10-19')),
      quantity('push-ups', 100, date('2026-10-19')), quantity('squats', 100, date('2026-10-19')),
      mark('a', 'success', date('2026-10-20')), mark('b', 'success', date('2026-10-20')),
      mark('a', 'success', date('2026-10-21')), mark('b', 'no-data', date('2026-10-21')),
      quantity('push-ups', 0, today), quantity('squats', 0, today)]
    const result = calculateWeeklyScore(habits, entries, today)
    expect(result).toMatchObject({ startDate: '2026-10-19', endDate: today, score: 62.5,
      sufficientDays: 3, fullDays: 1, partialDays: 3, missingDays: 2, unavailableDays: 0,
      bestDay: { date: '2026-10-20', score: 100 }, worstDay: { date: today, score: 0 } })
    expect(result.averageCoverage).toBeCloseTo(225 / 6)
    expect(result.categories.find((category) => category.category === 'self_development')).toEqual({ category: 'self_development', score: 75, days: 2 })
    expect(result.categories.find((category) => category.category === 'training')).toEqual({ category: 'training', score: 50, days: 2 })
    expect(result.days[2]).toMatchObject({ score: 100, coverage: 25, sufficient: false })
  })
  it('excludes unavailable days from average coverage and uses the earlier date for ties', () => {
    const habit = boolean('a', { createdAt: '2026-10-23T10:00:00.000Z' })
    const result = calculateWeeklyScore([habit], [mark('a', 'success', date('2026-10-23')), mark('a')], today)
    expect(result).toMatchObject({ score: 100, averageCoverage: 100, fullDays: 2, unavailableDays: 4,
      bestDay: { date: '2026-10-23' }, worstDay: { date: '2026-10-23' } })
  })
  it('keeps an empty week unavailable or missing, with no fabricated best/worst day', () => {
    expect(calculateWeeklyScore([], [], today)).toMatchObject({ score: null, averageCoverage: null, sufficientDays: 0,
      unavailableDays: 6, missingDays: 0, bestDay: null, worstDay: null })
    expect(calculateWeeklyScore([boolean()], [], today)).toMatchObject({ score: null, averageCoverage: 0,
      sufficientDays: 0, unavailableDays: 0, missingDays: 6, bestDay: null, worstDay: null })
  })
  it('spans year boundaries and DST using local calendar weeks without future dates', () => {
    const newYear = calculateWeeklyScore([], [], date('2027-01-03'))
    expect(newYear.days.map((day) => day.date)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(calculateWeeklyScore([], [], date('2026-11-01')).days.map((day) => day.date))
      .toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(calculateWeeklyScore([], [], date('2026-11-03')).days.map((day) => day.date))
      .toEqual(['2026-11-02', '2026-11-03'])
  })
})

describe('scheduled day and week scores', () => {
  const cleaning = boolean('cleaning', { category: 'routine', schedule: { type: 'weekly' } })

  it('includes alcohol and meals as boolean scores without giving their category extra weight', () => {
    const habits = createInitialHabits(timestamp).filter((habit) => ['no-alcohol', 'breakfast', 'lunch', 'dinner', 'english', 'cleaning'].includes(habit.id))
    const entries = [mark('no-alcohol', 'failure'), mark('breakfast'), mark('lunch', 'failure'), mark('dinner'), mark('english'),
      mark('cleaning', 'success', date('2026-10-19'))]
    expect(calculateDayScore(habits, entries, today)).toMatchObject({ score: 75, eligible: 5, filled: 5, coverage: 100 })
    const incomplete = calculateDayScore(habits, entries.filter((entry) => !['breakfast', 'lunch'].includes(entry.habitId)), today)
    expect(incomplete).toMatchObject({ score: 75, eligible: 5, filled: 3, coverage: 60 })
  })

  it('excludes unscheduled weekly goals every day and only expects chosen weekdays', () => {
    const habits = [boolean('daily'), boolean('scheduled', { schedule: { type: 'weekdays', days: [1, 3, 5] } }), cleaning]
    for (const day of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']) {
      const expected = ['2026-10-19', '2026-10-21', '2026-10-23'].includes(day) ? 2 : 1
      expect(calculateDayScore(habits, [mark('cleaning', 'failure', date('2026-10-19'))], date(day)))
        .toMatchObject({ eligible: expected, filled: 0, coverage: 0, score: null })
    }
  })

  it('reads the same Monday weekly result only on its assigned due day', () => {
    const assigned = { ...cleaning, schedule: { type: 'weekly' as const, weekday: 7 } }
    const entries = [mark('cleaning', 'success', date('2026-10-19'))]
    expect(calculateDayScore([assigned], entries, date('2026-10-24'))).toMatchObject({ eligible: 0, score: null })
    expect(calculateDayScore([assigned], entries, date('2026-10-25'))).toMatchObject({ eligible: 1, score: 100, coverage: 100 })
  })

  it.each([undefined, 7])('counts a weekly goal once inside its category (assigned day %s)', (weekday) => {
    const weekly = weekday === undefined ? cleaning : { ...cleaning, schedule: { type: 'weekly' as const, weekday } }
    const habits = [boolean('routine', { category: 'routine' }), boolean('food', { category: 'food_water' }), weekly]
    const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
    const entries = dates.flatMap((day) => [mark('routine', 'failure', date(day)), mark('food', 'success', date(day))])
    entries.push(mark('cleaning', 'success', date('2026-10-19')))
    const result = calculateWeeklyScore(habits, entries, date('2026-10-25'))
    expect(result.weeklyGoals).toHaveLength(1)
    expect(result.categories.find((category) => category.category === 'routine')).toMatchObject({ score: 12.5, days: 7 })
    expect(result.categories.find((category) => category.category === 'food_water')).toMatchObject({ score: 100, days: 7 })
    expect(result.score).toBe(56.25)
  })

  it('allows a weekly result without treating sparse or missing daily data as zero', () => {
    const habits = [boolean('a'), boolean('b'), boolean('c'), cleaning]
    const result = calculateWeeklyScore(habits, [mark('a', 'failure', date('2026-10-20')),
      mark('cleaning', 'success', date('2026-10-19'))], today)
    expect(result).toMatchObject({ score: 100, sufficientDays: 0, partialDays: 1, missingDays: 5 })
    expect(result.categories.find((category) => category.category === 'self_development')?.score).toBeNull()
  })

  it('uses failure only for completed unrecorded weeks, preserving explicit no-data', () => {
    const endDate = date('2026-10-25')
    expect(calculateWeeklyScore([cleaning], [], endDate, undefined, date('2026-10-26')).score).toBe(0)
    expect(calculateWeeklyScore([cleaning], [], today).score).toBeNull()
    expect(calculateWeeklyScore([cleaning], [mark('cleaning', 'no-data', date('2026-10-19'))], endDate, undefined, date('2026-10-26')).score).toBeNull()
  })
})

describe('score interpretation boundaries', () => {
  it.each([[null, 'Нет данных для оценки'], [0, 'Много целей осталось невыполненными'], [39.9, 'Много целей осталось невыполненными'],
    [40, 'Слабый результат'], [60, 'Нормальный день'], [75, 'Хороший день'], [90, 'Отличный день'], [100, 'Отличный день']])('labels %s without rounding across thresholds', (score, label) => {
    expect(getDayScoreInterpretation(score as number | null)).toBe(label)
  })
})
