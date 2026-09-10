# Attacker — Track A (injeção/spoofing) e Track B (negação de serviço)

Ferramentas de ataque do IoT StressBed. Este pacote contém:

- O **injetor** (Track A, `injector.py`): um publisher MQTT **não autenticado**
  que forja leituras no tópico do sensor legítimo. No broker **plain** (sem
  TLS/auth) as mensagens são aceitas; no broker **secure** (mTLS + senha) o
  handshake TLS é abortado por falta de certificado de cliente, servindo de
  grupo de controle.
- Três scripts de **negação de serviço** (Track B, ver
  `docs/specs/track-b-availability-dos.md`): `connection_flood.py` (esgota
  slots de conexão do broker), `message_flood.py` (satura o broker com
  throughput sustentado de publish) e `malformed_payload.py` (testa a robustez
  do parsing/buffer do broker sob payloads adversariais). Assim como o
  injetor, nenhum dos três apresenta certificado de cliente no broker secure
  nem herda credenciais do ambiente.

## Instalação

```bash
pip install -r requirements.txt
```

(Opcional, recomendado no Windows) usar um venv local:

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

## Rodando o injetor

```bash
# Injeta 20 leituras forjadas no broker plain (aceitas)
python python/injector.py --target plain --count 20

# Tenta o mesmo no broker secure sem credencial (rejeitado no handshake TLS)
python python/injector.py --target secure
```

Flags principais (`python python/injector.py --help` para a lista completa):

- `--target plain|secure` (obrigatório).
- `--sensor-id` — sensor cujo tópico será falsificado (default `sensor-mock-01`,
  o mesmo do `scripts/mock-sensor.py`).
- `--host` / `--port` — default lidos de `MQTT_PLAIN_HOST`/`MQTT_PLAIN_PORT` ou
  `MQTT_SECURE_HOST`/`MQTT_SECURE_PORT` conforme o target.
- `--count` (default 10), `--interval` (default 0.0 — é um ataque, não uma
  simulação), `--qos` (default 0).
- `--temperature` / `--humidity` — valores fixos; se passados, ignoram os ranges
  aleatórios.
- `--username` / `--password` — **nunca** herdados do ambiente. Sem eles, o
  injetor conecta anonimamente (o atacante não possui a credencial legítima).

### Saída (`InjectionResult`)

O injetor imprime um JSON em **stdout** (progresso humano-legível vai para
stderr):

| Campo | Significado |
|---|---|
| `target` | `plain` ou `secure`. |
| `topic` | `sensors/<sensor-id>/telemetry`. |
| `sensor_id`, `host`, `port` | alvo do ataque. |
| `connect_status` | `connected` (broker aceitou) ou `rejected` (recusado). |
| `connect_error` | mensagem de erro quando rejeitado, senão `null`. |
| `attempted` | mensagens publicadas. |
| `accepted` | publishes que retornaram sucesso (`MQTT_ERR_SUCCESS`). |
| `success_rate` | `accepted/attempted`, ou `null` quando `attempted == 0`. |
| `started_at` / `finished_at` | timestamps ISO 8601 (UTC). |

**Exit code:** para `--target plain`, sempre `0` (rodou). Para `--target secure`,
`0` quando rejeitado (esperado) e `1` quando `connected` — um achado grave: o
broker secure aceitou um atacante sem credencial válida.

## Rodando o connection-flood (Track B)

```bash
# Abre 200 conexões simultâneas no broker plain
./scripts/run-experiment.sh connection-flood plain -- --connections 200
```

Abre N conexões MQTT simultâneas (via thread pool) para esgotar os slots de
conexão do broker, medindo quantas são aceitas antes de recusar/derrubar novas
tentativas. Diferente do injetor (que mede a rejeição de uma única conexão sem
certificado de cliente), aqui o objetivo é volume — reaproveita o mesmo padrão
de espera por CONNACK do `injector.py`, multiplicado por N conexões
concorrentes.

Flags principais (`python python/connection_flood.py --help` para a lista
completa):

- `--target plain|secure` (obrigatório).
- `--host` / `--port` — mesma convenção do injetor (env conforme o target,
  senão `localhost`/`1883` ou `8883`).
- `--connections` (default `100`) — número de conexões simultâneas a abrir.
- `--client-id-prefix` (default `flood`).
- `--hold-seconds` (default `5.0`) — segundos que as conexões estabelecidas
  ficam abertas antes de desconectar.
- `--connect-timeout` (default `10.0`) — segundos de espera por CONNACK por
  conexão.
- `--username` / `--password` — **nunca** herdados do ambiente (default
  `None`).

### Saída (`ConnectionFloodResult`)

JSON em stdout com `target`, `host`, `port`, `connections_attempted`,
`connections_established`, `connections_rejected`, `success_rate`, `errors`
(até 5 mensagens únicas de erro) e `started_at`/`finished_at`.

**Exit code:** sempre `0` quando o flood roda até o fim — falhas de conexão
individuais são esperadas e contabilizadas em `errors`/`connections_rejected`.
Só retorna `1` em erro inesperado na orquestração do flood em si.

## Rodando o message-flood (Track B)

```bash
# Publica a 200 msg/s por 30s no broker plain
./scripts/run-experiment.sh message-flood plain -- --rate 200 --duration-seconds 30
```

Abre uma única conexão e publica mensagens no tópico do sensor legítimo
(`sensors/<sensor-id>/telemetry`) a uma taxa configurável (msg/s) por uma
duração configurável, medindo o throughput sustentado até a degradação do
broker. Ao contrário do injetor (uma conexão por rajada), a conexão aqui é
aberta uma única vez e mantida por toda a duração do flood.

Flags principais (`python python/message_flood.py --help` para a lista
completa):

- `--target plain|secure` (obrigatório).
- `--sensor-id` (default `sensor-mock-01`).
- `--host` / `--port` — mesma convenção do injetor.
- `--rate` (default `100.0` msg/s).
- `--duration-seconds` (default `30.0`).
- `--payload-size-bytes` (default `64`) — tamanho de cada payload publicado.
- `--qos` (default `0`).
- `--client-id` (default `message-flood`).
- `--username` / `--password` — **nunca** herdados do ambiente.

### Saída (`MessageFloodResult`)

JSON com `target`, `topic`, `host`, `port`, `connect_status`
(`connected`/`rejected`), `connect_error`, `attempted`, `accepted`,
`success_rate`, `elapsed_seconds`, `achieved_rate` e
`started_at`/`finished_at`.

**Exit code:** sempre `0`. Diferente do injetor, aqui não há uma assimetria
plain aceita/secure rejeita a comprovar — o objetivo é medir throughput, então
uma conexão recusada em qualquer target é apenas um resultado do experimento,
não uma anomalia sinalizada via exit code.

## Rodando o malformed-payload (Track B)

```bash
# Envia um payload gigante (~10MB) no broker plain
./scripts/run-experiment.sh malformed-payload plain -- --mode giant --size-bytes 10000000
```

Envia payloads malformados ou anormalmente grandes ao tópico do sensor e
reporta a reação do broker (aceite, erro no cliente, ou desconexão). O
objetivo é verificar a robustez do parsing/buffer do broker sob entrada
adversarial — não forjar leituras nem esgotar conexões, os outros dois
ataques desta seção.

Modos disponíveis em `--mode` (obrigatório): `giant` (payload de tamanho
arbitrário — default `10_000_000` bytes / ~10MB, mirando o limite prático de
`message_size_limit` do broker, não o teto do protocolo MQTT de ~256MB),
`invalid-utf8`, `invalid-json`, `null-bytes`.

Flags principais (`python python/malformed_payload.py --help` para a lista
completa):

- `--target plain|secure` (obrigatório).
- `--mode giant|invalid-utf8|invalid-json|null-bytes` (obrigatório).
- `--sensor-id` (default `sensor-mock-01`).
- `--host` / `--port` — mesma convenção do injetor.
- `--size-bytes` (default `10_000_000`) — só usado em `--mode giant`.
- `--count` (default `1`) — número de publicações malformadas a enviar.
- `--qos` (default `0`).
- `--client-id` (default `malformed-payload`).
- `--username` / `--password` — **nunca** herdados do ambiente.

### Saída (`MalformedPayloadResult`)

JSON com `target`, `topic`, `host`, `port`, `mode`, `connect_status`,
`connect_error`, `attempted`, `publish_accepted`, `disconnected_after_publish`
(se o broker derrubou a conexão em reação ao payload) e
`broker_response_summary` (`"aceito sem erro aparente"`, `"erro no cliente ao
publicar"` ou `"broker desconectou apos publish"`).

**Exit code:** sempre `0` — não há um resultado esperado único para comparar;
o propósito é só observar e reportar a reação do broker, e a classificação
vive no JSON/stderr, não no exit code.

## Testes

```bash
cd python

# Unit (sem broker, sem rede)
python -m pytest -m "not integration" -v

# Integração (exige os brokers reais)
docker compose up -d mosquitto-plain mosquitto-secure   # a partir da raiz do repo
python -m pytest -m integration -v
```

Os testes de integração leem porta/credencial do `.env` na raiz do repo.

## Aviso importante — só publique dentro de uma run de injeção

O injetor **só deve publicar enquanto uma run com `attackType=injection`
estiver ativa** (iniciada via `POST /experiments/runs/start`). Nesse estado, o
módulo `capture` marca a telemetria capturada como `source=injected`. Publicar
**fora** de uma run ativa grava os pontos como `source=legit`, corrompendo o KPI
de taxa de sucesso de injeção.

A orquestração completa (login → start run → disparo do injetor → stop run) fica
em `scripts/run-experiment.sh` (implementado por outra frente de trabalho; pode
ainda não existir no momento em que você ler isto).
