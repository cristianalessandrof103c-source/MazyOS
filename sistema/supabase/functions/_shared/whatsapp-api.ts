// Porte mínimo do padrão de scripts/lib/meta-graph.js pra Deno (fetch nativo em vez de node-fetch).
// enviarMensagemTexto (Fase 2) manda texto livre; enviarMensagemTemplate (Fase 9) manda
// Template pré-aprovado, usado pelo disparo em massa.

const GRAPH_VERSION = 'v21.0'

export async function enviarMensagemTexto(args: {
  phoneNumberId: string
  token: string
  to: string
  body: string
}): Promise<string> {
  const { phoneNumberId, token, to, body } = args
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`
    throw new Error(`WhatsApp send falhou: ${msg}`)
  }
  return data.messages?.[0]?.id ?? ''
}

// Fase 9 — envio de Template pré-aprovado, obrigatório pra mensagem fria fora da janela
// de 24h da Cloud API (é o caso de disparo em massa pra contato importado via CSV).
export class WhatsAppSendError extends Error {
  metaCode?: number
  constructor(message: string, metaCode?: number) {
    super(message)
    this.metaCode = metaCode
  }
}

export async function enviarMensagemTemplate(args: {
  phoneNumberId: string
  token: string
  to: string
  templateName: string
  templateLanguage: string
  bodyParameters: string[]
}): Promise<string> {
  const { phoneNumberId, token, to, templateName, templateLanguage, bodyParameters } = args
  const template: Record<string, unknown> = { name: templateName, language: { code: templateLanguage } }
  if (bodyParameters.length > 0) {
    template.components = [
      { type: 'body', parameters: bodyParameters.map((text) => ({ type: 'text', text })) },
    ]
  }
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const code = data.error?.code as number | undefined
    const msg = data.error ? `${data.error.message} (code ${code})` : `HTTP ${res.status}`
    throw new WhatsAppSendError(`WhatsApp template send falhou: ${msg}`, code)
  }
  return data.messages?.[0]?.id ?? ''
}
