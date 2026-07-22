import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { extrairErroFuncao } from '../../lib/functions-error'
import { AGENT_ALL_TOOLS } from '../../lib/broadcast-types'
import type { AgentConfig, WhatsAppConnectionInfo } from '../../lib/broadcast-types'
import type { Membership } from '../../lib/crm-types'

const CONNECTION_STATUS_LABEL: Record<'test' | 'live', string> = { live: 'Produção (live)', test: 'Sandbox (test)' }

function QualityBadge({ quality }: { quality?: string }) {
  if (!quality || quality === 'UNKNOWN') return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-dim">Qualidade desconhecida</span>
  const style = quality === 'GREEN' ? 'bg-success/15 text-success' : quality === 'YELLOW' ? 'bg-warning/15 text-warning' : 'bg-magenta/15 text-magenta'
  return <span className={`rounded-full px-2 py-0.5 text-xs ${style}`}>Qualidade: {quality}</span>
}

export function AgentePage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const { user, isPlatformAdmin } = useAuth()
  const queryClient = useQueryClient()

  const [systemPromptOverride, setSystemPromptOverride] = useState('')
  const [model, setModel] = useState('claude-opus-4-8')
  const [toolsEnabled, setToolsEnabled] = useState<string[]>(AGENT_ALL_TOOLS.map((t) => t.name))
  const [initialized, setInitialized] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const myMembershipQuery = useQuery({
    queryKey: ['my-membership', tenantId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('role')
        .eq('tenant_id', tenantId)
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      if (error) throw error
      return data as { role: Membership['role'] } | null
    },
    enabled: Boolean(tenantId && user),
  })
  const isTenantAdmin = isPlatformAdmin || myMembershipQuery.data?.role === 'tenant_admin'

  const connectionQuery = useQuery({
    queryKey: ['whatsapp-connection-info', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-connection-info', { body: { tenant_id: tenantId } })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao consultar conexão')
      return data.connection as WhatsAppConnectionInfo | null
    },
    enabled: Boolean(tenantId),
  })

  const agentConfigQuery = useQuery({
    queryKey: ['agent-config', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from('agent_configs').select('*').eq('tenant_id', tenantId).maybeSingle()
      if (error) throw error
      return data as AgentConfig | null
    },
    enabled: Boolean(tenantId),
  })

  useEffect(() => {
    if (agentConfigQuery.data && !initialized) {
      setSystemPromptOverride(agentConfigQuery.data.system_prompt_override ?? '')
      setModel(agentConfigQuery.data.model)
      setToolsEnabled(agentConfigQuery.data.tools_enabled)
      setInitialized(true)
    }
  }, [agentConfigQuery.data, initialized])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('agent_configs').upsert(
        {
          tenant_id: tenantId,
          system_prompt_override: systemPromptOverride.trim() || null,
          model: model.trim() || 'claude-opus-4-8',
          tools_enabled: toolsEnabled,
        },
        { onConflict: 'tenant_id' },
      )
      if (error) throw error
    },
    onSuccess: () => {
      setSaveError(null)
      queryClient.invalidateQueries({ queryKey: ['agent-config', tenantId] })
    },
    onError: (err: Error) => setSaveError(err.message),
  })

  function toggleTool(name: string) {
    setToolsEnabled((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]))
  }

  if (!tenantId) return null

  const connection = connectionQuery.data

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <header>
        <p className="eyebrow">Agente</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-text">Agente de IA no WhatsApp</h1>
        <p className="mt-2 text-sm text-text-dim">Conexão do número e comportamento do agente que conversa com os leads.</p>
      </header>

      <section className="mt-6">
        <h2 className="text-section font-semibold text-text">Conexão</h2>

        {connectionQuery.isLoading && <p className="mt-3 text-text-dim">Carregando…</p>}

        {!connectionQuery.isLoading && !connection && (
          <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
            Nenhuma conexão de WhatsApp configurada pra esse tenant ainda.
          </p>
        )}

        {connection && (
          <div className="card mt-3 flex items-center justify-between p-5">
            <div>
              <p className="font-display text-lg font-semibold text-text">{connection.graph?.display_phone_number ?? connection.phone_number_id}</p>
              <p className="text-xs text-text-faint">
                {connection.graph?.verified_name ?? '—'} · {CONNECTION_STATUS_LABEL[connection.status]} · {connection.graph?.platform_type ?? '—'}
              </p>
              {connection.graph_error && <p className="mt-1 text-xs text-magenta">Erro ao consultar a Meta: {connection.graph_error}</p>}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <QualityBadge quality={connection.graph?.quality_rating} />
              <span className="text-xs text-text-faint">
                {connection.graph?.code_verification_status === 'VERIFIED' ? 'Número verificado' : 'Não verificado'}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-section font-semibold text-text">Comportamento do agente</h2>
        <p className="mt-1 text-sm text-text-dim">
          Some ao prompt padrão do agente (não substitui) — use pra ajustar tom, regras específicas do seu negócio, etc.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="card mt-4 flex max-w-2xl flex-col gap-4 p-5"
        >
          <label className="flex flex-col gap-1.5 text-sm text-text-dim">
            Instruções adicionais (opcional)
            <textarea
              rows={6}
              value={systemPromptOverride}
              onChange={(e) => setSystemPromptOverride(e.target.value)}
              disabled={!isTenantAdmin}
              placeholder="Ex: nunca oferecer desconto acima de 10% sem confirmar com um humano."
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-text-dim">
            Modelo
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!isTenantAdmin}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet disabled:opacity-60"
            />
          </label>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-dim">Ações que o agente pode tomar</p>
            {AGENT_ALL_TOOLS.map((tool) => (
              <label key={tool.name} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={toolsEnabled.includes(tool.name)}
                  onChange={() => toggleTool(tool.name)}
                  disabled={!isTenantAdmin}
                />
                {tool.label}
              </label>
            ))}
          </div>

          {saveError && <p className="text-sm text-magenta">{saveError}</p>}

          {isTenantAdmin && (
            <button type="submit" disabled={saveMutation.isPending} className="btn-primary self-start px-4 py-2 text-sm">
              {saveMutation.isPending ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </form>
      </section>
    </TenantSidebarLayout>
  )
}
