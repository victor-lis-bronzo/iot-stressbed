# Análise dos Dados — Fase 5

Ferramentas de linha de comando que consomem, **somente para leitura**, as três
fontes onde Track A e Track B espalham evidência científica — `run_kpis`/
`experiment_runs` no Postgres, `broker_metrics`/`telemetry` no InfluxDB e os
dashboards do Grafana — e produzem os entregáveis determinísticos da Fase 5 em
`out/` (gitignored). Nenhum destes scripts escreve ou altera runtime da
API/web; são rodados manualmente pelo pesquisador após cada rodada de
experimentos, contra um Postgres/InfluxDB já povoados pelas fases anteriores.

Este pacote contém:

- **Entregável 1** — `export_run_metrics.py`: um CSV wide, uma linha por
  `run_id`, com todos os KPIs de Track A e Track B disponíveis para aquela run
  (Postgres + InfluxDB).
- **Entregável 2** — `export_grafana.sh`: PNGs dos painéis do dashboard
  `stressbed-broker-metrics`, um diretório por `run_id`, via API de
  renderização de imagem do Grafana.
- **Entregável 3** — `build_comparison_table.py`: tabela comparativa plain vs
  secure (CSV + Markdown), pareando cenários equivalentes e calculando deltas.
  Consome a saída do Entregável 1 — não refaz a extração.
- `flux/*.flux` — as queries Flux reutilizáveis e versionadas usadas pelo
  Entregável 1 (`broker_metrics_by_run.flux`, `telemetry_by_run.flux`,
  `container_status_transitions.flux`), em vez de strings ad-hoc inline.

A especificação completa desta fase — catálogo de KPIs, regra de derivação de
`time_to_degradation_ms`/`recovery_time_ms`, regra de pareamento plain/secure e
casos de borda — está em `docs/specs/data-analysis.md`. Este README cobre só
como rodar as ferramentas; para entender **por que** um campo é calculado de um
jeito específico, a spec é a fonte da verdade.

## Instalação

As dependências destes scripts vivem em `scripts/requirements.txt` (escopo
separado de `attacker/`, que tem o seu próprio):

```bash
pip install -r scripts/requirements.txt
```

`export_grafana.sh` não tem dependência Python — só precisa de `curl` no
PATH.

## Rodando o `export_run_metrics.py` (Entregável 1)

```bash
# Uma única run
python scripts/analysis/export_run_metrics.py --run-id 3fa85f64-5717-4562-b3fc-2c963f66afa6

# Todas as runs de experiment_runs
python scripts/analysis/export_run_metrics.py --all
```

Flags principais (`python scripts/analysis/export_run_metrics.py --help` para
a lista completa):

- `--run-id <uuid>` ou `--all` — mutuamente exclusivos, um dos dois é
  obrigatório.
- `--recovery-read-margin-seconds` — margem de leitura pós-
  `attack_finished_at` usada na busca pela recuperação do broker (default: 3x
  `TELEGRAF_INTERVAL`, ou 15s se a env var não estiver definida). Parâmetro
  nomeado, não número mágico — ver "Regra de derivação" na spec.
- `--output` — caminho do CSV de saída (default: `out/run_metrics.csv`).

### Env vars

- **Postgres** (lê `experiment_runs` + `run_kpis`): `POSTGRES_HOST` (default
  `localhost`), `POSTGRES_PORT` (default `5432`), `POSTGRES_USER` (default
  `stressbed`), `POSTGRES_PASSWORD`, `POSTGRES_DB` (default `stressbed`).
- **InfluxDB** (lê `broker_metrics` + `telemetry`): `INFLUXDB_URL` (default
  `http://localhost:8086`), `INFLUXDB_TOKEN` (obrigatório — sem ele o script
  falha antes de conectar), `INFLUXDB_ORG` (default `stressbed`),
  `INFLUXDB_BUCKET` (default `stressbed`).
- `TELEGRAF_INTERVAL` — opcional, só usada para calcular o default de
  `--recovery-read-margin-seconds` (mesmo formato de duração do telegraf, ex.
  `5s`).

Todos os nomes acima batem com `.env.example` na raiz do repo.

### Saída

`out/run_metrics.csv` (ou o caminho passado em `--output`). Convenção de
nulos: célula vazia = KPI não aplicável àquela run (ex.: KPI de Track B numa
run de Track A) — nunca `0`. Booleanos saem como `true`/`false` em minúsculas.
`time_to_degradation_ms = null` com `broker_survived = true` é um resultado
científico válido (o broker resistiu ao ataque), não um erro — o script não
emite warning nesse caso.

## Rodando o `build_comparison_table.py` (Entregável 3)

```bash
python scripts/analysis/build_comparison_table.py
```

Flags principais (`python scripts/analysis/build_comparison_table.py --help`
para a lista completa):

- `--input` — CSV wide de entrada (default: `out/run_metrics.csv`, a saída do
  Entregável 1).
- `--output-dir` — diretório de saída para `comparison_table.csv`/`.md`
  (default: `out/`).

### Env vars

Nenhuma — este script só lê o CSV já exportado por `export_run_metrics.py`,
não conecta em Postgres/InfluxDB.

### Saída

`out/comparison_table.csv` e `out/comparison_table.md` (ou dentro do
`--output-dir` passado). Uma linha por **cenário** — chave
`(attack_type, params_normalizado)` — pareando a run `plain` com a run
`secure` mais recente (`started_at`) do mesmo cenário. Cenário sem contraparte
aparece marcado como `plain-only`/`secure-only` em `pairing_status`, nunca é
descartado. Para cada KPI numérico comparável: `<kpi>_plain`, `<kpi>_secure`,
`<kpi>_delta` (`secure - plain`) e `<kpi>_changed`; KPIs categóricos só têm
`_plain`/`_secure`/`_changed` (igualdade, sem `_delta`).

## Rodando o `export_grafana.sh` (Entregável 2)

```bash
./scripts/analysis/export_grafana.sh 3fa85f64-5717-4562-b3fc-2c963f66afa6
```

Exporta os 4 painéis do dashboard `stressbed-broker-metrics`
(`infra/grafana/dashboards/broker-metrics.json`) — CPU, memória, rede e
container-status — como PNGs, via a API de renderização de imagem do Grafana
(`/render/d-solo/...`). Não depende de nenhum outro script desta fase: pode ser
rodado antes, depois ou independentemente do Entregável 1/3, desde que a
stack (Grafana + InfluxDB) esteja de pé e a run já tenha dados no InfluxDB.

### Env vars

- `GRAFANA_URL` — base do Grafana (default:
  `http://localhost:${GRAFANA_PORT:-3001}`, mesmo padrão de
  `NEXT_PUBLIC_GRAFANA_URL` em `apps/web`).
- `GRAFANA_TOKEN` — **obrigatório**: token de service account de leitura do
  Grafana (ver `GRAFANA_TOKEN` em `.env.example`; gere em Grafana >
  Administration > Service accounts, permissão de leitura basta).
- `FROM` / `TO` — janela de tempo do render (default: `now-6h` / `now`; aceita
  epoch ms ou termos relativos do Grafana como `now-30m`). O script é bash
  puro e não consulta `experiment_runs.started_at/ended_at` no Postgres, por
  isso o default é uma janela larga — ajuste manualmente para uma janela mais
  precisa se precisar.
- `OUT_DIR` — diretório base de saída (default: `./out/grafana`).

### Saída

`out/grafana/<run_id>/{cpu,memory,network,container-status}.png` (ou dentro do
`OUT_DIR` passado). O script valida a assinatura binária de cada PNG antes de
promover o arquivo — nenhum PNG corrompido fica para trás em caso de falha.

**Exit code:** `0` quando todos os painéis são exportados; `1` se algum painel
falhar (parcial ou totalmente).

## Ordem recomendada de execução

1. `export_run_metrics.py` — gera `out/run_metrics.csv`.
2. `build_comparison_table.py` — lê esse CSV e gera a tabela comparativa.
   Depende do passo 1 já ter rodado.
3. `export_grafana.sh` — independente dos outros dois; pode rodar em qualquer
   ordem, desde que a run já tenha dados no InfluxDB.

## Exemplo de fluxo completo

Para gerar todos os artefatos de uma run já finalizada
(`3fa85f64-5717-4562-b3fc-2c963f66afa6`):

```bash
# 1) CSV wide com os KPIs de todas as runs (ou --run-id para uma só)
python scripts/analysis/export_run_metrics.py --all

# 2) Tabela comparativa plain vs secure a partir do CSV acima
python scripts/analysis/build_comparison_table.py

# 3) PNGs dos painéis Grafana desta run (independente dos passos acima)
GRAFANA_TOKEN=<token-de-leitura> \
  ./scripts/analysis/export_grafana.sh 3fa85f64-5717-4562-b3fc-2c963f66afa6
```

Ao final, `out/` contém `run_metrics.csv`, `comparison_table.csv`,
`comparison_table.md` e `grafana/3fa85f64-5717-4562-b3fc-2c963f66afa6/*.png` —
os três entregáveis da Fase 5 prontos para uso externo (ex.: inclusão no
artigo, que é redigido fora deste repositório).

## Testes

```bash
cd scripts/analysis
python -m pytest -v
```

Os testes cobrem só a lógica pura (canonicalização de params, derivação de
degradação/recuperação, achatamento de jsonb, pareamento de cenários) — não
exigem Postgres/InfluxDB/Grafana reais.

## Mais detalhes

`docs/specs/data-analysis.md` é a fonte da verdade para o catálogo completo de
KPIs, a regra de derivação de `time_to_degradation_ms`/`recovery_time_ms`, a
regra de pareamento plain/secure e os casos de borda (jsonb parcial, broker
que nunca degradou, múltiplas runs por cenário, etc.) — consulte-o para
entender o "porquê" por trás de qualquer coluna ou comportamento destes
scripts.
