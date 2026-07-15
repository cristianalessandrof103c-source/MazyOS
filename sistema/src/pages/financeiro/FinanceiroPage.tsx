import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { formatarReais } from '../../lib/money'
import { extrairErroFuncao } from '../../lib/functions-error'
import { StatTile } from './StatTile'
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
      <h1 className="font-display text-xl font-semibold">Visão financeira</h1>
        <p className="mt-1 text-sm text-text-dim">
          Leads dos últimos {PERIODO_DIAS} dias · receita e CAC acumulados desde o início.
        </p>

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
              <section>
                <h2 className="text-sm font-medium text-text-dim">Leads por canal ({PERIODO_DIAS} dias)</h2>
                <div className="mt-3 overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-left text-xs text-text-faint">
                        <th className="px-3 py-2 font-medium">Canal</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Leads</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leadsPorCanal.map((row) => (
                        <tr key={row.channel.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">{row.channel.label}</td>
                          <td className="px-3 py-2 tabular-nums text-text-dim">{row.count}</td>
                          <td className="px-3 py-2 tabular-nums text-text-dim">{formatarReais(row.receita)}</td>
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

              <section>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-text-dim">Gasto de tráfego por dia</h2>
                  <button
                    onClick={() => {
                      setSyncOk(false)
                      syncMutation.mutate()
                    }}
                    disabled={syncMutation.isPending}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-text-dim hover:border-violet hover:text-text disabled:opacity-60"
                  >
                    {syncMutation.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
                  </button>
                </div>
                {syncError && <p className="mt-2 text-xs text-magenta">{syncError}</p>}
                {syncOk && !syncMutation.isPending && (
                  <p className="mt-2 text-xs text-cyan">Sincronizado.</p>
                )}
                <div className="mt-3 overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-left text-xs text-text-faint">
                        <th className="px-3 py-2 font-medium">Dia</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Gasto</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Resultados</th>
                        <th className="px-3 py-2 font-medium tabular-nums">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adSpend.map((row) => (
                        <tr key={row.date} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 tabular-nums">
                            {new Date(row.date).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-text-dim">{formatarReais(row.spend_cents)}</td>
                          <td className="px-3 py-2 tabular-nums text-text-dim">{row.results_count}</td>
                          <td className="px-3 py-2 tabular-nums text-text-dim">
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
