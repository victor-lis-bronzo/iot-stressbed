# Frontend / Dashboard

## Problem Statement

Os resultados de Track A e Track B só têm valor científico se forem visíveis e
compreensíveis enquanto o experimento acontece e depois, na análise. Sem um painel que
mostre telemetria ao vivo, payloads capturados crus, e métricas de saúde do broker sob
ataque, o pesquisador fica dependente de logs brutos e consultas manuais no InfluxDB para
cada rodada — o que não escala para múltiplas runs comparativas.

## Solution

Um dashboard em Next.js + Tailwind com quatro áreas: visão ao vivo da telemetria (plain vs
secure lado a lado), uma view de interceptação (payloads crus capturados), uma view de
injeção (forjado vs real), um console de ataque (disparar/acompanhar runs de Track B com
métricas do broker em tempo real), e um histórico de experimentos para comparação de KPIs
entre runs.

## User Stories

1. Como pesquisador, quero ver a telemetria do sensor legítimo chegando ao vivo no
   dashboard (via WebSocket), para acompanhar o baseline sem precisar consultar o InfluxDB
   manualmente.
2. Como pesquisador, quero ver o broker plain e o broker secure lado a lado no mesmo
   dashboard, para comparar visualmente o comportamento nos dois modos durante a mesma janela.
3. Como pesquisador, quero uma view "Interceptação" que mostre os payloads brutos
   capturados pelo subscriber malicioso, para ter uma prova visual direta da
   vulnerabilidade de confidencialidade no broker plain.
4. Como pesquisador, quero uma view "Injeção" que destaque quando uma leitura foi forjada
   (usando o metadado da run, não detecção automática), para ilustrar visualmente a falta
   de integridade no broker plain frente à rejeição no broker secure.
5. Como pesquisador, quero um "console de ataque" onde eu possa iniciar uma run de Track B
   (escolher tipo de ataque, modo plain/secure, parâmetros) e acompanhar métricas do
   broker subindo em tempo real, para não precisar alternar entre terminal e Grafana
   durante o experimento.
6. Como pesquisador, quero embutir ou linkar painéis do Grafana no console de ataque, para
   reaproveitar as visualizações de métrica já existentes em vez de recriá-las no frontend.
7. Como pesquisador, quero uma página de histórico de experimentos listando runs passadas
   com seus KPIs principais (cobertura de captura, tempo até falha, taxa de perda), para
   comparar diferentes execuções sem consultar o InfluxDB manualmente.
8. Como pesquisador, quero registrar um sensor no sistema (via `sensors` module) através
   de um formulário simples, para poder identificar de qual dispositivo físico vêm os
   dados exibidos.
9. Como pesquisador, quero fazer login no dashboard (via `auth`/JWT) para acessar
   qualquer página, incluindo a visão ao vivo do baseline, o console de ataque e o
   histórico de experimentos — nada fica acessível sem autenticação.
10. Como pesquisador, quero que a latência entre a chegada de um dado no backend e sua
    exibição no dashboard seja perceptivelmente baixa (p95 < 1s no baseline), para que a
    visão "ao vivo" seja de fato ao vivo.
11. Como pesquisador, quero que o dashboard indique claramente quando uma run está em
    andamento e qual `run_id`/modo está sendo exibido, para nunca confundir dados de runs
    diferentes na mesma tela.

## Implementation Decisions

- Next.js consome o backend NestJS via REST (para dados históricos/agregados do módulo
  `metrics`) e via WebSocket/Socket.IO (para telemetria ao vivo do módulo `realtime`) —
  não há acesso direto do frontend ao InfluxDB ou Postgres.
- A visão "plain vs secure lado a lado" é uma composição de dois streams WebSocket
  (um por broker), renderizados na mesma tela, não uma fusão de dados no backend.
- Painéis do Grafana são embutidos via iframe/link direto (usando os dashboards já
  provisionados em `infra/grafana/`) em vez de o frontend reimplementar gráficos de série
  temporal de métricas de infraestrutura — telemetria de sensor (dado de domínio) pode ter
  visualização própria no Next.js, métricas de broker (infraestrutura) reusam Grafana.
- Autenticação via JWT emitido pelo módulo `auth`, guardando **todas** as rotas do
  dashboard, sem exceção — incluindo a view de telemetria ao vivo do baseline. Não há
  área pública.
- O console de ataque chama endpoints do módulo `experiments` para iniciar/parar uma run;
  o frontend não dispara ataques diretamente contra o broker — toda orquestração de
  ataque passa pelo backend, que sabe registrar o `run_id` e coordenar com o container
  `attacker`.
- Tailwind para estilização; sem necessidade de um design system elaborado — o público é
  o próprio pesquisador e o comitê avaliador da IC, não usuários finais de produto.

## Testing Decisions

- Bons testes de frontend aqui validam comportamento observável do usuário: "dado que o
  WebSocket emite uma leitura, ela aparece na tela em até N segundos" — não detalhes de
  implementação de componente React.
- Testes de componente (ex: Testing Library) para a lógica de exibição condicional
  (forjado vs real, plain vs secure lado a lado) usando dados mockados de WebSocket/REST,
  sem depender de um backend real rodando.
- Teste manual documentado no protocolo de experimento para o fluxo completo do console
  de ataque (iniciar run → ver métricas subindo → parar run) — depende de stack real via
  Docker Compose, não é prático automatizar em CI para este projeto de IC.
- Não há suíte de testes E2E completa prevista — dado o escopo de IC, o retorno de
  investir em Cypress/Playwright completo é baixo frente ao tempo disponível; testes
  manuais guiados pelo protocolo de experimento cobrem o caminho crítico.

## Out of Scope

- Design responsivo completo para mobile — o dashboard é operado num laptop/desktop
  durante os experimentos, não em campo.
- Internacionalização — conteúdo em português, sem necessidade de i18n.
- Customização de dashboards pelo usuário (o pesquisador é o único operador; não há
  multi-tenant nem personalização de painéis).

## Further Notes

O dashboard cumpre dois papéis simultâneos que não devem ser confundidos na UI: é uma
ferramenta de operação do experimento (console de ataque, histórico) e é, ele mesmo, a
prova viva de uma das vulnerabilidades (view de interceptação). Vale considerar navegação
separada para deixar isso claro ao usuário/avaliador da IC.
