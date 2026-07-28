# focus-scrap

Captura os materiais de estudo da **Faculdade Focus** (vídeos, slides, ebooks),
transcreve e legenda, e organiza tudo no disco de estudo.

Herda o molde do scraper `kultivi` (`~/dev/LG/EduLingoCursos/tools/scrapers/kultivi`):
fila resumível em SQLite, downloads com rate-limit, transcrição na GPU e painel web.

> **Estado atual: pipeline completo, do login ao painel.**
> Falta capturar o "Livro Digital", que é visualizador paginado por imagem e não
> arquivo — fica registrado como `skipped`, não como erro.

## Os três sistemas

A Faculdade Focus não tem um AVA só, e o login de um não vale no outro (não há
SSO) — embora as credenciais sejam as mesmas:

| Sistema | Stack | Papel |
|---|---|---|
| **`faculdadefocus.com.br`** | Next.js + JWT | **portal — é onde o curso a capturar é acessado** |
| `ava.faculdadefocus.edu.br` | Moodle | "AVA - Pós-Graduação (2025)" — outro sistema, não serve este curso |
| `faculdadefocus.jacad.com.br` | JACAD | AVA da graduação — fora de escopo |

O curso ("Marketing Digital e Storytelling orientado a Tecnologias da Web") abre
em `/aluno/<slug>/meus-cursos/28859/aulas/<disciplina>`, no **próprio portal**.
Os links de AVA no menu lateral levam a sistemas separados, sem SSO, que não
hospedam esta turma.

O mapa completo — endpoints, headers, pipeline de vídeo — está em
[docs/reconhecimento.md](docs/reconhecimento.md).

> **Provas ficam fora do escopo, sempre.** Nada de `GET /exams`, "Fazer prova"
> ou "Refazer" — nem em código, nem em investigação manual.

## Arquitetura

Dois processos, **um SQLite compartilhado** (`focus.db`, modo WAL) como único
contrato entre eles — nenhum dos dois chama o outro por rede:

```
┌──────────── Bun / TypeScript ────────────┐   ┌──── Python / uv ────┐
│ auth.ts    login Playwright (2 sistemas) │   │ downloader.py       │
│ lesson.ts  navega o accordion, acha URLs │   │   yt-dlp + ffprobe  │
│ cdn.ts     playlist→player→manifesto     │   │ transcriber.py      │
│ agent.ts   gpt-4o-mini: títulos das aulas│──▶│   whisper (fallback)│
│ naming.ts  convenção de nomes do acervo  │   │ pdftext.py          │
│ scrape.ts  cataloga tudo no banco        │◀──│ worker.py   loop    │
│ scan.ts    reconcilia com o disco        │   │                     │
│ panel.ts   dashboard + explorador :7788  │   │                     │
└──────────────────────────────────────────┘   └─────────────────────┘
                    └────────  focus.db (WAL)  ──────────┘
```

O TS cataloga e enfileira; o Python consome, baixa, transcreve e devolve status.
Dá para rodar só o scrape (sem GPU) ou só a mídia (máquina ligada à noite).

**Legenda: oficial quando existe, Whisper quando não.** Na família CDN o
manifesto HLS traz legenda oficial em português e o downloader a salva junto do
vídeo. Na família IESDE não há legenda — aí o `faster-whisper` transcreve na
GPU e gera os três formatos do acervo (`.srt`, `.txt` e
`-Fala.Cronometrada.txt`). O `scan` reconhece legenda que já está no disco e
poupa a placa de reprocessar.

O venv do uv é criado com `--system-site-packages` para enxergar o
`faster-whisper` e o `torch` com CUDA já instalados no sistema, em vez de
baixar ~2,5 GB de novo.

## O agente (`gpt-4o-mini`)

O agente **não é chamado por item** — isso seria caro e não-determinístico. O
papel dele é *sintetizar o padrão* e gravá-lo, para as execuções seguintes
rodarem sem LLM nenhum:

- derivar o slug do CDN a partir do nome da disciplina
  (`Fundamentos de Marketing` → `fundamentos-de-marketing`) e validar com um HEAD
- reextrair o regex do `<li data-src>` quando o template do CDN mudar
- classificar anexo em `Ebook` / `Slides` / `Exercícios`
- mapear nome de módulo para a convenção de pastas do acervo

Cada padrão aceito fica em `agent_patterns` junto da assinatura da página que o
gerou. Enquanto a assinatura não mudar, o scrape é 100% regex. O agente só
reaparece quando o padrão quebra — é um mecanismo de auto-reparo, não um passo
do caminho feliz. Sem chave de API, cai em heurística local: o pipeline nunca
para por falta de LLM.

## Duas famílias de conteúdo

A disciplina 1 usa o CDN da produtora (HLS no CloudFront, com legenda oficial);
as outras oito usam **IESDE** (MP4 com URL assinada). Não é detalhe: tratar as
duas como uma só fazia 8 de 9 disciplinas voltarem sem vídeo nenhum.

Na família CDN a plataforma não expõe título de aula — só "Aula 01" — e é aí
que o agente entra. Na IESDE os títulos vêm prontos, e o agrupamento em módulos
sai de títulos consecutivos iguais. Detalhes em
[docs/reconhecimento.md](docs/reconhecimento.md).

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

O `uv sync` instala só as dependências leves. `faster-whisper` e `torch` vêm do
Python do sistema, porque esta máquina já os tem com CUDA — o venv é criado com
`--system-site-packages` para enxergá-los:

```bash
uv venv --system-site-packages && uv sync --inexact
```

Em máquina que não tenha, `bun run setup:py:gpu` instala o extra `gpu`
(~2,5 GB com CUDA).

`ffmpeg` é dependência de sistema (yt-dlp e faster-whisper precisam dele).

## Uso

Na prática, só isto:

```bash
bun run login     # os dois sistemas → state/{portal,ava}_state.json
bun run panel     # http://127.0.0.1:7788
```

O painel tem botões para **Catalogar**, **Recatalogar tudo**, **Reconciliar
disco**, **Baixar e transcrever** e **Só baixar** — cada um roda como processo
separado, com a linha de status ao vivo, e os demais ficam desabilitados
enquanto um trabalha. Pelo terminal os mesmos passos são:

```bash
bun run scrape    # cataloga disciplinas → módulos → itens no focus.db
bun run scan      # marca como done o que JÁ está no disco (não rebaixa nada)
bun run media     # workers Python: baixa vídeo+legenda e transcreve o resto
```

O `scan` antes do `media` não é opcional: sem ele o worker rebaixaria os 202
arquivos já capturados e rebaixaria dezenas de GB.

```bash
bun run status                  # resumo no terminal
bun run requeue                 # reenfileira downloads com erro
bun run explore -- --disciplina 603   # diagnóstico: o que o accordion devolve
bun run media:no-gpu            # só baixa

bun test && bun run typecheck
```

Todo comando aceita `--enrollment <id>`; `--headed` abre o navegador.

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
