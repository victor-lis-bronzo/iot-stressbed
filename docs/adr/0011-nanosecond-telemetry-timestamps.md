# ADR-0011: telemetria gravada com timestamp em nanossegundos monotônicos

## Status
Aceito.

## Contexto
Na bateria de testes sobre as imagens publicadas (issue #27), a telemetria
gravada no InfluxDB era uma fração do que o broker entregou:

| Cenário | Enviado | Gravado |
|---|---|---|
| rajada de 1000 mensagens | 1000 | 218, numa janela de 327 ms |
| message-flood a ~467 msg/s | 4671 | ~34% |
| message-flood a ~3,7 mil msg/s | 80213 (broker: `dropped = 0`) | ~28% |

No InfluxDB um ponto é identificado por (measurement, conjunto de tags,
timestamp): escrever de novo na mesma série com o mesmo timestamp **sobrescreve**
o ponto anterior, sem erro. O `capture` carimbava `receivedAt = new Date()`
(milissegundo) e o `WriteApi` usava precisão `'ms'`. As tags de `telemetry`
(`run_id`, `sensor_id`, `broker`, `source`) são constantes durante um flood, então
toda a run é **uma série só** e cabia no máximo um ponto por milissegundo.

Isso invalidava justamente as contagens que a IC compara nos cenários de stress
(`telemetry_captured_count`, cobertura de interceptação), e a série perdida era a
do broker saudável: o defeito estava na coleta, não no alvo.

## Decisão
O adapter `InfluxdbTelemetrySinkAdapter` grava com precisão `'ns'` e um timestamp
**estritamente crescente**, gerado por `createMonotonicNanos()`
(`apps/api/src/capture/adapters/monotonic-nanos.ts`): converte o `Date` para
nanossegundos e, se o relógio não avançou desde o ponto anterior, soma 1 ns.

- O valor é uma `string` (passa de 2^53, `BigInt` internamente).
- `receivedAt` continua sendo `Date` no domínio: socket.io, frontend e a porta
  `TelemetrySinkPort` não mudam ([[ADR-0002]]). A correção fica dentro do adapter.
- Vale também para `capture_meta` (`writeMeta`).
- O contador é por instância de adapter. As duas instâncias do `capture` (plain e
  secure) não colidem entre si porque a tag `broker` as separa em séries distintas.

## Alternativas descartadas
- **Tag `seq` por ponto:** garante unicidade, mas cada valor novo cria uma série
  nova (cardinalidade ilimitada no InfluxDB), degradando consulta e memória.
- **Agregar mensagens do mesmo milissegundo num ponto só:** perde a granularidade
  por mensagem, que é justamente o que o KPI de interceptação conta.
- **Manter `'ms'` e subir o `batchSize`/`flushInterval`:** não ataca a causa; a
  colisão acontece por série e por timestamp, não por lote.
- **Usar o timestamp do broker/atacante:** o relógio do ESP32 não é confiável
  ([[ADR-0003]] e `docs/spec.md`, skew de relógio); latência continua sendo medida
  na recepção.

## Consequências
- **Medido depois da correção** (api construído localmente, sem `.env`):
  rajada de 1000 → **1000** gravados; message-flood a 467 msg/s → **4671 de 4671**;
  a 3074 msg/s → **30740 de 30740**. Nenhuma perda residual nos três regimes, então
  não há segunda causa a investigar.
- **Runs coletadas antes desta correção subcontam telemetria sob carga** (até ~72%
  de perda a ~3,7 mil msg/s). Contagens de `telemetry` dessas runs **não são
  comparáveis** com as novas, e as runs que entrarem na análise da IC devem ser
  refeitas. Nada é apagado: os dados antigos continuam no bucket.
- Pontos novos passam a ter timestamps com resolução de ns; consultas Flux que
  filtram por tempo continuam válidas, e `first()`/`sort(columns:["_time"])`
  ordenam corretamente. O erro de atribuição de tempo é de, no máximo, alguns
  nanossegundos por mensagem em rajada (o contador só adianta o relógio em 1 ns por
  colisão).
