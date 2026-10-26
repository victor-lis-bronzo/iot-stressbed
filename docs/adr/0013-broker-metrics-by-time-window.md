# ADR-0013: métricas do broker atribuídas à run pela janela de tempo, não por `run_id`

## Status
Aceito.

## Contexto
O `broker_metrics` (CPU, memória, rede, estado do container) é escrito pelo
Telegraf, num caminho independente do api ([[ADR-0003]]). Para saber de qual run era
cada ponto, o Telegraf carimbava uma tag global `run_id` lida do ambiente
(`[global_tags] run_id = "${RUN_ID}"`). Como a tag é resolvida **na subida do
container**, `scripts/run-experiment.sh` recriava o Telegraf (`docker compose up -d
telegraf`) a cada início e a cada fim de run.

Isso não serve ao disparo pelo dashboard ([[ADR-0012]]): quem inicia a run é o
`nestjs-api`, que deliberadamente não tem acesso ao Docker, então não pode recriar o
Telegraf. Além disso a recriação tinha custo: o coletor reiniciava logo antes do
ataque, e o script precisava de um `sleep` do tamanho do intervalo de coleta para o
começo do ataque não cair numa janela cega.

Como só existe **uma run ativa por vez** ([[ADR-0006]]), o intervalo
`[started_at, ended_at]` de uma run já identifica sem ambiguidade os pontos que o
Telegraf gravou durante ela.

## Decisão
As métricas do broker são recortadas pela **janela de tempo da run**, e o Telegraf
**nunca mais é recriado** no meio de um experimento:

- `infra/telegraf/telegraf.conf` perde o `[global_tags] run_id`, e o compose perde a
  variável `RUN_ID`. `broker_metrics` fica só com a tag `broker` (e as de container).
- `broker_metrics_by_run.flux` e `container_status_transitions.flux` deixam de
  filtrar por `run_id`: usam só `range(start, stop)` e `broker`. Os placeholders
  `__START__`/`__STOP__` já existiam. `render_flux` passa a aceitar `run_id`
  opcional, e só os blocos de **telemetria** o exigem.
- O dashboard `broker-metrics.json` perde a variável `run_id`; o recorte é o intervalo
  de tempo do próprio Grafana. A tela `/ataques` linka para o dashboard com
  `from`/`to` da run (ataque ± 10 s), e `export_grafana.sh` lê a janela da run em
  `out/run_metrics.csv` (ou de `FROM`/`TO`).
- A **telemetria** (`measurement telemetry`) continua por `run_id`: é carimbada pelo
  `capture` dentro do api, que sabe a run ativa a cada mensagem.
- `run-experiment.sh` vira cliente fino do `POST /experiments/runs/launch` e não toca
  mais no Docker.

## Alternativas descartadas
- **Manter a recriação do Telegraf:** exige Docker no caminho do disparo (que o
  [[ADR-0012]] quer evitar) e perde alguns segundos de coleta no começo do ataque.
- **O api carimba a run no Telegraf em tempo de execução** (ex.: arquivo ou endpoint
  que o Telegraf lê): acopla o coletor ao backend, o oposto do caminho independente
  do [[ADR-0003]]; durante um flood o backend pode estar fora.
- **Tabela de intervalos no InfluxDB** gravada pelo api no start/stop e juntada na
  consulta: mais um dado a manter consistente para ganhar o que o Postgres
  (`experiment_runs`) já guarda.

## Consequências
- **Correção depende da run única ([[ADR-0006]]).** Se um dia houver runs concorrentes,
  o recorte por janela passa a misturar runs e este ADR precisa ser revisto.
- Dados antigos continuam utilizáveis: as runs anteriores foram tagueadas por `run_id`
  **e** têm timestamp, então a mesma janela as encontra. Nada é apagado nem migrado.
- Em runs muito curtas o recorte pode vir vazio: a janela só tem um ponto de métrica
  por intervalo de coleta (5 s por padrão). Uma injeção de ~2 s, por exemplo, pode
  terminar antes do primeiro ponto, e `cpu_usage_percent_avg` sai vazio. Isso é
  esperado: os KPIs de recurso são os da Track B, cujos ataques duram mais.
- `export_grafana.sh` deixa de ser independente do exportador: sem `FROM`/`TO` ele
  precisa de `out/run_metrics.csv` para saber a janela. Uma janela larga misturaria
  runs diferentes no mesmo gráfico, então não há mais default de "últimas 6 h".
- Uma run ainda ativa não tem `ended_at`: o link e o script a tratam como "até agora".
