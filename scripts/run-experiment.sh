#!/usr/bin/env bash
#
# Dispara uma run reproduzível end-to-end contra o container `attacker`:
#   login -> start run -> disparo do ataque -> stop run
#
# É o único caminho correto para rodar qualquer script do attacker: fora de
# uma run com o attackType correspondente o capture gravaria a telemetria sob
# a tag errada (ex. injeção como source=legit), corrompendo o KPI (ADR-0006,
# run única ativa). Ver attacker/README.md.
#
# Tracks suportadas e o script disparado dentro do container `attacker`:
#   injection          -> python/injector.py           (Track A)
#   connection-flood   -> python/connection_flood.py   (Track B)
#   message-flood      -> python/message_flood.py      (Track B)
#   malformed-payload  -> python/malformed_payload.py   (Track B)
#
# Uso:
#   ./scripts/run-experiment.sh <track> <plain|secure> [-- <args extras para o script do ataque>]
#
# Exemplos:
#   ./scripts/run-experiment.sh injection plain
#   ./scripts/run-experiment.sh injection plain -- --count 20 --interval 0.1
#   ./scripts/run-experiment.sh injection secure   # controle: deve ser rejeitado
#   ./scripts/run-experiment.sh connection-flood plain -- --connections 200
#   ./scripts/run-experiment.sh message-flood plain -- --rate 200 --duration-seconds 30
#   # malformed-payload exige a flag própria --mode (não confundir com o
#   # <plain|secure> deste script), passada via passthrough:
#   ./scripts/run-experiment.sh malformed-payload plain -- --mode giant --size-bytes 10000000
#
# Nota sobre exit code: só `injection` usa 0/1 para comprovar a assimetria
# plain aceita/secure rejeita. As 3 tracks de Track B praticamente sempre
# retornam 0 (falhas de rede/broker ficam no JSON de resultado, não no exit
# code) — ver attacker/README.md e o docstring de cada script para detalhes.
# Este script apenas repassa o exit code do processo disparado, sem
# reinterpretar sua semântica.
#
# Credenciais da API: exporte antes de rodar (não há credencial hardcoded aqui).
# Use as mesmas do admin semeado pelo backend (AUTH_ADMIN_EMAIL/PASSWORD no .env):
#   export RUN_EXPERIMENT_EMAIL="admin@stressbed.com"
#   export RUN_EXPERIMENT_PASSWORD="@admin123"
#
# Configuráveis por env (com defaults do .env.example):
#   API_BASE_URL  (default http://localhost:${API_PORT:-3000})
set -euo pipefail

# --- Validação de argumentos ---------------------------------------------- #

usage() {
  echo "uso: $0 <track> <plain|secure> [-- <args extras para o script do ataque>]" >&2
  echo "  tracks: injection | connection-flood | message-flood | malformed-payload" >&2
  echo "  ex.: $0 injection plain -- --count 20 --interval 0.1" >&2
  echo "  ex.: $0 connection-flood plain -- --connections 200" >&2
  echo "  ex.: $0 message-flood plain -- --rate 200 --duration-seconds 30" >&2
  echo "  ex.: $0 malformed-payload plain -- --mode giant --size-bytes 10000000" >&2
}

TRACK="${1:-}"
MODE="${2:-}"

# Resolve o script Python disparado no container `attacker` para cada track.
case "$TRACK" in
  injection)
    ATTACK_SCRIPT="python/injector.py"
    ;;
  connection-flood)
    ATTACK_SCRIPT="python/connection_flood.py"
    ;;
  message-flood)
    ATTACK_SCRIPT="python/message_flood.py"
    ;;
  malformed-payload)
    ATTACK_SCRIPT="python/malformed_payload.py"
    ;;
  *)
    echo "erro: track inválida ou ausente: '${TRACK}'" >&2
    usage
    exit 2
    ;;
esac

if [[ "$MODE" != "plain" && "$MODE" != "secure" ]]; then
  echo "erro: modo inválido ou ausente: '${MODE}' (esperado: plain|secure)" >&2
  usage
  exit 2
fi

# Consome os 2 obrigatórios; o resto ("$@") repassa ao script do ataque. O
# operador pode ou não incluir o separador `--`; ambos funcionam pois shift já
# os removeu.
shift 2
if [[ "${1:-}" == "--" ]]; then
  shift
fi

# --- Credenciais e configuração ------------------------------------------- #

if [[ -z "${RUN_EXPERIMENT_EMAIL:-}" || -z "${RUN_EXPERIMENT_PASSWORD:-}" ]]; then
  echo "erro: exporte RUN_EXPERIMENT_EMAIL e RUN_EXPERIMENT_PASSWORD antes de rodar." >&2
  echo "      (use o admin semeado pelo backend — AUTH_ADMIN_EMAIL/PASSWORD do .env)" >&2
  echo "      export RUN_EXPERIMENT_EMAIL=\"admin@stressbed.com\"" >&2
  echo "      export RUN_EXPERIMENT_PASSWORD=\"@admin123\"" >&2
  exit 2
fi

API_BASE_URL="${API_BASE_URL:-http://localhost:${API_PORT:-3000}}"

# --- Login ---------------------------------------------------------------- #
# Extraímos o access_token com grep/sed em vez de jq para não adicionar uma
# dependência extra ao operador: o corpo é sabidamente {"access_token":"..."},
# um único campo string, então um recorte por regex é suficiente e robusto aqui.

echo "==> login em ${API_BASE_URL}/auth/login ..." >&2
LOGIN_RESPONSE="$(curl -sS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${RUN_EXPERIMENT_EMAIL}\",\"password\":\"${RUN_EXPERIMENT_PASSWORD}\"}")"

TOKEN="$(printf '%s' "$LOGIN_RESPONSE" \
  | grep -o '"access_token"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | sed 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"

if [[ -z "$TOKEN" ]]; then
  echo "erro: não consegui extrair access_token do login. Resposta:" >&2
  echo "$LOGIN_RESPONSE" >&2
  exit 1
fi
echo "==> autenticado." >&2

# --- Start run ------------------------------------------------------------ #

echo "==> iniciando run (mode=${MODE}, attackType=${TRACK}) ..." >&2
START_RESPONSE="$(curl -sS -X POST "${API_BASE_URL}/experiments/runs/start" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"mode\":\"${MODE}\",\"attackType\":\"${TRACK}\"}")"
echo "==> run iniciada: ${START_RESPONSE}" >&2

# Mesmo recorte por regex do access_token acima: o corpo é um objeto plano
# {"id":"...",...}, então extrair "id" por regex evita depender de jq aqui também.
RUN_ID="$(printf '%s' "$START_RESPONSE" \
  | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -n1 \
  | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"

if [[ -z "$RUN_ID" ]]; then
  echo "erro: não consegui extrair o run id da resposta de start. Resposta:" >&2
  echo "$START_RESPONSE" >&2
  exit 1
fi

# A run precisa ser encerrada mesmo se o ataque falhar. O caso `injection`
# contra `secure` retorna exit 1 quando o broker aceita o atacante (achado
# grave) — e mesmo nesse cenário o stop tem que rodar, senão a run fica presa
# como ativa e bloqueia as próximas (ADR-0006). Por isso o stop vai num trap
# EXIT.
stop_run() {
  echo "==> encerrando run ..." >&2
  # `|| true`: um erro no stop não deve estourar o trap nem mascarar o exit code
  # real do ataque (preservado abaixo).
  curl -sS -X POST "${API_BASE_URL}/experiments/runs/stop" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' >/dev/null || true
  echo "==> run finalizada." >&2
}
trap stop_run EXIT

# --- Disparo do ataque ----------------------------------------------------- #
# -T desabilita a alocação de TTY: sem isso `docker compose exec` falha quando
# rodado fora de um terminal interativo (ex. CI). "$@" repassa os args extras.

echo "==> disparando attacker (${ATTACK_SCRIPT} --target ${MODE}) ..." >&2
set +e
# Cada script do attacker imprime logs em stderr e o resultado (JSON) em
# stdout, nessa ordem — capturamos só o stdout aqui para poder repassar o JSON
# intacto, sem misturar com as linhas de log.
ATTACK_OUTPUT="$(docker compose exec -T attacker python "${ATTACK_SCRIPT}" --target "${MODE}" "$@")"
ATTACK_EXIT=$?
set -e
echo "==> attacker finalizado (exit ${ATTACK_EXIT})." >&2
echo "$ATTACK_OUTPUT"

# Registro de KPI via /metrics: hoje só existe endpoint para o resultado de
# injeção (Track A). Os 3 ataques de Track B ainda não têm endpoint/coluna
# equivalente (fica para a tarefa "Medir KPIs do Track B" do roadmap) — para
# essas tracks o JSON acima já foi ecoado em stdout e é só isso mesmo por ora.
if [[ "$TRACK" == "injection" ]]; then
  # Não-fatal: uma falha aqui não deve mascarar o exit code real do ataque.
  echo "==> registrando resultado da injeção em ${API_BASE_URL}/metrics/runs/${RUN_ID}/injection-result ..." >&2
  curl -sS -X POST "${API_BASE_URL}/metrics/runs/${RUN_ID}/injection-result" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$ATTACK_OUTPUT" >/dev/null \
    || echo "aviso: falha ao registrar KPI de injeção (não-fatal)." >&2
fi

# O trap EXIT roda o stop_run aqui. Propagamos o exit code do ataque para o
# chamador sem reinterpretar: para `injection`, 0 = ok (plain rodou, ou secure
# rejeitado como esperado) e 1 = secure aceitou o atacante (achado grave); para
# as 3 tracks de Track B, ver a nota de exit code no cabeçalho deste script.
exit "$ATTACK_EXIT"
