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
 .ck{accent-color:var(--ac);width:14px;height:14px;margin:0;cursor:pointer;flex-shrink:0;align-self:center}
 .tudo{display:flex;gap:8px;align-items:center;padding:8px 10px;margin-bottom:6px;cursor:pointer;
   border-bottom:1px solid var(--linha);font-size:12.5px;color:var(--fraco)}
 .tudo:hover{background:var(--realce)}
 .tudo .rotulo{flex:1}
 #arvore .item.visto .rotulo{color:var(--fraco)}
 #arvore .item.on.visto .rotulo{color:#fff}
 .pt{width:7px;height:7px;border-radius:99px;flex-shrink:0;align-self:center}
 .pt.done{background:var(--ok)} .pt.error{background:var(--erro)}
 .pt.pending{background:var(--pend)} .pt.skipped{background:var(--fraco)}

 #conteudo{overflow:auto;padding:18px 22px 40px}
 .vazio{color:var(--fraco);display:grid;place-items:center;height:100%;text-align:center}
 video{width:100%;max-height:46vh;background:#000;border-radius:10px;display:block}
 iframe.doc{width:100%;height:78vh;border:1px solid var(--linha);border-radius:10px;background:#fff}

 /* O palco é o vídeo mais os controles próprios. Existe por causa da tela
    cheia: o botão nativo põe em tela cheia o VIDEO, e aí só sobra o vídeo na
    tela — as setas de navegação somem junto com o resto da página. Escondo o
    botão nativo (Chrome/Edge) e uso o meu, que põe o PALCO inteiro em tela
    cheia; assim as setas continuam por cima. Em navegador que não aceita o
    seletor, o troca-tela-cheia no JS conserta depois. */
 .palco{position:relative;background:#000;border-radius:10px;overflow:hidden}
 .palco:fullscreen{border-radius:0;display:grid;place-items:center;width:100vw;height:100vh}
 .palco:fullscreen video{max-height:100vh;height:100vh;object-fit:contain}
 video::-webkit-media-controls-fullscreen-button{display:none}

 /* Aparecem ao mexer o mouse e enquanto está parado, como os controles nativos. */
 .nav,.hud{position:absolute;opacity:0;transition:opacity .18s;pointer-events:none}
 .palco.mexeu .nav,.palco.mexeu .hud,.palco.parado .nav,.palco.parado .hud{opacity:1}
 .nav{top:0;bottom:52px;left:0;right:0;display:flex;align-items:center;
   justify-content:space-between;padding:0 10px}
 .nav button{pointer-events:auto;width:44px;height:66px;border-radius:10px;
   background:#000a;color:#fff;font-size:26px;line-height:1}
 .nav button:disabled{opacity:0;pointer-events:none}
 .hud{top:10px;left:10px;right:10px;display:flex;gap:8px;align-items:center}
 .chip{background:#000a;color:#fff;border:0;border-radius:8px;padding:5px 10px;font-size:12.5px}
 .chip.on{background:var(--ac)}
 .hud button.chip{pointer-events:auto}
 .hud .rot{min-width:0;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .hud #fs{margin-left:auto}

 /* A legenda é desenhada AQUI, e não pelo navegador. Estilizar a legenda nativa
    (video::cue) não funciona de verdade: as preferências de legenda do sistema
    e do navegador — tamanho, cor, fundo — entram por cima da regra da página,
    e aí o chip "Aa" trocava a regra e nada mudava na tela. Sendo uma div comum,
    o tamanho é exatamente o escolhido, e em px justamente para NÃO acompanhar a
    altura do vídeo: o mesmo tamanho na janela e em tela cheia. */
 .legenda{position:absolute;left:0;right:0;bottom:58px;padding:0 5%;text-align:center;
   pointer-events:none;font-size:var(--tamleg,18px);line-height:1.35}
 .legenda:empty{display:none}
 /* Uma caixa só para a fala inteira, e não uma por linha: com fundo por linha
    as emendas aparecem como listras entre elas. */
 .legenda>span{display:inline-block;background:#000b;color:#fff;border-radius:6px;
   padding:.18em .5em;text-shadow:0 1px 2px #000}
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

 .anot{background:var(--card);border:1px solid var(--linha);border-radius:10px;
   overflow:hidden;margin-top:14px}
 .anot>header{padding:10px 14px;border-bottom:1px solid var(--linha);display:flex;
   gap:10px;align-items:center;justify-content:space-between}
 .anot h3{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--fraco)}
 .anot textarea{width:100%;border:0;background:transparent;color:var(--txt);
   font:inherit;line-height:1.7;padding:12px 14px;resize:vertical;min-height:88px;display:block}
 .anot textarea:focus{outline:0;background:var(--realce)}
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
  <span class="tag" id="fila" style="color:var(--pend)"></span>
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
const haTempo = ms => { if(ms==null) return 'nunca';
  const s=Math.floor(ms/1000); if(s<60) return 'há '+s+'s'; if(s<3600) return 'há '+Math.floor(s/60)+'min';
  return 'há '+Math.floor(s/3600)+'h'; };

let dados = null, discAtual = null, itemAtual = null, falas = [], vid = null;
let palco = null, ordem = [], prog = {}, notas = {}, prefs = {}, restaurou = false;

async function carregar(){
  dados = await (await fetch('/api/tudo')).json();
  prog = dados.progresso || {};
  notas = dados.notas || {};
  prefs = dados.prefs || {};
  // O que estava na fila de uma sessão anterior continua valendo por cima do
  // que o servidor mandou, e vai embora no primeiro empurrão.
  for (const op of fila) aplicarLocal(op);
  aplicarPrefs();
  // Só na primeira carga: "Atualizar" e o laço de tarefas chamam isto o tempo
  // todo, e reabrir a última tela a cada volta puxaria a aula debaixo de quem
  // está assistindo.
  const reabrir = !restaurou && dados.estado;
  restaurou = true;
  if (reabrir) discAtual = dados.estado.disc;
  if (discAtual !== 'escritos' && (discAtual == null || !dados.disciplinas.some(d => d.id === discAtual)))
    discAtual = dados.disciplinas[0]?.id ?? null;
  pintarCombo(); pintarMetricas(); pintarArvore(); pintarAcoes();
  if (reabrir) reabrirTela(dados.estado);
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
  pintarMetricas(); pintarArvore(); guardarTela();
  $('#conteudo').innerHTML = '<div class="vazio">Escolha uma aula na árvore à esquerda.</div>'; }

// --- onde eu estava ---------------------------------------------------------
// A tela aberta e o progresso ficam no banco, e não no navegador: são dados do
// acervo (viajam na cópia sincronizada do focus.db) e não se perdem quando
// alguém limpa os dados do site. Preferências de player — velocidade, autoplay,
// tamanho da legenda — continuam no localStorage: essas são do navegador.

// --- fila de sincronização --------------------------------------------------
//
// Nenhuma escrita vai direto para a rede. Ela entra numa fila no localStorage,
// o estado da tela muda na hora (ninguém espera o servidor para ver a caixinha
// marcar), e a fila só encolhe quando o servidor confirma. Uma piscada do túnel
// deixa de custar a marcação: ela fica na fila e vai no próximo empurrão.
//
// O mesmo endpoint empurra e puxa. A resposta traz progresso, notas e
// preferências frescos, então sincronizar já é ficar em dia com o outro
// aparelho — e é por isso que dá para chamar de tempos em tempos sem inventar
// uma segunda rota só de leitura.
const CHAVE_FILA = 'focus.fila';
let fila = [];
let sincronizando = false;

function lerFila(){
  try { const f = JSON.parse(localStorage.getItem(CHAVE_FILA)); return Array.isArray(f) ? f : []; }
  catch { return []; }
}
function gravarFila(){
  try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); } catch {}
}

/** Muda o estado local do jeito que o servidor mudaria — para a tela não esperar. */
function aplicarLocal(op){
  if (op.t === 'progresso'){
    const c = {};
    if (op.segundos != null) c.segundos = op.segundos;
    if (op.visto != null) c.visto = op.visto;
    prog[op.chave] = Object.assign({segundos:0, visto:false}, prog[op.chave], c);
  } else if (op.t === 'lote'){
    for (const ch of op.chaves)
      prog[ch] = Object.assign({segundos:0, visto:false}, prog[ch], {visto: op.visto});
  } else if (op.t === 'nota'){
    if (op.texto.trim()) notas[op.chave] = op.texto; else delete notas[op.chave];
  } else if (op.t === 'pref'){
    prefs[op.nome] = op.valor;
  }
}

function enfileirar(op){
  fila.push(op);
  gravarFila();
  aplicarLocal(op);
  pintarFila();
  sincronizarFila();
}

/**
 * Manda a fila e recebe o estado fresco. Com 'puxar', vai mesmo sem fila —
 * é assim que a aba se atualiza ao voltar para o foco.
 */
async function sincronizarFila(puxar){
  if (sincronizando || (!fila.length && !puxar)) return;
  sincronizando = true;
  const enviadas = fila.length;
  try {
    const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ops: fila.slice(0, enviadas)})});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    // Só o que foi enviado sai da fila: o que entrou durante a viagem fica.
    fila = fila.slice(enviadas);
    gravarFila();
    absorver(j);
  } catch {
    // Fica tudo na fila. O próximo gatilho — foco, rede voltando, o laço de
    // 30s — tenta de novo. Não há o que fazer aqui além de não perder nada.
  } finally {
    sincronizando = false;
    pintarFila();
  }
}

/**
 * Assume o que o servidor mandou e recoloca por cima o que ainda não foi
 * confirmado. Sem esse "por cima", uma marcação feita durante a viagem seria
 * desfeita na tela por um estado que ainda não a conhecia.
 */
function absorver(j){
  if (!j || !j.progresso) return;
  const antes = JSON.stringify([prog, notas, prefs]);
  prog = j.progresso; notas = j.notas || {}; prefs = j.prefs || {};
  for (const op of fila) aplicarLocal(op);
  if (JSON.stringify([prog, notas, prefs]) === antes) return;
  // Só repinta quando algo mudou de fato: repintar a árvore reabre os módulos
  // que a pessoa fechou, e fazer isso a cada 30s por nada seria um estorvo.
  aplicarPrefs();
  pintarNota();
  if (discAtual === 'escritos') pintarArvoreEscritos(); else pintarArvore();
}

/** Aviso discreto de que ainda há coisa por enviar. */
function pintarFila(){
  const el = $('#fila');
  if (!el) return;
  el.textContent = fila.length ? '⇅ ' + fila.length + ' por enviar' : '';
  el.title = fila.length
    ? 'Marcações e anotações ainda não confirmadas pelo servidor. Vão sozinhas quando a conexão voltar.'
    : '';
}

/** Guarda a tela em cartaz. O md é o arquivo, quando a tela é um escrito. */
function guardarTela(md){
  enfileirar({t:'tela', valor: JSON.stringify({disc: discAtual, item: itemAtual, md: md ?? null})});
}
/** Reabre o que estava no ar da última vez — sem tocar sozinho. */
function reabrirTela(e){
  if (e.md) abrirMd(e.md, e.item);
  else if (typeof e.item === 'number') abrir(e.item, false);
  else if (e.disc === 'escritos') abrirMd();
}

// --- já vi este material ----------------------------------------------------
// A chave separa o que é item do banco (i:317) do que é arquivo escrito
// (md:caminho); a tabela progress guarda os dois no mesmo lugar.
const chaveItem = id => 'i:' + id;
const visto = ch => !!prog[ch]?.visto;

/** Clique na caixinha da árvore. */
function marcar(ch, sim){
  enfileirar({t:'progresso', chave: ch, visto: sim});
  pintarArvore();
}
/** Vista até o fim: marca e volta o ponteiro para o começo. */
function concluir(id){
  enfileirar({t:'progresso', chave: chaveItem(id), visto: true, segundos: 0});
}
/** Tudo o que a árvore da disciplina em cartaz mostra, na mesma ordem. */
function chavesDaDisc(){
  const ks = dados.arvore
    .filter(r => r.disc_id === discAtual && r.item_id != null).map(r => chaveItem(r.item_id));
  const tr = disc()?.transcricao;
  return tr ? ['md:' + tr, ...ks] : ks;
}
/** Disciplina inteira num clique — para quem já fechou a matéria. */
function marcarTudo(sim){
  enfileirar({t:'lote', chaves: chavesDaDisc(), visto: sim});
  pintarArvore();
}

// --- anotações --------------------------------------------------------------
// Mesma chave do progresso, então aula em vídeo e material escrito têm o mesmo
// campo. Grava sozinho: quem estuda anota e troca de tela, não aperta "salvar".
let chaveNota = null, temporizadorNota = null;

/**
 * Troca a aula a que a anotação pertence. Grava a anterior ANTES de trocar a
 * chave — senão o texto de uma aula seria gravado na conta da seguinte.
 */
function trocarNota(ch){
  guardarNota(true);
  chaveNota = ch;
  const el = $('#nota');
  if (el) el.value = notas[ch] || '';
  const e = $('#notaest');
  if (e) e.textContent = '';
}

function blocoNota(ch){
  chaveNota = ch;
  return \`<div class="anot">
    <header><h3>Minhas anotações</h3><span class="tag" id="notaest"></span></header>
    <textarea id="nota" rows="4" spellcheck="true"
      placeholder="O que você quer lembrar desta aula…"
      oninput="notaMudou()" onblur="guardarNota(true)">\${esc(notas[ch] || '')}</textarea>
  </div>\`;
}

/** Repõe o texto do servidor — sem atropelar quem está digitando agora. */
function pintarNota(){
  const el = $('#nota');
  if (!el || !chaveNota) return;
  if (document.activeElement === el) return;
  const doServidor = notas[chaveNota] || '';
  if (el.value !== doServidor) el.value = doServidor;
}

function notaMudou(){
  $('#notaest').textContent = 'digitando…';
  clearTimeout(temporizadorNota);
  temporizadorNota = setTimeout(guardarNota, 800);
}

/** Enfileira o texto se ele mudou. 'agora' cancela a espera da digitação. */
function guardarNota(agora){
  if (agora) clearTimeout(temporizadorNota);
  const el = $('#nota');
  if (!el || !chaveNota) return;
  const texto = el.value;
  if (texto === (notas[chaveNota] || '')) { $('#notaest').textContent = ''; return; }
  enfileirar({t:'nota', chave: chaveNota, texto});
  $('#notaest').textContent = 'guardada';
  setTimeout(() => { const e = $('#notaest'); if (e && e.textContent === 'guardada') e.textContent = ''; }, 1500);
}

/** A caixinha, igual para item do banco e para escrito. */
function caixa(ch){
  return \`<input type="checkbox" class="ck" \${visto(ch)?'checked':''}
    title="Já passei por este material"
    onclick="event.stopPropagation();marcar('\${ch.replace(/'/g,"\\\\'")}',this.checked)">\`;
}

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
        <div class="item \${itemAtual==='d'+d0.id?'on':''} \${visto('md:'+d0.transcricao)?'visto':''}"
             onclick="abrirMd('\${d0.transcricao}','d\${d0.id}')">
          \${caixa('md:'+d0.transcricao)}<span class="pt done"></span><span class="n">00.01</span>
          <span class="rotulo">Transcrição da disciplina</span><span class="tag">md</span></div>
       </details>\`
    : '';

  // Marcar a disciplina inteira, para quem já fechou a matéria antes de o
  // painel existir. Meio marcado vira o traço do indeterminate, que só existe
  // por JS — não dá para escrever no HTML.
  const ks = chavesDaDisc(), nv = ks.filter(visto).length;
  const tudo = ks.length
    ? \`<label class="tudo" title="Marca ou desmarca tudo desta disciplina">
         <input type="checkbox" class="ck" id="tudos" \${nv===ks.length?'checked':''}
           onchange="marcarTudo(this.checked)">
         <span class="rotulo">Disciplina inteira</span>
         <span class="tag">✓ \${nv}/\${ks.length}</span></label>\`
    : '';

  $('#arvore').innerHTML = tudo + cap00 + [...mods.values()].sort((a,b)=>a.pos-b.pos).map(m => {
    const ok = m.itens.filter(i=>i.download_status==='done').length;
    const vi = m.itens.filter(i=>visto(chaveItem(i.item_id))).length;
    return \`<details class="mod" open>
      <summary><span>\${dd(m.pos)} — \${esc(m.nome)}</span>
        <span class="tag">✓ \${vi}/\${m.itens.length} · \${ok} no disco</span></summary>
      \${m.itens.map(i => \`<div class="item \${i.item_id===itemAtual?'on':''} \${visto(chaveItem(i.item_id))?'visto':''}"
             onclick="abrir(\${i.item_id})">
          \${caixa(chaveItem(i.item_id))}
          <span class="pt \${i.download_status}"></span>
          <span class="n">\${dd(m.pos)}.\${dd(i.position)}</span>
          <span class="rotulo" title="\${esc(i.title)}">\${esc(i.title)}</span>
          <span class="tag">\${i.kind}</span>
        </div>\`).join('')}
    </details>\`;
  }).join('') || '<div class="vazio" style="padding:30px">Nada catalogado nesta disciplina.</div>';

  const cx = $('#tudos');
  if (cx) cx.indeterminate = nv > 0 && nv < ks.length;
}

function pintarArvoreEscritos(){
  const mats = dados.arvore.filter(r => r.item_id != null && r.kind !== 'video' && r.download_status === 'done');
  const porDisc = new Map();
  for (const r of mats){
    if(!porDisc.has(r.disc_id)) porDisc.set(r.disc_id, {id:r.disc_id, nome:r.disc_nome, pos:r.disc_pos, itens:[]});
    porDisc.get(r.disc_id).itens.push(r);
  }
  $('#arvore').innerHTML =
    \`<div class="item \${itemAtual==='ix'?'on':''} \${visto('md:indice')?'visto':''}" onclick="abrirMd()">
        \${caixa('md:indice')}<span class="pt done"></span>
        <span class="rotulo">Índice dos escritos</span><span class="tag">md</span></div>
     <div class="item \${itemAtual==='tr'?'on':''} \${visto('md:'+TRANSC)?'visto':''}" onclick="abrirMd('\${TRANSC}')">
        \${caixa('md:'+TRANSC)}<span class="pt done"></span>
        <span class="rotulo">Transcrição Geral</span><span class="tag">md</span></div>\`
    + [...porDisc.values()].sort((a,b)=>a.pos-b.pos).map(d =>
      \`<details class="mod" open><summary><span>\${dd(d.pos)} — \${esc(d.nome)}</span>
         <span class="tag">\${d.itens.length}</span></summary>
        \${(dados.disciplinas.find(x=>x.id===d.id)?.transcricao
            ? (tr => \`<div class="item \${itemAtual==='d'+d.id?'on':''} \${visto('md:'+tr)?'visto':''}"
                          onclick="abrirMd('\${tr}','d\${d.id}')">
                 \${caixa('md:'+tr)}<span class="pt done"></span><span class="n">00</span>
                 <span class="rotulo">Transcrição da disciplina</span><span class="tag">md</span></div>\`
              )(dados.disciplinas.find(x=>x.id===d.id).transcricao) : '')}
        \${d.itens.map(i => \`<div class="item \${i.item_id===itemAtual?'on':''} \${visto(chaveItem(i.item_id))?'visto':''}"
              onclick="abrir(\${i.item_id})">
            \${caixa(chaveItem(i.item_id))}
            <span class="pt done"></span><span class="n">\${dd(i.mod_pos)}.\${dd(i.position)}</span>
            <span class="rotulo" title="\${esc(i.mod_nome)}">\${esc(i.mod_nome)}</span>
            <span class="tag">\${i.kind}</span></div>\`).join('')}
      </details>\`).join('');
}

const TRANSC = 'Transcrição.Geral.md';
async function abrirMd(arquivo, marca){
  salvarPos(true);
  itemAtual = marca ?? (arquivo ? 'tr' : 'ix');
  guardarTela(arquivo);
  if (discAtual === 'escritos') pintarArvoreEscritos(); else pintarArvore();
  const cx = $('#conteudo');
  cx.innerHTML = '<div class="vazio">carregando…</div>';
  const r = await fetch('/md' + (arquivo ? '?p='+encodeURIComponent(arquivo) : ''));
  if (!r.ok){ cx.innerHTML = '<div class="vazio">Ainda não gerado. Use <b>Gerar Materiais Escritos</b> nas Ações.</div>'; return; }
  const j = await r.json();
  const alvo = arquivo ?? '00-Materiais.Escritos.md';
  cx.innerHTML = barraArquivo({p: alvo}) + '<div class="md">'+j.html+'</div>'
    + blocoNota('md:' + alvo);
  cx.scrollTop = 0;
  carregarCaminho({p: alvo});
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
function barraArquivo(alvo){
  // alvo é {id} para item do banco ou {p} para material escrito (arquivo solto).
  const q = alvo.id != null ? 'id='+alvo.id : 'p='+encodeURIComponent(alvo.p);
  return \`<div class="arquivo">
      <code id="cam" title="carregando…">carregando caminho…</code>
      <button class="sec mini" onclick="abrirNoSistema('\${q}')">Abrir</button>
      <button class="sec mini" onclick="revelar('\${q}')">Mostrar na pasta</button>
      <button class="sec mini" onclick="copiarCaminho(this)">Copiar caminho</button>
    </div>\`;
}
async function carregarCaminho(alvo){
  const q = alvo.id != null ? 'id='+alvo.id : 'p='+encodeURIComponent(alvo.p);
  const j = await (await fetch('/api/caminho?'+q)).json();
  const el = $('#cam'); if(!el) return;
  el.textContent = j.caminho ?? '(sem arquivo)';
  el.title = j.caminho ?? '';
}
async function revelar(q){
  const r = await (await fetch('/api/revelar?'+q,{method:'POST'})).json();
  if(!r.ok) alert('Não consegui abrir: '+r.msg);
}
async function abrirNoSistema(q){
  const r = await (await fetch('/api/abrir?'+q,{method:'POST'})).json();
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

async function abrir(id, tocar){
  // Antes de trocar: onde o vídeo que sai parou. Depois de trocar o itemAtual a
  // posição cairia na aula errada.
  salvarPos(true);
  itemAtual = id; guardarTela(); pintarArvore();
  $('#arvore .item.on')?.scrollIntoView({block:'nearest'});
  const r = dados.arvore.find(x => x.item_id === id);
  if(!r) return;

  if (r.download_status !== 'done'){
    palco = vid = null;
    $('#conteudo').innerHTML = \`<h2 class="tit">\${esc(r.title)}</h2>
      <div class="meta">status: <b class="\${r.download_status}">\${r.download_status}</b></div>
      \${r.download_error?\`<p class="erro">\${esc(r.download_error)}</p>\`:'<p class="tag">Ainda não capturado.</p>'}\`;
    return;
  }

  if (r.kind !== 'video'){
    palco = vid = null;
    $('#conteudo').innerHTML = \`<h2 class="tit">\${esc(r.title)}</h2>
      <div class="meta"><span>\${esc(r.kind)}</span><span>\${mb(r.bytes)}</span></div>
      \${barraArquivo({id})}
      <iframe class="doc" src="/media/\${id}"></iframe>\`;
    carregarCaminho({id});
    return;
  }

  // Só monta o palco se ainda não houver um na tela. Trocar de aula sem refazer
  // o DOM é o que permite continuar em tela cheia ao pular para a próxima: o
  // elemento em tela cheia é o palco, e ele sobrevive à troca.
  if (!palco || !document.contains(palco)) montarPalco();
  await carregarVideo(r, tocar);
}

/** A moldura fixa da tela de vídeo — montada uma vez, reaproveitada nas trocas. */
function montarPalco(){
  $('#conteudo').innerHTML = \`
    <div class="palco parado" id="palco">
      <video id="v" controls preload="metadata" playsinline></video>
      <div class="legenda" id="legenda"></div>
      <div class="nav">
        <button id="ant" onclick="irVizinho(-1)">‹</button>
        <button id="prox" onclick="irVizinho(1)">›</button>
      </div>
      <div class="hud">
        <button class="chip" id="vel" onclick="ciclarVel()"
          title="Velocidade — fica salva de uma aula para a outra">1×</button>
        <button class="chip" id="auto" onclick="trocarAuto()">Auto ▸</button>
        <button class="chip" id="leg" onclick="ciclarLeg()">Aa</button>
        <span class="chip rot" id="hudtit"></span>
        <button class="chip" id="fs" onclick="telaCheia()" title="Tela cheia (F)">⛶</button>
      </div>
    </div>
    <h2 class="tit" id="tit"></h2>
    <div class="meta" id="met"></div>
    <div id="barra"></div>
    <div class="transc">
      <header><h3>Transcrição</h3>
        <span class="tag" id="dica">clique numa fala para pular o vídeo</span></header>
      <div class="falas" id="falas">carregando…</div>
    </div>
    \${blocoNota(null)}\`;
  palco = $('#palco'); vid = $('#v');

  // Ouvintes registrados uma vez só: o elemento agora atravessa várias aulas,
  // e registrar por aula empilharia uma cópia a cada troca.
  vid.addEventListener('loadedmetadata', () => {
    // 'hidden', e não 'showing': a faixa continua marcando as falas do momento
    // (é o que alimenta pintarLegenda), mas quem desenha é a div .legenda. Em
    // 'showing' o navegador desenharia a dele por cima, em dobro.
    esconderFaixas();
    // Retoma de onde parou. Só depois do metadata, porque antes disso não há
    // duração e o currentTime não gruda. Perto do fim recomeça do zero: quem
    // parou nos créditos não quer voltar para os créditos.
    if (aRetomar > 1 && aRetomar < vid.duration - 15) vid.currentTime = aRetomar;
    aRetomar = 0;
  });
  vid.addEventListener('timeupdate', () => { destacar(); salvarPos(false); });
  vid.addEventListener('play',  () => palco.classList.remove('parado'));
  vid.addEventListener('pause', () => { palco.classList.add('parado'); salvarPos(true); });
  // Velocidade trocada pelo menu nativo do player também é guardada.
  vid.addEventListener('ratechange', () => {
    vid.defaultPlaybackRate = vid.playbackRate;
    localStorage.setItem(CHAVE_VEL, String(vid.playbackRate));
    mostrarVel(vid.playbackRate);
    // Também entra na fila: senão a velocidade trocada pelo menu nativo valeria
    // só neste aparelho, enquanto a trocada pelo chip viajaria para os outros.
    if (vid.playbackRate !== Number(prefs.velocidade))
      enfileirar({t:'pref', nome:'velocidade', valor: String(vid.playbackRate)});
  });
  // Autoplay: emenda na próxima aula quando esta termina. Só o fim natural
  // dispara 'ended' — trocar de aula no meio, não. Em tela cheia continua em
  // tela cheia, porque quem está em tela cheia é o palco, não o vídeo.
  //
  // A marca de "já vi" vai ANTES de pular: assistir até o fim é o que fecha a
  // aula, e depois do pulo o itemAtual já é o da aula seguinte.
  vid.addEventListener('ended', () => {
    concluir(itemAtual);
    if (autoplay()) irVizinho(1); else pintarArvore();
  });
  palco.addEventListener('mousemove', mexeu);
  // O menu nativo do player deixa religar a legenda; se religarem, volta para
  // 'hidden' — desligar de vez ('disabled') continua valendo, porque aí não há
  // fala corrente nenhuma e a div fica vazia.
  vid.textTracks.addEventListener('change', esconderFaixas);
  mostrarAuto(); aplicarLeg();
}

function esconderFaixas(){
  if (!vid) return;
  for (const t of vid.textTracks) if (t.mode === 'showing') t.mode = 'hidden';
  pintarLegenda();
}

/** Troca a aula em cartaz sem tocar na moldura. */
async function carregarVideo(r, tocar){
  const id = r.item_id;
  vid.querySelectorAll('track').forEach(t => t.remove());
  vid.src = '/media/' + id;
  // O <track> só aceita WebVTT; o servidor converte o .srt do acervo na hora.
  // Elemento novo a cada aula: reaproveitar o mesmo deixa as legendas antigas
  // penduradas na faixa.
  const faixa = document.createElement('track');
  Object.assign(faixa, {kind:'subtitles', srclang:'pt', label:'Português',
    src:'/legenda/'+id, default:true});
  vid.appendChild(faixa);
  // 'hidden' já aqui: é o que faz o navegador ir buscar o .vtt sem desenhar
  // nada. 'cuechange' é o que avisa a hora de trocar o texto na div.
  faixa.track.mode = 'hidden';
  faixa.track.addEventListener('cuechange', pintarLegenda);
  $('#legenda').textContent = '';
  aRetomar = prog[chaveItem(id)]?.segundos ?? 0;
  vid.load();
  // Depois do load(): ele redefine playbackRate a partir de defaultPlaybackRate.
  definirVel(velocidade());

  $('#tit').textContent = r.title;
  $('#hudtit').textContent = dd(r.mod_pos)+'.'+dd(r.position)+' — '+r.title;
  $('#met').innerHTML =
    \`<span>\${dd(r.mod_pos)}.\${dd(r.position)}</span><span>\${mb(r.bytes)}</span>\` +
    (r.duration?\`<span>\${relogio(r.duration)}</span>\`:'') +
    \`<span>transcrição: \${r.transcribe_status}</span>\`;
  $('#barra').innerHTML = barraArquivo({id});
  trocarNota(chaveItem(id));
  carregarCaminho({id});
  arrumarSetas(r);
  mexeu();
  if (tocar) vid.play().catch(()=>{});

  falas = []; ultimo = -1;
  const cx = $('#falas');
  cx.innerHTML = 'carregando…';
  const lidas = await (await fetch('/transcricao/'+id)).json();
  if (itemAtual !== id) return;  // trocou de aula enquanto isto vinha
  falas = lidas;
  $('#dica').textContent = falas.length ? 'clique numa fala para pular o vídeo' : '';
  cx.innerHTML = falas.length
    ? falas.map((f,i) =>
        \`<div class="fala" data-i="\${i}" onclick="irPara(\${f.inicio})">
           <time>\${relogio(f.inicio)}</time><span>\${esc(f.texto)}</span></div>\`).join('')
    : '<div class="corrido tag">Sem transcrição para esta aula.</div>';
}

/**
 * Aulas vizinhas: os vídeos já capturados da mesma disciplina, na ordem da
 * árvore (a consulta do servidor já vem ordenada por módulo e posição).
 */
function arrumarSetas(r){
  ordem = dados.arvore.filter(x =>
    x.disc_id === r.disc_id && x.kind === 'video' && x.download_status === 'done');
  const i = ordem.findIndex(x => x.item_id === r.item_id);
  const por = (el, alvo, rot) => {
    el.disabled = !alvo;
    el.title = alvo ? \`\${rot}: \${dd(alvo.mod_pos)}.\${dd(alvo.position)} \${alvo.title}\` : '';
  };
  por($('#ant'), ordem[i-1], 'Anterior (P)');
  por($('#prox'), ordem[i+1], 'Próxima (N)');
}
function irVizinho(passo){
  const i = ordem.findIndex(x => x.item_id === itemAtual);
  const alvo = i < 0 ? null : ordem[i+passo];
  if (alvo) abrir(alvo.item_id, true);
}

// --- onde a aula parou ------------------------------------------------------
// Guardo de tempos em tempos, e não a cada quadro: o 'timeupdate' dispara umas
// quatro vezes por segundo, e gravar tudo isso seria escrever no banco à toa.
let aRetomar = 0, ultimaGravacao = 0;
function salvarPos(agora){
  if (!vid || typeof itemAtual !== 'number') return;
  const t = vid.currentTime;
  if (!isFinite(t) || t < 1) return;
  // No fim quem manda é o 'ended', que zera o ponteiro e marca a aula. Sem esta
  // guarda o último 'timeupdate' (ou o 'pause' de alguns navegadores) chegaria
  // depois e regravaria a posição final por cima do zero.
  if (vid.ended || (isFinite(vid.duration) && t > vid.duration - 1)) return;
  if (!agora && Date.now() - ultimaGravacao < 5000) return;
  ultimaGravacao = Date.now();
  // A posição não precisa de viagem própria: entra na fila como o resto, e sai
  // no mesmo lote da marcação e da anotação.
  enfileirar({t:'progresso', chave: chaveItem(itemAtual), segundos: Number(t.toFixed(1))});
}

// Ao fechar a aba o fetch normal é cortado no meio; o beacon sobrevive. Se ele
// chegar, o lote vai ser reenviado na próxima abertura — e isso não é problema,
// porque toda operação é "deixe assim", nunca "some mais um".
addEventListener('pagehide', () => {
  salvarPos(true);
  guardarNota(true);
  if (fila.length && navigator.sendBeacon)
    navigator.sendBeacon('/api/sync',
      new Blob([JSON.stringify({ops: fila})], {type: 'application/json'}));
});

/** Controles somem sozinhos enquanto o vídeo roda e o mouse está quieto. */
let sumico;
function mexeu(){
  if(!palco) return;
  palco.classList.add('mexeu');
  clearTimeout(sumico);
  sumico = setTimeout(() => { if (vid && !vid.paused) palco.classList.remove('mexeu'); }, 2600);
}

// --- preferências do player -------------------------------------------------
// Velocidade, autoplay e tamanho da legenda seguem a PESSOA, não o aparelho:
// vão para o banco pela fila e voltam nas outras telas. O localStorage continua
// aí como cache — é o que faz a página abrir já no jeito certo, antes mesmo de
// a primeira resposta do servidor chegar.
//
// Quem mexeu por último manda. Para uma pessoa com um tablet e um PC isso é o
// certo quase sempre; e como a aba repuxa ao voltar para o foco, as duas telas
// convergem sem ninguém recarregar nada.

/** Aplica o que veio do servidor, se for diferente do que este aparelho tem. */
function aplicarPrefs(){
  if (prefs.velocidade != null && Number(prefs.velocidade) !== velocidade())
    definirVel(Number(prefs.velocidade), true);
  if (prefs.autoplay != null && (prefs.autoplay === '1') !== autoplay()){
    localStorage.setItem(CHAVE_AUTO, prefs.autoplay === '1' ? '1' : '0');
    mostrarAuto();
  }
  if (prefs.legenda != null && Number(prefs.legenda) !== tamLegenda()){
    localStorage.setItem(CHAVE_LEG, String(Number(prefs.legenda)));
    aplicarLeg();
  }
}

// --- velocidade -------------------------------------------------------------
const CHAVE_VEL = 'focus.velocidade';
const VELS = [0.75, 1, 1.25, 1.5, 1.75, 2];
function velocidade(){ const v = Number(localStorage.getItem(CHAVE_VEL)); return v > 0 ? v : 1; }
function mostrarVel(v){ const c = $('#vel'); if(c) c.textContent = v + '×'; }
/** 'deOutroAparelho' evita devolver para a fila o que acabou de chegar dela. */
function definirVel(v, deOutroAparelho){
  localStorage.setItem(CHAVE_VEL, String(v));
  if (vid){ vid.defaultPlaybackRate = v; vid.playbackRate = v; }
  mostrarVel(v);
  if (!deOutroAparelho && v !== Number(prefs.velocidade))
    enfileirar({t:'pref', nome:'velocidade', valor: String(v)});
}
function ciclarVel(){
  const i = VELS.indexOf(vid ? vid.playbackRate : velocidade());
  definirVel(VELS[(i+1) % VELS.length]);
}

// --- autoplay ---------------------------------------------------------------
// Mesma ideia da velocidade: preferência de quem assiste, guardada no navegador.
const CHAVE_AUTO = 'focus.autoplay';
function autoplay(){ return localStorage.getItem(CHAVE_AUTO) === '1'; }
function mostrarAuto(){
  const c = $('#auto'); if(!c) return;
  const on = autoplay();
  c.classList.toggle('on', on);
  c.textContent = on ? 'Auto ▶' : 'Auto';
  c.title = on
    ? 'Autoplay ligado: ao terminar, emenda na próxima aula'
    : 'Autoplay desligado: para no fim da aula';
}
function trocarAuto(){
  const ligado = !autoplay();
  localStorage.setItem(CHAVE_AUTO, ligado ? '1' : '0');
  mostrarAuto();
  enfileirar({t:'pref', nome:'autoplay', valor: ligado ? '1' : '0'});
}

// --- tamanho da legenda -----------------------------------------------------
// Em px, e não em porcentagem, justamente para NÃO acompanhar o tamanho do
// vídeo — ver o comentário do video::cue lá no CSS.
const CHAVE_LEG = 'focus.legenda';
const LEGS = [15, 18, 22, 27];
function tamLegenda(){ const v = Number(localStorage.getItem(CHAVE_LEG)); return LEGS.includes(v) ? v : 18; }
function aplicarLeg(){
  const v = tamLegenda();
  // Na raiz, e não no palco: a propriedade herda, e continua valendo quando o
  // palco vai para tela cheia.
  document.documentElement.style.setProperty('--tamleg', v + 'px');
  const c = $('#leg');
  if (c){ c.textContent = 'Aa ' + v; c.title = 'Tamanho da legenda (' + v + 'px) — igual em tela cheia'; }
}

/** Põe na div a fala do momento, dentro de uma <span> para o fundo colar no texto. */
function pintarLegenda(){
  const el = $('#legenda');
  if (!el || !vid) return;
  const textos = [];
  for (const t of vid.textTracks)
    if (t.mode !== 'disabled') for (const c of t.activeCues ?? []) textos.push(c.text);
  const linhas = textos.join('\\n').split('\\n').map(l => l.trim()).filter(Boolean);
  el.innerHTML = linhas.length ? '<span>' + linhas.map(esc).join('<br>') + '</span>' : '';
}

function ciclarLeg(){
  const v = LEGS[(LEGS.indexOf(tamLegenda()) + 1) % LEGS.length];
  localStorage.setItem(CHAVE_LEG, String(v));
  aplicarLeg();
  enfileirar({t:'pref', nome:'legenda', valor: String(v)});
}
aplicarLeg();

// --- tela cheia -------------------------------------------------------------
function telaCheia(){
  if (document.fullscreenElement) document.exitFullscreen();
  else palco?.requestFullscreen?.();
}
// Reserva: se algo puser o VÍDEO em tela cheia (menu de contexto, ou navegador
// que ignora o seletor que esconde o botão nativo), troca pelo palco — senão as
// setas ficam de fora e a navegação em tela cheia não existe.
document.addEventListener('fullscreenchange', () => {
  if (vid && palco && document.fullscreenElement === vid)
    document.exitFullscreen().then(() => palco.requestFullscreen?.()).catch(()=>{});
});
document.addEventListener('keydown', e => {
  if (!vid || !document.contains(vid)) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'n' || k === 'p'){ e.preventDefault(); irVizinho(k === 'n' ? 1 : -1); }
  else if (k === 'f'){ e.preventDefault(); telaCheia(); }
});

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
  if (!el) return;
  el.classList.add('on');
  // scrollIntoView rolaria TODOS os ancestrais roláveis — inclusive o #conteudo,
  // que arrasta a página para baixo e tira o vídeo da tela a cada fala nova.
  // Aqui rola só a caixa da transcrição, levando a fala corrente para o topo.
  cx.scrollTo({
    top: cx.scrollTop + el.getBoundingClientRect().top - cx.getBoundingClientRect().top - 6,
    behavior: 'smooth',
  });
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
    + (dados.sistema?.length
        ? \`<div class="tag" style="margin-top:12px">Comandos no sistema</div>
           <pre class="saida">\${dados.sistema.map(c =>
             esc(\`\${c.cmd}\n  código=\${c.codigo}\${c.erro?' erro='+c.erro:''}\${c.saida?' saída='+c.saida:''}\`)).join('\\n')}</pre>\` : '')
    + pintarSync()
    + \`<ul class="ev">\${dados.eventos.slice(0,14).map(e =>
      \`<li><span class="tag">\${e.at}</span> <b class="\${e.level==='error'?'erro':''}">\${esc(e.source)}</b> \${esc(e.message)}</li>\`).join('')}</ul>\`;
}

/**
 * Cópia do focus.db dentro do acervo — sobrevive mesmo se BASE_DIR se perder.
 * Sincronizada sozinha (a cada tarefa e periodicamente), mas o botão força na
 * hora quando o usuário quiser ter certeza antes de desligar a máquina.
 */
function pintarSync(){
  const s = dados.sync;
  if (!s) return '';
  return \`<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="tag">Cópia do banco no acervo</span>
      <code style="font-size:11.5px;color:var(--fraco)">\${esc(s.caminho)}</code>
      <span class="tag">\${s.existe ? mb(s.bytes)+' · sincronizada '+haTempo(s.desdeMs) : 'ainda não sincronizada'}</span>
      <button class="sec mini" onclick="sincronizar(this)">Sincronizar agora</button>
    </div>\`;
}
async function sincronizar(botao){
  const o = botao.textContent; botao.textContent = 'sincronizando…'; botao.disabled = true;
  const r = await (await fetch('/api/sincronizar',{method:'POST'})).json();
  botao.textContent = o; botao.disabled = false;
  if(!r.ok) alert('Falha ao sincronizar a cópia: '+r.erro);
  carregar();
}
async function rodar(nome){
  const r = await (await fetch('/api/run?tarefa='+nome,{method:'POST'})).json();
  if(!r.ok) alert(r.msg);
  carregar();
}

// A fila sobrevive ao fechar a aba: o que não foi confirmado está no
// localStorage e sai assim que houver rede.
fila = lerFila();
carregar().then(() => sincronizarFila());

// Atualiza sozinho, mas sem estragar a leitura: só quando há tarefa rodando.
setInterval(() => { if (dados?.tarefas.some(t=>t.rodando)) carregar(); }, 8000);

// --- convergência entre aparelhos -------------------------------------------
// Voltar para a aba é o momento exato em que se quer ver o que o outro aparelho
// fez: você marcou no tablet, pegou o PC, e a árvore já está certa. O laço de
// 30s cobre a aba que fica aberta parada, e o 'online' cobre a rede voltando.
addEventListener('visibilitychange', () => { if (!document.hidden) sincronizarFila(true); });
addEventListener('focus', () => sincronizarFila(true));
addEventListener('online', () => sincronizarFila(true));
setInterval(() => { if (!document.hidden) sincronizarFila(true); }, 30000);
</script>`;
