#!/bin/bash
# Passo 2 (roda daqui, age no droplet) — o usuário que recebe o túnel.
#
# Sem shell e com a chave trancada em UM encaminhamento: mesmo de posse da
# chave privada não se abre sessão, não se encaminha outra porta, não se usa
# agente nem X11. O que se alcança é um painel que ainda pede senha.
#
# Idempotente: pode rodar de novo à vontade.
set -euo pipefail
cd "$(dirname "$0")" && source ./config.sh

[[ -f "$CHAVE.pub" ]] || { echo "rode ./1-chave-local.sh antes"; exit 1; }
PUB=$(cat "$CHAVE.pub")

ssh "$DROPLET" "TUNEL_USER='$TUNEL_USER' PORTA='$PORTA' PUB='$PUB' bash -s" <<'REMOTO'
set -euo pipefail

id "$TUNEL_USER" >/dev/null 2>&1 || useradd -m -s /usr/sbin/nologin "$TUNEL_USER"
install -d -m 700 -o "$TUNEL_USER" -g "$TUNEL_USER" "/home/$TUNEL_USER/.ssh"

# 'restrict' desliga tudo e devolve só o encaminhamento; os três permitlisten
# cobrem as formas como o cliente pode pedir a mesma porta (sem host, com
# 'localhost', com '127.0.0.1'). Exige OpenSSH 7.9+ no servidor.
cat > "/home/$TUNEL_USER/.ssh/authorized_keys" <<EOF
restrict,port-forwarding,permitlisten="${PORTA}",permitlisten="localhost:${PORTA}",permitlisten="127.0.0.1:${PORTA}" ${PUB}
EOF
chown "$TUNEL_USER:$TUNEL_USER" "/home/$TUNEL_USER/.ssh/authorized_keys"
chmod 600 "/home/$TUNEL_USER/.ssh/authorized_keys"

echo "usuário $TUNEL_USER pronto, preso à porta $PORTA"
REMOTO
