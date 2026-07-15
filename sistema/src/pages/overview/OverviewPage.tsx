import { useMemo } from 'react'
import type { ReactElement, SVGProps } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { formatarReais } from '../../lib/money'
import { lastNDays, bucketByDay } from '../../lib/timeseries'
import { TimeSeriesChart } from '../../components/charts/TimeSeriesChart'
import { HorizontalBarChart } from '../../components/charts/HorizontalBarChart'
import type { AcquisitionChannel, Deal, Lead } from '../../lib/crm-types'

function StatIcon(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props} />
}

const STAT_ICONS = {
  spend: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><path d="M3 17 9 11 13 15 21 6" /><path d="M15 6h6v6" /></StatIcon>,
  leads: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20v-.6a6 6 0 0 1 6-6h0a6 6 0 0 1 6 6v.6" /><circle cx="18" cy="9" r="2.4" /></StatIcon>,
  revenue: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /></StatIcon>,
  pending: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></StatIcon>,
  target: (p: SVGProps<SVGSVGElement>) => <StatIcon {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></StatIcon>,
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
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

function StatCard({
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

type Payment = { amount_cents: number; status: 'pending' | 'paid' | 'overdue' }
type AdSpendSnapshot = { date: string; spend_cents: number }

const PERIODO_DIAS = 30
// Validado com a skill de dataviz (scripts/validate_palette.js) contra a superfície #10121e em
// modo dark: o cyan de marca (#22d3ee) é claro demais pra mark de gráfico (L≈0.80, teto 0.67) —
// esse é um passo mais escuro só pros gráficos, a cor de UI/botões não muda.
const CHART_VIOLET = '#8b5cf6'
const CHART_CYAN = '#0e93ab'

export function OverviewPage() {
  const { tenantId } = useParams<{ tenantId: string }>()

  const since = useMemo(() => new Date(Date.now() - PERIODO_DIAS * 24 * 3600 * 1000).toISOString().slice(0, 10), [])

  const leadsQuery = useQuery({
    queryKey: ['financeiro-leads', tenantId, since],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select('*').eq('tenant_id', tenantId).gte('created_at', since)
      if (error) throw error
      return data as Lead[]
    },
    enabled: Boolean(tenantId),
  })

  const channelsQuery = useQuery({
    queryKey: ['acquisition-channels', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('acquisition_channels')
        .select('*')
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      if (error) throw error
      return data as AcquisitionChannel[]
    },
    enabled: Boolean(tenantId),
  })

  const dealsQuery = useQuery({
    queryKey: ['financeiro-deals', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from('deals').select('*').eq('tenant_id', tenantId)
      if (error) throw error
      return data as Deal[]
    },
    enabled: Boolean(tenantId),
  })

  const paymentsQuery = useQuery({
    queryKey: ['financeiro-payments', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from('payments').select('amount_cents, status').eq('tenant_id', tenantId)
      if (error) throw error
      return data as Payment[]
    },
    enabled: Boolean(tenantId),
  })

  const adSpendQuery = useQuery({
    queryKey: ['financeiro-ad-spend', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_spend_snapshots')
        .select('date, spend_cents, results_count, cpa_cents')
        .eq('tenant_id', tenantId)
        .order('date', { ascending: false })
        .limit(PERIODO_DIAS)
      if (error) throw error
      return data as AdSpendSnapshot[]
    },
    enabled: Boolean(tenantId),
  })

  if (!tenantId) return null

  const leads = leadsQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const deals = dealsQuery.data ?? []
  const payments = paymentsQuery.data ?? []
  const adSpend = adSpendQuery.data ?? []

  const loading =
    leadsQuery.isLoading || channelsQuery.isLoading || dealsQuery.isLoading || paymentsQuery.isLoading || adSpendQuery.isLoading

  const receitaFechada = deals.filter((d) => d.status === 'won').reduce((sum, d) => sum + d.value_cents, 0)
  const receitaAReceber = payments.filter((p) => p.status === 'pending').reduce((sum, p) => sum + p.amount_cents, 0)
  const gastoTotal = adSpend.reduce((sum, s) => sum + s.spend_cents, 0)

  const canaisPagos = new Set(channels.filter((c) => c.category === 'paid').map((c) => c.id))
  const vendasPorCanalPago = deals.filter(
    (d) => d.status === 'won' && d.acquisition_channel_id && canaisPagos.has(d.acquisition_channel_id),
  ).length
  const cac = vendasPorCanalPago > 0 ? gastoTotal / vendasPorCanalPago : null

  const days = lastNDays(PERIODO_DIAS)
  const leadsPorDia = bucketByDay(leads, (l) => l.created_at, days)
  const wonDeals = deals.filter((d): d is Deal & { closed_at: string } => d.status === 'won' && Boolean(d.closed_at))
  const receitaPorDia = bucketByDay(wonDeals, (d) => d.closed_at, days, (d) => d.value_cents)
  const gastoPorDia = bucketByDay(adSpend, (s) => s.date, days, (s) => s.spend_cents)

  const leadsPorCanal = channels
    .map((channel) => ({ label: channel.label, value: leads.filter((l) => l.acquisition_channel_id === channel.id).length }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <header className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Painel de operação · {PERIODO_DIAS} dias</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-text">Visão geral</h1>
        </div>
        <span className="hidden text-xs text-text-faint md:block">Dados em tempo real</span>
      </header>

      {loading && <p className="mt-6 text-text-dim">Carregando…</p>}

      {!loading && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="Gasto de tráfego"
              value={formatarReais(gastoTotal)}
              icon={STAT_ICONS.spend}
              badgeColor="var(--color-magenta)"
              sparkline={gastoPorDia}
            />
            <StatCard
              label="Leads captados"
              value={leads.length.toLocaleString('pt-BR')}
              icon={STAT_ICONS.leads}
              badgeColor="var(--color-violet)"
              sparkline={leadsPorDia}
            />
            <StatCard
              label="Receita fechada"
              value={formatarReais(receitaFechada)}
              icon={STAT_ICONS.revenue}
              badgeColor="var(--color-cyan)"
              sparkline={receitaPorDia}
            />
            <StatCard
              label="Receita a receber"
              value={formatarReais(receitaAReceber)}
              icon={STAT_ICONS.pending}
              badgeColor="var(--color-cyan)"
            />
            <StatCard
              label="CAC (canais pagos)"
              value={cac === null ? '—' : formatarReais(cac)}
              hint={vendasPorCanalPago === 0 ? 'sem venda por canal pago ainda' : 'dado real'}
              icon={STAT_ICONS.target}
              badgeColor="var(--color-violet)"
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="text-sm font-medium text-text-dim">Leads por dia</h2>
              <div className="mt-4">
                <TimeSeriesChart
                  series={[{ label: 'Leads', color: CHART_VIOLET, points: days.map((d, i) => ({ x: d, y: leadsPorDia[i] })) }]}
                  area
                />
              </div>
            </section>

            <section className="card p-5">
              <h2 className="text-sm font-medium text-text-dim">Receita × gasto de tráfego</h2>
              <div className="mt-4">
                <TimeSeriesChart
                  series={[
                    { label: 'Receita', color: CHART_VIOLET, points: days.map((d, i) => ({ x: d, y: receitaPorDia[i] })) },
                    { label: 'Gasto', color: CHART_CYAN, points: days.map((d, i) => ({ x: d, y: gastoPorDia[i] })) },
                  ]}
                  valueFormatter={formatarReais}
                />
              </div>
            </section>
          </div>

          <section className="card mt-4 p-5">
            <h2 className="text-sm font-medium text-text-dim">Leads por canal ({PERIODO_DIAS} dias)</h2>
            <div className="mt-4">
              <HorizontalBarChart data={leadsPorCanal} color={CHART_VIOLET} />
            </div>
          </section>
        </>
      )}
    </TenantSidebarLayout>
  )
}
