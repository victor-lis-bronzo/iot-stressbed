# ADR-0007: mTLS (certificado de cliente) no broker secure

## Status
Aceito.

## Contexto
A Fase 0.5 implementou o broker secure com TLS (criptografia de transporte) +
autenticação por usuário/senha. Na revisão dessa entrega, o usuário decidiu que o grupo
de controle deveria exigir também certificado de cliente válido (mTLS), não apenas senha,
para autenticar no `mosquitto-secure`.

## Decisão
O `mosquitto-secure` exige **mTLS**: além do handshake TLS padrão (que já criptografa o
transporte e autentica o servidor), o cliente deve apresentar um certificado assinado
pela mesma CA local usada para o certificado do broker. Conexões com certificado
ausente, expirado ou não assinado por essa CA são recusadas no handshake TLS, antes
mesmo do CONNECT do MQTT. A autenticação por usuário/senha (já implementada) é mantida
como uma segunda camada, não substituída pelo mTLS.

## Alternativas descartadas
- **Só TLS + senha (decisão original da Fase 0.5)**: suficiente para provar
  criptografia + autenticação básica, mas o usuário preferiu exigir também prova
  criptográfica de posse de certificado — um grupo de controle mais rigoroso e mais
  representativo de um deployment MQTTS hardened de verdade.
- **Só mTLS, sem senha**: rejeitado — a camada de senha já estava implementada e
  funcionando (Fase 0.5); não há motivo para removê-la só por adicionar mTLS. Duas
  camadas de autenticação independentes (certificado + credencial) tornam o controle
  ainda mais forte, sem custo adicional relevante.

## Consequências
- `scripts/gen-certs.sh` precisa gerar, além do certificado de servidor, um (ou mais)
  certificado(s) de cliente assinado(s) pela mesma CA local, para uso por `capture`
  (adapter secure) e por qualquer ferramenta de teste que precise se conectar ao
  broker secure.
- `infra/mosquitto/secure/mosquitto.conf` precisa `require_certificate true` (e
  tipicamente `use_identity_as_username` ou equivalente, a critério de quem implementar,
  desde que a checagem de senha continue sendo aplicada por cima).
- Qualquer cliente que se conectar ao `mosquitto-secure` — incluindo o adapter de
  `capture` e os testes manuais do protocolo de experimento — precisa apresentar o
  certificado de cliente, não só usuário/senha. Isso deve ser refletido em
  `docs/specs/capture-module.md` e no protocolo de experimento quando escritos/revisados.
- O critério de aceite de Track A "subscriber sem certificado/credencial válida é
  recusado no CONNECT" (já presente em `docs/spec.md`) passa a ser verificado também na
  camada TLS (handshake recusado antes do CONNECT), não só na camada de aplicação.
