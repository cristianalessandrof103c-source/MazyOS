import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { extrairErroFuncao } from '../../lib/functions-error'
import type { BroadcastCampaign, BroadcastRecipientCounts, BroadcastRecipientStatus } from '../../lib/broadcast-types'

const STATUS_LABEL: Record<BroadcastCampaign['status'], string> = {
  draft: 'Rascunho',
  sending: 'Enviando',
  paused: 'Pausada',
  done: 'Concluída',
  failed: 'Falhou',
}

const STATUS_STYLE: Record<BroadcastCampaign['status'], string> = {
  draft: 'bg-surface-2 text-text-dim',
  sending: 'bg-cyan/15 text-cyan',
  paused: 'bg-warning/15 text-warning',
  done: 'bg-success/15 text-success',
  failed: 'bg-magenta/15 text-magenta',
}

const RECIPIENT_STATUSES: BroadcastRecipientStatus[] = ['pending', 'sending', 'sent', 'failed', 'skipped']

async function contarPorStatus(campaignId: string): Promise<BroadcastRecipientCounts> {
  const entries = await Promise.all(
    RECIPIENT_STATUSES.map(async (status) => {
      const { count, error } = await supabase
        .from('broadcast_campaign_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', status)
      if (error) throw error
      return [status, count ?? 0] as const
    }),
  )
  return Object.fromEntries(entries) as BroadcastRecipientCounts
}

export function CampaignCard({ tenantId, campaign, isTenantAdmin }: { tenantId: string; campaign: BroadcastCampaign; isTenantAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const [showTestInput, setShowTestInput] = useState(false)
  const [testPhone, setTestPhone] = useState('')

  const countsQuery = useQuery({
    queryKey: ['broadcast-recipient-counts', campaign.id],
    queryFn: () => contarPorStatus(campaign.id),
    enabled: campaign.status !== 'draft',
    refetchInterval: campaign.status === 'sending' ? 5000 : false,
  })

  const controlMutation = useMutation({
    mutationFn: async (action: 'start' | 'pause' | 'resume' | 'test') => {
      const { data, error } = await supabase.functions.invoke('broadcast-campaign-control', {
        body: { tenant_id: tenantId, campaign_id: campaign.id, action, test_phone_number: action === 'test' ? testPhone.trim() : undefined },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha na ação')
      return data
    },
    onSuccess: (_data, action) => {
      setActionError(null)
      if (action === 'test') setShowTestInput(false)
      queryClient.invalidateQueries({ queryKey: ['broadcast-campaigns', tenantId] })
      queryClient.invalidateQueries({ queryKey: ['broadcast-recipient-counts', campaign.id] })
    },
    onError: (err: Error) => setActionError(err.message),
  })

  const counts = countsQuery.data
  const totalDone = counts ? counts.sent + counts.failed + counts.skipped : 0
  const progressPct = campaign.total_recipients > 0 ? Math.min(100, (totalDone / campaign.total_recipients) * 100) : 0

  return (
    <li className="card card-hover flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text">{campaign.name}</p>
          <p className="text-xs text-text-faint">
            Template: {campaign.template_name} ({campaign.template_language})
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[campaign.status]}`}>{STATUS_LABEL[campaign.status]}</span>
      </div>

      {campaign.status !== 'draft' && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-faint">
            <span>
              {totalDone} de {campaign.total_recipients} processados
            </span>
            {counts && <span>{counts.sent} enviados · {counts.failed} falharam · {counts.pending + counts.sending} pendentes</span>}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-violet to-cyan transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {actionError && <p className="text-sm text-magenta">{actionError}</p>}

      {isTenantAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === 'draft' && (
            <button onClick={() => controlMutation.mutate('start')} disabled={controlMutation.isPending} className="btn-primary px-3 py-1.5 text-xs">
              Iniciar disparo
            </button>
          )}
          {campaign.status === 'sending' && (
            <button
              onClick={() => controlMutation.mutate('pause')}
              disabled={controlMutation.isPending}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:border-violet hover:text-text disabled:opacity-60"
            >
              Pausar
            </button>
          )}
          {campaign.status === 'paused' && (
            <button onClick={() => controlMutation.mutate('resume')} disabled={controlMutation.isPending} className="btn-primary px-3 py-1.5 text-xs">
              Retomar
            </button>
          )}
          {(campaign.status === 'draft' || campaign.status === 'paused') &&
            (showTestInput ? (
              <div className="flex items-center gap-2">
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="55DDNÚMERO"
                  className="w-40 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-text outline-none focus:border-violet"
                />
                <button
                  onClick={() => controlMutation.mutate('test')}
                  disabled={controlMutation.isPending || !testPhone.trim()}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:border-violet hover:text-text disabled:opacity-60"
                >
                  {controlMutation.isPending ? 'Enviando…' : 'Confirmar teste'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowTestInput(true)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:border-violet hover:text-text"
              >
                Enviar teste
              </button>
            ))}
        </div>
      )}
    </li>
  )
}
