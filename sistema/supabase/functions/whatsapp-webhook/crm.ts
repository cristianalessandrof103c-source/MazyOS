// deno-lint-ignore-file no-explicit-any
// Resolve lead + conversa a partir de uma mensagem inbound do WhatsApp.
// tenant_id sempre vem de whatsapp_connections (resolvido em index.ts a partir
// do phone_number_id do payload) — nunca aceito de qualquer outro campo.

export async function resolveLead(
  supabaseAdmin: any,
  tenantId: string,
  phoneNumber: string,
  profileName: string | undefined,
) {
  const { data: existing } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone_number', phoneNumber)
    .maybeSingle()
  if (existing) return existing

  const { data: newStage } = await supabaseAdmin
    .from('pipeline_stages')
    .select('id')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('category', 'new')
    .order('tenant_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const { data: channel } = await supabaseAdmin
    .from('acquisition_channels')
    .select('id')
    .is('tenant_id', null)
    .eq('code', 'direct_contact')
    .maybeSingle()

  const { data: created, error } = await supabaseAdmin
    .from('leads')
    .insert({
      tenant_id: tenantId,
      full_name: profileName || phoneNumber,
      phone_number: phoneNumber,
      acquisition_channel_id: channel?.id ?? null,
      stage_id: newStage?.id,
      whatsapp_contact_id: phoneNumber,
    })
    .select()
    .single()
  if (error) throw error
  return created
}

export async function resolveConversation(supabaseAdmin: any, tenantId: string, leadId: string) {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .in('status', ['active', 'needs_human'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) return existing

  const { data: created, error } = await supabaseAdmin
    .from('conversations')
    .insert({ tenant_id: tenantId, lead_id: leadId })
    .select()
    .single()
  if (error) throw error
  return created
}
