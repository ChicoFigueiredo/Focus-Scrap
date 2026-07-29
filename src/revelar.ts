/**
 * "Mostrar na pasta" — abre o gerenciador de arquivos do sistema com o item
 * selecionado, para arrastar, copiar ou abrir em outro programa.
 *
 * O navegador não faz isso: a sandbox impede qualquer página de mexer no
 * sistema de arquivos. Mas o painel é um servidor **local**, então quem executa
 * é o backend, a pedido da página.
 *
 * O caso desta máquina é WSL com o acervo num disco Windows (`/mnt/e/…`). O
 * Explorer não entende caminho POSIX, então `wslpath -w` traduz para `E:\\…`
 * antes. Fora do WSL, cai nos gerenciadores nativos.
 *
 * Segurança: o caminho **nunca** vem da requisição. A página manda o id do
 * item, e o caminho sai do banco — assim uma URL forjada não vira "abra
 * qualquer arquivo da máquina". Ainda assim se confere que o alvo está dentro
 * do acervo antes de executar qualquer coisa.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { REPOSITORY } from "./config.ts";

export interface Revelado {
  ok: boolean;
  msg: string;
  /** Caminho no formato do sistema, para a página mostrar e copiar. */
  caminho?: string;
}

export interface Execucao {
  cmd: string;
  codigo: number;
  saida: string;
  erro: string;
}

/** Onde o painel registra o que tentou — alimentado a cada chamada. */
export const diario: Execucao[] = [];

/**
 * Roda um comando e REGISTRA tudo: linha executada, código, stdout e stderr.
 *
 * A versão anterior descartava as três coisas (`ignore` nos fluxos, `catch`
 * vazio) e devolvia só um número. Quando o Explorer não abria, não havia nada
 * para olhar — nem o comando, nem a reclamação do Windows.
 */
async function rodar(cmd: string[], opts: { cwd?: string } = {}): Promise<Execucao> {
  const linha = cmd.join(" ");
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", ...opts });
    const [saida, erro] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ]);
    const r: Execucao = {
      cmd: linha, codigo: await p.exited,
      saida: saida.trim().slice(0, 400), erro: erro.trim().slice(0, 400),
    };
    console.log(`[revelar] ${linha}`);
    console.log(`[revelar]   código=${r.codigo}` +
      (r.saida ? ` saída="${r.saida}"` : "") + (r.erro ? ` erro="${r.erro}"` : ""));
    diario.unshift(r);
    diario.length = Math.min(diario.length, 20);
    return r;
  } catch (e) {
    const r: Execucao = { cmd: linha, codigo: -1, saida: "", erro: String(e).slice(0, 400) };
    console.error(`[revelar] FALHOU ao executar: ${linha}\n[revelar]   ${r.erro}`);
    diario.unshift(r);
    return r;
  }
}

async function paraWindows(caminho: string): Promise<string | null> {
  const p = Bun.spawn(["wslpath", "-w", caminho], { stdout: "pipe", stderr: "pipe" });
  const [saida, erro] = await Promise.all([
    new Response(p.stdout).text(), new Response(p.stderr).text(),
  ]);
  await p.exited;
  if (p.exitCode !== 0 || !saida.trim()) {
    console.error(`[revelar] wslpath -w falhou (${p.exitCode}): ${erro.trim() || "sem saída"}`);
    return null;
  }
  console.log(`[revelar] wslpath: ${caminho}\n[revelar]        → ${saida.trim()}`);
  return saida.trim();
}

/** Estamos num WSL? O acervo aqui mora num disco Windows montado. */
function noWsl(): boolean {
  return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop") || !!process.env.WSL_DISTRO_NAME;
}

/**
 * Abre o gerenciador de arquivos com `alvo` selecionado.
 * `alvo` é caminho absoluto e precisa estar dentro do acervo.
 */
export async function revelar(alvo: string): Promise<Revelado> {
  if (!alvo.startsWith(REPOSITORY)) return { ok: false, msg: "fora do acervo" };
  if (!existsSync(alvo)) return { ok: false, msg: "arquivo não está no disco" };

  if (noWsl()) {
    const win = await paraWindows(alvo);
    if (!win) return { ok: false, msg: "wslpath não converteu o caminho" };
    // NÃO chamar `explorer.exe /select,…` direto: o interop do WSL trata
    // argumento começando com "/" como caminho POSIX e o mangla, então o
    // comando sai sem erro, com código 1 (o normal do explorer) e SEM abrir
    // janela nenhuma. Medido: 11 janelas antes, 11 depois.
    //
    // Passando por `cmd.exe /c`, quem interpreta o `/select,` é o Windows, e
    // aí funciona. O `/select,` precisa vir COLADO no caminho — com espaço o
    // Explorer abre a pasta errada. O `cwd` em /mnt/c existe para o cmd não
    // avisar que o diretório atual é `\\wsl.localhost\…` a cada chamada. E o
    // explorer devolve 1 mesmo dando certo, então só stderr acusa problema.
    const r = await rodar(
      ["cmd.exe", "/c", `explorer.exe /select,"${win}"`],
      { cwd: "/mnt/c" },
    );
    return r.erro
      ? { ok: false, msg: `cmd.exe reclamou: ${r.erro}`, caminho: win }
      : { ok: true, msg: "Explorer aberto", caminho: win };
  }

  // Fora do WSL: tenta os gerenciadores que sabem selecionar o arquivo, e
  // por último abre só a pasta.
  for (const cmd of [
    ["nautilus", "--select", alvo],
    ["dolphin", "--select", alvo],
    ["nemo", alvo],
    ["thunar", alvo],
  ]) {
    if (Bun.which(cmd[0]!) && (await rodar(cmd)).codigo === 0)
      return { ok: true, msg: `${cmd[0]} aberto`, caminho: alvo };
  }
  if (Bun.which("xdg-open") && (await rodar(["xdg-open", dirname(alvo)])).codigo === 0)
    return { ok: true, msg: "pasta aberta", caminho: alvo };

  return { ok: false, msg: "nenhum gerenciador de arquivos disponível", caminho: alvo };
}

/**
 * Abre o alvo no programa padrão do sistema — o equivalente ao `start` do
 * PowerShell, ou ao duplo clique.
 *
 * No WSL isso funciona porque o binfmt_misc (`WSLInterop`) deixa executar
 * qualquer `.exe` do Windows direto do Linux. Três caminhos servem:
 *
 *   explorer.exe <caminho>                  usado aqui
 *   cmd.exe /c start "" <caminho>           o `start` literal
 *   powershell.exe -c Start-Process <cam>   idem
 *
 * Escolhi o `explorer.exe` por ser o mesmo binário do "mostrar na pasta" e por
 * não reclamar de caminho UNC — o `cmd.exe` avisa que o diretório atual é
 * `\\wsl.localhost\…` toda vez. Em compensação ele SEMPRE devolve 1, então o
 * código de saída não diz nada sobre ter dado certo.
 */
export async function abrirNoSistema(alvo: string): Promise<Revelado> {
  if (!alvo.startsWith(REPOSITORY)) return { ok: false, msg: "fora do acervo" };
  if (!existsSync(alvo)) return { ok: false, msg: "arquivo não está no disco" };

  if (noWsl()) {
    const win = await paraWindows(alvo);
    if (!win) return { ok: false, msg: "wslpath não converteu o caminho" };
    const r = await rodar(["explorer.exe", win]);
    return r.erro
      ? { ok: false, msg: `explorer.exe reclamou: ${r.erro}`, caminho: win }
      : { ok: true, msg: "aberto no programa padrão do Windows", caminho: win };
  }
  if (Bun.which("xdg-open") && (await rodar(["xdg-open", alvo])).codigo === 0)
    return { ok: true, msg: "aberto", caminho: alvo };
  return { ok: false, msg: "não há como abrir neste sistema", caminho: alvo };
}

/** Caminho absoluto de um item, a partir do `rel_path` do banco. */
export function caminhoDoItem(relPath: string): string {
  return join(REPOSITORY, relPath);
}

/** Caminho como o usuário veria no sistema — para exibir e copiar. */
export async function caminhoLegivel(alvo: string): Promise<string> {
  return (noWsl() ? await paraWindows(alvo) : null) ?? alvo;
}
