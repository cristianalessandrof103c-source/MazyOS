import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { formatarReais } from '../../lib/money'
import { lastNDays, bucketByDay } from '../../lib/timeseries'
import { TimeSeriesChart } from '../../components/charts/TimeSeriesChart'
import { HorizontalBarChart } from '../../components/charts/HorizontalBarChart'
import { StatTile } from '../financeiro/StatTile'
import type { AcquisitionChannel, Deal, Lead } from '../../lib/crm-types'

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
      <h1 className="font-display text-xl font-semibold">Visão geral</h1>
      <p className="mt-1 text-sm text-text-dim">Últimos {PERIODO_DIAS} dias.</p>

      {loading && <p className="mt-6 text-text-dim">Carregando…</p>}

      {!loading && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <StatTile label={`Leads (${PERIODO_DIAS} dias)`} value={leads.length.toLocaleString('pt-BR')} />
            <StatTile label="Receita fechada" value={formatarReais(receitaFechada)} />
            <StatTile label="Receita a receber" value={formatarReais(receitaAReceber)} />
            <StatTile
              label={`Gasto de tráfego (${PERIODO_DIAS} dias)`}
              value={formatarReais(gastoTotal)}
              hint={adSpend.length === 0 ? 'sem sincronização ainda' : undefined}
            />
            <StatTile
              label="CAC (canais pagos)"
              value={cac === null ? '—' : formatarReais(cac)}
              hint={vendasPorCanalPago === 0 ? 'nenhuma venda por canal pago ainda' : undefined}
            />
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-medium text-text-dim">Leads por dia</h2>
              <div className="mt-4">
                <TimeSeriesChart
                  series={[{ label: 'Leads', color: CHART_VIOLET, points: days.map((d, i) => ({ x: d, y: leadsPorDia[i] })) }]}
                  area
                />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface p-5">
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

          <section className="mt-6 rounded-xl border border-border bg-surface p-5">
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
