import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatStatisticsDate } from './format-statistics'

export interface ChartPoint { date: string; value: number | null }

/** Values remain available in adjoining summaries/tables; tapping reveals chart values too. */
export function StatisticsChart({ data, label, unit, target, bars = false, percent = false, includeYear = false }: {
  data: ChartPoint[]; label: string; unit: string; target?: number; bars?: boolean; percent?: boolean; includeYear?: boolean
}) {
  if (typeof globalThis.ResizeObserver === 'undefined' || !data.some((point) => point.value !== null)) return null
  return <div className="statistics-chart" role="img" aria-label={label}>
    <ResponsiveContainer width="100%" height={180} minWidth={0} initialDimension={{ width: 250, height: 180 }}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke="#e6ebdf" />
        <XAxis dataKey="date" tickFormatter={(date: string) => formatStatisticsDate(date)} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7961' }} minTickGap={22} />
        <YAxis width={42} domain={percent ? [0, 100] : [0, 'auto']} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7961' }} />
        <Tooltip trigger="click" labelFormatter={(date) => formatStatisticsDate(String(date), includeYear)} formatter={(value) => [`${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${unit}`, 'Значение']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        {target !== undefined && <ReferenceLine y={target} ifOverflow="extendDomain" stroke="#ad7b46" strokeDasharray="4 4" />}
        {bars ? <Bar dataKey="value" fill="#7a9b7d" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          : <Line dataKey="value" type="linear" stroke="#54795f" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  </div>
}
