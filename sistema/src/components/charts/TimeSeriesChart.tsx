import { useRef, useState } from 'react'

export type TimeSeriesPoint = { x: string; y: number }
export type TimeSeriesSeries = { label: string; color: string; points: TimeSeriesPoint[] }

const WIDTH = 600
const PAD_LEFT = 44
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 28

function niceCeil(value: number): number {
  if (value <= 0) return 1
  const exponent = Math.floor(Math.log10(value))
  const magnitude = 10 ** exponent
  const residual = value / magnitude
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10
  return niceResidual * magnitude
}

function formatDiaMes(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${dd}/${mm}`
}

export function TimeSeriesChart({
  series,
  area = false,
  valueFormatter = (n: number) => n.toLocaleString('pt-BR'),
  height = 220,
}: {
  series: TimeSeriesSeries[]
  area?: boolean
  valueFormatter?: (n: number) => string
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const pointCount = series[0]?.points.length ?? 0
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotHeight = height - PAD_TOP - PAD_BOTTOM

  const maxValue = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y)))
  const yMax = niceCeil(maxValue)

  const x = (i: number) => PAD_LEFT + (pointCount <= 1 ? 0 : (i / (pointCount - 1)) * plotWidth)
  const y = (v: number) => PAD_TOP + plotHeight - (v / yMax) * plotHeight

  function handlePointerMove(e: React.PointerEvent) {
    const svg = svgRef.current
    if (!svg || pointCount === 0) return
    const rect = svg.getBoundingClientRect()
    const scaleX = WIDTH / rect.width
    const pointerX = (e.clientX - rect.left) * scaleX
    const ratio = Math.min(1, Math.max(0, (pointerX - PAD_LEFT) / plotWidth))
    setHoverIndex(Math.round(ratio * (pointCount - 1)))
  }

  const gridFractions = [0, 1 / 3, 2 / 3, 1]

  return (
    <div className="relative">
      {series.length > 1 && (
        <div className="mb-2 flex gap-4">
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-xs text-text-dim">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${height}`} className="chart-enter w-full" style={{ height }}>
        {gridFractions.map((f) => {
          const gy = PAD_TOP + plotHeight - f * plotHeight
          return (
            <g key={f}>
              <line
                x1={PAD_LEFT}
                y1={gy}
                x2={WIDTH - PAD_RIGHT}
                y2={gy}
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeOpacity={0.4}
              />
              <text x={PAD_LEFT - 8} y={gy + 3} textAnchor="end" fontSize={11} fill="var(--color-text-faint)">
                {valueFormatter(f * yMax)}
              </text>
            </g>
          )
        })}

        {[0, Math.floor((pointCount - 1) / 2), pointCount - 1].map((i, idx) =>
          pointCount > 0 ? (
            <text
              key={idx}
              x={x(i)}
              y={height - 8}
              textAnchor={idx === 0 ? 'start' : idx === 2 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--color-text-faint)"
            >
              {formatDiaMes(series[0].points[i].x)}
            </text>
          ) : null,
        )}

        {area && series[0] && (
          <path
            d={`${series[0].points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.y)}`).join(' ')} L ${x(
              pointCount - 1,
            )} ${y(0)} L ${x(0)} ${y(0)} Z`}
            fill={series[0].color}
            fillOpacity={0.12}
            stroke="none"
          />
        )}

        {series.map((s) => (
          <path
            key={s.label}
            d={s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.y)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {series.map((s) => {
          const last = s.points[s.points.length - 1]
          if (!last) return null
          return (
            <g key={s.label}>
              <circle cx={x(pointCount - 1)} cy={y(last.y)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
              <text
                x={x(pointCount - 1) + 8}
                y={y(last.y) + 4}
                fontSize={12}
                fontWeight={600}
                fill="var(--color-text)"
              >
                {valueFormatter(last.y)}
              </text>
            </g>
          )
        })}

        {hoverIndex !== null && (
          <line
            x1={x(hoverIndex)}
            y1={PAD_TOP}
            x2={x(hoverIndex)}
            y2={height - PAD_BOTTOM}
            stroke="var(--color-text-faint)"
            strokeWidth={1}
          />
        )}

        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        />
      </svg>

      {hoverIndex !== null && series[0]?.points[hoverIndex] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(x(hoverIndex) / WIDTH) * 100}%`, top: 4 }}
        >
          <p className="mb-1 text-text-faint">{formatDiaMes(series[0].points[hoverIndex].x)}</p>
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="font-semibold text-text">{valueFormatter(s.points[hoverIndex]?.y ?? 0)}</span>
              <span className="text-text-faint">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
