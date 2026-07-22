import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { StatCard, STAT_ICONS } from '../../components/StatCard'
import { formatarReais } from '../../lib/money'
import { lastNDays, bucketByDay } from '../../lib/timeseries'
import { TimeSeriesChart } from '../../components/charts/TimeSeriesChart'
import { HorizontalBarChart } from '../../components/charts/HorizontalBarChart'
import type { AcquisitionChannel, Deal, Lead } from '../../lib/crm-types'

type Payment = { amount_cents: number; status: 'pending' | 'paid' | 'overdue' }
type AdSpendSnapshot = { date: string; spend_cents: number }

const PERIOD_OPTIONS = [
  { label: 'Hoje', days: 1 },
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
  { label: 'Ano', days: 365 },
]

// Validado com a skill de dataviz (scripts/validate_palette.js) contra a superfície
// #111217 do design system novo: um passo mais escuro do que os tokens de UI, só pros
// gráficos (a cor de UI/botões continua vindo de --color-violet/--color-cyan).
const CHART_VIOLET = '#7c3aed'
const CHART_CYAN = '#0891b2'

function percentTrend(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined
  return ((current - previous) / previous) * 100
}

export function OverviewPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const [periodDays, setPeriodDays] = useState(30)

  const since = useMemo(() => new Date(Date.now() - periodDays * 24 * 3600 * 1000).toISOString().slice(0, 10), [periodDays])
  const sinceExtended = useMemo(
    () => new Date(Date.now() - periodDays * 2 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    [periodDays],
  )

  const leadsQuery = useQuery({
    queryKey: ['financeiro-leads', tenantId, sinceExtended],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select('*').eq('tenant_id', tenantId).gte('created_at', sinceExtended)
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
    queryKey: ['financeiro-ad-spend', tenantId, periodDays],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_spend_snapshots')
        .select('date, spend_cents, results_count, cpa_cents')
        .eq('tenant_id', tenantId)
        .order('date', { ascending: false })
        .limit(periodDays * 2)
      if (error) throw error
      return data as AdSpendSnapshot[]
    },
    enabled: Boolean(tenantId),
  })

  if (!tenantId) return null

  const leadsAll = leadsQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const deals = dealsQuery.data ?? []
  const payments = paymentsQuery.data ?? []
  const adSpendAll = adSpendQuery.data ?? []

  const loading =
    leadsQuery.isLoading || channelsQuery.isLoading || dealsQuery.isLoading || paymentsQuery.isLoading || adSpendQuery.isLoading

  const leads = leadsAll.filter((l) => l.created_at >= since)
  const leadsPrevPeriod = leadsAll.filter((l) => l.created_at < since)
  const adSpend = adSpendAll.filter((s) => s.date >= since)
  const adSpendPrevPeriod = adSpendAll.filter((s) => s.date < since)

  const receitaFechada = deals.filter((d) => d.status === 'won').reduce((sum, d) => sum + d.value_cents, 0)
  const receitaAReceber = payments.filter((p) => p.status === 'pending').reduce((sum, p) => sum + p.amount_cents, 0)
  const gastoTotal = adSpend.reduce((sum, s) => sum + s.spend_cents, 0)
  const gastoPrevTotal = adSpendPrevPeriod.reduce((sum, s) => sum + s.spend_cents, 0)

  const canaisPagos = new Set(channels.filter((c) => c.category === 'paid').map((c) => c.id))
  const vendasPorCanalPago = deals.filter(
    (d) => d.status === 'won' && d.acquisition_channel_id && canaisPagos.has(d.acquisition_channel_id),
  ).length
  const cac = vendasPorCanalPago > 0 ? gastoTotal / vendasPorCanalPago : null

  const days = lastNDays(periodDays)
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Painel Operacional</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-text">Bem-vindo de volta</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="text-xs text-text-faint">Atualizado agora</span>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setPeriodDays(opt.days)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  periodDays === opt.days ? 'bg-violet text-white' : 'text-text-dim hover:text-text'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
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
              trend={percentTrend(gastoTotal, gastoPrevTotal)}
            />
            <StatCard
              label="Leads captados"
              value={leads.length.toLocaleString('pt-BR')}
              icon={STAT_ICONS.leads}
              badgeColor="var(--color-violet)"
              sparkline={leadsPorDia}
              trend={percentTrend(leads.length, leadsPrevPeriod.length)}
            />
            <StatCard
              label="Receita fechada"
              value={formatarReais(receitaFechada)}
              hint="total acumulado"
              icon={STAT_ICONS.revenue}
              badgeColor="var(--color-success)"
              sparkline={receitaPorDia}
            />
            <StatCard
              label="Receita a receber"
              value={formatarReais(receitaAReceber)}
              hint="total acumulado"
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
              <h2 className="text-section font-semibold text-text">Leads por dia</h2>
              <div className="mt-4">
                <TimeSeriesChart
                  series={[{ label: 'Leads', color: CHART_VIOLET, points: days.map((d, i) => ({ x: d, y: leadsPorDia[i] })) }]}
                  area
                />
              </div>
            </section>

            <section className="card p-5">
              <h2 className="text-section font-semibold text-text">Receita × gasto de tráfego</h2>
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

          <section className="card mt-6 p-5">
            <h2 className="text-section font-semibold text-text">Leads por canal ({periodDays} dias)</h2>
            <div className="mt-4">
              <HorizontalBarChart data={leadsPorCanal} color={CHART_VIOLET} />
            </div>
          </section>
        </>
      )}
    </TenantSidebarLayout>
  )
}
