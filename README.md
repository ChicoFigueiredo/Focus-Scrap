# focus-scrap

Captura os materiais de estudo da **Faculdade Focus** (vídeos, slides, ebooks,
livros digitais), transcreve e legenda tudo, e organiza no disco de estudo —
com um painel web para acompanhar, assistir e navegar o acervo.

Herda o molde do scraper `kultivi` (`~/dev/LG/EduLingoCursos/tools/scrapers/kultivi`):
fila resumível em SQLite, downloads com rate-limit, transcrição na GPU e painel web.

> **Estado atual: pipeline completo e acervo 100% capturado.**
> 9 disciplinas · 306/306 itens · 22,76 GB · 283 vídeos legendados · 15 PDFs ·
> 8 Livros Digitais. `bun test && bun run typecheck` limpos.

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
> ou "Refazer" — nem em código, nem em investigação manual. Ver `PROIBIDO` em
> [src/lesson.ts](src/lesson.ts).

## Arquitetura

Dois processos, **um SQLite compartilhado** (`focus.db`, modo WAL) como único
contrato entre eles — nenhum dos dois chama o outro por rede:

```
┌──────────── Bun / TypeScript ────────────┐   ┌──── Python / uv ────┐
│ auth.ts      login Playwright (2 sist.)  │   │ downloader.py       │
│ lesson.ts    navega o accordion, URLs    │   │   yt-dlp + ffmpeg   │
│ cdn.ts       playlist→player→manifesto   │   │   + http direto     │
│ iesde.ts     URL assinada, agrupamento   │──▶│ transcriber.py      │
│ agent.ts     gpt-4o-mini: padrões novos  │   │   faster-whisper    │
│ naming.ts    convenção de nomes do acervo│   │ pdftext.py          │
│ scrape.ts    cataloga tudo no banco      │◀──│ verify.py           │
│ scan.ts      reconcilia com o disco      │   │ worker.py    loop   │
│ assistir.ts  navegação assistida (fallb.)│   │                     │
│ livro.ts     Livro Digital → PDF         │   │                     │
│ escritos.ts  "00-Materiais Escritos"     │   │                     │
│ revelar.ts   abre Explorer/nautilus etc. │   │                     │
│ panel.ts     dashboard + explorador :7788│   │                     │
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

### Cadeia de fallback do download

Quando o método padrão falha, o Python tenta os seguintes, em ordem, até um
funcionar (ver `_estrategias` em [py/focus/downloader.py](py/focus/downloader.py)):

- **`.m3u8` (família CDN):** `yt-dlp` → `ffmpeg` direto no manifesto.
- **MP4 assinado (família IESDE):** download HTTP direto → `yt-dlp` → `ffmpeg`.
  A URL assinada expira; `resolver_iesde` tenta renová-la alternando entre a
  API (`_via_api`) e a página fonte (`_via_source`) por até 4 rodadas antes de
  desistir.
- **Se nada funcionar:** o item fica em `error` com o motivo, pronto para
  `bun run assistir` — a navegação assistida pelo usuário.

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

## Navegação assistida (último recurso)

Quando nem o scrape automático nem a cadeia de fallback resolvem um item —
sessão caída, verificação manual, um clique que só existe na interface —
`bun run assistir` abre o navegador **visível** na disciplina com pendência.
Você navega como aluno; o programa escuta a rede em segundo plano e casa cada
URL de mídia capturada com o item correspondente no banco. Nada é baixado ali:
a captura só atualiza `source_url` e devolve o item para a fila — quem baixa
continua sendo `bun run media`.

## Livro Digital

Um dos formatos do curso não é arquivo: é uma página HTML interativa (capa +
botão "Começar" + seções que o JS mostra/esconde). `bun run livros` renderiza a
página no Chromium, força todas as seções visíveis via CSS e imprime em PDF
pelo próprio navegador — o resultado é texto selecionável, não captura de
tela. Guarda de segurança: se a altura da página não crescer pelo menos 1,5×
depois de forçar as seções, a captura é rejeitada em vez de salvar um PDF
incompleto.

## "00-Materiais Escritos"

`bun run escritos` monta uma pasta por curso com:

- **Um índice** (`00-Materiais.Escritos.md`) com links para todos os PDFs,
  ebooks e livros digitais do curso, mais a transcrição geral.
- **Uma transcrição geral** de todo o curso — não é a legenda, é o texto
  corrido de cada aula — em markdown hierárquico: `H1` disciplina, `H2` grupo
  de aulas, `H3` nome da aula.
- **Uma transcrição por disciplina**, guardada dentro da própria pasta da
  disciplina como "capítulo 00" (`00-Transcrição.<Disciplina>.md`) — para abrir
  o material de uma matéria sem precisar navegar pelo índice geral.

Tudo fica acessível pelo painel, na combo `00 — Materiais Escritos`.

## Acervo

`repository` é symlink → `/mnt/e/Marketing/Focus`:

```bash
ln -s /mnt/e/Marketing/Focus repository
```

A convenção abaixo foi extraída do que já estava capturado lá e é **restrição
dura** — o scraper reconcilia com o disco antes de baixar e nunca sobrescreve:

```
Focus/Marketing.Digital-Storytelling-Web/          ← curso
  00-Materiais.Escritos/                            ← índice + transcrição geral
    00-Materiais.Escritos.md
    Transcrição.Geral.md
  01-Fundamentos.de.Marketing/                      ← matéria (+ .xspf da matéria)
    00-Transcrição.Fundamentos.de.Marketing.md      ← capítulo 00 (transcrição da disciplina)
    01-Marketing.e.o.Ambiente.Negócios/             ← unidade
      01.01-Conceito.de.Marketing.mp4
      01.01-Conceito.de.Marketing.srt
      01.01-Conceito.de.Marketing-Fala.Cronometrada.txt
      01.05-Ebook-Marketing.e.o.Ambiente.Negócios.pdf
      01.06-Slides-Marketing.e.o.Ambiente.Negócios.pdf
```

Pontos no lugar de espaços, acentos preservados, `NN-` em pastas e `NN.NN-` em
lições. Caractere ilegal no NTFS vira `.` (não é removido — `E/S` tem que virar
`E.S`, nunca `ES`). Os `.xspf` são playlists de VLC com caminhos Windows
(`file:///E:/…`). Ver [src/naming.ts](src/naming.ts).

## Setup

```bash
bun run setup          # bun install + playwright chromium + uv sync
cp .env.example .env   # e preencha FOCUS_USER / FOCUS_PASSWORD
ln -s /mnt/e/Marketing/Focus repository   # se o symlink ainda não existir
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

O painel dispara cada tarefa como processo separado (com a linha de status ao
vivo e log de saída), e os demais botões ficam desabilitados enquanto um
trabalha — dois `scrape` ou dois `media` ao mesmo tempo brigariam pelo mesmo
recurso. Cada botão roda, por baixo, o comando de terminal equivalente:

| Botão do painel | Equivalente no terminal | O que faz |
|---|---|---|
| Login | `bun run login` | Renova a sessão nos dois sistemas |
| Catalogar o que falta | `bun run scrape -- --continuar` | Só disciplinas ainda não catalogadas |
| Renovar as com erro | `bun run scrape -- --com-erro` | Recataloga só quem tem item em erro (renova URL assinada) |
| Recatalogar tudo | `bun run scrape` | As 9 disciplinas do zero (~40 min) |
| Reenfileirar erros | `bun run requeue` | Devolve para a fila os downloads que falharam |
| Reenfileirar transcrições | `bun run requeue -- --transcribe` | Idem, para transcrições que falharam |
| Reconciliar disco | `bun run scan` | Marca como pronto o que já está no disco — **rode antes de baixar** |
| Baixar e transcrever | `bun run media` | Consome a fila: baixa + transcreve o que não tem legenda |
| Só baixar | `bun run media:no-gpu` | Mesmo, sem GPU |
| Capturar Livros Digitais | `bun run livros` | Renderiza e imprime em PDF os livros interativos |
| Gerar Materiais Escritos | `bun run escritos` | Monta o índice e a transcrição geral/por disciplina |
| Conferir integridade | `bun run verify` | Abre cada arquivo (ffprobe, `%PDF`) e reenfileira o que falhar |

O `scan` antes do `media` não é opcional: sem ele o worker rebaixaria tudo que
já foi capturado — dezenas de GB de novo.

Além das tarefas do painel, o explorador do painel mostra a árvore do curso,
toca vídeo com legenda embutida e transcrição clicável ao lado, e tem botões
**Abrir**, **Mostrar na pasta** e **Copiar caminho** para levar qualquer
arquivo (vídeo, PDF, markdown) direto para o Explorer/Finder/gerenciador do
sistema.

### Todos os comandos `bun run`

```bash
bun run login                          # login Playwright nos dois sistemas
bun run login -- --portal              # só o portal
bun run login -- --ava                 # só o AVA (Moodle)
bun run login -- --headed              # navegador visível, para depurar

bun run scrape                         # cataloga disciplinas → módulos → itens no focus.db
bun run scrape -- --continuar          # pula disciplinas já catalogadas
bun run scrape -- --com-erro           # só recataloga disciplinas com item em erro
bun run scrape -- --disciplina <id>    # restringe a uma disciplina

bun run scan                           # marca como done o que JÁ está no disco (não rebaixa nada)
bun run status                         # resumo: disciplinas, módulos, itens, bytes, status
bun run requeue                        # reenfileira downloads com erro
bun run requeue -- --transcribe        # reenfileira transcrições com erro
bun run faltando                       # lista os itens ainda não capturados

bun run explore -- --disciplina 603    # diagnóstico: o que o accordion devolve para uma disciplina
bun run assistir                       # navegação assistida (browser visível) para pendências
bun run assistir -- --disciplina <id>  # numa disciplina específica
bun run assistir -- --minutos 20       # tempo de captura da sessão assistida

bun run livros                         # captura os Livros Digitais (HTML interativo → PDF)
bun run escritos                       # gera "00-Materiais Escritos" (índice + transcrições)

bun run media                          # workers Python: baixa vídeo+legenda e transcreve o resto
bun run media:no-gpu                   # só baixa, sem transcrever (sem GPU)
bun run verify                         # ffprobe/checagem de integridade + reenfileira falhas

bun run panel                          # painel web em http://127.0.0.1:7788

bun run setup                          # bun install + playwright chromium + uv sync
bun run setup:browser                  # só o playwright install chromium
bun run setup:py                       # só o uv sync (dependências leves)
bun run setup:py:gpu                   # uv sync com extra "gpu" (~2,5 GB, CUDA)

bun run typecheck                      # tsc --noEmit
bun run test                           # bun test
```

Todo comando aceita `--enrollment <id>` (padrão `28859`).

## Configuração (`.env`)

`.env` é lido pelos dois lados (TS via `process.env` do Bun, Python via
`py/focus/config.py`) — variável nova entra nos dois arquivos e no
`.env.example`.

| Variável | Padrão | Descrição |
|---|---|---|
| `FOCUS_BASE_URL` | `https://faculdadefocus.com.br` | portal — onde o curso é acessado |
| `FOCUS_AVA_URL` | `https://ava.faculdadefocus.edu.br` | Moodle da pós (secundário) |
| `FOCUS_USER` / `FOCUS_PASSWORD` | — | credenciais do aluno (valem nos dois sistemas) |
| `FOCUS_CURSO_PASTA` | `Marketing.Digital-Storytelling-Web` | pasta do curso dentro do acervo |
| `OPENROUTER_API_KEY` | — | chave do agente (sem ela, cai em heurística local) |
| `FOCUS_AGENT_MODEL` | `openai/gpt-4o-mini` | modelo do agente |
| `FOCUS_AGENT_MAX_DOM` | `12000` | limite de caracteres do DOM enviado ao agente |
| `FOCUS_RATE_LIMIT` | `3M` | limite de banda do yt-dlp |
| `FOCUS_DELAY` | `20` | segundos entre downloads |
| `FOCUS_WHISPER_MODEL` | `large-v3` | modelo do Whisper |
| `FOCUS_WHISPER_COMPUTE` | `float16` | precisão (GPU) |
| `FOCUS_WHISPER_BATCH` | `16` | batch da transcrição |
| `FOCUS_PANEL_HOST` | `127.0.0.1` | host do painel |
| `FOCUS_PANEL_PORT` | `7788` | porta do painel |

> Uso responsável: baixa conteúdo da conta autenticada do próprio usuário, com
> rate-limit e de forma incremental. Não redistribui.
