# ADR-0009: imagens pré-buildadas publicadas em registry (Docker Hub) via CI

## Status
Aceito.

## Contexto
O bootstrap único do [[ADR-0008]] ainda exige buildar 4 imagens no host
(`nestjs-api`, `nextjs-web`, `attacker`, `mock-sensor`). Na máquina lenta do
laboratório (Ubuntu), esse build demora demais e falha por incompatibilidade de
ambiente. Isso contraria o objetivo de reprodutibilidade e baixo atrito da IC:
o laboratório só deveria precisar baixar e rodar.

## Decisão
Publicar as 4 imagens em `devvictorlis/stressbed-*` (públicas, Docker Hub) via
GitHub Actions (`.github/workflows/publish-images.yml`, disparado em push na
`master` e manualmente via `workflow_dispatch`):
- `devvictorlis/stressbed-api`, `stressbed-web`, `stressbed-attacker` e
  `stressbed-mock-sensor`, com tags `latest` e `<sha-curto>` (rastreabilidade).
- O `docker-compose.yml` ganha `image:` ao lado do `build:` existente em cada um
  dos 4 serviços. `docker compose up` **baixa** a imagem por padrão e só builda
  sob demanda (`docker compose up --build` / `docker compose build`).
  `docker compose pull` atualiza as imagens no laboratório.
- O build roda em runner `ubuntu-latest` (amd64, mesma arquitetura do lab), sem
  multi-arch, com cache `type=gha`.

## Alternativas descartadas
- **Continuar buildando no host**: é exatamente o problema que motivou este ADR.
- **Build multi-arch com buildx**: desnecessário, dev e lab são amd64; só
  adicionaria custo e tempo de CI.
- **Dois arquivos compose (`docker-compose.prod.yml` separado)**: rejeitado em
  favor de um único arquivo com `image:` + `build:`, menos para manter.

## Consequências
- Arquivo novo: `.github/workflows/publish-images.yml`.
- Necessidade dos secrets `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN` no GitHub
  (Access Token do Docker Hub com permissão Read & Write, não a senha da conta).
- Imagens públicas no Docker Hub (`devvictorlis/stressbed-*`).
- **Limitação do `NEXT_PUBLIC_*` embutido**: o Next.js embute
  `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_GRAFANA_URL` no bundle em build time, e a
  imagem publicada fica com `localhost`. Funciona quando o navegador é aberto na
  própria máquina do lab; acessar o dashboard de outra máquina pela rede quebra
  as chamadas do browser à API/Grafana. Atender a LAN exige rebuildar a imagem
  `web` com as URLs corretas (follow-up separado). A conexão dos devices IoT ao
  broker MQTT (1883) não é afetada.
- **Não contraria o ADR-0004** (isolamento de recursos): `cpuset`, limites e
  demais campos do compose permanecem inalterados.
- **Não contraria o ADR-0006** (run única ativa): o disparo do `attacker`
  continua manual; só muda a origem da imagem.
- **Não contraria o ADR-0008**: reforça o bootstrap único, apenas trocando build
  local por pull de imagem pronta; `.env` continua opcional.

## Atualização: manutenção do pipeline (avisos de Node 20, pip e npm)
O primeiro run do workflow passou, mas o log trouxe avisos. Tratamento:
- **Actions em Node 24:** `actions/checkout@v7`, `docker/setup-buildx-action@v4`,
  `docker/login-action@v4` e `docker/build-push-action@v7` (as versões anteriores
  usavam Node 20, hoje forçado para Node 24 pelo GitHub). As release notes dos
  majors novos só removem envs deprecated que o workflow não usa.
- **pip como root:** `attacker/Dockerfile` e `scripts/Dockerfile.mock-sensor`
  definem `PIP_ROOT_USER_ACTION=ignore` e `PIP_DISABLE_PIP_VERSION_CHECK=1`. Em
  container descartável o root é intencional, então não há venv nem usuário.
- **bcrypt 5 → 6 (`apps/api`):** a v5 puxava `@mapbox/node-pre-gyp` e, com ele,
  `npmlog`, `gauge`, `are-we-there-yet`, `rimraf@3` e `tar@6`, todos deprecated. A
  v6 usa `node-gyp-build` com prebuilds, o que também dispensou o
  `apk add python3 make g++` do `apps/api/Dockerfile` (o bcrypt carrega no
  `node:22-alpine` sem compilar). Hashes `$2b$` gerados pela v5 continuam
  válidos na v6 (verificado), então usuários já semeados seguem logando. A API
  usada (`hash`/`compare`) não mudou.
- **Avisos que permanecem, de propósito:** `glob@10.5.0` e `uuid@9.0.1` no `api`
  (via `typeorm`/`@nestjs/typeorm`) e `eslint`/`glob`/`whatwg-encoding` no `web`
  (só dev, via `jest-environment-jsdom`, fora da imagem final). Não têm correção
  do nosso lado. Não usamos `--loglevel=error`: o aviso continua útil como alerta
  quando uma dependência nova trouxer um problema real.
