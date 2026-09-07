# IoT StressBed — Spec

## Problema / Objetivo

MQTT puro (porta 1883, sem TLS, sem autenticação) é amplamente usado em IoT apesar de
não oferecer confidencialidade, integridade nem controle de acesso. O objetivo desta IC
é **demonstrar empiricamente**, com um testbed reproduzível, o impacto real dessa escolha
em duas dimensões independentes — confidencialidade/integridade (Track A) e disponibilidade
(Track B) — e quantificar o quanto MQTTS (TLS + auth) mitiga cada uma, usando-o como
grupo de controle sob a mesma carga e topologia.

Para quem: o artigo final da IC, que precisa de dados e gráficos defensáveis (KPIs
reproduzíveis por `run_id`), e a própria plataforma "IoT StressBed" como demonstração viva.

## Não-objetivos

- Não é uma plataforma IoT de produção.
- Não ataca brokers de terceiros — tudo roda local, em rede Docker isolada.
- Não implementa cripto própria — TLS via configuração padrão do Mosquitto.
- NestJS/Next.js não são objeto de teste de performance; são camada de observação/UX,
  ignorados metodologicamente durante o Track B (ver `capture` vs métrica independente
  em CONTEXT.md).
- Não cobre outros protocolos IoT (CoAP, AMQP, etc.) — escopo é MQTT/MQTTS.

## Track A — Confidencialidade & Integridade

### Fluxos
1. **A1 Eavesdropping**: subscriber malicioso (módulo `capture`) conecta ao broker plain
   e assina `#`, capturando toda a telemetria publicada, em texto puro, sem autorização.
2. **A2 Injeção/spoofing**: um publisher não autenticado (script Python em `attacker/`)
   publica leituras forjadas no mesmo tópico do sensor legítimo; o dashboard não tem como
   diferenciar real de forjado no broker plain.
3. **Controle**: os mesmos dois fluxos são repetidos contra o broker secure (MQTTS + auth).

### KPIs
- Cobertura de interceptação: % de mensagens publicadas capturadas pelo subscriber malicioso.
- Legibilidade do payload: texto puro vs ciphertext, verificado por captura de pacotes (pcap).
- Taxa de sucesso de injeção: % de mensagens forjadas aceitas e exibidas no dashboard.
- Tempo até primeira captura (ms) a partir do subscribe malicioso.

### Critérios de aceite
- [ ] No broker plain, o subscriber malicioso captura ≥99% das mensagens publicadas.
- [ ] O relatório de captura (view "Interceptação") exibe os payloads em texto puro.
- [ ] No broker secure, um subscriber sem certificado/credencial válida é recusado no CONNECT.
- [ ] O pcap do tráfego secure não expõe payload legível (checagem de entropia).
- [ ] No broker plain, a injeção envenena o dashboard (mensagem forjada aparece como se
      fosse do sensor legítimo).
- [ ] No broker secure, a injeção é rejeitada por falha de autenticação/autorização.
- [ ] Cada execução do fluxo A é uma run com `run_id` próprio, taggeada no InfluxDB.

## Track B — Disponibilidade (DoS)

### Fluxos
1. **B1 Connection flood**: container `attacker` abre milhares de conexões TCP/MQTT
   zumbis contra o broker (via Paho), simulando ataque de exaustão de conexões.
2. **B2 Message flood**: tempestade de PUBLISH em alta taxa, via container `attacker`
   e/ou firmware ESP32 `attack` reprogramado para disparo no clock máximo.
3. **B3 Payload malformado/gigante**: mensagens malformadas ou anormalmente grandes
   enviadas ao broker para testar robustez de parsing/buffer.
4. Cada fluxo é repetido contra broker plain e broker secure, com os mesmos parâmetros
   de carga, para medir o overhead de TLS.

### KPIs (coletados por telegraf/cAdvisor, caminho independente do NestJS)
- CPU % e RAM (MB) do container do broker sob carga.
- File descriptors abertos / conexões ativas no ponto de falha.
- Latência ponta-a-ponta (ms) publisher legítimo → dashboard, baseline vs sob ataque.
- Taxa de perda de mensagens (%): publicadas pelo sensor legítimo vs recebidas pelo subscriber.
- Throughput sustentado (msg/s) antes da degradação perceptível.
- Tempo até degradação / até crash (s desde o início do ataque).
- Tempo de recuperação (s) até o broker voltar a responder normalmente.
- Delta de overhead do TLS: latência/CPU no plain vs secure sob a mesma carga.

### Critérios de aceite
- [ ] Cada um dos ataques B1/B2/B3 leva o broker (plain) a um ponto de falha mensurável
      (degradação de latência, perda de mensagens, ou crash), registrado no InfluxDB/Grafana.
- [ ] Durante todo o ataque, o SO do host permanece responsivo (prova de que o isolamento
      de recursos por cgroups funciona) — verificável via `docker stats` fora dos containers
      limitados.
- [ ] As métricas de saúde do broker vêm exclusivamente do coletor independente
      (telegraf/cAdvisor), nunca do caminho do NestJS.
- [ ] O mesmo ataque contra o broker secure produz métricas comparáveis (mesma carga),
      permitindo calcular o delta de overhead do TLS.
- [ ] Cada execução é uma run com `run_id` próprio e reproduzível via
      `scripts/run-experiment.sh <track> <mode>`.

## Casos de borda

- Restart do broker no meio de um experimento: a run deve registrar o evento e a
  fronteira temporal, sem misturar dados de antes/depois no mesmo `run_id`.
- Starvation de recursos do host: mitigado pelos limites de cgroups (cpuset, memory,
  pids-limit) em broker e atacante — nenhum dos dois pode saturar o host.
- Desconexão/reconexão do ESP32 legítimo durante um experimento: comportamento de QoS
  e Last Will & Testament deve ser observado e documentado, não silenciosamente ignorado.
- Skew de relógio entre ESP32 e servidor: latência é calculada a partir do timestamp de
  recepção no broker/capture, não do timestamp gerado pelo ESP32.
- Backpressure do InfluxDB durante um flood de Track B: como o caminho de métrica é
  independente do caminho de captura (ver CONTEXT.md), um eventual atraso na escrita de
  telemetria não contamina as métricas de saúde do broker.

## Perguntas em aberto

Nenhuma — escopo e KPIs já fechados com o usuário no plano de arquitetura
(`C:\Users\Usuario\.claude\plans\tranquil-rolling-crown.md`). Detalhes de topologia,
stack e árvore de diretórios seguem em `docs/architecture.md` (próxima etapa).
