// =============================================================================
// broker_metrics_by_run.flux
// =============================================================================
//
// O QUE FAZ
// ---------
// Extrai os agregados de recursos do container do broker (CPU, memória, rede,
// restarts) para um par (run_id, broker), dentro de uma JANELA DE TEMPO
// EXPLÍCITA __START__/__STOP__ — tipicamente o intervalo do ataque.
//
// Diferença importante em relação a `telemetry_by_run.flux`: lá usamos
// `range(start: 0)` (tudo da run); aqui a janela é explícita, porque as
// métricas de recurso só fazem sentido comparadas dentro de uma fase.
//
// FONTE / SCHEMA
// --------------
// Measurement `broker_metrics`, coletado pelo Telegraf (`infra/telegraf/
// telegraf.conf`, input `docker`). Padrão de query copiado dos painéis já
// validados em `infra/grafana/dashboards/broker-metrics.json`, trocando o
// regex de template var (`r.run_id =~ /^${run_id}$/`) por igualdade estrita.
//
//   tags:
//     run_id           -> UUID da run
//     broker           -> "plain" | "secure" | "attacker"
//                         (attacker existe no measurement, mas não é alvo
//                          destas queries; passe "plain" ou "secure")
//     container_status -> created|restarting|running|removing|paused|exited|dead
//     cpu              -> "cpu-total" nas linhas de CPU agregada
//   campos (_field):
//     usage_percent -> CPU em %, filtrar r.cpu == "cpu-total"
//     usage         -> memória usada, bytes
//     limit         -> limite de memória, bytes (constante ao longo da run)
//     rx_bytes      -> bytes recebidos, CONTADOR CUMULATIVO
//     tx_bytes      -> bytes enviados, CONTADOR CUMULATIVO
//     restart_count -> nº de restarts, CONTADOR CUMULATIVO
//
// PLACEHOLDERS
// ------------
//   __BUCKET__  -> nome do bucket InfluxDB (string). Ex.: iot-stressbed
//   __RUN_ID__  -> UUID da run (string)
//   __BROKER__  -> "plain" ou "secure" (string)
//   __START__   -> literal de tempo Flux, SEM aspas. Aceita RFC3339
//                  (2024-01-01T00:00:00Z) ou duração relativa (-1h, -30m).
//   __STOP__    -> idem __START__. Use `now()` para "até agora".
//
// Atenção: __BUCKET__/__RUN_ID__/__BROKER__ são strings e aparecem entre
// aspas duplas no corpo; __START__/__STOP__ são literais de tempo/duração e
// aparecem SEM aspas.
//
// COMO RODAR MANUALMENTE
// ----------------------
// O arquivo tem vários blocos, delimitados por marcadores
// `// >>> BLOCK: <id>` / `// <<< END BLOCK: <id>`. O Influx Data Explorer
// executa um pipeline por vez, então apenas o primeiro bloco está ativo e os
// demais estão comentados. Para rodar outro bloco à mão: comente o ativo e
// descomente o desejado. O script Python consumidor localiza o bloco pelo
// marcador e remove o `// ` de prefixo antes de enviar a query.
//
// BLOCOS E RETORNO ESPERADO (sempre 1 linha por bloco, salvo indicação)
// ---------------------------------------------------------------------
//   cpu_mean          -> colunas: broker, _value  (CPU média em %, 0..100*ncpu)
//   mem_usage_mean    -> colunas: broker, _value  (memória média, bytes)
//   mem_limit_last    -> colunas: broker, _value  (limite de memória, bytes)
//   net_rate_mean     -> 2 linhas (uma por _field: rx_bytes, tx_bytes);
//                        colunas: broker, _field, _value (bytes/s médios)
//   restart_count_last-> colunas: broker, container_status, run_id,
//                        restart_count (contador cumulativo no fim da janela)
//
// -----------------------------------------------------------------------------
// !! NOTA DE SEGURANÇA — VALIDAR run_id ANTES DE SUBSTITUIR !!
// -----------------------------------------------------------------------------
// Este arquivo NÃO valida nada sozinho: apenas documenta a exigência.
// A substituição de `__RUN_ID__` é composição de string pura em Flux e é
// vulnerável a injeção se o valor não for validado (um run_id com `"` fecha a
// string e injeta Flux arbitrário).
//
// O Python consumidor DEVE validar o run_id com o MESMO regex de UUID
// case-insensitive do guard `assertSafeRunId()` em
// `apps/api/src/metrics/adapters/influxdb-telemetry-query.adapter.ts`,
// ANTES de qualquer substituição de placeholder:
//
//     UUID_RE = re.compile(
//         r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
//         re.IGNORECASE,
//     )
//     if not UUID_RE.match(run_id):
//         raise ValueError(f"invalid runId for Flux query: {run_id}")
//
// Igualmente: `__BROKER__` deve ser validado contra {"plain", "secure"}, e
// `__START__`/`__STOP__` contra RFC3339 ou duração relativa (`-?\d+[smhdw]`)
// antes de entrarem na string.
// =============================================================================


// >>> BLOCK: cpu_mean
// CPU média da janela, em %.
// `r.cpu == "cpu-total"` descarta as linhas por-core, deixando só a agregada.
// aggregateWindow(10s, mean) reamostra a série em passos fixos antes do mean()
// final, para que amostras irregulares do Telegraf não enviesem a média.
from(bucket: "__BUCKET__")
    |> range(start: __START__, stop: __STOP__)
    |> filter(fn: (r) => r._measurement == "broker_metrics")
    |> filter(fn: (r) => r._field == "usage_percent" and r.cpu == "cpu-total")
    |> filter(fn: (r) => r.run_id == "__RUN_ID__")
    |> filter(fn: (r) => r.broker == "__BROKER__")
    |> keep(columns: ["_time", "_value", "broker"])
    // group por broker: colapsa as demais tags numa única série por broker.
    |> group(columns: ["broker"])
    |> aggregateWindow(every: 10s, fn: mean, createEmpty: false)
    // mean() sem janela => uma única linha com a média da janela inteira.
    |> mean()
// <<< END BLOCK: cpu_mean


// >>> BLOCK: mem_usage_mean
// Memória média usada na janela, em bytes.
// from(bucket: "__BUCKET__")
//     |> range(start: __START__, stop: __STOP__)
//     |> filter(fn: (r) => r._measurement == "broker_metrics")
//     |> filter(fn: (r) => r._field == "usage")
//     |> filter(fn: (r) => r.run_id == "__RUN_ID__")
//     |> filter(fn: (r) => r.broker == "__BROKER__")
//     |> keep(columns: ["_time", "_value", "broker"])
//     |> group(columns: ["broker"])
//     |> aggregateWindow(every: 10s, fn: mean, createEmpty: false)
//     |> mean()
// <<< END BLOCK: mem_usage_mean


// >>> BLOCK: mem_limit_last
// Limite de memória do container, em bytes.
// Usa last() (e não mean()): `limit` é praticamente constante durante a run,
// então o valor final é o representativo; a média só mascararia uma eventual
// mudança de limite no meio do experimento.
// from(bucket: "__BUCKET__")
//     |> range(start: __START__, stop: __STOP__)
//     |> filter(fn: (r) => r._measurement == "broker_metrics")
//     |> filter(fn: (r) => r._field == "limit")
//     |> filter(fn: (r) => r.run_id == "__RUN_ID__")
//     |> filter(fn: (r) => r.broker == "__BROKER__")
//     |> keep(columns: ["_time", "_value", "broker"])
//     |> group(columns: ["broker"])
//     |> last()
// <<< END BLOCK: mem_limit_last


// >>> BLOCK: net_rate_mean
// Taxa média de rede na janela, em bytes/s, separada por direção.
// rx_bytes/tx_bytes são CONTADORES CUMULATIVOS: derivative() converte para
// taxa por segundo. nonNegative: true descarta os saltos negativos que
// aparecem quando o contador reseta (restart do container).
// group inclui _field para manter rx e tx como séries distintas — sem isso a
// média sairia misturada entre as duas direções.
// Retorno: 2 linhas (rx_bytes e tx_bytes).
// from(bucket: "__BUCKET__")
//     |> range(start: __START__, stop: __STOP__)
//     |> filter(fn: (r) => r._measurement == "broker_metrics")
//     |> filter(fn: (r) => r._field == "rx_bytes" or r._field == "tx_bytes")
//     |> filter(fn: (r) => r.run_id == "__RUN_ID__")
//     |> filter(fn: (r) => r.broker == "__BROKER__")
//     |> keep(columns: ["_time", "_value", "_field", "broker"])
//     |> group(columns: ["broker", "_field"])
//     // derivative ANTES de qualquer agregação: precisa da série bruta e
//     // ordenada para calcular a diferença entre amostras consecutivas.
//     |> derivative(unit: 1s, nonNegative: true, columns: ["_value"])
//     |> mean()
// <<< END BLOCK: net_rate_mean


// >>> BLOCK: restart_count_last
// Nº de restarts do container ao fim da janela (contador cumulativo).
// last() pega o valor final; para "restarts ocorridos NA janela" o Python deve
// subtrair o primeiro valor da janela (ou usar difference()).
// Mantém container_status e run_id no resultado para conferência manual.
// from(bucket: "__BUCKET__")
//     |> range(start: __START__, stop: __STOP__)
//     |> filter(fn: (r) => r._measurement == "broker_metrics")
//     |> filter(fn: (r) => r._field == "restart_count")
//     |> filter(fn: (r) => r.run_id == "__RUN_ID__")
//     |> filter(fn: (r) => r.broker == "__BROKER__")
//     |> last()
//     |> keep(columns: ["broker", "container_status", "run_id", "_value"])
//     |> rename(columns: {_value: "restart_count"})
// <<< END BLOCK: restart_count_last
