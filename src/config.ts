/**
 * Configuração central do focus-scrap (lado TypeScript).
 *
 * O Bun carrega o `.env` da raiz automaticamente em `process.env` — não há
 * dependência de dotenv. O lado Python lê o MESMO arquivo (py/focus/config.py),
 * então toda variável nova deve entrar nos dois e no `.env.example`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// --- Caminhos -----------------------------------------------------------
export const BASE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const DB_PATH = join(BASE_DIR, "focus.db");
export const STATE_DIR = join(BASE_DIR, "state");
/** symlink → /mnt/e/Marketing/Focus */
export const REPOSITORY = join(BASE_DIR, "repository");

// --- Alvos --------------------------------------------------------------
// São dois sistemas distintos, com sessões independentes e as MESMAS credenciais:
//
//   portal  faculdadefocus.com.br      Next.js + JWT (POST api.grupofocus.com.br/sessions)
//           → matrículas, dados do aluno, financeiro. Não serve conteúdo.
//   ava     ava.faculdadefocus.edu.br  Moodle
//           → onde vivem os vídeos, ebooks e slides da pós-graduação.
//
// (Existe ainda faculdadefocus.jacad.com.br — AVA da GRADUAÇÃO, sistema JACAD.
//  Fora de escopo: o curso matriculado nesta conta é de pós.)
export const PORTAL_URL = process.env.FOCUS_BASE_URL ?? "https://faculdadefocus.com.br";
export const AVA_URL = process.env.FOCUS_AVA_URL ?? "https://ava.faculdadefocus.edu.br";

export const USER = process.env.FOCUS_USER ?? "";
export const PASSWORD = process.env.FOCUS_PASSWORD ?? "";

/** Sessão salva por alvo — não compartilham cookie nem SSO. */
export const STORAGE_STATE = {
  portal: join(STATE_DIR, "portal_state.json"),
  ava: join(STATE_DIR, "ava_state.json"),
} as const;

export type Target = keyof typeof STORAGE_STATE;

// --- Agente (decisões não-determinísticas na página) --------------------
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
export const AGENT_MODEL = process.env.FOCUS_AGENT_MODEL ?? "openai/gpt-4o-mini";
/** DOM podado enviado ao modelo é truncado neste limite (custo por chamada). */
export const AGENT_MAX_DOM_CHARS = Number(process.env.FOCUS_AGENT_MAX_DOM ?? 12_000);

// --- Painel -------------------------------------------------------------
export const PANEL_HOST = process.env.FOCUS_PANEL_HOST ?? "127.0.0.1";
export const PANEL_PORT = Number(process.env.FOCUS_PANEL_PORT ?? 7788);

export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/** Falha cedo e com mensagem útil quando falta credencial. */
export function requireCredentials(): { user: string; password: string } {
  if (!USER || !PASSWORD) {
    throw new Error(
      "FOCUS_USER e FOCUS_PASSWORD não estão no .env — copie de .env.example e preencha.",
    );
  }
  return { user: USER, password: PASSWORD };
}
