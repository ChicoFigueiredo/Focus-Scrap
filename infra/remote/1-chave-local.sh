#!/bin/bash
# Passo 1 (na máquina de casa) — o par de chaves exclusivo do túnel.
#
# Exclusivo de propósito: a chave que fica guardada num serviço que reconecta
# sozinho a noite toda não deve ser a mesma com que você administra o servidor.
# Esta aqui, no passo 2, é trancada para só encaminhar uma porta.
set -euo pipefail
cd "$(dirname "$0")" && source ./config.sh

if [[ -f "$CHAVE" ]]; then
  echo "chave já existe em $CHAVE — mantendo"
else
  ssh-keygen -t ed25519 -f "$CHAVE" -N "" -C "focus-tunel@$(hostname)"
  echo "chave criada em $CHAVE"
fi

echo
echo "pública (vai para o droplet no passo 2):"
cat "$CHAVE.pub"
