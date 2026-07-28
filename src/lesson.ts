/**
 * Navegação completa dentro de uma disciplina.
 *
 * A página `/aluno/<slug>/meus-cursos/<enrollment>/aulas/<disciplina>` tem um
 * accordion "Conteúdo do Curso" na direita: módulos que expandem em lessons
 * ("Vídeo Aula", "Material em PDF", "Livro Digital", …). Clicar numa lesson
 * troca o painel da esquerda — e é só aí que a URL do material aparece, seja em
 * iframe, em link de download ou numa requisição de rede.
 *
 * Por isso não dá para catalogar pela API: é preciso clicar em tudo. O formato
 * do painel muda de lesson para lesson, então a coleta aqui é deliberadamente
 * generosa (iframes, links, requisições de mídia, texto) e a interpretação fica
 * para quem consome.
 *
 * REGRA DURA: provas nunca são abertas. Ver PROIBIDO abaixo.
 */
import { chromium, type Browser, type Page, type Frame } from "playwright";

import { PORTAL_URL, STORAGE_STATE, USER_AGENT } from "./config.ts";

/**
 * Qualquer coisa que cheire a avaliação é ignorada — em texto e em URL.
 *
 * `exam` sem o "e" final de propósito: o endpoint da API é `/exams`, e a versão
 * anterior deste padrão ("exame") deixava justamente ele passar.
 */
export const PROIBIDO = /prova|avalia|simulad|exam|question[áa]ri|refazer/i;

/** Extensões/hosts que valem como material capturável. */
const MIDIA =
  /\.(pdf|mp4|m3u8|epub|pptx?|docx?|zip)(\?|$)|b-cdn\.net|onilearning|cloudfront\.net|videoiesde|\/iesde\/|drive\.google|docs\.google/i;

const RUIDO = /\.(css|js|png|jpe?g|svg|gif|woff2?|ico)(\?|$)|imagens\/|fonts\.|analytics|clarity|doubleclick|tiktok/i;

/**
 * Segmentos de streaming. Um vídeo de 4 minutos gera ~25 `.ts` e vários `.vtt`
 * numerados; guardar isso afoga o resultado e não serve de nada — o que importa
 * é o manifesto, que já lista tudo.
 */
const SEGMENTO = /\.ts(\?|$)|_\d{5}\.(vtt|ts)|^blob:/i;

export type TipoLesson = "video" | "pdf" | "livro" | "desconhecido";

/** URLs que interessam, já separadas por papel. */
export interface Fontes {
  tipo: TipoLesson;
  /** HTML estático no CDN com a lista de aulas do módulo. */
  playlist?: string;
  /** Player onilearning da primeira aula (as demais saem da playlist). */
  player?: string;
  /** Manifesto HLS master (tem 360/720/1080 + legenda). */
  manifesto?: string;
  /** Trilha de legenda oficial em português. */
  legenda?: string;
  /** Download direto (`saida=arquivo` devolve o PDF cru). */
  arquivo?: string;
  /** Visualizador paginado do livro digital (não é arquivo único). */
  visualizador?: string;
}

/** Interpreta as URLs coletadas. O formato varia por lesson, daí a heurística. */
export function classificar(urls: string[]): Fontes {
  const acha = (re: RegExp) => urls.find((u) => re.test(u));
  const f: Fontes = { tipo: "desconhecido" };

  // Playlist: as DUAS famílias. A da produtora é um HTML no b-cdn; a do IESDE é
  // uma rota no www5. Reconhecer só a primeira deixava toda lesson IESDE como
  // "desconhecida" — e o diagnóstico não mostrava por quê.
  f.playlist = acha(/playlist_videoaulas\/.*\.html/i) ?? acha(/\/iesde\/\d+\/lessons\/playlist/i);
  f.player = acha(/player\.php\?/i) ?? acha(/\/iesde\/lessons\/\d+\/show/i);

  // Material: também dois formatos. `componente.php?saida=arquivo` na família da
  // produtora; no IESDE o PDF vem do MESMO CDN de vídeo, com URL assinada
  // terminando em /file.pdf.
  f.arquivo = acha(/componente\.php\?.*saida=arquivo/i) ?? acha(/videoiesde[^\s]*\.pdf(\?|$)/i);
  f.visualizador = acha(/componente\.php\?.*onepage=/i);

  // Prefere o manifesto master (?v=oni): é o que lista 360/720/1080 e a legenda.
  // As variantes (_360.m3u8) e a própria LEGENDA não servem como entrada.
  f.manifesto =
    acha(/\.m3u8\?v=oni/i) ?? acha(/(?<!LEGENDA)(?<!_\d{3})\.m3u8(\?|$)/i);

  // A legenda NÃO é lida da rede: o player da lesson anterior continua baixando
  // depois que o painel troca, e a resposta atrasada cai no balde errado (visto
  // na prática: manifesto 379580201 com legenda 379581417). Como o manifesto
  // master já declara a trilha de legenda, deriva-se dele — determinístico.
  if (f.manifesto) {
    const base = f.manifesto.replace(/\?.*$/, "").replace(/\.m3u8$/i, "");
    f.legenda = `${base}LEGENDA.m3u8`;
  }

  if (f.playlist || f.player || f.manifesto) f.tipo = "video";
  else if (f.arquivo) f.tipo = "pdf";
  else if (f.visualizador) f.tipo = "livro";
  return f;
}

export interface LessonCapture {
  modulo: string;
  moduloIndice: number;
  lesson: string;
  lessonIndice: number;
  /** iframes carregados no painel (player de vídeo, visualizador de PDF, …). */
  iframes: string[];
  /** hrefs de download encontrados no painel. */
  links: string[];
  /** URLs de mídia observadas na rede enquanto a lesson carregava. */
  rede: string[];
  /** Primeiras linhas do painel — para reconhecer o formato quando ele mudar. */
  texto: string;
  /** Leitura das URLs acima: o que é vídeo, o que é arquivo, o que é livro. */
  fontes: Fontes;
  erro?: string;
}

export interface DisciplineCapture {
  disciplinaId: number;
  url: string;
  modulos: string[];
  lessons: LessonCapture[];
}

/**
 * Descobre o slug do aluno (`francisco_seZl_`) deixando o portal redirecionar.
 *
 * Não dá para ler do cookie: `@faculdadefocus:slug` guarda o slug da
 * INSTITUIÇÃO ("faculdadefocus"), não o do aluno — usar ele monta uma URL que
 * carrega uma página vazia sem erro nenhum.
 */
export async function alunoSlug(page: Page): Promise<string> {
  await page.goto(`${PORTAL_URL}/aluno`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForURL(/\/aluno\/[^/]+\/\w+/, { timeout: 30_000 }).catch(() => undefined);
  const m = /\/aluno\/([^/]+)\//.exec(page.url());
  if (!m?.[1]) throw new Error(`slug do aluno não deduzido de ${page.url()} — rode 'bun run login'`);
  return m[1];
}

function limpar(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export interface DisciplinaRef {
  id: number;
  nome: string;
  posicao: number;
  modulos: number;
}

/**
 * Lista as disciplinas da matrícula.
 *
 * Vem de `GET /enrollments/details/<id>`, que exige o header `g-repatch`
 * assinado em JS. Em vez de reimplementar a assinatura — que quebraria na
 * primeira mudança do algoritmo —, abre-se a página e colhe-se a resposta que
 * o próprio app faz.
 */
export async function lerDisciplinas(
  enrollmentId: number,
  opts: { headed?: boolean } = {},
): Promise<DisciplinaRef[]> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const ctx = await browser.newContext({
      storageState: STORAGE_STATE.portal, userAgent: USER_AGENT, locale: "pt-BR",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(60_000);

    let payload: unknown = null;
    page.on("response", async (r) => {
      if (!/enrollments\/details\//.test(r.url())) return;
      payload = await r.json().catch(() => null);
    });

    const slug = opts && "slug" in opts ? (opts as { slug: string }).slug : await alunoSlug(page);
    await page.goto(`${PORTAL_URL}/aluno/${slug}/meus-cursos/${enrollmentId}`, {
      waitUntil: "domcontentloaded", timeout: 60_000,
    });
    for (let i = 0; i < 30 && !payload; i++) await page.waitForTimeout(1000);
    if (!payload) throw new Error(`não recebi /enrollments/details/${enrollmentId} — sessão expirada? rode 'bun run login'`);

    const cds = (payload as {
      classroom?: { classroom_disciplines?: { discipline?: { id: number; name: string; modules?: unknown[] } }[] };
    }).classroom?.classroom_disciplines ?? [];

    return cds
      .map((cd, i) => cd.discipline && {
        id: cd.discipline.id,
        nome: limpar(cd.discipline.name),
        posicao: i + 1,
        modulos: cd.discipline.modules?.length ?? 0,
      })
      .filter((d): d is DisciplinaRef => Boolean(d) && !PROIBIDO.test(d!.nome));
  } finally {
    await browser?.close();
  }
}

/** Todos os iframes da página, inclusive aninhados. */
function iframesDe(page: Page): string[] {
  const urls: string[] = [];
  const anda = (f: Frame) => {
    const u = f.url();
    if (u && u !== "about:blank" && !RUIDO.test(u)) urls.push(u);
    f.childFrames().forEach(anda);
  };
  page.mainFrame().childFrames().forEach(anda);
  return [...new Set(urls)];
}

/**
 * Reconhece que já vimos tudo o que essa disciplina tem a dar.
 *
 * Numa disciplina IESDE a playlist inteira (dezenas de aulas, todos os módulos)
 * sai de UMA URL — continuar clicando lesson por lesson não acrescenta nada e
 * custa ~5s por clique. Uma disciplina chegou a ficar 40 minutos navegando à
 * toa. Achou IESDE mais um material, pode parar.
 */
function jaTemTudo(lessons: LessonCapture[]): boolean {
  const temIesde = lessons.some(
    (l) => /\/iesde\//i.test(l.fontes.playlist ?? "") || l.iframes.some((u) => /\/iesde\//i.test(u)),
  );
  return temIesde && lessons.some((l) => l.fontes.arquivo);
}

export async function explorarDisciplina(
  enrollmentId: number,
  disciplinaId: number,
  opts: { headed?: boolean; slug?: string } = {},
): Promise<DisciplineCapture> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const ctx = await browser.newContext({
      storageState: STORAGE_STATE.portal,
      userAgent: USER_AGENT,
      locale: "pt-BR",
      acceptDownloads: false,
    });
    const page = await ctx.newPage();

    // Teto por OPERAÇÃO, não só por disciplina. Sem isto, quando o Chromium
    // morre no meio (aconteceu: máquina sob carga, browser derrubado), a
    // chamada do Playwright fica esperando para sempre um navegador que não
    // existe mais — 23 minutos parado, 0,6% de CPU, nenhum processo vivo.
    // Com o teto, a operação falha rápido e a disciplina é pulada com motivo.
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(60_000);

    // Coletor de rede: acumula no balde da lesson corrente.
    let balde = new Set<string>();
    const capturar = (u: string) => {
      if (MIDIA.test(u) && !RUIDO.test(u) && !SEGMENTO.test(u)) balde.add(u.split("#")[0]!);
    };
    page.on("request", (r) => capturar(r.url()));
    // Abas novas (o portal abre material em popup às vezes) — registra e fecha.
    ctx.on("page", async (np) => {
      await np.waitForLoadState("domcontentloaded").catch(() => undefined);
      capturar(np.url());
      iframesDe(np).forEach(capturar);
      await np.close().catch(() => undefined);
    });

    const slug = opts.slug ?? (await alunoSlug(page));
    const url = `${PORTAL_URL}/aluno/${slug}/meus-cursos/${enrollmentId}/aulas/${disciplinaId}`;
    // networkidle não serve aqui: o player HLS baixa segmentos sem parar e a
    // rede nunca silencia. Espera-se o accordion aparecer.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText("Conteúdo do Curso").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForTimeout(1500);

    // O accordion é o scroll-area que contém os contadores "N aulas" — a página
    // tem outros scroll-areas (o menu lateral, por exemplo).
    const painel = page.locator("[data-radix-scroll-area-viewport]").filter({ hasText: /\d+\s+aulas?/ }).last();
    const botoes = painel.locator("button");

    /** Texto de cada botão do accordion, na ordem do DOM. */
    const textos = async () =>
      (await botoes.allTextContents()).map(limpar);

    // Módulo = botão que exibe "N aulas"; o resto é lesson.
    const ehModulo = (t: string) => /\d+\s+aulas?$/.test(t);
    const nomeModulo = (t: string) => t.replace(/\d+\s+aulas?$/, "").trim();

    const nomesModulo = (await textos()).filter(ehModulo).map(nomeModulo).filter(Boolean);
    const lessons: LessonCapture[] = [];

    for (let m = 0; m < nomesModulo.length; m++) {
      const nome = nomesModulo[m]!;
      if (PROIBIDO.test(nome)) continue;

      const cab = botoes.filter({ hasText: nome }).first();
      await cab.scrollIntoViewIfNeeded().catch(() => undefined);

      // O 1º módulo já vem expandido: clicar fecharia. Só clica se preciso.
      const abertas = async () =>
        (await textos()).filter((t) => t && !ehModulo(t) && !nomesModulo.includes(t)).length;
      if ((await abertas()) === 0) {
        await cab.click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
      }

      const nomesLesson = (await textos()).filter((t) => t && !ehModulo(t) && !nomesModulo.includes(t));

      for (let i = 0; i < nomesLesson.length; i++) {
        const txt = nomesLesson[i]!;
        if (PROIBIDO.test(txt)) continue;                       // nunca abrir prova
        const it = botoes.filter({ hasText: txt }).first();
        if (!(await it.isVisible().catch(() => false))) continue;

        balde = new Set();
        const cap: LessonCapture = {
          modulo: nome, moduloIndice: m, lesson: txt, lessonIndice: i,
          iframes: [], links: [], rede: [], texto: "", fontes: { tipo: "desconhecido" },
        };
        try {
          await it.click({ timeout: 10_000 });
          await page.waitForTimeout(4000);   // painel troca por client-side render

          cap.iframes = iframesDe(page);
          cap.links = await page.evaluate(
            ([mid, ruido]) => {
              const re = new RegExp(mid, "i"), no = new RegExp(ruido, "i");
              return Array.from(document.querySelectorAll("[href],[data-src],[data-url],[download]"))
                .map((e) => e.getAttribute("href") || e.getAttribute("data-src") || e.getAttribute("data-url") || "")
                .filter((u) => u && re.test(u) && !no.test(u));
            },
            [MIDIA.source, RUIDO.source] as const,
          );
          cap.texto = limpar((await page.locator("main, body").first().innerText().catch(() => "")) ?? "").slice(0, 300);
        } catch (e) {
          cap.erro = (e as Error).message.slice(0, 120);
        }
        cap.rede = [...balde];
        cap.fontes = classificar([...cap.iframes, ...cap.links, ...cap.rede]);
        lessons.push(cap);
        if (jaTemTudo(lessons)) break;
      }
      if (jaTemTudo(lessons)) break;

      // Recolhe antes do próximo módulo: `abertas()` conta lessons visíveis no
      // accordion inteiro, então dois módulos abertos confundiriam a contagem.
      await cab.scrollIntoViewIfNeeded().catch(() => undefined);
      await cab.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
    }

    return { disciplinaId, url, modulos: nomesModulo, lessons };
  } finally {
    await browser?.close();
  }
}
