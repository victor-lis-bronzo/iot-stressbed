#!/bin/sh
#
# Entrypoint do container `mosquitto-secure`.
#
# Monta, em tempo de subida, um diretório de runtime (/mosquitto/runtime) com
# tudo que o broker precisa ler e que NÃO pode ser versionado nem depender de
# permissões do host:
#
#   passwd      — hash gerado por mosquitto_passwd a partir de
#                 MQTT_SECURE_USERNAME / MQTT_SECURE_PASSWORD (vindas do .env)
#   acl         — acl.template com __MQTT_USER__ substituído
#   ca.crt          — cópia dos certificados montados em /mosquitto/certs (ro),
#   server.crt        reemitidos com dono/modo corretos para o uid do broker
#   server.key
#   client-test.crt — certificado de CLIENTE usado pelo healthcheck do
#   client-test.key   container: com mTLS obrigatório (ADR-0007) o próprio
#                     healthcheck precisa se autenticar por certificado
#
# Por que copiar os certificados em vez de lê-los direto do bind mount:
# num host Linux os arquivos gerados por scripts/gen-certs.sh pertencem ao
# usuário do pesquisador, enquanto o mosquitto larga privilégio e roda como
# `mosquitto` (uid 1883) — a leitura direta falharia por permissão de forma
# dependente do host. Copiando aqui (como root, igual faz o entrypoint da
# própria imagem) o broker fica independente do uid/gid do host.
#
# Este script roda como root e NÃO deixa o mosquitto rodando como root: a
# diretiva `user mosquitto` em mosquitto.conf faz o próprio broker largar
# privilégio depois de abrir a porta 8883.
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

# --------------------------------------------------------------------------- #
# 1. Pré-condições — falhar cedo e com mensagem acionável
# --------------------------------------------------------------------------- #

[ -n "${MQTT_SECURE_USERNAME:-}" ] || fail "MQTT_SECURE_USERNAME não definido (copie .env.example para .env)."
[ -n "${MQTT_SECURE_PASSWORD:-}" ] || fail "MQTT_SECURE_PASSWORD não definido (copie .env.example para .env)."

# O usuário é interpolado na ACL; restringir o alfabeto evita ACL corrompida.
case "${MQTT_SECURE_USERNAME}" in
  *[!A-Za-z0-9_.-]*)
    fail "MQTT_SECURE_USERNAME deve conter apenas [A-Za-z0-9_.-]."
    ;;
esac

# client-test.* entram na lista porque o broker exige mTLS (ADR-0007) e o
# healthcheck deste container é, ele mesmo, um cliente MQTT.
for f in ca.crt server.crt server.key client-test.crt client-test.key; do
  [ -s "${CERT_SRC_DIR}/${f}" ] || \
    fail "certificado ausente ou vazio: ${CERT_SRC_DIR}/${f} — rode ./scripts/gen-certs.sh no host antes de subir a stack."
done

[ -r "${ACL_TEMPLATE}" ] || fail "template de ACL não encontrado: ${ACL_TEMPLATE}"

# --------------------------------------------------------------------------- #
# 2. Diretório de runtime (estado limpo a cada subida)
# --------------------------------------------------------------------------- #

rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"

# --------------------------------------------------------------------------- #
# 3. Certificados
# --------------------------------------------------------------------------- #

cp "${CERT_SRC_DIR}/ca.crt"     "${RUNTIME_DIR}/ca.crt"
cp "${CERT_SRC_DIR}/server.crt" "${RUNTIME_DIR}/server.crt"
cp "${CERT_SRC_DIR}/server.key" "${RUNTIME_DIR}/server.key"
cp "${CERT_SRC_DIR}/client-test.crt" "${RUNTIME_DIR}/client-test.crt"
cp "${CERT_SRC_DIR}/client-test.key" "${RUNTIME_DIR}/client-test.key"
chmod 644 "${RUNTIME_DIR}/ca.crt" "${RUNTIME_DIR}/server.crt" "${RUNTIME_DIR}/client-test.crt"
chmod 600 "${RUNTIME_DIR}/server.key" "${RUNTIME_DIR}/client-test.key"
log "certificados copiados de ${CERT_SRC_DIR}."

# --------------------------------------------------------------------------- #
# 4. Arquivo de senha
# --------------------------------------------------------------------------- #

# -c cria/trunca (sem usuário órfão de uma configuração anterior);
# -b lê a senha do argumento em vez do terminal.
mosquitto_passwd -b -c "${RUNTIME_DIR}/passwd" "${MQTT_SECURE_USERNAME}" "${MQTT_SECURE_PASSWORD}"
chmod 600 "${RUNTIME_DIR}/passwd"
log "arquivo de senha gerado para o usuário '${MQTT_SECURE_USERNAME}'."

# --------------------------------------------------------------------------- #
# 5. ACL
# --------------------------------------------------------------------------- #

sed "s/__MQTT_USER__/${MQTT_SECURE_USERNAME}/g" "${ACL_TEMPLATE}" > "${RUNTIME_DIR}/acl"
chmod 600 "${RUNTIME_DIR}/acl"

if grep -q "__MQTT_USER__" "${RUNTIME_DIR}/acl"; then
  fail "placeholder __MQTT_USER__ não foi substituído na ACL."
fi
if ! grep -q "^user ${MQTT_SECURE_USERNAME}\$" "${RUNTIME_DIR}/acl"; then
  fail "ACL gerada sem a diretiva 'user ${MQTT_SECURE_USERNAME}'."
fi
log "ACL gerada em ${RUNTIME_DIR}/acl."

# --------------------------------------------------------------------------- #
# 6. Dono dos arquivos
# --------------------------------------------------------------------------- #

# O broker larga privilégio para `mosquitto` (uid 1883) e é como esse usuário
# que ele reabre passwd/acl/chave.
if [ "$(id -u)" = "0" ]; then
  chown -R "${BROKER_USER}:${BROKER_USER}" "${RUNTIME_DIR}"
else
  log "AVISO: rodando como uid $(id -u) (não-root); assumindo que ${RUNTIME_DIR} já é legível pelo broker."
fi

# --------------------------------------------------------------------------- #
# 7. Entrega o controle ao mosquitto (CMD do compose)
# --------------------------------------------------------------------------- #

log "iniciando: $*"
exec "$@"
