# Protocolo de Experimento

## Captura de pacotes (pcap) — Track A, confirmação de legibilidade de payload

Este protocolo comprova, com evidência de rede (não só de aplicação), a
diferença de confidencialidade entre o broker plain (sem TLS) e o broker
secure (TLS): o payload MQTT trafega em texto puro no plain e como ciphertext
no secure. O critério objetivo é a entropia de Shannon dos bytes do payload
TCP capturado.

### Pré-requisitos

- `tcpdump` instalado e com permissão de captura na interface usada (em Linux,
  normalmente requer `sudo` ou a capability `CAP_NET_RAW`/`CAP_NET_ADMIN`).
- Python 3.12+ (mesma versão usada em `attacker/`) para `scripts/pcap-entropy.py`
  — sem dependências externas além da stdlib.
- Os brokers `mosquitto-plain` e `mosquitto-secure` no ar
  (`docker compose up mosquitto-plain mosquitto-secure` ou o compose completo).
- Opcional: Wireshark para inspeção visual complementar do `.pcap` gerado
  (o protocolo em si só depende do `tcpdump` + `pcap-entropy.py`).

### Passo a passo reproduzível

1. **Capturar o tráfego plain** em um terminal:
   ```bash
   ./scripts/capture-pcap.sh plain
   ```
   Em outro terminal, enquanto a captura roda, publicar telemetria real (ex.
   `scripts/mock-sensor.py` ou o firmware) ou disparar uma run de injeção:
   ```bash
   ./scripts/run-experiment.sh injection plain
   ```
   A captura para sozinha após `DURATION_SECONDS` (default 30s) ou com Ctrl+C.

2. **Capturar o tráfego secure**, repetindo o mesmo procedimento:
   ```bash
   ./scripts/capture-pcap.sh secure
   ```
   ```bash
   ./scripts/run-experiment.sh injection secure   # ou telemetria legítima
   ```

3. **Calcular e classificar a entropia** dos dois arquivos:
   ```bash
   python scripts/pcap-entropy.py \
     --plain ./captures/track-a-plain.pcap \
     --secure ./captures/track-a-secure.pcap
   ```
   Opcionalmente, anexar o resultado ao KPI da run correspondente (Postgres,
   via módulo `metrics`) — o endpoint exige autenticação, então é preciso um
   token JWT (o mesmo obtido via `POST /auth/login`, como
   `scripts/run-experiment.sh` já faz):
   ```bash
   export PCAP_ENTROPY_API_TOKEN="<access_token do login>"
   python scripts/pcap-entropy.py --plain ./captures/track-a-plain.pcap \
     --record-run-id <run_id_da_run_plain>
   ```

### Critério de classificação

A classificação usa a entropia agregada (bits/byte) de todos os payloads TCP
extraídos na porta do broker correspondente:

| Entropia (bits/byte) | Classificação | Interpretação                          |
|-----------------------|---------------|-----------------------------------------|
| `< 6.0`               | `legivel`     | payload consistente com texto puro (JSON) |
| `6.0` – `7.5`         | `inconclusivo`| não decidido — revisar amostra manualmente |
| `>= 7.5`              | `ciphertext`  | payload consistente com dado cifrado (TLS) |

Esperado: broker **plain** → `legivel`; broker **secure** → `ciphertext`.
Um resultado `inconclusivo` no secure, ou `ciphertext` no plain, é uma
anomalia a investigar (ex.: captura vazia, porta errada, payload
comprimido/binário legítimo sendo confundido com cifrado).

### Notas

- Os arquivos `.pcap` **não são versionados no repositório** (são binários,
  potencialmente grandes, e não agregam valor de revisão de código) — apenas
  os números de entropia obtidos ficam registrados aqui e/ou no KPI da run.
- `scripts/pcap-entropy.py` suporta pcap clássico com link-layer Ethernet ou
  "Linux cooked capture" (o que `tcpdump -i any` produz, o padrão usado por
  `scripts/capture-pcap.sh`). Não suporta pcapng.

### Execução de referência

`<a preencher após execução real — este agente não rodou tcpdump/docker
compose de ponta a ponta neste ambiente; os números abaixo precisam ser
substituídos pela primeira execução real do protocolo acima>`

- Broker plain: arquivo `______`, entropia `______` bits/byte, classificação `______`.
- Broker secure: arquivo `______`, entropia `______` bits/byte, classificação `______`.

---

## Uso de `scripts/run-experiment.sh` (Track A — injeção)

Ver cabeçalho do próprio script para o uso detalhado. Resumo: o script faz
login, inicia uma run (`mode=plain|secure`, `attackType=injection`), dispara
`attacker/python/injector.py` contra o broker escolhido, registra o resultado
da injeção como KPI da run (`POST /metrics/runs/:runId/injection-result`) e
encerra a run — mesmo se o injetor falhar (trap `EXIT`).
