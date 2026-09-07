# Track A — Confidencialidade & Integridade

## Problem Statement

Quem opera um deployment MQTT sem TLS/autenticação não tem como saber, sem um testbed
controlado, o quão trivial é para um terceiro (a) ler toda a telemetria publicada e
(b) forjar leituras que o sistema aceita como legítimas. Sem números concretos —
cobertura de captura, legibilidade de payload, taxa de sucesso de injeção — a afirmação
"MQTT plain é inseguro" fica no campo da opinião, não da evidência reproduzível que a IC exige.

## Solution

Um subscriber malicioso (o próprio módulo `capture`) assina o wildcard `#` no broker plain
e demonstra, ao vivo, que captura toda a telemetria em texto puro. Um publisher não
autenticado injeta leituras forjadas no mesmo tópico do sensor legítimo, e o dashboard
mostra que não há como diferenciá-las das reais. O mesmo experimento é repetido contra o
broker secure (MQTTS + auth), que deve recusar ambos, servindo de grupo de controle.

## User Stories

1. Como pesquisador da IC, quero conectar um subscriber ao broker plain com wildcard `#`,
   para comprovar que qualquer terceiro pode ouvir toda a telemetria sem autorização.
2. Como pesquisador, quero ver o percentual de mensagens publicadas que foram efetivamente
   capturadas pelo subscriber malicioso, para calcular o KPI de cobertura de interceptação.
3. Como pesquisador, quero visualizar o payload cru capturado no broker plain, para
   comprovar que ele trafega em texto legível (não cifrado).
4. Como pesquisador, quero repetir a mesma captura contra o broker secure sem apresentar
   certificado/credencial válida, para comprovar que o subscriber é recusado no CONNECT.
5. Como pesquisador, quero comparar um pcap do tráfego plain com um pcap do tráfego secure,
   para comprovar por entropia que o payload secure é ilegível (ciphertext).
6. Como pesquisador, quero medir o tempo entre o subscribe malicioso e a primeira mensagem
   capturada, para reportar o KPI de tempo até primeira captura.
7. Como pesquisador, quero publicar uma mensagem forjada no mesmo tópico do sensor
   legítimo no broker plain, para comprovar que o sistema aceita leituras não autenticadas.
8. Como pesquisador, quero que o dashboard exiba a mensagem forjada misturada com as
   legítimas, sem sinalização de origem, para demonstrar a falta de integridade no plain.
9. Como pesquisador, quero repetir a injeção contra o broker secure sem credencial válida,
   para comprovar que é rejeitada por falha de autenticação/autorização.
10. Como pesquisador, quero que cada execução do fluxo A (captura ou injeção, plain ou
    secure) seja registrada como uma run com `run_id` próprio, para poder analisar os
    resultados posteriormente sem misturar execuções.
11. Como pesquisador, quero uma view "Interceptação" no dashboard que mostre os payloads
    capturados brutos, para ter uma evidência visual direta da vulnerabilidade.
12. Como pesquisador, quero uma view "Injeção" que marque visualmente mensagens
    forjadas vs reais (quando isso for detectável, ex: no modo de demonstração), para
    ilustrar o contraste entre plain e secure.
13. Como usuário do dashboard legítimo (persona secundária), quero que, no broker secure,
    minha telemetria não seja exposta a subscribers não autorizados, para confiar no sistema.
14. Como pesquisador, quero que o KPI de taxa de sucesso de injeção seja calculado
    automaticamente (mensagens forjadas aceitas / mensagens forjadas enviadas), para não
    depender de contagem manual.

## Implementation Decisions

- O subscriber malicioso é o próprio módulo `capture` do NestJS — não é uma ferramenta
  externa separada; a plataforma É a prova da vulnerabilidade.
- `capture` assina no broker através de um seam de porta (`MqttSubscriberPort`), com dois
  adapters possíveis: um para o broker plain, outro para o broker secure (TLS + credenciais).
  Trocar de alvo é uma troca de adapter, nunca uma reescrita do módulo.
- Toda mensagem capturada é normalizada e gravada no InfluxDB via `TelemetrySinkPort`,
  taggeada com `run_id`, `sensor_id`, `broker` (plain|secure) e `source` (legit|injected
  quando essa distinção for conhecida pelo experimento).
- O publisher malicioso de injeção é um componente separado (fora do NestJS) que conecta
  como cliente MQTT comum e publica no tópico do sensor legítimo — sem necessidade de
  nenhuma alteração no broker ou no módulo `capture` para o ataque funcionar no plain.
- A distinção "legit vs injected" no dashboard, quando exibida, vem de metadado da run
  (o experimento sabe que injetou), não de uma heurística de detecção do sistema — o
  ponto é justamente mostrar que o sistema não teria como diferenciar sozinho.
- Verificação de legibilidade de payload (pcap) é um passo de captura de pacotes externo
  ao NestJS, conduzido durante a run e associado ao mesmo `run_id` por timestamp/anotação manual.
- O grupo de controle (broker secure) reusa a mesma lógica de `capture` e do publisher
  malicioso, apenas trocando o adapter/credenciais — nenhuma lógica condicional de
  "modo plain vs secure" deve vazar para dentro da lógica de negócio do módulo.

## Testing Decisions

- Bons testes aqui validam comportamento observável, não a implementação do adapter:
  "dado um broker plain com N mensagens publicadas, o subscriber malicioso reporta
  cobertura de captura ≥99%" — não "o método X foi chamado Y vezes".
- `capture` deve ser testável com um broker MQTT fake/in-memory por trás do seam
  `MqttSubscriberPort`, sem precisar de um Mosquitto real rodando — isso é o motivo de
  existir o seam.
- Testes de integração (com Mosquitto real em container, plain e secure) verificam os
  critérios de aceite fim-a-fim: cobertura de captura, rejeição de subscriber não
  autenticado no secure, aceitação/rejeição de injeção.
- A verificação de legibilidade de payload por pcap é um teste manual/documentado no
  protocolo de experimento, não um teste automatizado (depende de captura de pacotes real).
- Prior art: nenhum ainda — este é o primeiro módulo do projeto. Este spec estabelece o
  padrão de teste (seam + fake para unit, container real para integração) que os módulos
  seguintes devem seguir.

## Out of Scope

- Detecção automática de injeção/anomalia (o sistema não tenta identificar mensagens
  forjadas sozinho — isso demonstraria uma mitigação que foge do escopo desta IC).
- Ataques de replay ou man-in-the-middle ativo (modificação de mensagens em trânsito) —
  Track A cobre apenas eavesdropping passivo e injeção direta de publish.
- Qualquer criptografia customizada — TLS é sempre a configuração padrão do Mosquitto.

## Further Notes

Este é o track que também serve como demonstração viva da plataforma: o módulo `capture`
não é só instrumentação de teste, é o artefato que prova a vulnerabilidade A1. Isso deve
ficar explícito na UI (o dashboard não deveria fingir ser "só" um painel de monitoramento
neutro — a view "Interceptação" é o produto científico deste track).
