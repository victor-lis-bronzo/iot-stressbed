# ADR-0005: Autenticação obrigatória em todas as rotas do dashboard

## Status
Aceito.

## Contexto
Durante a revisão das specs, foi levantada a hipótese de deixar a view de telemetria ao
vivo do baseline pública (sem login), já que ela é, em si, uma demonstração da
vulnerabilidade de auditoria irrestrita e não exibe dado sensível de produção. Isso foi
proposto como decisão de escopo, não como requisito explícito do usuário.

## Decisão
Todas as rotas do frontend Next.js exigem autenticação via JWT (módulo `auth`) —
incluindo a visão ao vivo do baseline, o console de ataque e o histórico de
experimentos. Não existe nenhuma página pública.

## Alternativas descartadas
- **View de telemetria ao vivo pública, resto autenticado**: rejeitada explicitamente
  pelo usuário na revisão de specs — simplicidade e consistência de modelo de acesso
  (tudo atrás de login) preferidas sobre a economia marginal de não exigir login numa
  única tela.

## Consequências
- O módulo `auth` (guard JWT) se aplica uniformemente a todas as rotas do
  `nextjs-web`/`nestjs-api`, sem lista de exceção de rotas públicas.
- Simplifica o modelo de permissões: não há necessidade de lógica de "rota pública vs
  privada" em nenhuma camada.
