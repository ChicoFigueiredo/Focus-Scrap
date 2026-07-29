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

/** Roda um comando e devolve o código; não lança. */
async function rodar(cmd: string[]): Promise<number> {
  try {
    const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    return await p.exited;
  } catch {
    return -1;
  }
}

async function paraWindows(caminho: string): Promise<string | null> {
  const p = Bun.spawn(["wslpath", "-w", caminho], { stdout: "pipe", stderr: "ignore" });
  const saida = (await new Response(p.stdout).text()).trim();
  await p.exited;
  return p.exitCode === 0 && saida ? saida : null;
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
    // `/select,` precisa vir COLADO no caminho — com espaço o Explorer abre a
    // pasta errada. E o explorer.exe devolve 1 mesmo quando funciona, então o
    // código de saída não serve para decidir sucesso.
    await rodar(["explorer.exe", `/select,${win}`]);
    return { ok: true, msg: "Explorer aberto", caminho: win };
  }

  // Fora do WSL: tenta os gerenciadores que sabem selecionar o arquivo, e
  // por último abre só a pasta.
  for (const cmd of [
    ["nautilus", "--select", alvo],
    ["dolphin", "--select", alvo],
    ["nemo", alvo],
    ["thunar", alvo],
  ]) {
    if (Bun.which(cmd[0]!) && (await rodar(cmd)) === 0)
      return { ok: true, msg: `${cmd[0]} aberto`, caminho: alvo };
  }
  if (Bun.which("xdg-open") && (await rodar(["xdg-open", dirname(alvo)])) === 0)
    return { ok: true, msg: "pasta aberta", caminho: alvo };

  return { ok: false, msg: "nenhum gerenciador de arquivos disponível", caminho: alvo };
}

/** Caminho absoluto de um item, a partir do `rel_path` do banco. */
export function caminhoDoItem(relPath: string): string {
  return join(REPOSITORY, relPath);
}

/** Caminho como o usuário veria no sistema — para exibir e copiar. */
export async function caminhoLegivel(alvo: string): Promise<string> {
  return (noWsl() ? await paraWindows(alvo) : null) ?? alvo;
}
