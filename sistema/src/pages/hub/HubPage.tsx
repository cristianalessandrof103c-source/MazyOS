import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { NewCarrosselJobDialog } from './NewCarrosselJobDialog'
import { extrairErroFuncao } from '../../lib/functions-error'
import type { IntegrationHubJob, IntegrationHubStatus, IntegrationHubTool } from '../../lib/crm-types'

const TOOL_LABEL: Record<IntegrationHubTool, string> = {
  carrossel: 'Carrossel',
  instagram_post: 'Instagram',
  seo: 'SEO',
  site: 'Site',
  ads_campaign: 'Campanha Ads',
}

const STATUS_LABEL: Record<IntegrationHubStatus, string> = {
  pending: 'Pendente',
  processing: 'Processando',
  done: 'Concluído',
  failed: 'Falhou',
}

const STATUS_STYLE: Record<IntegrationHubStatus, string> = {
  pending: 'bg-surface-2 text-text-dim',
  processing: 'bg-surface-2 text-text-dim',
  done: 'bg-cyan/15 text-cyan',
  failed: 'bg-magenta/15 text-magenta',
}

export function HubPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const queryClient = useQueryClient()
  const [showNewJob, setShowNewJob] = useState(false)
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({})

  const jobsQuery = useQuery({
    queryKey: ['hub-jobs', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integration_hub_jobs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as IntegrationHubJob[]
    },
    enabled: Boolean(tenantId),
    refetchInterval: (query) => {
      const jobs = query.state.data as IntegrationHubJob[] | undefined
      return jobs?.some((j) => j.status === 'pending' || j.status === 'processing') ? 4000 : false
    },
  })

  const publishMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke('hub-instagram-publish', {
        body: { job_id: jobId },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao publicar')
      return data
    },
    onSuccess: (_data, jobId) => {
      setPublishErrors((prev) => {
        const next = { ...prev }
        delete next[jobId]
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['hub-jobs', tenantId] })
    },
    onError: (err: Error, jobId) => {
      setPublishErrors((prev) => ({ ...prev, [jobId]: err.message }))
    },
  })

  if (!tenantId) return null

  const jobs = jobsQuery.data ?? []

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold">Hub de integrações</h1>
          <p className="mt-1 text-sm text-text-dim">
            Gera carrossel (via worker local) e publica no Instagram sem sair do dashboard.
          </p>
        </div>
        <button
          onClick={() => setShowNewJob(true)}
          className="rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 text-sm font-medium text-bg"
        >
          + Gerar carrossel
        </button>
      </div>

      {jobsQuery.isLoading && <p className="text-text-dim">Carregando…</p>}

      <ul className="flex flex-col gap-3">
          {jobs.map((job) => {
            const isCarrosselDone = job.tool === 'carrossel' && job.status === 'done' && job.result && 'images' in job.result
            const isInstagramDone = job.tool === 'instagram_post' && job.status === 'done' && job.result && 'permalink' in job.result
            const isPublishing = publishMutation.isPending && publishMutation.variables === job.id

            return (
              <li key={job.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="rounded-full bg-violet/15 px-2 py-0.5 text-xs text-violet">
                      {TOOL_LABEL[job.tool]}
                    </span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[job.status]}`}>
                      {STATUS_LABEL[job.status]}
                    </span>
                    {typeof job.params.pasta === 'string' && (
                      <p className="mt-2 text-sm text-text">{job.params.pasta}</p>
                    )}
                    <p className="mt-1 text-xs text-text-faint">
                      {new Date(job.created_at).toLocaleString('pt-BR')}
                    </p>

                    {job.tool === 'carrossel' && job.status === 'pending' && (
                      <p className="mt-2 text-xs text-text-faint">
                        Rode <code className="rounded bg-surface-2 px-1 py-0.5">node scripts/hub-worker.js</code> no
                        terminal pra processar.
                      </p>
                    )}
                    {job.status === 'failed' && job.error && (
                      <p className="mt-2 text-xs text-magenta">{job.error}</p>
                    )}
                    {isInstagramDone && job.result && 'permalink' in job.result && job.result.permalink && (
                      <a
                        href={job.result.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs text-cyan hover:underline"
                      >
                        Ver post →
                      </a>
                    )}
                    {publishErrors[job.id] && (
                      <p className="mt-2 text-xs text-magenta">{publishErrors[job.id]}</p>
                    )}
                  </div>

                  {isCarrosselDone && job.result && 'images' in job.result && (
                    <div className="flex flex-shrink-0 items-center gap-3">
                      <img
                        src={job.result.images[0]}
                        alt="Prévia do carrossel"
                        className="h-16 w-16 rounded-lg border border-border object-cover"
                      />
                      <button
                        onClick={() => publishMutation.mutate(job.id)}
                        disabled={isPublishing}
                        className="rounded-full bg-gradient-to-r from-violet to-cyan px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-60"
                      >
                        {isPublishing ? 'Publicando…' : 'Publicar no Instagram'}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
          {!jobsQuery.isLoading && jobs.length === 0 && (
            <li className="rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
              Nenhum job ainda. Clique em "Gerar carrossel" pra criar o primeiro.
            </li>
          )}
        </ul>

      {showNewJob && <NewCarrosselJobDialog tenantId={tenantId} onClose={() => setShowNewJob(false)} />}
    </TenantSidebarLayout>
  )
}
