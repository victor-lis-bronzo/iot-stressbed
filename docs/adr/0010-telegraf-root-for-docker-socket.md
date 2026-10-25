# ADR-0010: telegraf roda como root no container para ler o socket do Docker

## Status
Aceito.

## Contexto
O `telegraf` coleta `broker_metrics` pelo socket do Docker ([[ADR-0003]]), e esse
caminho independente é a fonte de todos os KPIs de recurso da Track B
(`cpu_usage_percent_avg`, `time_to_degradation_ms`, `broker_survived`).

O compose rodava o processo como `telegraf:${TELEGRAF_DOCKER_GID:-0}`: o operador
precisava descobrir o GID do grupo dono do socket (`stat -c %g
/var/run/docker.sock`) e exportá-lo. O default `0` só vale onde o socket é
`root:root` (Docker Desktop). No Ubuntu o grupo é `docker`, com GID 127 na máquina
de teste. Sem o valor certo o `telegraf` loga `permission denied`, a série fica
vazia e as colunas de KPI saem em branco — e o healthcheck (`pgrep telegraf`)
continuava `healthy`, então a falha era silenciosa. Isso contraria o bootstrap
único do [[ADR-0008]]: o `docker compose up` puro não entregava o testbed
completo na máquina do laboratório.

## Decisão
- O processo roda como root **dentro do container** (`user: ${TELEGRAF_USER:-0:0}`).
  O socket continua montado `:ro`, e o container não tem portas publicadas nem
  `privileged`.
- O `entrypoint` da imagem é sobrescrito (`["telegraf"]`). O `/entrypoint.sh`
  oficial, quando roda como root, faz `setcap` (ICMP e portas privilegiadas, que
  não usamos) e `su-exec telegraf`, o que desfaria a decisão.
- `TELEGRAF_USER` permanece como override para o modo menos privilegiado
  (`telegraf:<GID do socket>`), sem precisar editar o compose.
- O healthcheck passa a exigir também `[ -r /var/run/docker.sock ]`: a dependência
  fica coberta, e um socket ilegível vira `unhealthy` em vez de silêncio.

## Alternativas descartadas
- **GID por `.env` (o que existia):** exige um passo manual específico do host e
  falha em silêncio quando esquecido.
- **Wrapper (`up.sh`/Makefile) que detecta o GID:** quebra o `docker compose up`
  puro, que é o contrato do [[ADR-0008]]; quem rodar o comando direto continua com
  o defeito.
- **Socket proxy (ex.: `tecnativa/docker-socket-proxy`):** reduz a superfície, mas
  acrescenta um container e uma rede só para ler contadores, desproporcional ao
  ambiente de pesquisa isolado atrás da bridge `stressbed-net`.
- **Só falhar alto e documentar:** deixa o laboratório com um passo manual antes do
  primeiro experimento válido.

## Consequências
- Processo root no container do `telegraf`, mitigado pelo mount read-only do socket
  (o daemon não aceita escrita por ele) e pelo isolamento de rede. Ainda assim,
  quem controla o `telegraf` lê informações de todos os containers do host.
- **Runs coletadas antes desta correção, numa máquina Ubuntu sem
  `TELEGRAF_DOCKER_GID` correto, têm os KPIs de recurso vazios** (série
  `broker_metrics` ausente). Não há como recuperá-los; as runs usadas na análise
  precisam ser refeitas.
- `scripts/run-experiment.sh` recria o `telegraf` a cada run para propagar o
  `RUN_ID`; com o default novo, essa recriação já nasce com acesso ao socket.
- O mesmo princípio vale para os certificados: `scripts/gen-certs.sh` devolve a
  posse dos arquivos ao dono do diretório montado quando roda como root no
  container `certs`, para que o pesquisador leia as chaves sem `sudo`.
- `infra/mosquitto/secure/certs/` agora existe no clone (via `.gitkeep`, com o resto
  ignorado pelo `.gitignore`). Sem isso o Docker criaria o bind mount como
  `root:root` e o `chown` do `gen-certs.sh`, que devolve a posse ao dono do
  diretório, não teria a quem devolver.
