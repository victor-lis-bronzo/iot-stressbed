# Guia — Track B (Disponibilidade / DoS)

Tutorial passo a passo para disparar e observar os 3 ataques de Track B:
connection flood, message flood e malformed/giant payload. Track B mede
disponibilidade — quanto o broker aguenta antes de degradar ou recusar
serviço — em contraste com Track A (injeção), que mede confidencialidade/
integridade. Este guia não cobre Track A.

## Pré-requisito

Suba o ambiente com `docker compose up` conforme `docs/getting-started.md`
antes de continuar — este guia assume os brokers, a API e o `attacker` já no
ar.

Exporte as credenciais usadas por `scripts/run-experiment.sh` (mesmo admin
seed do getting-started):

```bash
export RUN_EXPERIMENT_EMAIL="admin@stressbed.com"
export RUN_EXPERIMENT_PASSWORD="@admin123"
```

### Nota importante sobre exit code

As 3 tracks de Track B quase sempre retornam exit code `0`, mesmo quando o
ataque "funcionou" (broker recusou conexões, caiu em taxa, desconectou etc.).
O resultado real está no JSON impresso em stdout (`--output-format json`),
não no exit code. Isso é diferente de `injection` (Track A), que usa 0/1
como sinal de rejeição/aceite. Se for automatizar, cheque o conteúdo do JSON
— não o exit code.

## Passo 1 — Connection flood

Abre N conexões MQTT simultâneas para esgotar os slots de conexão do broker
e reporta a taxa de sucesso/falha de CONNECT.

```bash
./scripts/run-experiment.sh connection-flood plain -- --connections 200
```

Repita contra `secure`:

```bash
./scripts/run-experiment.sh connection-flood secure -- --connections 200
```

Flags de `connection_flood.py` (via `args_connection_flood.py`):

| Flag | Default | Observação |
|---|---|---|
| `--target {plain,secure}` | obrigatório | |
| `--host` | env conforme o target, senão `localhost` | |
| `--port` | env conforme o target, senão `1883`/`8883` | |
| `--connections` | `100` | conexões simultâneas |
| `--client-id-prefix` | `flood` | |
| `--hold-seconds` | `5.0` | tempo que as conexões ficam abertas antes de desconectar |
| `--connect-timeout` | `10.0` | espera por CONNACK |
| `--username` / `--password` | `None` | nunca herdados do ambiente — o atacante não tem credencial legítima por definição |
| `--output-format` | `json` | |

## Passo 2 — Message flood

Publica mensagens numa taxa configurável (msg/s) por uma duração
configurável, para medir throughput sustentado até degradação do broker.

```bash
./scripts/run-experiment.sh message-flood plain -- --rate 200 --duration-seconds 30
```

Repita contra `secure`:

```bash
./scripts/run-experiment.sh message-flood secure -- --rate 200 --duration-seconds 30
```

Flags de `message_flood.py` (via `args_message_flood.py`):

| Flag | Default | Observação |
|---|---|---|
| `--target` | obrigatório | |
| `--sensor-id` | `sensor-mock-01` | tópico alvo `sensors/<sensor_id>/telemetry` |
| `--host` / `--port` | mesma regra de default do connection-flood | |
| `--rate` | `100.0` | msg/s |
| `--duration-seconds` | `30.0` | |
| `--payload-size-bytes` | `64` | |
| `--qos` | `0` | |
| `--client-id` | `message-flood` | |
| `--username` / `--password` | `None` | mesma regra de não herdar do ambiente |
| `--output-format` | `json` | |

## Passo 3 — Malformed / giant payload

Envia payloads malformados ou anormalmente grandes ao tópico do sensor e
reporta a resposta do broker (aceite, erro, desconexão). Quatro modos:

- `giant` — payload anormalmente grande (mira o limite típico de
  `message_size_limit` do broker, não o teto do protocolo MQTT de ~256MB).
- `invalid-utf8`
- `invalid-json`
- `null-bytes`

```bash
./scripts/run-experiment.sh malformed-payload plain -- --mode giant --size-bytes 10000000
```

Repita contra `secure`:

```bash
./scripts/run-experiment.sh malformed-payload secure -- --mode giant --size-bytes 10000000
```

Flags de `malformed_payload.py` (via `args_malformed_payload.py`):

| Flag | Default | Observação |
|---|---|---|
| `--target` | obrigatório | |
| `--mode {giant,invalid-utf8,invalid-json,null-bytes}` | obrigatório | |
| `--sensor-id` | `sensor-mock-01` | |
| `--host` / `--port` | mesma regra de default | |
| `--size-bytes` | `10_000_000` | só usado no modo `giant` |
| `--count` | `1` | número de publicações malformadas |
| `--qos` | `0` | |
| `--client-id` | `malformed-payload` | |
| `--username` / `--password` | `None` | |
| `--output-format` | `json` | |

## Passo 4 — Console de ataque na UI

`http://localhost:3002/ataques` dispara o ataque por um botão, sem terminal: escolha o
ataque (`connection-flood`, `message-flood` ou `malformed-payload`), o alvo
(`plain`/`secure`), os parâmetros opcionais e clique em **Disparar ataque**. O backend
cria a run, executa o ataque no container `attacker`, registra o resultado e encerra a
run ([[ADR-0012]]); a tela mostra a run ativa (com o botão **Parar run**), o resultado
mais recente e o histórico.

Os campos em branco usam os defaults dos scripts. Abaixo do botão, a tela mostra o
**comando equivalente** do `run-experiment.sh` (com "Copiar") para quem prefere o
terminal ou quer reproduzir a run — botão e terminal produzem runs idênticas, com os
mesmos `params`. Só uma run roda por vez ([[ADR-0006]]): com uma ativa, o botão fica
desabilitado.

## Passo 5 — Acompanhar métricas no Grafana

`http://localhost:3001`, dashboard "Broker Metrics" (uid
`stressbed-broker-metrics`, cobre Track A e Track B via telegraf), no intervalo de
tempo da execução — o dashboard não filtra mais por `run_id` ([[ADR-0013]]). A tela
`/ataques` já linka direto para o Grafana na janela certa assim que o ataque termina.
Também dá para abrir o dashboard manualmente e ajustar o intervalo no topo (início e
fim da run, que o histórico mostra).

## Avançado — chamando a API de experiments diretamente

Isso é o que `run-experiment.sh` faz por baixo dos panos — útil para quem
quiser orquestrar de um jeito diferente. Os endpoints exigem JWT
(`@UseGuards(JwtAuthGuard)` em `ExperimentsController`, path base
`experiments/runs`):

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@stressbed.com","password":"@admin123"}' | jq -r .access_token)

curl -X POST http://localhost:3000/experiments/runs/start \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"plain","attackType":"connection-flood"}'

curl -X POST http://localhost:3000/experiments/runs/stop \
  -H "Authorization: Bearer $TOKEN"

curl http://localhost:3000/experiments/runs/active -H "Authorization: Bearer $TOKEN"
```

`StartRunDto`: `mode` (`plain`|`secure`, obrigatório), `attackType` (string,
obrigatório), `params` (objeto opcional), `notes` (string opcional).

Endpoints:

- `POST /experiments/runs/start` — 201, ou 409 se já existe run ativa.
- `POST /experiments/runs/stop` — 200, encerra a run ativa se houver.
- `GET /experiments/runs/active` — 200, retorna a run ativa ou `null`.

Quem usa a API direta chama um único endpoint, o mesmo que o `run-experiment.sh`
usa ([[ADR-0012]]):

```bash
curl -X POST http://localhost:3000/experiments/runs/launch \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"plain","attackType":"connection-flood","params":{"connections":200}}'
```

O api cria a run (409 se já há uma ativa), manda o ataque ao container `attacker`,
registra o KPI e encerra a run; responde `202` na hora, e o andamento sai de
`GET /experiments/runs/active` e `GET /metrics/runs/<run_id>`. `params` é o objeto
`{flag: valor}` do ataque. Não há mais o que disparar à mão no `attacker`.

## Próximo passo

Para agregar os KPIs de várias execuções (plain vs secure) em CSV/tabela
comparativa, ver `scripts/analysis/README.md`.
