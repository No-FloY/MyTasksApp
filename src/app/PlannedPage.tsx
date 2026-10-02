import { ArrowLeft, Sprout } from 'lucide-react'
import { navigation, type PageId } from '@/app/navigation'

export function PlannedPage({ page }: { page: PageId }) {
  const title = navigation.find((item) => item.id === page)?.label

  return (
    <section className="planned-page" aria-labelledby="planned-title">
      <span className="planned-icon"><Sprout size={34} strokeWidth={1.5} aria-hidden="true" /></span>
      <p className="eyebrow">ВСЁ В СВОЁ ВРЕМЯ</p>
      <h1 id="planned-title">{title}</h1>
      <p>Этот раздел появится на следующих этапах разработки.<br />А пока можно отмечать ежедневные привычки.</p>
      <a className="return-link" href="#today"><ArrowLeft size={17} aria-hidden="true" />Вернуться к сегодняшнему дню</a>
    </section>
  )
}
