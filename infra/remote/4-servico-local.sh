#!/bin/bash
# Passo 4 (na máquina de casa) — o túnel como serviço do systemd.
#
# Serviço de USUÁRIO, não de sistema: não precisa de sudo. Para ele subir com o
# WSL sem ninguém abrir terminal, o linger tem de estar ligado — o script
# confere e avisa.
set -euo pipefail
cd "$(dirname "$0")" && source ./config.sh

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
UNIDADE="$HOME/.config/systemd/user/focus-tunel.service"
mkdir -p "$(dirname "$UNIDADE")"

cat > "$UNIDADE" <<EOF
[Unit]
Description=Túnel SSH reverso do painel focus-scrap para o droplet
After=network-online.target
Wants=network-online.target

[Service]
# -N: nenhum shell do outro lado, só a porta. A chave é restrita no droplet a
#     exatamente este encaminhamento — não serve para mais nada.
# ExitOnForwardFailure: se a $PORTA de lá já estiver ocupada, morre em vez de
#     ficar de pé fingindo que funciona; o Restart tenta de novo em seguida.
# ServerAlive*: derruba em ~90s de silêncio. É o que refaz o túnel sozinho
#     depois de queda de internet, troca de IP ou o PC voltar de suspensão.
ExecStart=/usr/bin/ssh -NT \\
  -i $CHAVE \\
  -o BatchMode=yes \\
  -o ExitOnForwardFailure=yes \\
  -o ServerAliveInterval=30 \\
  -o ServerAliveCountMax=3 \\
  -o StrictHostKeyChecking=accept-new \\
  -R $PORTA:127.0.0.1:$PORTA \\
  $TUNEL_USER@$TUNEL_HOST
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now focus-tunel
sleep 3
systemctl --user --no-pager status focus-tunel | head -5

if [[ "$(loginctl show-user "$USER" -p Linger --value)" != "yes" ]]; then
  echo
  echo "AVISO: linger desligado — o túnel só vai subir quando você abrir um"
  echo "terminal do WSL. Para subir junto com o WSL:"
  echo "    sudo loginctl enable-linger $USER"
fi
