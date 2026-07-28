/**
 * Cataloga a matrícula inteira no banco: disciplinas → módulos → itens.
 *
 * Junta as fontes que o reconhecimento mapeou:
 *   - navegação do accordion (`lesson.ts`) — única forma de achar as URLs de
 *     PDF e da playlist, que não existem em endpoint nenhum
 *   - CDN (`cdn.ts`) ou IESDE (`iesde.ts`) — a lista real de vídeos do módulo
 *   - agente (`agent.ts`) — títulos das aulas, só onde a plataforma não dá
 *
 * **São dois sistemas de conteúdo, não um.** A disciplina 1 usa o CDN da
 * produtora (playlist b-cdn → player onilearning → HLS no CloudFront); as
 * demais usam IESDE (playlist própria → página da aula → MP4 assinado). Tratar
 * os dois como um só fazia 8 das 9 disciplinas voltarem com zero vídeo.
 *
 * Nada é baixado aqui. O `scrape` só preenche a fila; quem baixa é o worker
 * Python. E não rebaixa progresso: item já `done` continua `done`.
 */
import type { Database } from "bun:sqlite";

import * as cdn from "./cdn.ts";
import * as iesde from "./iesde.ts";
import * as naming from "./naming.ts";
import { titulosDoModulo } from "./agent.ts";
import { CURSO_PASTA } from "./config.ts";
import { log, upsertDiscipline, upsertItem, upsertModule, type Kind } from "./db.ts";
import { explorarDisciplina, lerDisciplinas, type LessonCapture } from "./lesson.ts";

/** Teto de navegação por disciplina, em minutos. */
const TETO_MIN = Number(process.env.FOCUS_TETO_MIN ?? 12);

export interface ResumoScrape {
  disciplinas: number;
  modulos: number;
  itens: number;
  avisos: string[];
}

/** Agrupa as lessons capturadas por módulo, preservando a ordem do accordion. */
function porModulo(lessons: LessonCapture[]): Map<number, { nome: string; lessons: LessonCapture[] }> {
  const m = new Map<number, { nome: string; lessons: LessonCapture[] }>();
  for (const l of lessons) {
    const g = m.get(l.moduloIndice) ?? { nome: l.modulo, lessons: [] };
    g.lessons.push(l);
    m.set(l.moduloIndice, g);
  }
  return m;
}

/** Disciplinas que já têm item no banco — base do `--continuar`. */
function jaCatalogadas(db: Database): Set<number> {
  const rs = db.query<{ id: number }, []>(`
    SELECT DISTINCT d.id FROM disciplines d
      JOIN modules m ON m.discipline_id = d.id
      JOIN items   i ON i.module_id = m.id
  `).all();
  return new Set(rs.map((r) => r.id));
}

/**
 * Disciplinas com algum item em erro — base do `--com-erro`.
 *
 * É o caso de uso real do "recatalogar": o PDF do IESDE vem por URL assinada de
 * validade curta, e recatalogar é o que renova a assinatura. Recatalogar as 9
 * para consertar 7 PDFs custa quase uma hora à toa.
 */
export function comErro(db: Database): number[] {
  return db.query<{ id: number }, []>(`
    SELECT DISTINCT d.id FROM items i
      JOIN modules m ON m.id = i.module_id
      JOIN disciplines d ON d.id = m.discipline_id
     WHERE i.download_status = 'error'
  `).all().map((r) => r.id);
}

export async function scrape(
  db: Database,
  enrollmentId: number,
  opts: { apenas?: number[]; continuar?: boolean; aoProgredir?: (msg: string) => void } = {},
): Promise<ResumoScrape> {
  const diga = opts.aoProgredir ?? (() => undefined);
  const avisos: string[] = [];
  let nModulos = 0, nItens = 0;

  diga(`lendo as disciplinas da matrícula ${enrollmentId}…`);
  let disciplinas = await lerDisciplinas(enrollmentId);
  diga(`a matrícula tem ${disciplinas.length} disciplina(s)`);

  if (opts.apenas?.length) {
    disciplinas = disciplinas.filter((d) => opts.apenas!.includes(d.id));
    diga(`restrito a ${disciplinas.length}: ${disciplinas.map((d) => d.id).join(", ")}`);
  }
  if (opts.continuar) {
    const prontas = jaCatalogadas(db);
    const antes = disciplinas.length;
    disciplinas = disciplinas.filter((d) => !prontas.has(d.id));
    diga(`--continuar: ${antes - disciplinas.length} já catalogada(s), ${disciplinas.length} a fazer`);
  }

  if (!disciplinas.length) {
    // Sem isto o comando "concluía" em silêncio e parecia quebrado — foi o que
    // aconteceu com o botão Catalogar depois que tudo já estava catalogado.
    diga("nada a catalogar. Para renovar assinaturas expiradas use --com-erro; " +
         "para refazer tudo, rode sem --continuar.");
    return { disciplinas: 0, modulos: 0, itens: 0, avisos: [] };
  }
  diga(`catalogando ${disciplinas.length} disciplina(s)…`);

  for (const d of disciplinas) {
    // Cada disciplina é isolada: navegar o accordion abre um Chromium por vez e
    // uma delas morrer (OOM, timeout, DOM inesperado) não pode levar junto as
    // outras oito. Aconteceu — o processo caiu na 4ª e perdeu o resto da fila.
    try {
      // Teto de tempo por disciplina. Sem ele o catálogo trava indefinidamente:
      // uma disciplina passou 40 minutos no accordion sem produzir um item, e
      // as seguintes nunca chegaram a ser tentadas. Melhor pular e registrar.
      await Promise.race([
        catalogarDisciplina(db, enrollmentId, d, {
          diga, avisos,
          contar: (m, i) => { nModulos += m; nItens += i; },
        }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`estourou ${TETO_MIN} min de navegação`)), TETO_MIN * 60_000)),
      ]);
    } catch (e) {
      avisos.push(`${d.nome}: falhou e foi pulada — ${(e as Error).message.slice(0, 160)}`);
      diga(`   ✗ ${d.nome}: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  for (const a of avisos) log(db, "error", "scrape", a);
  log(db, "info", "scrape", `catalogou ${disciplinas.length} disciplina(s), ${nModulos} módulo(s), ${nItens} item(ns)`);
  return { disciplinas: disciplinas.length, modulos: nModulos, itens: nItens, avisos };
}

interface Ctx {
  diga: (m: string) => void;
  avisos: string[];
  contar: (modulos: number, itens: number) => void;
}

async function catalogarDisciplina(
  db: Database,
  enrollmentId: number,
  disciplina: Awaited<ReturnType<typeof lerDisciplinas>>[number],
  ctx: Ctx,
): Promise<void> {
  const { diga, avisos } = ctx;
  let nModulos = 0, nItens = 0;

  {
    const d = disciplina;
    const pastaDisc = naming.pastaDisciplina(d.posicao, d.nome);
    const raiz = (...p: string[]) => naming.caminho(CURSO_PASTA, pastaDisc, ...p);

    upsertDiscipline(db, {
      id: d.id, enrollment_id: enrollmentId, position: d.posicao, name: d.nome, folder: pastaDisc,
    });
    diga(`▸ ${d.posicao}. ${d.nome} (id ${d.id})`);

    const captura = await explorarDisciplina(enrollmentId, d.id);
    if (!captura.lessons.length) {
      avisos.push(`${d.nome}: accordion não devolveu lesson nenhuma`);
      return;
    }

    const grupos = porModulo(captura.lessons);

    // ---- família IESDE -------------------------------------------------
    // Uma "playlist" IESDE traz a disciplina inteira, e o agrupamento em
    // módulos vem do título das aulas, não do accordion.
    const urlIesde = captura.lessons
      .map((l) => l.fontes.playlist ?? l.iframes.find(iesde.ehIesde))
      .find(iesde.ehIesde);

    if (urlIesde) {
      const aulas = await iesde.lerPlaylist(urlIesde);
      if (!aulas.length) {
        avisos.push(`${d.nome}: playlist IESDE não devolveu aula (${urlIesde})`);
        return;
      }
      for (const g of iesde.agrupar(aulas)) {
        const pastaMod = naming.pastaModulo(g.posicao, g.titulo);
        const moduleId = upsertModule(db, {
          discipline_id: d.id, position: g.posicao, name: g.titulo, folder: pastaMod,
        });
        nModulos++;
        g.aulas.forEach((a, i) => {
          upsertItem(db, {
            module_id: moduleId, kind: "video", position: i + 1, title: g.titulo,
            // Guarda o /show, NÃO o MP4: a URL do vídeo é assinada e expira.
            source_url: a.show,
            rel_path: raiz(pastaMod, naming.arquivoVideo(g.posicao, i + 1, g.titulo)),
          });
          nItens++;
        });
      }
      // O material da disciplina IESDE fica na raiz dela, como no acervo.
      const pdf = captura.lessons.find((l) => l.fontes.arquivo)?.fontes.arquivo;
      if (pdf) {
        const moduleId = upsertModule(db, {
          discipline_id: d.id, position: 99, name: `${d.nome} (material)`, folder: "",
        });
        upsertItem(db, {
          module_id: moduleId, kind: "pdf", position: 1, title: "Material em PDF",
          source_url: pdf, rel_path: raiz(`${pastaDisc}.pdf`),
        });
        nItens++;
      }
      diga(`   IESDE — ${aulas.length} aulas em ${iesde.agrupar(aulas).length} módulo(s)`);
      ctx.contar(nModulos, nItens);
      return;
    }

    // ---- família CDN da produtora --------------------------------------
    for (const [indice, grupo] of grupos) {
      const posModulo = indice + 1;
      const pastaMod = naming.pastaModulo(posModulo, grupo.nome);
      const moduleId = upsertModule(db, {
        discipline_id: d.id, position: posModulo, name: grupo.nome, folder: pastaMod,
      });
      nModulos++;

      const pdf = grupo.lessons.find((l) => l.fontes.tipo === "pdf")?.fontes.arquivo ?? null;
      const livro = grupo.lessons.find((l) => l.fontes.tipo === "livro")?.fontes.visualizador ?? null;
      const playlistUrl = grupo.lessons.find((l) => l.fontes.playlist)?.fontes.playlist ?? null;

      const videos = playlistUrl ? await cdn.lerPlaylist(playlistUrl) : [];
      const comManifesto = videos.filter((v) => v.manifesto);
      if (!playlistUrl) avisos.push(`${d.nome} / ${grupo.nome}: nenhuma playlist observada`);
      else if (videos.length && !comManifesto.length)
        avisos.push(`${d.nome} / ${grupo.nome}: ${videos.length} vídeo(s) sem manifesto resolvido`);

      // Aqui a plataforma NÃO dá título ("Aula 01"), então o agente entra.
      const { titulos, origem } = await titulosDoModulo(db, {
        pdfUrl: pdf, nVideos: comManifesto.length, modulo: grupo.nome,
      });
      if (origem === "fallback" && comManifesto.length)
        avisos.push(`${d.nome} / ${grupo.nome}: títulos em fallback ("Aula NN")`);

      let pos = 0;
      for (const v of comManifesto) {
        pos++;
        const titulo = titulos[pos - 1] ?? v.rotulo;
        upsertItem(db, {
          module_id: moduleId, kind: "video", position: pos, title: titulo,
          source_url: v.manifesto!, subtitle_url: v.legenda ?? null,
          rel_path: raiz(pastaMod, naming.arquivoVideo(posModulo, pos, titulo)),
        });
        nItens++;
      }

      // Materiais continuam a numeração dos vídeos — 4 vídeos → Ebook 05,
      // Slides 06. O Ebook vem primeiro porque é assim no acervo, mesmo que o
      // accordion liste "Material em PDF" (= Slides) antes de "Livro Digital".
      for (const [kind, url, marcador] of [
        ["livro", livro, "Ebook"], ["pdf", pdf, "Slides"],
      ] as [Kind, string | null, naming.Marcador][]) {
        if (!url) continue;
        pos++;
        upsertItem(db, {
          module_id: moduleId, kind, position: pos,
          title: marcador === "Ebook" ? "Livro Digital" : "Material em PDF",
          source_url: url,
          rel_path: raiz(pastaMod, naming.arquivoMaterial(posModulo, pos, marcador, grupo.nome)),
        });
        nItens++;
      }

      diga(`   ${posModulo}. ${grupo.nome} — ${comManifesto.length} vídeo(s), títulos: ${origem}`);
    }
  }

  ctx.contar(nModulos, nItens);
}
