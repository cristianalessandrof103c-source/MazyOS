import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import type { BroadcastList, WhatsAppConnection } from '../../lib/broadcast-types'

const CONNECTION_STATUS_LABEL: Record<WhatsAppConnection['status'], string> = {
  live: 'produção (live)',
  test: 'sandbox (test)',
}

export function NewCampaignDialog({ tenantId, lists, onClose }: { tenantId: string; lists: BroadcastList[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [listId, setListId] = useState(lists[0]?.id ?? '')
  const [connectionId, setConnectionId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateLanguage, setTemplateLanguage] = useState('pt_BR')
  const [variableMapping, setVariableMapping] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const connectionsQuery = useQuery({
    queryKey: ['whatsapp-connections', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from('whatsapp_connections').select('*').eq('tenant_id', tenantId)
      if (error) throw error
      const connections = data as WhatsAppConnection[]
      if (!connectionId && connections.length > 0) {
        setConnectionId(connections.find((c) => c.status === 'live')?.id ?? connections[0].id)
      }
      return connections
    },
    enabled: Boolean(tenantId),
  })

  const selectedList = lists.find((l) => l.id === listId)
  const variableOptions = ['full_name', ...(selectedList?.extra_field_keys ?? [])]

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('broadcast_campaigns').insert({
        tenant_id: tenantId,
        list_id: listId,
        whatsapp_connection_id: connectionId,
        name: name.trim(),
        template_name: templateName.trim(),
        template_language: templateLanguage.trim() || 'pt_BR',
        variable_mapping: variableMapping,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcast-campaigns', tenantId] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!listId || !connectionId) return
    mutation.mutate()
  }

  function toggleVariable(key: string) {
    setVariableMapping((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  return (
    <Modal title="Nova campanha" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Nome da campanha
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Promoção de julho"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Lista de contatos
          <select
            required
            value={listId}
            onChange={(e) => {
              setListId(e.target.value)
              setVariableMapping([])
            }}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          >
            {lists.length === 0 && <option value="">Nenhuma lista criada ainda</option>}
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Conexão de WhatsApp
          <select
            required
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          >
            {(connectionsQuery.data ?? []).length === 0 && <option value="">Nenhuma conexão configurada</option>}
            {(connectionsQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.phone_number_id} ({CONNECTION_STATUS_LABEL[c.status]})
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-text-dim">
            Nome do Template (Meta)
            <input
              required
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="promocao_julho"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
            />
          </label>
          <label className="flex w-28 flex-col gap-1.5 text-sm text-text-dim">
            Idioma
            <input
              value={templateLanguage}
              onChange={(e) => setTemplateLanguage(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5 text-sm text-text-dim">
          Variáveis do Template (na ordem {'{{1}}, {{2}}...'})
          <div className="flex flex-wrap gap-2">
            {variableOptions.map((key) => {
              const order = variableMapping.indexOf(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleVariable(key)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    order >= 0 ? 'border-violet bg-violet/15 text-violet' : 'border-border text-text-dim hover:border-violet'
                  }`}
                >
                  {key === 'full_name' ? 'nome' : key}
                  {order >= 0 && ` {{${order + 1}}}`}
                </button>
              )
            })}
          </div>
          {variableOptions.length === 1 && (
            <p className="text-xs text-text-faint">Essa lista só tem a coluna de nome — importe um CSV com colunas extras pra ter mais variáveis.</p>
          )}
        </div>

        {error && <p className="text-sm text-magenta">{error}</p>}

        <button type="submit" disabled={mutation.isPending || !listId || !connectionId} className="btn-primary mt-2 px-4 py-2.5">
          {mutation.isPending ? 'Criando…' : 'Criar campanha (rascunho)'}
        </button>
      </form>
    </Modal>
  )
}
