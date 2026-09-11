# Execução Gerenciada dos Scripts do Attacker (Fase 4)

## Problem Statement

O container `attacker` já é 100% agnóstico de SO — os quatro scripts (`injector.py` de
Track A; `connection_flood.py`, `message_flood.py`, `malformed_payload.py` de Track B)
rodam em Python 3.12 dentro do container, resolvem o CA via `ATTACKER_CA_PATH` e nunca
dependem do host. Mas o disparo em si continua manual: `AttackForm.tsx` só monta a string
do comando `./scripts/run-experiment.sh <track> <mode> -- <flags>` e oferece um botão
"Copiar" — o pesquisador ainda precisa colar isso num terminal e rodar
`scripts/run-experiment.sh` (que por sua vez faz `docker compose exec -T attacker python
<script> ...`) manualmente. O próprio componente documenta a razão: "não existe hoje um
caminho seguro para o NestJS executar o container `attacker` sem arriscar duas fontes
disputando a mesma run ativa (ADR-0006)".

Essa dor não é a dockerização (já resolvida) — é a falta de um caminho do backend para
disparar/interromper o `exec` do container em nome da run já criada, e de um toggle no
frontend que substitua o copiar-e-colar.

## Solution

Um novo endpoint no backend (módulo `experiments` ou um módulo `attacks` dedicado) que
recebe o mesmo par `(track, mode, args)` hoje montado pelo `AttackForm.tsx`, mas que passa
a executar o `docker compose exec -T attacker python <script> --target <mode> <args>`
ele mesmo (via `child_process`, no mesmo padrão hoje só usado por `run-experiment.sh`),
em vez de devolver a string para o usuário copiar. O `AttackForm.tsx` troca o botão
"Copiar" por um toggle "Iniciar ataque" / "Parar ataque" que chama esse endpoint e reusa o
polling já existente (`useActiveRun`) para refletir o estado. O CLI (`run-experiment.sh`)
continua existindo e documentado como caminho avançado/offline (ex.: quando a API não
estiver acessível), mas deixa de ser o único caminho.

## User Stories

1. Como pesquisador, quero clicar em um botão "Iniciar ataque" na tela `/ataques` e ver o
   ataque (Track A ou B) começar a rodar contra o broker escolhido, sem copiar nenhum
   comando nem abrir um terminal.
2. Como pesquisador, quero um botão "Parar ataque" que interrompa o processo em execução
   dentro do container `attacker` e finalize a run, para casos em que o ataque trava ou eu
   quero abortar antes do fim previsto.
3. Como pesquisador, quero que, enquanto uma run estiver ativa (disparada pela UI ou pelo
   CLI), o formulário continue bloqueado exatamente como hoje (ADR-0006), para nunca ter
   duas execuções do `attacker` disputando a mesma run.
4. Como pesquisador, quero que o resultado do ataque (o JSON de stdout dos scripts) chegue
   à tela pelo mesmo caminho que já existe hoje (`AttackResult`/`AttackHistory`), sem
   precisar de uma nova forma de consulta.
5. Como desenvolvedor, quero que o disparo via CLI (`run-experiment.sh`) continue
   funcionando sem alteração, documentado como via avançada, para não quebrar o fluxo hoje
   usado em automação/scripts de terminal.

## Implementation Decisions

- **Execução via `child_process` chamando `docker compose exec -T attacker ...`** — mesmo
  comando que `run-experiment.sh` já usa hoje, só que disparado pelo próprio NestJS em vez
  de por um script shell externo. Não introduz `dockerode`/Docker Engine API nesta spec;
  isso fica registrado como alternativa a avaliar na implementação, não uma decisão já
  fechada (ver Out of Scope).
- **Reaproveita o singleton de run da ADR-0006** — o novo endpoint só inicia o `exec`
  depois de criar a run via o mesmo fluxo de `POST /experiments/runs/start` já existente
  (mesma validação de conflito); não introduz uma segunda fonte de verdade sobre "qual run
  está ativa".
- **Um processo gerenciado por run ativa** — o backend guarda a referência do processo
  (`ChildProcess`) disparado enquanto a run correspondente estiver ativa; o endpoint de
  "parar" mata esse processo (`SIGTERM`, com fallback `SIGKILL` após timeout) e só então
  chama `POST /experiments/runs/stop`, preservando a ordem já usada por
  `scripts/run-experiment.sh` (stop sempre por último, equivalente ao `trap stop_run EXIT`
  do script atual).
- **Captura de stdout/stderr idêntica ao script atual** — stdout é o JSON de resultado
  (postado em `/metrics/runs/:runId/:attackType-result`, endpoint que já existe), stderr é
  log de progresso; a nova via não precisa reinterpretar isso, só automatizar o que
  `run-experiment.sh` já faz linha a linha.
- **Exit code**: preservar a mesma semântica já documentada em `run-experiment.sh` —
  `injection` usa 0/1 para afirmar a assimetria plain aceita/secure rejeita; as 3 tracks
  de Track B praticamente sempre retornam 0 (falha fica no JSON, não no exit code). O
  endpoint não deve reinterpretar isso — só repassar o resultado.
- **`run-experiment.sh` continua existindo** como via avançada/offline, documentada no
  `track-b-guide.md` — não é substituída, só deixa de ser o único caminho.

## Casos de Borda

- **Usuário fecha a aba com o ataque em execução**: o processo do lado do backend não deve
  depender da conexão HTTP/WS do frontend permanecer aberta — precisa sobreviver ao
  fechamento da aba e ser encerrado apenas via `stop` explícito ou pelo fim natural do
  script.
- **Processo trava e nunca retorna JSON**: precisa de um timeout configurável (matar o
  processo e marcar a run como finalizada com erro) para não deixar a run ativa presa
  indefinidamente (o que bloquearia qualquer novo disparo pela ADR-0006).
- **Cliques duplicados/rápidos no toggle**: o endpoint de start deve rejeitar uma segunda
  chamada enquanto já existe um processo gerenciado para a run ativa (mesmo guard que hoje
  rejeita uma segunda run concorrente).
- **Container `attacker` não está `up`**: o `docker compose exec` falha imediatamente; o
  endpoint deve devolver um erro claro em vez de deixar a run presa em "ativa" sem processo
  de fato rodando.
- **Ataque disparado pela UI e usuário também roda `run-experiment.sh` manualmente ao mesmo
  tempo**: continua coberto pela ADR-0006 (segunda tentativa de start é rejeitada como
  conflito) — nenhuma lógica nova de exclusão é necessária além da já existente.

## Critérios de Aceite

1. É possível iniciar um ataque (Track A ou B) pela tela `/ataques` sem copiar nenhum
   comando, e o resultado aparece em `AttackResult`/`AttackHistory` como acontece hoje via
   CLI.
2. É possível parar um ataque em andamento pela mesma tela, e a run correspondente é
   finalizada corretamente (sem ficar presa como ativa).
3. Disparar `scripts/run-experiment.sh` manualmente continua funcionando sem alteração.
4. Tentar iniciar um segundo ataque enquanto um já está ativo (via UI ou CLI) é rejeitado
   com erro de conflito, nunca sobrescreve a run em andamento.

## Out of Scope

- Migrar para Docker Engine API/`dockerode` — a decisão de implementação inicial é reusar
  `docker compose exec` via `child_process`; trocar por uma lib de orquestração fica para
  uma iteração futura, se justificada.
- Paralelismo entre runs (Track A e B simultâneos, ou dois ataques de Track B ao mesmo
  tempo) — ADR-0006 continua valendo integralmente; esta spec não a reabre.
- Streaming ao vivo de stdout/stderr do ataque para a UI (ex. via WebSocket) — o resultado
  continua chegando como hoje, ao final da execução; live-tailing de log é melhoria
  futura, não requisito desta fase.
- Nova autenticação/autorização — reusa o guard de auth já existente nas rotas de
  `experiments`/`metrics`.

## Further Notes

Ver `docs/adr/0006-single-active-run.md` (singleton de run, já resolve o "qual run está
ativa") e o comentário em `apps/web/components/AttackForm.tsx` (razão registrada hoje para
o disparo continuar manual). `scripts/run-experiment.sh` é a referência de comportamento a
replicar no backend — login/start/exec/stop/registro de KPI na mesma ordem, só que
disparado a partir de uma requisição HTTP em vez de um script de terminal.
