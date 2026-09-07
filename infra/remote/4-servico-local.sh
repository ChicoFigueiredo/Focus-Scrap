#!/bin/bash
# Passo 4 (na máquina de casa) — o túnel e o painel como serviços do systemd.
#
# Serviços de USUÁRIO, não de sistema: não precisam de sudo. Para subirem no
# boot sem ninguém abrir terminal, o linger tem de estar ligado — o script
# confere e avisa.
#
#   ./4-servico-local.sh          # instala túnel + painel
#   ./4-servico-local.sh tunel    # só o túnel (se preferir rodar o painel na mão)
set -euo pipefail
cd "$(dirname "$0")" && source ./config.sh

SO_TUNEL="${1:-}"
RAIZ=$(cd ../.. && pwd)
BUN=$(command -v bun || echo "$HOME/.bun/bin/bun")
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
mkdir -p "$HOME/.config/systemd/user"

cat > "$HOME/.config/systemd/user/focus-tunel.service" <<EOF
[Unit]
Description=Túnel SSH reverso do painel focus-scrap para a VPS
After=network-online.target
Wants=network-online.target

[Service]
# -N: nenhum shell do outro lado, só a porta. A chave é restrita na VPS a
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

if [[ "$SO_TUNEL" != "tunel" ]]; then
  # A porta não aparece aqui de propósito: o bun lê o .env do WorkingDirectory,
  # e lá está FOCUS_PANEL_PORT=$PORTA — o mesmo número que o túnel usa. Um lugar
  # só para a porta é o que impede os dois lados de saírem de sincronia.
  cat > "$HOME/.config/systemd/user/focus-painel.service" <<EOF
[Unit]
Description=Painel do focus-scrap
After=network-online.target

[Service]
# O traço em WorkingDirectory e a espera no ExecStart existem porque \$RAIZ mora
# num SSD separado (/mnt/d) e o acervo em outro (/mnt/e): o systemd sobe antes
# de os discos serem montados. Sem isto, o serviço falharia algumas vezes até o
# disco aparecer, na base do Restart.
WorkingDirectory=-$RAIZ
ExecStart=/bin/sh -c 'for i in \$(seq 1 90); do [ -d "$RAIZ" ] && break; sleep 2; done; \\
  cd "$RAIZ" || { echo "$RAIZ nao apareceu em 3 min"; exit 1; }; \\
  exec $BUN run src/cli.ts panel'
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
fi

systemctl --user daemon-reload
systemctl --user enable --now focus-tunel
[[ "$SO_TUNEL" != "tunel" ]] && systemctl --user enable --now focus-painel
sleep 3

systemctl --user --no-pager status focus-tunel | head -4
[[ "$SO_TUNEL" != "tunel" ]] && systemctl --user --no-pager status focus-painel | head -4

if [[ "$(loginctl show-user "$USER" -p Linger --value)" != "yes" ]]; then
  echo
  echo "AVISO: linger desligado — os serviços só sobem quando você abrir uma"
  echo "sessão. Para subirem no boot, sem login nenhum:"
  echo "    sudo loginctl enable-linger $USER"
fi
