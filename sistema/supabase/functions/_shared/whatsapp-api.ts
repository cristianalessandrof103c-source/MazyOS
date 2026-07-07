// Porte mínimo do padrão de scripts/lib/meta-graph.js pra Deno (fetch nativo em vez de node-fetch).
// Só o necessário pra Fase 2: mandar mensagem de texto livre via Cloud API.

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
