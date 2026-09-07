# ADR-0006: Uma run ativa por vez (sem experimentos concorrentes)

## Status
Aceito.

## Contexto
O módulo `experiments` precisa resolver "qual é a run em andamento" para taggear
telemetria e métricas com o `run_id` correto. Era preciso decidir se o sistema suporta
múltiplas runs simultâneas (ex: Track A no broker secure e Track B no broker plain ao
mesmo tempo) ou apenas uma run por vez.

## Decisão
O sistema suporta apenas **uma run ativa por vez**, resolvida como singleton pelo
módulo `experiments` (no máximo uma linha com `ended_at IS NULL` em
`experiment_runs`). O pesquisador roda experimentos sequencialmente.

## Alternativas descartadas
- **Runs concorrentes**: permitiria paralelizar tracks diferentes contra brokers
  diferentes na mesma execução, mas complicaria significativamente a resolução de
  "qual run está ativa" em `capture` e no frontend, além de arriscar contaminação
  cruzada de KPIs (ex: dois ataques disputando os mesmos núcleos de CPU reservados ao
  experimento). Rejeitada como desnecessária para o uso real de uma IC, onde o
  pesquisador opera um experimento por vez.

## Consequências
- `experiments` pode expor um endpoint simples de "run ativa" sem precisar de
  parâmetro de contexto adicional (nem o frontend, nem `capture`, precisam informar
  qual run consultar).
- Iniciar uma nova run enquanto outra está ativa deve ser rejeitado explicitamente
  pelo backend (erro de conflito), não sobrescrever silenciosamente a run em andamento.
- Se o escopo mudar no futuro para exigir paralelismo, esta ADR deve ser revisitada
  antes de qualquer implementação de runs concorrentes.
