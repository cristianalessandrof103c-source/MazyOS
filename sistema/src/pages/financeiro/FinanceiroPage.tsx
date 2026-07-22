import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { StatCard, STAT_ICONS } from '../../components/StatCard'
import { formatarReais } from '../../lib/money'
import { extrairErroFuncao } from '../../lib/functions-error'
import type { AcquisitionChannel, Deal, Lead } from '../../lib/crm-types'

type Payment = { amount_cents: number; status: 'pending' | 'paid' | 'overdue' }
type AdSpendSnapshot = {
  date: string
  spend_cents: number
  results_count: number
  cpa_cents: number | null
}

const PERIODO_DIAS = 30

export function FinanceiroPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const queryClient = useQueryClient()
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncOk, setSyncOk] = useState(false)

  // Truncado pro dia (sem hora) — mesma queryKey que a Visão Geral usa, então navegar entre as
  // duas páginas reaproveita o cache do TanStack Query em vez de refazer o fetch.
  const since = useMemo(() => new Date(Date.now() - PERIODO_DIAS * 24 * 3600 * 1000).toISOString().slice(0, 10), [])

  const leadsQuery = useQuery({
    queryKey: ['financeiro-leads', tenantId, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', since)
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
      const { data, error } = await supabase
        .from('payments')
        .select('amount_cents, status')
        .eq('tenant_id', tenantId)
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

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sync-ad-spend-now', {
        body: { tenant_id: tenantId },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao sincronizar')
    },
    onSuccess: () => {
      setSyncError(null)
      setSyncOk(true)
      queryClient.invalidateQueries({ queryKey: ['financeiro-ad-spend', tenantId] })
    },
    onError: (err: Error) => {
      setSyncOk(false)
      setSyncError(err.message)
    },
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

  const leadsPorCanal = channels
    .map((channel) => ({
      channel,
      count: leads.filter((l) => l.acquisition_channel_id === channel.id).length,
      receita: deals
        .filter((d) => d.status === 'won' && d.acquisition_channel_id === channel.id)
        .reduce((sum, d) => sum + d.value_cents, 0),
    }))
    .filter((row) => row.count > 0 || row.receita > 0)

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <header className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-text">Visão financeira</h1>
        </div>
        <span className="hidden max-w-xs text-right text-xs text-text-faint md:block">
          Leads dos últimos {PERIODO_DIAS} dias · receita e CAC acumulados desde o início
        </span>
      </header>

      {loading && <p className="mt-6 text-text-dim">Carregando…</p>}

      {!loading && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <StatCard label={`Leads (${PERIODO_DIAS} dias)`} value={leads.length.toLocaleString('pt-BR')} icon={STAT_ICONS.leads} badgeColor="var(--color-violet)" />
            <StatCard label="Receita fechada" value={formatarReais(receitaFechada)} icon={STAT_ICONS.revenue} badgeColor="var(--color-success)" />
            <StatCard label="Receita a receber" value={formatarReais(receitaAReceber)} icon={STAT_ICONS.pending} badgeColor="var(--color-cyan)" />
            <StatCard
              label={`Gasto de tráfego (${PERIODO_DIAS} dias)`}
              value={formatarReais(gastoTotal)}
              hint={adSpend.length === 0 ? 'sem sincronização ainda' : undefined}
              icon={STAT_ICONS.spend}
              badgeColor="var(--color-magenta)"
            />
            <StatCard
              label="CAC (canais pagos)"
              value={cac === null ? '—' : formatarReais(cac)}
              hint={vendasPorCanalPago === 0 ? 'nenhuma venda por canal pago ainda' : undefined}
              icon={STAT_ICONS.target}
              badgeColor="var(--color-violet)"
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="text-section font-semibold text-text">Leads por canal ({PERIODO_DIAS} dias)</h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-border/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-surface-2 text-left text-xs text-text-faint">
                      <th className="px-3 py-3 font-semibold">Canal</th>
                      <th className="px-3 py-3 font-semibold tabular-nums">Leads</th>
                      <th className="px-3 py-3 font-semibold tabular-nums">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsPorCanal.map((row) => (
                      <tr key={row.channel.id} className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2">
                        <td className="px-3 py-3">{row.channel.label}</td>
                        <td className="px-3 py-3 tabular-nums text-text-dim">{row.count}</td>
                        <td className="px-3 py-3 tabular-nums text-text-dim">{formatarReais(row.receita)}</td>
                      </tr>
                    ))}
                    {leadsPorCanal.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-text-faint">
                          Nenhum lead nos últimos {PERIODO_DIAS} dias.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-section font-semibold text-text">Gasto de tráfego por dia</h2>
                <button
                  onClick={() => {
                    setSyncOk(false)
                    syncMutation.mutate()
                  }}
                  disabled={syncMutation.isPending}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:border-violet hover:text-text disabled:opacity-60"
                >
                  {syncMutation.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
                </button>
              </div>
              {syncError && <p className="mt-2 text-xs text-magenta">{syncError}</p>}
              {syncOk && !syncMutation.isPending && (
                <p className="mt-2 text-xs text-success">Sincronizado.</p>
              )}
              <div className="mt-4 overflow-hidden rounded-xl border border-border/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-surface-2 text-left text-xs text-text-faint">
                      <th className="px-3 py-3 font-semibold">Dia</th>
                      <th className="px-3 py-3 font-semibold tabular-nums">Gasto</th>
                      <th className="px-3 py-3 font-semibold tabular-nums">Resultados</th>
                      <th className="px-3 py-3 font-semibold tabular-nums">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adSpend.map((row) => (
                      <tr key={row.date} className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2">
                        <td className="px-3 py-3 tabular-nums">
                          {new Date(row.date).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-text-dim">{formatarReais(row.spend_cents)}</td>
                        <td className="px-3 py-3 tabular-nums text-text-dim">{row.results_count}</td>
                        <td className="px-3 py-3 tabular-nums text-text-dim">
                          {row.cpa_cents === null ? '—' : formatarReais(row.cpa_cents)}
                        </td>
                      </tr>
                    ))}
                    {adSpend.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-text-faint">
                          Sem gasto sincronizado ainda — campanha pausada.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </TenantSidebarLayout>
  )
}
