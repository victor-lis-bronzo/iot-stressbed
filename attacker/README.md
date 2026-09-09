# Attacker — Track A (injeção/spoofing)

Ferramentas de ataque do IoT StressBed. Este pacote contém o **injetor**: um
publisher MQTT **não autenticado** que forja leituras no tópico do sensor
legítimo. No broker **plain** (sem TLS/auth) as mensagens são aceitas; no broker
**secure** (mTLS + senha) o handshake TLS é abortado por falta de certificado de
cliente, servindo de grupo de controle.

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
