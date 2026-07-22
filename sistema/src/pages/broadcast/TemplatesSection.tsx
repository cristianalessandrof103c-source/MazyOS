import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { extrairErroFuncao } from '../../lib/functions-error'
import { NewTemplateDialog } from './NewTemplateDialog'
import type { WhatsAppTemplate, WhatsAppTemplateStatus } from '../../lib/broadcast-types'

const STATUS_LABEL: Record<WhatsAppTemplateStatus, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Em análise',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  DISABLED: 'Desativado',
}

const STATUS_STYLE: Record<WhatsAppTemplateStatus, string> = {
  APPROVED: 'bg-success/15 text-success',
  PENDING: 'bg-warning/15 text-warning',
  REJECTED: 'bg-magenta/15 text-magenta',
  PAUSED: 'bg-surface-2 text-text-dim',
  DISABLED: 'bg-surface-2 text-text-dim',
}

export function TemplatesSection({ tenantId, isTenantAdmin }: { tenantId: string; isTenantAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const templatesQuery = useQuery({
    queryKey: ['whatsapp-templates', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-templates', {
        body: { tenant_id: tenantId, action: 'list' },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao listar templates')
      return data.templates as WhatsAppTemplate[]
    },
    enabled: Boolean(tenantId),
  })

  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.functions.invoke('whatsapp-templates', {
        body: { tenant_id: tenantId, action: 'delete', name },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao remover template')
    },
    onSuccess: () => {
      setActionError(null)
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', tenantId] })
    },
    onError: (err: Error) => setActionError(err.message),
  })

  const templates = templatesQuery.data ?? []

  return (
    <section className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-section font-semibold text-text">Templates (Meta)</h2>
        {isTenantAdmin && (
          <button onClick={() => setShowNew(true)} className="btn-primary px-4 py-2 text-sm">
            + Novo template
          </button>
        )}
      </div>

      {templatesQuery.isLoading && <p className="text-text-dim">Carregando…</p>}
      {templatesQuery.isError && (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-magenta">
          {(templatesQuery.error as Error).message}
        </p>
      )}
      {actionError && <p className="mb-3 text-sm text-magenta">{actionError}</p>}

      {!templatesQuery.isLoading && templates.length === 0 && !templatesQuery.isError && (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
          Nenhum template criado ainda (fora o "hello_world" de exemplo da Meta, que não aparece aqui por não servir pra campanha real).
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {templates.map((t) => {
          const body = t.components.find((c) => c.type === 'BODY')
          return (
            <li key={t.id} className="card card-hover flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text">{t.name}</p>
                  <p className="text-xs text-text-faint">
                    {t.category} · {t.language}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                  {isTenantAdmin && (
                    <button
                      onClick={() => {
                        if (confirm(`Remover o template "${t.name}" da Meta? Campanhas que usam ele vão parar de funcionar.`)) {
                          deleteMutation.mutate(t.name)
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-text-faint hover:text-magenta"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>
              {body?.text && <p className="text-sm text-text-dim">{body.text}</p>}
              {t.status === 'REJECTED' && t.rejected_reason && (
                <p className="text-xs text-magenta">Motivo da rejeição: {t.rejected_reason}</p>
              )}
            </li>
          )
        })}
      </ul>

      {showNew && <NewTemplateDialog tenantId={tenantId} onClose={() => setShowNew(false)} />}
    </section>
  )
}
