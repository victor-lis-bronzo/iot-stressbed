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

FAILED=0

for i in "${!PANEL_IDS[@]}"; do
  PANEL_ID="${PANEL_IDS[$i]}"
  SLUG="${PANEL_SLUGS[$i]}"
  DEST="${OUT_DIR}/${SLUG}.png"
  TMP="${DEST}.tmp"

  URL="${GRAFANA_URL}/render/d-solo/${DASHBOARD_UID}/${DASHBOARD_SLUG}?panelId=${PANEL_ID}&width=1000&height=500&from=${FROM}&to=${TO}"

  echo "==> painel '${SLUG}' (id=${PANEL_ID}) ..." >&2

  HTTP_STATUS="$(curl -sS -o "$TMP" -w '%{http_code}' \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    "$URL" || echo "000")"

  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo "erro: falha ao renderizar painel '${SLUG}' (HTTP ${HTTP_STATUS}). URL: ${URL}" >&2
    rm -f "$TMP"
    FAILED=1
    continue
  fi

  # Confirma que a resposta é de fato um PNG antes de promover o arquivo:
  # o Grafana pode responder 200 com um corpo de erro (ex. HTML/JSON) em
  # alguns cenários de proxy/autenticação. Checamos a assinatura binária do
  # PNG (primeiros 8 bytes) e um tamanho mínimo, em vez de confiar só no
  # Content-Type (que pode não ser reportado por todos os proxies).
  SIZE="$(wc -c < "$TMP" | tr -d '[:space:]')"
  MAGIC="$(head -c 8 "$TMP" | od -An -tx1 | tr -d ' \n')"

  if [[ "$SIZE" -lt 1024 || "$MAGIC" != "89504e470d0a1a0a" ]]; then
    echo "erro: resposta do painel '${SLUG}' não é um PNG válido (tamanho=${SIZE} bytes)." >&2
    rm -f "$TMP"
    FAILED=1
    continue
  fi

  mv "$TMP" "$DEST"
  echo "==> ok: ${DEST}" >&2
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "erro: um ou mais painéis falharam ao exportar. Nenhum PNG corrompido foi deixado para trás." >&2
  exit 1
fi

echo "==> export concluído: ${OUT_DIR}/" >&2
