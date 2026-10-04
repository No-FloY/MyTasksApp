import { lazy, Suspense } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { TodayPage } from '@/features/today/TodayPage'
import { useCurrentPage } from '@/hooks/use-current-page'
import { PlannedPage } from './PlannedPage'

const StatisticsPage = lazy(() => import('@/features/statistics/StatisticsPage'))

export default function App() {
  const currentPage = useCurrentPage()

  return (
    <AppLayout currentPage={currentPage}>
      {currentPage === 'today' ? <TodayPage /> : currentPage === 'statistics'
        ? <Suspense fallback={<p role="status">Загружаем статистику…</p>}><StatisticsPage /></Suspense>
        : <PlannedPage page={currentPage} />}
    </AppLayout>
  )
}
