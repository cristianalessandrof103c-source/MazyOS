import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { LeadChatModal } from '../../components/LeadChatModal'
import type { Conversation } from '../../lib/crm-types'

type ConversationRow = Conversation & {
  leads: { full_name: string; phone_number: string | null } | null
}

function formatarUltimaAtividade(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'agora mesmo'
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  return `há ${Math.round(diffH / 24)}d`
}

// Fase 10c (adiantado por pedido do dono) — lista todas as conversas do canal QR (Fase
// 10b), pra ele conseguir ver/continuar qualquer conversa sem precisar reabrir cada lead
// individualmente na Prospecção/CRM.
export function ConversasSection({ tenantId }: { tenantId: string }) {
  const [openChat, setOpenChat] = useState<{ phoneNumber: string; fullName: string } | null>(null)

  const conversationsQuery = useQuery({
    queryKey: ['whatsapp-conversas', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*, leads(full_name, phone_number)')
        .eq('tenant_id', tenantId)
        .not('whatsapp_connection_id', 'is', null)
        .order('last_message_at', { ascending: false })
      if (error) throw error
      return data as ConversationRow[]
    },
    enabled: Boolean(tenantId),
    refetchInterval: 5000,
  })

  const conversations = conversationsQuery.data ?? []

  return (
    <section className="mt-6">
      <h2 className="text-section font-semibold text-text">Conversas</h2>
      <p className="mt-1 text-sm text-text-dim">Todas as conversas de WhatsApp pelo canal conectado via QR Code.</p>

      {conversationsQuery.isLoading && <p className="mt-4 text-text-dim">Carregando…</p>}

      {!conversationsQuery.isLoading && conversations.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
          Nenhuma conversa ainda. Mande uma mensagem pra um lead (CRM ou Prospecção) ou espere alguém escrever pro
          número conectado.
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              onClick={() =>
                c.leads?.phone_number &&
                setOpenChat({ phoneNumber: c.leads.phone_number, fullName: c.leads.full_name })
              }
              disabled={!c.leads?.phone_number}
              className="card-hover flex w-full items-center justify-between rounded-xl border border-border bg-surface-2 p-3 text-left shadow-sm disabled:opacity-60"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{c.leads?.full_name ?? 'Lead removido'}</p>
                <p className="mt-0.5 text-xs text-text-faint">{c.leads?.phone_number ?? 'sem telefone'}</p>
              </div>
              <span className="flex-shrink-0 text-xs text-text-faint">{formatarUltimaAtividade(c.last_message_at)}</span>
            </button>
          </li>
        ))}
      </ul>

      {openChat && (
        <LeadChatModal tenantId={tenantId} phoneNumber={openChat.phoneNumber} fullName={openChat.fullName} onClose={() => setOpenChat(null)} />
      )}
    </section>
  )
}
