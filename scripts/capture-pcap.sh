#!/usr/bin/env bash
#
# Captura o tráfego MQTT bruto (plain ou secure) para um arquivo .pcap, usado
# no protocolo de confirmação de legibilidade de payload (Track A, ver
# docs/experiment-protocol.md): plain deve ser legível em texto puro, secure
# deve aparecer como ciphertext (verificado depois por scripts/pcap-entropy.py).
#
# Uso:
#   ./scripts/capture-pcap.sh <plain|secure>
#
# Exemplos:
#   ./scripts/capture-pcap.sh plain
#   IFACE=eth0 DURATION_SECONDS=60 ./scripts/capture-pcap.sh secure
#
# Configuráveis por env:
#   IFACE            interface de captura do tcpdump (default: any — funciona
#                     em Linux/WSL2 capturando todas as interfaces, incluindo a
#                     bridge Docker; ajuste se precisar de uma interface
#                     específica, ex. a bridge nomeada do docker-compose)
#   DURATION_SECONDS  duração da captura em segundos (default: 30). A captura
#                     também para antes disso se receber Ctrl+C (SIGINT)
#   OUT               caminho do arquivo .pcap de saída
#                     (default: ./captures/track-a-<plain|secure>.pcap)
#
# Os arquivos .pcap NÃO são versionados no git (decisão do projeto) — servem
# só para gerar os números de entropia documentados em
# docs/experiment-protocol.md. Rode este script enquanto uma run de telemetria
# (ou de injeção) está em andamento em outro terminal.
set -euo pipefail

usage() {
  echo "uso: $0 <plain|secure>" >&2
}

MODE="${1:-}"
if [[ "$MODE" != "plain" && "$MODE" != "secure" ]]; then
  echo "erro: modo inválido ou ausente: '${MODE}' (esperado: plain|secure)" >&2
  usage
  exit 2
fi

if [[ "$MODE" == "plain" ]]; then
  PORT="${MQTT_PLAIN_PORT:-1883}"
else
  PORT="${MQTT_SECURE_PORT:-8883}"
fi

IFACE="${IFACE:-any}"
DURATION_SECONDS="${DURATION_SECONDS:-30}"
OUT_DIR="$(dirname "${OUT:-./captures/track-a-${MODE}.pcap}")"
OUT="${OUT:-./captures/track-a-${MODE}.pcap}"

if ! command -v tcpdump >/dev/null 2>&1; then
  echo "erro: tcpdump não encontrado no PATH. Instale-o antes de rodar este script." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "==> capturando porta ${PORT} (${MODE}) na interface '${IFACE}' por até ${DURATION_SECONDS}s ..." >&2
echo "==> saída: ${OUT}" >&2
echo "==> dispare telemetria/injeção em outro terminal agora. Ctrl+C encerra antes do timeout." >&2

# timeout entrega SIGTERM ao tcpdump ao expirar; tcpdump finaliza o arquivo
# corretamente em ambos os casos (timeout ou Ctrl+C repassado como SIGINT).
set +e
timeout --signal=TERM "${DURATION_SECONDS}s" \
  tcpdump -i "$IFACE" -w "$OUT" "port ${PORT}"
TCPDUMP_EXIT=$?
set -e

# 124 = timeout expirou (esperado); 0 = tcpdump saiu sozinho (ex. Ctrl+C).
if [[ "$TCPDUMP_EXIT" != "0" && "$TCPDUMP_EXIT" != "124" ]]; then
  echo "erro: tcpdump saiu com código ${TCPDUMP_EXIT}." >&2
  exit "$TCPDUMP_EXIT"
fi

echo "==> captura concluída: ${OUT}" >&2
