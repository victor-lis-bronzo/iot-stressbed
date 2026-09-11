# IoT StressBed

Testbed de Iniciação Científica para avaliação empírica de vulnerabilidades do
protocolo **MQTT** operando sem segurança (porta 1883, sem TLS/autenticação),
comparado lado a lado com **MQTTS** (mTLS + autenticação) como grupo de
controle científico, sob a mesma topologia e carga.

## Objetivo

A plataforma existe para demonstrar, com dados reproduzíveis, o que acontece
quando um broker MQTT é exposto sem segurança de transporte. Ela é
simultaneamente a ferramenta que executa/audita os experimentos e a prova
viva de uma das vulnerabilidades em estudo (o próprio módulo de captura atua
como um subscriber malicioso, assinando `#` e auditando toda a telemetria em
tempo real).

O estudo é dividido em duas trilhas independentes:

- **Track A — Confidencialidade & Integridade**: eavesdropping (o módulo
  `capture` do backend intercepta toda a telemetria sem autorização) e
  injeção/spoofing (um script Python publica leituras forjadas no tópico do
  sensor legítimo, indistinguíveis no broker plain).
- **Track B — Disponibilidade (DoS)**: connection flood, message flood e
  payload malformado/gigante, disparados por um container `attacker` isolado
  por cgroups, medindo degradação, crash e recuperação do broker.

Cada trilha é executada contra o broker **plain** (alvo) e repetida contra o
broker **secure** (mTLS + auth) como controle, permitindo comparar o
delta de proteção que o TLS/autenticação oferece.

## Arquitetura

```
                         ┌────────────────────┐
   ESP32 (firmware) ───▶ │  mosquitto-plain    │◀──── attacker (Track A/B)
   (publisher legítimo)  │  1883, sem TLS/auth │      (Python + Paho, cgroups)
                         └─────────┬───────────┘
                                   │
                         ┌─────────┴───────────┐
                         │  mosquitto-secure    │
                         │  8883, mTLS + auth   │
                         └─────────┬───────────┘
                                   │ (subscribe "#")
                         ┌─────────▼───────────┐
                         │   nestjs-api          │── auth / sensors / capture
                         │   (capture, realtime, │── experiments / metrics
                         │    experiments, ...)  │── WebSocket (realtime)
                         └───┬───────────┬───────┘
                             │           │
                    ┌────────▼──┐   ┌────▼─────────┐
                    │ postgres   │   │ influxdb      │◀── telegraf (métricas
                    │ (estado)   │   │ (série tempo.) │    de container, canal
                    └────────────┘   └────┬──────────┘    independente do API)
                                          │
                                    ┌─────▼──────┐
                                    │  grafana    │
                                    └─────┬──────┘
                                          │
                                    ┌─────▼──────┐
                                    │ nextjs-web  │── dashboard / console de
                                    │ (frontend)  │   ataque / histórico
                                    └────────────┘
```

Todos os serviços rodam em rede Docker isolada (`stressbed-net`), com
limites de CPU/memória/PIDs via cgroups aplicados aos brokers e ao container
atacante — garantindo que a stack de observação (Postgres/InfluxDB/Grafana/
Telegraf/API/Web) não trave junto com o broker sob ataque.

## Stack tecnológica

| Camada | Tecnologias |
|---|---|
| Backend | NestJS 10 + TypeScript, `mqtt` (cliente MQTT), TypeORM, JWT/bcrypt, Socket.IO |
| Frontend | Next.js 16 + React 19, Auth.js v5, React Query, Tailwind 4 |
| Ataque/carga | Python + `paho-mqtt`, `pytest` (testes unitários e de integração) |
| Broker | Eclipse Mosquitto 2.0.20 (instâncias plain e secure) |
| Observabilidade | InfluxDB 2.7, Grafana 11.6, Telegraf 1.34 |
| Estado de aplicação | PostgreSQL 16 |
| Firmware | ESP32 (publisher legítimo de telemetria) |
| Orquestração | Docker Compose (bootstrap único) |

## Como subir o ambiente

```bash
cp .env.example .env   # opcional — defaults de laboratório já funcionam
docker compose up
```

Um único `docker compose up` sobe toda a topologia, incluindo geração
automática de certificados mTLS. Principais portas expostas:

- `1883` — Mosquitto plain (MQTT, sem TLS)
- `8883` — Mosquitto secure (MQTTS, mTLS)
- `3000` — API (NestJS)
- `3001` — Grafana
- `3002` — Web (dashboard/console de ataque)

O serviço `mock-sensor` (perfil `dev-tools`, opt-in) simula telemetria de
desenvolvimento no lugar do ESP32 físico.

## Estrutura de diretórios

```
iot-stressbed/
├── apps/
│   ├── api/        # Backend NestJS (auth, sensors, capture, experiments, metrics, realtime)
│   └── web/         # Frontend Next.js (dashboard, console de ataque, login)
├── attacker/        # Scripts Python/Paho de injeção (Track A) e DoS (Track B)
├── docs/            # ADRs, specs funcionais, protocolo de experimentos, backlog por fase
├── firmware/
│   └── esp32/sensor/ # Firmware do publisher legítimo
├── infra/           # Configs de Mosquitto, Grafana, InfluxDB, Telegraf
├── scripts/          # gen-certs, run-experiment, capture-pcap, mock-sensor
└── docker-compose.yml
```

## Métricas e observabilidade

- **Grafana**: dashboard `broker-metrics` (CPU%, memória, rede, status/restart
  do container), filtrável por `run_id`. O console de ataque do frontend
  linka diretamente para o painel filtrado na janela de tempo do run.
- **InfluxDB**: measurements `telemetry` (dados de domínio do sensor),
  `broker_metrics` (saúde do broker/host, escrito pelo Telegraf,
  independente do backend) e `capture_meta` (eventos de falha/reconexão).
- **Dashboard ao vivo**: telemetria plain vs secure lado a lado via
  WebSocket, com meta de latência p95 < 1s.

## Status do projeto (fases)

| Fase | Escopo | Status |
|---|---|---|
| 0.5 | Fundação de infra (TLS, brokers, observabilidade, isolamento de recursos) | Concluída |
| 1 | Baseline (backend, firmware, dashboard ao vivo) | Concluída |
| 2 | Track A — interceptação e injeção | Concluída |
| 3 | Auditoria/instrumentação (Telegraf + Grafana) | Concluída |
| 4 | Track B — DoS (flood, console de ataque) | Praticamente concluída |
| 5 | Análise dos dados agregados (sem redação de artigo, feita fora do repo) | Em andamento |

## Desenvolvimento assistido por IA

Este projeto foi construído inteiramente sob **desenvolvimento orientado por
IA** ("AI-native development"): a modelagem, arquitetura e implementação
foram conduzidas em conjunto com o **Claude** (Anthropic) e a **Antigravity
IDE**, com o autor atuando como orquestrador — definindo objetivos,
validando decisões arquiteturais e revisando cada etapa do trabalho.

## Não-objetivos

- Não é uma plataforma IoT de produção.
- Não ataca brokers de terceiros — toda a topologia roda isolada em rede
  Docker local.
- Não implementa criptografia própria (usa TLS/mTLS padrão do Mosquitto).
- Não cobre outros protocolos IoT (CoAP, AMQP, etc).
