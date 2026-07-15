# render-service

Serviço HTTP que renderiza o carrossel (HTML → PNG) via Playwright, chamado pela Edge
Function `hub-render-carrossel`. Existe porque Supabase Edge Functions (Deno Deploy) não
têm Chromium — isso não pode virar mais uma function do Supabase.

Não faz parte do app Vite (`sistema/`) nem do MazyOS (`scripts/`) — é um serviço à parte,
implantado no **Google Cloud Run** (escala a zero: sem custo parado quando ninguém está
gerando carrossel).

## Deploy (pelo console do Cloud Run, sem precisar de `gcloud` local)

1. Acesse [console.cloud.google.com/run](https://console.cloud.google.com/run) (crie um
   projeto GCP se ainda não tiver um — tem free tier).
2. **Criar serviço** → **Implantar continuamente a partir de um repositório** → conecte a
   conta do GitHub e selecione o repo `cristianalessandrof103c-source/MazyOS`
   (ver [[deploy-sistema-netlify]] pra confirmar que é esse o repo real por trás do
   remote).
3. Configuração de build:
   - **Tipo de build**: Dockerfile.
   - **Local do Dockerfile / diretório de origem**: `render-service` (é uma subpasta do
     repo — o Cloud Build precisa saber que o contexto de build é essa pasta, não a
     raiz).
4. Configuração do serviço:
   - **Memória**: 2 GiB (Playwright/Chromium precisa de folga).
   - **CPU**: 1.
   - **Número mín. de instâncias**: 0 (escala a zero — não cobra parado).
   - **Número máx. de instâncias**: 2 ou 3 (não precisa de mais, o volume é baixo).
   - **Tempo limite da solicitação**: 60s (renderizar 5-8 slides não deveria passar
     disso; ajuste se começar a estourar).
   - **Autenticação**: permitir invocações não autenticadas (a segurança de verdade é o
     header `x-render-secret`, verificado no `server.js`).
5. Variável de ambiente: `RENDER_SERVICE_SECRET` = uma string aleatória longa (gere uma,
   ex.: `openssl rand -hex 32` ou qualquer gerador de senha). **Guarde esse valor** — ele
   também vai virar secret da Edge Function `hub-render-carrossel` no Supabase (mesmo
   valor dos dois lados, senão a chamada é rejeitada com 403).
6. Deploy. Ao terminar, o Cloud Run mostra a **URL do serviço**
   (`https://render-service-xxxxx-uc.a.run.app` ou similar).

## Ligando ao resto do sistema

No painel do Supabase (Edge Functions → `hub-render-carrossel` → Secrets), configure:

- `RENDER_SERVICE_URL` = a URL do passo 6 (sem barra no final).
- `RENDER_SERVICE_SECRET` = o mesmo valor gerado no passo 5.

## Testando sozinho

```bash
curl -X POST https://SEU-SERVICO.a.run.app/render \
  -H "Content-Type: application/json" \
  -H "x-render-secret: SEU_SECRET" \
  -d '{"html": "<div class=\"slide\" style=\"width:1080px;height:1350px;background:#0E1116\"></div>"}'
```

Deve devolver `{ "images": ["<base64 de 1 PNG preto>"] }`.

## Rodando local (se algum dia tiver Node.js disponível)

```bash
npm install
RENDER_SERVICE_SECRET=teste node server.js
```
