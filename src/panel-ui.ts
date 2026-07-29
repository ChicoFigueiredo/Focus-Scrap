/**
 * A página do painel — HTML, CSS e JS numa string só.
 *
 * Separado de `panel.ts` porque a página cresceu: lá ficam as rotas e as
 * tarefas, aqui fica a interface. Continua sem bundler e sem dependência: é um
 * painel local de uma pessoa, e uma etapa de build aqui seria peso morto.
 *
 * Cuidado ao editar: este é um template literal NORMAL, não `String.raw`. As
 * crases e os `${}` do script embutido vão escapados (`\`` e `\${`). Trocar por
 * String.raw preserva as barras invertidas e o navegador recebe um JS com erro
 * de sintaxe — a página abre só com o cabeçalho, sem aviso nenhum.
 */
export const PAGINA = `
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>focus-scrap</title>
<style>
 :root{
   --bg:#0f1115; --card:#171a21; --linha:#242833; --txt:#e6e8ee; --fraco:#8b93a7;
   --ok:#3fb950; --erro:#f85149; --pend:#d29922; --ac:#4c8dff; --realce:#4c8dff22;
 }
 @media (prefers-color-scheme:light){
   :root{--bg:#f6f7f9;--card:#fff;--linha:#e3e6ec;--txt:#1a1d23;--fraco:#5c6472;--realce:#4c8dff1a}
 }
 *{box-sizing:border-box}
 html,body{height:100%}
 body{margin:0;background:var(--bg);color:var(--txt);
   font:14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
   display:flex;flex-direction:column;overflow:hidden}

 header{padding:12px 18px;border-bottom:1px solid var(--linha);display:flex;gap:14px;
   align-items:center;flex-wrap:wrap;flex-shrink:0}
 h1{font-size:15px;margin:0;font-weight:650;letter-spacing:-.01em}
 select{background:var(--card);color:var(--txt);border:1px solid var(--linha);
   border-radius:8px;padding:7px 11px;font:inherit;max-width:min(48vw,460px);cursor:pointer}
 button{background:var(--ac);color:#fff;border:0;border-radius:7px;padding:7px 12px;
   cursor:pointer;font:inherit}
 button.sec{background:transparent;color:var(--txt);border:1px solid var(--linha)}
 button:disabled{opacity:.45;cursor:not-allowed}

 .metricas{display:flex;gap:10px;padding:12px 18px;flex-wrap:wrap;flex-shrink:0;
   border-bottom:1px solid var(--linha)}
 .m{background:var(--card);border:1px solid var(--linha);border-radius:10px;
   padding:9px 14px;min-width:104px}
 .m .rot{color:var(--fraco);font-size:11px;text-transform:uppercase;letter-spacing:.4px}
 .m .num{font-size:19px;font-weight:650;line-height:1.25}
 .barra{height:6px;background:var(--linha);border-radius:99px;overflow:hidden;margin-top:6px}
 .barra i{display:block;height:100%;background:var(--ok)}

 main{flex:1;display:grid;grid-template-columns:340px 1fr;min-height:0}
 @media (max-width:900px){main{grid-template-columns:1fr;overflow:auto}}

 #arvore{border-right:1px solid var(--linha);overflow:auto;padding:10px 6px 30px}
 #arvore .mod{margin-bottom:2px}
 #arvore .mod>summary{padding:7px 10px;border-radius:7px;cursor:pointer;font-weight:600;
   font-size:13px;display:flex;justify-content:space-between;gap:8px;align-items:center}
 #arvore .mod>summary:hover{background:var(--realce)}
 #arvore .item{display:flex;gap:8px;align-items:baseline;padding:6px 10px 6px 24px;
   border-radius:7px;cursor:pointer;font-size:13px}
 #arvore .item:hover{background:var(--realce)}
 #arvore .item.on{background:var(--ac);color:#fff}
 #arvore .item.on .n,#arvore .item.on .tag{color:#fff;opacity:.85}
 .n{color:var(--fraco);font-variant-numeric:tabular-nums;font-size:12px;flex-shrink:0}
 .rotulo{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .tag{font-size:10px;color:var(--fraco);flex-shrink:0}
 .pt{width:7px;height:7px;border-radius:99px;flex-shrink:0;align-self:center}
 .pt.done{background:var(--ok)} .pt.error{background:var(--erro)}
 .pt.pending{background:var(--pend)} .pt.skipped{background:var(--fraco)}

 #conteudo{overflow:auto;padding:18px 22px 40px}
 .vazio{color:var(--fraco);display:grid;place-items:center;height:100%;text-align:center}
 video{width:100%;max-height:46vh;background:#000;border-radius:10px;display:block}
 iframe.doc{width:100%;height:78vh;border:1px solid var(--linha);border-radius:10px;background:#fff}
 h2.tit{font-size:17px;margin:14px 0 4px;font-weight:650}
 .meta{color:var(--fraco);font-size:12.5px;margin-bottom:16px;display:flex;gap:14px;flex-wrap:wrap}
 .arquivo{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 16px}
 .arquivo code{background:var(--card);border:1px solid var(--linha);border-radius:7px;
   padding:6px 10px;font:12px/1.4 ui-monospace,Menlo,monospace;color:var(--fraco);
   flex:1;min-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 button.mini{padding:5px 10px;font-size:12.5px}

 .transc{background:var(--card);border:1px solid var(--linha);border-radius:10px;overflow:hidden}
 .transc>header{padding:10px 14px;border-bottom:1px solid var(--linha);display:flex;
   gap:10px;align-items:center;justify-content:space-between}
 .transc h3{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--fraco)}
 .falas{max-height:38vh;overflow:auto;padding:6px}
 .fala{display:flex;gap:10px;padding:6px 10px;border-radius:7px;cursor:pointer;align-items:baseline}
 .fala:hover{background:var(--realce)}
 .fala.on{background:var(--realce);box-shadow:inset 3px 0 0 var(--ac)}
 .fala time{color:var(--fraco);font-variant-numeric:tabular-nums;font-size:12px;flex-shrink:0;min-width:46px}
 .corrido{padding:14px;white-space:pre-wrap;line-height:1.75}
 .md{max-width:78ch;line-height:1.75}
 .md h1{font-size:22px;margin:26px 0 10px;font-weight:680;letter-spacing:-.01em}
 .md h2{font-size:17px;margin:24px 0 8px;font-weight:650;color:var(--ac)}
 .md h3{font-size:14.5px;margin:20px 0 6px;font-weight:650;color:var(--fraco);
   text-transform:none;letter-spacing:0}
 .md p{margin:0 0 14px}
 .md ul{margin:0 0 14px;padding-left:20px}
 .md li{margin:4px 0}
 .md hr{border:0;border-top:1px solid var(--linha);margin:22px 0}
 .md a{color:var(--ac)}
 .md code{background:var(--card);padding:1px 5px;border-radius:5px;font-size:12.5px}

 pre.saida{margin:0;padding:10px 12px;background:var(--bg);border:1px solid var(--linha);
   border-radius:8px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;
   word-break:break-word;max-height:200px;overflow:auto;color:var(--fraco)}
 details.acoes{border-bottom:1px solid var(--linha);flex-shrink:0}
 details.acoes>summary{padding:10px 18px;cursor:pointer;color:var(--fraco);font-size:13px}
 .painel-acoes{padding:0 18px 14px}
 ul.ev{list-style:none;padding:0;margin:10px 0 0;max-height:160px;overflow:auto;font-size:12.5px}
 ul.ev li{padding:4px 0;border-top:1px solid var(--linha);color:var(--fraco)}
 .erro{color:var(--erro)}
</style>

<header>
  <h1>focus-scrap</h1>
  <select id="combo" onchange="escolher(this.value)"></select>
  <span style="flex:1"></span>
  <span class="tag" id="resumo"></span>
  <button class="sec" onclick="carregar()">Atualizar</button>
</header>

<details class="acoes">
  <summary>Ações e eventos</summary>
  <div class="painel-acoes" id="acoes"></div>
</details>

<div class="metricas" id="metricas"></div>

<main>
  <nav id="arvore"></nav>
  <section id="conteudo"><div class="vazio">Escolha uma aula na árvore à esquerda.</div></section>
</main>

<script>
const $ = s => document.querySelector(s);
const esc = s => (s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mb = b => !b ? '' : b > 1e9 ? (b/1e9).toFixed(2)+' GB' : (b/1e6).toFixed(1)+' MB';
const dd = n => String(n).padStart(2,'0');
const relogio = s => { s=Math.max(0,Math.floor(s||0)); const h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;
  return h ? h+':'+dd(m)+':'+dd(r) : m+':'+dd(r); };

let dados = null, discAtual = null, itemAtual = null, falas = [], vid = null;

async function carregar(){
  dados = await (await fetch('/api/tudo')).json();
  if (discAtual == null || !dados.disciplinas.some(d => d.id === discAtual))
    discAtual = dados.disciplinas[0]?.id ?? null;
  pintarCombo(); pintarMetricas(); pintarArvore(); pintarAcoes();
  const g = dados.stats.porStatus||{};
  $('#resumo').textContent = (g.pending||g.error)
    ? \`\${g.pending||0} na fila\${g.error?' · '+g.error+' com erro':''}\` : 'acervo completo';
}

function disc(){ return dados.disciplinas.find(d => d.id === discAtual); }

function pintarCombo(){
  // A entrada dos escritos vem primeiro, como a pasta 00- no disco.
  $('#combo').innerHTML =
    \`<option value="escritos" \${discAtual==='escritos'?'selected':''}>00 — Materiais Escritos</option>\`
    + dados.disciplinas.map(d =>
      \`<option value="\${d.id}" \${d.id===discAtual?'selected':''}>\${dd(d.posicao)}. \${esc(d.nome)} — \${d.ok}/\${d.itens}</option>\`).join('');
}
function escolher(id){ discAtual = id === 'escritos' ? 'escritos' : Number(id); itemAtual = null;
  if (discAtual === 'escritos'){ pintarMetricas(); pintarArvore(); abrirMd(); return; }
  pintarMetricas(); pintarArvore(); $('#conteudo').innerHTML = '<div class="vazio">Escolha uma aula na árvore à esquerda.</div>'; }

function pintarMetricas(){
  if (discAtual === 'escritos'){
    const ds = dados.disciplinas;
    const soma = k => ds.reduce((s,d)=>s+(d[k]||0),0);
    const cartao = (rot,num) => \`<div class="m"><div class="rot">\${rot}</div><div class="num">\${num}</div></div>\`;
    $('#metricas').innerHTML =
      cartao('Disciplinas', ds.length) + cartao('Aulas transcritas', soma('transcritos')) +
      cartao('Materiais', dados.arvore.filter(r=>r.item_id&&r.kind!=='video').length) +
      cartao('Horas de vídeo', relogio(soma('duracao'))) + cartao('No disco', mb(soma('bytes')));
    return;
  }
  const d = disc(); if(!d) return;
  const pct = d.itens ? Math.round(d.ok/d.itens*100) : 0;
  const cartao = (rot,num,extra='') => \`<div class="m"><div class="rot">\${rot}</div><div class="num">\${num}</div>\${extra}</div>\`;
  $('#metricas').innerHTML =
    cartao('Módulos', d.modulos) +
    cartao('Aulas e materiais', d.itens) +
    cartao('Vídeos', d.videos) +
    cartao('Transcritos', d.transcritos) +
    cartao('No disco', mb(d.bytes)||'—') +
    cartao('Duração', d.duracao ? relogio(d.duracao) : '—') +
    cartao('Capturado', pct+'%', \`<div class="barra"><i style="width:\${pct}%"></i></div>\`);
}

function pintarArvore(){
  if (discAtual === 'escritos') return pintarArvoreEscritos();
  const linhas = dados.arvore.filter(r => r.disc_id === discAtual && r.item_id != null);
  const mods = new Map();
  for (const r of linhas){
    if(!mods.has(r.mod_id)) mods.set(r.mod_id, {nome:r.mod_nome, pos:r.mod_pos, itens:[]});
    mods.get(r.mod_id).itens.push(r);
  }
  const d0 = disc();
  // Capítulo 00: a transcrição desta disciplina, antes dos módulos — mesma
  // ordem em que aparece no disco.
  const cap00 = d0?.transcricao
    ? \`<details class="mod" open><summary><span>00 — Materiais Escritos</span><span class="tag">1</span></summary>
        <div class="item \${itemAtual==='d'+d0.id?'on':''}" onclick="abrirMd('\${d0.transcricao}','d\${d0.id}')">
          <span class="pt done"></span><span class="n">00.01</span>
          <span class="rotulo">Transcrição da disciplina</span><span class="tag">md</span></div>
       </details>\`
    : '';

  $('#arvore').innerHTML = cap00 + [...mods.values()].sort((a,b)=>a.pos-b.pos).map(m => {
    const ok = m.itens.filter(i=>i.download_status==='done').length;
    return \`<details class="mod" open>
      <summary><span>\${dd(m.pos)} — \${esc(m.nome)}</span><span class="tag">\${ok}/\${m.itens.length}</span></summary>
      \${m.itens.map(i => \`<div class="item \${i.item_id===itemAtual?'on':''}" onclick="abrir(\${i.item_id})">
          <span class="pt \${i.download_status}"></span>
          <span class="n">\${dd(m.pos)}.\${dd(i.position)}</span>
          <span class="rotulo" title="\${esc(i.title)}">\${esc(i.title)}</span>
          <span class="tag">\${i.kind}</span>
        </div>\`).join('')}
    </details>\`;
  }).join('') || '<div class="vazio" style="padding:30px">Nada catalogado nesta disciplina.</div>';
}

function pintarArvoreEscritos(){
  const mats = dados.arvore.filter(r => r.item_id != null && r.kind !== 'video' && r.download_status === 'done');
  const porDisc = new Map();
  for (const r of mats){
    if(!porDisc.has(r.disc_id)) porDisc.set(r.disc_id, {id:r.disc_id, nome:r.disc_nome, pos:r.disc_pos, itens:[]});
    porDisc.get(r.disc_id).itens.push(r);
  }
  $('#arvore').innerHTML =
    \`<div class="item \${itemAtual==='ix'?'on':''}" onclick="abrirMd()">
        <span class="pt done"></span><span class="rotulo">Índice dos escritos</span><span class="tag">md</span></div>
     <div class="item \${itemAtual==='tr'?'on':''}" onclick="abrirMd('\${TRANSC}')">
        <span class="pt done"></span><span class="rotulo">Transcrição Geral</span><span class="tag">md</span></div>\`
    + [...porDisc.values()].sort((a,b)=>a.pos-b.pos).map(d =>
      \`<details class="mod" open><summary><span>\${dd(d.pos)} — \${esc(d.nome)}</span>
         <span class="tag">\${d.itens.length}</span></summary>
        \${(dados.disciplinas.find(x=>x.id===d.id)?.transcricao
            ? \`<div class="item \${itemAtual==='d'+d.id?'on':''}" onclick="abrirMd('\${dados.disciplinas.find(x=>x.id===d.id).transcricao}','d\${d.id}')">
                 <span class="pt done"></span><span class="n">00</span>
                 <span class="rotulo">Transcrição da disciplina</span><span class="tag">md</span></div>\` : '')}
        \${d.itens.map(i => \`<div class="item \${i.item_id===itemAtual?'on':''}" onclick="abrir(\${i.item_id})">
            <span class="pt done"></span><span class="n">\${dd(i.mod_pos)}.\${dd(i.position)}</span>
            <span class="rotulo" title="\${esc(i.mod_nome)}">\${esc(i.mod_nome)}</span>
            <span class="tag">\${i.kind}</span></div>\`).join('')}
      </details>\`).join('');
}

const TRANSC = 'Transcrição.Geral.md';
async function abrirMd(arquivo, marca){
  itemAtual = marca ?? (arquivo ? 'tr' : 'ix');
  if (discAtual === 'escritos') pintarArvoreEscritos(); else pintarArvore();
  const cx = $('#conteudo');
  cx.innerHTML = '<div class="vazio">carregando…</div>';
  const r = await fetch('/md' + (arquivo ? '?p='+encodeURIComponent(arquivo) : ''));
  if (!r.ok){ cx.innerHTML = '<div class="vazio">Ainda não gerado. Use <b>Gerar Materiais Escritos</b> nas Ações.</div>'; return; }
  const j = await r.json();
  cx.innerHTML = '<div class="md">'+j.html+'</div>';
  cx.scrollTop = 0;
  // Link para PDF abre no painel; link para outro .md navega sem sair da página.
  cx.querySelectorAll('a[href^="/md?p="]').forEach(a => {
    const alvo = decodeURIComponent(a.getAttribute('href').slice('/md?p='.length));
    if (/\\.md$/i.test(alvo)) a.onclick = e => { e.preventDefault(); abrirMd(alvo); };
    else a.setAttribute('target','_blank');
  });
}

/**
 * Barra "onde está o arquivo": caminho no formato do sistema, botão para abrir
 * o Explorer com ele selecionado e botão para copiar o caminho. O navegador não
 * consegue revelar arquivo sozinho — quem faz é o servidor local.
 */
function barraArquivo(id){
  return \`<div class="arquivo">
      <code id="cam" title="carregando…">carregando caminho…</code>
      <button class="sec mini" onclick="revelar(\${id})">Mostrar na pasta</button>
      <button class="sec mini" onclick="copiarCaminho(this)">Copiar caminho</button>
    </div>\`;
}
async function carregarCaminho(id){
  const j = await (await fetch('/api/caminho?id='+id)).json();
  const el = $('#cam'); if(!el) return;
  el.textContent = j.caminho ?? '(sem arquivo)';
  el.title = j.caminho ?? '';
}
async function revelar(id){
  const r = await (await fetch('/api/revelar?id='+id,{method:'POST'})).json();
  if(!r.ok) alert('Não consegui abrir: '+r.msg);
}
async function copiarCaminho(botao){
  const t = $('#cam')?.textContent ?? '';
  try { await navigator.clipboard.writeText(t); }
  catch {
    // clipboard API exige contexto seguro; em http://127.0.0.1 o Chrome
    // permite, mas outros navegadores não — daí o modo antigo como reserva.
    const a=document.createElement('textarea'); a.value=t; document.body.appendChild(a);
    a.select(); document.execCommand('copy'); a.remove();
  }
  const o = botao.textContent;
  botao.textContent = 'copiado ✓';
  setTimeout(()=>{ botao.textContent = o; }, 1400);
}

async function abrir(id){
  itemAtual = id; pintarArvore();
  const r = dados.arvore.find(x => x.item_id === id);
  if(!r) return;

  if (r.download_status !== 'done'){
    $('#conteudo').innerHTML = \`<h2 class="tit">\${esc(r.title)}</h2>
      <div class="meta">status: <b class="\${r.download_status}">\${r.download_status}</b></div>
      \${r.download_error?\`<p class="erro">\${esc(r.download_error)}</p>\`:'<p class="tag">Ainda não capturado.</p>'}\`;
    return;
  }

  if (r.kind !== 'video'){
    $('#conteudo').innerHTML = \`<h2 class="tit">\${esc(r.title)}</h2>
      <div class="meta"><span>\${esc(r.kind)}</span><span>\${mb(r.bytes)}</span></div>
      \${barraArquivo(id)}
      <iframe class="doc" src="/media/\${id}"></iframe>\`;
    carregarCaminho(id);
    return;
  }

  // O <track> só aceita WebVTT; o servidor converte o .srt do acervo na hora.
  $('#conteudo').innerHTML = \`
    <video id="v" controls preload="metadata">
      <source src="/media/\${id}" type="video/mp4">
      <track id="leg" kind="subtitles" srclang="pt" label="Português" src="/legenda/\${id}" default>
    </video>
    <h2 class="tit">\${esc(r.title)}</h2>
    <div class="meta">
      <span>\${dd(r.mod_pos)}.\${dd(r.position)}</span>
      <span>\${mb(r.bytes)}</span>
      \${r.duration?\`<span>\${relogio(r.duration)}</span>\`:''}
      <span>transcrição: \${r.transcribe_status}</span>
    </div>
    \${barraArquivo(id)}
    <div class="transc">
      <header><h3>Transcrição</h3>
        <span class="tag" id="dica">clique numa fala para pular o vídeo</span></header>
      <div class="falas" id="falas">carregando…</div>
    </div>\`;

  carregarCaminho(id);
  vid = $('#v');
  // A faixa precisa ser ligada no JS: o atributo default sozinho nem sempre
  // exibe a legenda. (Sem crases neste arquivo: encerram o template literal.)
  vid.addEventListener('loadedmetadata', () => {
    for (const t of vid.textTracks) t.mode = 'showing';
  });

  falas = await (await fetch('/transcricao/'+id)).json();
  const cx = $('#falas');
  if (!falas.length){
    cx.innerHTML = '<div class="corrido tag">Sem transcrição para esta aula.</div>';
    $('#dica').textContent = '';
    return;
  }
  cx.innerHTML = falas.map((f,i) =>
    \`<div class="fala" data-i="\${i}" onclick="irPara(\${f.inicio})">
       <time>\${relogio(f.inicio)}</time><span>\${esc(f.texto)}</span></div>\`).join('');
  vid.addEventListener('timeupdate', destacar);
}

function irPara(s){ if(vid){ vid.currentTime = s; vid.play(); } }

let ultimo = -1;
function destacar(){
  if(!vid || !falas.length) return;
  const t = vid.currentTime;
  let i = falas.findIndex(f => t >= f.inicio && t < f.fim);
  if (i < 0) return;
  if (i === ultimo) return;
  ultimo = i;
  const cx = $('#falas');
  cx.querySelectorAll('.fala.on').forEach(e => e.classList.remove('on'));
  const el = cx.querySelector(\`.fala[data-i="\${i}"]\`);
  if (el){ el.classList.add('on'); el.scrollIntoView({block:'nearest', behavior:'smooth'}); }
}

function pintarAcoes(){
  const ativa = dados.tarefas.some(t=>t.rodando);
  $('#acoes').innerHTML =
    \`<div style="display:flex;gap:7px;flex-wrap:wrap">\${dados.tarefas.map(t =>
      \`<button \${t.rodando||ativa?'disabled':''} onclick="rodar('\${t.nome}')" title="\${esc(t.dica)}"
        class="\${t.nome.startsWith('media')?'':'sec'}">\${t.rodando?'▶ ':''}\${esc(t.rotulo)}\${t.rodando?' ('+t.segundos+'s)':''}</button>\`).join('')}</div>\`
    + dados.tarefas.filter(t=>t.rodando).map(t =>
      \`<div style="margin-top:10px"><div class="tag">\${esc(t.rotulo)} — \${t.segundos}s</div>
       <pre class="saida">\${t.linhas.map(esc).join('\\n')||'aguardando saída…'}</pre></div>\`).join('')
    + \`<ul class="ev">\${dados.eventos.slice(0,14).map(e =>
      \`<li><span class="tag">\${e.at}</span> <b class="\${e.level==='error'?'erro':''}">\${esc(e.source)}</b> \${esc(e.message)}</li>\`).join('')}</ul>\`;
}
async function rodar(nome){
  const r = await (await fetch('/api/run?tarefa='+nome,{method:'POST'})).json();
  if(!r.ok) alert(r.msg);
  carregar();
}

carregar();
// Atualiza sozinho, mas sem estragar a leitura: só quando há tarefa rodando.
setInterval(() => { if (dados?.tarefas.some(t=>t.rodando)) carregar(); }, 8000);
</script>`;
