// Fase 10a/10b — agente local que segura a sessão do WhatsApp Web (não-oficial, via
// Baileys) e conversa com o dashboard através da Edge Function whatsapp-web-device. Não
// expõe porta nenhuma pro navegador (evita o problema de mixed-content HTTPS -> localhost)
// -- só faz fetch de saída, autenticado pelo DEVICE_TOKEN gerado no dashboard.
//
// Fase 10a: parear/desparear (QR, status, heartbeat).
// Fase 10b: drena a fila de mensagens de saída (pull-outbound) e reporta mensagens
// recebidas (push-inbound) -- é isso que faz o chat dentro do dashboard funcionar de
// verdade. Só texto 1:1 (sem grupo, sem mídia) no v1.

import 'dotenv/config'
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import qrcodeTerminal from 'qrcode-terminal'

const DEVICE_TOKEN = process.env.DEVICE_TOKEN
const FUNCTIONS_URL = process.env.FUNCTIONS_URL

if (!DEVICE_TOKEN || !FUNCTIONS_URL) {
  console.error('Defina DEVICE_TOKEN e FUNCTIONS_URL no .env (copie de .env.example primeiro).')
  process.exit(1)
}

const DEVICE_ENDPOINT = `${FUNCTIONS_URL.replace(/\/$/, '')}/whatsapp-web-device`
const HEARTBEAT_INTERVAL_MS = 20_000
const OUTBOUND_POLL_INTERVAL_MS = 2_000

async function chamarDevice(action, payload = {}) {
  try {
    const res = await fetch(DEVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-token': DEVICE_TOKEN },
      body: JSON.stringify({ action, ...payload }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error(`[whatsapp-web-device] ${action} falhou (HTTP ${res.status}):`, data)
      return null
    }
    return data
  } catch (err) {
    console.error(`[whatsapp-web-device] ${action} erro de rede:`, err.message)
    return null
  }
}

let outboundPollTimer = null

function startOutboundPolling(sock) {
  async function loop() {
    const result = await chamarDevice('pull-outbound')
    for (const msg of result?.messages ?? []) {
      if (!msg.phone_number) continue
      try {
        const sent = await sock.sendMessage(`${msg.phone_number}@s.whatsapp.net`, { text: msg.text })
        await chamarDevice('push-outbound-result', { message_id: msg.id, status: 'sent', whatsapp_message_id: sent?.key?.id ?? null })
      } catch (err) {
        console.error(`Falha ao enviar mensagem ${msg.id}:`, err.message)
        await chamarDevice('push-outbound-result', { message_id: msg.id, status: 'failed', error: err.message })
      }
    }
    outboundPollTimer = setTimeout(loop, OUTBOUND_POLL_INTERVAL_MS)
  }
  loop()
}

function stopOutboundPolling() {
  if (outboundPollTimer) clearTimeout(outboundPollTimer)
  outboundPollTimer = null
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_session')

  // Busca a versão atual do protocolo do WhatsApp Web -- a lib tem uma versão "de fábrica"
  // que fica desatualizada com o tempo (a Meta muda com frequência) e causa "Connection
  // Failure" logo depois do handshake, antes até de gerar o QR.
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('\nQR gerado -- escaneie pelo dashboard (Disparos -> WhatsApp), não precisa do QR abaixo:')
      qrcodeTerminal.generate(qr, { small: true })
      await chamarDevice('push-qr', { qr })
    }

    if (connection === 'open') {
      const numero = sock.user?.id?.split(':')[0] ?? null
      console.log(`Conectado ao WhatsApp${numero ? ` (${numero})` : ''}.`)
      await chamarDevice('push-connected', { phone_number: numero })
      startOutboundPolling(sock)
    }

    if (connection === 'close') {
      stopOutboundPolling()
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      await chamarDevice('push-disconnected')
      if (loggedOut) {
        console.log('Sessão desconectada (logout pelo celular ou pelo dashboard). Gere um QR novo pra reconectar.')
      } else {
        console.log('Conexão caiu, tentando reconectar em 3s...')
        setTimeout(start, 3000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) {
      if (m.key.fromMe) continue
      const jid = m.key.remoteJid ?? ''
      if (jid.endsWith('@g.us')) continue // grupos fora do escopo v1
      const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text
      if (!text) continue // mídia/outros tipos de mensagem fora do escopo v1
      const phoneNumber = jid.split('@')[0].replace(/\D/g, '')
      if (!phoneNumber) continue
      await chamarDevice('push-inbound', { phone_number: phoneNumber, text, profile_name: m.pushName ?? undefined })
    }
  })
}

setInterval(() => chamarDevice('heartbeat'), HEARTBEAT_INTERVAL_MS)

start().catch((err) => {
  console.error('Falha ao iniciar o agente:', err)
  process.exit(1)
})
