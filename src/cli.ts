/** Entrypoint do focus-scrap. `bun run <comando>` — ver package.json. */
import { login, type LoginResult } from "./auth.ts";
import { explorarDisciplina } from "./lesson.ts";
import type { Target } from "./config.ts";

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const valor = (name: string, padrao: number) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? Number(rest[i + 1]) : padrao;
};

const PENDENTES = ["scan", "scrape", "media", "panel", "status"] as const;

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
    // Sem alvo explícito, autentica nos dois: o portal traz as matrículas,
    // o AVA (Moodle) traz o conteúdo.
    const alvos: Target[] = flag("portal")
      ? ["portal"]
      : flag("ava")
        ? ["ava"]
        : ["portal", "ava"];

    let falhou = false;
    for (const alvo of alvos) {
      const r = await login(alvo, { headed: flag("headed") });
      report(r);
      falhou ||= !r.ok;
    }
    process.exit(falhou ? 1 : 0);
  }

  case "explore": {
    // Navega o accordion inteiro de uma disciplina e mostra o que cada lesson
    // carrega. É o passo que revela as URLs de material (não estão na API).
    const enr = valor("enrollment", 28859);
    const disc = valor("disciplina", 603);
    const r = await explorarDisciplina(enr, disc, { headed: flag("headed") });
    console.log(`disciplina ${r.disciplinaId} — ${r.modulos.length} módulos, ${r.lessons.length} lessons`);
    console.log(r.url, "\n");
    for (const l of r.lessons) {
      const f = l.fontes;
      console.log(`▸ [${l.moduloIndice}] ${l.modulo} → ${l.lesson}  (${f.tipo})`);
      if (l.erro) console.log(`   erro: ${l.erro}`);
      for (const [rotulo, u] of Object.entries(f))
        if (rotulo !== "tipo" && u) console.log(`   ${rotulo.padEnd(12)} ${u}`);
      if (f.tipo === "desconhecido")
        console.log(`   (não classificado) texto: ${l.texto.slice(0, 110)}`);
      console.log();
    }
    if (flag("json")) await Bun.write(`explore-${disc}.json`, JSON.stringify(r, null, 2));
    break;
  }

  default: {
    if (command && (PENDENTES as readonly string[]).includes(command)) {
      console.error(`'${command}' ainda não foi implementado.`);
      process.exit(2);
    }
    console.error(`uso: bun run <login${PENDENTES.map((c) => `|${c}`).join("")}>`);
    console.error("     bun run login --ava       # só o Moodle");
    console.error("     bun run login --portal    # só o portal");
    console.error("     bun run login --headed    # abre o navegador para depurar");
    process.exit(1);
  }
}
