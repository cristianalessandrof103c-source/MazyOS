// Normalização de telefone pro formato que o resto do sistema já usa: dígitos, com
// código do país, SEM "+" (ex.: 5541991234567) — é como whatsapp-webhook grava
// waMessage.from e como enviarMensagemTexto manda direto no campo "to". A Cloud API não
// garante tolerância a variações, então corrigimos aqui em vez de mandar cru.

export type PhoneNormalization =
  | { status: 'ok'; phone: string; note?: 'added_missing_ninth_digit' | 'likely_landline' | 'unusual_format' }
  | { status: 'ok_international'; phone: string }
  | { status: 'invalid'; reason: string }

export function normalizePhoneBR(raw: string): PhoneNormalization {
  const trimmed = raw.trim()
  if (!trimmed) return { status: 'invalid', reason: 'vazio' }

  const explicitPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return { status: 'invalid', reason: 'sem dígitos' }

  // "+" explícito e não é código do Brasil: internacional, passa cru (dígitos, sem "+").
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
  let note: 'added_missing_ninth_digit' | 'likely_landline' | 'unusual_format' | undefined
  if (number.length === 8) {
    if (['6', '7', '8', '9'].includes(number[0])) {
      number = '9' + number
      note = 'added_missing_ninth_digit' // provável celular exportado sem o 9º dígito
    } else {
      note = 'likely_landline' // fixo não tem WhatsApp, mas deixa passar — a Cloud API rejeita se de fato não tiver
    }
  } else if (number.length === 9 && number[0] !== '9') {
    note = 'unusual_format'
  } else if (number.length !== 9) {
    return { status: 'invalid', reason: `número local com tamanho inesperado (${number.length})` }
  }

  return { status: 'ok', phone: `55${ddd}${number}`, note }
}

export const PHONE_NOTE_LABELS: Record<string, string> = {
  added_missing_ninth_digit: 'faltava o 9º dígito, corrigido automaticamente',
  likely_landline: 'parece telefone fixo (sem WhatsApp)',
  unusual_format: 'formato incomum, confira antes de disparar',
}
