export type HorizontalBarDatum = { label: string; value: number }

export function HorizontalBarChart({
  data,
  color,
  valueFormatter = (n: number) => n.toLocaleString('pt-BR'),
}: {
  data: HorizontalBarDatum[]
  color: string
  valueFormatter?: (n: number) => string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))

  if (data.length === 0) {
    return <p className="text-sm text-text-faint">Sem dados no período.</p>
  }

  return (
    <div className="chart-enter flex flex-col gap-3">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
          <span className="w-32 flex-shrink-0 truncate text-sm text-text-dim" title={d.label}>
            {d.label}
          </span>
          <div className="h-6 flex-1 rounded-full bg-surface-2">
            <div
              className="h-6 rounded-full transition-all duration-500"
              style={{ width: `${(d.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-12 flex-shrink-0 text-right text-sm text-text-dim">{valueFormatter(d.value)}</span>
        </div>
      ))}
    </div>
  )
}
