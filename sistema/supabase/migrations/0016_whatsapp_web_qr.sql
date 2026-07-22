-- Fase 10a — segunda via de disparo/atendimento por WhatsApp: conexão não-oficial via
-- WhatsApp Web (QR Code), pedido do dono inspirado no concorrente Kaptar. Coexiste com a
-- Cloud API oficial da Meta (Fase 2/9/10) — não substitui, é um `connection_type` novo na
-- mesma tabela `whatsapp_connections`, reaproveitando `conversations`/`messages` como já
-- estão (uma conversa via QR fica indistinguível de uma via Cloud API pro resto do app).
--
-- Quem segura a sessão do WhatsApp Web é um processo local (fora deste repo de infra —
-- ver `whatsapp-local-agent/` na raiz), rodando no PC do usuário (decisão dele: sem custo
-- de servidor 24/7, mas só funciona com o PC ligado). Esse agente local não fala com o
-- Postgres direto — só chama a Edge Function `whatsapp-web-device` via HTTP, autenticado
-- por um token de dispositivo (não é JWT de usuário, é o "segredo" desse tenant específico).

-- ============================================================
-- whatsapp_connections — vira "polimórfica": cloud_api (existente) ou qr_web (nova).
-- ============================================================
alter table public.whatsapp_connections
  add column connection_type text not null default 'cloud_api' check (connection_type in ('cloud_api', 'qr_web'));

comment on column public.whatsapp_connections.connection_type is
  'cloud_api = Cloud API oficial da Meta (Fase 2, exige Template aprovado fora da janela de 24h).
   qr_web = WhatsApp Web não-oficial pareado por QR Code (Fase 10a), sem essa exigência mas
   com risco de bloqueio do número por violar os termos de uso do WhatsApp — decisão do dono.';

-- phone_number_id/business_account_id só fazem sentido pra cloud_api; qr_web não tem os dois
-- (o "número" só se sabe depois de parear, vira connected_phone_number).
alter table public.whatsapp_connections alter column phone_number_id drop not null;
alter table public.whatsapp_connections alter column business_account_id drop not null;

alter table public.whatsapp_connections
  add constraint whatsapp_connections_cloud_api_fields check (
    connection_type <> 'cloud_api' or (phone_number_id is not null and business_account_id is not null)
  );

alter table public.whatsapp_connections
  add column web_status text not null default 'disconnected' check (web_status in ('disconnected', 'qr_pending', 'connected')),
  add column qr_pairing_code text,
  add column qr_updated_at timestamptz,
  add column web_device_token_hash text unique,
  add column connected_phone_number text,
  add column last_seen_at timestamptz;

comment on column public.whatsapp_connections.web_device_token_hash is
  'SHA-256 (hex) do token de dispositivo — nunca guardamos o token em texto puro. O token só
   existe em texto puro uma vez, na resposta da Edge Function whatsapp-web-connection?action=create
   (o dono copia pro .env do agente local ali mesmo); depois disso é irrecuperável, só dá pra
   gerar um novo. Motivo: com esse token, quem tiver acesso de leitura à linha (inclusive um
   tenant_viewer, que hoje só tem select) conseguiria rodar um agente próprio se posando pela
   conexão — guardar em texto puro exporia isso pra qualquer leitura da tabela.';

comment on column public.whatsapp_connections.qr_pairing_code is
  'String bruta do QR gerado pelo Baileys (não uma imagem) — o dashboard decodifica pra
   canvas no client com qrcode.react. Reescrito a cada ciclo de pareamento (~20s) até conectar.';

comment on column public.whatsapp_connections.last_seen_at is
  'Heartbeat do agente local — se ficar muito tempo sem atualizar com web_status=connected,
   a UI pode inferir que o processo local caiu mesmo sem um push-disconnected explícito.';

-- ============================================================
-- conversations — passa a saber por qual conexão está passando (útil quando o tenant tem
-- cloud_api e qr_web ao mesmo tempo). Nullable: conversas antigas do webhook continuam sem.
-- ============================================================
alter table public.conversations
  add column whatsapp_connection_id uuid references public.whatsapp_connections (id) on delete set null;

-- ============================================================
-- messages — fila de saída do canal qr_web precisa de status (cloud_api manda síncrono no
-- próprio request do webhook/dispatcher, não precisa; qr_web depende do agente local drenar
-- por polling, então a linha existe "queued" antes de ser efetivamente enviada).
-- ============================================================
alter table public.messages
  add column status text not null default 'sent' check (status in ('queued', 'sent', 'failed'));

comment on column public.messages.status is
  'Só relevante pro canal qr_web: mensagens outbound entram "queued" (inseridas pelo dashboard
   via whatsapp-web-send) e o agente local marca "sent"/"failed" ao processar via
   whatsapp-web-device?action=push-outbound-result. Mensagens de cloud_api e todo inbound
   nascem direto "sent" (enviadas/recebidas de forma síncrona, sem fila).';

create index messages_queued_idx on public.messages (conversation_id) where status = 'queued';
