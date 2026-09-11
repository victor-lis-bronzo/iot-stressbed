# Guia — Track A (Confidencialidade e Integridade)

## O que é Track A

Track A cobre dois ataques que evidenciam a diferença de segurança entre o
broker plain (sem TLS, sem autenticação) e o broker secure (TLS + auth) deste
projeto. **Interceptação** evidencia falta de confidencialidade: um broker
plain expõe o payload MQTT em texto puro na rede, legível por qualquer
subscriber não autorizado. **Injeção** evidencia falta de integridade e
autenticação: é possível forjar telemetria (publicar mensagens arbitrárias se
passando por um sensor legítimo) contra o broker plain; o broker secure, com
TLS + autenticação, rejeita o atacante.

## Pré-requisito

Este guia assume que o ambiente já está de pé — brokers plain e secure,
backend e frontend rodando via `docker compose up`. Se ainda não fez isso,
veja [`./getting-started.md`](./getting-started.md) primeiro.

## Passo 1 — telemetria legítima (opcional, recomendado)

Para ver dado real fluindo antes de atacar, suba o sensor simulado:

```bash
docker compose --profile dev-tools up -d mock-sensor
```

Ele publica em `sensors/<sensor-id>/telemetry` nos dois brokers (plain e
secure) a cada `MOCK_SENSOR_INTERVAL` segundos (default `2`). O `sensor-id`
default é `sensor-mock-01` (env `MOCK_SENSOR_ID`).

## Passo 2 — ver a interceptação na tela

Acesse `http://localhost:3002/interceptacao`.

A tela mostra os payloads capturados do broker **plain** exatamente como
trafegaram na rede — sem cifra, sem parse, sem transformação. Isso evidencia,
na prática, que qualquer subscriber sem autorização consegue ler a telemetria
em claro, sem precisar de nenhuma credencial.

## Passo 3 — rodar injeção via `run-experiment.sh`

O script `scripts/run-experiment.sh` orquestra o fluxo completo: login →
start da run → disparo do attacker → stop da run (via trap `EXIT`, mesmo se o
attacker falhar) → registro do resultado como KPI.

```bash
export RUN_EXPERIMENT_EMAIL="admin@stressbed.com"
export RUN_EXPERIMENT_PASSWORD="@admin123"
./scripts/run-experiment.sh injection plain -- --count 20 --interval 0.1
```

Depois, repita contra o broker secure como controle:

```bash
./scripts/run-experiment.sh injection secure -- --count 20 --interval 0.1
```

### Atenção à semântica do exit code

Para a track `injection`, o exit code do `injector.py` **não** segue a
convenção intuitiva de "0 = sucesso do ataque". Ele significa:

- **`0`** — o broker **plain** aceitou o atacante (comportamento esperado no
  plain) **OU** o broker **secure** rejeitou o atacante (comportamento
  esperado no secure — TLS + auth funcionando).
- **`1`** — o broker **secure** aceitou o atacante indevidamente. Isso seria
  um achado grave de segurança, não o resultado esperado.

Ou seja: rodar contra `secure` e terminar com exit code `0` é o resultado
**correto e esperado** — prova que a mitigação funciona. Exit code `1` no caso
secure indicaria falha de segurança, não o oposto. Não interprete "exit 1" no
secure como o comportamento normal — é justamente a anomalia a investigar.

### Flags do `injector.py`

- `--target {plain,secure}` (obrigatório)
- `--sensor-id` (default `sensor-mock-01`)
- `--host`, `--port` (default via env `MQTT_PLAIN_HOST`/`MQTT_PLAIN_PORT` ou
  `MQTT_SECURE_HOST`/`MQTT_SECURE_PORT`; sem essas envs, `localhost` e `1883`
  para plain ou `8883` para secure)
- `--count` (default `10`)
- `--interval` (default `0.0`)
- `--qos` (default `0`)
- `--temperature`, `--humidity`
- `--username`, `--password`

Nota: existe também `--output-format` no parser, mas atualmente não altera o
comportamento do script — pode ser ignorada.

## Passo 4 — ver o resultado na tela de injeção

Acesse `http://localhost:3002/injecao`.

A tela distingue visualmente as mensagens forjadas (`source=injected`) das
mensagens legítimas de telemetria.

## Passo 5 (opcional/avançado) — captura de pacotes e análise de entropia

Para evidência de rede — não só de aplicação — de que o broker plain vaza
texto puro e o secure transmite ciphertext:

```bash
./scripts/capture-pcap.sh plain    # gera ./captures/track-a-plain.pcap por padrão
./scripts/capture-pcap.sh secure   # idem para secure
```

Configurável via env: `IFACE` (default `any`), `DURATION_SECONDS` (default
`30`), `OUT`. Exige `tcpdump` instalado. Durante a captura, dispare telemetria
legítima (Passo 1) ou uma run de injeção (Passo 3).

Depois, calcule e classifique a entropia dos dois arquivos:

```bash
python scripts/pcap-entropy.py --plain ./captures/track-a-plain.pcap --secure ./captures/track-a-secure.pcap
```

Veja [`./experiment-protocol.md`](./experiment-protocol.md) para o protocolo
completo, os pré-requisitos detalhados e o critério de classificação de
entropia (legível / inconclusivo / ciphertext).

## Nota — rodando o injector diretamente, fora do `run-experiment.sh`

Também é possível rodar o script de injeção direto no container, sem passar
pelo `run-experiment.sh`:

```bash
docker compose exec attacker python python/injector.py --target plain --count 20
```

Isso é útil para um teste rápido isolado, mas **atenção**: nesse caso a
mensagem forjada **não** fica marcada com `source=injected` no InfluxDB,
porque essa tag vem do metadado da run ativa, criada pelo backend quando o
`run-experiment.sh` faz o start da run. Sem uma run ativa, não há tag. Veja
`docs/tasks.md` (Fase 2) para detalhes de como a tag é atribuída. Para o fluxo
recomendado — e para ver o resultado corretamente marcado na tela do Passo 4
— use sempre `run-experiment.sh`.
