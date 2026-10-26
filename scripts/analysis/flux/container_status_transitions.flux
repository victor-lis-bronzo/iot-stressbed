// =============================================================================
// container_status_transitions.flux
// =============================================================================
//
// O QUE FAZ
// ---------
// Devolve a SÉRIE TEMPORAL ORDENADA do estado do container do broker
// (tag `container_status`) de um broker, dentro da janela __START__/__STOP__.
// O recorte é só pela janela, não pelo run_id (ADR-0013; ver
// broker_metrics_by_run.flux).
//
// ESCOPO: esta query SÓ produz a série ordenada. Toda a lógica de derivação
// de métricas fica no script Python consumidor (`export_run_metrics.py`), que
// percorre as linhas em ordem e aplica a regra da spec:
//   - time_to_degradation_ms -> primeira transição de `running` para um estado
//                               não-saudável;
//   - recovery_time_ms       -> primeira volta sustentada a `running`.
// Nada disso é implementado aqui.
//
// FONTE / SCHEMA
// --------------
// Measurement `broker_metrics` (Telegraf, input `docker` — ver
// `infra/telegraf/telegraf.conf`).
//   tags:
//     broker           -> "plain" | "secure" | "attacker"
//                         (attacker existe no measurement, mas não é alvo
//                          desta query; passe "plain" ou "secure")
//     container_status -> created | restarting | running | removing |
//                         paused | exited | dead
//
// POR QUE FILTRAR UM ÚNICO `_field`
// ---------------------------------
// `container_status` é TAG, não campo: ela vem carimbada em TODA linha de
// QUALQUER campo do measurement. Sem filtrar o campo, cada timestamp de coleta
// produziria N linhas idênticas em `container_status` (uma por campo:
// usage_percent, usage, limit, rx_bytes, tx_bytes, restart_count...), e o
// Python veria "transições" duplicadas.
//
// Escolhemos `_field == "restart_count"` como campo-âncora porque:
//   - o input `docker` do Telegraf o emite em todo ponto de container,
//     independentemente do estado (inclusive quando o container está `exited`
//     ou `restarting` — justamente os instantes que interessam);
//   - não depende de tag adicional para desambiguar (diferente de
//     `usage_percent`, que exige `cpu == "cpu-total"` para não render uma
//     linha por core);
//   - é um contador cumulativo estável, sem risco de sumir por falta de
//     amostragem de CPU/memória num container degradado.
// O valor numérico de restart_count é irrelevante aqui — ele serve apenas para
// garantir exatamente 1 linha por timestamp de coleta.
//
// PLACEHOLDERS
// ------------
//   __BUCKET__  -> nome do bucket InfluxDB (string). Ex.: iot-stressbed
//   __BROKER__  -> "plain" ou "secure" (string)
//   __START__   -> literal de tempo Flux, SEM aspas. Aceita RFC3339
//                  (2024-01-01T00:00:00Z) ou duração relativa (-1h, -30m).
//   __STOP__    -> idem __START__. Use `now()` para "até agora".
//
// Atenção: __BUCKET__/__BROKER__ são strings e aparecem entre aspas duplas no
// corpo; __START__/__STOP__ são literais de tempo/duração e aparecem SEM aspas.
//
// RETORNO ESPERADO
// ----------------
// N linhas (uma por ponto de coleta do Telegraf na janela), ordenadas por
// `_time` crescente, com as colunas:
//     _time            -> timestamp da amostra (RFC3339)
//     container_status -> estado do container naquele instante
//     broker           -> eco do filtro, para conferência
//
// O resultado vem numa única tabela (group(columns: []) achata as séries),
// para que a ordenação por `_time` seja global e o Python possa iterar
// linearmente sem reordenar.
//
// -----------------------------------------------------------------------------
// !! NOTA DE SEGURANÇA — VALIDAR OS PLACEHOLDERS ANTES DE SUBSTITUIR !!
// -----------------------------------------------------------------------------
// Este arquivo NÃO valida nada sozinho: apenas documenta a exigência.
// A substituição é composição de string pura em Flux e é vulnerável a injeção
// se o valor não for validado (um valor com `"` fecha a string e injeta Flux
// arbitrário). Esta query não interpola mais o run_id (ADR-0013); o recorte é a
// janela de tempo.
//
// O Python consumidor DEVE validar, ANTES de qualquer substituição:
//   - `__BROKER__`            contra {"plain", "secure"};
//   - `__START__`/`__STOP__`  contra RFC3339 ou duração relativa
//                             (`-?\d+[smhdw]`).
// =============================================================================


// >>> BLOCK: container_status_series
from(bucket: "__BUCKET__")
    |> range(start: __START__, stop: __STOP__)
    |> filter(fn: (r) => r._measurement == "broker_metrics")
    // Campo-âncora: 1 linha por timestamp de coleta (ver cabeçalho).
    |> filter(fn: (r) => r._field == "restart_count")
    |> filter(fn: (r) => r.broker == "__BROKER__")
    |> keep(columns: ["_time", "container_status", "broker"])
    // group(columns: []) junta tudo numa tabela só; sem isso o Influx quebraria
    // o resultado em uma tabela por valor de container_status, e o sort ficaria
    // local a cada tabela em vez de cronológico global.
    |> group(columns: [])
    |> sort(columns: ["_time"])
// <<< END BLOCK: container_status_series
