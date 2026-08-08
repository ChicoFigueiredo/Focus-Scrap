#!/bin/bash
# Diagnóstico da corrente inteira, elo por elo. É o que responder quando o
# tablet mostrar 502 ou pedir senha para sempre.
#
#   ./verificar.sh                 # tudo que dá para conferir sem a senha
#   SENHA='...' ./verificar.sh     # inclui as conferências autenticadas
cd "$(dirname "$0")" && source ./config.sh
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

falhou=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
nao()  { printf '  \033[31mfalha\033[0m %s\n' "$1"; falhou=1; }
dica() { printf '        ↳ %s\n' "$1"; }

echo
echo "1. a porta combinada ($PORTA)"
ENV_PORTA=$(grep -oP '^FOCUS_PANEL_PORT=\K.*' ../../.env 2>/dev/null || true)
if [[ -z "$ENV_PORTA" ]]; then
  nao ".env não fixa FOCUS_PANEL_PORT — 'bun run panel' vai abrir na 7788"
  dica "acrescente FOCUS_PANEL_PORT=$PORTA ao .env"
elif [[ "$ENV_PORTA" != "$PORTA" ]]; then
  nao ".env diz $ENV_PORTA, o túnel usa $PORTA"
  dica "os dois têm de bater; ajuste o .env ou o config.sh"
else
  ok ".env e túnel combinam na $PORTA"
fi

echo
echo "2. o painel, aqui"
# É o painel mesmo, e não qualquer coisa escutando: procuro a assinatura da
# página. Há outros 'bun' na máquina, então achar pelo nome do processo erraria.
eh_painel() { curl -s --max-time 2 "http://127.0.0.1:$1/" 2>/dev/null | grep -q 'focus-scrap'; }

if eh_painel "$PORTA"; then
  ok "respondendo em 127.0.0.1:$PORTA"
else
  nao "nada em 127.0.0.1:$PORTA"
  # O painel tenta 20 portas seguidas quando a pedida está ocupada. Se ele foi
  # parar numa delas, é local funcionando e remoto em 502 — o caso mais chato.
  OUTRA=""
  for p in $(seq $((PORTA + 1)) $((PORTA + 19))); do
    if eh_painel "$p"; then OUTRA=$p; break; fi
  done
  if [[ -n "$OUTRA" ]]; then
    dica "o painel está na $OUTRA: a $PORTA estava ocupada e ele pulou"
    dica "libere a $PORTA (ss -lntp 'sport = :$PORTA') e reinicie o painel"
  else
    dica "inicie com: bun run panel"
  fi
fi

echo
echo "3. o túnel, daqui até o droplet"
if [[ "$(systemctl --user is-active focus-tunel 2>/dev/null)" == "active" ]]; then
  ok "focus-tunel.service de pé (reinícios: $(systemctl --user show focus-tunel -p NRestarts --value))"
else
  nao "focus-tunel.service parado"
  dica "systemctl --user restart focus-tunel && journalctl --user -u focus-tunel -n 30"
fi

echo
echo "4. a ponta do túnel, no droplet"
PONTA=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$DROPLET" \
  "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:$PORTA/" 2>/dev/null || echo erro)
[[ "$PONTA" == "200" ]] \
  && ok "o droplet enxerga o painel (HTTP $PONTA)" \
  || { nao "o droplet não enxerga o painel (HTTP $PONTA)"; dica "se 1 a 3 estão ok, o túnel caiu agora — reinicie o serviço"; }

echo
echo "5. a porta pública"
SEM=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMINIO/")
[[ "$SEM" == "401" ]] \
  && ok "exige senha (HTTP 401)" \
  || nao "esperava 401 sem senha, veio $SEM"

if [[ -n "${SENHA:-}" ]]; then
  COM=$(curl -s -u "$USUARIO_PAINEL:$SENHA" -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMINIO/")
  [[ "$COM" == "200" ]] && ok "abre com a senha (HTTP 200)" || nao "com a senha veio $COM"

  BLO=$(curl -s -u "$USUARIO_PAINEL:$SENHA" -X POST -o /dev/null -w '%{http_code}' \
        --max-time 20 "https://$DOMINIO/api/run?tarefa=scrape")
  [[ "$BLO" == "403" ]] && ok "rotas de execução barradas (HTTP 403)" || nao "/api/run devolveu $BLO, esperava 403"

  RANGE=$(curl -s -u "$USUARIO_PAINEL:$SENHA" -r 0-1023 -o /dev/null -w '%{http_code}' \
          --max-time 20 "https://$DOMINIO/media/388" 2>/dev/null)
  [[ "$RANGE" == "206" ]] \
    && ok "vídeo com Range (HTTP 206) — o seek do player funciona" \
    || printf '  \033[33maviso\033[0m /media/388 devolveu %s (o item pode não existir mais)\n' "$RANGE"
else
  printf '  \033[33maviso\033[0m sem SENHA no ambiente: pulei as conferências autenticadas\n'
fi

echo
[[ $falhou -eq 0 ]] && echo "tudo certo." || echo "há elo quebrado acima."
exit $falhou
