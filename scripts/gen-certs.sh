#!/usr/bin/env bash
#
# gen-certs.sh — gera a CA local, o certificado de servidor do broker
# `mosquitto-secure` e os certificados de CLIENTE exigidos por mTLS
# (grupo de controle MQTTS do experimento).
#
# Ver: docs/specs/infra-resource-isolation.md (user story 7)
#      docs/adr/0004-cgroups-resource-isolation.md
#      docs/adr/0007-mtls-on-secure-broker.md   (mTLS obrigatório)
#
# Saída (em infra/mosquitto/secure/certs/):
#   ca.key              — chave privada da CA local     (0600, NUNCA versionada)
#   ca.crt              — certificado da CA local       (usado por clientes/ESP32)
#   server.key          — chave privada do broker       (0640, NUNCA versionada)
#   server.crt          — certificado do broker, assinado pela CA
#   client-capture.key  — chave privada do cliente `capture` (0640)
#   client-capture.crt  — certificado de cliente do adapter `capture` do NestJS
#   client-test.key     — chave privada do cliente de teste  (0640)
#   client-test.crt     — certificado de cliente para testes manuais/healthcheck
#
# POR QUE DOIS CERTIFICADOS DE CLIENTE (e não um só):
#   O broker exige mTLS (ADR-0007), então TODO cliente precisa de certificado.
#   Separar o certificado do componente de produção do testbed (`capture`, que
#   roda continuamente e assina a telemetria) do certificado usado em
#   experimentação manual (`mosquitto_pub/sub` do pesquisador, healthcheck do
#   container, depuração) mantém uma identidade por papel: regerar o
#   certificado de teste não derruba a coleta, e cada credencial de máquina
#   fica com escopo de uso claro (o mosquitto não loga o CN do cliente, mas o
#   arquivo em uso identifica o papel de quem conectou).
#   Ambos são assinados pela MESMA CA local e são, do ponto de vista do broker,
#   igualmente válidos — a separação é operacional, não de autorização (a
#   autorização continua vindo de usuário/senha + ACL).
#
# Uso:
#   ./scripts/gen-certs.sh                 # gera se não existir
#   ./scripts/gen-certs.sh --force         # regenera do zero
#   CERT_EXTRA_SAN="IP:192.168.0.42" ./scripts/gen-certs.sh
#
# Estes certificados são de uso EXCLUSIVO do testbed de laboratório. A CA é
# auto-assinada e não há rotação automática (fora de escopo — ver spec).

set -euo pipefail

# Git Bash/MSYS no Windows converte argumentos que "parecem" caminho POSIX
# (ex: /C=BR/O=... do -subj) em caminho Windows, corrompendo o DN. Excluímos
# só os prefixos de DN da conversão — os caminhos de arquivo AINDA precisam ser
# convertidos, porque o openssl do Git Bash é um binário nativo Windows.
# Inofensivo em Linux/macOS, onde esta variável simplesmente não é usada.
export MSYS2_ARG_CONV_EXCL='/C=;/O=;/OU=;/CN='

# --------------------------------------------------------------------------- #
# Parâmetros
# --------------------------------------------------------------------------- #

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CERT_DIR="${CERT_DIR:-${PROJECT_ROOT}/infra/mosquitto/secure/certs}"

# Validade: 825 dias é o teto aceito por clientes TLS modernos para folhas.
CA_DAYS="${CA_DAYS:-1825}"
SERVER_DAYS="${SERVER_DAYS:-825}"
CLIENT_DAYS="${CLIENT_DAYS:-825}"
KEY_BITS="${KEY_BITS:-2048}"   # 2048 por compatibilidade com o TLS do ESP32

CA_SUBJECT="${CA_SUBJECT:-/C=BR/O=IoT StressBed/OU=Research/CN=IoT StressBed Local CA}"
SERVER_CN="${SERVER_CN:-mosquitto-secure}"
SERVER_SUBJECT="${SERVER_SUBJECT:-/C=BR/O=IoT StressBed/OU=Research/CN=${SERVER_CN}}"

# Clientes mTLS: "<basename>:<CN>". O CN é só identidade legível (aparece no log
# do broker); a autorização NÃO vem dele — ver ADR-0007 e mosquitto.conf
# (use_identity_as_username fica false para preservar a checagem de senha).
CLIENTS=(
  "client-capture:stressbed-capture"
  "client-test:stressbed-test"
)

# SANs: o broker é alcançado por nome de serviço (de dentro da rede Docker),
# por localhost (de fora, via porta publicada) e pelo IP da LAN (pelo ESP32).
# Acrescente o IP real da máquina via CERT_EXTRA_SAN, ex: CERT_EXTRA_SAN="IP:192.168.0.42".
BASE_SAN="DNS:${SERVER_CN},DNS:localhost,IP:127.0.0.1"
EXTRA_SAN="${CERT_EXTRA_SAN:-}"
if [[ -n "${EXTRA_SAN}" ]]; then
  SAN="${BASE_SAN},${EXTRA_SAN}"
else
  SAN="${BASE_SAN}"
fi

FORCE=0
for arg in "$@"; do
  case "${arg}" in
    --force|-f) FORCE=1 ;;
    --help|-h)
      sed -n '2,39p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "gen-certs.sh: argumento desconhecido: ${arg}" >&2
      echo "Uso: gen-certs.sh [--force]" >&2
      exit 2
      ;;
  esac
done

log()  { printf '[gen-certs] %s\n' "$*"; }
fail() { printf '[gen-certs] ERRO: %s\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null 2>&1 || fail "openssl não encontrado no PATH."

# --------------------------------------------------------------------------- #
# Idempotência
# --------------------------------------------------------------------------- #

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

# --------------------------------------------------------------------------- #
# 1. CA local
# --------------------------------------------------------------------------- #

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

# --------------------------------------------------------------------------- #
# 2. Certificado do servidor (broker), assinado pela CA
# --------------------------------------------------------------------------- #

log "gerando chave e CSR do servidor (CN=${SERVER_CN})…"
openssl genrsa -out "${CERT_DIR}/server.key" "${KEY_BITS}" 2>/dev/null
# 0640 (não 0600): num bind mount Linux o container mosquitto roda como uid 1883
# e precisa conseguir ler a chave. Quem guarda o segredo de verdade é ca.key
# (0600, nunca entra em container) — server.key é uma chave de laboratório,
# vive em diretório gitignored e é descartável via `gen-certs.sh --force`.
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

# Certificados são públicos; as chaves privadas já receberam modo restrito acima.
chmod 644 "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt"

# --------------------------------------------------------------------------- #
# 3. Certificados de CLIENTE (mTLS), assinados pela MESMA CA
# --------------------------------------------------------------------------- #
#
# O broker exige `require_certificate true` (ADR-0007): sem um destes, o
# handshake TLS é abortado antes do CONNECT do MQTT.
#
# extendedKeyUsage = clientAuth (e NÃO serverAuth): um certificado de cliente
# não deve poder se passar pelo broker. Sem subjectAltName: quem valida nome de
# host é o cliente contra o servidor, não o contrário — o broker só verifica a
# cadeia até a CA.

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
  # 0640 pelo mesmo motivo de server.key: o container precisa conseguir ler a
  # cópia montada rodando como uid 1883. Chave de laboratório, gitignored e
  # descartável via --force.
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

# --------------------------------------------------------------------------- #
# 4. Verificação (smoke test embutido)
# --------------------------------------------------------------------------- #

log "verificando cadeia…"
openssl verify -CAfile "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt"
for spec in "${CLIENTS[@]}"; do
  # -purpose sslclient: falha se o certificado não servir para autenticar um
  # cliente (é exatamente o uso que o broker vai exigir).
  openssl verify -CAfile "${CERT_DIR}/ca.crt" -purpose sslclient \
    "${CERT_DIR}/${spec%%:*}.crt"
done

# A chave privada precisa corresponder ao certificado emitido.
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
