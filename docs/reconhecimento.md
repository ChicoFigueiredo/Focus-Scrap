# Reconhecimento — Faculdade Focus (27/07/2026)

Mapa levantado navegando com a conta do próprio aluno. É a base do `scrape.ts`.
Tudo aqui foi observado, não inferido — o que ainda não foi verificado está
marcado como **em aberto**.

## Onde o curso realmente vive

O conteúdo **não** está no Moodle. A matrícula é acessada no próprio portal:

```
https://faculdadefocus.com.br/aluno/<slug>/meus-cursos/<enrollment_id>
https://faculdadefocus.com.br/aluno/<slug>/meus-cursos/<enrollment_id>/aulas/<discipline_id>
```

Para esta conta: `slug=francisco_seZl_`, `enrollment_id=28859`, turma
`PMDSOTW_P_169_2023_FOCUS_2023.1`, `course_id=510`, `classroom_id=968`.

Os links "AVA - Graduação" (JACAD) e "AVA - Pós-Graduação (2025)" (Moodle) no
menu lateral são outros sistemas, sem SSO, e **não** servem este curso.

## Hierarquia

Bate 1:1 com a organização já existente no disco:

| API | Disco |
|---|---|
| enrollment 28859 → `course.name` | `Marketing.Digital-Storytelling-Web/` |
| `classroom.classroom_disciplines[]` (9) → `discipline` | `01-Fundamentos.de.Marketing/` |
| `discipline.modules[]` (4) | `01-Marketing.e.o.Ambiente.Negócios/` |
| `module.lessons[]` (3): Vídeo Aula, Material em PDF, Livro Digital | os arquivos |

Atenção: "Vídeo Aula" é **uma** entrada de lesson que corresponde a **vários**
vídeos (4 no módulo 1) — a lista real vem da playlist no CDN, não da API.

## Endpoints

`api.grupofocus.com.br` exige **quatro** headers, e um deles é assinado:

| Header | Origem |
|---|---|
| `authorization: Bearer …` | cookie `@faculdadefocus:token` |
| `token: <JWT>` | cookie `@faculdadefocus:appToken` |
| `x-ip` | cookie `@faculdadefocus:ip` |
| `g-repatch` | **64 hex, gerado no cliente** — não reproduzido |

Sem os quatro a API devolve **410**. Como `g-repatch` parece assinatura
SHA-256 calculada em JS, a estratégia é **deixar o app fazer a chamada e colher
a resposta** via Playwright, em vez de reimplementar um cliente HTTP que
quebraria na primeira mudança do algoritmo.

| Endpoint | Traz |
|---|---|
| `GET /enrollments` | matrículas do aluno |
| `GET /enrollments/details/<id>` | curso, turma, **9 disciplinas**, ids dos módulos, notas |
| `GET /enrollments/<id>/disciplines/<disc>` | módulos com nome/posição + lessons |
| `GET /exams?course_id=<id>` | provas — **nunca tocar** |

## São DUAS famílias de conteúdo, não uma

A descoberta mais cara do projeto. A disciplina 1 usa o CDN da produtora; as
outras oito usam **IESDE**, um sistema completamente diferente. Tratar as duas
como uma só fazia 8 de 9 disciplinas voltarem com zero vídeo — e quase me
convenceu de que elas não tinham conteúdo, sendo que o disco já guardava 143
arquivos de uma delas.

| | CDN da produtora | IESDE |
|---|---|---|
| Playlist | `grupofocus.b-cdn.net/playlist_videoaulas/…` | `www5.faculdadefocus.com.br/iesde/<turma>/lessons/playlist` |
| Vídeo | HLS no CloudFront | MP4 direto, **URL assinada e expirável** |
| Legenda | trilha no manifesto | não observada |
| Títulos | **não existem** ("Aula 01") | vêm prontos na playlist |
| Módulos | vêm do accordion | vêm de títulos consecutivos iguais |

Curiosamente o markup da playlist é o mesmo nos dois (`<li data-src>` com
`<span>` de título) — só muda o alvo.

Consequências no desenho:

- O `source_url` de um item IESDE é a página `/show`, **não** o MP4: o link é
  assinado com `exp` e guardar ele daria uma fila que apodrece antes de ser
  consumida. Quem resolve é o downloader, na hora.
- O agrupamento IESDE por título consecutivo reproduz o acervo exatamente:
  10 pastas com 6,6,4,7,4,5,3,2,5,4 vídeos, os mesmos 46 do disco.
- O agente só é chamado na família CDN. Na IESDE não há ambiguidade a resolver.

## Pipeline de mídia (tudo público, sem auth)

```
discipline.external_url_content
  → https://grupofocus.b-cdn.net/disciplinas-completas/index_<slug>.html      (trilha, landing)

playlist por módulo
  → https://grupofocus.b-cdn.net/playlist_videoaulas/produtora_tele/<slug>_videos_<N>.html
     HTML estático, um <li data-src> por aula:
       <li data-src="https://scorm.onilearning.com.br/player.php?id=1555&video=<md5>&estudante="
           data-index="0"><span>Aula 01</span></li>

player
  → https://scorm.onilearning.com.br/player.php?id=<id>&video=<md5>&estudante=
     hls.js apontando para CloudFront

manifesto
  → https://d2un266hqcizhh.cloudfront.net/<a>/<b>/<b>.m3u8?v=oni
     variantes 360 / 720 / 1080
     #EXT-X-MEDIA:TYPE=SUBTITLES LANGUAGE="por" URI="<b>LEGENDA.m3u8"
```

**Legenda oficial em português vem no manifesto.** Isso muda o lado Python: a
transcrição por GPU deixa de ser o caminho padrão e vira *fallback* para vídeo
sem legenda. Baixar a legenda pronta é mais barato e mais fiel que Whisper.

Sem DRM aparente (hls.js puro) — `yt-dlp` baixa vídeo e legenda direto do m3u8.

## Navegação do accordion (é ela que revela o material)

As URLs de PDF e livro **não estão em lugar nenhum da API** — só aparecem
quando se clica a lesson e o painel da esquerda troca. Daí `src/lesson.ts`
navegar de verdade. A estrutura do accordion, dentro de um scroll-area do Radix:

```html
<button>  <span class="text-sm font-medium">Marketing e o Ambiente de Negócio</span>
          <span class="text-xs text-muted-foreground">3 aulas</span>   ← MÓDULO
<button>  <span class="text-left break-words flex-1">Vídeo Aula</span> ← LESSON
```

Distinção usada: **módulo é o botão que exibe "N aulas"; o resto é lesson.**
Não se usa classe Tailwind como seletor — elas mudam a cada build.

Armadilhas encontradas:

- A página tem **vários** `[data-radix-scroll-area-viewport]`; o do menu lateral
  vem antes. Filtra-se pelo que contém "N aulas".
- `waitUntil: "networkidle"` **nunca resolve**: o player HLS baixa segmentos
  continuamente. Espera-se o texto "Conteúdo do Curso" aparecer.
- O 1º módulo já vem expandido — clicar nele fecharia. Só se clica quando não há
  lesson visível; e recolhe-se ao terminar, senão a contagem do próximo confunde.
- O slug do aluno **não** está no cookie `@faculdadefocus:slug` (esse é o da
  instituição, "faculdadefocus"). Deduz-se do redirect de `/aluno`.
- O player da lesson anterior continua baixando depois da troca, e respostas
  atrasadas caem no balde errado — foi assim que um módulo ganhou a legenda do
  vizinho. Por isso a legenda é **derivada do manifesto**, não lida da rede.

## Formatos de lesson (12/12 classificadas na disciplina 603)

| Lesson | Tipo | Como capturar |
|---|---|---|
| Vídeo Aula | `video` | playlist do CDN → N vídeos; manifesto HLS por vídeo |
| Material em PDF | `pdf` | **download direto** |
| Livro Digital | `livro` | visualizador paginado — **não é arquivo único** |

```
Material em PDF
  https://scorm.onilearning.com.br/conteudo/componente.php
      ?id=<n>&instituicao=337&componente=<md5>&saida=arquivo&estudante=
  → 200 application/pdf, sem auth. Verificado: 3,2 MB, 21 páginas, %PDF-1.7.

Livro Digital
  …/componente.php?id=<n>&instituicao=337&onepage=<md5>&estudante=
  → HTML paginado; as páginas vêm como imagem em
    imagem.php?Arquivo=<n>&Altura=2000&Largura=2000&Token=<t>
```

Confirmado que o `<N>` de `<slug>_videos_<N>.html` é a **posição do módulo**:
módulos 1–4 da disciplina 603 deram `_videos_1` … `_videos_4`.

## Determinismo e o papel do agente

Quase tudo acima é regex sobre HTML estático. O agente `gpt-4o-mini` não deve
ser chamado por item; o papel dele é **sintetizar o padrão determinístico** e
gravá-lo, para as execuções seguintes rodarem sem LLM:

- derivar o slug do CDN a partir do nome da disciplina
  (`Fundamentos de Marketing` → `fundamentos-de-marketing`) e **validar** com um
  HEAD antes de aceitar
- extrair o regex do `<li data-src>` quando o template do CDN mudar
- classificar anexo em `Ebook` / `Slides` / `Exercícios`
- mapear nome de módulo → nome de pasta na convenção do acervo

Cada padrão aceito é gravado com a assinatura da página que o gerou. Enquanto a
assinatura não mudar, não há chamada de LLM.

## Restrição

**Nunca acessar provas.** Vale para `GET /exams`, "Fazer prova", "Refazer",
"Simulado" e "Questionário" — em código e em investigação manual. O guarda é
`PROIBIDO` em `src/lesson.ts`, aplicado a nome de módulo, nome de lesson e URL,
com teste de regressão em `tests/lesson.test.ts`.

> A primeira versão do padrão usava `exame` e deixava passar `/exams` — o
> endpoint real. O teste pegou. Por isso o padrão é `exam`, sem o "e" final.

## Em aberto

- **Livro Digital** é visualizador paginado por imagem, não arquivo. Falta
  decidir: iterar páginas e montar PDF, ou procurar uma saída direta (o
  `componente.php` aceita `saida=arquivo` no Material em PDF — talvez aceite
  algo equivalente aqui).
- As outras 8 disciplinas têm `external_url_content` vazio. A navegação do
  accordion não depende desse campo, então provavelmente funcionam igual — mas
  só foi verificada a disciplina 603 (4 módulos, 12 lessons).
- Quantos vídeos por playlist nas demais disciplinas, e se alguma foge do trio
  Vídeo Aula / Material em PDF / Livro Digital.
