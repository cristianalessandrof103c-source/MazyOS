/**
 * Motor de escalonamento + kill-switch do Meta Ads.
 *
 * Lê marketing/integracao-meta-ads/config.json e SÓ executa ações dentro
 * daqueles limites. Não decide número nenhum sozinho — todo threshold vem
 * do config.
 *
 * Uso:
 *   node --env-file=.env scripts/otimizar-meta-ads.js --campanha <campaign_id>
 *   node --env-file=.env scripts/otimizar-meta-ads.js --campanha <campaign_id> --aplicar
 *
 * Sem --aplicar, roda em dry-run: só imprime e loga o que faria, não muda
 * nada de verdade na conta. config.json também tem "dry_run_padrao" — se
 * true, dry-run mesmo com --aplicar (proteção dupla; precisa dos dois pra
 * executar de verdade: flag --aplicar E dry_run_padrao=false no config).
 */

const fs = require('fs');
const path = require('path');
const api = require('./lib/meta-ads-api');

const CONFIG_PATH = path.join(__dirname, '..', 'marketing', 'integracao-meta-ads', 'config.json');
const LOG_DIR = path.join(__dirname, '..', 'marketing', 'integracao-meta-ads', 'logs');
const ESTADO_PATH = path.join(LOG_DIR, 'estado.json');

function carregarConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/** Estado persistido entre execuções: só guarda quando foi o último aumento de orçamento aplicado de verdade por conjunto. */
function carregarEstado() {
  if (!fs.existsSync(ESTADO_PATH)) return {};
  return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8'));
}

function salvarEstado(estado) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2));
}

function horaLocalNaConta(timezoneName) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezoneName, hour: 'numeric', hour12: false });
  return Number(formatter.format(new Date()));
}

function cpaDoDia(diaInsights, actionType) {
  const resultados = api.extrairResultado(diaInsights, actionType);
  const spend = Number(diaInsights.spend || 0);
  if (resultados === 0) return null;
  return spend / resultados;
}

/** Verifica se os últimos N dias têm CPA estável dentro da variação máxima permitida. */
function diasEstaveis(diasInsights, actionType, nDias, variacaoMaxPct) {
  const ultimos = diasInsights.slice(-nDias);
  if (ultimos.length < nDias) return { estavel: false, motivo: 'dados insuficientes' };

  const cpas = ultimos.map((d) => cpaDoDia(d, actionType));
  if (cpas.some((c) => c === null)) return { estavel: false, motivo: 'algum dia sem resultado' };

  const min = Math.min(...cpas);
  const max = Math.max(...cpas);
  const variacaoPct = ((max - min) / min) * 100;
  return { estavel: variacaoPct <= variacaoMaxPct, motivo: `variação de ${variacaoPct.toFixed(1)}%`, cpas };
}

async function avaliarConjunto({ conjunto, config, token, aplicar, estado }) {
  const acoes = [];
  const actionType = config.objetivo.action_type_resultado;
  const tz = config._timezoneConta || 'America/Sao_Paulo';

  const insightsHoje = await api.buscarInsights({ objectId: conjunto.id, token, datePreset: 'today' });
  const diasInsights = await api.buscarInsightsDiarios({ objectId: conjunto.id, token, dias: 7 });

  const spendHoje = Number(insightsHoje?.spend || 0);
  const resultadosHoje = api.extrairResultado(insightsHoje, actionType);
  const horaAtualLocal = horaLocalNaConta(tz);

  // --- Regra (b) do kill-switch: gasto precoce sem resultado ---
  const { janela_horas_verificacao_precoce, percentual_budget_diario_sem_resultado_precoce } = config.kill_switch;
  const limiteGastoPrecoce = (conjunto.daily_budget * percentual_budget_diario_sem_resultado_precoce) / 100;

  if (
    config.kill_switch.ativo &&
    horaAtualLocal <= janela_horas_verificacao_precoce &&
    resultadosHoje === 0 &&
    spendHoje >= limiteGastoPrecoce
  ) {
    acoes.push({
      tipo: 'PAUSAR',
      motivo: `Kill-switch (b): gastou R$${spendHoje.toFixed(2)} (>= ${percentual_budget_diario_sem_resultado_precoce}% do orçamento) nas primeiras ${janela_horas_verificacao_precoce}h sem nenhum resultado.`,
    });
  }

  // --- Regra (a) do kill-switch: CPA alvo * multiplicador sem resultado ---
  if (config.kill_switch.ativo && config.kill_switch.cpa_alvo_reais && resultadosHoje === 0) {
    const limiteA = config.kill_switch.cpa_alvo_reais * config.kill_switch.multiplicador_cpa_alvo_sem_resultado;
    if (spendHoje >= limiteA) {
      acoes.push({
        tipo: 'PAUSAR',
        motivo: `Kill-switch (a): gastou R$${spendHoje.toFixed(2)} (>= ${config.kill_switch.multiplicador_cpa_alvo_sem_resultado}x o CPA alvo de R$${config.kill_switch.cpa_alvo_reais}) sem nenhum resultado hoje.`,
      });
    }
  } else if (config.kill_switch.ativo && !config.kill_switch.cpa_alvo_reais) {
    acoes.push({ tipo: 'AVISO', motivo: 'cpa_alvo_reais ainda não definido no config — regra (a) do kill-switch está desativada até isso ser preenchido.' });
  }

  // --- Escalonamento (só avalia se não caiu em nenhum kill-switch acima) ---
  const jaVaiPausar = acoes.some((a) => a.tipo === 'PAUSAR');
  if (!jaVaiPausar && config.escalonamento.ativo) {
    const {
      dias_consecutivos_estaveis_minimo,
      variacao_cpa_maxima_para_considerar_estavel_pct,
      resultados_acumulados_minimo,
      percentual_max_aumento_por_vez,
      intervalo_minimo_entre_aumentos_horas,
    } = config.escalonamento;

    const ultimoAumento = estado[conjunto.id]?.ultimo_aumento;
    const horasDesdeUltimoAumento = ultimoAumento ? (Date.now() - new Date(ultimoAumento).getTime()) / 3_600_000 : Infinity;

    if (horasDesdeUltimoAumento < intervalo_minimo_entre_aumentos_horas) {
      acoes.push({
        tipo: 'AVISO',
        motivo: `Poderia estar elegível, mas o último aumento foi há ${horasDesdeUltimoAumento.toFixed(1)}h — precisa esperar ${intervalo_minimo_entre_aumentos_horas}h entre aumentos.`,
      });
    } else {
      const resultadosAcumulados = diasInsights.reduce((soma, d) => soma + api.extrairResultado(d, actionType), 0);
      const { estavel, motivo, cpas } = diasEstaveis(
        diasInsights,
        actionType,
        dias_consecutivos_estaveis_minimo,
        variacao_cpa_maxima_para_considerar_estavel_pct
      );

      if (estavel && resultadosAcumulados >= resultados_acumulados_minimo) {
        const orcamentoAtual = conjunto.daily_budget;
        let novoOrcamento = orcamentoAtual * (1 + percentual_max_aumento_por_vez / 100);

        if (novoOrcamento > config.orcamento.limite_max_absoluto_diario_reais) {
          acoes.push({
            tipo: 'AVISO',
            motivo: `Elegível pra escalar, mas o novo orçamento (R$${novoOrcamento.toFixed(2)}) passaria do teto absoluto (R$${config.orcamento.limite_max_absoluto_diario_reais}). Precisa de aprovação manual pra subir além do teto.`,
          });
        } else {
          acoes.push({
            tipo: 'AUMENTAR_ORCAMENTO',
            motivo: `${dias_consecutivos_estaveis_minimo} dias estáveis (${motivo}), ${resultadosAcumulados} resultados acumulados (mín. ${resultados_acumulados_minimo}). CPAs: ${cpas?.map((c) => c.toFixed(2)).join(', ')}`,
            orcamentoAtual,
            novoOrcamento,
          });
        }
      }
    }
  }

  // --- Alerta de frequência ---
  const frequencia = Number(insightsHoje?.frequency || 0);
  if (frequencia > config.alertas.frequencia_maxima) {
    acoes.push({ tipo: 'AVISO', motivo: `Frequência ${frequencia.toFixed(2)} acima do limite de ${config.alertas.frequencia_maxima} — público pode estar saturado.` });
  }

  // --- Execução (só se não estiver em dry-run) ---
  const dryRun = config.modo_execucao.dry_run_padrao || !aplicar;
  for (const acao of acoes) {
    if (dryRun || acao.tipo === 'AVISO') continue;
    if (acao.tipo === 'PAUSAR') {
      await api.pausarConjunto({ adsetId: conjunto.id, token });
    } else if (acao.tipo === 'AUMENTAR_ORCAMENTO') {
      await api.atualizarOrcamentoConjunto({ adsetId: conjunto.id, token, novoOrcamentoReais: acao.novoOrcamento });
      estado[conjunto.id] = { ultimo_aumento: new Date().toISOString() };
    }
  }

  return { conjunto, acoes, dryRun, spendHoje, resultadosHoje };
}

async function main() {
  const args = process.argv.slice(2);
  const campanhaIdx = args.indexOf('--campanha');
  const campaignId = campanhaIdx >= 0 ? args[campanhaIdx + 1] : null;
  const aplicar = args.includes('--aplicar');

  if (!campaignId) {
    console.error('Uso: node scripts/otimizar-meta-ads.js --campanha <campaign_id> [--aplicar]');
    process.exit(1);
  }

  const token = process.env.META_ADS_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAccountId) {
    console.error('Faltam META_ADS_ACCESS_TOKEN ou META_AD_ACCOUNT_ID no .env');
    process.exit(1);
  }

  const config = carregarConfig();
  if (!config.conta.ad_account_id) {
    console.error('config.json ainda não foi preenchido (bloco "conta"). Rode o setup antes.');
    process.exit(1);
  }

  const contaInfo = await api.testarConexao({ adAccountId, token });
  config._timezoneConta = contaInfo.timezone_name;

  const conjuntos = await api.listarConjuntosDaCampanha({ campaignId, token });
  const ativos = conjuntos.filter((c) => c.effective_status === 'ACTIVE');

  const estado = carregarEstado();
  const relatorio = [];
  for (const conjunto of ativos) {
    const resultado = await avaliarConjunto({ conjunto, config, token, aplicar, estado });
    relatorio.push(resultado);
  }
  salvarEstado(estado);

  const modo = config.modo_execucao.dry_run_padrao || !aplicar ? 'DRY-RUN (nada foi alterado de verdade)' : 'APLICADO (mudanças reais feitas na conta)';
  console.log(`\n=== Otimização Meta Ads — ${new Date().toISOString()} — modo: ${modo} ===\n`);

  const linhas = [`# Otimização Meta Ads — ${new Date().toISOString()}`, `Modo: ${modo}`, ''];
  for (const r of relatorio) {
    console.log(`Conjunto: ${r.conjunto.name} (${r.conjunto.id}) — gasto hoje: R$${r.spendHoje.toFixed(2)} — resultados hoje: ${r.resultadosHoje}`);
    linhas.push(`## ${r.conjunto.name} (${r.conjunto.id})`, `Gasto hoje: R$${r.spendHoje.toFixed(2)} · Resultados hoje: ${r.resultadosHoje}`, '');
    if (r.acoes.length === 0) {
      console.log('  Nenhuma ação — dentro do esperado.');
      linhas.push('Nenhuma ação — dentro do esperado.', '');
    }
    for (const acao of r.acoes) {
      console.log(`  [${acao.tipo}] ${acao.motivo}`);
      linhas.push(`- **${acao.tipo}**: ${acao.motivo}`);
    }
    linhas.push('');
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.md`);
  fs.appendFileSync(logPath, linhas.join('\n') + '\n---\n');
  console.log(`\nLog salvo em ${logPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Erro:', err.message);
    process.exit(1);
  });
}
