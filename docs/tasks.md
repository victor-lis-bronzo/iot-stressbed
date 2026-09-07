# IoT StressBed — Backlog de Tarefas Atômicas

Cortadas verticalmente onde possível (ex: baseline entrega um fatia ponta-a-ponta antes
de ir para Track A). Tamanho é relativo: P (pequena), M (média), G (grande — se ficar
maior que isso na prática, quebrar mais). "Pronto quando" é sempre verificável.

---

## Fase 0.5 — Fundação de infra

### Gerar certificados TLS para o broker secure
- Pronto quando: `scripts/gen-certs.sh` roda sem erro e produz CA + certificado de
  servidor em `infra/mosquitto/secure/certs/`.
- Depende de: nenhuma.
- Tamanho: P.
- Teste: smoke test manual (rodar o script, conferir que os arquivos existem).

### Compose: mosquitto-plain (1883, sem TLS/auth)
- Pronto quando: `docker compose up mosquitto-plain` sobe e aceita CONNECT/PUBLISH
  sem credenciais.
- Depende de: nenhuma.
- Tamanho: P.

### Compose: mosquitto-secure (8883, TLS + auth/ACL)
- Pronto quando: `docker compose up mosquitto-secure` sobe, exige TLS e recusa
  CONNECT sem credencial válida.
- Depende de: Gerar certificados TLS.
- Tamanho: P.

### Compose: postgres, influxdb, grafana
- Pronto quando: os três sobem saudáveis (`docker compose ps` verde) e Grafana
  conecta ao InfluxDB como datasource.
- Depende de: nenhuma.
- Tamanho: P.

### Compose: telegraf (scrape de container stats)
- Pronto quando: telegraf sobe e escreve pontos de teste no InfluxDB (measurement
  `broker_metrics`) sem depender do nestjs-api estar no ar.
- Depende de: Compose postgres/influxdb/grafana.
- Tamanho: M.

### Aplicar limites de recurso (cpuset/cpus/memory/pids-limit)
- Pronto quando: `mosquitto-plain`, `mosquitto-secure` e (mais tarde) `attacker` têm
  os limites do ADR-0004 aplicados no compose, parametrizáveis via `.env`.
- Depende de: mosquitto-plain, mosquitto-secure.
- Tamanho: M.
- Teste: manual — subir carga sintética (`stress-ng` ou script simples) dentro do
  container do broker e confirmar via `docker stats` fora do container que ele não
  ultrapassa os limites configurados.

### Validar isolamento do host com carga sintética
- Pronto quando: uma carga sintética agressiva dentro do broker limitado não
  degrada o host (confirmado por `docker stats` fora dos containers limitados).
- Depende de: Aplicar limites de recurso.
- Tamanho: M.
- Teste: manual, documentado como checklist no protocolo de experimento.

---

## Fase 1 — Baseline (caminho feliz)

### Scaffold do projeto NestJS (`apps/api`)
- Pronto quando: `apps/api` roda com os módulos vazios (`auth`, `sensors`,
  `capture`, `experiments`, `metrics`, `realtime`) registrados no `AppModule`,
  cada um respondendo a um health-check trivial.
- Depende de: nenhuma.
- Tamanho: P.

### Firmware ESP32 `baseline`
- Pronto quando: o dispositivo publica temperatura/umidade a cada 2s no
  `mosquitto-plain`, visível via `mosquitto_sub` manual.
- Depende de: Compose mosquitto-plain.
- Tamanho: M.
- Teste: manual (observar publicações via `mosquitto_sub -t '#'`).

### Módulo `capture`: portas + adapters (Mosquitto, InfluxDB)
- Pronto quando: `MqttSubscriberPort`/`TelemetrySinkPort` estão definidas e os
  adapters concretos (Mosquitto, InfluxDB) implementam as portas, configuráveis
  por variável de ambiente (plain ou secure).
- Depende de: Scaffold NestJS, Compose mosquitto-plain, Compose influxdb.
- Tamanho: G — se o adapter Influx e o adapter Mosquitto tiverem escopo muito
  diferente, considerar quebrar em duas tarefas (uma por adapter).
- Teste: unit tests do módulo com fake de `MqttSubscriberPort` e fake de
  `TelemetrySinkPort` (sem broker/Influx reais) — ver spec `capture-module.md`.

### Módulo `capture`: lógica de assinatura/normalização/gravação
- Pronto quando: dado um broker fake publicando N mensagens, `capture` normaliza
  e grava exatamente essas N mensagens via `TelemetrySinkPort`, taggeadas com
  `sensor_id`/`broker`.
- Depende de: Módulo capture: portas + adapters.
- Tamanho: M.
- Teste: unit (fakes) cobrindo o critério de aceite acima; teste de integração
  com Mosquitto real (plain) confirmando que o adapter concreto também funciona.

### Módulo `experiments`: run singleton
- Pronto quando: existe endpoint para iniciar/parar uma run, com no máximo uma
  linha `ended_at IS NULL` em `experiment_runs` (ADR-0006), e tentar iniciar uma
  segunda run enquanto outra está ativa retorna erro de conflito.
- Depende de: Scaffold NestJS, Compose postgres.
- Tamanho: M.
- Teste: unit test da regra de singleton (rejeição de run concorrente).

### Integrar `capture` com `experiments` (run_id ativo)
- Pronto quando: toda gravação de telemetria feita por `capture` é taggeada com o
  `run_id` da run ativa resolvida via `experiments`, sem precisar ser passado
  manualmente por chamador externo.
- Depende de: Módulo capture (lógica de gravação), Módulo experiments.
- Tamanho: P.

### Módulo `realtime`: WS gateway de telemetria
- Pronto quando: cada mensagem gravada por `capture` é emitida via WebSocket para
  clientes conectados, em menos de 1s de latência ponta-a-ponta.
- Depende de: Módulo capture: lógica de assinatura/normalização/gravação.
- Tamanho: M.

### Módulo `auth`: login JWT
- Pronto quando: existe endpoint de login que retorna JWT válido para um usuário
  existente no Postgres, e um guard reutilizável que rejeita requisições sem token.
- Depende de: Scaffold NestJS, Compose postgres.
- Tamanho: M.
- Teste: unit (emissão/validação de token), integração (login real contra Postgres
  de teste).

### Módulo `sensors`: CRUD de sensores
- Pronto quando: é possível registrar, listar e remover um sensor via API,
  persistido no Postgres.
- Depende de: Módulo auth (rotas protegidas).
- Tamanho: M.

### Scaffold Next.js + guard de auth em todas as rotas
- Pronto quando: `apps/web` roda, todas as páginas exigem sessão válida (ADR-0005,
  sem exceção pública), redirecionando para login quando não autenticado.
- Depende de: Módulo auth.
- Tamanho: M.

### Dashboard ao vivo (plain vs secure lado a lado)
- Pronto quando: a tela consome o WebSocket de `realtime` e exibe telemetria dos
  dois brokers simultaneamente, com p95 de latência < 1s medido no baseline.
- Depende de: Módulo realtime, Scaffold Next.js.
- Tamanho: G — considerar quebrar em "consumo do WS" e "layout lado a lado" se o
  diff crescer demais.
- Teste: manual, medindo o KPI de latência do critério de aceite do baseline.

### Registro de sensor via UI
- Pronto quando: um formulário no dashboard cria um sensor via `sensors` e ele
  aparece disponível para seleção em outras telas.
- Depende de: Módulo sensors, Scaffold Next.js.
- Tamanho: P.

---

## Fase 2 — Track A (interceptação/injeção)

### Confirmar cobertura de captura ≥99% no broker plain
- Pronto quando: um script de teste publica N mensagens conhecidas e a contagem
  capturada por `capture` é ≥99% de N.
- Depende de: Módulo capture (lógica de gravação).
- Tamanho: M.
- Teste: teste de integração automatizado (broker real + capture real).

### View "Interceptação" (payload cru)
- Pronto quando: a tela exibe os payloads capturados exatamente como recebidos
  (texto puro, sem transformação), para o broker plain.
- Depende de: Dashboard ao vivo.
- Tamanho: M.

### Tooling `attacker`: script de injeção (Python/Paho)
- Pronto quando: o script conecta como cliente MQTT comum e publica uma leitura
  forjada no tópico do sensor legítimo, sem exigir alteração no broker/capture.
- Depende de: Compose mosquitto-plain.
- Tamanho: M.

### Propagar tag `source=injected` via metadado de run
- Pronto quando: uma run marcada como "injeção" grava as mensagens forjadas com
  `source=injected` no InfluxDB, vindo do metadado da run, não de detecção.
- Depende de: Módulo experiments, Tooling attacker (injeção).
- Tamanho: P.

### View "Injeção" (forjado vs real)
- Pronto quando: a tela distingue visualmente mensagens com `source=injected` das
  demais, usando o dado de `capture`/`experiments`.
- Depende de: View Interceptação, Propagar tag source=injected.
- Tamanho: M.

### Repetir captura contra o broker secure (controle)
- Pronto quando: um subscriber sem certificado/credencial válida é recusado no
  CONNECT do `mosquitto-secure`.
- Depende de: Compose mosquitto-secure, Módulo capture (adapters).
- Tamanho: M.
- Teste: integração automatizada (tentativa de conexão inválida deve falhar).

### Repetir injeção contra o broker secure (controle)
- Pronto quando: o script de injeção é rejeitado por falha de autenticação ao
  tentar publicar no `mosquitto-secure` sem credencial válida.
- Depende de: Tooling attacker (injeção), Compose mosquitto-secure.
- Tamanho: P.

### Captura de pacotes (pcap) plain vs secure
- Pronto quando: existe um pcap do tráfego plain (payload legível) e um do
  tráfego secure (payload como ciphertext, verificado por entropia), documentados
  no protocolo de experimento.
- Depende de: Confirmar cobertura de captura, Repetir captura contra broker secure.
- Tamanho: M.
- Teste: manual (Wireshark + checagem de entropia).

### Calcular e registrar KPIs do Track A
- Pronto quando: cobertura de interceptação, legibilidade de payload, taxa de
  sucesso de injeção e tempo até primeira captura estão calculados e registrados
  por `run_id`, para as runs plain e secure.
- Depende de: todas as tarefas anteriores da Fase 2.
- Tamanho: M.

---

## Fase 3 — Auditoria silenciosa / instrumentação

### Telegraf + cAdvisor escrevendo `broker_metrics`
- Pronto quando: métricas de CPU/RAM/conexões dos containers de broker aparecem
  no InfluxDB, taggeadas com `run_id` e `broker`.
- Depende de: Compose telegraf.
- Tamanho: M.

### Provisionar dashboards Grafana
- Pronto quando: existe pelo menos um dashboard Grafana lendo `broker_metrics`,
  versionado em `infra/grafana/dashboards/`.
- Depende de: Telegraf + cAdvisor escrevendo broker_metrics.
- Tamanho: M.

### Validar caminho de métrica independente do NestJS
- Pronto quando: com o `nestjs-api` parado, o telegraf continua escrevendo
  `broker_metrics` normalmente no InfluxDB.
- Depende de: Telegraf + cAdvisor escrevendo broker_metrics.
- Tamanho: P.
- Teste: manual — parar o container `nestjs-api` e confirmar que as métricas
  continuam chegando (prova o ADR-0003).

### Tagging de `run_id` nas escritas do telegraf
- Pronto quando: cada execução de experimento propaga o `run_id` ativo (resolvido
  via `experiments`) como tag nas escritas de `broker_metrics`.
- Depende de: Telegraf + cAdvisor escrevendo broker_metrics, Módulo experiments.
- Tamanho: M.

---

## Fase 4 — Track B (DoS)

### Tooling `attacker`: connection-flood
- Pronto quando: o script abre N conexões MQTT simultâneas configuráveis e
  reporta taxa de sucesso/falha de CONNECT.
- Depende de: Compose mosquitto-plain.
- Tamanho: M.
- Teste: unit test de parsing de parâmetros; teste manual contra broker real
  para o volume de conexão alvo.

### Tooling `attacker`: message-flood
- Pronto quando: o script publica mensagens em taxa configurável (msg/s) por uma
  duração configurável.
- Depende de: Compose mosquitto-plain.
- Tamanho: M.

### Tooling `attacker`: payload malformado/gigante
- Pronto quando: o script envia payloads malformados ou anormalmente grandes e
  reporta a resposta do broker (aceite, erro, desconexão).
- Depende de: Compose mosquitto-plain.
- Tamanho: M.

### `scripts/run-experiment.sh` (orquestração de ataque)
- Pronto quando: `run-experiment.sh <track> <mode>` inicia uma run via
  `experiments`, dispara o tipo de ataque correspondente no container `attacker`
  e finaliza a run ao término.
- Depende de: Módulo experiments, os três scripts de ataque acima.
- Tamanho: M.

### Console de ataque no dashboard
- Pronto quando: é possível iniciar/parar uma run de Track B pela UI e acompanhar
  métricas do broker subindo em tempo real (via painel Grafana embutido).
- Depende de: `scripts/run-experiment.sh` (ou endpoint equivalente),
  Provisionar dashboards Grafana.
- Tamanho: G — considerar quebrar em "disparo de run" e "visualização ao vivo".

### Medir KPIs do Track B contra o broker plain
- Pronto quando: CPU/RAM, file descriptors, latência, perda, throughput, tempo
  até degradação/crash e tempo de recuperação estão registrados por `run_id` para
  pelo menos uma execução de cada ataque (B1/B2/B3).
- Depende de: Provisionar dashboards Grafana, run-experiment.sh.
- Tamanho: G.
- Teste: manual/experimental — este é o próprio resultado científico sendo
  coletado, não uma asserção de regressão automatizada.

### Repetir a mesma carga contra o broker secure (delta de overhead TLS)
- Pronto quando: os mesmos ataques com os mesmos parâmetros rodam contra
  `mosquitto-secure` e o delta de latência/CPU plain vs secure está calculado.
- Depende de: Medir KPIs do Track B contra o broker plain.
- Tamanho: M.

### Validar isolamento do host sob ataque real
- Pronto quando: durante os ataques reais de Track B, o host permanece
  responsivo (confirmado por `docker stats` fora dos containers limitados).
- Depende de: Aplicar limites de recurso (Fase 0.5), Medir KPIs do Track B.
- Tamanho: P.
- Teste: manual, checklist do protocolo de experimento.

### Firmware ESP32 `attack` (stretch)
- Pronto quando: o firmware dispara mensagens no clock máximo do dispositivo
  contra o broker plain, e o efeito é observável nas métricas do Track B.
- Depende de: Medir KPIs do Track B contra o broker plain.
- Tamanho: M.

---

## Fase 5 — Análise & artigo

### Consultas InfluxDB agregadas por `run_id`
- Pronto quando: existem queries (Flux) reutilizáveis que extraem os KPIs de
  Track A e Track B agrupados por `run_id`, exportáveis em CSV/tabela.
- Depende de: Calcular KPIs do Track A, Medir KPIs do Track B (plain e secure).
- Tamanho: M.

### Exports Grafana para o artigo
- Pronto quando: existem imagens/PDFs exportados dos dashboards Grafana
  relevantes para cada track, prontos para inclusão no artigo.
- Depende de: Provisionar dashboards Grafana.
- Tamanho: P.

### Tabela comparativa plain vs secure (Track A e B)
- Pronto quando: existe uma tabela única comparando os KPIs de ambos os tracks,
  plain vs secure, lado a lado.
- Depende de: Consultas InfluxDB agregadas por run_id.
- Tamanho: M.

### Redação dos achados
- Pronto quando: o texto do artigo referencia os KPIs e tabelas gerados, com as
  conclusões sobre a vulnerabilidade do MQTT plain e a mitigação do MQTTS.
- Depende de: Tabela comparativa plain vs secure.
- Tamanho: G (fora do escopo de código — trabalho de redação).
