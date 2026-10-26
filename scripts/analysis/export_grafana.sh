#!/usr/bin/env bash
#
# Exporta os painéis do dashboard Grafana `stressbed-broker-metrics`
# (infra/grafana/dashboards/broker-metrics.json) como PNGs para uma run
# específica, via API de renderização de imagem do Grafana (/render/d-solo/...),
# conforme docs/specs/data-analysis.md (Fase 5, Entregável 2).
#
# A run é recortada pela JANELA DE TEMPO [started_at, ended_at], não por run_id
# (ADR-0013): o dashboard não filtra mais por run_id.
#
# Uso:
#   ./scripts/analysis/export_grafana.sh <run_id>
#
# Exemplo:
#   ./scripts/analysis/export_grafana.sh 3fa85f64-5717-4562-b3fc-2c963f66afa6
#
# Configuráveis por env:
#   GRAFANA_URL     base do Grafana (default: http://localhost:${GRAFANA_PORT:-3001},
#                   mesmo padrão de default de NEXT_PUBLIC_GRAFANA_URL em
#                   apps/web/lib/api.ts / apps/web/.env.local.example)
#   GRAFANA_TOKEN   token de service account de leitura do Grafana (obrigatório;
#                   ver GRAFANA_TOKEN em .env.example)
#   FROM, TO        janela do render (epoch ms ou termos do Grafana como "now-30m").
#                   Se AMBOS estiverem definidos, valem e o CSV nem é lido.
#   RUN_METRICS_CSV CSV de export_run_metrics.py de onde sai a janela da run
#                   (default: ./out/run_metrics.csv)
#   WINDOW_MARGIN_SECONDS  folga antes/depois da run no gráfico (default: 10)
#   OUT_DIR         diretório base de saída (default: ./out/grafana)
#   RENDER_CONCURRENCY  nº máximo de painéis renderizados em paralelo (default: 4).
#                   Os 4 painéis são independentes; renderizá-los ao mesmo tempo
#                   corta o tempo total (~244s sequencial) para perto do painel
#                   mais lento. Use 1 para voltar ao comportamento sequencial.
#   RENDER_SCALE    fator de escala do render do Grafana; quando definido, vira
#                   &scale=... na URL (default: vazio = comportamento padrão do
#                   Grafana, sem o parâmetro).
#   RENDER_TIMEOUT  timeout de render do lado do servidor Grafana, em segundos;
#                   quando definido, vira &timeout=... na URL (default: vazio =
#                   sem o parâmetro).
#   CURL_MAX_TIME   teto de tempo (segundos) de cada chamada curl via --max-time,
#                   para um render travado não bloquear o script (default: 120).
#
# Nota sobre a janela de tempo: sem o filtro por run_id, a janela É o que isola a
# run — uma janela larga misturaria runs diferentes no mesmo gráfico. Por isso,
# sem FROM/TO, o script lê started_at/ended_at da run no CSV de
# export_run_metrics.py (rode-o antes; este script é bash puro e não consulta o
# Postgres). Uma run ainda ativa (sem ended_at) vai até "agora".
#
# Nenhum dado é escrito no Grafana/Postgres/InfluxDB — este script só lê (via
# a API de renderização) e grava arquivos locais em out/grafana/<run_id>/.
set -euo pipefail

usage() {
  echo "uso: $0 <run_id>" >&2
  echo "  ex.: $0 3fa85f64-5717-4562-b3fc-2c963f66afa6" >&2
}

RUN_ID="${1:-}"

# Mesmo espírito do guard assertSafeRunId usado em
# apps/api/src/metrics/adapters/influxdb-telemetry-query.adapter.ts: nunca
# interpolar run_id não validado em uma URL.
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [[ -z "$RUN_ID" || ! "$RUN_ID" =~ $UUID_RE ]]; then
  echo "erro: run_id inválido ou ausente: '${RUN_ID}' (esperado um UUID)" >&2
  usage
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "erro: curl não encontrado no PATH. Instale-o antes de rodar este script." >&2
  exit 1
fi

GRAFANA_URL="${GRAFANA_URL:-http://localhost:${GRAFANA_PORT:-3001}}"
# Remove barra final, se houver, para não gerar "//render" na URL montada.
GRAFANA_URL="${GRAFANA_URL%/}"

if [[ -z "${GRAFANA_TOKEN:-}" ]]; then
  echo "erro: exporte GRAFANA_TOKEN (token de service account de leitura do Grafana)." >&2
  echo "      ver GRAFANA_TOKEN em .env.example." >&2
  exit 2
fi

# Janela de tempo (ADR-0013): FROM e TO explícitos, ou a janela da run no CSV.
if [[ -z "${FROM:-}" || -z "${TO:-}" ]]; then
  RUN_METRICS_CSV="${RUN_METRICS_CSV:-./out/run_metrics.csv}"
  WINDOW_MARGIN_SECONDS="${WINDOW_MARGIN_SECONDS:-10}"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "erro: python3 não encontrado; exporte FROM e TO para dispensar o CSV." >&2
    exit 2
  fi
  if ! WINDOW="$(python3 - "$RUN_METRICS_CSV" "$RUN_ID" "$WINDOW_MARGIN_SECONDS" <<'PY'
import csv, sys
from datetime import datetime, timedelta, timezone

path, run_id, margin = sys.argv[1], sys.argv[2], float(sys.argv[3])
csv.field_size_limit(64 * 1024 * 1024)
try:
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
except OSError as exc:
    sys.exit(f"não consegui ler {path}: {exc}")
row = next((r for r in rows if r.get("run_id", "").lower() == run_id.lower()), None)
if row is None or not row.get("started_at"):
    sys.exit(f"run {run_id} não encontrada em {path}")
start = datetime.fromisoformat(row["started_at"])
end = datetime.fromisoformat(row["ended_at"]) if row.get("ended_at") else datetime.now(timezone.utc)
delta = timedelta(seconds=margin)
ms = lambda d: int(d.timestamp() * 1000)
print(ms(start - delta), ms(end + delta))
PY
)"; then
    echo "erro: não foi possível obter a janela da run ${RUN_ID}." >&2
    echo "      rode scripts/analysis/export_run_metrics.py antes, ou exporte FROM e TO." >&2
    exit 2
  fi
  read -r FROM TO <<<"$WINDOW"
fi
OUT_DIR="${OUT_DIR:-./out/grafana}/${RUN_ID}"

DASHBOARD_UID="stressbed-broker-metrics"
DASHBOARD_SLUG="broker-metrics"

mkdir -p "$OUT_DIR"

# Painéis relevantes do dashboard (infra/grafana/dashboards/broker-metrics.json):
# id -> slug do arquivo de saída. Painel 100 (texto "Fonte dos dados") não
# entra por não ser um dado científico exportável.
PANEL_IDS=(1 2 3 4)
PANEL_SLUGS=(cpu memory network container-status)

echo "==> exportando painéis do dashboard '${DASHBOARD_UID}' para run ${RUN_ID} ..." >&2
echo "==> janela de tempo: from=${FROM} to=${TO} (ver nota no cabeçalho deste script)" >&2
echo "==> saída: ${OUT_DIR}/" >&2

# Knobs de render (ver cabeçalho). RENDER_SCALE/RENDER_TIMEOUT só entram na URL
# quando definidos, para preservar o comportamento padrão do Grafana.
RENDER_CONCURRENCY="${RENDER_CONCURRENCY:-4}"
RENDER_SCALE="${RENDER_SCALE:-}"
RENDER_TIMEOUT="${RENDER_TIMEOUT:-}"
CURL_MAX_TIME="${CURL_MAX_TIME:-120}"
if ! [[ "$RENDER_CONCURRENCY" =~ ^[0-9]+$ ]] || [[ "$RENDER_CONCURRENCY" -lt 1 ]]; then
  RENDER_CONCURRENCY=1
fi

# Sufixo opcional da URL de render, montado uma vez só. Usamos if (e não
# `[[ ... ]] && ...`) para não disparar o `set -e` quando a env está vazia.
RENDER_EXTRA=""
if [[ -n "$RENDER_SCALE" ]]; then
  RENDER_EXTRA+="&scale=${RENDER_SCALE}"
fi
if [[ -n "$RENDER_TIMEOUT" ]]; then
  RENDER_EXTRA+="&timeout=${RENDER_TIMEOUT}"
fi

# Diretório de marcadores de status, um arquivo por painel ("ok"/"erro"). Como
# os jobs rodam em subshells paralelas, não dá para somar um FAILED compartilhado
# em memória; cada job grava seu status e o pai faz a apuração ao final.
STATUS_DIR="$(mktemp -d)"
trap 'rm -rf "$STATUS_DIR"' EXIT

# Renderiza e valida UM painel, de forma independente e atômica (tmp -> mv).
# Toda a validação original (HTTP 200, tamanho mínimo e magic bytes do PNG) é
# feita aqui dentro; o job sempre retorna 0 e registra "ok"/"erro" no marcador.
render_panel() {
  local i="$1"
  local PANEL_ID="${PANEL_IDS[$i]}"
  local SLUG="${PANEL_SLUGS[$i]}"
  local DEST="${OUT_DIR}/${SLUG}.png"
  local TMP="${DEST}.tmp"
  local STATUS_FILE="${STATUS_DIR}/${i}"

  local URL="${GRAFANA_URL}/render/d-solo/${DASHBOARD_UID}/${DASHBOARD_SLUG}?panelId=${PANEL_ID}&width=1000&height=500&from=${FROM}&to=${TO}${RENDER_EXTRA}"

  echo "==> painel '${SLUG}' (id=${PANEL_ID}) ..." >&2

  local HTTP_STATUS
  HTTP_STATUS="$(curl -sS --max-time "${CURL_MAX_TIME}" -o "$TMP" -w '%{http_code}' \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    "$URL" || echo "000")"

  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo "erro: falha ao renderizar painel '${SLUG}' (HTTP ${HTTP_STATUS}). URL: ${URL}" >&2
    rm -f "$TMP"
    echo "erro" > "$STATUS_FILE"
    return 0
  fi

  # Confirma que a resposta é de fato um PNG antes de promover o arquivo:
  # o Grafana pode responder 200 com um corpo de erro (ex. HTML/JSON) em
  # alguns cenários de proxy/autenticação. Checamos a assinatura binária do
  # PNG (primeiros 8 bytes) e um tamanho mínimo, em vez de confiar só no
  # Content-Type (que pode não ser reportado por todos os proxies).
  local SIZE MAGIC
  SIZE="$(wc -c < "$TMP" | tr -d '[:space:]')"
  MAGIC="$(head -c 8 "$TMP" | od -An -tx1 | tr -d ' \n')"

  if [[ "$SIZE" -lt 1024 || "$MAGIC" != "89504e470d0a1a0a" ]]; then
    echo "erro: resposta do painel '${SLUG}' não é um PNG válido (tamanho=${SIZE} bytes)." >&2
    rm -f "$TMP"
    echo "erro" > "$STATUS_FILE"
    return 0
  fi

  mv "$TMP" "$DEST"
  echo "==> ok: ${DEST}" >&2
  echo "ok" > "$STATUS_FILE"
  return 0
}

echo "==> renderizando ${#PANEL_IDS[@]} painéis com concorrência de até ${RENDER_CONCURRENCY} ..." >&2

# Dispara os jobs em paralelo com concorrência limitada: lança até
# RENDER_CONCURRENCY de uma vez e, ao atingir o teto, espera um terminar
# (`wait -n`) antes de lançar o próximo.
running=0
for i in "${!PANEL_IDS[@]}"; do
  render_panel "$i" &
  running=$((running + 1))
  if [[ "$running" -ge "$RENDER_CONCURRENCY" ]]; then
    # `|| true`: se um job morrer por falha inesperada (set -e dentro da
    # subshell), não queremos abortar o despacho dos demais aqui — a apuração
    # final por marcador ("ok" ausente => falha) já contabiliza isso e sai 1.
    wait -n || true
    running=$((running - 1))
  fi
done
wait

# Apuração final: qualquer painel sem marcador "ok" conta como falha.
FAILED=0
for i in "${!PANEL_IDS[@]}"; do
  if [[ "$(cat "${STATUS_DIR}/${i}" 2>/dev/null || true)" != "ok" ]]; then
    FAILED=1
  fi
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "erro: um ou mais painéis falharam ao exportar. Nenhum PNG corrompido foi deixado para trás." >&2
  exit 1
fi

echo "==> export concluído: ${OUT_DIR}/" >&2
