# ADR-0004: Isolamento de recursos via cgroups nativos do Docker

## Status
Aceito.

## Contexto
Broker-alvo e ferramentas de ataque rodam na mesma máquina que orquestra o experimento.
Sem limites explícitos de recurso, um ataque de flooding descontrolado (Track B) pode
saturar CPU/RAM/PIDs do host inteiro, derrubando o próprio ambiente de observação
(Grafana, InfluxDB, dashboard) e travando a máquina do pesquisador no meio da coleta —
o que também invalida cientificamente o experimento (não dá para distinguir "o broker
caiu" de "a máquina toda travou").

## Decisão
Aplicar limites nativos de cgroups do Docker a `mosquitto-plain`, `mosquitto-secure` e
`attacker`: `--cpuset-cpus` (fixa núcleos específicos), `--cpus` (teto de CPU),
`--memory` com `--memory-swap` igual a `--memory` (elimina swap, torna o ponto de OOM
determinístico), e `--pids-limit` (limita threads/processos gerados por conexão). Núcleos
de CPU são reservados fora do `cpuset` do experimento para host + stack de observação
(Postgres, InfluxDB, Grafana, telegraf, nestjs-api), garantindo que o monitoramento
continue funcionando mesmo com o broker sob estresse máximo.

## Alternativas descartadas
- **Rodar sem limites e confiar no bom senso dos parâmetros de ataque**: inviável — o
  próprio objetivo do Track B é levar o broker à falha, então os parâmetros de ataque
  serão, por definição, agressivos o suficiente para arriscar o host sem isolamento.
- **Máquina virtual dedicada por experimento**: isolamento mais forte, mas overhead de
  setup e tempo de provisionamento incompatível com a necessidade de reprodutibilidade
  rápida (`docker compose up` + `run-experiment.sh`) que a IC exige.
- **Rodar o atacante numa segunda máquina física**: mantido como stretch goal opcional
  para maior realismo de caminho de rede, mas não é o modelo padrão — adicionaria
  complexidade de setup para todo experimento, não só para os que precisam desse rigor extra.

## Consequências
- O `docker-compose.yml` fica com blocos de `deploy.resources` (ou equivalente) por
  serviço para broker e atacante, parametrizáveis via `.env`.
- A verificação de que o host permanece responsivo durante um ataque (`docker stats`
  fora dos containers limitados) é um critério de aceite explícito, não uma suposição.
- Qualquer novo tipo de ataque adicionado ao container `attacker` herda os mesmos
  limites de recurso do container — não é possível burlar o isolamento adicionando um
  novo modo de ataque sem também revisar os limites.
