import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { AcquisitionChannel, Lead, PipelineStage } from '../../lib/crm-types'

export function LeadCard({
  tenantId,
  lead,
  stages,
  channel,
  onRegisterSale,
  onOpenConversation,
}: {
  tenantId: string
  lead: Lead
  stages: PipelineStage[]
  channel: AcquisitionChannel | undefined
  onRegisterSale: () => void
  onOpenConversation: () => void
}) {
  const queryClient = useQueryClient()
  const currentStage = stages.find((s) => s.id === lead.stage_id)

  const moveMutation = useMutation({
    mutationFn: async (stageId: string) => {
      const { error } = await supabase.from('leads').update({ stage_id: stageId }).eq('id', lead.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads', tenantId] }),
  })

  const canRegisterSale = currentStage?.category === 'new' || currentStage?.category === 'in_progress'

  return (
    <li className="rounded-xl border border-border bg-surface-2 p-3 shadow-sm">
      <p className="font-medium">{lead.full_name}</p>
      <p className="mt-0.5 text-xs text-text-faint">
        {lead.phone_number || lead.email || 'sem contato'} · {channel?.label ?? 'canal desconhecido'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={lead.stage_id}
          onChange={(e) => moveMutation.mutate(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text-dim outline-none"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {canRegisterSale && (
          <button
            onClick={onRegisterSale}
            className="whitespace-nowrap rounded-full border border-violet/40 px-2 py-1 text-xs text-violet hover:bg-violet/10"
          >
            Registrar venda
          </button>
        )}
      </div>

      <button
        onClick={onOpenConversation}
        className="mt-2 text-xs text-text-faint hover:text-text-dim"
      >
        Ver conversa
      </button>
    </li>
  )
}
