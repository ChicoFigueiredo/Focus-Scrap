#!/bin/bash
# Passo 3 (roda daqui, age no droplet) — TLS, senha e proxy para a ponta do túnel.
#
#   ./3-droplet-nginx.sh              # sorteia a senha e mostra no fim
#   ./3-droplet-nginx.sh 'minha-senha' # usa a que você passar
#
# Este droplet já servia outros sites quando isto foi escrito, então o script é
# aditivo por princípio: cria um arquivo novo em sites-available, liga em
# sites-enabled e passa por `nginx -t` antes de recarregar. Não edita nem lê
# configuração de outro site.
#
# Pré-requisitos no droplet: nginx, certbot com plugin nginx, apache2-utils
# (htpasswd). Pré-requisito no DNS: $DOMINIO já resolvendo para o IP do droplet.
set -euo pipefail
cd "$(dirname "$0")" && source ./config.sh

SENHA="${1:-$(printf 'focus-%s-%s-%s' "$(openssl rand -hex 3)" "$(openssl rand -hex 3)" "$(openssl rand -hex 3)")}"

echo "conferindo o DNS de $DOMINIO…"
IP_DOM=$(getent hosts "$DOMINIO" | awk '{print $1}' | head -1)
IP_DROP=$(ssh "$DROPLET" 'curl -s -4 ifconfig.me')
[[ "$IP_DOM" == "$IP_DROP" ]] || {
  echo "  $DOMINIO → ${IP_DOM:-nada} mas o droplet é $IP_DROP"
  echo "  Acerte o DNS antes: o Let's Encrypt valida batendo na porta 80 deste nome."
  exit 1
}
echo "  ok: $IP_DOM"

ssh "$DROPLET" "DOMINIO='$DOMINIO' PORTA='$PORTA' USUARIO='$USUARIO_PAINEL' \
                SENHA='$SENHA' EMAIL='$EMAIL_CERT' BLOQ='$ROTAS_BLOQUEADAS' bash -s" <<'REMOTO'
set -euo pipefail

htpasswd -cbB /etc/nginx/focus.htpasswd "$USUARIO" "$SENHA" >/dev/null
chmod 640 /etc/nginx/focus.htpasswd
chown root:www-data /etc/nginx/focus.htpasswd

# auth_basic vai DENTRO das locations, nunca no server. Se fosse no server, a
# location que o certbot injeta para o desafio do Let's Encrypt nasceria atrás
# da senha e a emissão do certificado falharia.
cat > "/etc/nginx/sites-available/$DOMINIO" <<EOF
# Painel do focus-scrap, que roda na máquina de casa e chega aqui por um túnel
# SSH reverso. 502 significa que o túnel chegou mas não achou o painel do outro
# lado — PC desligado, painel parado, ou painel em outra porta.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;

    # Rotas que executam coisa na máquina de casa: disparar scrape, transcrever,
    # abrir arquivo no Explorer. Não têm por que existir a partir do tablet.
    location ~ ^/api/($BLOQ)\$ {
        auth_basic "focus-scrap";
        auth_basic_user_file /etc/nginx/focus.htpasswd;
        return 403;
    }

    location / {
        auth_basic "focus-scrap";
        auth_basic_user_file /etc/nginx/focus.htpasswd;

        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Vídeo: repassa o corpo conforme chega, em vez de tentar guardar o
        # arquivo inteiro em disco antes de responder. É o que faz o seek do
        # player funcionar, com o Range chegando inteiro no bun do outro lado.
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_max_temp_file_size 0;
        proxy_read_timeout 300s;
        client_max_body_size 16m;
    }
}
EOF

ln -sfn "/etc/nginx/sites-available/$DOMINIO" "/etc/nginx/sites-enabled/$DOMINIO"
nginx -t
systemctl reload nginx

# --redirect põe o 301 de http para https. A renovação já fica agendada pelo
# próprio certbot (systemd timer).
certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "$EMAIL" --redirect
REMOTO

echo
echo "───────────────────────────────────────────────"
echo " https://$DOMINIO"
echo " usuário: $USUARIO_PAINEL"
echo " senha:   $SENHA"
echo "───────────────────────────────────────────────"
echo "Anote a senha: ela só existe em bcrypt no droplet daqui para a frente."
