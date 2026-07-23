import { useState } from 'react'
import type { AcquisitionChannel, Lead, PipelineStage } from '../../lib/crm-types'

export function LeadCard({
  lead,
  stages,
  channel,
  onMove,
  onRegisterSale,
  onOpenConversation,
}: {
  lead: Lead
  stages: PipelineStage[]
  channel: AcquisitionChannel | undefined
  onMove: (stageId: string) => void
  onRegisterSale: () => void
  onOpenConversation: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const currentStage = stages.find((s) => s.id === lead.stage_id)
  const canRegisterSale = currentStage?.category === 'new' || currentStage?.category === 'in_progress'

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', lead.id)
        e.dataTransfer.effectAllowed = 'move'
        setIsDragging(true)
      }}
      onDragEnd={() => setIsDragging(false)}
      className={`card-hover cursor-grab rounded-xl border border-border bg-surface-2 p-3 shadow-sm active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <p className="font-medium">{lead.full_name}</p>
      <p className="mt-0.5 text-xs text-text-faint">
        {lead.phone_number || lead.email || 'sem contato'} · {channel?.label ?? 'canal desconhecido'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={lead.stage_id}
          onChange={(e) => onMove(e.target.value)}
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
            className="whitespace-nowrap rounded-lg border border-violet/40 px-2 py-1 text-xs text-violet hover:bg-violet/10"
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
