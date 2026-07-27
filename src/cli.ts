/** Entrypoint do focus-scrap. `bun run <comando>` — ver package.json. */
import { login, type LoginResult } from "./auth.ts";
import type { Target } from "./config.ts";

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);

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
