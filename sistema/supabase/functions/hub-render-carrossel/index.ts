// deno-lint-ignore-file no-explicit-any
// Fase 2 — segunda metade do fluxo de hub-generate-carrossel: recebe o texto do
// carrossel já revisado/aprovado (e possivelmente editado) pelo tenant, monta o HTML com
// a marca daquele tenant (companies.branding_json — mesma cor/logo já usados no tema do
// dashboard, Fase 7), manda pro render-service (Playwright rodando num container Cloud
// Run, já que Supabase Edge Function/Deno Deploy não tem Chromium) e sobe os PNGs
// resultantes pro bucket hub-media (mesmo bucket que hub-instagram-publish já lê).
//
// Autocontida (sem _shared/) de propósito, mesmo padrão de prospeccao-buscar/worker —
// deploy manual "Via Editor" no painel do Supabase não suporta pasta compartilhada entre
// functions.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RENDER_SERVICE_URL = Deno.env.get('RENDER_SERVICE_URL') ?? ''
const RENDER_SERVICE_SECRET = Deno.env.get('RENDER_SERVICE_SECRET') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

type Slide = { layout: string; kicker?: string; title: string; body?: string }

// Ritmo escuro/claro/destaque por índice — nunca dois slides seguidos com o mesmo fundo,
// mesma regra da skill /carrossel. Capa e CTA final ficam fixos (capa=escuro, cta=destaque).
const BG_CYCLE = ['dark', 'light', 'accent'] as const

function slideBackground(index: number, isCapa: boolean, isCta: boolean, accentColor: string, dark: string, light: string) {
  if (isCapa) return { bg: dark, fg: '#FAFAF7' }
  if (isCta) return { bg: accentColor, fg: '#FAFAF7' }
  const kind = BG_CYCLE[index % BG_CYCLE.length]
  if (kind === 'dark') return { bg: dark, fg: '#FAFAF7' }
  if (kind === 'light') return { bg: light, fg: '#1A1A1A' }
  return { bg: accentColor, fg: '#FAFAF7' }
}

function buildCarrosselHtml(args: {
  slides: Slide[]
  caption: string
  companyName: string
  primaryColor: string
  logoUrl?: string
}): string {
  const { slides, companyName, primaryColor, logoUrl } = args
  const dark = '#0E1116'
  const light = '#FAFAF7'
  const total = slides.length

  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="logo" style="height:32px;object-fit:contain" />`
    : `<span style="font-weight:700;letter-spacing:-0.02em">${escapeHtml(companyName)}</span>`

  const slidesHtml = slides
    .map((slide, i) => {
      const isCapa = slide.layout === 'capa' || i === 0
      const isCta = slide.layout === 'cta' || i === total - 1
      const { bg, fg } = slideBackground(i, isCapa, isCta, primaryColor, dark, light)
      const kicker = slide.kicker
        ? `<div style="font-size:15px;font-weight:800;letter-spacing:0.26em;text-transform:uppercase;color:${isCapa || isCta ? primaryColor : primaryColor};opacity:0.9;margin-bottom:24px">${escapeHtml(slide.kicker)}</div>`
        : ''
      const titleSize = isCapa ? '92px' : isCta ? '64px' : '60px'
      const title = `<h2 style="font-size:${titleSize};font-weight:900;line-height:0.98;letter-spacing:-0.04em;margin:0 0 28px 0;color:${fg}">${escapeHtml(slide.title)}</h2>`
      const body = slide.body
        ? `<p style="font-size:22px;font-weight:500;line-height:1.5;color:${fg};opacity:0.85;margin:0;max-width:820px">${escapeHtml(slide.body)}</p>`
        : ''

      return `
      <div class="slide" style="width:1080px;height:1350px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;padding:90px;position:relative;background:${bg};font-family:'Inter',sans-serif">
        <div style="position:absolute;top:60px;left:90px">${logoHtml}</div>
        <div style="position:absolute;top:64px;right:90px;font-size:15px;font-weight:600;letter-spacing:0.18em;color:${fg};opacity:0.7">${String(i + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}</div>
        ${kicker}
        ${title}
        ${body}
      </div>`
    })
    .join('\n')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>* { margin:0; padding:0; }</style>
</head>
<body>
${slidesHtml}
</body>
</html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  if (!RENDER_SERVICE_URL || !RENDER_SERVICE_SECRET) {
    return jsonResponse({ error: 'Faltando RENDER_SERVICE_URL ou RENDER_SERVICE_SECRET nos secrets da função.' }, 500)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const jobId = body.job_id as string | undefined
  if (!jobId) return jsonResponse({ error: 'Esperado { job_id }' }, 400)

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user: caller },
  } = await supabaseUser.auth.getUser()
  if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

  // Carrega o job com o client do usuário — a RLS de integration_hub_jobs já garante que
  // só enxergamos o job se pertencer a um tenant desse usuário (ou platform admin).
  const { data: job, error: jobError } = await supabaseUser
    .from('integration_hub_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()
  if (jobError || !job) {
    return jsonResponse({ error: 'Job não encontrado (ou sem permissão pra esse tenant).' }, 404)
  }
  if (job.tool !== 'carrossel' || job.status !== 'awaiting_approval') {
    return jsonResponse({ error: 'Job precisa ser um carrossel com status=awaiting_approval.' }, 400)
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
      .eq('tenant_id', job.tenant_id)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!membership || membership.role === 'tenant_viewer') {
      return jsonResponse({ error: 'Sem permissão pra aprovar carrossel nesse tenant.' }, 403)
    }
  }

  const draft = (job.result as any)?.draft as { slides: Slide[]; caption: string } | undefined
  const slides: Slide[] = Array.isArray(body.slides) && body.slides.length > 0 ? body.slides : draft?.slides ?? []
  const caption: string = typeof body.caption === 'string' ? body.caption : draft?.caption ?? ''
  if (slides.length === 0) {
    return jsonResponse({ error: 'Job sem slides pra renderizar.' }, 400)
  }

  await supabaseAdmin.from('integration_hub_jobs').update({ status: 'processing' }).eq('id', jobId)

  try {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('name, branding_json')
      .eq('id', job.tenant_id)
      .single()

    const branding = (company?.branding_json as { primary_color?: string; logo_url?: string }) ?? {}
    const html = buildCarrosselHtml({
      slides,
      caption,
      companyName: company?.name ?? 'Empresa',
      primaryColor: branding.primary_color ?? '#22D3EE',
      logoUrl: branding.logo_url,
    })

    const renderResponse = await fetch(`${RENDER_SERVICE_URL.replace(/\/$/, '')}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-secret': RENDER_SERVICE_SECRET },
      body: JSON.stringify({ html }),
    })
    if (!renderResponse.ok) {
      const errBody = await renderResponse.json().catch(() => ({}))
      throw new Error(errBody?.error ?? `render-service respondeu ${renderResponse.status}`)
    }
    const { images: base64Images } = (await renderResponse.json()) as { images: string[] }
    if (!base64Images || base64Images.length === 0) {
      throw new Error('render-service não retornou nenhuma imagem.')
    }

    const urls: string[] = []
    for (let i = 0; i < base64Images.length; i++) {
      const bytes = Uint8Array.from(atob(base64Images[i]), (c) => c.charCodeAt(0))
      const objectPath = `${jobId}/slide-${String(i + 1).padStart(2, '0')}.png`
      const { error: uploadError } = await supabaseAdmin.storage
        .from('hub-media')
        .upload(objectPath, bytes, { contentType: 'image/png', upsert: true })
      if (uploadError) throw new Error(`Falha subindo slide ${i + 1}: ${uploadError.message}`)
      const { data: publicUrl } = supabaseAdmin.storage.from('hub-media').getPublicUrl(objectPath)
      urls.push(publicUrl.publicUrl)
    }

    await supabaseAdmin
      .from('integration_hub_jobs')
      .update({ status: 'done', result: { images: urls, caption } })
      .eq('id', jobId)

    return jsonResponse({ ok: true, images: urls, caption })
  } catch (err) {
    const message = (err as Error).message
    await supabaseAdmin.from('integration_hub_jobs').update({ status: 'failed', error: message }).eq('id', jobId)
    return jsonResponse({ ok: false, error: message }, 502)
  }
})
