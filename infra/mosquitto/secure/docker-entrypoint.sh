#!/bin/sh
#
# Entrypoint do container `mosquitto-secure`: materializa /mosquitto/runtime com
# passwd, acl e uma cópia dos certificados antes de entregar o controle ao CMD.
#
# Os certificados são COPIADOS em vez de lidos direto do bind mount porque num
# host Linux eles pertencem ao usuário do pesquisador, enquanto o mosquitto
# larga privilégio e roda como `mosquitto` (uid 1883) — a leitura direta
# falharia de forma dependente do uid/gid do host. Este script roda como root;
# quem larga privilégio é o próprio broker, via `user mosquitto` no
# mosquitto.conf, depois de abrir a porta 8883.
#
# Ver: docs/specs/infra-resource-isolation.md,
#      docs/adr/0007-mtls-on-secure-broker.md

set -eu

RUNTIME_DIR="${MOSQUITTO_RUNTIME_DIR:-/mosquitto/runtime}"
ACL_TEMPLATE="${MOSQUITTO_ACL_TEMPLATE:-/mosquitto/config/acl.template}"
CERT_SRC_DIR="${MOSQUITTO_CERT_DIR:-/mosquitto/certs}"
BROKER_USER="${MOSQUITTO_USER:-mosquitto}"

log()  { echo "[mosquitto-secure/entrypoint] $*"; }
fail() { echo "[mosquitto-secure/entrypoint] ERRO: $*" >&2; exit 1; }

[ -n "${MQTT_SECURE_USERNAME:-}" ] || fail "MQTT_SECURE_USERNAME não definido (copie .env.example para .env)."
[ -n "${MQTT_SECURE_PASSWORD:-}" ] || fail "MQTT_SECURE_PASSWORD não definido (copie .env.example para .env)."

# O usuário é interpolado na ACL; restringir o alfabeto evita ACL corrompida.
case "${MQTT_SECURE_USERNAME}" in
  *[!A-Za-z0-9_.-]*)
    fail "MQTT_SECURE_USERNAME deve conter apenas [A-Za-z0-9_.-]."
    ;;
esac

# client-test.* entra na lista porque, com mTLS obrigatório (ADR-0007), o
# healthcheck deste container é ele mesmo um cliente que precisa se autenticar.
for f in ca.crt server.crt server.key client-test.crt client-test.key; do
  [ -s "${CERT_SRC_DIR}/${f}" ] || \
    fail "certificado ausente ou vazio: ${CERT_SRC_DIR}/${f} — rode ./scripts/gen-certs.sh no host antes de subir a stack."
done

[ -r "${ACL_TEMPLATE}" ] || fail "template de ACL não encontrado: ${ACL_TEMPLATE}"

rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"

cp "${CERT_SRC_DIR}/ca.crt"     "${RUNTIME_DIR}/ca.crt"
cp "${CERT_SRC_DIR}/server.crt" "${RUNTIME_DIR}/server.crt"
cp "${CERT_SRC_DIR}/server.key" "${RUNTIME_DIR}/server.key"
cp "${CERT_SRC_DIR}/client-test.crt" "${RUNTIME_DIR}/client-test.crt"
cp "${CERT_SRC_DIR}/client-test.key" "${RUNTIME_DIR}/client-test.key"
chmod 644 "${RUNTIME_DIR}/ca.crt" "${RUNTIME_DIR}/server.crt" "${RUNTIME_DIR}/client-test.crt"
chmod 600 "${RUNTIME_DIR}/server.key" "${RUNTIME_DIR}/client-test.key"
log "certificados copiados de ${CERT_SRC_DIR}."

# -c trunca o arquivo, para não deixar usuário órfão de uma configuração anterior.
mosquitto_passwd -b -c "${RUNTIME_DIR}/passwd" "${MQTT_SECURE_USERNAME}" "${MQTT_SECURE_PASSWORD}"
chmod 600 "${RUNTIME_DIR}/passwd"
log "arquivo de senha gerado para o usuário '${MQTT_SECURE_USERNAME}'."

sed "s/__MQTT_USER__/${MQTT_SECURE_USERNAME}/g" "${ACL_TEMPLATE}" > "${RUNTIME_DIR}/acl"
chmod 600 "${RUNTIME_DIR}/acl"

if grep -q "__MQTT_USER__" "${RUNTIME_DIR}/acl"; then
  fail "placeholder __MQTT_USER__ não foi substituído na ACL."
fi
if ! grep -q "^user ${MQTT_SECURE_USERNAME}\$" "${RUNTIME_DIR}/acl"; then
  fail "ACL gerada sem a diretiva 'user ${MQTT_SECURE_USERNAME}'."
fi
log "ACL gerada em ${RUNTIME_DIR}/acl."

if [ "$(id -u)" = "0" ]; then
  chown -R "${BROKER_USER}:${BROKER_USER}" "${RUNTIME_DIR}"
else
  log "AVISO: rodando como uid $(id -u) (não-root); assumindo que ${RUNTIME_DIR} já é legível pelo broker."
fi

log "iniciando: $*"
exec "$@"
