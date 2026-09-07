# Módulo Capture (núcleo científico)

## Problem Statement

Toda evidência científica dos Tracks A e B passa por um único ponto: o componente que
observa o broker e grava o que vê. Se esse componente for acoplado a um broker específico
ou a um único formato de armazenamento, cada troca de cenário (plain↔secure, InfluxDB↔
outra sink) exige reescrever lógica de negócio, e cada bug de acoplamento contamina o
resultado dos dois tracks ao mesmo tempo. Precisamos de um módulo com interface pequena
o bastante para ser confiável como instrumento de medição.

## Solution

Um módulo `capture` no NestJS que assina o broker configurado, normaliza o que recebe em
um formato interno único, e grava numa sink de telemetria — tudo por trás de dois seams
(porta de assinatura MQTT e porta de sink de telemetria), de modo que trocar de broker
(plain/secure) ou de destino de armazenamento seja uma troca de adapter, nunca uma
mudança na lógica de captura em si.

## User Stories

1. Como pesquisador, quero que `capture` se conecte ao broker configurado (plain ou
   secure) e assine `#`, para capturar toda a telemetria publicada sem precisar saber
   de antemão quais tópicos existem.
2. Como pesquisador, quero que cada mensagem capturada seja normalizada num formato
   único (sensor, valor, timestamp de recepção, broker de origem), para que Track A e
   Track B consumam o mesmo dado sem lógica duplicada.
3. Como pesquisador, quero que cada mensagem normalizada seja gravada no InfluxDB
   taggeada com `run_id`, `sensor_id`, `broker` e `source`, para permitir análise
   posterior por run sem reprocessar dados brutos.
4. Como pesquisador, quero que `capture` emita a mensagem recém-capturada via WebSocket
   em tempo real, para que o dashboard mostre a telemetria ao vivo sem polling.
5. Como desenvolvedor, quero trocar o broker-alvo de `capture` (plain para secure) sem
   alterar a lógica de normalização/gravação, para reusar o mesmo módulo nos dois grupos
   experimentais (tratado e controle).
6. Como desenvolvedor, quero testar a lógica de normalização e gravação sem precisar de
   um broker Mosquitto real rodando, para que a suíte de testes seja rápida e determinística.
7. Como pesquisador, quero que uma falha de conexão com o broker (ex: durante um flood
   pesado no Track B) seja registrada como evento na run, não silenciosamente engolida,
   para que a análise saiba distinguir "sem dados porque não houve mensagens" de "sem
   dados porque `capture` caiu".
8. Como desenvolvedor, quero que a porta de sink de telemetria seja agnóstica ao InfluxDB
   especificamente, para permitir trocar de backend de série temporal no futuro sem tocar
   na lógica de captura (mesmo que hoje só exista o adapter Influx).
9. Como pesquisador, quero que o `run_id` ativo seja resolvido automaticamente a partir do
   módulo `experiments` (a run em andamento), para não precisar passá-lo manualmente em
   cada mensagem capturada.

## Implementation Decisions

- Porta `MqttSubscriberPort`: interface mínima (conectar, assinar tópico, receber
  callback de mensagem, desconectar) implementada por um adapter Mosquitto único,
  parametrizado por configuração de conexão (host, porta, TLS ou não, credenciais) — não
  por dois adapters separados para plain/secure, já que o protocolo é o mesmo, só muda a
  config de transporte.
- Porta `TelemetrySinkPort`: interface mínima (gravar ponto de telemetria) implementada
  por um adapter InfluxDB.
- `capture` não conhece o conceito de "Track A" ou "Track B" — ele apenas assina, normaliza
  e grava/emite. A semântica de qual experimento está rodando vive no módulo `experiments`,
  que fornece o `run_id` ativo e as tags de contexto.
- Emissão em tempo real via o gateway do módulo `realtime` (Socket.IO) — `capture` publica
  um evento de domínio interno; `realtime` é quem sabe transformar isso em push para o
  frontend. `capture` não deve importar nada de WebSocket diretamente.
- Falhas de conexão com o broker disparam um evento registrado via `experiments` (fim
  anômalo de run ou marcação de gap), não apenas um log silencioso.
- Nenhuma lógica condicional de "se for o broker secure, faça X" deve existir dentro de
  `capture` — qualquer diferença de comportamento entre plain e secure é resolvida na
  configuração do adapter, nunca em `if`s espalhados pela lógica de negócio.

## Testing Decisions

- Testes unitários de `capture` usam um fake de `MqttSubscriberPort` (broker in-memory
  que aceita "publicar" mensagens de teste) e um fake de `TelemetrySinkPort` (captura em
  memória o que foi gravado) — sem Docker, sem rede.
- Comportamento a testar: dado uma sequência de mensagens no broker fake, `capture`
  normaliza e grava exatamente essas mensagens, taggeadas corretamente, e emite o mesmo
  número de eventos em tempo real.
- Teste de resiliência: dado que o broker fake simula uma desconexão no meio da run,
  `capture` registra o evento de falha em vez de falhar silenciosamente.
- Testes de integração (Mosquitto real em container, plain e secure) validam que o
  adapter Mosquitto de fato conecta, assina e recebe mensagens reais nos dois modos —
  isso é o que prova que o seam generaliza para o caso real, não só para o fake.
- Este módulo estabelece o padrão de teste que `experiments`, `metrics` e `realtime`
  devem seguir: unit com fakes no seam, integração com containers reais para o caminho
  crítico.

## Out of Scope

- Filtragem ou seleção de tópicos específicos — `capture` sempre assina `#` (é a própria
  demonstração da vulnerabilidade de auditoria irrestrita).
- Qualquer transformação de negócio sobre o valor do sensor (alertas, thresholds) — isso,
  se necessário, é responsabilidade de um módulo consumidor, não de `capture`.
- Suporte a múltiplos protocolos além de MQTT — fora do escopo desta IC.

## Further Notes

Este módulo é deliberadamente o único ponto do projeto com cerimônia de ports & adapters
completa (conforme decisão registrada em CONTEXT.md) — é o núcleo científico, e a
capacidade de trocar broker-alvo sem tocar em lógica é o que torna Track A e Track B
comparáveis entre si (mesmo instrumento de medição, alvo diferente).
