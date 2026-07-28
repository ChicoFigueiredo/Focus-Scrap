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
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { PANEL_HOST, REPOSITORY } from "./config.ts";
import { reenfileirar, stats } from "./db.ts";

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

// Template literal NORMAL, não String.raw: o script embutido usa crases e `${}`
// escapados, e String.raw preservaria as barras invertidas, entregando ao
// navegador um JS com erro de sintaxe — a página abria só com o cabeçalho.
const PAGINA = `
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>focus-scrap</title>
<style>
 :root{--bg:#0f1115;--card:#171a21;--linha:#242833;--txt:#e6e8ee;--fraco:#8b93a7;--ok:#3fb950;--erro:#f85149;--pend:#d29922;--ac:#4c8dff}
 @media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--card:#fff;--linha:#e3e6ec;--txt:#1a1d23;--fraco:#666e80}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 header{padding:16px 20px;border-bottom:1px solid var(--linha);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
 h1{font-size:16px;margin:0;font-weight:650}
 nav a{color:var(--fraco);text-decoration:none;margin-right:14px;cursor:pointer}
 nav a.on{color:var(--ac);font-weight:600}
 main{padding:20px;max-width:1200px;margin:0 auto}
 .grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
 .cartao{background:var(--card);border:1px solid var(--linha);border-radius:10px;padding:14px}
 .num{font-size:24px;font-weight:650}
 .rot{color:var(--fraco);font-size:12px;text-transform:uppercase;letter-spacing:.4px}
 .barra{height:7px;background:var(--linha);border-radius:99px;overflow:hidden;margin-top:8px}
 .barra i{display:block;height:100%;background:var(--ok)}
 details{background:var(--card);border:1px solid var(--linha);border-radius:10px;margin-bottom:8px}
 summary{padding:12px 14px;cursor:pointer;font-weight:600;display:flex;justify-content:space-between;gap:10px}
 .mod{padding:0 14px 12px}
 .mod>b{display:block;margin:12px 0 6px;color:var(--fraco);font-size:12px;text-transform:uppercase}
 table{width:100%;border-collapse:collapse}
 td{padding:6px 8px;border-top:1px solid var(--linha);vertical-align:top}
 td.n{color:var(--fraco);white-space:nowrap;width:1%}
 .tag{font-size:11px;padding:1px 7px;border-radius:99px;border:1px solid var(--linha)}
 .done{color:var(--ok)}.error{color:var(--erro)}.pending{color:var(--pend)}.skipped{color:var(--fraco)}
 button{background:var(--ac);color:#fff;border:0;border-radius:7px;padding:7px 13px;cursor:pointer;font:inherit}
 button.sec{background:transparent;color:var(--txt);border:1px solid var(--linha)}
 .abrir{color:var(--ac);cursor:pointer;text-decoration:none}
 #visor{position:fixed;inset:0;background:#000c;display:none;align-items:center;justify-content:center;padding:24px;z-index:9}
 #visor>div{background:var(--card);border-radius:12px;padding:14px;max-width:min(1000px,95vw);width:100%}
 video,iframe{width:100%;border:0;border-radius:8px;background:#000}
 iframe{height:78vh}
 ul.ev{list-style:none;padding:0;margin:0;max-height:280px;overflow:auto}
 ul.ev li{padding:5px 0;border-top:1px solid var(--linha);font-size:13px}
 .fraco{color:var(--fraco)}
</style>
<header>
  <h1>focus-scrap</h1>
  <nav><a id="t-painel" class="on">Painel</a><a id="t-curso">Explorador</a></nav>
  <span style="flex:1"></span>
  <button class="sec" onclick="req('download')">Reenfileirar erros</button>
  <button class="sec" onclick="carregar()">Atualizar</button>
</header>
<main><div id="painel"></div><div id="curso" hidden></div></main>
<div id="visor" onclick="if(event.target.id==='visor')fechar()"><div id="visor-c"></div></div>
<script>
const $ = s => document.querySelector(s);
const esc = s => (s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mb = b => !b ? '' : b > 1e9 ? (b/1e9).toFixed(2)+' GB' : (b/1e6).toFixed(1)+' MB';

let dados = null;
async function carregar(){
  dados = await (await fetch('/api/tudo')).json();
  pintarPainel(); pintarCurso();
}
function pintarPainel(){
  const s = dados.stats, ev = dados.eventos;
  const done = s.porStatus.done||0, tot = s.itens||0;
  const pct = tot ? Math.round(done/tot*100) : 0;
  $('#painel').innerHTML = \`
   <div class="grade">
     <div class="cartao"><div class="rot">Disciplinas</div><div class="num">\${s.disciplinas}</div></div>
     <div class="cartao"><div class="rot">Módulos</div><div class="num">\${s.modulos}</div></div>
     <div class="cartao"><div class="rot">Itens</div><div class="num">\${s.itens}</div></div>
     <div class="cartao"><div class="rot">No disco</div><div class="num">\${mb(s.bytes)||'—'}</div></div>
     <div class="cartao"><div class="rot">Capturado</div><div class="num">\${pct}%</div>
       <div class="barra"><i style="width:\${pct}%"></i></div></div>
   </div>
   <div class="grade">
     \${Object.entries(s.porStatus).map(([k,v])=>\`<div class="cartao"><div class="rot">\${k}</div><div class="num \${k}">\${v}</div></div>\`).join('')}
     \${Object.entries(s.porTipo).map(([k,v])=>\`<div class="cartao"><div class="rot">tipo \${k}</div><div class="num">\${v}</div></div>\`).join('')}
   </div>
   <div class="cartao"><div class="rot" style="margin-bottom:8px">Eventos</div>
     <ul class="ev">\${ev.map(e=>\`<li><span class="fraco">\${e.at}</span> <b class="\${e.level==='error'?'error':''}">\${esc(e.source)}</b> \${esc(e.message)}</li>\`).join('') || '<li class="fraco">nada ainda</li>'}</ul>
   </div>\`;
}
function pintarCurso(){
  const porDisc = new Map();
  for (const r of dados.arvore){
    if(!porDisc.has(r.disc_id)) porDisc.set(r.disc_id,{nome:r.disc_nome,pos:r.disc_pos,mods:new Map()});
    if(r.mod_id==null) continue;
    const d = porDisc.get(r.disc_id);
    if(!d.mods.has(r.mod_id)) d.mods.set(r.mod_id,{nome:r.mod_nome,pos:r.mod_pos,itens:[]});
    if(r.item_id!=null) d.mods.get(r.mod_id).itens.push(r);
  }
  $('#curso').innerHTML = [...porDisc.values()].sort((a,b)=>a.pos-b.pos).map(d=>{
    const itens = [...d.mods.values()].flatMap(m=>m.itens);
    const ok = itens.filter(i=>i.download_status==='done').length;
    return \`<details><summary><span>\${String(d.pos).padStart(2,'0')}. \${esc(d.nome)}</span>
      <span class="tag">\${ok}/\${itens.length}</span></summary>
      \${[...d.mods.values()].sort((a,b)=>a.pos-b.pos).map(m=>\`<div class="mod">
        <b>\${String(m.pos).padStart(2,'0')} — \${esc(m.nome)}</b>
        <table>\${m.itens.map(i=>\`<tr>
          <td class="n">\${String(m.pos).padStart(2,'0')}.\${String(i.position).padStart(2,'0')}</td>
          <td>\${i.download_status==='done'&&i.rel_path?\`<a class="abrir" onclick="abrir(\${i.item_id})">\${esc(i.title)}</a>\`:esc(i.title)}
              \${i.download_error?\`<div class="error">\${esc(i.download_error)}</div>\`:''}</td>
          <td class="n"><span class="tag">\${i.kind}</span></td>
          <td class="n fraco">\${mb(i.bytes)}</td>
          <td class="n \${i.download_status}">\${i.download_status}</td>
        </tr>\`).join('')}</table></div>\`).join('')}
    </details>\`;
  }).join('') || '<p class="fraco">Nada catalogado ainda. Rode <code>bun run scrape</code>.</p>';
}
function abrir(id){
  const r = dados.arvore.find(x=>x.item_id===id); if(!r) return;
  const url = '/media/'+id;
  $('#visor-c').innerHTML = r.kind==='video'
    ? \`<video src="\${url}" controls autoplay></video>\`
    : \`<iframe src="\${url}"></iframe>\`;
  $('#visor').style.display='flex';
}
function fechar(){ $('#visor').style.display='none'; $('#visor-c').innerHTML=''; }
addEventListener('keydown', e => e.key==='Escape' && fechar());
async function req(qual){ const r = await (await fetch('/api/requeue?qual='+qual,{method:'POST'})).json(); alert(r.n+' item(ns) reenfileirado(s)'); carregar(); }
$('#t-painel').onclick=()=>{ $('#painel').hidden=false; $('#curso').hidden=true; $('#t-painel').classList.add('on'); $('#t-curso').classList.remove('on'); };
$('#t-curso').onclick=()=>{ $('#painel').hidden=true; $('#curso').hidden=false; $('#t-curso').classList.add('on'); $('#t-painel').classList.remove('on'); };
carregar(); setInterval(carregar, 10000);
</script>`;

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
          stats: stats(db),
          arvore: arvore(db),
          eventos: db.query(`SELECT at, level, source, message FROM events ORDER BY id DESC LIMIT 60`).all(),
        });
      }

      if (rota === "/api/requeue" && req.method === "POST") {
        const qual = url.searchParams.get("qual") === "transcribe" ? "transcribe" : "download";
        return Response.json({ n: reenfileirar(db, qual) });
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
