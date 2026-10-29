# ADR-0014: padrão de 4 núcleos, com o layout de 8 como perfil opt-in

## Status
Aceito.

## Contexto
O compose fixa os containers do experimento em núcleos específicos ([[ADR-0004]]), e os
defaults assumiam **8 núcleos**: stack em `0,1`, plain em `2`, secure em `3`, attacker em
`4,5`. Sem `.env`, numa máquina com menos de 6 núcleos o Docker recusa criar o `attacker`
(cpuset inexistente) e o `docker compose up` falha; consertar exige exportar variáveis de
CPU, isto é, um `.env`. Isso contradiz o [[ADR-0008]] justamente na máquina lenta do
laboratório, cujo número de núcleos não conhecíamos. O smoke test de CI já precisava
contornar isso reescrevendo os cpusets, porque os runners do GitHub têm poucos núcleos.

4 núcleos é o piso comum, mas **não é garantido** que toda máquina o tenha (há VMs e
máquinas antigas com 2).

## Decisão
O padrão do compose passa a ser o layout de **4 núcleos**:

| Núcleo | Serviços |
|---|---|
| `0` | stack de observação (postgres, influxdb, grafana, renderer, telegraf, nestjs-api, nextjs-web) |
| `1` | `mosquitto-plain` (alvo) |
| `2` | `mosquitto-secure` (controle) |
| `3` | `attacker` (`ATTACKER_CPUS=1.0`) |

O layout anterior vira o perfil opt-in **`infra/profiles/cores-8.env`** (stack `0,1`, plain
`2`, secure `3`, attacker `4,5` com `ATTACKER_CPUS=2.0`, folga do host em `6,7`):

```bash
docker compose --env-file infra/profiles/cores-8.env up -d
```

O `--env-file` substitui o `.env`; quem já tem um copia as linhas do perfil para ele. Os
dois brokers ficam em núcleos **distintos**: o [[ADR-0004]] exige recursos idênticos para
plain e secure justamente para a comparação medir TLS+auth e não hardware, e dividir um
núcleo entre eles quebraria isso.

## Alternativas descartadas
- **Manter 8 e exigir `.env` em máquinas menores:** é o problema que motivou o ADR.
- **Script ou wrapper que detecta `nproc` e exporta os cpusets:** quebra o
  `docker compose up` puro, que é o contrato do [[ADR-0008]].
- **Plain e secure no mesmo núcleo para sobrar um à stack:** quebra a comparação
  plain × secure.
- **Container de preflight que checa `nproc` antes de subir os outros:** o Docker já
  falha com uma mensagem clara de cpuset indisponível; o container não acrescentaria nada.
- **Não fixar cpuset por padrão:** o isolamento é o que impede um flood de derrubar a
  stack de observação ([[ADR-0004]]).

## Medição
Mesma máquina (8 núcleos), imagens publicadas da `master`, sem `.env`, `message-flood`
contra `mosquitto-plain` e `connection-flood` de 1000 conexões, contando os pontos
`telemetry` gravados por `run_id` depois do flush:

| Cenário | 4 núcleos (padrão) | 8 núcleos (perfil) |
|---|---|---|
| message-flood, ~2,2 mil msg/s, 10 s | 22.924 de 22.924 (**100%**) | 22.231 de 22.231 (**100%**) |
| message-flood, ~3,8 mil msg/s, 15 s | 55.654 de 56.950 (**97,7%**) | 56.897 de 56.897 (**100%**) |
| message-flood, ~4,1 mil msg/s, 15 s (repetição) | 60.270 de 61.796 (**97,5%**) | — |
| connection-flood, 1000 conexões | 1000 de 1000 | 1000 de 1000 |
| `broker_survived` | `true` em todas | `true` em todas |
| CPU média do broker no flood pesado | 26% e 23% | 26% |

Nos dois layouts a taxa alcançada pelo attacker foi a mesma (2292 × 2223 e 3797 × 3793
msg/s): o attacker com 1 núcleo **não** foi o limite. O que difere é a captura.

Ressalvas: é uma execução por cenário (duas no caso de ~4 mil msg/s em 4 núcleos, que
repetiu a perda); a causa não foi isolada. A hipótese é que o `nestjs-api` (capture)
divide o único núcleo da stack com Postgres e InfluxDB e atrasa sob carga alta.

## Consequências
- `docker compose up` sem `.env` funciona em qualquer máquina com **4 ou mais** núcleos.
  Com menos, o Docker recusa o `up` e é preciso reescrever os cpusets; com 2 núcleos não há
  isolamento real e o Track B não deve ser rodado.
- **A telemetria sob flood pesado perde ~2,5% dos pontos com 4 núcleos** (≥ ~3,8 mil
  msg/s), e não perdeu nos regimes mais leves nem no perfil de 8. Afeta as contagens
  baseadas em telemetria (`telemetry_captured_count`, cobertura de interceptação); os KPIs
  do broker (CPU, sobrevivência) não mudaram. Para Track B em taxas altas, **use o perfil de
  8 núcleos**, ou considere a contagem de telemetria como piso.
- A stack de observação inteira divide 1 núcleo (antes 2), então operações pesadas como a
  renderização do Grafana ficam mais lentas.
- Com 4 núcleos o host e o Docker daemon não têm folga (não são pinados e disputam todos
  os núcleos): durante um Track B pesado a máquina pode ficar menos responsiva. Só o perfil
  de 8 deixa núcleos que nenhum cpuset inclui.
- Quem já tem `.env` com os `*_CPUSET` não muda nada. Quem não tem e roda em 8 núcleos passa
  a ter menos isolamento por padrão, até usar o perfil.
- Memória não foi avaliada aqui: os limites de RAM e o consumo da stack numa máquina lenta
  merecem checagem à parte.
