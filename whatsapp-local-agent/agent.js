// Fase 10a — agente local que segura a sessão do WhatsApp Web (não-oficial, via Baileys) e
// reporta o estado pro dashboard através da Edge Function whatsapp-web-device. Não expõe
// porta nenhuma pro navegador (evita o problema de mixed-content HTTPS -> localhost) -- só
// faz fetch de saída, autenticado pelo DEVICE_TOKEN gerado no dashboard.
//
// v1 (Fase 10a) só cobre parear/desparear -- não manda nem recebe mensagem ainda. Fases
// 10b/10c vão estender esse arquivo com o polling de pull-outbound (fila de saída) e o
// listener de messages.upsert (mensagens recebidas -> push-inbound).

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

async function chamarDevice(action, payload = {}) {
  try {
    const res = await fetch(DEVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-token': DEVICE_TOKEN },
      body: JSON.stringify({ action, ...payload }),
    })
    if (!res.ok) {
      console.error(`[whatsapp-web-device] ${action} falhou (HTTP ${res.status}): ${await res.text()}`)
    }
  } catch (err) {
    console.error(`[whatsapp-web-device] ${action} erro de rede:`, err.message)
  }
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
    }

    if (connection === 'close') {
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
}

setInterval(() => chamarDevice('heartbeat'), HEARTBEAT_INTERVAL_MS)

start().catch((err) => {
  console.error('Falha ao iniciar o agente:', err)
  process.exit(1)
})
