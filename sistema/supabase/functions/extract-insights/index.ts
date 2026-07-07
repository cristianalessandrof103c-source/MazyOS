// deno-lint-ignore-file no-explicit-any
// Fase 4 — extrai insights reutilizáveis (objeção tratada, dúvida de preço,
// técnica que fechou, FAQ) de uma conversa encerrada, grava como rascunho
// (status='draft') na base de conhecimento COMPARTILHADA entre tenants, e
// registra o desfecho em conversation_outcomes (evita reprocessar).
//
// Dois modos:
// - POST { conversationId, outcome? } — chamado pelas tools registrar_venda /
//   marcar_conversa_perdida (whatsapp-webhook/agent.ts) assim que a conversa
//   resolve.
// - POST {} (sem corpo) — modo scan, chamado por pg_cron 1x/dia: processa
//   conversas paradas há mais de 7 dias sem outcome registrado ('undecided').
//
// Um insight só entra no retrieval depois de aprovado manualmente na tela
// Cérebro/Insights (proteção contra contaminar a base pra todos os tenants).

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { embedText } from '../_shared/embeddings.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DISPATCHER_SECRET = Deno.env.get('DISPATCHER_SECRET') ?? ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

const EXTRACTION_TOOL = {
  name: 'registrar_insights',
  description: 'Registra os insights reutilizáveis extraídos dessa conversa de vendas.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['objection_handling', 'pricing', 'closing_technique', 'faq'],
            },
            insight_text: {
              type: 'string',
              description:
                'Insight genérico e reutilizável em conversas de QUALQUER cliente — sem nome, telefone ou detalhe que identifique esse lead específico.',
            },
          },
          required: ['category', 'insight_text'],
        },
      },
      summary_text: { type: 'string', description: 'Resumo de 1-2 frases do desfecho da conversa.' },
    },
    required: ['insights', 'summary_text'],
  },
}

const SYSTEM_PROMPT = `Você analisa transcrições de conversas de vendas encerradas pra extrair padrões reutilizáveis: objeções e como foram tratadas, dúvidas de preço, técnicas que ajudaram a fechar, perguntas frequentes.

Regra inegociável: o insight precisa ser genérico o suficiente pra ajudar em conversas de QUALQUER empresa cliente desse sistema — nunca inclua nome, telefone ou qualquer detalhe que identifique esse lead ou essa empresa específica.

Se a conversa não tiver nada generalizável (só cumprimento, sem contexto de venda real), retorne uma lista vazia de insights — não force um insight fraco só pra ter algo.`

async function extractForConversation(conversationId: string, outcomeOverride?: 'won' | 'lost' | 'undecided') {
  const { data: existing } = await supabaseAdmin
    .from('conversation_outcomes')
    .select('id')
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (existing) {
    return { conversationId, kind: 'already_processed' }
  }

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single()
  if (!conversation) return { conversationId, kind: 'conversation_not_found' }

  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('direction, content_text')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (!messages || messages.length === 0) {
    return { conversationId, kind: 'no_messages' }
  }

  let outcome = outcomeOverride
  if (!outcome) {
    const { data: deal } = await supabaseAdmin
      .from('deals')
      .select('status')
      .eq('lead_id', conversation.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    outcome = deal?.status === 'won' ? 'won' : deal?.status === 'lost' ? 'lost' : 'undecided'
  }

  const transcript = messages
    .map((m: any) => `${m.direction === 'inbound' ? 'Lead' : 'Agente'}: ${m.content_text}`)
    .join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'registrar_insights' },
    messages: [{ role: 'user', content: `Desfecho: ${outcome}\n\nTranscrição:\n${transcript}` }],
  })

  const toolUse: any = response.content.find((b: any) => b.type === 'tool_use')
  const insights: { category: string; insight_text: string }[] = toolUse?.input?.insights ?? []
  const summaryText: string | null = toolUse?.input?.summary_text ?? null

  let savedCount = 0
  for (const insight of insights) {
    try {
      const embedding = await embedText(insight.insight_text, 'document')
      await supabaseAdmin.from('knowledge_base_insights').insert({
        category: insight.category,
        insight_text: insight.insight_text,
        embedding,
        source_conversation_ids: [conversationId],
        outcome_stats: { [outcome]: 1 },
      })
      savedCount++
    } catch (err) {
      console.error('Erro gerando embedding/gravando insight:', err)
    }
  }

  await supabaseAdmin.from('conversation_outcomes').insert({
    tenant_id: conversation.tenant_id,
    conversation_id: conversationId,
    lead_id: conversation.lead_id,
    outcome,
    summary_text: summaryText,
    insights_generated: true,
  })

  return { conversationId, kind: 'processed', insightsExtracted: insights.length, insightsSaved: savedCount, outcome }
}

Deno.serve(async (req: Request) => {
  if (!DISPATCHER_SECRET || req.headers.get('x-dispatcher-secret') !== DISPATCHER_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  if (body.conversationId) {
    try {
      const result = await extractForConversation(body.conversationId, body.outcome)
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
      console.error('Erro extraindo insights:', err)
      return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
    }
  }

  const { data: staleConversations } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .lte('last_message_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .limit(20)

  const results = []
  for (const c of staleConversations ?? []) {
    try {
      results.push(await extractForConversation(c.id))
    } catch (err) {
      results.push({ conversationId: c.id, kind: 'error', message: (err as Error).message })
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
