import { Card } from '@/components/ui/card'
import type { TaskStatistics } from '@/services/statistics/task-statistics'
import { formatRate } from './format-statistics'

export function TaskStatisticsCard({ data }: { data: TaskStatistics }) {
  const outcomes = [
    { key: 'on-time', label: 'Выполнено вовремя', count: data.completedOnTime, color: '#54795f' },
    { key: 'late', label: 'Выполнено поздно', count: data.completedLate, color: '#b08344' },
    { key: 'failed', label: 'Не выполнено', count: data.failed, color: '#ab6458' },
    { key: 'overdue', label: 'Просрочено', count: data.overdue, color: '#926e9c' },
    { key: 'pending', label: 'Ожидают срока', count: data.activePending, color: '#7299a4' },
    { key: 'cancelled', label: 'Отменено', count: data.cancelled, color: '#93988d' },
    { key: 'unknown', label: 'Выполнено без даты завершения', count: data.completedUnknown, color: '#6d7476' },
  ]
  return <section className="statistics-section" aria-labelledby="task-statistics-heading" data-testid="task-statistics">
    <Card className="statistics-card">
      <h2 id="task-statistics-heading">Задачи</h2>
      <p className="week-explanation">Учитываются задачи, чей дедлайн попадает в выбранный период. Результаты показаны на текущий момент.</p>
      <dl className="week-metrics statistics-metrics">
        <div><dt>Выполнено вовремя · OnTimeRate</dt><dd data-statistic="on-time-rate">{formatRate(data.onTimeRate)}</dd></div>
        <div><dt>Отклонение от плана · DeviationRate</dt><dd data-statistic="deviation-rate">{formatRate(data.deviationRate)}</dd></div>
        <div><dt>Всего задач со сроком в периоде</dt><dd data-statistic="tasks-due">{data.tasksDue}</dd></div>
        <div><dt>Задач в расчёте коэффициентов</dt><dd data-statistic="relevant">{data.relevantTasks}</dd></div>
      </dl>
      {data.tasksDue === 0 && <p className="statistics-empty">За выбранный период задач нет.</p>}
      <ul className="statistics-outcomes" aria-label="Распределение результатов задач">
        {outcomes.map((item) => <li key={item.key}><div><span>{item.label}</span><strong data-statistic={item.key}>{item.count}</strong></div>
          <div className="statistics-outcome-track" aria-hidden="true"><span style={{ width: `${data.tasksDue === 0 ? 0 : item.count / data.tasksDue * 100}%`, background: item.color }} /></div>
        </li>)}
      </ul>
      <p className="week-explanation">Отклонение от плана — доля задач, которые выполнены с опозданием, явно закрыты как невыполненные или остаются просроченными.<br />В знаменателе: вовремя + поздно + не выполнено + просрочено. Отменённые, ожидающие срока и завершённые без известной даты исключены. Если таких результатов нет, коэффициенты не рассчитываются.</p>
      <p className="week-explanation">Задача со временем просрочена после указанного момента; без времени — после конца локального дня. Выполнение ровно в срок считается своевременным.</p>
    </Card>
  </section>
}
