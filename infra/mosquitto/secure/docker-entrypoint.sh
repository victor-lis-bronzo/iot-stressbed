#!/bin/sh
#
# Entrypoint do container `mosquitto-secure`.
#
# Materializa, em tempo de subida, os dois arquivos que NÃO podem ser
# versionados por conterem credencial:
#   /tmp/mosquitto-auth/passwd  — hash gerado por mosquitto_passwd
#   /tmp/mosquitto-auth/acl     — acl.template com __MQTT_USER__ substituído
#
# Fonte das credenciais: MQTT_SECURE_USERNAME / MQTT_SECURE_PASSWORD, vindas do
# .env via docker-compose.yml (ver .env.example).
#
# Roda como o usuário não-privilegiado `mosquitto` (uid 1883) da imagem
# eclipse-mosquitto — daí o uso de /tmp, único diretório onde esse usuário
# escreve sem depender de chown por root.
#
# Ver: docs/specs/infra-resource-isolation.md

set -eu

AUTH_DIR="${MOSQUITTO_AUTH_DIR:-/tmp/mosquitto-auth}"
ACL_TEMPLATE="${MOSQUITTO_ACL_TEMPLATE:-/mosquitto/config/acl.template}"
CERT_DIR="${MOSQUITTO_CERT_DIR:-/mosquitto/certs}"

log()  { echo "[mosquitto-secure/entrypoint] $*"; }
fail() { echo "[mosquitto-secure/entrypoint] ERRO: $*" >&2; exit 1; }

# --------------------------------------------------------------------------- #
# 1. Pré-condições — falhar cedo e com mensagem acionável
# --------------------------------------------------------------------------- #

[ -n "${MQTT_SECURE_USERNAME:-}" ] || fail "MQTT_SECURE_USERNAME não definido (copie .env.example para .env)."
[ -n "${MQTT_SECURE_PASSWORD:-}" ] || fail "MQTT_SECURE_PASSWORD não definido (copie .env.example para .env)."

case "${MQTT_SECURE_USERNAME}" in
  *[!A-Za-z0-9_.-]*)
    fail "MQTT_SECURE_USERNAME deve conter apenas [A-Za-z0-9_.-] (ele é interpolado na ACL)."
    ;;
esac

for f in ca.crt server.crt server.key; do
  [ -s "${CERT_DIR}/${f}" ] || fail "certificado ausente: ${CERT_DIR}/${f} — rode ./scripts/gen-certs.sh no host antes de subir a stack."
  [ -r "${CERT_DIR}/${f}" ] || fail "sem permissão de leitura em ${CERT_DIR}/${f} (uid $(id -u)) — confira o modo dos arquivos no host."
done

[ -r "${ACL_TEMPLATE}" ] || fail "template de ACL não encontrado: ${ACL_TEMPLATE}"

# --------------------------------------------------------------------------- #
# 2. Arquivo de senha
# --------------------------------------------------------------------------- #

mkdir -p "${AUTH_DIR}"
chmod 700 "${AUTH_DIR}"

# -c cria/trunca o arquivo (estado limpo a cada subida, sem usuário órfão de
# uma configuração anterior); -b lê a senha do argumento em vez do terminal.
rm -f "${AUTH_DIR}/passwd"
mosquitto_passwd -b -c "${AUTH_DIR}/passwd" "${MQTT_SECURE_USERNAME}" "${MQTT_SECURE_PASSWORD}"
chmod 600 "${AUTH_DIR}/passwd"
log "arquivo de senha gerado para o usuário '${MQTT_SECURE_USERNAME}'."

# --------------------------------------------------------------------------- #
# 3. ACL
# --------------------------------------------------------------------------- #

sed "s/__MQTT_USER__/${MQTT_SECURE_USERNAME}/g" "${ACL_TEMPLATE}" > "${AUTH_DIR}/acl"
chmod 600 "${AUTH_DIR}/acl"

if grep -q "__MQTT_USER__" "${AUTH_DIR}/acl"; then
  fail "placeholder __MQTT_USER__ não foi substituído na ACL."
fi
if ! grep -q "^user ${MQTT_SECURE_USERNAME}\$" "${AUTH_DIR}/acl"; then
  fail "ACL gerada sem a diretiva 'user ${MQTT_SECURE_USERNAME}'."
fi
log "ACL gerada em ${AUTH_DIR}/acl."

# --------------------------------------------------------------------------- #
# 4. Entrega o controle ao mosquitto (CMD do compose/imagem)
# --------------------------------------------------------------------------- #

log "iniciando: $*"
exec "$@"
