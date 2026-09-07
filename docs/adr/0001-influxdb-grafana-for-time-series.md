# ADR-0001: InfluxDB + Grafana para série temporal, Postgres só para estado

## Status
Aceito.

## Contexto
O projeto precisa armazenar dois tipos de dado com naturezas muito diferentes: (a)
estado da aplicação (usuários, sensores registrados, metadados de run) — baixo volume,
transacional; e (b) séries temporais de alta frequência (telemetria capturada e métricas
de saúde do broker sob ataque) — alto volume de escrita, principalmente append-only.
A proposta inicial considerava MongoDB e Firebase para o dado de telemetria.

## Decisão
Usar **InfluxDB + Grafana** para toda a série temporal (telemetria e métricas de
broker/host) e **PostgreSQL** estritamente para estado da aplicação.

## Alternativas descartadas
- **MongoDB**: não é otimizado nativamente para ingestão massiva de séries temporais.
  Sob um ataque de flooding (Track B), o gargalo de I/O do Mongo apareceria antes do
  broker cair, e o experimento acabaria medindo a falha do banco, não a do broker —
  invalidando o objetivo científico.
- **Firebase**: depende de emuladores pesados para rodar localmente e não é feito para
  a carga de escrita deste cenário; também introduz uma dependência de infraestrutura
  externa incompatível com o requisito de isolamento local do testbed.
- **TimescaleDB (extensão do Postgres)**: consideração válida para reduzir o número de
  engines — mas InfluxDB+Grafana é mais turnkey para os dashboards de série temporal que
  o artigo final da IC precisa gerar, e o ecossistema telegraf→InfluxDB→Grafana já é o
  padrão de fato para esse tipo de coleta de métricas de infraestrutura.

## Consequências
- Um engine a mais para orquestrar no `docker-compose` (InfluxDB), mas ganho real de
  throughput de escrita sob carga de flooding.
- Postgres nunca deve receber uma escrita por mensagem de telemetria — qualquer código
  que tentar fazer isso é um sinal de que a fronteira desta decisão foi violada.
