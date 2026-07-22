# whatsapp-local-agent

Segura a sessão do WhatsApp Web (QR Code, não-oficial, via
[Baileys](https://github.com/WhiskeySockets/Baileys)) e avisa o dashboard (`sistema/`, aba
**Disparos → WhatsApp**) do que está acontecendo: QR novo, conectado, desconectado.

Roda **no seu PC**, não numa nuvem — é a mesma lógica do "Servidor S-zap" do Kaptar. Isso
quer dizer:

- Sem custo de servidor rodando 24/7.
- Só funciona enquanto esse processo estiver aberto e o computador ligado.
- Não é um instalador de clique único (ainda) — é um script Node que você roda pelo
  terminal. Empacotar num `.exe` é um passo futuro, não bloqueia usar agora.

Não faz parte do app Vite (`sistema/`) nem do MazyOS (`scripts/`) — é um serviço à parte,
igual o `render-service/` na raiz do repo, só que local em vez de na nuvem.

## Como usar

1. No dashboard, vá em **Disparos → WhatsApp** e clique em **Conectar WhatsApp**. Copie o
   token que aparece (só aparece uma vez — se fechar sem copiar, gere outro).
2. Nesta pasta:
   ```bash
   npm install
   cp .env.example .env
   ```
3. Abra o `.env` e preencha:
   - `DEVICE_TOKEN` = o token que você copiou no passo 1.
   - `FUNCTIONS_URL` = a URL das Edge Functions do projeto (`https://SEU-PROJETO.supabase.co/functions/v1`).
4. `npm start`.
5. Volte pro dashboard — o QR Code deve aparecer lá (não precisa usar o QR que também
   aparece no terminal, ele é só um fallback de debug). Escaneie com o WhatsApp do celular
   (Aparelhos conectados → Conectar um aparelho).
6. Quando parear, o dashboard mostra "Conectado" com o número.

## Reconectar / trocar de número

Clique em **Desconectar** no dashboard, apague a pasta `auth_session/` aqui (ela guarda a
sessão pareada) e repita o passo 1 em diante com um token novo.

## Segurança

`DEVICE_TOKEN` e a pasta `auth_session/` são, juntos, equivalentes a estar logado no
WhatsApp desse número — não commite nenhum dos dois (o `.gitignore` já cobre isso) nem
compartilhe com ninguém fora da empresa.
