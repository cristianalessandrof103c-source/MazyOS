# marketing/ — saídas do MazyOS

Tudo que as skills de marketing produzem cai aqui. Skills do MazyOS já sabem onde salvar — você raramente precisa criar pasta manualmente.

## Estrutura padrão

```
marketing/
├── conteudo/                    saídas do /carrossel e /publicar-tema
│   └── <tipo>-<tema>-<YYYY-MM-DD>/
│       ├── carrossel.html
│       ├── render.js
│       ├── instagram/slide-XX.png
│       ├── legenda.md
│       └── legenda-linkedin.md
│
├── seo/                         saídas do /seo (8 passos)
│   ├── 01-pesquisa-demanda.md
│   ├── 02-analise-concorrencia.md
│   ├── 03-google-meu-negocio.md
│   ├── 04-otimizacao-on-page.md
│   ├── 05-estrategia-conteudo.md
│   ├── 06-google-ads.md
│   ├── 07-checklist-monitoramento.md
│   └── 08-geo-otimizacao-ia.md
│
├── campanhas/                   saídas do /anuncio-google, /anuncio-meta e /relatorio-ads
│   ├── google-ads-<YYYY-MM-DD>/  CSVs prontos pra importar
│   ├── meta-ads-<YYYY-MM-DD>/    resumo da campanha criada via API (sempre pausada)
│   └── relatorios/               relatórios semanais
│
├── integracao-meta-ads/         config e setup da automação de Meta Ads (não é saída de skill)
│   ├── config.json               regras travadas de escalonamento e kill-switch
│   ├── setup-meta-ads-api.md     guia de credenciais da Marketing API
│   └── logs/                     histórico diário do /otimizar-meta-ads
│
└── avaliacoes-google/           histórico do /responder-avaliacoes (opcional)
```

## Como funciona

- **`/carrossel` ou `/publicar-tema`** → cria pasta em `conteudo/<tipo>-<tema>-<data>/`
- **`/seo`** → preenche os 8 arquivos numerados em `seo/`
- **`/anuncio-google`** → cria pasta em `campanhas/google-ads-<data>/` com CSVs
- **`/anuncio-meta`** → cria campanha no Meta Ads via API (pausada) + resumo em `campanhas/meta-ads-<data>/`
- **`/otimizar-meta-ads`** → aplica as regras de `integracao-meta-ads/config.json` e loga em `integracao-meta-ads/logs/`
- **`/relatorio-ads`** → cria arquivo em `campanhas/relatorios/<data>-relatorio.md`
- **`/responder-avaliacoes`** → opcionalmente salva histórico em `avaliacoes-google/`

## Versionamento

Tudo aqui versiona no git pelo `/salvar`. Útil pra comparar evolução de SEO entre meses, rever copies antigas, ou recuperar peça depois de mexer no Insta.
