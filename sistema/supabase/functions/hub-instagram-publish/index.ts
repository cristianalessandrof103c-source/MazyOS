// deno-lint-ignore-file no-explicit-any
// Hub de integrações (Fase 5) — publica no Instagram um job "carrossel" já concluído
// (imagens já renderizadas pelo worker local e subidas pro bucket hub-media).
//
// Chamada direto pelo dashboard autenticado (supabase.functions.invoke), diferente de
// whatsapp-webhook/sync-ad-spend (chamadas por Meta/pg_cron sem sessão de usuário) — por
// isso mantém a verificação de JWT padrão do Supabase (deploy sem --no-verify-jwt).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { criarContainerImagem, criarContainerCarrossel, publicarContainer, graphGet } from '../_shared/meta-graph.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const META_PAGE_ACCESS_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? ''
const META_IG_USER_ID = Deno.env.get('META_IG_USER_ID') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function registrarResultado(args: {
  tenantId: string
  sourceJobId: string
  status: 'done' | 'failed'
  result?: { post_id: string; permalink: string | null }
  error?: string
}) {
  await supabaseAdmin.from('integration_hub_jobs').insert({
    tenant_id: args.tenantId,
    tool: 'instagram_post',
    status: args.status,
    params: { source_job_id: args.sourceJobId },
    result: args.result ?? null,
    error: args.error ?? null,
  })
}

async function publicarNoInstagram(images: string[], caption: string): Promise<{ post_id: string; permalink: string | null }> {
  let creationId: string
  if (images.length === 1) {
    creationId = await criarContainerImagem({ igUserId: META_IG_USER_ID, token: META_PAGE_ACCESS_TOKEN, imageUrl: images[0], caption })
  } else {
    const childIds: string[] = []
    for (const imageUrl of images) {
      const childId = await criarContainerImagem({
        igUserId: META_IG_USER_ID,
        token: META_PAGE_ACCESS_TOKEN,
        imageUrl,
        isCarouselItem: true,
      })
      childIds.push(childId)
    }
    creationId = await criarContainerCarrossel({ igUserId: META_IG_USER_ID, token: META_PAGE_ACCESS_TOKEN, childIds, caption })
  }

  const postId = await publicarContainer({ igUserId: META_IG_USER_ID, token: META_PAGE_ACCESS_TOKEN, creationId })

  let permalink: string | null = null
  try {
    const info = await graphGet(postId, { fields: 'permalink', access_token: META_PAGE_ACCESS_TOKEN })
    permalink = info.permalink ?? null
  } catch {
    // publicado, mas sem permalink — não é motivo pra marcar o job como falho
  }

  return { post_id: postId, permalink }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!META_PAGE_ACCESS_TOKEN || !META_IG_USER_ID) {
    return jsonResponse(
      { error: 'Faltando META_PAGE_ACCESS_TOKEN ou META_IG_USER_ID nos secrets da função (npx supabase secrets set).' },
      500,
    )
  }

  let jobId: string
  try {
    const body = await req.json()
    jobId = body.job_id
    if (!jobId) throw new Error('sem job_id')
  } catch {
    return jsonResponse({ error: 'Body inválido — esperado { job_id }' }, 400)
  }

  // Client com o JWT de quem chamou: a RLS de integration_hub_jobs garante que só
  // enxergamos o job se ele pertencer a um tenant desse usuário (ou for platform admin).
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  const { data: job, error: jobError } = await supabaseUser
    .from('integration_hub_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    return jsonResponse({ error: 'Job não encontrado (ou sem permissão pra esse tenant).' }, 404)
  }
  if (job.tool !== 'carrossel' || job.status !== 'done') {
    return jsonResponse({ error: 'Job precisa ser um carrossel com status=done.' }, 400)
  }

  const images = (job.result as any)?.images as string[] | undefined
  const caption = ((job.result as any)?.caption as string) ?? ''
  if (!images || images.length === 0) {
    return jsonResponse({ error: 'Job não tem imagens em result.images.' }, 400)
  }

  try {
    const publicado = await publicarNoInstagram(images, caption)
    await registrarResultado({ tenantId: job.tenant_id, sourceJobId: job.id, status: 'done', result: publicado })
    return jsonResponse({ ok: true, ...publicado })
  } catch (err) {
    const message = (err as Error).message
    await registrarResultado({ tenantId: job.tenant_id, sourceJobId: job.id, status: 'failed', error: message })
    return jsonResponse({ ok: false, error: message }, 502)
  }
})
