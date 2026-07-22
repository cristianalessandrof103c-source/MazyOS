export type BroadcastList = {
  id: string
  tenant_id: string
  name: string
  extra_field_keys: string[]
  created_at: string
}

export type BroadcastContact = {
  id: string
  tenant_id: string
  list_id: string
  full_name: string
  phone_number: string
  opted_out: boolean
  extra_fields: Record<string, unknown>
  created_at: string
}

export type BroadcastCampaignStatus = 'draft' | 'sending' | 'paused' | 'done' | 'failed'

export type BroadcastCampaign = {
  id: string
  tenant_id: string
  list_id: string
  whatsapp_connection_id: string
  name: string
  template_name: string
  template_language: string
  variable_mapping: string[]
  status: BroadcastCampaignStatus
  total_recipients: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type BroadcastRecipientStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'

export type BroadcastRecipientCounts = Record<BroadcastRecipientStatus, number>

// whatsapp_connections (0004_whatsapp_agent.sql) não tinha tipo no frontend porque não
// tinha UI nenhuma até agora — precisamos dele só pra popular o dropdown de conexão na
// criação de campanha. Fase 10a acrescenta o tipo qr_web (WhatsApp Web via QR Code,
// coexistindo com a Cloud API oficial) — ver 0016_whatsapp_web_qr.sql.
export type WhatsAppConnectionType = 'cloud_api' | 'qr_web'
export type WhatsAppWebStatus = 'disconnected' | 'qr_pending' | 'connected'

export type WhatsAppConnection = {
  id: string
  tenant_id: string
  connection_type: WhatsAppConnectionType
  phone_number_id: string | null
  business_account_id: string | null
  status: 'test' | 'live'
  daily_send_cap: number
  web_status: WhatsAppWebStatus
  qr_pairing_code: string | null
  qr_updated_at: string | null
  connected_phone_number: string | null
  last_seen_at: string | null
  created_at: string
  // Hash SHA-256 do token — o token em si (texto puro) nunca é gravado, só devolvido uma vez
  // na resposta de whatsapp-web-connection?action=create. O hash aqui só serve pro dashboard
  // saber "existe um token válido pra essa conexão" (não nulo) sem expor nada sensível.
  web_device_token_hash: string | null
}

// Vem direto da Graph API (whatsapp-templates, action "list") — não é uma tabela nossa,
// a Meta é a fonte de verdade dos Templates.
export type WhatsAppTemplateComponent = {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: string
  text?: string
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[]
}

export type WhatsAppTemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'

export type WhatsAppTemplate = {
  id: string
  name: string
  status: WhatsAppTemplateStatus
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  language: string
  components: WhatsAppTemplateComponent[]
  quality_score?: { score: string }
  rejected_reason?: string
}

export type ButtonInput = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string }

// agent_configs (0004_whatsapp_agent.sql) — um registro por tenant, controla o agente de
// IA que responde no WhatsApp (whatsapp-webhook/agent.ts). Sem UI até a Fase 10.
export type AgentConfig = {
  id: string
  tenant_id: string
  system_prompt_override: string | null
  model: string
  tools_enabled: string[]
  created_at: string
}

export const AGENT_ALL_TOOLS = [
  { name: 'atualizar_estagio_lead', label: 'Atualizar estágio do lead no CRM' },
  { name: 'registrar_venda', label: 'Registrar venda fechada' },
  { name: 'agendar_followup', label: 'Agendar follow-up' },
  { name: 'marcar_conversa_perdida', label: 'Marcar conversa como perdida' },
  { name: 'escalar_para_humano', label: 'Escalar pra atendimento humano' },
] as const

// Detalhes ao vivo da Graph API (whatsapp-connection-info), combinados com a linha da
// tabela whatsapp_connections.
export type WhatsAppConnectionInfo = WhatsAppConnection & {
  graph: {
    display_phone_number?: string
    verified_name?: string
    quality_rating?: string
    code_verification_status?: string
    platform_type?: string
    throughput?: { level: string }
  } | null
  graph_error: string | null
}
