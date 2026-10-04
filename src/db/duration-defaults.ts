import type { DurationRatingRange } from '../models/duration-rating'

const defaults: Record<string, DurationRatingRange[]> = {
  gaming: [
    { id: 'excellent', label: 'Отлично', emoji: '😄', minMinutes: 0, maxMinutes: 120 },
    { id: 'good', label: 'Хорошо', emoji: '🙂', minMinutes: 121, maxMinutes: 240 },
    { id: 'neutral', label: 'Нейтрально', emoji: '😐', minMinutes: 241, maxMinutes: 329 },
    { id: 'poor', label: 'Плохо', emoji: '🙁', minMinutes: 330, maxMinutes: 360 },
    { id: 'very-poor', label: 'Очень плохо', emoji: '😡', minMinutes: 361, maxMinutes: null },
  ],
  'social-media': [
    { id: 'excellent', label: 'Отлично', emoji: '😄', minMinutes: 0, maxMinutes: 60 },
    { id: 'good', label: 'Хорошо', emoji: '🙂', minMinutes: 61, maxMinutes: 90 },
    { id: 'poor', label: 'Плохо', emoji: '🙁', minMinutes: 91, maxMinutes: null },
  ],
}

/** Only used when creating/upgrading the initial habits, never to override saved settings. */
export function getInitialDurationRanges(habitId: string): DurationRatingRange[] {
  const ranges = defaults[habitId]
  if (!ranges) throw new Error('Не найдена начальная конфигурация оценок.')
  return ranges.map((range) => ({ ...range }))
}
