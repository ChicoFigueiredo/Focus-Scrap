/**
 * Painel web do focus-scrap — `bun run panel`, depois http://127.0.0.1:7788
 *
 * Mesmo papel do painel do kultivi: ver o progresso sem abrir o banco na mão.
 * Duas telas — dashboard (números, fila, eventos) e explorador (árvore do curso,
 * com o vídeo tocando no próprio navegador).
 *
 * Servido pelo `Bun.serve` sem dependência nenhuma: HTML, CSS e JS inline. É um
 * painel local de uma pessoa só; um bundler aqui seria peso morto.
 *
 * O streaming de vídeo implementa `Range` de verdade — sem isso o navegador não
 * deixa arrastar a linha do tempo, só tocar do começo.
 */
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { BASE_DIR, CURSO_PASTA, PANEL_HOST, REPOSITORY } from "./config.ts";
import { ARQ_INDICE, ARQ_TRANSCRICAO, PASTA as PASTA_ESCRITOS } from "./escritos.ts";
import { lerTrechos, srtParaVtt } from "./legenda.ts";
import { PAGINA } from "./panel-ui.ts";
import { log, reenfileirar, stats } from "./db.ts";

/**
 * Tarefas que o painel dispara como processo separado.
 *
 * São processos, não chamadas em linha, por dois motivos: `scrape` abre Chromium
 * e `media` baixa gigabytes — segurar isso dentro do handler HTTP travaria o
 * painel justamente enquanto há o que mostrar. Cada tarefa escreve no mesmo
 * SQLite, então o progresso aparece na atualização seguinte.
 */
const TAREFAS: Record<string, { rotulo: string; dica: string; cmd: string[] }> = {
  login: {
    rotulo: "Login",
    dica: "Renova a sessão nos dois sistemas. Use quando o catálogo reclamar de sessão expirada.",
    cmd: ["bun", "run", "src/cli.ts", "login"],
  },
  scrape: {
    rotulo: "Catalogar o que falta",
    dica: "Só as disciplinas ainda não catalogadas. Não faz nada se todas já estiverem.",
    cmd: ["bun", "run", "src/cli.ts", "scrape", "--continuar"],
  },
  "scrape-erro": {
    rotulo: "Renovar as com erro",
    dica: "Recataloga só as disciplinas que têm item em erro — é o que renova URL assinada expirada.",
    cmd: ["bun", "run", "src/cli.ts", "scrape", "--com-erro"],
  },
  "scrape-tudo": {
    rotulo: "Recatalogar tudo",
    dica: "As 9 disciplinas do zero. Demorado (~40 min).",
    cmd: ["bun", "run", "src/cli.ts", "scrape"],
  },
  requeue: {
    rotulo: "Reenfileirar erros",
    dica: "Devolve para a fila tudo que falhou no download.",
    cmd: ["bun", "run", "src/cli.ts", "requeue"],
  },
  "requeue-transcribe": {
    rotulo: "Reenfileirar transcrições",
    dica: "Devolve para a GPU as transcrições que falharam.",
    cmd: ["bun", "run", "src/cli.ts", "requeue", "--transcribe"],
  },
  scan: {
    rotulo: "Reconciliar disco",
    dica: "Marca como pronto o que já está no disco. Rode ANTES de baixar.",
    cmd: ["bun", "run", "src/cli.ts", "scan"],
  },
  media: {
    rotulo: "Baixar e transcrever",
    dica: "Consome a fila: baixa vídeo e material, e transcreve o que não tem legenda.",
    cmd: ["uv", "run", "python", "-m", "focus.worker"],
  },
  "media-sem-gpu": {
    rotulo: "Só baixar",
    dica: "Mesmo que o anterior, sem usar a GPU.",
    cmd: ["uv", "run", "python", "-m", "focus.worker", "--no-transcribe"],
  },
  livros: {
    rotulo: "Capturar Livros Digitais",
    dica: "Renderiza o livro interativo e imprime em PDF — o formato que não é arquivo baixável.",
    cmd: ["bun", "run", "src/cli.ts", "livros"],
  },
  escritos: {
    rotulo: "Gerar Materiais Escritos",
    dica: "Monta 00-Materiais Escritos: índice dos PDFs + transcrição de todas as aulas em texto corrido.",
    cmd: ["bun", "run", "src/cli.ts", "escritos"],
  },
  verify: {
    rotulo: "Conferir integridade",
    dica: "Abre cada arquivo capturado (ffprobe, %PDF) e reenfileira o que não passar.",
    cmd: ["uv", "run", "python", "-m", "focus.verify"],
  },
};

/** Quantas linhas de saída guardar por tarefa. */
const LINHAS_LOG = 200;

interface Execucao {
  desde: number;
  proc: Bun.Subprocess;
  /** Saída recente, para o painel mostrar o que está acontecendo de fato. */
  linhas: string[];
  resto: string;
}

const rodando = new Map<string, Execucao>();

function disparar(db: Database, nome: string): { ok: boolean; msg: string } {
  const t = TAREFAS[nome];
  if (!t) return { ok: false, msg: `tarefa desconhecida: ${nome}` };
  // Uma execução por tarefa: dois `media` simultâneos brigariam pelo mesmo
  // arquivo parcial, e dois `scrape` abririam Chromium em dobro.
  if (rodando.has(nome)) return { ok: false, msg: `${t.rotulo} já está rodando` };

  // stderr redirecionado para o stdout: assim o painel mostra também o erro do
  // yt-dlp e do Playwright, que é onde a causa costuma estar. Deixar stderr em
  // "pipe" sem leitor travaria o filho quando o buffer enchesse.
  const proc = Bun.spawn(t.cmd, { cwd: BASE_DIR, stdout: "pipe", stderr: "pipe" });
  const exec: Execucao = { desde: Date.now(), proc, linhas: [], resto: "" };
  rodando.set(nome, exec);
  log(db, "info", "painel", `${t.rotulo}: iniciado — ${t.cmd.join(" ")}`);

  /** Consome um fluxo linha a linha; um pipe sem leitor trava o processo. */
  const consumir = async (fluxo: ReadableStream<Uint8Array>, marca: string) => {
    const leitor = fluxo.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      const partes = (exec.resto + dec.decode(value, { stream: true })).split("\n");
      exec.resto = partes.pop() ?? "";
      for (const l of partes) {
        const limpa = l.replace(/\r/g, "").trimEnd();
        if (!limpa.trim()) continue;
        exec.linhas.push(marca + limpa.slice(0, 200));
        if (exec.linhas.length > LINHAS_LOG) exec.linhas.shift();
      }
    }
  };

  Promise.all([
    consumir(proc.stdout as ReadableStream<Uint8Array>, ""),
    consumir(proc.stderr as ReadableStream<Uint8Array>, "! "),
  ]).catch(() => undefined);

  proc.exited.then((code) => {
    const dur = Math.round((Date.now() - exec.desde) / 1000);
    // As últimas linhas vão para o histórico de eventos: sem isso o motivo da
    // falha morre junto com o processo e o painel só mostra "código 1".
    const fim = exec.linhas.slice(-3).join(" · ").slice(0, 300);
    rodando.delete(nome);
    log(db, code === 0 ? "info" : "error", "painel",
      `${t.rotulo}: ${code === 0 ? "concluído" : `FALHOU (código ${code})`} em ${dur}s` +
      (fim ? ` — ${fim}` : ""));
  });

  return { ok: true, msg: `${t.rotulo} iniciado` };
}

function estadoTarefas() {
  return Object.entries(TAREFAS).map(([nome, t]) => {
    const e = rodando.get(nome);
    return {
      nome, rotulo: t.rotulo, dica: t.dica,
      rodando: !!e,
      segundos: e ? Math.round((Date.now() - e.desde) / 1000) : 0,
      linhas: e?.linhas.slice(-14) ?? [],
    };
  });
}

const TIPOS: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".pdf": "application/pdf", ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

function mime(caminho: string): string {
  const p = caminho.lastIndexOf(".");
  return TIPOS[caminho.slice(p).toLowerCase()] ?? "application/octet-stream";
}

/** Serve um arquivo do acervo com suporte a Range (seek no player). */
function servirArquivo(relPath: string, req: Request): Response {
  // Impede escapar da raiz do acervo por "..".
  const alvo = join(REPOSITORY, relPath);
  if (!alvo.startsWith(REPOSITORY) || !existsSync(alvo)) return new Response("não encontrado", { status: 404 });

  const tamanho = statSync(alvo).size;
  const tipo = mime(alvo);
  const range = req.headers.get("range");

  if (!range) {
    return new Response(Bun.file(alvo), {
      headers: { "Content-Type": tipo, "Content-Length": String(tamanho), "Accept-Ranges": "bytes" },
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const inicio = m?.[1] ? Number(m[1]) : 0;
  const fim = m?.[2] ? Number(m[2]) : tamanho - 1;
  if (inicio >= tamanho || fim >= tamanho || inicio > fim)
    return new Response("range inválido", { status: 416, headers: { "Content-Range": `bytes */${tamanho}` } });

  return new Response(Bun.file(alvo).slice(inicio, fim + 1), {
    status: 206,
    headers: {
      "Content-Type": tipo,
      "Content-Range": `bytes ${inicio}-${fim}/${tamanho}`,
      "Content-Length": String(fim - inicio + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

interface LinhaArvore {
  disc_id: number; disc_pos: number; disc_nome: string; disc_folder: string | null;
  mod_id: number; mod_pos: number; mod_nome: string; mod_folder: string | null;
  item_id: number | null; kind: string | null; position: number | null; title: string | null;
  rel_path: string | null; bytes: number | null; download_status: string | null;
  transcribe_status: string | null; download_error: string | null;
}

function arvore(db: Database): LinhaArvore[] {
  return db.query<LinhaArvore, []>(`
    SELECT d.id AS disc_id, d.position AS disc_pos, d.name AS disc_nome, d.folder AS disc_folder,
           m.id AS mod_id, m.position AS mod_pos, m.name AS mod_nome, m.folder AS mod_folder,
           i.id AS item_id, i.kind, i.position, i.title, i.rel_path, i.bytes,
           i.download_status, i.transcribe_status, i.download_error
      FROM disciplines d
      LEFT JOIN modules m ON m.discipline_id = d.id
      LEFT JOIN items   i ON i.module_id = m.id
     ORDER BY d.position, m.position, i.position
  `).all();
}

/** Estatísticas por disciplina — alimentam a combo e o painel de métricas. */
function disciplinas(db: Database) {
  return db.query(`
    SELECT d.id, d.position AS posicao, d.name AS nome,
           COUNT(DISTINCT m.id)                              AS modulos,
           COUNT(i.id)                                       AS itens,
           COALESCE(SUM(i.download_status='done'), 0)        AS ok,
           COALESCE(SUM(i.kind='video'), 0)                  AS videos,
           COALESCE(SUM(i.kind='video' AND i.transcribe_status='done'), 0) AS transcritos,
           COALESCE(SUM(i.bytes), 0)                         AS bytes,
           COALESCE(SUM(i.duration), 0)                      AS duracao
      FROM disciplines d
      LEFT JOIN modules m ON m.discipline_id = d.id
      LEFT JOIN items   i ON i.module_id = m.id
     GROUP BY d.id ORDER BY d.position
  `).all();
}

/**
 * Acha a legenda de um vídeo no disco.
 *
 * O acervo guarda a legenda ao lado do vídeo, com o mesmo nome: `X.mp4` →
 * `X.srt`. Alguns itens antigos têm `.vtt`, e a transcrição por Whisper também
 * escreve `-Fala.Cronometrada.txt` — este último não serve de faixa (não tem
 * tempo de fim), mas serve de texto.
 */
function caminhoLegenda(relPath: string): string | null {
  const semExt = relPath.replace(/\.[^./]+$/, "");
  for (const ext of [".srt", ".vtt"]) {
    const p = join(REPOSITORY, semExt + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Markdown → HTML, subconjunto pequeno de propósito.
 *
 * O único markdown servido aqui é o que nós mesmos geramos em `escritos.ts`:
 * três níveis de título, links, negrito, lista e régua. Uma biblioteca completa
 * seria dependência nova para converter texto que já sabemos o formato.
 */
export function mdParaHtml(md: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (t: string) =>
    esc(t)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, href) => {
        // Link relativo aponta para arquivo do acervo; o painel serve por /arquivo.
        const externo = /^https?:/i.test(href);
        const alvo = externo ? href : `/md?p=${encodeURIComponent(href)}`;
        return `<a href="${alvo}"${externo ? ' target="_blank" rel="noreferrer"' : ""}>${txt}</a>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const saida: string[] = [];
  let emLista = false;
  const fecharLista = () => { if (emLista) { saida.push("</ul>"); emLista = false; } };

  for (const linha of md.replace(/\r/g, "").split("\n")) {
    const l = linha.trimEnd();
    const t = /^(#{1,6})\s+(.*)$/.exec(l);
    if (t) { fecharLista(); const n = t[1]!.length; saida.push(`<h${n}>${inline(t[2]!)}</h${n}>`); continue; }
    if (/^---+$/.test(l)) { fecharLista(); saida.push("<hr>"); continue; }
    const li = /^[-*]\s+(.*)$/.exec(l);
    if (li) { if (!emLista) { saida.push("<ul>"); emLista = true; } saida.push(`<li>${inline(li[1]!)}</li>`); continue; }
    if (!l.trim()) { fecharLista(); continue; }
    fecharLista();
    saida.push(`<p>${inline(l)}</p>`);
  }
  fecharLista();
  return saida.join("\n");
}

/** Resolve um caminho pedido pelo painel dentro do acervo, sem deixar escapar. */
function dentroDoAcervo(rel: string): string | null {
  const alvo = join(REPOSITORY, decodeURIComponent(rel));
  return alvo.startsWith(REPOSITORY) && existsSync(alvo) ? alvo : null;
}

export function servir(db: Database, porta: number): void {
  const servidor = Bun.serve({
    hostname: PANEL_HOST,
    port: porta,
    fetch(req) {
      const url = new URL(req.url);
      const rota = url.pathname;

      if (rota === "/") return new Response(PAGINA, { headers: { "Content-Type": "text/html; charset=utf-8" } });

      if (rota === "/api/tudo") {
        return Response.json({
          disciplinas: disciplinas(db),
          stats: stats(db),
          arvore: arvore(db),
          tarefas: estadoTarefas(),
          eventos: db.query(`SELECT at, level, source, message FROM events ORDER BY id DESC LIMIT 120`).all(),
        });
      }

      if (rota === "/api/run" && req.method === "POST") {
        return Response.json(disparar(db, url.searchParams.get("tarefa") ?? ""));
      }

      if (rota === "/api/requeue" && req.method === "POST") {
        const qual = url.searchParams.get("qual") === "transcribe" ? "transcribe" : "download";
        return Response.json({ n: reenfileirar(db, qual) });
      }

      // Legenda como WebVTT: o <track> do navegador NÃO lê SRT, e sem a
      // conversão a faixa carrega sem erro e simplesmente não aparece.
      // Markdown do acervo renderizado, e qualquer outro arquivo servido cru.
      // Os links relativos do índice chegam aqui, então "abrir o PDF do módulo"
      // funciona no painel sem duplicar caminho no banco.
      if (rota === "/md") {
        const pedido = url.searchParams.get("p")
          ?? join(CURSO_PASTA, PASTA_ESCRITOS, ARQ_INDICE);
        const base = join(CURSO_PASTA, PASTA_ESCRITOS);
        const rel = pedido.startsWith("..") ? join(base, pedido) : (
          pedido.includes("/") ? pedido : join(base, pedido));
        const alvo = dentroDoAcervo(rel);
        if (!alvo) return new Response("não encontrado", { status: 404 });
        if (!/\.md$/i.test(alvo)) return servirArquivo(relative(REPOSITORY, alvo), req);
        return Response.json({
          html: mdParaHtml(readFileSync(alvo, "utf-8")),
          nome: alvo.split("/").pop(),
        });
      }

      if (rota.startsWith("/legenda/")) {
        const id = Number(rota.slice("/legenda/".length));
        const r = db.query<{ rel_path: string | null }, [number]>(
          `SELECT rel_path FROM items WHERE id=?`).get(id);
        const leg = r?.rel_path ? caminhoLegenda(r.rel_path) : null;
        if (!leg) return new Response("sem legenda", { status: 404 });
        return new Response(srtParaVtt(readFileSync(leg, "utf-8")), {
          headers: { "Content-Type": "text/vtt; charset=utf-8" },
        });
      }

      // Transcrição em trechos com tempo — é o que deixa clicar numa fala e o
      // vídeo pular para aquele ponto.
      if (rota.startsWith("/transcricao/")) {
        const id = Number(rota.slice("/transcricao/".length));
        const r = db.query<{ rel_path: string | null }, [number]>(
          `SELECT rel_path FROM items WHERE id=?`).get(id);
        const leg = r?.rel_path ? caminhoLegenda(r.rel_path) : null;
        return Response.json(leg ? lerTrechos(readFileSync(leg, "utf-8")) : []);
      }

      if (rota.startsWith("/media/")) {
        const id = Number(rota.slice("/media/".length));
        const r = db.query<{ rel_path: string | null }, [number]>(
          `SELECT rel_path FROM items WHERE id=?`).get(id);
        if (!r?.rel_path) return new Response("sem arquivo", { status: 404 });
        return servirArquivo(r.rel_path, req);
      }

      return new Response("não encontrado", { status: 404 });
    },
  });
  console.log(`painel em http://${servidor.hostname}:${servidor.port}`);
}
