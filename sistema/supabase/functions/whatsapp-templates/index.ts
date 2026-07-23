// deno-lint-ignore-file no-explicit-any
// Fase 10 — gerencia Templates de mensagem direto na Graph API (list/create/delete), sem
// precisar abrir o WhatsApp Manager da Meta pra cada template novo. Opera no nível da WABA
// (business_account_id da conexão), não do phone_number_id (endpoint de mensagens usa o
// phone_number_id, o de templates usa a WABA — são recursos diferentes na Graph API).
//
// Só HEADER de texto é suportado (HEADER de imagem/vídeo exige upload prévio via Resumable
// Upload API da Meta, um fluxo de várias etapas — fora do escopo desta primeira versão).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WHATSAPP_TEST_ACCESS_TOKEN = Deno.env.get('WHATSAPP_TEST_ACCESS_TOKEN') ?? ''
const WHATSAPP_LIVE_ACCESS_TOKEN = Deno.env.get('WHATSAPP_LIVE_ACCESS_TOKEN') ?? ''
const GRAPH_VERSION = 'v21.0'

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function tokenParaConexao(status: string): string {
  return status === 'live' ? WHATSAPP_LIVE_ACCESS_TOKEN : WHATSAPP_TEST_ACCESS_TOKEN
}

type ButtonInput = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string }

function buildButtonsComponent(buttons: ButtonInput[]): Record<string, unknown> | null {
  if (buttons.length === 0) return null
  const quickReplies = buttons.filter((b) => b.type === 'QUICK_REPLY')
  const cta = buttons.filter((b) => b.type !== 'QUICK_REPLY')

  if (quickReplies.length > 0 && cta.length > 0) {
    throw new Error('A Meta não permite misturar botão de resposta rápida com botão de link/telefone no mesmo template.')
  }
  if (quickReplies.length > 3) throw new Error('No máximo 3 botões de resposta rápida.')
  if (cta.length > 2) throw new Error('No máximo 2 botões de link/telefone (call-to-action).')

  const built = buttons.map((b) => {
    if (b.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text: b.text }
    if (b.type === 'URL') return { type: 'URL', text: b.text, url: b.url }
    return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number }
  })
  return { type: 'BUTTONS', buttons: built }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const tenantId = body.tenant_id as string | undefined
  const action = body.action as string | undefined
  if (!tenantId || !action) return jsonResponse({ error: 'Esperado { tenant_id, action }' }, 400)
  if (!['list', 'create', 'delete'].includes(action)) return jsonResponse({ error: 'action precisa ser list, create ou delete' }, 400)

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user: caller },
  } = await supabaseUser.auth.getUser()
  if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

  const { data: platformAdminRow } = await supabaseUser.from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle()
  if (!platformAdminRow) {
    const { data: callerMembership } = await supabaseUser
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()

    const isWriteAction = action === 'create' || action === 'delete'
    if (isWriteAction && callerMembership?.role !== 'tenant_admin') {
      return jsonResponse({ error: 'Só tenant_admin pode criar/remover Templates.' }, 403)
    }
    if (!callerMembership) {
      return jsonResponse({ error: 'Você não é membro desse tenant.' }, 403)
    }
  }

  // Fase 10a: whatsapp_connections agora também guarda conexões qr_web (WhatsApp Web) do
  // mesmo tenant — sem esse filtro, um tenant com as duas conexões faz o maybeSingle()
  // abaixo estourar erro (mais de uma linha), e Templates parava de aparecer.
  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('connection_type', 'cloud_api')
    .maybeSingle()

  if (connectionError || !connection) return jsonResponse({ error: 'Nenhuma conexão de WhatsApp (Cloud API) configurada pra esse tenant.' }, 404)

  const token = tokenParaConexao(connection.status)
  if (!token) return jsonResponse({ error: 'Token da conexão de WhatsApp não configurado nos secrets.' }, 500)

  if (action === 'list') {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${connection.business_account_id}/message_templates?fields=name,status,category,language,components,quality_score,rejected_reason&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const data = await res.json()
    if (!res.ok) return jsonResponse({ error: data.error?.message ?? `HTTP ${res.status}` }, 502)
    return jsonResponse({ ok: true, templates: data.data ?? [] })
  }

  if (action === 'delete') {
    const name = body.name as string | undefined
    if (!name) return jsonResponse({ error: 'Esperado { name } pra deletar.' }, 400)
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${connection.business_account_id}/message_templates?name=${encodeURIComponent(name)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    )
    const data = await res.json()
    if (!res.ok) return jsonResponse({ error: data.error?.message ?? `HTTP ${res.status}` }, 502)
    return jsonResponse({ ok: true })
  }

  // action === 'create'
  const name = (body.name as string | undefined)?.trim()
  const language = (body.language as string | undefined)?.trim()
  const category = body.category as string | undefined
  const headerText = (body.header_text as string | undefined)?.trim()
  const bodyText = (body.body_text as string | undefined)?.trim()
  const bodyExamples = (body.body_examples as string[] | undefined) ?? []
  const footerText = (body.footer_text as string | undefined)?.trim()
  const buttons = (body.buttons as ButtonInput[] | undefined) ?? []

  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    return jsonResponse({ error: 'Nome do template só pode ter letras minúsculas, números e underscore.' }, 400)
  }
  if (!language) return jsonResponse({ error: 'Idioma é obrigatório (ex: pt_BR).' }, 400)
  if (!category || !['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category)) {
    return jsonResponse({ error: 'category precisa ser MARKETING, UTILITY ou AUTHENTICATION.' }, 400)
  }
  if (!bodyText) return jsonResponse({ error: 'Corpo da mensagem é obrigatório.' }, 400)

  const variableCount = new Set(Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size
  if (variableCount > 0 && bodyExamples.length < variableCount) {
    return jsonResponse({ error: `O corpo usa ${variableCount} variável(is), mas só ${bodyExamples.length} exemplo(s) foram enviados.` }, 400)
  }

  const components: Record<string, unknown>[] = []

  if (headerText) {
    const headerVarCount = new Set(Array.from(headerText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size
    const headerComponent: Record<string, unknown> = { type: 'HEADER', format: 'TEXT', text: headerText }
    if (headerVarCount > 0) {
      const headerExample = (body.header_example as string | undefined)?.trim()
      if (!headerExample) return jsonResponse({ error: 'Cabeçalho usa variável — precisa de um texto de exemplo (header_example).' }, 400)
      headerComponent.example = { header_text: [headerExample] }
    }
    components.push(headerComponent)
  }

  const bodyComponent: Record<string, unknown> = { type: 'BODY', text: bodyText }
  if (variableCount > 0) {
    bodyComponent.example = { body_text: [bodyExamples.slice(0, variableCount)] }
  }
  components.push(bodyComponent)

  if (footerText) components.push({ type: 'FOOTER', text: footerText })

  try {
    const buttonsComponent = buildButtonsComponent(buttons)
    if (buttonsComponent) components.push(buttonsComponent)
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400)
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${connection.business_account_id}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, language, category, components }),
  })
  const data = await res.json()
  if (!res.ok) return jsonResponse({ error: data.error?.message ?? `HTTP ${res.status}` }, 502)

  return jsonResponse({ ok: true, template: data })
})
