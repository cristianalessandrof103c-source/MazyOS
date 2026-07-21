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
// criação de campanha.
export type WhatsAppConnection = {
  id: string
  tenant_id: string
  phone_number_id: string
  business_account_id: string
  status: 'test' | 'live'
  daily_send_cap: number
  created_at: string
}
