# Plano de testes — Fase 0.5 (Fundação de infra)

Infraestrutura se valida por **comportamento observável**, não por inspeção de
YAML (ver "Testing Decisions" em `docs/specs/infra-resource-isolation.md`). Este
documento é o checklist manual da Fase 0.5: uma seção por tarefa, com comando,
resultado esperado e critério de pronto.

Tudo aqui é executável de fora dos containers, num host com Docker.

## Pré-requisitos

```bash
cp .env.example .env          # e trocar todos os valores "change-me"
./scripts/gen-certs.sh        # obrigatório antes de subir o mosquitto-secure
nproc                         # conferir o nº de núcleos vs. o mapa de cpuset do .env
```

Os comandos abaixo assumem os valores default do `.env.example`
(`MQTT_SECURE_USERNAME=stressbed`, `MQTT_SECURE_PASSWORD=change-me-mqtt-secure`,
`GRAFANA_PORT=3001`, host de 8 núcleos). Ajuste se o seu `.env` divergir.

Alguns comandos usam um container descartável na rede `stressbed-net` como
cliente MQTT, para não exigir `mosquitto-clients` instalado no host:

```bash
alias mqttc='docker run --rm -it --network stressbed-net \
  -v "$PWD/infra/mosquitto/secure/certs:/certs:ro" eclipse-mosquitto:2.0.20'
```

> **Nota sobre Windows/Git Bash:** prefixe `docker exec`/`docker run` com
> `MSYS_NO_PATHCONV=1` quando o comando tiver caminhos absolutos do container
> (`/mosquitto/...`), senão o Git Bash os converte em caminhos Windows.

---

## 1. `scripts/gen-certs.sh` — CA + certificado de servidor

**Status: executado, aprovado.**

```bash
rm -rf infra/mosquitto/secure/certs
./scripts/gen-certs.sh
```

Esperado:
- exit code 0;
- `infra/mosquitto/secure/certs/` contém `ca.key`, `ca.crt`, `server.key`,
  `server.crt` (todos não-vazios);
- o próprio script imprime `.../server.crt: OK` (verificação de cadeia por
  `openssl verify`) e o SAN do certificado;
- `ca.key` em modo `0600`, `server.key` em `0640` (num host Linux;
  no Windows o modo é irrelevante).

Idempotência e regeneração:

```bash
./scripts/gen-certs.sh            # deve dizer "nada a fazer" e não sobrescrever
./scripts/gen-certs.sh --force    # deve regenerar do zero
```

Para que o ESP32 alcance o broker secure pelo IP da LAN, o IP precisa estar no
SAN:

```bash
CERT_EXTRA_SAN="IP:192.168.0.42" ./scripts/gen-certs.sh --force
openssl x509 -in infra/mosquitto/secure/certs/server.crt -noout -ext subjectAltName
```

Esperado: o IP aparece na lista de SAN. **Sem isso, o cliente TLS recusa a
conexão por hostname mismatch** — é o erro mais provável de aparecer no
firmware.

**Pronto quando:** os quatro arquivos existem e a cadeia verifica.

---

## 2. `mosquitto-plain` — 1883, sem TLS, sem autenticação

**Status: executado, aprovado.**

```bash
docker compose up -d mosquitto-plain
docker compose ps mosquitto-plain          # esperado: Up ... (healthy)
docker compose logs mosquitto-plain
```

Esperado nos logs: `Config loaded from /mosquitto/config/mosquitto.conf.` e
`Opening ipv4 listen socket on port 1883.`

> Aparece também `chown: /mosquitto/config/mosquitto.conf: Read-only file
> system`. É inofensivo: o entrypoint da imagem tenta ajustar o dono de um
> arquivo montado read-only. Não é erro de configuração.

Publicar e assinar **sem nenhuma credencial** (é isto que a IC demonstra):

```bash
# terminal A
mqttc mosquitto_sub -h mosquitto-plain -p 1883 -t '#' -v
# terminal B
mqttc mosquitto_pub -h mosquitto-plain -p 1883 -t sensors/esp32-01/telemetry -m '{"t":25.1}'
```

Esperado: o terminal A imprime `sensors/esp32-01/telemetry {"t":25.1}` — sem
usuário, sem senha, sem TLS, assinando o wildcard `#`.

**Pronto quando:** CONNECT/PUBLISH/SUBSCRIBE anônimos funcionam.
**Anti-regressão:** se algum dia isto passar a exigir credencial, o alvo do
estudo foi "consertado" por engano — reverta.

---

## 3. `mosquitto-secure` — 8883, TLS + auth + ACL

**Status: executado, aprovado.**

```bash
docker compose up -d mosquitto-secure
docker compose ps mosquitto-secure         # esperado: Up ... (healthy)
docker compose logs mosquitto-secure
```

Esperado nos logs, na ordem: as três linhas do entrypoint (certificados
copiados, senha gerada, ACL gerada), depois
`Opening ipv4 listen socket on port 8883.`

O healthcheck já exercita o caminho feliz inteiro (TLS validado contra a CA +
senha + ACL de leitura de `$SYS`); `healthy` é sinal positivo.

### 3.1 Casos negativos (o que precisa ser RECUSADO)

| # | Comando | Esperado |
|---|---|---|
| a | `mqttc mosquitto_pub -h mosquitto-secure -p 8883 -t sensors/x -m hi` | `Error: Protocol error` — TCP puro na porta TLS |
| b | `mqttc mosquitto_pub --cafile /certs/ca.crt -h mosquitto-secure -p 8883 -t sensors/x -m hi` | `Connection Refused: not authorised` |
| c | `mqttc mosquitto_pub --cafile /certs/ca.crt -h mosquitto-secure -p 8883 -u stressbed -P senha-errada -t sensors/x -m hi` | `Connection Refused: not authorised` |

### 3.2 Caso positivo

```bash
mqttc mosquitto_pub --cafile /certs/ca.crt -h mosquitto-secure -p 8883 \
  -u stressbed -P change-me-mqtt-secure -t sensors/esp32-01/telemetry -m hi
```

Esperado: sem saída, exit 0.

### 3.3 ACL

Publicação QoS 0 negada pela ACL é **descartada em silêncio** pelo protocolo —
não confie na ausência de erro. Use QoS 1 com MQTT v5, que devolve reason code:

```bash
# tópico fora da ACL -> PUBACK RC:135 (Not authorized)
mqttc mosquitto_pub -d -V 5 -q 1 --cafile /certs/ca.crt -h mosquitto-secure -p 8883 \
  -u stressbed -P change-me-mqtt-secure -t proibido/x -m hi

# tópico permitido -> PUBACK RC:16 (Success / no matching subscribers)
mqttc mosquitto_pub -d -V 5 -q 1 --cafile /certs/ca.crt -h mosquitto-secure -p 8883 \
  -u stressbed -P change-me-mqtt-secure -t sensors/esp32-01/telemetry -m hi
```

Conferir os arquivos gerados em runtime (nenhuma credencial versionada):

```bash
MSYS_NO_PATHCONV=1 docker exec mosquitto-secure ls -l /mosquitto/runtime
MSYS_NO_PATHCONV=1 docker exec mosquitto-secure cat /mosquitto/runtime/acl
```

Esperado: `acl`, `passwd`, `ca.crt`, `server.crt`, `server.key` — todos com dono
`mosquitto` (o broker larga privilégio e não roda como root); a ACL com
`user stressbed` no lugar do placeholder `__MQTT_USER__`.

Falha esperada e útil — subir sem certificados:

```bash
mv infra/mosquitto/secure/certs /tmp/certs-bkp
docker compose up mosquitto-secure     # deve morrer com mensagem apontando gen-certs.sh
mv /tmp/certs-bkp infra/mosquitto/secure/certs
```

**Pronto quando:** os três casos negativos são recusados, o positivo passa, e a
ACL devolve RC:135 fora do namespace.

---

## 4. `postgres`, `influxdb`, `grafana`

**Status: executado, aprovado.**

```bash
docker compose up -d postgres influxdb grafana
docker compose ps        # os três: Up ... (healthy)
```

Datasource do Grafana (provisionado por arquivo, não pela UI):

```bash
curl -s -u "admin:$GRAFANA_ADMIN_PASSWORD" \
  -X POST http://127.0.0.1:3001/api/datasources/uid/stressbed-influxdb/health
```

Esperado: `{"message":"datasource is working. N buckets found","status":"OK"}`.

Postgres:

```bash
MSYS_NO_PATHCONV=1 docker exec stressbed-postgres \
  psql -U stressbed -d stressbed -c 'select version();'
```

Exposição de rede (nada da stack de observação deve sair da máquina):

```bash
docker compose ps    # esperado: 127.0.0.1:5432, 127.0.0.1:8086, 127.0.0.1:3001
                     # e 0.0.0.0 SOMENTE nas portas 1883/8883 (o ESP32 vem da LAN)
```

Nos logs do Grafana aparecem dois `level=error` sobre
`/etc/grafana/provisioning/plugins` e `.../alerting`: são diretórios vazios
mantidos apenas para silenciar o aviso; não há provisionamento de plugin nem de
alerta nesta fase.

**Pronto quando:** os três estão healthy e o health check do datasource
responde OK.

---

## 5. Limites de recurso (cpuset / cpus / memory sem swap / pids)

**Status: executado, aprovado. É o teste mais importante da fase.**

### 5.1 Os limites foram efetivamente aplicados?

```bash
MSYS_NO_PATHCONV=1 docker inspect mosquitto-plain mosquitto-secure --format \
 '{{.Name}} cpuset={{.HostConfig.CpusetCpus}} nanocpus={{.HostConfig.NanoCpus}} mem={{.HostConfig.Memory}} memswap={{.HostConfig.MemorySwap}} pids={{.HostConfig.PidsLimit}}'
```

Esperado, com os defaults do `.env.example`:

```
/mosquitto-plain  cpuset=2 nanocpus=1000000000 mem=268435456 memswap=268435456 pids=512
/mosquitto-secure cpuset=3 nanocpus=1000000000 mem=268435456 memswap=268435456 pids=512
```

**Invariantes a conferir a cada mudança de `.env`:**
1. `mem == memswap` (swap zero, OOM determinístico). Se `memswap > mem`, o
   experimento perdeu validade.
2. os `cpuset` dos brokers não intersectam `STACK_CPUSET` nem `ATTACKER_CPUSET`;
3. plain e secure têm valores **idênticos** (senão a comparação vira comparação
   de hardware);
4. `nanocpus / 1e9 <= ` nº de núcleos do cpuset.

### 5.2 Teto de CPU sob carga sintética

Rodar a carga DENTRO do container e medir de FORA (`docker stats` no host):

```bash
# carga: 6 loops ocupados por 25s, dentro do broker limitado a 1 núcleo
MSYS_NO_PATHCONV=1 docker exec -d mosquitto-plain sh -c \
  'for i in 1 2 3 4 5 6; do (while :; do :; done) & done; sleep 25; kill 0'

# medir de fora, durante a carga
MSYS_NO_PATHCONV=1 docker stats --no-stream \
  --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}'
```

Resultado observado (host de 8 núcleos):

```
mosquitto-plain      100.01%   2.254MiB / 256MiB   9
mosquitto-secure       0.04%   1.418MiB / 256MiB   1
stressbed-telegraf     0.06%
stressbed-grafana      0.22%
stressbed-postgres     0.00%
stressbed-influxdb     0.06%
```

Esperado: `mosquitto-plain` estabiliza em ~100% (= exatamente 1 núcleo, o teto
de `cpus`) e **não passa disso**, apesar de haver 6 processos ocupados e 8
núcleos na máquina. Os demais containers permanecem praticamente ociosos.

> `100%` no `docker stats` = 1 núcleo. Num host de 8 núcleos, um container sem
> limite chegaria a 800%.

### 5.3 Memória sem swap (ponto de OOM determinístico)

Testar com um container descartável, com os mesmos limites, para não matar o
broker:

```bash
docker run --rm --cpuset-cpus=2 --cpus=1.0 --memory=256m --memory-swap=256m \
  --pids-limit=512 alpine:3.20 sh -c 'tail /dev/zero'; echo "exit=$?"
```

Esperado: `exit=137` (SIGKILL pelo OOM killer) em poucos segundos — sem
colchão de swap, sem travar o host.

> Não use `dd ... of=/dev/shm/...` para este teste: o `/dev/shm` do Docker tem
> 64 MB por default e o `dd` bate nesse limite antes do limite de memória,
> dando um falso "passou".

### 5.4 Limite de PIDs

```bash
docker run --rm --memory=256m --memory-swap=256m --pids-limit=64 alpine:3.20 \
  sh -c 'i=0; while [ $i -lt 200 ]; do sleep 30 & i=$((i+1)); done'
```

Esperado: `sh: can't fork: Resource temporarily unavailable` — a criação de
processos para no teto, sem esgotar os PIDs do host.

**Pronto quando:** 5.1 mostra os limites aplicados e 5.2/5.3/5.4 mostram os três
tetos (CPU, memória, PIDs) sendo respeitados sob carga.

---

## 6. `telegraf` — `broker_metrics` no InfluxDB, sem depender do NestJS

**Status: executado, aprovado.**

```bash
docker compose up -d telegraf
docker compose logs telegraf
```

Esperado: `Loaded inputs: docker`, `Loaded processors: enum`,
`Loaded outputs: influxdb_v2`, `Tags enabled: host=stressbed-host run_id=none` e
**nenhuma linha `E!`**.

> A linha `W! ... skip_processors_after_aggregators ... Telegraf v1.40.0` é um
> aviso de mudança futura de default e não afeta esta configuração (não há
> aggregators).

Confirmar que os pontos chegaram, com as tags contratadas:

```bash
MSYS_NO_PATHCONV=1 docker exec stressbed-influxdb influx query \
  'import "influxdata/influxdb/schema" schema.tagValues(bucket:"stressbed", tag:"broker")' \
  --org "$INFLUXDB_ORG" --token "$INFLUXDB_TOKEN"

MSYS_NO_PATHCONV=1 docker exec stressbed-influxdb influx query \
  'from(bucket:"stressbed") |> range(start:-2m)
   |> filter(fn:(r)=> r._measurement=="broker_metrics" and r._field=="usage_percent")
   |> last()
   |> keep(columns:["_measurement","broker","container_name","run_id","_value"])' \
  --org "$INFLUXDB_ORG" --token "$INFLUXDB_TOKEN"
```

Esperado: `schema.tagValues` devolve `plain` e `secure`; a segunda query devolve
`usage_percent` por container, com `broker=plain|secure` e `run_id=none`.

### 6.1 Independência do NestJS (ADR-0003) — verificação explícita

Este é o critério de aceite mais fácil de perder de vista numa fase futura.

```bash
# nenhuma DIRETIVA (linha não-comentário) referenciando o backend.
# Os comentários do arquivo citam o nestjs-api de propósito, para explicar por
# que ele NÃO aparece — por isso o filtro remove as linhas de comentário antes.
grep -vE '^[[:space:]]*#' infra/telegraf/telegraf.conf   | grep -inE 'nest|backend|:3000'          # esperado: nada
```

E, no `docker-compose.yml`, o serviço `telegraf` tem `depends_on` apenas de
`influxdb`. Como o `nestjs-api` ainda não existe, a verificação decisiva é
posterior: **na Fase 1, derrubar o `nestjs-api` e confirmar que
`broker_metrics` continua recebendo pontos.** Registrado aqui como pendência.

**Pronto quando:** `broker_metrics` recebe pontos tagueados por `broker`, com
telegraf dependendo só do socket do Docker e do InfluxDB.

---

## 7. `.env.example` — reprodutibilidade a partir do zero

**Status: executado, aprovado.**

```bash
# em um clone limpo:
cp .env.example .env
./scripts/gen-certs.sh
docker compose up -d
docker compose ps                # todos healthy
```

Esperado: a stack sobe inteira só com `.env.example` copiado (os defaults são
funcionais para laboratório), e cada variável obrigatória tem mensagem própria
se faltar — as declarações usam `${VAR:?...}`:

```bash
grep -c 'change-me' .env         # antes de usar de verdade, isto deve ser 0
```

Teste de mensagem de erro:

```bash
MQTT_SECURE_PASSWORD= docker compose config >/dev/null
# esperado: erro citando "defina MQTT_SECURE_PASSWORD no .env"
```

**Pronto quando:** um ambiente novo sobe com `cp .env.example .env` +
`gen-certs.sh` + `docker compose up`, e nenhuma variável obrigatória falha em
silêncio.

---

## 8. Checklist de encerramento da fase

```bash
docker compose config >/dev/null && echo "compose valido"
docker compose ps        # 6 serviços, todos healthy
docker compose down      # desce limpo
```

- [ ] `gen-certs.sh` gera e verifica a cadeia (§1)
- [ ] broker plain aceita tudo sem credencial (§2) — **não "consertar"**
- [ ] broker secure recusa TCP puro, recusa sem/errada credencial, aplica ACL (§3)
- [ ] postgres/influxdb/grafana healthy + datasource OK (§4)
- [ ] limites de recurso aplicados e respeitados sob carga (§5) — **crítico**
- [ ] `broker_metrics` chegando via telegraf, sem NestJS (§6)
- [ ] ambiente reproduzível a partir do `.env.example` (§7)

### Pendências herdadas para fases futuras

- **Fase 1:** derrubar o `nestjs-api` durante coleta e confirmar que
  `broker_metrics` continua sendo gravado (fechamento do ADR-0003, §6.1).
- **Fase 3:** ao criar o serviço `attacker`, aplicar os limites `ATTACKER_*` já
  reservados no `.env.example` e repetir §5.1/§5.2 apontando para ele — o
  ADR-0004 exige os mesmos limites no atacante.
- **Fase 3:** repetir §5.2 com um ataque real (não carga sintética) e confirmar
  que o host segue responsivo, conforme o protocolo de experimento.
