# ADR-0003: Caminho de métrica de saúde do broker independente do caminho de captura

## Status
Aceito.

## Contexto
A crítica inicial do usuário ao seu próprio plano identificou um risco metodológico
grave: se a mesma aplicação (NestJS) que grava a telemetria capturada também for a fonte
das métricas de saúde do broker durante o Track B (DoS), um ataque de flooding pode
saturar o caminho de escrita da aplicação antes mesmo de o broker degradar de fato —
fazendo o experimento medir o gargalo do próprio software de observação, não a
resistência real do broker.

## Decisão
As métricas de saúde do broker/host (CPU, RAM, conexões, file descriptors) são
coletadas exclusivamente por **telegraf + cAdvisor**, escrevendo direto no InfluxDB
(measurement `broker_metrics`), sem qualquer dependência do `nestjs-api` estar no ar ou
responsivo. O `nestjs-api`/`capture` continua ativo durante o Track B apenas para
reportar a experiência do usuário final (latência/perda ponta-a-ponta) como métrica
complementar — explicitamente aceitável que essa métrica complementar degrade junto com
o broker, pois ela não é a fonte de verdade científica sobre a saúde do broker.

## Alternativas descartadas
- **Uma única fonte de métrica (o próprio NestJS) para tudo**: era a proposta original
  do usuário; rejeitada justamente pelo risco de mascarar a falha real do broker atrás
  da falha do app.
- **Desligar completamente o NestJS durante o Track B**: eliminaria qualquer risco de
  contaminação, mas descartaria o KPI legítimo de "latência/perda percebida pelo usuário
  final" — que é um dado científico relevante e diferente do KPI de saúde do broker.
  Confirmado com o usuário que ambas as métricas (saúde do broker via telegraf, e
  experiência do usuário via NestJS) são desejadas, desde que a fonte de saúde do broker
  nunca dependa do NestJS.

## Consequências
- Dois caminhos de escrita distintos para o InfluxDB: `telemetry`/`capture_meta`
  (via `nestjs-api`) e `broker_metrics` (via telegraf) — nunca devem ser fundidos no
  mesmo pipeline de escrita.
- Qualquer dashboard ou análise que apresente `broker_metrics` como "medido pelo NestJS"
  está descrevendo a arquitetura errada — a fonte é sempre telegraf/cAdvisor.
- Validar esse caminho independente é um critério de aceite explícito do Track B
  (ver `docs/specs/track-b-availability-dos.md`).
