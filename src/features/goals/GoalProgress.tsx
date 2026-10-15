export function GoalProgress({ progress }: { progress: number }) {
  const displayed = Math.round(progress * 10) / 10
  return <div className="goal-progress"><div className="goal-progress-label"><span>Прогресс</span><strong>{displayed}%</strong></div><div className="goal-progress-track" role="progressbar" aria-label="Прогресс цели" aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayed}><span style={{ width: `${displayed}%` }} /></div></div>
}
