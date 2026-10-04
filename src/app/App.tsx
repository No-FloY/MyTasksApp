import { lazy, Suspense } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { TodayPage } from '@/features/today/TodayPage'
import { useCurrentPage } from '@/hooks/use-current-page'
import { PlannedPage } from './PlannedPage'

const StatisticsPage = lazy(() => import('@/features/statistics/StatisticsPage'))
const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage'))

export default function App() {
  const currentPage = useCurrentPage()

  return (
    <AppLayout currentPage={currentPage}>
      {currentPage === 'today' ? <TodayPage /> : currentPage === 'statistics'
        ? <Suspense fallback={<p role="status">Загружаем статистику…</p>}><StatisticsPage /></Suspense>
        : currentPage === 'calendar'
          ? <Suspense fallback={<p role="status">Загружаем календарь…</p>}><CalendarPage /></Suspense>
        : <PlannedPage page={currentPage} />}
    </AppLayout>
  )
}
