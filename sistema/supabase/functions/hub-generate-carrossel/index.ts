// deno-lint-ignore-file no-explicit-any
// Fase 2 — gera o TEXTO de um carrossel (Claude via API, sem interação) a partir de um
// tema digitado no dashboard. Não renderiza nada aqui (isso é hub-render-carrossel,
// chamado depois que o tenant aprova/edita o texto) — mantém o mesmo checkpoint humano
// que a skill /carrossel já tinha ("mostrar texto, esperar aprovação"), só que sem
// precisar do Claude Code aberto na máquina do dono.
//
// Chamada direto pelo dashboard autenticado (supabase.functions.invoke), mesmo padrão de
// invite-member: mantém verificação de JWT padrão (deploy sem --no-verify-jwt), e
// reconfirma a autorização olhando memberships direto (não confia só na claim do JWT,
// que pode estar desatualizada até o próximo refresh/login).
//
// Escopo desta leva: só carrossel de texto puro (tipo='texto'). Carrossel com foto IA
// (geração via OpenAI, aprovação de foto) fica pra uma próxima leva — mesmo padrão de
// "escopo reduzido, resto fica pra depois" usado nas Fases 5 e 8.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const DAILY_LIMIT = Number(Deno.env.get('HUB_CARROSSEL_DAILY_LIMIT') ?? '5')

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

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

const GERAR_CARROSSEL_TOOL = {
  name: 'gerar_carrossel',
  description: 'Gera os slides de texto de um carrossel de Instagram e a legenda do post.',
  input_schema: {
    type: 'object',
    properties: {
      slides: {
        type: 'array',
        minItems: 5,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            layout: {
              type: 'string',
              enum: ['capa', 'solo', 'numero', 'citacao', 'cta'],
              description: 'capa = primeiro slide, cta = último slide, os do meio variam entre solo/numero/citacao.',
            },
            kicker: { type: 'string', description: 'Rótulo curto em caixa alta (opcional).' },
            title: { type: 'string' },
            body: { type: 'string', description: 'Parágrafo de apoio (opcional pro slide de capa/cta).' },
          },
          required: ['layout', 'title'],
        },
      },
      caption: {
        type: 'string',
        description: 'Legenda pro Instagram: hook, contexto, CTA pra arrastar, e 10-15 hashtags no final.',
      },
    },
    required: ['slides', 'caption'],
  },
}

const SYSTEM_PROMPT = `Você escreve o texto de carrosséis de Instagram pra pequenas e médias empresas clientes de um CRM.

Regras de tom: frases naturais, sem jargão de marketing ("ticket médio", "performance", "sinergia"), sem corporativês. Fale como o público-alvo do nicho realmente fala.

Estrutura (5 a 8 slides):
- Slide 1: layout "capa" — título de impacto, máximo 8 palavras.
- Slides do meio: alternar entre "solo" (um insight por slide), "numero" (estatística ou dado em destaque) e "citacao" (frase forte) — nunca dois slides seguidos com o mesmo layout.
- Último slide: layout "cta" — chamada pra ação curta.

Legenda: hook (pergunta ou afirmação) → contexto em 1-2 frases → CTA pra arrastar o carrossel → 10 a 15 hashtags relevantes ao nicho e à região, se souber qual é.`

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
  const tema = (body.tema as string | undefined)?.trim()
  const tipo = (body.tipo as string | undefined) ?? 'texto'

  if (!tenantId || !tema) {
    return jsonResponse({ error: 'Esperado { tenant_id, tema }' }, 400)
  }
  if (tipo !== 'texto') {
    return jsonResponse({ error: 'Só carrossel de texto puro é suportado por enquanto (tipo=texto).' }, 400)
  }

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
      return jsonResponse({ error: 'Sem permissão pra gerar carrossel nesse tenant.' }, 403)
    }
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count: recentCount } = await supabaseAdmin
    .from('integration_hub_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('tool', 'carrossel')
    .gte('created_at', since)

  if ((recentCount ?? 0) >= DAILY_LIMIT) {
    return jsonResponse(
      { error: `Limite de ${DAILY_LIMIT} carrosséis por dia atingido pra esse tenant. Tente de novo amanhã.` },
      429,
    )
  }

  let slides: any[]
  let caption: string
  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [GERAR_CARROSSEL_TOOL],
      tool_choice: { type: 'tool', name: 'gerar_carrossel' },
      messages: [{ role: 'user', content: `Tema do carrossel: ${tema}` }],
    })
    const toolUse: any = response.content.find((b: any) => b.type === 'tool_use')
    slides = toolUse?.input?.slides ?? []
    caption = toolUse?.input?.caption ?? ''
    if (slides.length === 0) throw new Error('Claude não retornou nenhum slide.')
  } catch (err) {
    return jsonResponse({ error: `Falha gerando o texto do carrossel: ${(err as Error).message}` }, 502)
  }

  const { data: job, error: insertError } = await supabaseAdmin
    .from('integration_hub_jobs')
    .insert({
      tenant_id: tenantId,
      tool: 'carrossel',
      status: 'awaiting_approval',
      params: { tema, tipo },
      result: { draft: { slides, caption } },
      created_by: caller.id,
    })
    .select()
    .single()

  if (insertError) {
    return jsonResponse({ error: `Gerado, mas falhou ao salvar o job: ${insertError.message}` }, 500)
  }

  return jsonResponse({ ok: true, job })
})
