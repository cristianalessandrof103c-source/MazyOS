import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { NewCarrosselJobDialog } from './NewCarrosselJobDialog'
import { extrairErroFuncao } from '../../lib/functions-error'
import type {
  CarrosselDraftResult,
  CarrosselSlideDraft,
  IntegrationHubJob,
  IntegrationHubStatus,
  IntegrationHubTool,
} from '../../lib/crm-types'

const TOOL_LABEL: Record<IntegrationHubTool, string> = {
  carrossel: 'Carrossel',
  instagram_post: 'Instagram',
  seo: 'SEO',
  site: 'Site',
  ads_campaign: 'Campanha Ads',
}

const STATUS_LABEL: Record<IntegrationHubStatus, string> = {
  pending: 'Pendente',
  awaiting_approval: 'Aguardando revisão',
  processing: 'Processando',
  done: 'Concluído',
  failed: 'Falhou',
}

const STATUS_STYLE: Record<IntegrationHubStatus, string> = {
  pending: 'bg-surface-2 text-text-dim',
  awaiting_approval: 'bg-violet/15 text-violet',
  processing: 'bg-surface-2 text-text-dim',
  done: 'bg-success/15 text-success',
  failed: 'bg-magenta/15 text-magenta',
}

function CarrosselDraftReview({ tenantId, job }: { tenantId: string; job: IntegrationHubJob }) {
  const queryClient = useQueryClient()
  const draft = (job.result as CarrosselDraftResult | null)?.draft
  const [slides, setSlides] = useState<CarrosselSlideDraft[]>(draft?.slides ?? [])
  const [caption, setCaption] = useState(draft?.caption ?? '')
  const [error, setError] = useState<string | null>(null)

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('hub-render-carrossel', {
        body: { job_id: job.id, slides, caption },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao renderizar')
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['hub-jobs', tenantId] })
    },
    onError: (err: Error) => setError(err.message),
  })

  if (!draft) return null

  function updateSlide(i: number, field: 'title' | 'body', value: string) {
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
      {slides.map((slide, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-text-faint">
            Slide {i + 1} · {slide.layout}
          </span>
          <input
            value={slide.title}
            onChange={(e) => updateSlide(i, 'title', e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-violet"
          />
          {typeof slide.body === 'string' && (
            <textarea
              value={slide.body}
              onChange={(e) => updateSlide(i, 'body', e.target.value)}
              rows={2}
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-violet"
            />
          )}
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-text-faint">Legenda</span>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-violet"
        />
      </div>
      {error && <p className="text-xs text-magenta">{error}</p>}
      <button
        onClick={() => approveMutation.mutate()}
        disabled={approveMutation.isPending}
        className="btn-primary self-start px-4 py-1.5 text-xs"
      >
        {approveMutation.isPending ? 'Renderizando…' : 'Aprovar e renderizar'}
      </button>
    </div>
  )
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
      <header className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Hub de integrações</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-text">Automação de conteúdo</h1>
          <p className="mt-1 text-sm text-text-dim">
            Gera carrossel com IA e publica no Instagram sem sair do dashboard.
          </p>
        </div>
        <button onClick={() => setShowNewJob(true)} className="btn-primary px-4 py-2 text-sm">
          + Gerar carrossel
        </button>
      </header>

      {jobsQuery.isLoading && <p className="mt-6 text-text-dim">Carregando…</p>}

      <ul className="mt-6 flex flex-col gap-4">
          {jobs.map((job) => {
            const isCarrosselDone = job.tool === 'carrossel' && job.status === 'done' && job.result && 'images' in job.result
            const isInstagramDone = job.tool === 'instagram_post' && job.status === 'done' && job.result && 'permalink' in job.result
            const isPublishing = publishMutation.isPending && publishMutation.variables === job.id

            return (
              <li key={job.id} className="card card-hover p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <span className="rounded-full bg-violet/15 px-2 py-0.5 text-xs text-violet">
                      {TOOL_LABEL[job.tool]}
                    </span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[job.status]}`}>
                      {STATUS_LABEL[job.status]}
                    </span>
                    {typeof job.params.tema === 'string' && (
                      <p className="mt-2 text-sm text-text">{job.params.tema}</p>
                    )}
                    <p className="mt-1 text-xs text-text-faint">
                      {new Date(job.created_at).toLocaleString('pt-BR')}
                    </p>

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

                    {job.tool === 'carrossel' && job.status === 'awaiting_approval' && (
                      <CarrosselDraftReview tenantId={tenantId} job={job} />
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
                        className="btn-primary px-3 py-1.5 text-xs"
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
