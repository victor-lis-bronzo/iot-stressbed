# ADR-0012: o api dispara os ataques chamando um runner HTTP interno do attacker

## Status
Aceito.

## Contexto
O disparo de ataques era só por terminal (`scripts/run-experiment.sh`): o
pesquisador exportava credenciais e colava um comando. A tela `/ataques` só montava
esse comando, e a injeção (Track A) nem tinha tela. O motivo registrado para isso era
real: o `nestjs-api` não pode executar o container `attacker` sem acesso ao Docker, e
duas fontes (botão e script) disputando a run ativa corrompem os KPIs ([[ADR-0006]]).

O objetivo é que o pesquisador dispare um ataque com um clique, sem abrir terminal,
sem abrir mão da run única nem dar ao api o controle do daemon Docker.

## Decisão
O **api orquestra** a run e chama o `attacker` por **HTTP na rede interna**:

```text
POST /experiments/runs/launch  (api, JWT)
  1. valida os params e inicia a run   -> 409 se já há uma ativa
  2. POST http://attacker:8080/run     -> runner executa o script como subprocesso
  3. grava o KPI do resultado          -> MetricsService.record<Track>Result
  4. encerra a run                     -> RUN_STOPPED calcula os KPIs derivados
```

- O `attacker` passa a rodar `python/runner.py` (stdlib, sem dependência nova) em vez
  de `sleep infinity`. Escuta em `0.0.0.0:8080` com `expose`, **nunca `ports`**: só a
  `stressbed-net` o alcança, não o host nem a LAN do laboratório.
- O runner não decide nada: só executa o que o api manda. A run ativa continua tendo
  uma única fonte, o api ([[ADR-0006]]), então o `attacker` segue sem disparar nada
  por conta própria no `docker compose up`.
- Segurança do runner: `attackType` e `mode` contra listas fechadas; `args` como
  lista (sem shell, sem `split`); allowlist de flags por ataque. As flags de conexão
  (`--host`, `--port`, `--username`, `--password`, `--target`) são do runner, nunca do
  chamador — o atacante não herda credencial nenhuma. Um ataque por vez no container
  (lock), defesa em profundidade além da run única.
- O ataque roda como **subprocesso**: um crash ou OOM dele não derruba o runner, e os
  limites de cpuset/memória/pids do container `attacker` ([[ADR-0004]]) continuam
  valendo.
- O orquestrador vive num módulo próprio (`attacks`), não no `ExperimentsModule`:
  `MetricsModule` já importa `ExperimentsModule`, então pôr o orquestrador lá
  criaria dependência circular.
- A run é sempre encerrada (`finally`), mesmo se o runner falhar ou recusar o pedido,
  como o `trap EXIT` do script: uma run presa como ativa bloquearia as seguintes.

## Alternativas descartadas
- **api com acesso ao `docker.sock` (direto ou via socket proxy):** replicaria o
  `docker compose exec`, mas dá a um serviço exposto na porta 3000 o controle do
  daemon. Superfície grande demais para um ganho que o HTTP interno entrega sem isso.
- **Runner por tópico MQTT de controle:** acopla o canal de controle ao broker que o
  experimento está estressando; um flood derrubaria justamente o comando.
- **Manter só o CLI e melhorar a tela:** não atende ao pedido de não abrir terminal.
- **Botão e script com lógicas separadas:** dois caminhos que podem divergir; o script
  passa a ser cliente do mesmo endpoint (entrega separada).

## Consequências
- O `attacker` vira um serviço de verdade: `restart: unless-stopped` e healthcheck
  (`GET /health`), em vez de `restart: "no"` e container ocioso. O comentário antigo
  ("sem restart para não mascarar o resultado") deixa de valer: um ataque que falha
  não derruba o container, o resultado vem no JSON e no exit code.
- Há uma superfície HTTP nova, só interna e com allowlist; o `/launch` exige JWT como
  o resto da API.
- O `/launch` responde `202` na hora e o ataque roda em background; o progresso é
  acompanhado por `GET /experiments/runs/active` e `GET /metrics/runs/:runId` (o
  dashboard já faz polling disso).
- Se o api for reiniciado no meio de um ataque, a run fica ativa até alguém encerrá-la
  (`POST /experiments/runs/stop`, já exposto na tela). Mesmo comportamento de quando o
  script era interrompido.
- `docker compose exec attacker python ...` continua funcionando para depuração, mas
  fora de uma run corrompe os KPIs, como já era.
- A atribuição das métricas do broker a cada run (antes feita recriando o Telegraf com
  o `RUN_ID`) não podia continuar: o api não tem Docker para recriá-lo. Passou a ser
  por janela de tempo, no [[ADR-0013]].
