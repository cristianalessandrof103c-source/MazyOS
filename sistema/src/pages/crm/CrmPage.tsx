import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { NewLeadDialog } from './NewLeadDialog'
import { CloseDealDialog } from './CloseDealDialog'
import { LeadCard } from './LeadCard'
import { ConversationDialog } from './ConversationDialog'
import type { AcquisitionChannel, Lead, PipelineStage } from '../../lib/crm-types'

export function CrmPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const [showNewLead, setShowNewLead] = useState(false)
  const [dealLead, setDealLead] = useState<Lead | null>(null)
  const [conversationLead, setConversationLead] = useState<Lead | null>(null)

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

  if (!tenantId) return null

  const stages = stagesQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const leads = leadsQuery.data ?? []

  const newStage = stages.find((s) => s.category === 'new')
  const wonStage = stages.find((s) => s.category === 'won')
  const lostStage = stages.find((s) => s.category === 'lost')

  const loading = stagesQuery.isLoading || channelsQuery.isLoading || leadsQuery.isLoading

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <header className="flex items-end justify-between">
        <div>
          <p className="eyebrow">CRM</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-text">Pipeline de leads</h1>
        </div>
        {newStage && (
          <button
            onClick={() => setShowNewLead(true)}
            className="rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 text-sm font-medium text-bg"
          >
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
              <div key={stage.id} className="w-72 flex-shrink-0">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-text-dim">{stage.name}</h2>
                  <span className="text-xs text-text-faint">{stageLeads.length}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {stageLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      tenantId={tenantId}
                      lead={lead}
                      stages={stages}
                      channel={channels.find((c) => c.id === lead.acquisition_channel_id)}
                      onRegisterSale={() => setDealLead(lead)}
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
