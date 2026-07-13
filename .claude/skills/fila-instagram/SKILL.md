---
name: fila-instagram
description: >
  Gera um lote de carrosséis (N posts de uma vez) pra Instagram/Facebook,
  usando o motor do /carrossel, e monta a fila de aprovação em
  marketing/conteudo/fila/. Não publica nada sozinho — só prepara o
  material e espera aprovação humana antes de qualquer post ir ao ar
  (ver scripts/publicar-fila.js e automacao-instagram/). Use quando o
  usuário pedir "gera a fila do instagram", "prepara os posts da
  semana", "quero N posts pra aprovar", ou /fila-instagram.
---

# /fila-instagram — Geração em lote pra fila de aprovação

Skill de automação. Gera vários carrosséis de uma vez (sem parar pra
aprovação de texto/foto a cada um, como o `/carrossel` interativo faz)
e organiza tudo numa fila com status, pronta pra você aprovar rápido e
pro `scripts/publicar-fila.js` publicar sozinho depois.

**Não usa o site `saidas/site/` em nada.** Isso é uma automação à parte
— o carrossel avulso vira post direto no Instagram/Facebook, não vira
artigo de blog nem toca em HTML/CSS do site.

## Dependências

- `_memoria/empresa.md`, `_memoria/preferencias.md` — contexto e tom
- `identidade/design-guide.md` — visual (mesmas regras do `/carrossel`)
- `marketing/conteudo/banco-de-temas-instagram.md` — banco de temas e
  regras de rotação
- `.claude/skills/carrossel/SKILL.md` — motor de geração de HTML/PNG
- `automacao-instagram/setup-meta.md` e `setup-repo-imagens.md` —
  pré-requisitos pra publicação real (não pra geração)

## Argumento

`/fila-instagram <quantidade> [horários]`

Se não vier quantidade, perguntar: "Quantos posts eu gero? (ex: 21 =
uma semana com 3/dia, 28 = uma semana com 4/dia)"

Se não vier horário, usar o padrão: `09:00, 12:30, 16:00, 19:30`
(ajustável — perguntar se o usuário nunca definiu antes).

## Workflow

### Passo 1 — Escolher os temas

1. Ler `marketing/conteudo/banco-de-temas-instagram.md`
2. Ler `marketing/conteudo/fila/temas-usados.json` (criar vazio se não
   existir: `{ "usados": [] }`)
3. Escolher os próximos N temas respeitando as regras de rotação do
   banco (não repetir categoria consecutiva, não repetir tema já usado
   até esgotar a lista)
4. Atualizar `temas-usados.json` com os temas escolhidos + data

### Passo 2 — Gerar cada post (sem checkpoint interativo)

Pra cada tema escolhido, seguir o motor do `/carrossel` (tipo 1: texto
puro — é o padrão pra esse volume; só usar foto IA se o usuário pedir
explicitamente pra fila toda):

- Escrever o texto dos slides direto (sem parar pra aprovação — o
  checkpoint aqui é depois, na fila inteira, não post a post)
- Gerar `carrossel.html` + `render.js` + PNGs em
  `instagram/slide-01.png` → `slide-NN.png`
- Gerar `legenda.md` (mesma estrutura do `/carrossel`: hook, contexto,
  CTA, oferta, hashtags)
- Alternar capa (claro → foto/escuro → cor principal) considerando a
  última capa usada na fila

**Pasta de cada post:**
```
marketing/conteudo/fila/<YYYY-MM-DD>/post-01/
  carrossel.html
  render.js
  instagram/slide-01.png → slide-NN.png
  legenda.md
```

### Passo 3 — Montar/atualizar o manifest

Criar ou atualizar `marketing/conteudo/fila/fila.json`:

```json
{
  "posts": [
    {
      "id": "2026-07-06/post-01",
      "tema": "Botox: o que realmente acontece na pele",
      "categoria": "Procedimento explicado simples",
      "pasta": "marketing/conteudo/fila/2026-07-06/post-01",
      "horario_previsto": "2026-07-07T09:00:00-03:00",
      "status": "pendente",
      "publicado_em": null,
      "instagram_post_id": null,
      "facebook_post_id": null
    }
  ]
}
```

`status` começa sempre `"pendente"`. Só vira `"aprovado"` quando o
usuário aprovar explicitamente (Passo 4). Só o `scripts/publicar-fila.js`
muda pra `"publicado"`, e só publica o que estiver `"aprovado"`.

### Passo 4 — Pedir aprovação

Depois de gerar o lote inteiro, mostrar um resumo compacto (não a fila
inteira em detalhe):

```
Gerei N posts pra fila:
1. post-01 — "Botox: o que realmente acontece na pele" (prev: 07/07 09:00)
2. post-02 — "..." (prev: 07/07 12:30)
...

Quer que eu monte uma galeria pra você bater o olho rápido, ou prefere
aprovar por número (ex: "aprova 1, 3, 4 — ajusta o 2")?
```

Se o usuário pedir galeria: montar um `Artifact` HTML simples mostrando
a capa de cada post lado a lado (imagem + tema + horário previsto).

Ao receber a aprovação, atualizar o `status` de cada post aprovado pra
`"aprovado"` no `fila.json`. Post não mencionado continua `"pendente"`
(não publica).

## Regras

- Nunca marcar um post como `"aprovado"` sozinho — só o usuário aprova
- Nunca gerar foto de rosto identificável (mesma regra do `/carrossel`)
- Nunca escrever em `saidas/site/` nem em nada relacionado ao site
- Seguir `_memoria/preferencias.md` estritamente (tom, sem clichê)
- Reaproveitar `render.js`/`node_modules` de posts anteriores quando
  possível, do mesmo jeito que o `/carrossel` já faz
- Se `marketing/conteudo/banco-de-temas-instagram.md` esgotar os temas
  no meio do lote, avisar e recomeçar do início da lista
