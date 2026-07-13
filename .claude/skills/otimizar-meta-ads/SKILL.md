---
name: otimizar-meta-ads
description: >
  Roda o motor de escalonamento e kill-switch das campanhas de Meta Ads já ativas — verifica
  performance diária, aumenta orçamento de conjuntos estáveis (dentro do limite travado em
  config.json), pausa automaticamente conjunto que está queimando dinheiro sem resultado, e
  alerta sobre frequência alta ou situações fora das regras que exigem aprovação manual.
  Use quando o usuário pedir "otimizar meta ads", "escalar campanha", "rodar otimização",
  "checar queima de orçamento", ou /otimizar-meta-ads.
---

# /otimizar-meta-ads — Motor de escalonamento + kill-switch

Roda `scripts/otimizar-meta-ads.js`, que aplica as regras travadas em
`marketing/integracao-meta-ads/config.json`. **Essa skill nunca inventa threshold na hora** — os
números vêm todos do config. Se o usuário pedir pra "escalar mais rápido" ou "ser menos
conservador", a resposta é editar o `config.json` junto com ele, não pedir pro script ignorar a
regra numa execução isolada.

## Dependências

- `scripts/otimizar-meta-ads.js` + `scripts/lib/meta-ads-api.js`
- `marketing/integracao-meta-ads/config.json` — regras travadas
- Logs ficam em `marketing/integracao-meta-ads/logs/<data>.md`

## Como rodar

Perguntar (se não tiver sido passado):

1. **Qual campanha?** (campaign_id — ou pedir pra listar as campanhas ativas da conta primeiro)
2. **Modo:** dry-run (só simula e relata) ou aplicar de verdade?

Rodar:

```bash
node --env-file=.env scripts/otimizar-meta-ads.js --campanha <campaign_id>
```

Só adicionar `--aplicar` se o usuário confirmar explicitamente que quer mudanças reais na conta
**e** `config.json` → `modo_execucao.dry_run_padrao` já estiver `false`. Se `dry_run_padrao` ainda
for `true`, avisar que está rodando em dry-run mesmo com `--aplicar` — isso é proposital (proteção
dupla) até o usuário destravar de propósito.

## Regra de primeira vez

Se ainda não existe nenhum log em `marketing/integracao-meta-ads/logs/`, tratar como primeira
execução: recomendar rodar em dry-run por pelo menos 3-5 dias antes de sugerir destravar
`dry_run_padrao` pra `false`. Não sugerir destravar antes disso mesmo se o usuário perguntar —
explicar o motivo (validar que a lógica de decisão está calibrada certo antes de deixar mexer em
dinheiro de verdade).

## Interpretando o resultado

O script devolve, por conjunto de anúncios:

- **PAUSAR** — kill-switch disparou. Reportar o motivo exato (qual das duas regras) e confirmar
  que foi aplicado (ou que seria aplicado, em dry-run).
- **AUMENTAR_ORCAMENTO** — elegível pra escalar dentro das regras. Reportar orçamento antigo →
  novo e o motivo (dias estáveis + resultados acumulados).
- **AVISO** — situação que precisa de decisão humana (ex: escalaria mas passaria do teto
  absoluto; CPA alvo ainda não definido). **Nunca resolver um AVISO sozinho** — sempre trazer pro
  usuário decidir.

## Resumo pro usuário

```markdown
## Otimização Meta Ads — <data> (modo: dry-run / aplicado)

**<Nome do conjunto>** — gasto hoje R$X, Y resultados
- [PAUSAR] <motivo>
- [AUMENTAR_ORCAMENTO] R$X → R$Y — <motivo>
- [AVISO] <motivo — precisa da sua decisão>
```

Se tiver algum `AVISO` envolvendo teto de orçamento (`limite_max_absoluto_diario_reais`),
perguntar diretamente: "Quer que eu suba o teto no config.json pra R$X, ou prefere manter o
conjunto travado nesse orçamento por enquanto?"

## Frequência de execução

Recomendar rodar uma vez por dia (não mais que isso — o `intervalo_minimo_entre_aumentos_horas`
do config já assume execução diária; rodar de hora em hora não acelera a escalada, só gasta
chamada de API à toa). Se o usuário quiser automatizar isso pra rodar sozinho todo dia sem
precisar pedir, usar a skill `schedule` (rotina agendada) — só sugerir isso depois que o usuário
já validou o comportamento em dry-run por alguns dias.

---

## Regras

- **Nunca ignorar ou burlar um limite do config numa execução isolada.** Se o usuário quer mudar
  o comportamento, a mudança é no `config.json`, versionada, não uma exceção pontual.
- **AVISO nunca vira ação automática.** É sempre pra decisão humana.
- **Reportar perda sem suavizar.** "Pausou o conjunto X porque queimou R$40 sem resultado" é mais
  útil que "o conjunto X teve performance abaixo do esperado".
- Seguir `_memoria/preferencias.md` pro tom do resumo.
