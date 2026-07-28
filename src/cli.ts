/** Entrypoint do focus-scrap. `bun run <comando>` — ver package.json. */
import { login, type LoginResult } from "./auth.ts";
import { connect, destravar, reenfileirar, stats } from "./db.ts";
import { explorarDisciplina } from "./lesson.ts";
import { scan } from "./scan.ts";
import { assistir, pendentes } from "./assistir.ts";
import { comErro, scrape } from "./scrape.ts";
import { servir } from "./panel.ts";
import { PANEL_PORT, type Target } from "./config.ts";

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const valor = (name: string, padrao: number) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? Number(rest[i + 1]) : padrao;
};
const MATRICULA = valor("enrollment", 28859);

function report(r: LoginResult): void {
  console.log(`${r.ok ? "✓" : "✗"} ${r.target}: ${r.ok ? "ok" : "falhou"}`);
  console.log("   url final:", r.finalUrl);
  console.log("  ", r.message);
  if (r.apiCalls.length) {
    console.log("   endpoints observados:");
    for (const c of r.apiCalls) console.log("    ", c);
  }
}

switch (command) {
  case "login": {
    const alvos: Target[] = flag("portal") ? ["portal"] : flag("ava") ? ["ava"] : ["portal", "ava"];
    let falhou = false;
    for (const alvo of alvos) {
      const r = await login(alvo, { headed: flag("headed") });
      report(r);
      falhou ||= !r.ok;
    }
    process.exit(falhou ? 1 : 0);
  }

  case "explore": {
    // Diagnóstico: navega o accordion de UMA disciplina e mostra o que achou.
    const r = await explorarDisciplina(MATRICULA, valor("disciplina", 603), { headed: flag("headed") });
    console.log(`disciplina ${r.disciplinaId} — ${r.modulos.length} módulos, ${r.lessons.length} lessons\n${r.url}\n`);
    for (const l of r.lessons) {
      console.log(`▸ [${l.moduloIndice}] ${l.modulo} → ${l.lesson}  (${l.fontes.tipo})`);
      if (l.erro) console.log(`   erro: ${l.erro}`);
      for (const [rotulo, u] of Object.entries(l.fontes))
        if (rotulo !== "tipo" && u) console.log(`   ${rotulo.padEnd(12)} ${u}`);
      // Sem isto o diagnóstico fica cego justamente quando mais importa: uma
      // lesson que o classificador não reconhece imprimia uma linha vazia, e o
      // dado cru — que revelaria a família de conteúdo nova — ficava escondido.
      if (l.fontes.tipo === "desconhecido") {
        for (const u of l.iframes) console.log(`   iframe cru   ${u}`);
        for (const u of l.rede) console.log(`   rede crua    ${u}`);
        for (const u of l.links) console.log(`   link cru     ${u}`);
        if (!l.iframes.length && !l.rede.length && !l.links.length)
          console.log(`   (nada capturado) texto: ${l.texto.slice(0, 110)}`);
      }
      console.log();
    }
    break;
  }

  case "scrape": {
    const db = connect();
    const apenas = rest.includes("--disciplina")
      ? [valor("disciplina", 0)]
      : flag("com-erro")
        // Recatalogar só o que falhou é o caso de uso real: renova a URL
        // assinada do IESDE sem gastar ~40 min refazendo as 9 disciplinas.
        ? comErro(db)
        : undefined;
    if (flag("com-erro")) console.log(`disciplinas com erro: ${apenas!.join(", ") || "nenhuma"}`);
    const r = await scrape(db, MATRICULA, { apenas, continuar: flag("continuar"), aoProgredir: (m) => console.log(m) });
    console.log(`\n${r.disciplinas} disciplina(s), ${r.modulos} módulo(s), ${r.itens} item(ns)`);
    if (r.avisos.length) {
      console.log("\navisos:");
      for (const a of r.avisos) console.log(" ⚠", a);
    }
    db.close();
    break;
  }

  case "scan": {
    const db = connect();
    const r = scan(db, { aoProgredir: (m) => console.log(m) });
    console.log(`\n${r.casados}/${r.varridos} já no disco · ${r.transcritos} já transcrito(s) · ${r.renomeados} reapontado(s) · ${r.semArquivo} pendente(s)`);
    for (const o of r.orfaos) console.log(" ⚠", o);
    db.close();
    break;
  }

  case "status": {
    const db = connect();
    const s = stats(db);
    console.log(`disciplinas ${s.disciplinas} · módulos ${s.modulos} · itens ${s.itens}`);
    console.log(`tipos      `, s.porTipo);
    console.log(`download   `, s.porStatus);
    console.log(`bytes       ${(s.bytes / 1e9).toFixed(2)} GB`);
    db.close();
    break;
  }

  case "requeue": {
    const db = connect();
    const n = reenfileirar(db, flag("transcribe") ? "transcribe" : "download");
    console.log(`${n} item(ns) reenfileirado(s)`);
    db.close();
    break;
  }

  case "assistir": {
    // Último recurso: navegador visível, o Chico navega, o programa captura.
    const db = connect();
    const disc = rest.includes("--disciplina")
      ? valor("disciplina", 0)
      : pendentes(db)[0]?.disc_id;
    if (!disc) { console.log("nada pendente — nada a assistir."); db.close(); break; }
    const r = await assistir(db, MATRICULA, disc, { minutos: valor("minutos", 20) });
    console.log(`\n${r.capturadas} URL(s) capturada(s), ${r.atualizados} item(ns) atualizado(s)`);
    if (r.atualizados) console.log("Agora rode: bun run media");
    db.close();
    break;
  }

  case "faltando": {
    const db = connect();
    const ps = pendentes(db);
    console.log(`${ps.length} item(ns) faltando:`);
    for (const p of ps)
      console.log(` disc ${String(p.disc_id).padEnd(5)} ${p.disc_pos}.${p.mod_pos}.${p.pos} [${p.kind.padEnd(5)}] ${p.title.slice(0,44)}`);
    db.close();
    break;
  }

  case "panel": {
    const db = connect();
    destravar(db);
    servir(db, PANEL_PORT);
    break;   // servidor segue rodando
  }

  default: {
    console.error("uso: bun run <login|scrape|scan|status|panel|requeue|explore|assistir|faltando>");
    console.error("     --enrollment <id>   matrícula (padrão 28859)");
    console.error("     --disciplina <id>   restringe a uma disciplina");
    console.error("     --com-erro          só as disciplinas com item em erro");
    console.error("     --continuar         pula as já catalogadas");
    console.error("     --headed            abre o navegador para depurar");
    process.exit(1);
  }
}
