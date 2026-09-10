# Análise dos Dados (Fase 5)

## Problem Statement

Os Tracks A e B produzem evidência científica espalhada em três lugares — `run_kpis` e
`experiment_runs` no Postgres, `telemetry`/`capture_meta` e `broker_metrics` no InfluxDB,
mais os PNGs vivos dos dashboards Grafana — e nenhum deles, isoladamente, responde à
pergunta que a IC precisa responder: "qual foi o delta plain vs secure, por cenário, em
cada KPI?". Sem uma ferramenta que uma essas três fontes por `run_id`, cada comparação
plain/secure exigiria uma consulta manual ad-hoc, sujeita a erro humano e impossível de
reproduzir de forma idêntica na segunda vez que os dados forem revisados.

## Solution

Um conjunto de scripts de análise (`scripts/analysis/`) que consomem as três fontes
somente para leitura — nunca escrevem nem alteram runtime da API/web — e produzem três
entregáveis determinísticos em `out/` (gitignored): (1) um CSV wide com uma linha por
`run_id` reunindo todos os KPIs de Track A e Track B; (2) PNGs exportados dos painéis
Grafana relevantes, nomeados por `run_id`; (3) uma tabela comparativa plain vs secure
(CSV + Markdown) pareando cenários equivalentes e calculando deltas. Este documento é a
fonte da verdade para a implementação desses scripts — não é objetivo desta fase escrever
o artigo da IC (isso é feito fora deste repositório) nem adicionar qualquer feature de
runtime na API ou no dashboard.

## User Stories

1. Como pesquisador, quero um script que exporte, para cada `run_id`, uma linha CSV com
   todos os KPIs de Track A e Track B disponíveis para aquela run, para ter uma visão
   tabular única sem precisar cruzar Postgres e InfluxDB manualmente.
2. Como pesquisador, quero que o CSV wide traga `null` explícito (não `0` nem célula
   vazia ambígua) quando uma run não tem aquele KPI aplicável (ex: uma run de Track A não
   tem `time_to_degradation_ms`), para não confundir "não se aplica" com "zero medido".
3. Como pesquisador, quero que `time_to_degradation_ms` e `recovery_time_ms` sejam
   derivados automaticamente das transições de `container_status` em `broker_metrics`,
   para não depender de inspeção visual do Grafana a cada run.
4. Como pesquisador, quero que uma run de Track B em que o broker nunca degradou grave
   `time_to_degradation_ms = null` com uma flag explícita de "sobreviveu", para que esse
   resultado (positivo para a resiliência do broker) não seja lido como dado ausente/erro.
5. Como pesquisador, quero um script que exporte os painéis relevantes do Grafana como
   PNG por `run_id`, para ter evidência visual pronta para uso externo sem precisar abrir
   o Grafana manualmente a cada vez.
6. Como pesquisador, quero uma tabela comparativa que pareie automaticamente a run plain
   e a run secure do mesmo cenário de ataque (mesmo `attack_type` e mesmos parâmetros),
   para ver o delta de overhead do TLS lado a lado sem montar a comparação à mão.
7. Como pesquisador, quero que a tabela comparativa calcule `_delta` e marque `_changed`
   para cada KPI numérico comparável, para identificar rapidamente quais métricas
   realmente mudaram entre plain e secure.
8. Como pesquisador, quero que um cenário sem contraparte (só rodou em plain, ou só em
   secure) apareça na tabela marcado como `plain-only`/`secure-only` em vez de ser
   descartado silenciosamente, para não perder dado por falta de par.
9. Como pesquisador, quero que, havendo múltiplas execuções do mesmo cenário no mesmo
   modo, o script use a run mais recente (`started_at`) de forma determinística, para que
   duas execuções do script no mesmo dataset produzam sempre a mesma tabela.
10. Como pesquisador, quero queries Flux reutilizáveis e versionadas (`scripts/analysis/
    flux/`) em vez de queries digitadas ad-hoc no Grafana, para que a extração de KPIs de
    Track B seja auditável e repetível.
11. Como pesquisador, quero que todos os artefatos gerados fiquem em `out/` na raiz do
    repositório e nunca sejam versionados, para não poluir o histórico do Git com dados
    de execução que mudam a cada rodada de experimento.
12. Como desenvolvedor, quero que os scripts sejam scripts de linha de comando simples
    (Python para os dois exports/tabela, shell para o Grafana), sem acoplamento a
    nenhuma dependência de runtime da API/web, para poder rodá-los meses depois de o
    experimento ter terminado, contra um dump do mesmo Postgres/InfluxDB.

## Implementation Decisions

- Três entregáveis, três scripts, sem sobreposição de responsabilidade:
  - **Entregável 1** — `scripts/analysis/export_run_metrics.py`: um CSV wide, uma linha
    por `run_id`, todas as colunas do catálogo de KPIs abaixo.
  - **Entregável 2** — `scripts/analysis/export_grafana.sh`: PNGs dos painéis do
    dashboard `stressbed-broker-metrics` (`infra/grafana/dashboards/broker-metrics.json`),
    um diretório por `run_id`, via API de renderização de imagem do Grafana
    (`/render/d-solo/...`).
  - **Entregável 3** — `scripts/analysis/build_comparison_table.py`: CSV + Markdown da
    tabela comparativa plain vs secure, consumindo a saída do Entregável 1 (não refaz a
    extração — lê o CSV wide já produzido).
- Fontes de leitura, nunca de escrita: Postgres (`run_kpis`, `experiment_runs`) via
  string de conexão de leitura; InfluxDB via Flux (`influxdb-client` Python, mesmo padrão
  de bucket/org/token do adapter `InfluxdbTelemetryQueryAdapter`); Grafana via HTTP
  (API key de leitura). Nenhum script grava em nenhuma dessas fontes.
- `run_id` é sempre um UUID (`experiment_runs.id`); toda interpolação de `run_id` em
  Flux segue o mesmo padrão de validação de `assertSafeRunId` já usado no adapter de
  telemetria (regex de UUID antes de compor a query) — os scripts de análise não
  reintroduzem o risco de injeção Flux que esse guard já existe para evitar.
- `scripts/analysis/flux/` guarda as queries Flux como arquivos `.flux` parametrizados
  (placeholders de `run_id`/`bucket`/janela de tempo), não strings inline no Python —
  mesmo espírito de "consulta auditável e versionada" do restante do projeto.
- Saída sempre em `out/` na raiz do repo:
  - `out/run_metrics.csv` (Entregável 1).
  - `out/grafana/<run_id>/<slug-do-painel>.png` (Entregável 2).
  - `out/comparison_table.csv` e `out/comparison_table.md` (Entregável 3).
  - `out/` deve estar no `.gitignore`; se ainda não estiver, adicionar como parte da
    implementação desta fase.

## Catálogo de KPIs (Entregável 1 — `export_run_metrics.py`)

Uma linha por `run_id`. Colunas e origem exata:

| Coluna CSV | Origem | Observação |
|---|---|---|
| `run_id` | `experiment_runs.id` | chave primária da linha |
| `mode` | `experiment_runs.mode` | `plain` \| `secure` |
| `attack_type` | `experiment_runs.attack_type` | ex.: `connection-flood`, `message-flood`, `malformed-payload`, ou o tipo de fluxo de Track A registrado na run |
| `params` | `experiment_runs.params` (jsonb) | serializado como JSON compacto em uma célula; ver "normalização de params" na regra de pareamento |
| `started_at` | `experiment_runs.started_at` | ISO 8601 |
| `ended_at` | `experiment_runs.ended_at` | ISO 8601, `null` se a run nunca foi finalizada |
| `notes` | `experiment_runs.notes` | texto livre, pode ser `null` |
| `interception_coverage_pct` | `run_kpis.interception_coverage_pct` | Track A |
| `entropy_bits` | `run_kpis.entropy_bits` | Track A |
| `payload_readability_classification` | `run_kpis.payload_readability_classification` | Track A — `legivel`\|`ciphertext`\|`inconclusivo` |
| `injection_success_rate_pct` | `run_kpis.injection_success_rate_pct` | Track A |
| `injection_connect_status` | `run_kpis.injection_connect_status` | Track A — `connected`\|`rejected` |
| `time_to_first_capture_ms` | `run_kpis.time_to_first_capture_ms` | Track A |
| `track_b_attack_type` | `run_kpis.track_b_attack_type` | Track B — `connection-flood`\|`message-flood`\|`malformed-payload` |
| `track_b_attack_started_at` | `run_kpis.attack_started_at` | Track B |
| `track_b_attack_finished_at` | `run_kpis.attack_finished_at` | Track B |
| `connections_attempted` | `run_kpis.track_b_result` (jsonb) → `connections_attempted` | só presente quando `track_b_attack_type = connection-flood` (campo de `ConnectionFloodResultDto`) |
| `connections_established` | `run_kpis.track_b_result` → `connections_established` | idem |
| `connections_rejected` | `run_kpis.track_b_result` → `connections_rejected` | idem |
| `connection_success_rate` | `run_kpis.track_b_result` → `success_rate` | idem, pode ser `null` |
| `message_flood_attempted` | `run_kpis.track_b_result` → `attempted` | só presente quando `track_b_attack_type = message-flood` (campo de `MessageFloodResultDto`) |
| `message_flood_accepted` | `run_kpis.track_b_result` → `accepted` | idem |
| `message_flood_success_rate` | `run_kpis.track_b_result` → `success_rate` | idem |
| `message_flood_achieved_rate` | `run_kpis.track_b_result` → `achieved_rate` | idem, msg/s efetivo |
| `message_flood_elapsed_seconds` | `run_kpis.track_b_result` → `elapsed_seconds` | idem |
| `malformed_mode` | `run_kpis.track_b_result` → `mode` | só presente quando `track_b_attack_type = malformed-payload` (`giant`\|`invalid-utf8`\|`invalid-json`\|`null-bytes`, campo de `MalformedPayloadResultDto`) |
| `malformed_attempted` | `run_kpis.track_b_result` → `attempted` | idem |
| `malformed_publish_accepted` | `run_kpis.track_b_result` → `publish_accepted` | idem |
| `malformed_disconnected_after_publish` | `run_kpis.track_b_result` → `disconnected_after_publish` | idem, booleano |
| `malformed_broker_response_summary` | `run_kpis.track_b_result` → `broker_response_summary` | idem, texto livre |
| `cpu_usage_percent_avg` | InfluxDB `broker_metrics`, campo `usage_percent` (tag `cpu = cpu-total`) | média no intervalo `[attack_started_at, attack_finished_at]` (ou `[started_at, ended_at]` fora de Track B), filtrado por `run_id` e `broker = mode` |
| `mem_usage_bytes_avg` | InfluxDB `broker_metrics`, campo `usage` | média no mesmo intervalo |
| `mem_limit_bytes` | InfluxDB `broker_metrics`, campo `limit` | último valor no intervalo (constante durante a run) |
| `net_rx_bytes_per_s_avg` | InfluxDB `broker_metrics`, campo `rx_bytes` | `derivative()` (bytes/s) média no intervalo — ver nota sobre Docker Desktop em "Casos de Borda" |
| `net_tx_bytes_per_s_avg` | InfluxDB `broker_metrics`, campo `tx_bytes` | idem |
| `restart_count` | InfluxDB `broker_metrics`, campo `restart_count` | último valor no intervalo |
| `time_to_degradation_ms` | derivado — ver regra de derivação abaixo | `null` quando o broker nunca degradou |
| `broker_survived` | derivado — booleano, `true` quando `time_to_degradation_ms` é `null` porque não houve degradação | distingue "sobreviveu" de "sem dados" (ver Casos de Borda) |
| `recovery_time_ms` | derivado — ver regra de derivação abaixo | `null` quando não houve degradação ou quando o broker nunca voltou a `running` dentro da janela observada |
| `telemetry_captured_count` | InfluxDB `telemetry`, medido via mesma lógica de `countCapturedPoints` (measurement `telemetry`, campo `raw`, filtro `run_id`+`broker`) | KPI complementar de latência/perda do lado da aplicação, citado no Track B como "não é fonte de verdade da saúde do broker" |
| `first_capture_at` | InfluxDB `telemetry`, mesma lógica de `firstPointTimestamp` | usado para conferência cruzada com `time_to_first_capture_ms` |

## Regra de derivação: `time_to_degradation_ms` e `recovery_time_ms`

Não existe campo direto para esses dois KPIs — `broker_metrics` só registra
`container_status` (tag, via `processors.enum` do telegraf) e `restart_count` (campo) por
ponto de tempo. A derivação é puramente sobre a série de transições de `container_status`
dentro da janela `[attack_started_at, attack_finished_at]` da run (campos de `run_kpis`),
filtrada por `run_id` e `broker = mode`:

1. Ordenar os pontos de `broker_metrics` da run por `_time` crescente.
2. **Degradação**: a primeira transição de `container_status` que sai de `running` para
   qualquer estado não-saudável (`restarting`, `paused`, `exited`, `dead`) marca o instante
   de degradação. `time_to_degradation_ms = (t_degradacao - attack_started_at)` em
   milissegundos.
   - Se a série inteira permanece em `running` do início ao fim da janela do ataque:
     `time_to_degradation_ms = null` e `broker_survived = true`. Este é um resultado
     científico válido (o broker resistiu ao ataque com os parâmetros usados), **não** um
     erro de coleta nem dado ausente — os scripts não devem emitir warning nem tratar essa
     linha como incompleta.
3. **Recuperação**: só calculado quando houve degradação. A partir do instante de
   degradação, buscar a primeira transição de volta para `container_status = running` que
   se sustente (não seguida imediatamente por nova queda dentro da mesma janela de
   observação, que se estende até `attack_finished_at` mais uma margem de leitura pós-ataque
   — ver Casos de Borda sobre essa margem).
   `recovery_time_ms = (t_recuperacao - t_degradacao)` em milissegundos.
   - Se o broker degradou e nunca volta a `running` dentro da janela observada:
     `recovery_time_ms = null` com uma segunda flag (`recovered = false`) — distinta de
     `broker_survived`, que só se aplica a quem nunca degradou.

## Schema de saída — Entregável 3 (`build_comparison_table.py`)

Uma linha por **cenário** (não por run). CSV wide + a mesma tabela renderizada em
Markdown. Colunas:

- `attack_type` (Track B) ou `flow_type` (Track A, ex.: `interception`/`injection`) —
  chave de cenário.
- `params_normalized` — representação normalizada e determinística de
  `experiment_runs.params` (ver regra de pareamento).
- `pairing_status` — `paired` \| `plain-only` \| `secure-only`.
- `run_id_plain`, `run_id_secure` — `null` quando o lado correspondente não existe
  (`pairing_status` diferente de `paired`).
- Para cada KPI numérico comparável do catálogo acima (ex.: `cpu_usage_percent_avg`,
  `mem_usage_bytes_avg`, `time_to_degradation_ms`, `recovery_time_ms`,
  `injection_success_rate_pct`, `interception_coverage_pct`, etc.): três colunas —
  `<kpi>_plain`, `<kpi>_secure`, `<kpi>_delta` (`secure - plain`), mais uma coluna
  `<kpi>_changed` (booleano — `true` quando `_delta` é não-nulo e diferente de zero após
  arredondamento a uma casa decimal, para não sinalizar ruído de ponto flutuante como
  mudança).
- KPIs não-numéricos (ex.: `payload_readability_classification`) recebem apenas
  `<kpi>_plain`/`<kpi>_secure`/`<kpi>_changed` (comparação de igualdade), sem `_delta`.
- Quando `pairing_status != paired`, todas as colunas do lado ausente ficam `null` e
  `<kpi>_delta`/`<kpi>_changed` também ficam `null` (não computáveis sem par).

## Regra de pareamento plain vs secure

- Chave de cenário = `(attack_type, params_normalizado)`. `params_normalizado` é o JSON de
  `experiment_runs.params` com chaves ordenadas alfabeticamente e valores serializados de
  forma estável (mesma técnica de canonicalização em ambos os scripts — não reimplementar
  duas vezes), de modo que duas runs com os mesmos parâmetros lógicos produzam a mesma
  string de chave independentemente da ordem em que os campos foram inseridos no jsonb.
- Ao existir múltiplas runs do mesmo `(cenário, modo)`, usar a **mais recente por
  `started_at`** — decisão já tomada, não reabrir na implementação. As demais runs do
  mesmo par continuam disponíveis no CSV wide do Entregável 1 (que é por `run_id`, não
  agregado), só não entram na tabela comparativa.
- Um cenário com run em `plain` mas sem par em `secure` (ou vice-versa) aparece na tabela
  com `pairing_status = plain-only` (ou `secure-only`) — nunca é descartado
  silenciosamente.

## Casos de Borda

- **KPI nulo por track não aplicável**: uma run de Track A não tem
  `track_b_attack_type`/`track_b_result`/KPIs derivados de `broker_metrics` durante
  ataque — ficam `null` no CSV wide, não `0` nem célula vazia. Mesma regra na direção
  oposta para runs de Track B em relação aos KPIs de Track A.
- **Broker nunca degradou**: ver seção de derivação — `time_to_degradation_ms = null` +
  `broker_survived = true` é resultado válido, não erro. Scripts não devem logar isso como
  warning nem excluir a run de nenhum export.
- **Múltiplas runs por cenário**: resolvidas pela regra de pareamento (mais recente por
  `started_at`); o CSV wide (Entregável 1) continua listando todas as runs individualmente.
- **jsonb do atacante parcial ou ausente**: `run_kpis.track_b_result` pode ser `null`
  (KPIs de Track B ainda não calculados para aquela run) ou conter só um subconjunto dos
  campos esperados pelo DTO correspondente (ex.: script antigo que não emitia
  `success_rate`). O script de export deve tratar campo ausente dentro do jsonb como
  `null` na coluna correspondente, sem lançar exceção — nunca assumir que o jsonb bate
  100% com o DTO atual.
- **Nomes de campo do Influx a confirmar contra uma run real**: os nomes de measurement/
  campo/tag documentados aqui (`broker_metrics`, `usage_percent`, `usage`, `limit`,
  `rx_bytes`, `tx_bytes`, `restart_count`, `container_status`, tag `cpu = cpu-total`) vêm
  de `infra/telegraf/telegraf.conf` e das queries já validadas em
  `infra/grafana/dashboards/broker-metrics.json` — mas rede/blkio por container podem vir
  vazios em Docker Desktop (Windows/Mac), populando de fato só em host Linux nativo
  (ambiente real dos experimentos, conforme nota já registrada no próprio dashboard).
  Antes de rodar os scripts em produção contra dados reais de Track B, confirmar contra
  pelo menos uma run real que os campos realmente aparecem com esses nomes exatos — não
  assumir que o schema documentado aqui é infalível só porque bate com o `.conf`/dashboard
  atuais.
- **Janela de recuperação sem limite superior claro**: a busca por recuperação (ver seção
  de derivação) precisa de uma margem de leitura pós-`attack_finished_at` para não cortar
  uma recuperação que acontece logo após o fim formal do ataque; o valor exato dessa
  margem (ex.: alguns múltiplos do intervalo de coleta do telegraf, `TELEGRAF_INTERVAL`)
  fica a critério da implementação, mas deve ser um parâmetro nomeado do script, não um
  número mágico inline.

## Critérios de Aceite

Os três "pronto quando" literais de Fase 5 em `docs/tasks.md`:

1. **Consultas InfluxDB agregadas por `run_id`** — pronto quando existem queries (Flux)
   reutilizáveis que extraem os KPIs de Track A e Track B agrupados por `run_id`,
   exportáveis em CSV/tabela.
2. **Exports Grafana** — pronto quando existem imagens/PDFs exportados dos dashboards
   Grafana relevantes para cada track, prontos para uso externo (ex.: inclusão no
   artigo, que é redigido fora deste repositório).
3. **Tabela comparativa plain vs secure (Track A e B)** — pronto quando existe uma
   tabela única comparando os KPIs de ambos os tracks, plain vs secure, lado a lado.

## Out of Scope

- Redação do artigo da IC — é feita fora deste repositório; os entregáveis desta fase são
  insumo (dados/tabelas/imagens), não o texto final.
- Qualquer feature de runtime na API (`apps/api`) ou no dashboard (`apps/web`) — os
  scripts de análise são ferramentas de linha de comando/offline, não endpoints nem telas
  novas.
- Estatística inferencial (testes de significância, intervalos de confiança) — a tabela
  comparativa reporta deltas observados, não conclusões estatísticas formais; se
  necessário, isso é trabalho de quem escreve o artigo, com os dados exportados aqui como
  entrada.
- Automação de agendamento/CI dos scripts — são rodados manualmente pelo pesquisador
  após cada rodada de experimentos, não como pipeline agendado.
- Mitigação ou ajuste de parâmetros do experimento com base na análise — esta fase só lê
  e resume dados já coletados; recomendações de novos experimentos ficam fora do escopo
  dos scripts em si (podem virar `notes` manuais, mas não é o script quem decide).

## Further Notes

Esta fase depende de a Fase 2 (KPIs de Track A) e a Fase 4 (KPIs de Track B, plain e
secure) já terem produzido runs reais no Postgres/InfluxDB — os scripts aqui descritos
não geram dado novo, apenas leem e reorganizam o que os tracks anteriores já gravaram. A
regra de derivação de `time_to_degradation_ms`/`recovery_time_ms` é a peça mais delicada
desta spec porque não existe hoje nenhum campo direto para esses dois KPIs em
`broker_metrics` — qualquer implementação deve validar a lógica de transição de
`container_status` contra pelo menos uma run real de connection-flood ou message-flood
antes de considerar os scripts prontos para uso em produção, exatamente como o item
correspondente já registrado em Casos de Borda.
