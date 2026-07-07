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
  tool_calls: { name: string; input: unknown }[] | null
  created_at: string
}
