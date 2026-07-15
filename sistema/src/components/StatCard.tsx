import type { ReactElement, SVGProps } from 'react'

function StatIcon(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props} />
}

export const STAT_ICONS = {
  spend: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><path d="M3 17 9 11 13 15 21 6" /><path d="M15 6h6v6" /></StatIcon>,
  leads: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20v-.6a6 6 0 0 1 6-6h0a6 6 0 0 1 6 6v.6" /><circle cx="18" cy="9" r="2.4" /></StatIcon>,
  revenue: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /></StatIcon>,
  pending: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></StatIcon>,
  target: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></StatIcon>,
}

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 72
  const h = 28
  const points = values
    .map((v, i) => `${(i / (values.length - 1 || 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon: IconComp,
  badgeColor,
  sparkline,
}: {
  label: string
  value: string
  hint?: string
  icon: (p: SVGProps<SVGSVGElement>) => ReactElement
  badgeColor: string
  sparkline?: number[]
}) {
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs text-text-dim">{label}</p>
        <span className="icon-badge" style={{ backgroundColor: `color-mix(in srgb, ${badgeColor} 16%, transparent)`, color: badgeColor }}>
          <IconComp />
        </span>
      </div>
      <p className="metric-number mt-4 text-2xl font-semibold text-text md:text-[1.7rem]">{value}</p>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p className="text-xs text-text-faint">{hint ?? 'dado real'}</p>
        {sparkline && sparkline.some((v) => v > 0) && <Sparkline values={sparkline} color={badgeColor} />}
      </div>
    </div>
  )
}
