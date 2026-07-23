import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { NewLeadDialog } from './NewLeadDialog'
import { CloseDealDialog } from './CloseDealDialog'
import { LeadCard } from './LeadCard'
import { ConversationDialog } from './ConversationDialog'
import type { AcquisitionChannel, Lead, PipelineStage } from '../../lib/crm-types'

export function CrmPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const queryClient = useQueryClient()
  const [showNewLead, setShowNewLead] = useState(false)
  const [dealLead, setDealLead] = useState<Lead | null>(null)
  const [dealOutcome, setDealOutcome] = useState<'won' | 'lost'>('won')
  const [conversationLead, setConversationLead] = useState<Lead | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)

  const stagesQuery = useQuery({
    queryKey: ['pipeline-stages', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
        .order('order_index')
      if (error) throw error
      return data as PipelineStage[]
    },
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
  })

  const leadsQuery = useQuery({
    queryKey: ['leads', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Lead[]
    },
    enabled: Boolean(tenantId),
  })

  const moveMutation = useMutation({
    mutationFn: async ({ leadId, stageId }: { leadId: string; stageId: string }) => {
      const { error } = await supabase.from('leads').update({ stage_id: stageId }).eq('id', leadId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads', tenantId] }),
  })

  if (!tenantId) return null

  const stages = stagesQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const leads = leadsQuery.data ?? []

  const newStage = stages.find((s) => s.category === 'new')
  const wonStage = stages.find((s) => s.category === 'won')
  const lostStage = stages.find((s) => s.category === 'lost')

  const loading = stagesQuery.isLoading || channelsQuery.isLoading || leadsQuery.isLoading

  // Arrastar (ou trocar pelo select) pra uma coluna Ganha/Perdida abre o mesmo formulário do
  // botão "Registrar venda" em vez de mover direto -- senão a receita/CAC do Financeiro nunca
  // seria registrada pra esse lead.
  function handleMoveLead(lead: Lead, targetStage: PipelineStage) {
    if (targetStage.id === lead.stage_id) return
    if (targetStage.category === 'won' || targetStage.category === 'lost') {
      setDealOutcome(targetStage.category)
      setDealLead(lead)
      return
    }
    moveMutation.mutate({ leadId: lead.id, stageId: targetStage.id })
  }

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <header className="flex items-end justify-between">
        <div>
          <p className="eyebrow">CRM</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-text">Pipeline de leads</h1>
        </div>
        {newStage && (
          <button onClick={() => setShowNewLead(true)} className="btn-primary px-4 py-2 text-sm">
            + Novo lead
          </button>
        )}
      </header>

      {loading && <p className="mt-6 text-text-dim">Carregando…</p>}

      {!loading && (
        <div className="mt-6 flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const stageLeads = leads.filter((l) => l.stage_id === stage.id)
            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverStageId(stage.id)
                }}
                onDragLeave={() => setDragOverStageId((current) => (current === stage.id ? null : current))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverStageId(null)
                  const leadId = e.dataTransfer.getData('text/plain')
                  const lead = leads.find((l) => l.id === leadId)
                  if (lead) handleMoveLead(lead, stage)
                }}
                className={`w-72 flex-shrink-0 rounded-xl transition-colors ${
                  dragOverStageId === stage.id ? 'bg-violet/5 outline-dashed outline-2 outline-violet/50' : ''
                }`}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-sm font-medium text-text-dim">{stage.name}</h2>
                  <span className="text-xs text-text-faint">{stageLeads.length}</span>
                </div>
                <ul className="flex min-h-8 flex-col gap-2 p-1">
                  {stageLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      stages={stages}
                      channel={channels.find((c) => c.id === lead.acquisition_channel_id)}
                      onMove={(stageId) => {
                        const targetStage = stages.find((s) => s.id === stageId)
                        if (targetStage) handleMoveLead(lead, targetStage)
                      }}
                      onRegisterSale={() => {
                        setDealOutcome('won')
                        setDealLead(lead)
                      }}
                      onOpenConversation={() => setConversationLead(lead)}
                    />
                  ))}
                  {stageLeads.length === 0 && (
                    <li className="rounded-xl border border-dashed border-border p-3 text-xs text-text-faint">
                      Vazio
                    </li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {showNewLead && newStage && (
        <NewLeadDialog
          tenantId={tenantId}
          newStageId={newStage.id}
          channels={channels}
          onClose={() => setShowNewLead(false)}
        />
      )}

      {dealLead && wonStage && lostStage && (
        <CloseDealDialog
          tenantId={tenantId}
          lead={dealLead}
          wonStage={wonStage}
          lostStage={lostStage}
          initialOutcome={dealOutcome}
          onClose={() => setDealLead(null)}
        />
      )}

      {conversationLead && (
        <ConversationDialog
          tenantId={tenantId}
          leadId={conversationLead.id}
          leadName={conversationLead.full_name}
          onClose={() => setConversationLead(null)}
        />
      )}
    </TenantSidebarLayout>
  )
}
