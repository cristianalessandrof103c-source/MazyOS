import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import type { Conversation, Message } from '../../lib/crm-types'

const STATUS_LABEL: Record<Conversation['status'], string> = {
  active: 'Ativa',
  needs_human: 'Aguardando humano',
  closed: 'Encerrada',
}

export function ConversationDialog({
  tenantId,
  leadId,
  leadName,
  onClose,
}: {
  tenantId: string
  leadId: string
  leadName: string
  onClose: () => void
}) {
  const conversationQuery = useQuery({
    queryKey: ['conversation', tenantId, leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as Conversation | null
    },
    refetchInterval: 4000,
  })

  const conversation = conversationQuery.data

  const messagesQuery = useQuery({
    queryKey: ['conversation-messages', conversation?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation!.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Message[]
    },
    enabled: Boolean(conversation?.id),
    refetchInterval: 4000,
  })

  return (
    <Modal title={`Conversa — ${leadName}`} onClose={onClose}>
      {!conversation && (
        <p className="text-sm text-text-faint">Nenhuma conversa de WhatsApp ainda com esse lead.</p>
      )}

      {conversation && (
        <div className="flex flex-col gap-3">
          <span className="w-fit rounded-full border border-border px-2 py-0.5 text-xs text-text-dim">
            {STATUS_LABEL[conversation.status]}
          </span>

          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {(messagesQuery.data ?? []).map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.direction === 'inbound'
                    ? 'self-start bg-surface-2 text-text'
                    : 'self-end bg-violet/15 text-text'
                }`}
              >
                <p>{m.content_text}</p>
                {m.tool_calls && m.tool_calls.length > 0 && (
                  <p className="mt-1 text-[10px] text-text-faint">
                    {m.tool_calls.map((t) => t.name).join(', ')}
                  </p>
                )}
              </div>
            ))}
            {(messagesQuery.data ?? []).length === 0 && (
              <p className="text-sm text-text-faint">Sem mensagens ainda.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
