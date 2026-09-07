# IoT StressBed

## Visão geral

Testbed de Iniciação Científica para demonstrar empiricamente vulnerabilidades do MQTT
puro (sem TLS/auth) e usar MQTTS (TLS + auth) como grupo de controle. A plataforma é
simultaneamente (a) a ferramenta que executa e audita os experimentos e (b) a prova viva
de uma das vulnerabilidades — o subscriber malicioso que audita a telemetria em tempo real.

Detalhamento completo de escopo/KPIs/arquitetura em `docs/spec.md` e `docs/architecture.md`.

## Domínio e glossário

- **Sensor**: dispositivo físico (ESP32) que mede temperatura/umidade e publica no broker.
- **Publisher legítimo**: o ESP32 rodando o firmware `sensor` (único firmware do
  projeto), publicando a cada 2s.
- **Publisher malicioso**: script Python em `attacker/`, usado para injeção de leituras
  falsas (Track A) ou flooding (Track B). Não há firmware malicioso no ESP32 — o ataque
  vem sempre de fora do hardware.
- **Subscriber malicioso**: o próprio módulo `capture` do NestJS, que assina `#` no broker
  para demonstrar que qualquer um pode auditar tudo sem autorização — é a vulnerabilidade
  E a ferramenta de observação ao mesmo tempo.
- **Broker plain**: instância Mosquitto na porta 1883, sem TLS nem autenticação. É o alvo.
- **Broker secure**: instância Mosquitto na porta 8883, com TLS + auth/ACL. É o controle
  científico — mesma carga, mesma topologia, só muda a proteção.
- **Run / experiment run**: uma execução controlada e reproduzível de um experimento,
  identificada por um `run_id`. Cada run fixa: track (A ou B), modo (plain ou secure),
  tipo de ataque, parâmetros. Todo dado gravado durante a run é taggeado com esse `run_id`.
- **Telemetria**: o dado de domínio do sensor (temperatura/umidade), capturado pelo módulo
  `capture` e gravado no InfluxDB. É o que o subscriber malicioso está roubando/forjando.
- **Métrica**: a saúde do broker/host (CPU, RAM, conexões, latência) sob ataque, coletada
  por telegraf (input `docker`). Nunca confundir telemetria (dado do sensor) com métrica (saúde
  do sistema) — são measurements diferentes no InfluxDB com propósitos científicos distintos.
- **Track A**: linha de experimento de confidencialidade/integridade — eavesdropping e
  injeção/spoofing.
- **Track B**: linha de experimento de disponibilidade — DoS por flooding de conexões,
  mensagens ou payloads malformados.

## Decisões arquiteturais

- **Caminho de captura independente do caminho de métrica**: a escrita de telemetria
  (NestJS `capture` → InfluxDB) nunca é a fonte das métricas do broker durante o Track B.
  Por quê: se o mesmo caminho medisse os dois, um flooding derrubaria primeiro o
  gargalo de I/O do app, mascarando a resistência real do broker. As métricas de saúde
  vêm de telegraf (input `docker`) raspando o container por fora, sem passar pelo NestJS.
- **InfluxDB + Grafana para série temporal**, Postgres estritamente para estado da
  aplicação (usuários, sensores registrados, metadados de run). Por quê: Mongo/Firebase
  não são feitos para ingestão massiva de séries temporais e criariam gargalo de banco
  antes do broker cair, invalidando o experimento.
- **NestJS modular pragmático**, com seam limpo (ports & adapters) só no módulo `capture`.
  Por quê: `capture` é o núcleo científico — precisa trocar broker plain↔secure como um
  swap de adapter e ser testável sem broker vivo. O resto (auth, sensors) não precisa
  dessa cerimônia.
- **Sem Redis para keepalive**: MQTT já tem PINGREQ/PINGRESP nativo; adicionar Redis
  reinventaria a roda e adicionaria latência desnecessária num sistema que precisa ser
  atacado.

## Restrições e não-objetivos

- Não é uma plataforma IoT de produção.
- Não ataca brokers de terceiros — tudo roda local, em rede Docker isolada.
- Não implementa cripto própria — TLS padrão via Mosquitto.
- NestJS/Next.js não estão sob teste de performance; são camada de observação/UX e são
  ignorados metodologicamente durante o Track B (ver caminho independente acima).
- Brokers e o container atacante rodam com limites rígidos de CPU/RAM/PIDs (cgroups) —
  nenhum dos dois pode ter acesso irrestrito ao host.

## Convenções

- Cada etapa do projeto (documento gerado, módulo implementado) recebe um commit
  semântico pequeno e isolado — nunca acumular múltiplas etapas num commit.
- Toda entrega de código vem acompanhada de um plano de testes (unit e/ou manual,
  conforme a natureza da peça).
- ADRs de decisões arquiteturais vivem em `docs/adr/`.
- Plano mestre de fases e execução: `C:\Users\Usuario\.claude\plans\tranquil-rolling-crown.md`.
