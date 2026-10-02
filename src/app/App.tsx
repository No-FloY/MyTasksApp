import { AppLayout } from '@/components/layout/AppLayout'
import { TodayPage } from '@/features/today/TodayPage'
import { useCurrentPage } from '@/hooks/use-current-page'
import { PlannedPage } from './PlannedPage'

export default function App() {
  const currentPage = useCurrentPage()

  return (
    <AppLayout currentPage={currentPage}>
      {currentPage === 'today' ? <TodayPage /> : <PlannedPage page={currentPage} />}
    </AppLayout>
  )
}
