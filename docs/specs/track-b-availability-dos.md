# Track B — Disponibilidade (DoS)

## Problem Statement

Um broker MQTT sem proteção alguma (rate limiting, autenticação, limites de conexão) é
exposto tanto a exaustão de conexões quanto a flooding de mensagens. Sem medir isso de
forma isolada e reproduzível, não dá para responder cientificamente "quanto TLS/auth
custa em overhead" nem "em que ponto exato o broker degrada ou cai" — e sem isolar
metodologicamente a medição do próprio caminho de observação (NestJS/InfluxDB), corre-se
o risco real de medir o gargalo do software de auditoria em vez do broker sob ataque.

## Solution

Um container `attacker` isolado e limitado em recursos dispara três tipos de ataque
(connection flood, message flood, payload malformado/gigante) contra o broker plain e,
com os mesmos parâmetros, contra o broker secure. As métricas de saúde do broker (CPU,
RAM, conexões, latência, perda) são coletadas por um caminho totalmente independente do
NestJS (telegraf/cAdvisor raspando o container por fora), garantindo que o que é medido
é a resistência do broker, não a do software de observação.

## User Stories

1. Como pesquisador, quero disparar um connection flood (milhares de CONNECTs zumbis)
   contra o broker plain, para medir em que ponto ele degrada por exaustão de conexões.
2. Como pesquisador, quero disparar um message flood (PUBLISH em alta taxa) contra o
   broker plain, para medir throughput sustentado antes da degradação.
3. Como pesquisador, quero enviar payloads malformados ou anormalmente grandes ao broker,
   para verificar robustez de parsing/buffer sob entrada adversarial.
4. Como pesquisador, quero repetir os três ataques (B1/B2/B3) com os mesmos parâmetros
   contra o broker secure, para calcular o delta de overhead do TLS sob carga.
5. Como pesquisador, quero que as métricas de CPU/RAM/conexões do broker sejam coletadas
   por um processo (telegraf/cAdvisor) que não passa pelo NestJS, para garantir que a
   medição não é contaminada pelo gargalo do meu próprio software de auditoria.
6. Como pesquisador, quero ver a latência ponta-a-ponta (publisher legítimo → dashboard)
   subir durante o ataque, comparada ao baseline, para quantificar a degradação percebida.
7. Como pesquisador, quero medir a taxa de perda de mensagens (publicadas pelo sensor
   legítimo vs recebidas pelo subscriber) durante o ataque, para quantificar impacto real
   no dado, não só na infraestrutura.
8. Como pesquisador, quero registrar o tempo decorrido até a primeira degradação
   perceptível e até o crash (se ocorrer), para reportar o KPI de tempo até falha.
9. Como pesquisador, quero registrar o tempo de recuperação do broker após o fim do
   ataque, para avaliar resiliência pós-incidente.
10. Como pesquisador, quero que o container atacante rode com limites rígidos de CPU/RAM,
    para garantir que um flooding descontrolado não derrube o host que está rodando o
    próprio experimento.
11. Como pesquisador, quero que o container do broker rode com `cpuset`, `--memory` (sem
    swap) e `--pids-limit` definidos, para que a falha observada seja determinística e
    atribuível ao ataque, não a uma variável de ambiente do host.
12. Como pesquisador, quero verificar, via `docker stats` fora dos containers limitados,
    que o sistema operacional do host permanece responsivo durante todo o ataque, para
    comprovar que o isolamento de recursos funcionou.
13. Como pesquisador, quero disparar cada ataque através de um script único
    (`run-experiment.sh <track> <mode>`), para garantir reprodutibilidade e reduzir erro
    manual entre execuções.
14. Como pesquisador, quero que cada execução de ataque seja uma run com `run_id` próprio,
    taggeada nas métricas do InfluxDB, para poder comparar runs plain vs secure lado a lado.
15. Como pesquisador, quero visualizar no Grafana/console de ataque as métricas subindo em
    tempo real durante o ataque, para acompanhar o experimento enquanto ele acontece.

## Implementation Decisions

- O container `attacker` roda scripts Python (Paho) para connection flood, message flood
  e payload malformado — três modos de operação selecionáveis por parâmetro, não três
  containers separados.
- As métricas de saúde (CPU, RAM, conexões, file descriptors) vêm de telegraf com input
  do Docker stats/cAdvisor, escrevendo diretamente no InfluxDB — este caminho nunca passa
  pelo NestJS nem depende dele estar no ar.
- O NestJS (`capture`, `metrics`, `realtime`) continua ativo durante o Track B apenas para
  fornecer o KPI de latência/perda do lado da aplicação (visão do usuário final) — ele não
  é a fonte de verdade da saúde do broker, é uma métrica complementar e é aceitável que
  degrade junto com o broker (esse é, inclusive, o próprio KPI de latência ponta-a-ponta).
- Isolamento de recursos via flags nativas do Docker/cgroups (`--cpuset-cpus`, `--cpus`,
  `--memory`, `--memory-swap` igual a `--memory` para eliminar swap, `--pids-limit`) —
  aplicado tanto ao broker quanto ao container `attacker`.
- Todo ataque é parametrizado por `run_id`, modo (plain/secure) e tipo de ataque; o
  `experiments` module do NestJS registra o início/fim da run no Postgres e propaga o
  `run_id` como tag nas escritas do InfluxDB (tanto telemetria quanto métricas).
- Todo ataque (B1/B2/B3) é gerado pelo container `attacker` — o ESP32 roda um único
  firmware (`sensor`, publisher legítimo) e nunca é reprogramado para atacar.

## Testing Decisions

- Bons testes aqui validam comportamento observável do sistema sob carga simulada, não
  detalhes internos do flooder: "dado N conexões simultâneas configuradas, o script abre
  N conexões e reporta taxa de sucesso/falha" é testável sem precisar de um broker real
  no limite de falha.
- O parsing de parâmetros do `attacker` (modo, taxa, duração) e a lógica de registro de
  run (`experiments` module) são testáveis com unit tests puros, sem broker nem Docker.
- Testes de integração real (broker + attacker + telegraf, em container) validam que as
  métricas efetivamente chegam ao InfluxDB taggeadas corretamente — mas não tentam
  reproduzir o ponto exato de crash em CI (isso é um experimento manual/controlado, não
  um teste automatizado de regressão).
- Prior art: reusa o padrão de seam estabelecido no spec de Track A/`capture` (fakes para
  unit, containers reais para integração).

## Out of Scope

- Ataques de amplificação distribuída (múltiplas máquinas atacantes reais) — o stretch
  documentado é rodar o atacante numa segunda VM/máquina para realismo de rede, não uma
  botnet distribuída.
- Mitigação automática (rate limiting, fail2ban) no broker — o objetivo é medir a falha,
  não construir a defesa.
- Ataques de camada de rede pura (SYN flood TCP sem handshake MQTT) fora do que o Paho
  expõe — o foco é o protocolo MQTT, não uma ferramenta genérica de DoS de rede.

## Further Notes

O critério de sucesso mais importante deste track não é "o broker caiu" — é "o host
continuou vivo enquanto o broker caía". Se o isolamento de recursos falhar, o experimento
inteiro perde validade científica (você não saberia se mediu o broker ou a máquina).
