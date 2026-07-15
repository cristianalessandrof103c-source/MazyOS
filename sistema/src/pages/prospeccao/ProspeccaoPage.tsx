import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { extrairErroFuncao } from '../../lib/functions-error'
import { ProspectRow } from './ProspectRow'
import type { Prospect, ProspectStatus, ProspeccaoJob } from '../../lib/crm-types'

const SYNC_MAX_RESULTS = 60

const STATUS_FILTER_LABEL: Record<'all' | ProspectStatus, string> = {
  all: 'Todos',
  novo: 'Novo',
  contatado: 'Contatado',
  qualificado: 'Qualificado',
  descartado: 'Descartado',
  convertido: 'Convertido',
}

export function ProspeccaoPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const queryClient = useQueryClient()
  const [niche, setNiche] = useState('')
  const [region, setRegion] = useState('')
  const [targetCount, setTargetCount] = useState(20)
  const [jobId, setJobId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | ProspectStatus>('all')

  const prospectsQuery = useQuery({
    queryKey: ['prospects', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Prospect[]
    },
    enabled: Boolean(tenantId),
  })

  const searchMutation = useMutation({
    mutationFn: async () => {
      // Nome real da function no Supabase ficou "super-function" (o painel web só deixou
      // editar o nome de exibição, não o slug, na primeira vez que foi deployada por lá).
      const { data, error } = await supabase.functions.invoke('super-function', {
        body: { tenant_id: tenantId, niche: niche.trim(), region: region.trim(), target_count: targetCount },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao buscar prospects')
      return data as { mode: 'sync' | 'job'; job_id?: string }
    },
    onSuccess: (data) => {
      setJobId(data.mode === 'job' ? (data.job_id ?? null) : null)
      queryClient.invalidateQueries({ queryKey: ['prospects', tenantId] })
    },
  })

  const jobQuery = useQuery({
    queryKey: ['prospeccao-job', jobId],
    queryFn: async () => {
      const { data, error } = await supabase.from('prospeccao_jobs').select('*').eq('id', jobId).single()
      if (error) throw error
      return data as ProspeccaoJob
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const job = query.state.data as ProspeccaoJob | undefined
      return job?.status === 'processing' ? 4000 : false
    },
  })

  useEffect(() => {
    if (jobQuery.data) {
      queryClient.invalidateQueries({ queryKey: ['prospects', tenantId] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobQuery.data?.found_count, jobQuery.data?.status])

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (!niche.trim() || !region.trim()) return
    searchMutation.mutate()
  }

  if (!tenantId) return null

  const prospects = prospectsQuery.data ?? []
  const filtered = statusFilter === 'all' ? prospects : prospects.filter((p) => p.status === statusFilter)

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <header>
        <p className="eyebrow">Prospecção</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-text">Encontrar novos clientes</h1>
        <p className="mt-1 text-sm text-text-dim">
          Busque empresas por nicho e região (Google Maps) e qualifique manualmente antes de virar lead no CRM.
        </p>
      </header>

      <form onSubmit={handleSearch} className="card mt-6 mb-6 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Nicho
          <input
            required
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="clínica de estética"
            className="w-56 rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Região
          <input
            required
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="Curitiba"
            className="w-56 rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Quantidade a extrair: <span className="text-text">{targetCount}</span>
          <input
            type="range"
            min={20}
            max={1000}
            step={10}
            value={targetCount}
            onChange={(e) => setTargetCount(Number(e.target.value))}
            className="w-56 accent-violet"
          />
          {targetCount > SYNC_MAX_RESULTS && (
            <span className="text-xs text-text-faint">
              Acima de {SYNC_MAX_RESULTS}, vira uma extração em lote (pode levar alguns minutos).
            </span>
          )}
        </label>
        <button
          type="submit"
          disabled={searchMutation.isPending}
          className="rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 text-sm font-medium text-bg disabled:opacity-60"
        >
          {searchMutation.isPending ? 'Buscando no Google Maps…' : 'Buscar'}
        </button>
        {searchMutation.isError && (
          <p className="w-full text-sm text-magenta">{(searchMutation.error as Error).message}</p>
        )}
      </form>

      {jobQuery.data && (
        <div className="card mb-6 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-text-dim">
              {jobQuery.data.status === 'processing' && 'Extraindo em lote…'}
              {jobQuery.data.status === 'done' && 'Extração concluída'}
              {jobQuery.data.status === 'failed' && 'Extração falhou'}
            </span>
            <span className="text-text-faint">
              {jobQuery.data.found_count} de até {jobQuery.data.target_count} — {jobQuery.data.next_cell_index}/
              {jobQuery.data.grid_cells.length} áreas
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet to-cyan transition-all"
              style={{ width: `${Math.min(100, (jobQuery.data.found_count / jobQuery.data.target_count) * 100)}%` }}
            />
          </div>
          {jobQuery.data.status === 'failed' && jobQuery.data.error && (
            <p className="mt-2 text-xs text-magenta">{jobQuery.data.error}</p>
          )}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        {(Object.keys(STATUS_FILTER_LABEL) as (keyof typeof STATUS_FILTER_LABEL)[]).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-full px-3 py-1 text-xs ${
              statusFilter === status ? 'bg-violet/15 text-violet' : 'text-text-dim hover:bg-surface-2'
            }`}
          >
            {STATUS_FILTER_LABEL[status]}
          </button>
        ))}
      </div>

      {prospectsQuery.isLoading && <p className="text-text-dim">Carregando…</p>}

      {!prospectsQuery.isLoading && (
        <ul className="flex flex-col gap-2">
          {filtered.map((prospect) => (
            <ProspectRow key={prospect.id} tenantId={tenantId} prospect={prospect} />
          ))}
          {filtered.length === 0 && (
            <li className="rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
              Nenhum prospect ainda. Busque um nicho e região acima pra começar.
            </li>
          )}
        </ul>
      )}
    </TenantSidebarLayout>
  )
}
