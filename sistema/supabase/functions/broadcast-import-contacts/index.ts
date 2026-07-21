// deno-lint-ignore-file no-explicit-any
// Fase 9 — importação de contatos via CSV pro disparo em massa. O CSV já é parseado no
// client (Papaparse); essa function só recebe as linhas já separadas, normaliza telefone
// e faz upsert em lote. Centralizado aqui (em vez de no client) pra garantir dedup
// consistente mesmo com imports concorrentes/repetidos na mesma lista.
//
// Arquivo autocontido de propósito (sem import de _shared/) — deployada pelo editor web
// do Supabase, que lida com uma function por vez, não com pastas compartilhadas entre
// functions (mesmo padrão de prospeccao-buscar/prospeccao-worker).
//
// Chamada direto pelo dashboard autenticado (supabase.functions.invoke): mantém
// verificação de JWT padrão (deploy sem --no-verify-jwt).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const MAX_ROWS_PER_REQUEST = 2000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Cópia local de sistema/src/lib/phone.ts normalizePhoneBR — duplicado de propósito
// (deploy autocontido via editor web, sem import cross-function).
type PhoneNormalization =
  | { status: 'ok' | 'ok_international'; phone: string }
  | { status: 'invalid'; reason: string }

function normalizePhoneBR(raw: string): PhoneNormalization {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { status: 'invalid', reason: 'vazio' }

  const explicitPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return { status: 'invalid', reason: 'sem dígitos' }

  if (explicitPlus && !digits.startsWith('55')) {
    if (digits.length < 8 || digits.length > 15) {
      return { status: 'invalid', reason: 'tamanho internacional implausível' }
    }
    return { status: 'ok_international', phone: digits }
  }

  let local = digits
  if (local.startsWith('55') && local.length >= 12) local = local.slice(2)
  else if (local.startsWith('0')) local = local.replace(/^0+/, '')

  if (local.length !== 10 && local.length !== 11) {
    return { status: 'invalid', reason: `tamanho inesperado pra BR (${local.length} dígitos após DDD)` }
  }

  const ddd = local.slice(0, 2)
  if (Number(ddd) < 11 || Number(ddd) > 99) return { status: 'invalid', reason: `DDD implausível (${ddd})` }

  let number = local.slice(2)
  if (number.length === 8) {
    if (['6', '7', '8', '9'].includes(number[0])) number = '9' + number
  } else if (number.length !== 9) {
    return { status: 'invalid', reason: `número local com tamanho inesperado (${number.length})` }
  }

  return { status: 'ok', phone: `55${ddd}${number}` }
}

type ImportRow = { full_name?: string; phone_number?: string; extra_fields?: Record<string, unknown> }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const tenantId = body.tenant_id as string | undefined
  const listId = body.list_id as string | undefined
  const rows = body.rows as ImportRow[] | undefined

  if (!tenantId || !listId || !Array.isArray(rows)) {
    return jsonResponse({ error: 'Esperado { tenant_id, list_id, rows: [...] }' }, 400)
  }
  if (rows.length === 0) {
    return jsonResponse({ error: 'rows vazio' }, 400)
  }
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return jsonResponse(
      { error: `Máximo de ${MAX_ROWS_PER_REQUEST} linhas por chamada — divida o CSV em partes menores.` },
      400,
    )
  }

  // Client com o JWT de quem chamou: só pra checar que o usuário pertence ao tenant com
  // permissão de escrita. A escrita em si sempre passa por supabaseAdmin (service role),
  // já que broadcast_contacts não tem policy de insert liberada pro client.
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  const {
    data: { user: caller },
  } = await supabaseUser.auth.getUser()
  if (!caller) {
    return jsonResponse({ error: 'Não autenticado.' }, 401)
  }

  const { data: platformAdminRow } = await supabaseUser
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!platformAdminRow) {
    const { data: membership } = await supabaseUser
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership || membership.role === 'tenant_viewer') {
      return jsonResponse({ error: 'Sem permissão de escrita nesse tenant.' }, 403)
    }
  }

  const { data: list, error: listError } = await supabaseAdmin
    .from('broadcast_lists')
    .select('id, tenant_id, extra_field_keys')
    .eq('id', listId)
    .maybeSingle()

  if (listError) {
    return jsonResponse({ error: `Falha ao carregar lista: ${listError.message}` }, 500)
  }
  if (!list || list.tenant_id !== tenantId) {
    return jsonResponse({ error: 'Lista não encontrada pra esse tenant.' }, 404)
  }

  const invalidPhones: { full_name: string; phone_number_raw: string; reason: string }[] = []
  const byPhone = new Map<string, { tenant_id: string; list_id: string; full_name: string; phone_number: string; extra_fields: Record<string, unknown> }>()
  let skippedDuplicates = 0
  const extraKeysSeen = new Set<string>(list.extra_field_keys ?? [])

  for (const row of rows) {
    const fullName = (row.full_name ?? '').trim() || '(sem nome)'
    const rawPhone = row.phone_number ?? ''
    const normalized = normalizePhoneBR(rawPhone)

    if (normalized.status === 'invalid') {
      invalidPhones.push({ full_name: fullName, phone_number_raw: rawPhone, reason: normalized.reason })
      continue
    }

    const extraFields = row.extra_fields ?? {}
    for (const key of Object.keys(extraFields)) extraKeysSeen.add(key)

    if (byPhone.has(normalized.phone)) {
      skippedDuplicates++
    }
    byPhone.set(normalized.phone, {
      tenant_id: tenantId,
      list_id: listId,
      full_name: fullName,
      phone_number: normalized.phone,
      extra_fields: extraFields,
    })
  }

  const validRows = Array.from(byPhone.values())

  if (validRows.length === 0) {
    return jsonResponse({ ok: true, inserted: 0, skipped_duplicates: skippedDuplicates, invalid_phones: invalidPhones })
  }

  const { error: upsertError } = await supabaseAdmin
    .from('broadcast_contacts')
    .upsert(validRows, { onConflict: 'list_id,phone_number' })

  if (upsertError) {
    return jsonResponse({ error: `Falha ao salvar contatos: ${upsertError.message}` }, 500)
  }

  const { error: updateListError } = await supabaseAdmin
    .from('broadcast_lists')
    .update({ extra_field_keys: Array.from(extraKeysSeen) })
    .eq('id', listId)

  if (updateListError) {
    console.error('Falha ao atualizar extra_field_keys da lista', listId, updateListError)
  }

  return jsonResponse({
    ok: true,
    inserted: validRows.length,
    skipped_duplicates: skippedDuplicates,
    invalid_phones: invalidPhones,
  })
})
