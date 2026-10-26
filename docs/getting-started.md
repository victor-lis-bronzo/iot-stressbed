# IoT StressBed — Guia de início rápido

Este guia leva o testbed do zero até um ambiente funcional verificado: subir a stack,
confirmar que cada peça está de pé, logar no dashboard e rodar a suíte de testes. Não
cobre os experimentos em si (Track A — injeção, Track B — DoS) nem os scripts de
análise da Fase 5 — isso fica em documentos dedicados, linkados na seção
[Próximos passos](#próximos-passos) ao final.

## Pré-requisitos

- **Docker** e **Docker Compose** (plugin `compose`, não o `docker-compose` standalone).
  É a única dependência obrigatória — todo o resto (Node, Python, brokers) roda dentro
  dos containers.
- **Python 3.x**, apenas se for rodar os scripts de `attacker/python` ou
  `scripts/analysis` fora de container.
- **`tcpdump`**, apenas se for capturar `.pcap` durante um experimento — detalhado no
  guia de Track A, não é necessário para subir o ambiente.

## Subir o ambiente

Bootstrap único ([[ADR-0008]]): um único comando sobe toda a topologia.

```bash
docker compose up
```

Isso inclui, sem nenhum passo manual adicional:

- geração automática e idempotente dos certificados mTLS pelo serviço `certs`
  (roda `scripts/gen-certs.sh` dentro de um container antes do `mosquitto-secure`
  subir — se os certificados já existirem em `infra/mosquitto/secure/certs/`, o
  serviço só confirma e sai);
- subida do backend (`nestjs-api`) e do frontend (`nextjs-web`), a partir de imagens
  pré-buildadas baixadas do Docker Hub (ver abaixo);
- subida da infra de observação (Postgres, InfluxDB, Grafana, Telegraf) e dos dois
  brokers Mosquitto (plain e secure).

Não há migrations nem seed de banco para rodar manualmente: o TypeORM cuida do schema,
e o usuário administrador é criado automaticamente no boot do backend
(`AuthService.onModuleInit()` → `seedDefaultAdmin()`), a partir de
`AUTH_ADMIN_EMAIL`/`AUTH_ADMIN_PASSWORD`. Se essas duas variáveis não estiverem
definidas, nenhum usuário é criado.

### Imagens pré-buildadas (fluxo do laboratório)

Conforme o [[ADR-0009]], as imagens de `nestjs-api`, `nextjs-web`, `attacker` e
`mock-sensor` são publicadas em `devvictorlis/stressbed-*` no Docker Hub.
`docker compose up` **baixa** essas imagens se não existirem localmente, sem buildar
nada — é o caminho da máquina do laboratório. Para atualizar:

```bash
docker compose pull && docker compose up -d
```

Para desenvolvimento, buildar localmente a partir do código:

```bash
docker compose up --build
```

Limitação: `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_GRAFANA_URL` são embutidos no bundle do
`nextjs-web` em build time e a imagem publicada usa `localhost`; o dashboard deve ser
aberto na própria máquina do lab (ou rebuildar a imagem web com `--build`).

### `.env` é opcional

`docker-compose.yml` já tem defaults funcionais para desenvolvimento/pesquisa em toda
variável — `docker compose up` sozinho funciona sem `.env`. Copie o arquivo só se
quiser sobrescrever algum valor:

```bash
cp .env.example .env
```

As variáveis estão agrupadas por serviço em `.env.example`, entre outras:

- **Projeto**: `COMPOSE_PROJECT_NAME`.
- **Brokers MQTT**: `MQTT_PLAIN_PORT`, `MQTT_SECURE_PORT`, `MQTT_SECURE_USERNAME`/
  `MQTT_SECURE_PASSWORD`.
- **Postgres**: `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`.
- **InfluxDB**: `INFLUXDB_TOKEN`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`.
- **Grafana**: `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD`, `GRAFANA_TOKEN` (usado
  pelos scripts de análise da Fase 5, não pelo compose).
- **Telegraf**: `TELEGRAF_INTERVAL`, `TELEGRAF_USER` (default `0:0`, funciona em qualquer
  host sem configurar nada — [[ADR-0010]]; use `telegraf:<GID do socket>` para o modo
  menos privilegiado).
- **Isolamento de recursos** ([[ADR-0004]]): `STACK_CPUSET`, `BROKER_PLAIN_CPUSET`/
  `BROKER_SECURE_CPUSET`, `ATTACKER_CPUSET`, e os respectivos `_CPUS`/`_MEMORY`/
  `_PIDS` — mantêm broker, atacante e stack de observação em núcleos disjuntos.
- **Backend/frontend**: `JWT_SECRET`, `AUTH_ADMIN_EMAIL`/`AUTH_ADMIN_PASSWORD`,
  `API_PORT`, `WEB_PORT`, `NEXTAUTH_SECRET`.
- **Capture** (subscriber nos dois brokers): `CAPTURE_TOPIC`, `CAPTURE_ENABLED`,
  `CAPTURE_SECURE_MQTT_CA_PATH`/`CERT_PATH`/`KEY_PATH`.

Os valores default (`stressbed`/`stressbed`, `admin`/`admin`, tokens fixos) são
credenciais de laboratório — não use em deploy exposto fora de um ambiente de
pesquisa isolado.

### Gerar certificados manualmente (opcional)

Só é necessário fora do fluxo normal do `docker compose up` — por exemplo, para
regenerar do zero ou adicionar o IP do ESP32 ao SAN antes de subir a stack:

```bash
./scripts/gen-certs.sh                                   # gera se não existir
./scripts/gen-certs.sh --force                           # regenera do zero
CERT_EXTRA_SAN="IP:192.168.0.42" ./scripts/gen-certs.sh   # SAN extra p/ ESP32 real
```

## Verificar que subiu

Com `docker compose up` rodando (ou em background via `docker compose up -d`), confira
o status dos containers:

```bash
docker compose ps
```

Os healthchecks (`mosquitto-plain`, `mosquitto-secure`, `postgres`, `influxdb`,
`grafana`, `telegraf`, `nestjs-api`, `nextjs-web`) devem reportar `healthy` em até
~20-30s após o start.

Serviços e portas expostas no host (todas parametrizáveis via `.env`, defaults abaixo):

| Serviço | Porta host | Propósito |
|---|---|---|
| `nextjs-web` | 3002 | Dashboard/UI |
| `nestjs-api` | 3000 | Backend API |
| `mosquitto-plain` | 1883 | Broker MQTT sem TLS/auth (alvo) |
| `mosquitto-secure` | 8883 | Broker MQTT com mTLS + auth/ACL (controle) |
| `postgres` | 5432 (bind `127.0.0.1`) | Estado da aplicação |
| `influxdb` | 8086 (bind `127.0.0.1`) | Telemetria e métricas de container |
| `grafana` | 3001 (bind `127.0.0.1`) | Dashboards |

`grafana-image-renderer` e `telegraf` não expõem porta (uso interno). O `attacker`
sobe como runner HTTP interno (porta 8080 só na rede do compose, nunca no host) e só
executa um ataque quando o api manda, ao iniciar uma run — [[ADR-0012]]. O
`mock-sensor` não sobe por padrão; é opt-in:

```bash
docker compose --profile dev-tools up -d mock-sensor
```

Ele simula telemetria de desenvolvimento nos dois brokers — sem ele, não há dado de
sensor real fluindo (ok para testar Track B, necessário para ver algo nas telas de
Track A).

Checagens rápidas:

```bash
curl http://localhost:3000/health   # backend
curl http://localhost:3002          # frontend (deve responder HTML)
```

Acesse o dashboard em `http://localhost:3002` e o Grafana em `http://localhost:3001`.

## Fazer login

**API**, via `POST /auth/login`:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@stressbed.com","password":"@admin123"}'
```

Retorna `{"access_token": "..."}`.

**Dashboard**: acesse `http://localhost:3002/login` com as mesmas credenciais
(`admin@stressbed.com` / `@admin123`, os defaults de `AUTH_ADMIN_EMAIL`/
`AUTH_ADMIN_PASSWORD`).

**Grafana**: `http://localhost:3001`, login `admin`/`admin` (via
`GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD` — troque em produção). O dashboard
"Broker Metrics (Track A/B — telegraf)" já vem provisionado automaticamente. Para ver
uma run, ajuste o intervalo de tempo do dashboard ao dela ([[ADR-0013]]).

## Rodar os testes automatizados

Cada módulo tem sua própria suíte:

```bash
# Backend (apps/api)
npm test                       # unitários
npm run test:integration       # integração

# Frontend (apps/web)
npm test

# Atacante (attacker/python)
python -m pytest -m "not integration" -v   # unitários

# Testes de integração do atacante exigem brokers reais:
docker compose up -d mosquitto-plain mosquitto-secure
python -m pytest -m integration -v

# Scripts de análise (scripts/analysis)
python -m pytest -v
```

## Próximos passos

Com o ambiente de pé e verificado, siga para os guias específicos de cada trilha:

- [`docs/track-a-guide.md`](./track-a-guide.md) — Track A (injeção/spoofing de
  telemetria).
- [`docs/track-b-guide.md`](./track-b-guide.md) — Track B (disponibilidade/DoS).
- [`scripts/analysis/README.md`](../scripts/analysis/README.md) — análise de dados
  coletados (Fase 5).
