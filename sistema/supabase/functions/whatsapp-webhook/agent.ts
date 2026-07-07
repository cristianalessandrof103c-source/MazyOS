// deno-lint-ignore-file no-explicit-any
// Loop manual de tool use com a Claude API — as 5 tools do agente de vendas.
// Cada tool executa contra o CRM usando tenantId/leadId/conversationId já
// resolvidos em index.ts a partir do phone_number_id do webhook, nunca a
// partir do input do model (mesmo espírito de "tenant_id nunca cru" do plano).
//
// Fase 4: antes de chamar o Claude, busca no cérebro coletivo (RAG,
// knowledge_base_insights) os insights aprovados mais parecidos com a
// mensagem atual, e injeta no system prompt. Se a busca falhar (sem
// VOYAGE_API_KEY configurada ainda, por exemplo), o agente segue sem esse
// contexto — retrieval é um reforço, não uma dependência dura.

import { embedText } from '../_shared/embeddings.ts'

const EXTRACT_INSIGHTS_URL = 'https://tblumyuozhysncscktrk.supabase.co/functions/v1/extract-insights'
const DISPATCHER_SECRET = Deno.env.get('DISPATCHER_SECRET') ?? ''

function dispararExtracaoInsights(conversationId: string, outcome: 'won' | 'lost') {
  fetch(EXTRACT_INSIGHTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dispatcher-secret': DISPATCHER_SECRET },
    body: JSON.stringify({ conversationId, outcome }),
  }).catch((err) => console.error('Erro disparando extract-insights:', err))
}

const ALL_TOOLS = [
  {
    name: 'atualizar_estagio_lead',
    description:
      'Move o lead para outra categoria de estagio do pipeline (nao o nome customizado). Use "in_progress" quando o lead entrar numa negociacao ativa, "customer_success" apos uma venda ja fechada quando a conversa vira pos-venda. Nao use pra marcar venda (use registrar_venda) nem perda (use marcar_conversa_perdida).',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['new', 'in_progress', 'customer_success'] },
      },
      required: ['category'],
    },
  },
  {
    name: 'registrar_venda',
    description:
      'Registra que o lead fechou uma compra. Cria a venda como ganha com o valor informado e move o lead pro estagio de venda ganha. Use somente quando o cliente confirmar explicitamente a compra.',
    input_schema: {
      type: 'object',
      properties: {
        value_cents: {
          type: 'integer',
          description: 'Valor da venda em centavos (ex: 50000 = R$500,00)',
        },
      },
      required: ['value_cents'],
    },
  },
  {
    name: 'agendar_followup',
    description:
      'Agenda um lembrete de follow-up pra esse lead daqui a N horas, com uma nota do que verificar. Use quando o lead pedir tempo pra pensar ou nao responder a uma pergunta direta.',
    input_schema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'O que checar no follow-up' },
        delay_hours: { type: 'integer', description: 'Em quantas horas fazer o follow-up' },
      },
      required: ['note', 'delay_hours'],
    },
  },
  {
    name: 'marcar_conversa_perdida',
    description:
      'Marca a conversa como perdida quando o lead recusar explicitamente ou deixar claro que nao tem interesse. Move o lead pro estagio de venda perdida e encerra a conversa.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Motivo da perda, em poucas palavras' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'escalar_para_humano',
    description:
      'Passa a conversa pra um humano da equipe e para de responder automaticamente ate alguem assumir. Use quando o lead pedir pra falar com uma pessoa, fizer uma pergunta fora do escopo (juridico, reclamacao grave) ou a conversa exigir julgamento que o agente nao deveria fazer sozinho.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
    },
  },
]

function defaultSystemPrompt(companyName: string): string {
  return `Você é o agente de vendas da ${companyName} no WhatsApp. Fala com quem chega pelo anúncio, indicação ou contato direto, entende a necessidade real antes de empurrar qualquer coisa, e é direto — sem clichê de agência de marketing/IA ("revolucione seu negócio", "transforme seu atendimento"). Seu objetivo é qualificar o lead, tirar dúvida real e levar pra uma conversa comercial (call ou fechamento direto pelo WhatsApp).

Use as tools disponíveis pra refletir no CRM o que está de fato acontecendo na conversa — não converse só por conversar, mova o lead no pipeline quando fizer sentido.

Nunca invente preço, prazo ou informação que você não tem certeza. Se não souber responder algo específico do negócio do cliente, chame escalar_para_humano em vez de arriscar.

Respostas curtas, tom direto e humano — isso é WhatsApp, não e-mail corporativo.`
}

interface AgentConfigRow {
  system_prompt_override: string | null
  model: string
  tools_enabled: string[]
}

interface RunAgentLoopArgs {
  anthropic: any
  supabaseAdmin: any
  tenantId: string
  leadId: string
  conversationId: string
  companyName: string
  agentConfig: AgentConfigRow | null
  history: { direction: string; content_text: string }[]
  incomingText: string
}

export async function runAgentLoop(args: RunAgentLoopArgs) {
  const {
    anthropic,
    supabaseAdmin,
    tenantId,
    leadId,
    conversationId,
    companyName,
    agentConfig,
    history,
    incomingText,
  } = args

  const model = agentConfig?.model || 'claude-opus-4-8'
  const enabledNames = agentConfig?.tools_enabled ?? ALL_TOOLS.map((t) => t.name)
  const tools = ALL_TOOLS.filter((t) => enabledNames.includes(t.name))

  let basePrompt = agentConfig?.system_prompt_override?.trim()
    ? `${defaultSystemPrompt(companyName)}\n\n${agentConfig.system_prompt_override}`
    : defaultSystemPrompt(companyName)

  try {
    const queryEmbedding = await embedText(incomingText, 'query')
    const { data: insights } = await supabaseAdmin.rpc('match_insights', {
      query_embedding: queryEmbedding,
      match_count: 5,
    })
    if (insights?.length) {
      const bulletList = insights.map((i: any) => `- (${i.category}) ${i.insight_text}`).join('\n')
      basePrompt += `\n\n## Conhecimento coletivo (padrões aprovados de outras conversas de venda)\n${bulletList}\n\nUse isso como referência, não como script — adapte ao contexto real dessa conversa.`
    }
  } catch (err) {
    console.error('Retrieval de insights falhou (seguindo sem esse contexto):', err)
  }

  const systemPrompt = basePrompt

  const messages: any[] = history.map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content_text,
  }))
  messages.push({ role: 'user', content: incomingText })

  const toolCalls: { name: string; input: unknown }[] = []
  let finalText = ''

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    })

    const textBlocks = response.content.filter((b: any) => b.type === 'text')
    finalText = textBlocks.map((b: any) => b.text).join('\n').trim()

    const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use')
    if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      break
    }

    messages.push({ role: 'assistant', content: response.content })

    const toolResults: any[] = []
    for (const block of toolUseBlocks) {
      toolCalls.push({ name: block.name, input: block.input })
      const resultText = await executeTool(block.name, block.input, {
        supabaseAdmin,
        tenantId,
        leadId,
        conversationId,
      })
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return { finalText, toolCalls }
}

interface ToolContext {
  supabaseAdmin: any
  tenantId: string
  leadId: string
  conversationId: string
}

async function findStageByCategory(supabaseAdmin: any, tenantId: string, category: string) {
  const { data } = await supabaseAdmin
    .from('pipeline_stages')
    .select('id')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('category', category)
    .order('tenant_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return data?.id as string | undefined
}

async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const { supabaseAdmin, tenantId, leadId, conversationId } = ctx
  try {
    switch (name) {
      case 'atualizar_estagio_lead': {
        const { category } = input as { category: string }
        const stageId = await findStageByCategory(supabaseAdmin, tenantId, category)
        if (!stageId) return `Erro: nenhum estagio de categoria "${category}" encontrado.`
        await supabaseAdmin.from('leads').update({ stage_id: stageId }).eq('id', leadId)
        return `Lead movido pro estagio de categoria "${category}".`
      }
      case 'registrar_venda': {
        const { value_cents } = input as { value_cents: number }
        await supabaseAdmin.from('deals').insert({
          tenant_id: tenantId,
          lead_id: leadId,
          status: 'won',
          value_cents,
          closed_at: new Date().toISOString(),
        })
        const stageId = await findStageByCategory(supabaseAdmin, tenantId, 'won')
        if (stageId) await supabaseAdmin.from('leads').update({ stage_id: stageId }).eq('id', leadId)
        dispararExtracaoInsights(conversationId, 'won')
        return `Venda de R$${(value_cents / 100).toFixed(2)} registrada e lead movido pro estagio de venda ganha.`
      }
      case 'agendar_followup': {
        const { note, delay_hours } = input as { note: string; delay_hours: number }
        const scheduledFor = new Date(Date.now() + delay_hours * 3600 * 1000).toISOString()
        await supabaseAdmin.from('follow_up_jobs').insert({
          tenant_id: tenantId,
          lead_id: leadId,
          note,
          scheduled_for: scheduledFor,
        })
        return `Follow-up agendado pra daqui ${delay_hours}h.`
      }
      case 'marcar_conversa_perdida': {
        const { reason } = input as { reason: string }
        const stageId = await findStageByCategory(supabaseAdmin, tenantId, 'lost')
        if (stageId) await supabaseAdmin.from('leads').update({ stage_id: stageId }).eq('id', leadId)
        await supabaseAdmin.from('conversations').update({ status: 'closed' }).eq('id', conversationId)
        dispararExtracaoInsights(conversationId, 'lost')
        return `Conversa marcada como perdida (${reason}).`
      }
      case 'escalar_para_humano': {
        const { reason } = input as { reason: string }
        await supabaseAdmin.from('conversations').update({ status: 'needs_human' }).eq('id', conversationId)
        return `Conversa escalada pra um humano (${reason}).`
      }
      default:
        return `Tool desconhecida: ${name}`
    }
  } catch (err) {
    return `Erro executando ${name}: ${(err as Error).message}`
  }
}
