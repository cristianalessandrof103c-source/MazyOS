import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../../lib/supabase'
import { extrairErroFuncao } from '../../lib/functions-error'
import type { WhatsAppConnection } from '../../lib/broadcast-types'

function formatarUltimaAtividade(iso: string | null): string {
  if (!iso) return 'nunca'
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'agora mesmo'
  if (diffMin < 60) return `há ${diffMin} min`
  return `há ${Math.round(diffMin / 60)}h`
}

export function WhatsAppWebSection({ tenantId, isTenantAdmin }: { tenantId: string; isTenantAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const connectionQuery = useQuery({
    queryKey: ['whatsapp-web-connection', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_connections')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('connection_type', 'qr_web')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as WhatsAppConnection | null
    },
    enabled: Boolean(tenantId),
    refetchInterval: 3000,
  })

  const connection = connectionQuery.data ?? null
  const hasActiveToken = Boolean(connection?.web_device_token_hash)

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-web-connection', {
        body: { tenant_id: tenantId, action: 'create' },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao criar conexão')
      return data as { connection_id: string; device_token: string }
    },
    onSuccess: (data) => {
      setActionError(null)
      setJustCreatedToken(data.device_token)
      queryClient.invalidateQueries({ queryKey: ['whatsapp-web-connection', tenantId] })
    },
    onError: (err: Error) => setActionError(err.message),
  })

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!connection) return
      const { data, error } = await supabase.functions.invoke('whatsapp-web-connection', {
        body: { tenant_id: tenantId, action: 'disconnect', connection_id: connection.id },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao desconectar')
    },
    onSuccess: () => {
      setActionError(null)
      setJustCreatedToken(null)
      queryClient.invalidateQueries({ queryKey: ['whatsapp-web-connection', tenantId] })
    },
    onError: (err: Error) => setActionError(err.message),
  })

  return (
    <section className="mt-6 flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-section font-semibold text-text">WhatsApp Web</h2>
        <p className="mt-1 text-sm text-text-dim">
          Conexão não-oficial via QR Code (como o WhatsApp Web normal) — sem exigir Template
          aprovado pela Meta, mas depende de um agente rodando no seu computador. Coexiste com o
          disparo oficial da aba Campanhas.
        </p>
      </div>

      {actionError && <p className="text-sm text-magenta">{actionError}</p>}

      {justCreatedToken && (
        <div className="card border border-violet/40 p-5">
          <p className="text-sm font-medium text-text">Token do dispositivo (só aparece uma vez)</p>
          <p className="mt-1 text-xs text-text-faint">
            Copie e cole no arquivo <code>.env</code> do agente local (pasta{' '}
            <code>whatsapp-local-agent/</code>, variável <code>DEVICE_TOKEN</code>). Se fechar sem
            copiar, é só clicar em "Conectar WhatsApp" de novo pra gerar outro.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text">
              {justCreatedToken}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(justCreatedToken)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-dim hover:border-violet hover:text-text"
            >
              Copiar
            </button>
          </div>
          <button onClick={() => setJustCreatedToken(null)} className="mt-3 text-xs text-text-faint hover:text-text">
            Já copiei, esconder
          </button>
        </div>
      )}

      <div className="card p-5">
        {!hasActiveToken && (
          <div className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-text-faint" />
              <p className="text-sm text-text">WhatsApp Web não conectado</p>
            </div>
            <p className="text-xs text-text-faint">
              Clique em conectar, copie o token, e siga as instruções do{' '}
              <code>whatsapp-local-agent/README.md</code> pra rodar o agente local.
            </p>
            {isTenantAdmin && (
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="btn-primary px-4 py-2 text-sm"
              >
                {createMutation.isPending ? 'Gerando…' : 'Conectar WhatsApp'}
              </button>
            )}
          </div>
        )}

        {hasActiveToken && connection?.web_status === 'qr_pending' && connection.qr_pairing_code && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={connection.qr_pairing_code} size={200} />
            </div>
            <p className="text-sm text-text">Escaneie no WhatsApp do celular</p>
            <p className="text-xs text-text-faint">
              Aparelhos conectados → Conectar um aparelho. O código se renova sozinho a cada ~20s
              enquanto não escanear.
            </p>
            {isTenantAdmin && (
              <button
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="text-xs text-text-faint hover:text-magenta"
              >
                Cancelar
              </button>
            )}
          </div>
        )}

        {hasActiveToken && connection?.web_status === 'disconnected' && (
          <div className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-warning" />
              <p className="text-sm text-text">Aguardando o agente local iniciar…</p>
            </div>
            <p className="text-xs text-text-faint">
              Token já gerado. Rode <code>npm start</code> na pasta <code>whatsapp-local-agent/</code>{' '}
              no seu computador — o QR Code aparece aqui assim que o agente subir.
            </p>
            {isTenantAdmin && (
              <button
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-dim hover:border-magenta hover:text-magenta"
              >
                Revogar token
              </button>
            )}
          </div>
        )}

        {hasActiveToken && connection?.web_status === 'connected' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              <div>
                <p className="text-sm text-text">
                  Conectado{connection.connected_phone_number ? ` — ${connection.connected_phone_number}` : ''}
                </p>
                <p className="text-xs text-text-faint">Última atividade: {formatarUltimaAtividade(connection.last_seen_at)}</p>
              </div>
            </div>
            {isTenantAdmin && (
              <button
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-dim hover:border-magenta hover:text-magenta"
              >
                Desconectar
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
