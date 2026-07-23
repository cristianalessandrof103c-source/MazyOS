export type StageCategory = 'new' | 'in_progress' | 'won' | 'lost' | 'customer_success'

export type PipelineStage = {
  id: string
  tenant_id: string | null
  name: string
  order_index: number
  category: StageCategory
}

export type AcquisitionChannel = {
  id: string
  tenant_id: string | null
  code: string
  label: string
  category: 'direct' | 'referral' | 'paid' | 'organic'
}

export type Lead = {
  id: string
  tenant_id: string
  full_name: string
  phone_number: string | null
  email: string | null
  acquisition_channel_id: string | null
  stage_id: string
  created_at: string
}

export type Deal = {
  id: string
  tenant_id: string
  lead_id: string
  status: 'open' | 'won' | 'lost'
  value_cents: number
  acquisition_channel_id: string | null
  closed_at: string | null
  created_at: string
}

export type Conversation = {
  id: string
  tenant_id: string
  lead_id: string
  channel: 'whatsapp'
  status: 'active' | 'needs_human' | 'closed'
  window_expires_at: string | null
  // Fase 10b — null pras conversas antigas do agente de IA (Cloud API); aponta pra
  // whatsapp_connections quando a conversa passa pelo canal QR.
  whatsapp_connection_id: string | null
  last_message_at: string
  created_at: string
}

export type Message = {
  id: string
  tenant_id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  sender_type: 'lead' | 'agent' | 'human'
  content_text: string
  // Fase 10b — só relevante pro canal QR: mensagens outbound nascem 'queued' até o agente
  // local confirmar envio. Cloud API e todo inbound já nascem 'sent'.
  status: 'queued' | 'sent' | 'failed'
  whatsapp_message_id: string | null
  tool_calls: { name: string; input: unknown }[] | null
  created_at: string
}

export type IntegrationHubTool = 'carrossel' | 'seo' | 'site' | 'instagram_post' | 'ads_campaign'
export type IntegrationHubStatus = 'pending' | 'awaiting_approval' | 'processing' | 'done' | 'failed'

export type CarrosselSlideLayout = 'capa' | 'solo' | 'numero' | 'citacao' | 'cta'
export type CarrosselSlideDraft = { layout: CarrosselSlideLayout; kicker?: string; title: string; body?: string }

export type CarrosselDraftResult = { draft: { slides: CarrosselSlideDraft[]; caption: string } }
export type CarrosselJobResult = { images: string[]; caption: string }
export type InstagramPostJobResult = { post_id: string; permalink: string | null }

export type IntegrationHubJob = {
  id: string
  tenant_id: string
  tool: IntegrationHubTool
  status: IntegrationHubStatus
  params: Record<string, unknown>
  result: CarrosselDraftResult | CarrosselJobResult | InstagramPostJobResult | null
  error: string | null
  created_at: string
}

export type ProspectStatus = 'novo' | 'contatado' | 'qualificado' | 'descartado' | 'convertido'

export type Prospect = {
  id: string
  tenant_id: string
  place_id: string
  name: string
  formatted_address: string | null
  phone_number: string | null
  website: string | null
  instagram_url: string | null
  linkedin_url: string | null
  google_maps_url: string | null
  latitude: number | null
  longitude: number | null
  search_niche: string | null
  search_region: string | null
  status: ProspectStatus
  notes: string | null
  converted_lead_id: string | null
  // Fase 10b — nota de qualidade (0-100), ver migration 0017. null nos 3 primeiros = ainda
  // não avaliado (prospect antigo ou sem site); quality_score é coluna gerada no banco.
  site_reachable: boolean | null
  site_https: boolean | null
  site_mobile_friendly: boolean | null
  quality_score: number
  created_at: string
}

export type ProspeccaoJobStatus = 'processing' | 'done' | 'failed'

export type ProspeccaoJob = {
  id: string
  tenant_id: string
  niche: string
  region: string
  target_count: number
  status: ProspeccaoJobStatus
  grid_cells: { lat: number; lng: number; radius_m: number }[]
  next_cell_index: number
  found_count: number
  error: string | null
  created_at: string
}

export type MembershipRole = 'tenant_admin' | 'tenant_manager' | 'tenant_agent' | 'tenant_viewer'
export type MembershipStatus = 'invited' | 'active' | 'disabled'

export type Membership = {
  id: string
  tenant_id: string
  user_id: string
  role: MembershipRole
  status: MembershipStatus
  invited_email: string | null
  invited_at: string | null
  accepted_at: string | null
  created_at: string
}

export type Profile = {
  id: string
  full_name: string | null
}
