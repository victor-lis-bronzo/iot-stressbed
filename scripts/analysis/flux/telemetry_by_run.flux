// =============================================================================
// telemetry_by_run.flux
// =============================================================================
//
// O QUE FAZ
// ---------
// Espelha, em Flux standalone, as duas queries do adapter TypeScript
// `apps/api/src/metrics/adapters/influxdb-telemetry-query.adapter.ts`:
//
//   Bloco A -> `countCapturedPoints()`  : quantos pontos de telemetria foram
//                                         capturados para um (run_id, broker).
//   Bloco B -> `firstPointTimestamp()`  : timestamp do ponto mais antigo do
//                                         mesmo (run_id, broker).
//
// Assim como no adapter, ambos os blocos usam `range(start: 0)` — a intenção é
// contar/localizar TUDO que existe para aquela run, sem janela de tempo.
//
// SCHEMA USADO
// ------------
//   _measurement : "telemetry"
//   _field       : "raw"
//   tags         : run_id, broker  (broker = "plain" | "secure")
//   tag opcional : source  (ver bloco A, filtro comentado)
//
// PLACEHOLDERS
// ------------
//   __BUCKET__  -> nome do bucket InfluxDB (string). Ex.: iot-stressbed
//   __RUN_ID__  -> UUID da run (string). Ex.: 3f2b1c8a-...-9d4e
//   __BROKER__  -> tag broker (string): "plain" ou "secure"
//
// Todos aparecem entre aspas duplas no corpo da query; substitua apenas o
// miolo do placeholder, mantendo as aspas.
//
// COMO RODAR MANUALMENTE
// ----------------------
// No Influx Data Explorer (Script Editor) o executor roda UM pipeline por vez.
// Por isso os dois blocos estão separados, delimitados por marcadores
// `// >>> BLOCK: <id>` / `// <<< END BLOCK: <id>`: apenas o primeiro está
// ativo, o segundo está comentado. Para rodar o outro à mão, comente o ativo e
// descomente o desejado. O script Python consumidor localiza o bloco pelo
// marcador e remove o `// ` de prefixo antes de enviar a query.
//
// Optou-se por dois blocos independentes em vez de `union()` porque as saídas
// têm formatos diferentes (contagem vs. timestamp) e o consumidor Python
// precisa de cada uma isoladamente.
//
// RETORNO ESPERADO
// ----------------
//   Bloco A: 1 linha (ou 0, se a run não tiver pontos), coluna `_value` com a
//            contagem inteira de pontos. Se houver mais de uma série (mais de
//            uma combinação de tags remanescente), `count()` devolve uma linha
//            por série — o adapter TS soma todas; o Python deve fazer o mesmo.
//   Bloco B: 1 linha (ou 0, se não houver pontos), coluna `_time` com o
//            timestamp do ponto mais antigo (RFC3339). As demais colunas do
//            ponto (`_value`, tags) também vêm juntas; use apenas `_time`.
//
// -----------------------------------------------------------------------------
// !! NOTA DE SEGURANÇA — VALIDAR run_id ANTES DE SUBSTITUIR !!
// -----------------------------------------------------------------------------
// Este arquivo NÃO valida nada sozinho: ele apenas documenta a exigência.
// Flux não tem query parametrizada aqui — a substituição de `__RUN_ID__` é
// composição de string pura e, portanto, vulnerável a injeção se o valor vier
// de fonte não confiável (um run_id contendo `"` fecha a string e injeta Flux
// arbitrário).
//
// O código Python que consumir este arquivo (ex.: `export_run_metrics.py`)
// DEVE validar o run_id com o MESMO regex de UUID case-insensitive usado pelo
// guard `assertSafeRunId()` do adapter TS, ANTES de qualquer substituição:
//
//     UUID_RE = re.compile(
//         r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
//         re.IGNORECASE,
//     )
//     if not UUID_RE.match(run_id):
//         raise ValueError(f"invalid runId for Flux query: {run_id}")
//
// O mesmo vale para `__BROKER__`: deve ser validado contra a lista fechada
// {"plain", "secure"} antes de entrar na string.
// =============================================================================


// >>> BLOCK: count_captured_points
// Bloco A — espelha InfluxdbTelemetryQueryAdapter.countCapturedPoints().
// Retorno: coluna `_value` (inteiro). Somar as linhas se vier mais de uma.
from(bucket: "__BUCKET__")
    // range(start: 0) = desde o início do bucket; a run é delimitada pela tag
    // run_id, não por janela de tempo (igual ao adapter TS).
    |> range(start: 0)
    |> filter(fn: (r) => r._measurement == "telemetry")
    |> filter(fn: (r) => r.run_id == "__RUN_ID__")
    |> filter(fn: (r) => r.broker == "__BROKER__")
    // OPCIONAL — o adapter aceita um filtro extra por `source`. Descomente e
    // troque __SOURCE__ se quiser restringir a uma origem específica:
    // |> filter(fn: (r) => r.source == "__SOURCE__")
    |> filter(fn: (r) => r._field == "raw")
    |> count()
// <<< END BLOCK: count_captured_points


// >>> BLOCK: first_point_timestamp
// Bloco B — espelha InfluxdbTelemetryQueryAdapter.firstPointTimestamp().
// Mesmo conjunto de filtros do Bloco A, sem `count()`.
// Retorno: 1 linha; ler a coluna `_time` (RFC3339).
// from(bucket: "__BUCKET__")
//     |> range(start: 0)
//     |> filter(fn: (r) => r._measurement == "telemetry")
//     |> filter(fn: (r) => r.run_id == "__RUN_ID__")
//     |> filter(fn: (r) => r.broker == "__BROKER__")
//     |> filter(fn: (r) => r._field == "raw")
//     // sort ascendente por tempo + limit(1) => ponto mais antigo da run.
//     |> sort(columns: ["_time"])
//     |> limit(n: 1)
// <<< END BLOCK: first_point_timestamp
