#!/usr/bin/env bash
#
# Gera, em infra/mosquitto/secure/certs/, a CA local, o certificado de servidor
# do broker `mosquitto-secure` e os certificados de cliente exigidos pelo mTLS
# (ADR-0007). São credenciais de laboratório: CA auto-assinada, sem rotação.
#
# Uso:
#   ./scripts/gen-certs.sh                                   # gera se não existir
#   ./scripts/gen-certs.sh --force                           # regenera do zero
#   CERT_EXTRA_SAN="IP:192.168.0.42" ./scripts/gen-certs.sh  # SAN extra p/ ESP32

set -euo pipefail

# Git Bash/MSYS no Windows converte argumentos que "parecem" caminho POSIX
# (o /C=BR/... do -subj) em caminho Windows e corrompe o DN. Excluímos só os
# prefixos de DN: os caminhos de arquivo AINDA precisam ser convertidos, porque
# o openssl do Git Bash é um binário nativo Windows.
export MSYS2_ARG_CONV_EXCL='/C=;/O=;/OU=;/CN='

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CERT_DIR="${CERT_DIR:-${PROJECT_ROOT}/infra/mosquitto/secure/certs}"

CA_DAYS="${CA_DAYS:-1825}"
# 825 dias é o teto que clientes TLS modernos aceitam em certificado folha.
SERVER_DAYS="${SERVER_DAYS:-825}"
CLIENT_DAYS="${CLIENT_DAYS:-825}"
KEY_BITS="${KEY_BITS:-2048}"   # 2048 por compatibilidade com o TLS do ESP32

CA_SUBJECT="${CA_SUBJECT:-/C=BR/O=IoT StressBed/OU=Research/CN=IoT StressBed Local CA}"
SERVER_CN="${SERVER_CN:-mosquitto-secure}"
SERVER_SUBJECT="${SERVER_SUBJECT:-/C=BR/O=IoT StressBed/OU=Research/CN=${SERVER_CN}}"

# Clientes mTLS ("<basename>:<CN>"), um por papel: regerar o certificado de
# teste (uso manual e healthcheck) não derruba a coleta do adapter `capture`.
# Os dois são assinados pela mesma CA e valem igual para o broker — o CN não
# autoriza nada (use_identity_as_username fica false; ver ADR-0007).
CLIENTS=(
  "client-capture:stressbed-capture"
  "client-test:stressbed-test"
)

# O broker é alcançado pelo nome de serviço (de dentro da rede Docker), por
# localhost (de fora, via porta publicada) e pelo IP da LAN (pelo ESP32, que
# precisa do IP real em CERT_EXTRA_SAN).
BASE_SAN="DNS:${SERVER_CN},DNS:localhost,IP:127.0.0.1"
EXTRA_SAN="${CERT_EXTRA_SAN:-}"
if [[ -n "${EXTRA_SAN}" ]]; then
  SAN="${BASE_SAN},${EXTRA_SAN}"
else
  SAN="${BASE_SAN}"
fi

usage() {
  cat <<'USAGE'
Uso: gen-certs.sh [--force]

  --force, -f   regenera CA, servidor e clientes do zero
  --help,  -h   esta mensagem

Variáveis: CERT_DIR, CERT_EXTRA_SAN, CA_DAYS, SERVER_DAYS, CLIENT_DAYS, KEY_BITS
USAGE
}

FORCE=0
for arg in "$@"; do
  case "${arg}" in
    --force|-f) FORCE=1 ;;
    --help|-h)  usage; exit 0 ;;
    *)
      echo "gen-certs.sh: argumento desconhecido: ${arg}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

log()  { printf '[gen-certs] %s\n' "$*"; }
fail() { printf '[gen-certs] ERRO: %s\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null 2>&1 || fail "openssl não encontrado no PATH."

mkdir -p "${CERT_DIR}"

EXPECTED=(ca.key ca.crt server.key server.crt)
for spec in "${CLIENTS[@]}"; do
  EXPECTED+=("${spec%%:*}.key" "${spec%%:*}.crt")
done

ALL_PRESENT=1
for f in "${EXPECTED[@]}"; do
  [[ -f "${CERT_DIR}/${f}" ]] || ALL_PRESENT=0
done

if [[ "${ALL_PRESENT}" -eq 1 && "${FORCE}" -eq 0 ]]; then
  log "certificados já existem em ${CERT_DIR} — nada a fazer (use --force para regenerar)."
  openssl x509 -in "${CERT_DIR}/server.crt" -noout -subject -dates
  exit 0
fi

if [[ "${FORCE}" -eq 1 ]]; then
  log "--force: removendo certificados anteriores."
  rm -f "${CERT_DIR}"/ca.key "${CERT_DIR}"/ca.crt "${CERT_DIR}"/ca.srl \
        "${CERT_DIR}"/server.key "${CERT_DIR}"/server.csr "${CERT_DIR}"/server.crt
  for spec in "${CLIENTS[@]}"; do
    rm -f "${CERT_DIR}/${spec%%:*}.key" "${CERT_DIR}/${spec%%:*}.csr" \
          "${CERT_DIR}/${spec%%:*}.crt"
  done
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

log "gerando CA local (${KEY_BITS} bits, ${CA_DAYS} dias)…"
openssl genrsa -out "${CERT_DIR}/ca.key" "${KEY_BITS}" 2>/dev/null
chmod 600 "${CERT_DIR}/ca.key"

cat > "${TMP_DIR}/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt             = no
[dn]
[v3_ca]
basicConstraints       = critical,CA:TRUE,pathlen:0
keyUsage               = critical,keyCertSign,cRLSign
subjectKeyIdentifier   = hash
EOF

openssl req -new -x509 \
  -key "${CERT_DIR}/ca.key" \
  -out "${CERT_DIR}/ca.crt" \
  -days "${CA_DAYS}" \
  -sha256 \
  -subj "${CA_SUBJECT}" \
  -config "${TMP_DIR}/ca.cnf" \
  -extensions v3_ca

log "gerando chave e CSR do servidor (CN=${SERVER_CN})…"
openssl genrsa -out "${CERT_DIR}/server.key" "${KEY_BITS}" 2>/dev/null
# 0640 e não 0600: em bind mount Linux o container roda como uid 1883 e precisa
# ler a chave. O segredo que importa é ca.key (0600, nunca entra em container).
chmod "${SERVER_KEY_MODE:-0640}" "${CERT_DIR}/server.key"

cat > "${TMP_DIR}/server.cnf" <<EOF
[req]
distinguished_name = dn
prompt             = no
[dn]
[v3_server]
basicConstraints       = critical,CA:FALSE
keyUsage               = critical,digitalSignature,keyEncipherment
extendedKeyUsage       = serverAuth
subjectAltName         = ${SAN}
subjectKeyIdentifier   = hash
authorityKeyIdentifier = keyid,issuer
EOF

openssl req -new \
  -key "${CERT_DIR}/server.key" \
  -out "${TMP_DIR}/server.csr" \
  -sha256 \
  -subj "${SERVER_SUBJECT}" \
  -config "${TMP_DIR}/server.cnf"

log "assinando certificado do servidor pela CA (SAN: ${SAN})…"
openssl x509 -req \
  -in "${TMP_DIR}/server.csr" \
  -CA "${CERT_DIR}/ca.crt" \
  -CAkey "${CERT_DIR}/ca.key" \
  -CAcreateserial \
  -CAserial "${CERT_DIR}/ca.srl" \
  -out "${CERT_DIR}/server.crt" \
  -days "${SERVER_DAYS}" \
  -sha256 \
  -extfile "${TMP_DIR}/server.cnf" \
  -extensions v3_server 2>/dev/null

chmod 644 "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt"

# clientAuth e não serverAuth: um certificado de cliente não pode se passar
# pelo broker. Sem subjectAltName porque quem valida nome de host é o cliente
# contra o servidor, não o contrário — o broker só verifica a cadeia até a CA.
cat > "${TMP_DIR}/client.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt             = no
[dn]
[v3_client]
basicConstraints       = critical,CA:FALSE
keyUsage               = critical,digitalSignature,keyEncipherment
extendedKeyUsage       = clientAuth
subjectKeyIdentifier   = hash
authorityKeyIdentifier = keyid,issuer
EOF

for spec in "${CLIENTS[@]}"; do
  client_name="${spec%%:*}"
  client_cn="${spec##*:}"
  client_subject="/C=BR/O=IoT StressBed/OU=Research/CN=${client_cn}"

  log "gerando chave e CSR do cliente '${client_name}' (CN=${client_cn})…"
  openssl genrsa -out "${CERT_DIR}/${client_name}.key" "${KEY_BITS}" 2>/dev/null
  # 0640 pelo mesmo motivo de server.key.
  chmod "${CLIENT_KEY_MODE:-0640}" "${CERT_DIR}/${client_name}.key"

  openssl req -new \
    -key "${CERT_DIR}/${client_name}.key" \
    -out "${TMP_DIR}/${client_name}.csr" \
    -sha256 \
    -subj "${client_subject}" \
    -config "${TMP_DIR}/client.cnf"

  log "assinando certificado do cliente '${client_name}' pela CA…"
  openssl x509 -req \
    -in "${TMP_DIR}/${client_name}.csr" \
    -CA "${CERT_DIR}/ca.crt" \
    -CAkey "${CERT_DIR}/ca.key" \
    -CAcreateserial \
    -CAserial "${CERT_DIR}/ca.srl" \
    -out "${CERT_DIR}/${client_name}.crt" \
    -days "${CLIENT_DAYS}" \
    -sha256 \
    -extfile "${TMP_DIR}/client.cnf" \
    -extensions v3_client 2>/dev/null

  chmod 644 "${CERT_DIR}/${client_name}.crt"
done

log "verificando cadeia…"
openssl verify -CAfile "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt"
for spec in "${CLIENTS[@]}"; do
  openssl verify -CAfile "${CERT_DIR}/ca.crt" -purpose sslclient \
    "${CERT_DIR}/${spec%%:*}.crt"
done

for pair in server "${CLIENTS[@]%%:*}"; do
  name="${pair%%:*}"
  key_mod="$(openssl rsa  -in "${CERT_DIR}/${name}.key" -noout -modulus 2>/dev/null)"
  crt_mod="$(openssl x509 -in "${CERT_DIR}/${name}.crt" -noout -modulus 2>/dev/null)"
  [[ "${key_mod}" == "${crt_mod}" ]] || fail "${name}.key não corresponde a ${name}.crt."
done

for f in "${EXPECTED[@]}"; do
  [[ -s "${CERT_DIR}/${f}" ]] || fail "arquivo esperado ausente ou vazio: ${CERT_DIR}/${f}"
done

log "OK. Arquivos em ${CERT_DIR}:"
ls -l "${CERT_DIR}"
openssl x509 -in "${CERT_DIR}/server.crt" -noout -subject -issuer -dates -ext subjectAltName
for spec in "${CLIENTS[@]}"; do
  openssl x509 -in "${CERT_DIR}/${spec%%:*}.crt" -noout -subject -dates -ext extendedKeyUsage
done

cat <<EOF

[gen-certs] Próximos passos:
  - o container mosquitto-secure monta este diretório em /mosquitto/certs (read-only);
  - clientes (mosquitto_sub/pub, NestJS, ESP32) devem confiar em ca.crt E apresentar
    um certificado de cliente — o broker exige mTLS (ADR-0007):
      --cafile ca.crt --cert client-test.crt --key client-test.key
    (o adapter \`capture\` usa client-capture.crt / client-capture.key)
  - ca.key, server.key e client-*.key são segredos locais e estão no .gitignore.
EOF
