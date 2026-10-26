#!/usr/bin/env bash
#
# Dispara uma run reproduzível end-to-end pelo nestjs-api:
#   login -> POST /experiments/runs/launch -> espera a run terminar -> resultado
#
# É um cliente fino do MESMO endpoint que o botão "Disparar" do dashboard usa
# (ADR-0012): terminal e dashboard produzem runs idênticas. Quem orquestra é o
# api (start da run, ataque no container `attacker`, registro do KPI, stop); este
# script não toca no Docker. É o único caminho correto para rodar um ataque: fora
# de uma run com o attackType correspondente o capture gravaria a telemetria sob
# a tag errada (ex. injeção como source=legit), corrompendo o KPI (ADR-0006, run
# única ativa). Ver attacker/README.md.
#
# Tracks suportadas (o attackType da run):
#   injection          Track A
#   connection-flood   Track B
#   message-flood      Track B
#   malformed-payload  Track B
#
# Uso:
#   ./scripts/run-experiment.sh <track> <plain|secure> [-- <args extras para o ataque>]
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
# Os args extras viram `params` da run (objeto {flag: valor}, ex.
# {"connections": 200}): é o que distingue 1000 de 200 conexões no pareamento
# plain/secure de scripts/analysis/build_comparison_table.py. Para comparar plain
# com secure, use EXATAMENTE os mesmos args nos dois modos. O api converte os
# params de volta em flags do script do ataque; só flags da allowlist do runner
# (attacker/python/runner.py) são aceitas.
#
# Saída: o KPI da run (JSON de GET /metrics/runs/<id>) em stdout, logs em stderr.
#
# Exit code: 0 = ok; 1 = o secure aceitou o atacante na injeção (achado grave) ou o
# ataque não devolveu resultado; 2 = uso/credenciais; 3 = erro de API/rede. Para
# `injection`, rodar contra `secure` e terminar com 0 é o resultado CORRETO (a
# injeção foi rejeitada) — ver docs/track-a-guide.md. As 3 tracks de Track B
# retornam 0 mesmo se o broker degradar (isso fica no JSON de resultado).
#
# Ctrl-C: o ataque roda no container `attacker` e NÃO é interrompido por aqui —
# parar a run no meio corromperia os KPIs. O script só para de esperar; a run
# segue ativa até o ataque terminar (ou até um POST /experiments/runs/stop).
#
# Requer curl e python3 no host. Credenciais da API: exporte antes de rodar (não
# há credencial hardcoded aqui). Use as mesmas do admin semeado pelo backend
# (AUTH_ADMIN_EMAIL/PASSWORD):
#   export RUN_EXPERIMENT_EMAIL="admin@stressbed.com"
#   export RUN_EXPERIMENT_PASSWORD="@admin123"
#
# Configuráveis por env:
#   API_BASE_URL            (default http://localhost:${API_PORT:-3000})
#   RUN_EXPERIMENT_TIMEOUT  segundos esperando a run terminar (default 3900)
set -euo pipefail

# --- Validação de argumentos ---------------------------------------------- #

usage() {
  echo "uso: $0 <track> <plain|secure> [-- <args extras para o ataque>]" >&2
  echo "  tracks: injection | connection-flood | message-flood | malformed-payload" >&2
  echo "  ex.: $0 injection plain -- --count 20 --interval 0.1" >&2
  echo "  ex.: $0 connection-flood plain -- --connections 200" >&2
  echo "  ex.: $0 message-flood plain -- --rate 200 --duration-seconds 30" >&2
  echo "  ex.: $0 malformed-payload plain -- --mode giant --size-bytes 10000000" >&2
}

TRACK="${1:-}"
MODE="${2:-}"

case "$TRACK" in
  injection|connection-flood|message-flood|malformed-payload) ;;
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

# Consome os 2 obrigatórios; o resto ("$@") são os args do ataque. O operador pode
# ou não incluir o separador `--`; ambos funcionam pois shift já os removeu.
shift 2
if [[ "${1:-}" == "--" ]]; then
  shift
fi

for tool in curl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "erro: '${tool}' não encontrado no PATH." >&2
    exit 2
  fi
done

# --- Credenciais e configuração ------------------------------------------- #

if [[ -z "${RUN_EXPERIMENT_EMAIL:-}" || -z "${RUN_EXPERIMENT_PASSWORD:-}" ]]; then
  echo "erro: exporte RUN_EXPERIMENT_EMAIL e RUN_EXPERIMENT_PASSWORD antes de rodar." >&2
  echo "      (use o admin semeado pelo backend — AUTH_ADMIN_EMAIL/PASSWORD do .env)" >&2
  echo "      export RUN_EXPERIMENT_EMAIL=\"admin@stressbed.com\"" >&2
  echo "      export RUN_EXPERIMENT_PASSWORD=\"@admin123\"" >&2
  exit 2
fi

API_BASE_URL="${API_BASE_URL:-http://localhost:${API_PORT:-3000}}"
TIMEOUT="${RUN_EXPERIMENT_TIMEOUT:-3900}"

# Lê um campo de um JSON em stdin. Uso: echo "$JSON" | json_get 'd["id"]'
# Imprime vazio (e sai 0) se o JSON for inválido/vazio ou o campo não existir.
json_get() {
  python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    v = eval(sys.argv[1], {"d": d})
except Exception:
    v = None
print("" if v is None else v)
' "$1"
}

# Os args extras do ataque viram `params` da run (objeto {flag: valor}). Sem isso
# o pareamento plain/secure de scripts/analysis/build_comparison_table.py (chave
# = attack_type + params) tratava 1000 e 200 conexões como o MESMO cenário.
# Objeto e não array: `--rate 200 --duration-seconds 30` e a ordem inversa são o
# mesmo cenário, e a canonicalização do exportador ordena as chaves. Montado em
# python3 para escapar aspas corretamente sem jq.
params_json() {
  python3 - "$@" <<'PY'
import json, sys

args = sys.argv[1:]
params = {}
i = 0
while i < len(args):
    arg = args[i]
    if not arg.startswith("--"):  # posicional solto: guarda pela posição
        params[f"arg{i}"] = arg
        i += 1
        continue
    key, has_eq, raw = arg[2:].partition("=")
    if has_eq:  # --flag=valor
        i += 1
    elif i + 1 < len(args) and not args[i + 1].startswith("--"):
        raw = args[i + 1]
        i += 2
    else:  # --flag sem valor (booleana)
        params[key] = True
        i += 1
        continue
    try:
        params[key] = json.loads(raw) if raw.lstrip("-")[:1].isdigit() else raw
    except ValueError:
        params[key] = raw
print(json.dumps(params, separators=(",", ":"), ensure_ascii=False))
PY
}

# --- Login ---------------------------------------------------------------- #

echo "==> login em ${API_BASE_URL}/auth/login ..." >&2
LOGIN_RESPONSE="$(curl -sS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${RUN_EXPERIMENT_EMAIL}\",\"password\":\"${RUN_EXPERIMENT_PASSWORD}\"}" \
  || true)"
TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | json_get 'd["access_token"]')"

if [[ -z "$TOKEN" ]]; then
  echo "erro: não consegui extrair access_token do login. Resposta:" >&2
  echo "$LOGIN_RESPONSE" >&2
  exit 3
fi
echo "==> autenticado." >&2

# --- Launch --------------------------------------------------------------- #

LAUNCH_BODY="{\"mode\":\"${MODE}\",\"attackType\":\"${TRACK}\"}"
if [[ $# -gt 0 ]]; then
  PARAMS_JSON="$(params_json "$@")"
  LAUNCH_BODY="{\"mode\":\"${MODE}\",\"attackType\":\"${TRACK}\",\"params\":${PARAMS_JSON}}"
fi

echo "==> disparando (mode=${MODE}, attackType=${TRACK}) ..." >&2
LAUNCH_FILE="$(mktemp)"
trap 'rm -f "$LAUNCH_FILE"' EXIT
HTTP_STATUS="$(curl -sS -o "$LAUNCH_FILE" -w '%{http_code}' -X POST \
  "${API_BASE_URL}/experiments/runs/launch" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$LAUNCH_BODY" || echo "000")"
LAUNCH_RESPONSE="$(cat "$LAUNCH_FILE")"

if [[ "$HTTP_STATUS" != "202" ]]; then
  echo "erro: o api recusou o disparo (HTTP ${HTTP_STATUS}): $(printf '%s' "$LAUNCH_RESPONSE" | json_get 'd.get("message")' || true)" >&2
  [[ "$HTTP_STATUS" == "409" ]] && echo "      já existe uma run ativa; espere ela terminar (ADR-0006)." >&2
  exit 3
fi

RUN_ID="$(printf '%s' "$LAUNCH_RESPONSE" | json_get 'd["id"]')"
if [[ -z "$RUN_ID" ]]; then
  echo "erro: não consegui extrair o run id da resposta do launch. Resposta:" >&2
  echo "$LAUNCH_RESPONSE" >&2
  exit 3
fi
echo "==> run iniciada: ${RUN_ID}" >&2

# Ctrl-C só para de esperar: o ataque segue no `attacker` (ver cabeçalho).
trap 'echo; echo "==> interrompido. O ataque continua no attacker; a run ${RUN_ID} segue ativa até terminar (ou POST ${API_BASE_URL}/experiments/runs/stop)." >&2; exit 130' INT TERM

# --- Espera a run terminar ------------------------------------------------- #

DEADLINE=$((SECONDS + TIMEOUT))
while true; do
  ACTIVE="$(curl -sS "${API_BASE_URL}/experiments/runs/active" \
    -H "Authorization: Bearer ${TOKEN}" || true)"
  ACTIVE_ID="$(printf '%s' "$ACTIVE" | json_get 'd["id"]')"
  if [[ "$ACTIVE_ID" != "$RUN_ID" ]]; then
    break
  fi
  if (( SECONDS >= DEADLINE )); then
    echo "erro: a run ${RUN_ID} não terminou em ${TIMEOUT}s." >&2
    exit 3
  fi
  sleep 2
done
echo "==> run finalizada." >&2

# --- Resultado ------------------------------------------------------------- #

KPI="$(curl -sS "${API_BASE_URL}/metrics/runs/${RUN_ID}" \
  -H "Authorization: Bearer ${TOKEN}" || true)"
echo "$KPI"

if [[ "$TRACK" == "injection" ]]; then
  STATUS="$(printf '%s' "$KPI" | json_get 'd["injectionConnectStatus"]')"
  if [[ -z "$STATUS" ]]; then
    echo "erro: a injeção não devolveu resultado (ver os logs do nestjs-api)." >&2
    exit 1
  fi
  # secure aceitar o atacante é o achado grave; rejeitado é o resultado correto.
  if [[ "$MODE" == "secure" && "$STATUS" == "connected" ]]; then
    echo "ACHADO GRAVE: o broker secure aceitou o atacante." >&2
    exit 1
  fi
else
  RESULT="$(printf '%s' "$KPI" | json_get 'd["trackBResult"] and "ok"')"
  if [[ -z "$RESULT" ]]; then
    echo "erro: o ataque não devolveu resultado (ver os logs do nestjs-api)." >&2
    exit 1
  fi
fi
exit 0
