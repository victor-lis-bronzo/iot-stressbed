# IoT StressBed

Testbed de Iniciação Científica que compara empiricamente MQTT puro (sem
TLS/auth) contra MQTT com TLS/mTLS (grupo de controle "secure"), sobre a
mesma topologia e carga. **Track A** cobre confidencialidade/integridade
(eavesdropping e injeção/spoofing de mensagens); **Track B** cobre
disponibilidade (DoS por flooding de conexões, de mensagens e por payload
malformado). Cada ataque roda contra o broker `plain` e é repetido, sem
alterações, contra o broker `secure` — o controle científico que evidencia o
efeito real da proteção.

## Quick start

```bash
docker compose up
```

Sobe toda a topologia (brokers, backend, frontend, observabilidade) e gera os
certificados mTLS automaticamente. Passo a passo completo (portas, login,
variáveis de ambiente) em [`docs/getting-started.md`](docs/getting-started.md).

## Stack

- **Mosquitto** — dois brokers: `plain` (1883, sem TLS/auth) e `secure`
  (8883, TLS + mTLS + senha).
- **NestJS** — backend modular (`auth`, `sensors`, `capture`, `experiments`,
  `metrics`, `realtime`).
- **Next.js + Tailwind** — dashboard de observação dos experimentos.
- **InfluxDB + Grafana** — série temporal (telemetria e métricas de saúde do
  broker/host).
- **PostgreSQL** — estado da aplicação (usuários, sensores, metadados de run).
- **Telegraf** — coleta métricas de container/host por fora do NestJS,
  caminho independente do de captura.
- **Python + Paho** (`attacker/`) — tooling de flooding (Track B) e
  injeção (Track A).
- **ESP32 (C++/Arduino ou PlatformIO)** — publisher legítimo (`firmware/`).

## Estrutura do repositório

- `apps/` — backend NestJS (`api`) e frontend Next.js (`web`).
- `attacker/` — scripts Python de ataque (Track A e Track B).
- `firmware/` — firmware do ESP32 (publisher legítimo).
- `infra/` — configuração de Grafana, InfluxDB, Mosquitto e Telegraf.
- `scripts/` — automação de experimento (bootstrap, certificados, captura de
  pcap) e análise de dados (`scripts/analysis/`).
- `docs/` — especificação, arquitetura, protocolo de experimento, ADRs e
  guias.

## Guias

- [`docs/getting-started.md`](docs/getting-started.md) — subir o ambiente,
  portas e primeiro acesso.
- [`docs/track-a-guide.md`](docs/track-a-guide.md) — como rodar os
  experimentos de confidencialidade/integridade.
- [`docs/track-b-guide.md`](docs/track-b-guide.md) — como rodar os
  experimentos de disponibilidade/DoS.
- [`scripts/analysis/README.md`](scripts/analysis/README.md) — ferramentas
  de análise (Fase 5): exportação de KPIs, tabela comparativa plain vs
  secure e PNGs do Grafana.

## Documentação de referência

- [`docs/spec.md`](docs/spec.md) — especificação de escopo e KPIs.
- [`docs/architecture.md`](docs/architecture.md) — arquitetura consolidada.
- [`docs/experiment-protocol.md`](docs/experiment-protocol.md) — protocolo
  de execução dos experimentos.
- [`docs/tasks.md`](docs/tasks.md) — backlog de tarefas do projeto.
- [`docs/adr/`](docs/adr/) — decisões arquiteturais individuais, entre elas
  o uso de InfluxDB+Grafana para série temporal ([ADR-0001](docs/adr/0001-influxdb-grafana-for-time-series.md))
  e o caminho de métricas independente do caminho de captura ([ADR-0003](docs/adr/0003-independent-metrics-path.md)).

## Estado do projeto

O backlog e o status das fases estão em [`docs/tasks.md`](docs/tasks.md).
