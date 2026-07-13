// Resolve qual token da Cloud API usar por conexão — test (sandbox, Fase 2) e live
// (número real, Fase 6) têm credenciais diferentes mesmo compartilhando o mesmo
// App/webhook. Usado por whatsapp-webhook e follow-up-dispatcher.

const WHATSAPP_TEST_ACCESS_TOKEN = Deno.env.get('WHATSAPP_TEST_ACCESS_TOKEN') ?? ''
const WHATSAPP_LIVE_ACCESS_TOKEN = Deno.env.get('WHATSAPP_LIVE_ACCESS_TOKEN') ?? ''

export function tokenParaConexao(status: string): string {
  return status === 'live' ? WHATSAPP_LIVE_ACCESS_TOKEN : WHATSAPP_TEST_ACCESS_TOKEN
}
