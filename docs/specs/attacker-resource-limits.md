# Limites de Recurso do Container Attacker

## Problem Statement

O ADR-0004 decidiu que o container `attacker` roda com limites nativos de cgroups
(CPU, RAM, PIDs), pelo mesmo motivo que os brokers: sem isso, um flooding descontrolado
do Track B pode saturar o host inteiro, tornando impossível distinguir "o broker caiu"
de "a máquina toda travou" — o que invalida cientificamente o experimento. Os specs
`infra-resource-isolation.md` e `track-b-availability-dos.md` já capturam essa decisão
em nível arquitetural, e o `.env.example` já reserva os valores numéricos
(`ATTACKER_CPUSET`/`CPUS`/`MEMORY`/`MEMSWAP`/`PIDS`).

O que falta é um documento único e focado que amarre esses valores a um bloco de
configuração pronto para uso e a um checklist de verificação executável. Hoje quem for
implementar o serviço `attacker` (Fase 4, per `docs/tasks.md`) só tem referências
espalhadas em três documentos diferentes — um dos quais (`docs/test-plans/fase-0.5-infra.md`)
ainda rotula esse trabalho futuro como "Fase 3", inconsistente com a numeração de fases
já usada no backlog atual.

## Solution

Um spec dedicado que: (1) fixa os 5 valores de limite do `attacker` e a justificativa de
cada um relativo aos limites já aplicados aos brokers; (2) fornece o bloco de
configuração de cgroups pronto para colar no `docker-compose.yml` quando o serviço
`attacker` for criado, seguindo exatamente o padrão já usado em
`mosquitto-plain`/`mosquitto-secure`; (3) define um checklist de verificação executável
(`docker stats`, host responsivo sob flood sintético e depois real) que complementa e
substitui a nota de uma linha hoje existente em `fase-0.5-infra.md`; (4) corrige a
inconsistência de rotulação "Fase 3" → "Fase 4" nos documentos que a mencionam.

## User Stories

1. Como pesquisador, quero que o container `attacker` tenha limites de CPU/RAM/PIDs
   definidos antes de eu escrever a primeira linha do serviço no `docker-compose.yml`,
   para não precisar decidir esses números sob pressão no meio da implementação da
   Fase 4.
2. Como pesquisador, quero entender por que o `attacker` recebe mais memória/CPU/PIDs
   que cada broker individual, para confiar que os números não foram escolhidos
   arbitrariamente.
3. Como desenvolvedor implementando a Fase 4, quero um bloco de configuração de cgroups
   pronto para colar no `docker-compose.yml`, para não precisar redescobrir o padrão de
   chaves já usado nos brokers.
4. Como pesquisador, quero um checklist único e executável para verificar que os
   limites do `attacker` realmente contêm o consumo de recursos, em vez de confiar que
   "deveria funcionar" só porque o broker já foi validado.
5. Como pesquisador, quero repetir o mesmo checklist duas vezes — uma com carga
   sintética (sem broker real sob ataque) e outra com um ataque real de Track B —, para
   separar "os limites funcionam em teoria" de "os limites seguram sob o ataque real que
   vou rodar".
6. Como pesquisador, quero que este documento aponte de volta para o ADR-0004 em vez de
   repetir a decisão arquitetural, para não ter duas fontes de verdade divergentes sobre
   por que os limites existem.
7. Como pesquisador, quero que a inconsistência de rotulação "Fase 3" vs "Fase 4" seja
   corrigida nos documentos que a mencionam, para não confundir quem for implementar o
   `attacker` mais tarde.
8. Como pesquisador, quero que o `docker stats` seja rodado fora dos containers
   limitados durante a verificação, para ter prova — não suposição — de que o host
   permanece responsivo.
9. Como pesquisador, quero que o `pids_limit` do `attacker` seja verificado
   especificamente contra um connection flood (não só contra uso de CPU/RAM), já que é
   esse tipo de ataque que mais rapidamente esgota PIDs.
10. Como pesquisador, quero que o `memswap_limit` do `attacker` seja igual ao
    `mem_limit`, para que o ponto de OOM do próprio atacante também seja determinístico
    — o mesmo raciocínio já aplicado aos brokers no ADR-0004.
11. Como desenvolvedor, quero que este documento não dependa de o serviço `attacker` já
    existir no `docker-compose.yml`, para poder ser escrito e revisado antes de a
    Fase 4 começar.
12. Como pesquisador, quero que o backlog (`docs/tasks.md`) referencie este documento
    diretamente no critério de teste da tarefa "Validar isolamento do host sob ataque
    real", em vez de um placeholder genérico, para que a tarefa tenha um critério de
    aceite executável.

## Implementation Decisions

- Este spec vive em `docs/specs/attacker-resource-limits.md`, seguindo o mesmo formato
  já usado pelos demais specs do projeto.
- Os 5 valores de limite (`CPUSET=4,5`, `CPUS=2.0`, `MEMORY=512m`, `MEMSWAP=512m`,
  `PIDS=2048`) são os já reservados no `.env.example` — este spec não os altera, só os
  documenta com a justificativa de cada um relativo aos limites do broker (`256m`/`1.0`
  CPU/`512` PIDs cada): o `attacker` recebe o dobro de memória e PIDs, e o dobro de CPU,
  porque ele *gera* carga (múltiplas conexões/threads simuladas simultâneas) em vez de
  só recebê-la, e um `pids_limit` baixo demais faria o próprio limite de recurso
  interromper o ataque antes de ele atingir o broker-alvo — o que invalidaria a
  medição tanto quanto um host que trava.
- O bloco de configuração de cgroups documentado aqui segue exatamente o padrão de
  chaves já usado em `mosquitto-plain`/`mosquitto-secure` no `docker-compose.yml`
  (`cpuset`, `cpus`, `mem_limit`, `memswap_limit`, `pids_limit`, todos com fallback via
  variável de ambiente). Ele **não é aplicado ao `docker-compose.yml` agora** — o
  serviço `attacker` ainda não existe (sem Dockerfile/imagem, não há em que pendurar o
  bloco); fica documentado aqui para ser colado quando a Fase 4 criar o serviço:
  ```yaml
  cpuset: ${ATTACKER_CPUSET:-4,5}
  cpus: ${ATTACKER_CPUS:-2.0}
  mem_limit: ${ATTACKER_MEMORY:-512m}
  memswap_limit: ${ATTACKER_MEMSWAP:-512m}
  pids_limit: ${ATTACKER_PIDS:-2048}
  ```
- Correção de rótulo "Fase 3" → "Fase 4" em `.env.example` e
  `docs/test-plans/fase-0.5-infra.md`, alinhando com a numeração de fases já usada em
  `docs/tasks.md` (onde o tooling do `attacker` está listado nas Fases 2 e 4, não na 3).
- `docs/tasks.md`: o campo "Teste" da tarefa "Validar isolamento do host sob ataque
  real" (Fase 4) passa a referenciar este spec diretamente em vez do placeholder
  genérico "checklist do protocolo de experimento".

## Testing Decisions

- Todo teste aqui é manual/checklist, não automatizável em CI — mesma decisão já
  tomada em `infra-resource-isolation.md` e `track-b-availability-dos.md` para o
  isolamento de recursos do broker: "o host permanece responsivo" só é verificável
  observando `docker stats` durante uma execução real, não por asserção de unit test.
- Dois momentos de verificação, nessa ordem: (1) carga sintética genérica contra o
  `attacker` isolado, sem broker real envolvido — só para validar que os limites de
  cgroup por si só contêm CPU/RAM/PIDs; (2) ataque real de Track B (connection/message
  flood) rodando `attacker` + broker juntos, confirmando que o host segue responsivo
  enquanto o broker degrada.
- Prior art: reusa o mesmo padrão de verificação já executado e aprovado em
  `docs/test-plans/fase-0.5-infra.md` §5 para os brokers — este spec é o roteiro
  equivalente para quando o `attacker` existir, não uma técnica nova.

## Out of Scope

- Implementação do serviço `attacker` em si no `docker-compose.yml` (Dockerfile,
  imagem, script Python de flooding/injeção) — isso é o próprio trabalho da Fase 4;
  este spec só prepara o terreno de limites de recurso.
- Qualquer script de ataque (connection flood, message flood, payload malformado) —
  coberto por `docs/specs/track-b-availability-dos.md`.
- Ajuste dos valores numéricos de limite do broker (`mosquitto-plain`/`secure`) — já
  decididos e validados em `docs/test-plans/fase-0.5-infra.md` §5.

## Further Notes

Este spec é deliberadamente pequeno porque a decisão arquitetural de fundo já existe
(ADR-0004) — o objetivo aqui é fechar a lacuna operacional entre "decidimos que o
`attacker` vai ter limites" e "aqui está exatamente o que colar e o que testar quando o
`attacker` existir".
