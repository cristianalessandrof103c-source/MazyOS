// Fase 2 do hub de integrações — mesma lógica de screenshot que já existia em
// marketing/conteudo/*/render.js (Playwright, viewport 1080x1350, screenshot de cada
// .slide), só que como serviço HTTP em vez de script CLI que lê/escreve arquivo local:
// recebe o HTML pronto (com todos os slides), devolve os PNGs em base64. Não guarda
// nada em disco além do necessário pro Chromium renderizar.
//
// Roda em Cloud Run (container com Playwright pré-instalado) porque Supabase Edge
// Functions (Deno Deploy) não tem Chromium — só quem chama isto é hub-render-carrossel,
// autenticado por um segredo compartilhado (x-render-secret), nunca o navegador do tenant.

import express from 'express'
import { chromium } from 'playwright'

const app = express()
app.use(express.json({ limit: '5mb' }))

const PORT = process.env.PORT || 8080
const RENDER_SERVICE_SECRET = process.env.RENDER_SERVICE_SECRET

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/render', async (req, res) => {
  if (!RENDER_SERVICE_SECRET || req.get('x-render-secret') !== RENDER_SERVICE_SECRET) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { html } = req.body ?? {}
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Esperado { html: string } com o carrossel completo (todos os slides)' })
  }

  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } })
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)

    const slides = await page.$$('.slide')
    if (slides.length === 0) {
      return res.status(422).json({ error: 'HTML recebido não tem nenhum elemento .slide' })
    }

    const images = []
    for (const slide of slides) {
      const buffer = await slide.screenshot()
      images.push(buffer.toString('base64'))
    }

    res.json({ images })
  } catch (err) {
    console.error('Erro renderizando carrossel:', err)
    res.status(500).json({ error: err.message })
  } finally {
    if (browser) await browser.close()
  }
})

app.listen(PORT, () => console.log(`render-service ouvindo na porta ${PORT}`))
