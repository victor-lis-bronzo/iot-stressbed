# Infraestrutura & Isolamento de Recursos

## Problem Statement

Rodar broker-alvo e ferramentas de ataque na mesma máquina que orquestra o experimento é
arriscado: sem limites explícitos, um flooding descontrolado pode saturar CPU/RAM/PIDs do
host inteiro, derrubando o próprio ambiente de observação (Grafana, InfluxDB, o dashboard)
junto com o broker — invalidando o experimento e, na prática, travando a máquina do
pesquisador no meio de uma coleta de dados.

## Solution

Toda a topologia sobe via `docker-compose` numa rede bridge isolada. Broker (plain e
secure) e o container atacante recebem limites rígidos de CPU, memória e PIDs via cgroups
nativos do Docker. Núcleos de CPU são reservados para o host e para o restante da stack
de observação, nunca cedidos integralmente ao broker ou ao atacante.

## User Stories

1. Como pesquisador, quero subir toda a stack (brokers, Postgres, InfluxDB, Grafana,
   telegraf, NestJS, Next.js) com um único `docker-compose up`, para reduzir erro manual
   de setup entre execuções.
2. Como pesquisador, quero que o container do broker plain rode com `--cpuset-cpus`,
   `--cpus`, `--memory` e `--pids-limit` fixos, para que qualquer falha observada seja
   atribuível ao ataque, não a variação de recursos do host.
3. Como pesquisador, quero que o `--memory-swap` do broker seja igual ao `--memory`
   (sem colchão de swap), para que o ponto de OOM seja determinístico e não mascarado
   por troca de página em disco.
4. Como pesquisador, quero que o container `attacker` também tenha limites de CPU/RAM,
   para que um flooding mal configurado não consuma recursos além do que o experimento
   pretende gastar.
5. Como pesquisador, quero reservar núcleos de CPU explicitamente para o host e para a
   stack de observação (Postgres, InfluxDB, Grafana, telegraf), para garantir que o
   monitoramento continue funcionando mesmo com o broker sob estresse máximo.
6. Como pesquisador, quero verificar via `docker stats`, rodado fora dos containers
   limitados, que o host permanece responsivo durante um ataque, para ter prova de que
   o isolamento funcionou (e não apenas assumir que funcionou).
7. Como pesquisador, quero que os certificados TLS do broker secure sejam gerados por um
   script (`gen-certs.sh`), para não depender de geração manual sujeita a erro antes de
   cada rodada de experimentos que envolva o grupo de controle.
8. Como pesquisador, quero que a rede Docker seja isolada (bridge dedicada), para que o
   tráfego do experimento não vaze para outras redes/containers da minha máquina.
9. Como desenvolvedor, quero um arquivo `.env.example` documentando todas as variáveis de
   ambiente necessárias (portas, credenciais do Postgres/InfluxDB/Grafana, limites de
   recurso), para que qualquer pessoa consiga reproduzir o ambiente do zero.
10. Como pesquisador, quero que os limites de recurso sejam parametrizáveis (via env ou
    arquivo de config), para poder rodar variações do experimento com diferentes tetos de
    CPU/RAM sem editar o `docker-compose.yml` diretamente a cada vez.

## Implementation Decisions

- Um único `docker-compose.yml` na raiz do projeto orquestra: `mosquitto-plain`,
  `mosquitto-secure`, `postgres`, `influxdb`, `grafana`, `telegraf`, `nestjs-api`,
  `nextjs-web`, `attacker` — todos na rede `stressbed-net` (bridge dedicada).
- Limites de recurso aplicados via as chaves nativas do Compose equivalentes a
  `--cpuset-cpus`, `--cpus`, `--memory`, `--memory-swap` (igual a `--memory`) e
  `--pids-limit`, definidos por container e sobrescritíveis via variáveis de ambiente.
- Núcleos 0-1 (ou os dois primeiros disponíveis) reservados implicitamente ao não
  incluí-los no `cpuset` de broker e atacante — host, Docker daemon e stack de observação
  competem só por esses núcleos, nunca pelos dedicados ao experimento.
- Certificados TLS do broker secure gerados por `scripts/gen-certs.sh` (CA local +
  certificado de servidor), montados como volume no container `mosquitto-secure`.
- Configuração de autenticação/ACL do broker secure via arquivo de senha e ACL nativos do
  Mosquitto, versionados como template (sem credenciais reais commitadas).
- Variáveis sensíveis (senhas de Postgres/InfluxDB/Grafana, credenciais MQTT) vivem em
  `.env` (gitignored), documentadas em `.env.example` sem valores reais.
- `attacker` sobe sob demanda (perfil separado no compose ou flag de serviço), para não
  competir por recursos durante o baseline (Fase 1) quando nenhum ataque está em curso.

## Testing Decisions

- Bom teste aqui é validar comportamento observável de infraestrutura, não a sintaxe do
  YAML: "com os limites configurados, o container do broker não ultrapassa X MB de RAM
  sob carga sintética" é verificável via `docker stats, não via inspeção estática.
- Teste manual documentado no protocolo de experimento: subir a stack, disparar uma carga
  sintética conhecida contra o broker, confirmar via `docker stats` fora dos containers
  limitados que o host permanece responsivo (isso não é automatizável de forma barata em
  CI e é aceitável que seja um passo de checklist manual antes de cada bateria de testes).
- `scripts/gen-certs.sh` e `scripts/run-experiment.sh` devem ter um smoke test simples
  (rodam sem erro, geram os arquivos esperados) — não precisam de teste de unidade formal,
  são scripts de shell utilitários.
- Não há teste automatizado para "o experimento levou o broker à falha" — isso é o próprio
  resultado científico sendo coletado, não uma asserção de regressão.

## Out of Scope

- Orquestração multi-host/Kubernetes — tudo roda numa única máquina via Compose.
- Hardening de produção do Mosquitto além do necessário para o grupo de controle
  (TLS + auth básica) — não é objetivo simular um deployment production-grade completo.
- Rotação automática de certificados — os certificados são gerados uma vez por ambiente
  de desenvolvimento/experimento.

## Further Notes

O isolamento de recursos é o requisito não-funcional mais crítico do projeto: sem ele, o
Track B não tem validade científica (não dá para distinguir "o broker caiu" de "a máquina
inteira travou"). Qualquer mudança nos limites de recurso deve ser tratada com o mesmo
rigor de revisão que uma mudança de lógica de negócio.
