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

**Nunca acessar provas.** `GET /exams`, "Fazer prova", "Refazer" e qualquer rota
com `prova|avalia|simulad|exame|question` ficam fora — inclusive nos probes.

## Em aberto

- **URLs dos PDFs** ("Material em PDF" e "Livro Digital"). A lista de lessons é
  accordion; clique simples no texto não revelou link. Falta expandir a seção e
  observar a requisição.
- Se `<slug>_videos_<N>.html` usa mesmo `N` = posição do módulo (verificado só
  no módulo 1 de uma disciplina).
- As 8 disciplinas restantes têm `external_url_content` vazio — descobrir se a
  playlist existe mesmo assim ou se o conteúdo vem por outra via.
