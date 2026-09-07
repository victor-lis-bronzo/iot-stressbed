# ADR-0002: NestJS modular pragmático, ports & adapters só em `capture`

## Status
Aceito.

## Contexto
O usuário considerou clean/hexagonal architecture completa para o backend inteiro,
motivado pelo desejo de aprendizado arquitetural. O projeto é uma IC com escopo e prazo
limitados, e nem todo módulo tem a mesma necessidade de flexibilidade de infraestrutura.

## Decisão
Adotar módulos NestJS convencionais (controller/service/provider, DI nativa) para
`auth`, `sensors`, `experiments`, `metrics`, `realtime` — sem camada extra de
ports/adapters. Reservar a cerimônia completa de ports & adapters (`MqttSubscriberPort`,
`TelemetrySinkPort`) exclusivamente para o módulo `capture`.

## Alternativas descartadas
- **Clean/hexagonal completo em todo o backend**: máximo aprendizado arquitetural, mas
  boilerplate desproporcional para módulos de CRUD simples (`sensors`, `auth`) que não
  precisam trocar de implementação nunca. Risco real de over-engineering numa IC com
  prazo definido.
- **Nenhum seam em lugar nenhum (tudo acoplado direto ao SDK MQTT/Influx)**: inviável
  para `capture` especificamente, porque esse módulo precisa (a) trocar de broker-alvo
  (plain↔secure) como parte do próprio desenho experimental, e (b) ser testável sem
  broker real rodando — um teste de unidade que depende de Mosquitto vivo é lento e frágil.

## Consequências
- `capture` é o único módulo com interfaces de porta e adapters concretos — isso deve
  ficar evidente na estrutura de pastas (`capture/ports/`, `capture/adapters/`).
- Qualquer novo requisito de troca de implementação em outro módulo deve ser avaliado
  caso a caso; não introduzir seams por precaução especulativa nos demais módulos.
- `capture` estabelece o padrão de teste (fake no seam para unit, container real para
  integração) que os specs dos demais módulos referenciam.
