import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { extrairErroFuncao } from '../../lib/functions-error'
import { GlobeIcon, InstagramIcon, LinkedinIcon, MapPinIcon, RefreshIcon, WhatsAppIcon } from '../../components/icons'
import { LeadChatModal } from './LeadChatModal'
import type { Prospect, ProspectStatus } from '../../lib/crm-types'

const STATUS_LABEL: Record<ProspectStatus, string> = {
  novo: 'Novo',
  contatado: 'Contatado',
  qualificado: 'Qualificado',
  descartado: 'Descartado',
  convertido: 'Convertido',
}

const EDITABLE_STATUSES: ProspectStatus[] = ['novo', 'contatado', 'qualificado', 'descartado']

function scoreBarColor(score: number): string {
  if (score >= 80) return 'bg-success'
  if (score >= 50) return 'bg-warning'
  return 'bg-magenta'
}

function scoreTextColor(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 50) return 'text-warning'
  return 'text-magenta'
}

export function ProspectRow({
  tenantId,
  prospect,
  whatsappConnected,
}: {
  tenantId: string
  prospect: Prospect
  whatsappConnected: boolean
}) {
  const queryClient = useQueryClient()
  const [showChat, setShowChat] = useState(false)
  const [reavaliarError, setReavaliarError] = useState<string | null>(null)

  const statusMutation = useMutation({
    mutationFn: async (status: ProspectStatus) => {
      const { error } = await supabase.from('prospects').update({ status }).eq('id', prospect.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects', tenantId] }),
  })

  const convertMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('convert_prospect_to_lead', { p_prospect_id: prospect.id })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospects', tenantId] })
      queryClient.invalidateQueries({ queryKey: ['leads', tenantId] })
    },
  })

  const reavaliarMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('prospeccao-avaliar-site', {
        body: { prospect_id: prospect.id },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao reavaliar site')
    },
    onSuccess: () => {
      setReavaliarError(null)
      queryClient.invalidateQueries({ queryKey: ['prospects', tenantId] })
    },
    onError: (err: Error) => setReavaliarError(err.message),
  })

  const isConverted = prospect.status === 'convertido'
  const siteNaoAvaliado = Boolean(prospect.website) && prospect.site_reachable === null

  return (
    <li className="card-hover rounded-xl border border-border bg-surface-2 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{prospect.name}</p>
          <p className="mt-0.5 text-xs text-text-faint">
            {prospect.phone_number ?? 'sem telefone'}
            {prospect.formatted_address && ` · ${prospect.formatted_address}`}
          </p>

          <div className="mt-2 flex items-center gap-3">
            {prospect.website && (
              <a href={prospect.website} target="_blank" rel="noreferrer" title="Abrir site" className="text-text-dim hover:text-cyan">
                <GlobeIcon />
              </a>
            )}
            {prospect.google_maps_url && (
              <a href={prospect.google_maps_url} target="_blank" rel="noreferrer" title="Abrir no Google Maps" className="text-text-dim hover:text-cyan">
                <MapPinIcon />
              </a>
            )}
            {prospect.instagram_url && (
              <a href={prospect.instagram_url} target="_blank" rel="noreferrer" title="Abrir Instagram" className="text-text-dim hover:text-cyan">
                <InstagramIcon />
              </a>
            )}
            {prospect.linkedin_url && (
              <a href={prospect.linkedin_url} target="_blank" rel="noreferrer" title="Abrir LinkedIn" className="text-text-dim hover:text-cyan">
                <LinkedinIcon />
              </a>
            )}

            {prospect.phone_number && (
              <button
                onClick={() => whatsappConnected && setShowChat(true)}
                disabled={!whatsappConnected}
                title={whatsappConnected ? 'Conversar no WhatsApp' : 'Conecte o WhatsApp em Disparos → WhatsApp'}
                className={whatsappConnected ? 'text-success hover:text-success/80' : 'cursor-not-allowed text-text-faint/50'}
              >
                <WhatsAppIcon />
              </button>
            )}

            {siteNaoAvaliado && (
              <button
                onClick={() => reavaliarMutation.mutate()}
                disabled={reavaliarMutation.isPending}
                title="Reavaliar qualidade do site"
                className={`text-text-faint hover:text-text-dim ${reavaliarMutation.isPending ? 'animate-spin' : ''}`}
              >
                <RefreshIcon />
              </button>
            )}
          </div>

          {reavaliarError && <p className="mt-1 text-xs text-magenta">{reavaliarError}</p>}

          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface">
              <div
                className={`h-full rounded-full ${scoreBarColor(prospect.quality_score)}`}
                style={{ width: `${prospect.quality_score}%` }}
              />
            </div>
            <span className={`text-xs font-medium ${scoreTextColor(prospect.quality_score)}`}>{prospect.quality_score}</span>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {isConverted ? (
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">Convertido</span>
          ) : (
            <select
              value={prospect.status}
              onChange={(e) => statusMutation.mutate(e.target.value as ProspectStatus)}
              className="rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text-dim outline-none"
            >
              {EDITABLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          )}

          {!isConverted && (
            <button
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending}
              className="whitespace-nowrap rounded-lg border border-violet/40 px-2 py-1 text-xs text-violet hover:bg-violet/10 disabled:opacity-60"
            >
              {convertMutation.isPending ? 'Convertendo…' : 'Converter em lead'}
            </button>
          )}
          {convertMutation.isError && (
            <p className="max-w-[12rem] text-right text-xs text-magenta">{(convertMutation.error as Error).message}</p>
          )}
        </div>
      </div>

      {showChat && prospect.phone_number && (
        <LeadChatModal tenantId={tenantId} phoneNumber={prospect.phone_number} fullName={prospect.name} onClose={() => setShowChat(false)} />
      )}
    </li>
  )
}
