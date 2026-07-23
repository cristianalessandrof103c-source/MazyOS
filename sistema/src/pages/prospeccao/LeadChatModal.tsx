import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import { extrairErroFuncao } from '../../lib/functions-error'
import type { Message } from '../../lib/crm-types'

// Fase 10b — chat de WhatsApp dentro do sistema, via conexão QR (whatsapp-web-send +
// whatsapp-local-agent). Ao abrir, resolve/cria o lead + conversa por telefone (mesmo
// comportamento de quando uma mensagem chega por WhatsApp de alguém novo) — funciona tanto
// pra leads já existentes quanto pra prospects/contatos ainda não convertidos.
export function LeadChatModal({
  tenantId,
  phoneNumber,
  fullName,
  onClose,
}: {
  tenantId: string
  phoneNumber: string
  fullName: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [text, setText] = useState('')

  const openMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-web-send', {
        body: { tenant_id: tenantId, action: 'open', phone_number: phoneNumber, full_name: fullName },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao abrir conversa')
      return data as { lead_id: string; conversation_id: string }
    },
    onSuccess: (data) => setConversationId(data.conversation_id),
  })

  useEffect(() => {
    openMutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const messagesQuery = useQuery({
    queryKey: ['lead-chat-messages', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Message[]
    },
    enabled: Boolean(conversationId),
    refetchInterval: 4000,
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-web-send', {
        body: { tenant_id: tenantId, action: 'send', conversation_id: conversationId, text: text.trim() },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao mandar mensagem')
    },
    onSuccess: () => {
      setText('')
      queryClient.invalidateQueries({ queryKey: ['lead-chat-messages', conversationId] })
    },
  })

  function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || !conversationId) return
    sendMutation.mutate()
  }

  return (
    <Modal title={`WhatsApp — ${fullName}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {openMutation.isPending && <p className="text-sm text-text-dim">Abrindo conversa…</p>}
        {openMutation.isError && <p className="text-sm text-magenta">{(openMutation.error as Error).message}</p>}

        {conversationId && (
          <>
            <p className="text-xs text-text-faint">Isso cria/atualiza um lead no CRM automaticamente.</p>

            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {(messagesQuery.data ?? []).map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    m.direction === 'inbound' ? 'self-start bg-surface-2 text-text' : 'self-end bg-violet/15 text-text'
                  }`}
                >
                  <p>{m.content_text}</p>
                  {m.status === 'queued' && <p className="mt-1 text-[10px] text-text-faint">enviando…</p>}
                  {m.status === 'failed' && <p className="mt-1 text-[10px] text-magenta">falhou ao enviar</p>}
                </div>
              ))}
              {(messagesQuery.data ?? []).length === 0 && <p className="text-sm text-text-faint">Sem mensagens ainda.</p>}
            </div>

            <form onSubmit={handleSend} className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Escreva uma mensagem…"
                className="flex-1 resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-violet"
              />
              <button type="submit" disabled={sendMutation.isPending || !text.trim()} className="btn-primary px-4 py-2 text-sm">
                Enviar
              </button>
            </form>
            {sendMutation.isError && <p className="text-sm text-magenta">{(sendMutation.error as Error).message}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
