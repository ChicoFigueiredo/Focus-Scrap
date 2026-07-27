# focus-scrap

Captura os materiais de estudo da **Faculdade Focus** (vídeos, slides, ebooks),
transcreve e legenda, e organiza tudo no disco de estudo.

Herda o molde do scraper `kultivi` (`~/dev/LG/EduLingoCursos/tools/scrapers/kultivi`):
fila resumível em SQLite, downloads com rate-limit, transcrição na GPU e painel web.

> **Estado atual: ambiente montado e login funcionando.**
> Prontos: `config` dos dois lados e `auth.ts` (autentica de verdade nos dois
> sistemas e salva as sessões). Ainda por escrever: `scrape`, `agent`, `naming`,
> `downloader`, `transcriber`, `panel`.

## Os três sistemas

A Faculdade Focus não tem um AVA só, e o login de um não vale no outro (não há
SSO) — embora as credenciais sejam as mesmas:

| Sistema | Stack | Papel |
|---|---|---|
| `faculdadefocus.com.br` | Next.js + JWT | portal: matrículas, dados do aluno, financeiro |
| `ava.faculdadefocus.edu.br` | **Moodle** | **AVA da pós — onde estão os materiais** |
| `faculdadefocus.jacad.com.br` | JACAD | AVA da graduação — fora de escopo |

O curso matriculado nesta conta ("Marketing Digital e Storytelling orientado a
Tecnologias da Web") é de **pós-graduação**, então o alvo do scrape é o Moodle.
O portal entra só pelas matrículas.

## Arquitetura

Dois processos, **um SQLite compartilhado** (`focus.db`, modo WAL) como único
contrato entre eles — nenhum dos dois chama o outro por rede:

```
┌──────────── Bun / TypeScript ────────────┐   ┌──── Python / uv ────┐
│ auth.ts     login Playwright → cookies   │   │ downloader.py       │
│ scrape.ts   enumera curso→matéria→lição  │   │   yt-dlp            │
│ agent.ts    gpt-4o-mini decide no DOM    │──▶│ transcriber.py      │
│ naming.ts   convenção de nomes do acervo │   │   faster-whisper GPU│
│ panel.ts    dashboard :7788              │◀──│ worker.py  loop     │
│ cli.ts      entrypoint                   │   │                     │
└──────────────────────────────────────────┘   └─────────────────────┘
                    └────────  focus.db (WAL)  ──────────┘
```

O TS enfileira lições; o Python consome, baixa, transcreve e devolve o status.
Dá para rodar só o scrape (sem GPU) ou só a mídia (máquina ligada à noite).

## O agente (`gpt-4o-mini`)

Decide **na página**, onde o DOM não é determinístico. O alvo ser Moodle encolheu
bastante esse papel — a árvore de curso→seção→atividade é previsível e tem API
própria —, então sobrou o que é de fato ambíguo: classificar um anexo
(`Ebook`/`Slides`/`Exercícios`) a partir de nome e contexto, decidir se uma seção
é matéria ou unidade, e normalizar título bagunçado para a convenção de nomes.

Recebe DOM podado, responde JSON de schema fixo, e só escolhe ações de uma
allowlist. Toda decisão fica em `agent_decisions` para auditoria — e para virar
seletor determinístico depois. Sem chave de API, cai em heurística local: o
pipeline nunca para por falta de LLM.

## Acervo

`repository` é symlink → `/mnt/e/Marketing/Focus`. A convenção abaixo foi
extraída do que já está capturado lá (202 arquivos) e é **restrição dura** —
o scraper reconcilia com o disco antes de baixar e nunca sobrescreve:

```
Focus/Marketing.Digital-Storytelling-Web/          ← curso
  01-Fundamentos.de.Marketing/                     ← matéria (+ .xspf da matéria)
    01-Marketing.e.o.Ambiente.Negócios/            ← unidade
      01.01-Conceito.de.Marketing.mp4
      01.01-Conceito.de.Marketing.srt
      01.01-Conceito.de.Marketing-Fala.Cronometrada.txt
      01.05-Ebook-Marketing.e.o.Ambiente.Negócios.pdf
      01.06-Slides-Marketing.e.o.Ambiente.Negócios.pdf
```

Pontos no lugar de espaços, acentos preservados, `NN-` em pastas e `NN.NN-` em
lições. Os `.xspf` são playlists de VLC com caminhos Windows (`file:///E:/…`).

## Setup

```bash
bun run setup          # bun install + playwright chromium + uv sync
cp .env.example .env   # e preencha FOCUS_USER / FOCUS_PASSWORD
```

O `uv sync` instala só as dependências leves. `faster-whisper` e `torch` ficam
no extra `gpu` (~2.5 GB com CUDA) porque o Python do sistema desta máquina já
os tem — use `bun run setup:py:gpu` apenas se quiser o venv autossuficiente.

`ffmpeg` é dependência de sistema (yt-dlp e faster-whisper precisam dele).

## Uso

```bash
bun run login              # os dois sistemas → state/{portal,ava}_state.json
bun run login -- --ava     # só o Moodle
bun run login -- --headed  # abre o navegador para depurar

bun run scan      # reconcilia o acervo do disco com o banco
bun run scrape    # cataloga curso → matéria → unidade → lição
bun run media     # workers Python: baixa + transcreve
bun run panel     # dashboard em http://127.0.0.1:7788
bun run status

bun test          # testes do lado TS
bun run typecheck
```

## Configuração (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `FOCUS_BASE_URL` | `https://faculdadefocus.com.br` | portal |
| `FOCUS_AVA_URL` | `https://ava.faculdadefocus.edu.br` | Moodle da pós |
| `FOCUS_USER` / `FOCUS_PASSWORD` | — | credenciais do aluno (valem nos dois) |
| `OPENROUTER_API_KEY` | — | chave do agente |
| `FOCUS_AGENT_MODEL` | `openai/gpt-4o-mini` | modelo do agente |
| `FOCUS_RATE_LIMIT` | `3M` | limite de banda do yt-dlp |
| `FOCUS_DELAY` | `20` | segundos entre downloads |
| `FOCUS_WHISPER_MODEL` | `large-v3` | modelo do Whisper |
| `FOCUS_WHISPER_COMPUTE` | `float16` | precisão (GPU) |
| `FOCUS_WHISPER_BATCH` | `16` | batch da transcrição |
| `FOCUS_PANEL_PORT` | `7788` | porta do painel |

> Uso responsável: baixa conteúdo da conta autenticada do próprio usuário, com
> rate-limit e de forma incremental. Não redistribui.
