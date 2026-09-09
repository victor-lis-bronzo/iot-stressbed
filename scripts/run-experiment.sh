#!/usr/bin/env bash
#
# Dispara uma run reproduzível de injeção (Track A) end-to-end:
#   login -> start run -> disparo do injetor -> stop run
#
# É o único caminho correto para rodar o injetor: fora de uma run com
# attackType=injection o capture gravaria a telemetria forjada como source=legit,
# corrompendo o KPI (ADR-0006, run única ativa). Ver attacker/README.md.
#
# Uso:
#   ./scripts/run-experiment.sh injection <plain|secure> [-- <args extras p/ injector.py>]
#
# Exemplos:
#   ./scripts/run-experiment.sh injection plain
#   ./scripts/run-experiment.sh injection plain -- --count 20 --interval 0.1
#   ./scripts/run-experiment.sh injection secure   # controle: deve ser rejeitado
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
  echo "uso: $0 injection <plain|secure> [-- <args extras para injector.py>]" >&2
  echo "  ex.: $0 injection plain -- --count 20 --interval 0.1" >&2
}

TRACK="${1:-}"
MODE="${2:-}"

if [[ "$TRACK" != "injection" ]]; then
  echo "erro: track inválido ou ausente: '${TRACK}' (esperado: injection)" >&2
  usage
  exit 2
fi

if [[ "$MODE" != "plain" && "$MODE" != "secure" ]]; then
  echo "erro: modo inválido ou ausente: '${MODE}' (esperado: plain|secure)" >&2
  usage
  exit 2
fi

# Consome os 2 obrigatórios; o resto ("$@") repassa ao injector.py. O operador
# pode ou não incluir o separador `--`; ambos funcionam pois shift já os removeu.
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

echo "==> iniciando run (mode=${MODE}, attackType=injection) ..." >&2
START_RESPONSE="$(curl -sS -X POST "${API_BASE_URL}/experiments/runs/start" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"mode\":\"${MODE}\",\"attackType\":\"injection\"}")"
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

# A run precisa ser encerrada mesmo se o injetor falhar. O caso `secure` retorna
# exit 1 quando o broker aceita o atacante (achado grave) — e mesmo nesse
# cenário o stop tem que rodar, senão a run fica presa como ativa e bloqueia as
# próximas (ADR-0006). Por isso o stop vai num trap EXIT.
stop_run() {
  echo "==> encerrando run ..." >&2
  # `|| true`: um erro no stop não deve estourar o trap nem mascarar o exit code
  # real do injetor (preservado abaixo).
  curl -sS -X POST "${API_BASE_URL}/experiments/runs/stop" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' >/dev/null || true
  echo "==> run finalizada." >&2
}
trap stop_run EXIT

# --- Disparo do injetor --------------------------------------------------- #
# -T desabilita a alocação de TTY: sem isso `docker compose exec` falha quando
# rodado fora de um terminal interativo (ex. CI). "$@" repassa os args extras.

echo "==> disparando attacker (--target ${MODE}) ..." >&2
set +e
# injector.py imprime logs em stderr e o InjectionResult (JSON) em stdout, nessa
# ordem — capturamos só o stdout aqui para poder repassar o JSON intacto ao
# endpoint de KPI, sem misturar com as linhas de log.
INJECTOR_OUTPUT="$(docker compose exec -T attacker python python/injector.py --target "${MODE}" "$@")"
INJECTOR_EXIT=$?
set -e
echo "==> attacker finalizado (exit ${INJECTOR_EXIT})." >&2
echo "$INJECTOR_OUTPUT"

# Registra o resultado do injetor como KPI da run (source=injected/legit já vem
# do metadado da run, isso aqui só grava taxa de sucesso/status de conexão).
# Não-fatal: uma falha aqui não deve mascarar o exit code real do injetor.
echo "==> registrando resultado da injeção em ${API_BASE_URL}/metrics/runs/${RUN_ID}/injection-result ..." >&2
curl -sS -X POST "${API_BASE_URL}/metrics/runs/${RUN_ID}/injection-result" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$INJECTOR_OUTPUT" >/dev/null \
  || echo "aviso: falha ao registrar KPI de injeção (não-fatal)." >&2

# O trap EXIT roda o stop_run aqui. Propagamos o exit code do injetor para o
# chamador: 0 = ok (plain rodou, ou secure rejeitado como esperado);
# 1 = secure aceitou o atacante (achado grave).
exit "$INJECTOR_EXIT"
