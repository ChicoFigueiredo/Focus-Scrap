#!/bin/bash
# Um lugar só para as decisões. Os quatro passos leem daqui — trocar de domínio
# ou de servidor é mexer neste arquivo, e nada mais.

# Endereço público do painel. Precisa resolver para o IP do droplet ANTES de
# rodar o passo 3: o Let's Encrypt confirma o domínio batendo na porta 80.
DOMINIO=focus.chicofigueiredo.com.br

# Acesso administrativo ao droplet — usado só na instalação (passos 2 e 3).
DROPLET=root@ssh.lojapopcorn.com.br

# Para onde o túnel disca no dia a dia. Mesmo servidor, outro usuário: o do
# dia a dia é o 'tunel', que não tem shell.
TUNEL_HOST=ssh.lojapopcorn.com.br
TUNEL_USER=tunel

# A porta do painel. Vale dos dois lados do túnel e TEM de bater com o
# FOCUS_PANEL_PORT do .env — é o pareamento que faz a coisa toda funcionar.
PORTA=17788

# Usuário e e-mail do certificado.
USUARIO_PAINEL=chico
EMAIL_CERT=fran.fig@gmail.com

# Par de chaves exclusivo do túnel, gerado no passo 1.
CHAVE="$HOME/.ssh/focus_tunel"

# Rotas que executam coisa na máquina de casa. Ficam em 403 no nginx: do tablet
# se assiste e se marca aula como vista, não se dispara processo daqui.
ROTAS_BLOQUEADAS='run|requeue|revelar|abrir|sincronizar'
