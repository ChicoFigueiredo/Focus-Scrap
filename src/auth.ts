/**
 * Login nos dois sistemas da Faculdade Focus → `state/<alvo>_state.json`.
 *
 * Descobertas do reconhecimento (2026-07-27), com as credenciais do próprio aluno:
 *
 *  portal — faculdadefocus.com.br
 *    App Next.js multi-tenant (rota `[domain]`), SEM elemento <form>: os campos
 *    ficam soltos no DOM e o submit é server action. Os `id` dos inputs vêm de
 *    `useId()` do React (`_R_aav5tl5ubsdb_-form-item`) e mudam a cada build —
 *    o seletor DEVE ser por `name`. O botão "Entrar" não nasce disabled
 *    (diferente do kultivi, que exigia keystroke real para habilitar).
 *    Autentica em `POST api.grupofocus.com.br/sessions` (JWT), então a sessão
 *    salva precisa do localStorage, não só dos cookies.
 *
 *  ava — ava.faculdadefocus.edu.br
 *    Moodle padrão (`#username`, `#password`, `#loginbtn`, `logintoken` de CSRF
 *    resolvido pelo próprio submit). É onde vivem os materiais.
 *
 * A sessão do portal NÃO vale no AVA: não há SSO entre eles, apesar de as
 * credenciais serem as mesmas. Por isso duas sessões separadas.
 *
 * Nunca repete tentativa automaticamente: senha errada em repetição é o
 * caminho mais rápido para bloquear a conta.
 */
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

import {
  AVA_URL,
  PORTAL_URL,
  STATE_DIR,
  STORAGE_STATE,
  USER_AGENT,
  requireCredentials,
  type Target,
} from "./config.ts";

export interface LoginResult {
  target: Target;
  ok: boolean;
  finalUrl: string;
  message: string;
  /** Endpoints de API observados durante o login — insumo para o scrape. */
  apiCalls: string[];
}

/** Mensagem de erro exibida pelo app, se houver. */
async function readError(page: Page, selectors: string[]): Promise<string | null> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    const has = await el.count().then((n) => n > 0).catch(() => false);
    if (!has) continue;
    const t = (await el.textContent().catch(() => ""))?.trim();
    if (t) return t.slice(0, 200);
  }
  return null;
}

interface Flow {
  loginUrl: string;
  /** Preenche e submete. */
  submit: (page: Page, user: string, password: string) => Promise<void>;
  /** true quando a URL final ainda é a de login (fracasso). */
  stillOnLogin: (url: string) => boolean;
  errorSelectors: string[];
}

const FLOWS: Record<Target, Flow> = {
  portal: {
    loginUrl: `${PORTAL_URL}/login`,
    async submit(page, user, password) {
      const email = page.locator('input[name="email"]');
      await email.waitFor({ state: "visible", timeout: 30_000 });
      await email.click();
      // pressSequentially em vez de fill: é o que o react-hook-form espera.
      await email.pressSequentially(user, { delay: 25 });
      const senha = page.locator('input[name="password"]');
      await senha.click();
      await senha.pressSequentially(password, { delay: 25 });
      await page.getByRole("button", { name: /^entrar$/i }).first().click();
    },
    stillOnLogin: (url) => new URL(url).pathname.startsWith("/login"),
    errorSelectors: ['[role="alert"]', "[data-sonner-toast]", ".text-destructive"],
  },

  ava: {
    loginUrl: `${AVA_URL}/login/index.php`,
    async submit(page, user, password) {
      await page.locator("#username").waitFor({ state: "visible", timeout: 30_000 });
      await page.locator("#username").fill(user);
      await page.locator("#password").fill(password);
      await page.locator("#loginbtn").click();
    },
    stillOnLogin: (url) => new URL(url).pathname.includes("/login/"),
    errorSelectors: [".loginerrors", "#loginerrormessage", ".alert-danger"],
  },
};

export async function login(
  target: Target,
  opts: { headed?: boolean } = {},
): Promise<LoginResult> {
  const { user, password } = requireCredentials();
  const flow = FLOWS[target];
  await mkdir(STATE_DIR, { recursive: true });

  let browser: Browser | undefined;
  const apiCalls = new Set<string>();

  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const ctx = await browser.newContext({ userAgent: USER_AGENT, locale: "pt-BR" });
    const page = await ctx.newPage();

    page.on("request", (r) => {
      const u = r.url();
      if (/grupofocus\.com\.br|\/webservice\/|\/api\//.test(u) && !/_next|\.js$|\.css$/.test(u)) {
        apiCalls.add(`${r.method()} ${u.split("?")[0]}`);
      }
    });

    await page.goto(flow.loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    await Promise.all([
      page.waitForURL((u) => !flow.stillOnLogin(u.href), { timeout: 45_000 }).catch(() => undefined),
      flow.submit(page, user, password),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);

    const finalUrl = page.url();
    if (flow.stillOnLogin(finalUrl)) {
      return {
        target,
        ok: false,
        finalUrl,
        message:
          (await readError(page, flow.errorSelectors)) ??
          "continuou na tela de login sem mensagem de erro visível",
        apiCalls: [...apiCalls],
      };
    }

    // storageState inclui cookies E localStorage (onde mora o JWT do portal).
    await ctx.storageState({ path: STORAGE_STATE[target] });
    return {
      target,
      ok: true,
      finalUrl,
      message: `sessão salva em ${STORAGE_STATE[target]}`,
      apiCalls: [...apiCalls],
    };
  } finally {
    await browser?.close();
  }
}
