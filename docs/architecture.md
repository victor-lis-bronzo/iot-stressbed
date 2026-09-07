# IoT StressBed — Arquitetura

Este documento descreve a arquitetura confirmada. Decisões individuais com justificativa
e alternativas descartadas vivem em `docs/adr/`; este arquivo é a visão consolidada.

## Stack

- **NestJS** (backend): robustez e modularidade nativa (módulos, providers, DI) para
  separar `auth`, `sensors`, `capture`, `experiments`, `metrics`, `realtime` sem
  cerimônia extra — só o módulo `capture` usa ports & adapters completos ([[ADR-0002]]).
- **Next.js + Tailwind** (frontend): dashboard consumindo REST + WebSocket do NestJS.
- **PostgreSQL**: estado da aplicação (usuários, sensores, metadados de run) — nunca
  telemetria ([[ADR-0001]]).
- **InfluxDB + Grafana**: série temporal — telemetria capturada e métricas de saúde do
  broker/host ([[ADR-0001]]).
- **Telegraf + cAdvisor**: coletor independente de métricas de container/host,
  escrevendo direto no InfluxDB, sem passar pelo NestJS ([[ADR-0003]]).
- **Mosquitto** (dois brokers: plain 1883 sem TLS/auth, secure 8883 TLS+auth): alvo e
  grupo de controle.
- **Docker Compose** com limites de cgroups nativos (cpuset, memory, pids-limit) para
  broker e atacante ([[ADR-0004]]).
- **ESP32 (C++/Arduino ou PlatformIO)**: publisher legítimo (firmware `baseline`) e,
  opcionalmente, publisher malicioso de alta taxa (firmware `attack`).
- **Python + Paho**: container `attacker` para os fluxos de flooding/injeção do Track B
  e injeção do Track A.

## Visão geral dos containers

```
                          ┌─────────────┐     ┌──────────────┐
   ESP32 (baseline) ────► │ mosquitto-  │◄────┤   attacker   │
                          │   plain     │     │  (Paho, CPU/ │
   ESP32 (attack, opc) ─► │  (1883)     │     │  RAM limited)│
                          └──────┬──────┘     └──────────────┘
                                 │  subscribe #
                                 ▼
                          ┌─────────────┐            ┌────────────┐
                          │  nestjs-api │──REST/WS──►│ nextjs-web │
                          │  (capture,  │            │ (dashboard)│
                          │  auth,      │            └────────────┘
                          │  sensors,   │
                          │  experiments│
                          │  metrics,   │
                          │  realtime)  │
                          └──┬───────┬──┘
                             │       │
                     writes  │       │ reads/writes state
                             ▼       ▼
                        ┌─────────┐ ┌──────────┐
                        │ influxdb│ │ postgres │
                        │(telemetry│ │ (users,  │
                        │+metrics) │ │ sensors, │
                        └────┬────┘ │  runs)   │
                             │      └──────────┘
                             ▲
                     writes  │ (caminho independente, sem
                             │  passar pelo nestjs-api)
                        ┌────┴────┐
                        │telegraf │◄── scrapes ── mosquitto-plain,
                        │+cAdvisor│               mosquitto-secure,
                        └─────────┘               attacker (container stats)
                             │
                             ▼
                        ┌─────────┐
                        │ grafana │
                        └─────────┘

   mosquitto-secure (8883, TLS+auth) espelha a mesma topologia acima como
   grupo de controle — mesmo nestjs-api, trocando apenas o adapter de conexão.
```

Todos os containers vivem na rede bridge isolada `stressbed-net`. O ESP32 é hardware
externo na LAN, publicando diretamente nos brokers.

## Módulos NestJS

| Módulo | Responsabilidade | Cerimônia |
|---|---|---|
| `auth` | JWT, login — guarda **todas** as rotas do frontend, sem exceção pública. | Simples (guard + service). |
| `sensors` | CRUD de sensores registrados (Postgres). | Simples (controller/service/repository). |
| `capture` | Núcleo científico: assina broker via `MqttSubscriberPort`, normaliza, grava via `TelemetrySinkPort`, emite evento de captura. | Ports & adapters completo ([[ADR-0002]]). |
| `experiments` | Gerencia a run ativa (singleton — [[ADR-0006]]): start/stop, `run_id`, modo, tipo de ataque, params; propaga tags. | Simples. |
| `metrics` | API de leitura que agrega o InfluxDB (telemetria e métricas) para o frontend. | Simples. |
| `realtime` | WS gateway (Socket.IO): transmite eventos de `capture` e status de run ao vivo. | Simples. |

`capture` é o único módulo com seam de ports & adapters completo — ver [[ADR-0002]] para
o porquê de o resto do backend ser modular pragmático em vez de clean/hexagonal.

## Modelo de dados

**PostgreSQL** (estado da aplicação):
- `users(id, email, password_hash, created_at)`
- `sensors(id, name, location, created_at)`
- `experiment_runs(id, mode, attack_type, params, started_at, ended_at, notes)` —
  no máximo uma linha com `ended_at IS NULL` por vez ([[ADR-0006]]).

**InfluxDB** (série temporal):
- measurement `telemetry` — tags: `run_id`, `sensor_id`, `broker` (plain|secure),
  `source` (legit|injected). Escrito exclusivamente pelo módulo `capture`.
- measurement `broker_metrics` — tags: `run_id`, `broker`. Escrito exclusivamente por
  telegraf/cAdvisor, nunca pelo `nestjs-api` ([[ADR-0003]]).
- measurement `capture_meta` — eventos de falha/reconexão do `capture` (ex: broker caiu
  durante um flood), para que a ausência de dados seja distinguível de "sem mensagens".

## Fluxos principais

1. **Baseline**: ESP32 (`baseline`) publica → `mosquitto-plain` → `capture` assina `#`
   → normaliza → grava `telemetry` no InfluxDB + emite via `realtime` → `nextjs-web`
   exibe ao vivo.
2. **Track A (interceptação)**: idêntico ao baseline — a "vulnerabilidade" é o próprio
   fluxo de captura funcionando sem que o broker exija autorização.
3. **Track A (injeção)**: `attacker` (Python) publica no mesmo tópico do sensor
   legítimo → `capture` não distingue a origem → grava/exibe como se fosse legítimo
   (tag `source=injected` vem do metadado da run, não de detecção).
4. **Track B (DoS)**: `experiments` inicia uma run com `attack_type` e `mode` →
   `attacker` dispara connection/message/malformed flood contra o broker escolhido →
   telegraf/cAdvisor captura degradação de CPU/RAM/conexões do broker (caminho
   independente) → `capture`/`realtime` continuam ativos e reportam a degradação de
   latência percebida pelo usuário final como métrica complementar (aceitável que
   degrade junto — não é a fonte da verdade sobre a saúde do broker).
5. **Controle (MQTTS)**: os fluxos 1-4 se repetem contra `mosquitto-secure`; `capture`
   troca apenas a configuração de conexão (TLS + credenciais) do mesmo
   `MqttSubscriberPort`, sem lógica condicional espalhada.

## Isolamento de recursos

Ver [[ADR-0004]] para a decisão completa. Resumo: `mosquitto-plain`, `mosquitto-secure`
e `attacker` rodam com `cpuset`, `--cpus`, `--memory` (sem swap) e `--pids-limit` fixos
no `docker-compose.yml`; núcleos de CPU são reservados fora do cpuset do experimento
para host + stack de observação (Postgres, InfluxDB, Grafana, telegraf, nestjs-api).

## ADRs

- [[ADR-0001]] — InfluxDB+Grafana em vez de MongoDB/Firebase para série temporal.
- [[ADR-0002]] — NestJS modular pragmático, ports & adapters só em `capture`.
- [[ADR-0003]] — Caminho de métrica do broker independente do caminho de captura.
- [[ADR-0004]] — Isolamento de recursos via cgroups nativos do Docker.
- [[ADR-0005]] — Autenticação obrigatória em todas as rotas do dashboard.
- [[ADR-0006]] — Uma run ativa por vez (sem experimentos concorrentes).
