# ADR-0008: bootstrap único via `docker compose up`

## Status
Aceito.

## Contexto
Boa parte da infra já era dockerizada (brokers, Postgres, InfluxDB, Grafana,
Telegraf, `attacker`), mas subir o projeto do zero numa máquina nova ainda
exigia passos manuais fora do Docker: `cp .env.example .env` + editar
credenciais (o compose usava `${VAR:?...}`, obrigatório), rodar
`./scripts/gen-certs.sh` manualmente antes do primeiro `up` (senão
`mosquitto-secure` falhava no boot), e rodar `apps/api`/`apps/web` fora do
Docker via `npm install && npm run start:dev`/`npm run dev`, sem Dockerfile
nem serviço no compose. Isso atrapalha o objetivo de reprodutibilidade da IC:
o usuário precisa poder configurar o testbed numa máquina nova com um único
comando.

## Decisão
Toda configuração, definição e dependência da aplicação passa a ser resolvida
via Docker Compose. `docker compose up` é o único comando necessário para o
bootstrap completo:
- Infra (brokers, Postgres, InfluxDB, Grafana, Telegraf) — já dockerizada,
  sem mudança de comportamento.
- Certificados mTLS: novo serviço `certs`, one-shot, que roda
  `scripts/gen-certs.sh` dentro de um container antes do `mosquitto-secure`
  subir (`depends_on: certs: condition: service_completed_successfully`). O
  script já é idempotente — não regera nada se os certificados já existirem —
  então rodar em todo `up` é seguro e barato.
- Backend (`nestjs-api`) e frontend (`nextjs-web`): ambos ganham Dockerfile
  próprio (multi-stage, `node:22-alpine`) e serviço no compose, com
  `depends_on`/`healthcheck` cobrindo suas dependências reais (Postgres,
  InfluxDB, certificados, brokers).
- Variáveis de ambiente hoje obrigatórias (`${VAR:?mensagem}`) passam a ter
  defaults de desenvolvimento/pesquisa (`${VAR:-default}`) diretamente no
  `docker-compose.yml`. Isso torna o `.env` estritamente opcional — só
  necessário para quem quiser sobrescrever algum valor.

## Alternativas descartadas
- **Manter o setup manual documentado em `CONTEXT.md`/README**: descartada
  porque contraria diretamente o objetivo prático da IC (configurar em
  qualquer máquina nova sem fricção). Documentação não elimina o passo
  manual, só o descreve.
- **Gerar os certificados no próprio entrypoint do `mosquitto-secure`**
  (`infra/mosquitto/secure/docker-entrypoint.sh`): descartada porque mistura
  responsabilidades (o entrypoint hoje só valida/materializa passwd e ACL) e
  impede que outros serviços dependam explicitamente da conclusão da geração
  via `depends_on: condition: service_completed_successfully` — um serviço
  `certs` separado deixa essa dependência explícita e reutilizável (hoje só
  `mosquitto-secure` depende dela, mas `nestjs-api` também monta o mesmo
  volume de certificados).

## Consequências
- Arquivos novos: `apps/api/Dockerfile`, `apps/api/.dockerignore`,
  `apps/web/Dockerfile`, `apps/web/.dockerignore`, `.dockerignore` (raiz).
- `apps/web/next.config.ts` ganha `output: 'standalone'`, necessário para o
  build multi-stage do Next.js.
- `docker-compose.yml` ganha os serviços `certs`, `nestjs-api`, `nextjs-web`,
  e troca `${VAR:?...}` por `${VAR:-default}` em todas as credenciais antes
  obrigatórias (Postgres, InfluxDB, Grafana, MQTT secure).
- `.env.example` (raiz, `apps/api`, `apps/web`) passam a documentar que
  copiar o arquivo é opcional, e continuam valendo para quem rodar
  `apps/api`/`apps/web` fora do Docker via `npm run dev`.
- **Não contraria o ADR-0006** (run única ativa): o disparo do
  `attacker`/`injector.py` continua sempre manual — o container `attacker`
  não é afetado por este ADR, e nada aqui o faz subir/disparar
  automaticamente no `up`.
- **Não contraria o ADR-0004** (isolamento de recursos): `nestjs-api` e
  `nextjs-web` usam `cpuset: ${STACK_CPUSET:-0,1}`, o mesmo núcleo reservado
  de `postgres`/`influxdb`/`grafana`/`telegraf` — não invadem os núcleos do
  broker nem do atacante.
- Os defaults de credenciais adicionados (`stressbed`/`stressbed`,
  `admin`/`admin`, tokens fixos) são para uso local de pesquisa, atrás da
  bridge `stressbed-net` — não devem ser usados em qualquer deploy exposto
  fora de um laboratório isolado.

## Atualização: lacunas achadas no teste da stack (issue #23)
O teste da stack a partir das imagens publicadas, sem `.env`, mostrou dois defeitos
que contrariavam o objetivo deste ADR:
- **api sem credenciais do InfluxDB:** o serviço `nestjs-api` só recebia
  `INFLUXDB_URL`; o código cai no default de token vazio e o InfluxDB responde
  `unauthorized`, então nenhuma telemetria era gravada nem consultada. O compose
  agora passa `INFLUXDB_TOKEN`, `INFLUXDB_ORG` e `INFLUXDB_BUCKET` com os mesmos
  defaults de `influxdb`, `grafana` e `telegraf`. Corrige também o caso de quem
  muda `INFLUXDB_ORG`/`INFLUXDB_BUCKET` num `.env` e deixava o api no default.
- **healthcheck do `nextjs-web`:** consultava `/`, que responde 307 para
  `http://localhost:3002/login`; o `wget` seguia o redirect e `localhost` resolve
  para `::1` no alpine, onde o Next não escuta. Passou a consultar `/login`.

## Atualização: passos manuais que sobravam no Ubuntu (issue #25)
A bateria de testes sobre as imagens publicadas ainda achou dois passos manuais
escondidos atrás do `docker compose up` sem `.env`:
- **`telegraf` sem acesso ao socket do Docker:** o default `TELEGRAF_DOCKER_GID=0`
  só vale onde o socket é `root:root`; no Ubuntu a série `broker_metrics` ficava
  vazia e o healthcheck não percebia. Passou a rodar como root dentro do container,
  com healthcheck que testa a leitura do socket — ver [[ADR-0010]].
- **Certificados `root`-owned no host:** o container `certs` gravava como root no
  bind mount, e o pesquisador não lia as chaves (teste de integração, cópia para o
  ESP32). `scripts/gen-certs.sh` devolve a posse ao dono do diretório montado.

Também alinhados ao espírito deste ADR: `export_run_metrics.py` e o teste de
integração do `capture` passam a usar os mesmos defaults de laboratório do compose
quando as variáveis não estão no ambiente, e `run-experiment.sh`/`capture-pcap.sh`
ganharam o bit de execução no git.
