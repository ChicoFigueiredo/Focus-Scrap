#!/usr/bin/env bash
# Recuperação dos itens que ficaram em erro.
#
# Dois motivos distintos, e a ordem importa:
#
#   1. PDF do IESDE vem por URL assinada de validade curta. Um catálogo de
#      horas atrás já não baixa — precisa recatalogar a disciplina para renovar
#      a assinatura, e baixar logo em seguida.
#   2. Vídeo que falhou por sobrecarga do servidor: uma segunda passada, com o
#      download já terminado e sem disputa, costuma resolver.
#
# Uso: scripts/recuperar.sh [id da disciplina ...]
set -uo pipefail
cd "$(dirname "$0")/.."

DISCIPLINAS=("$@")
if [ ${#DISCIPLINAS[@]} -eq 0 ]; then
  # Sem argumento, recatalogar as disciplinas que têm item em erro.
  mapfile -t DISCIPLINAS < <(bun -e '
    import { connect } from "./src/db.ts";
    const db = connect();
    const rs = db.query(`SELECT DISTINCT d.id FROM items i
      JOIN modules m ON m.id=i.module_id JOIN disciplines d ON d.id=m.discipline_id
      WHERE i.download_status="error"`).all();
    for (const r of rs) console.log(r.id);
  ' 2>/dev/null | grep -E '^[0-9]+$')
fi

echo "disciplinas a renovar: ${DISCIPLINAS[*]:-nenhuma}"
for id in "${DISCIPLINAS[@]}"; do
  echo "--- recatalogando $id ---"
  bun run src/cli.ts scrape --disciplina "$id" 2>&1 | tail -3
done

echo "--- reenfileirando erros ---"
bun run src/cli.ts requeue

echo "--- baixando e transcrevendo ---"
uv run python -m focus.worker

echo "--- conferência de integridade ---"
uv run python -m focus.verify

echo "--- reconciliando com o disco ---"
bun run src/cli.ts scan | tail -2
