/* =========================================================
   KAFE · Painel administrativo
   Depende de: supabase-js, config.js (SUPABASE_URL / SUPABASE_KEY)
   ========================================================= */
(() => {
'use strict';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BRL = n => Number(n || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const ico = (n, c = '') => `<svg class="i ${c}"><use href="#i-${n}"/></svg>`;
const p2 = n => String(n).padStart(2, '0');
const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const PAID = ['pago','enviado','entregue'];
const STLBL = {novo:'Novo', pago:'Pago', enviado:'Enviado', entregue:'Entregue', cancelado:'Cancelado'};
const FLOW = ['novo','pago','enviado','entregue'];

/* ---------- datas ---------- */
const isoOf = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const today = () => isoOf(new Date());
const fmtD = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '';
const fmtDT = ts => { const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' · ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); };
const mkey = iso => iso.slice(0,7);
const addM = (key, n) => { const [y,m] = key.split('-').map(Number); const d = new Date(y, m-1+n, 1); return `${d.getFullYear()}-${p2(d.getMonth()+1)}`; };
const mlabel = key => `${MES[+key.slice(5,7)-1]}/${key.slice(2,4)}`;
const ago = ts => { const s = (Date.now() - new Date(ts)) / 1000; if (s < 3600) return `há ${Math.max(1, Math.round(s/60))} min`; if (s < 86400) return `há ${Math.round(s/3600)} h`; if (s < 86400*30) return `há ${Math.round(s/86400)} d`; return fmtD(isoOf(new Date(ts))); };

/* ---------- estado ---------- */
const S = { user:null, products:[], orders:[], tx:[], loaded:false, route:'dashboard',
  f:{ prod:{q:'', cat:'', st:'all'}, ord:{q:'', st:'all'}, cli:{q:''}, stk:{q:''}, fin:{per:'month', from:'', to:'', type:'all', q:'', cat:''} } };

/* ---------- utilidades ---------- */
const sizeCmp = (a, b) => {
  const O = ['PP','P','M','G','GG','XG','XGG','Único'], na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  const ia = O.indexOf(a), ib = O.indexOf(b);
  if (ia > -1 && ib > -1) return ia - ib;
  if (!isNaN(na)) return -1; if (!isNaN(nb)) return 1;
  return String(a).localeCompare(String(b), 'pt-BR');
};
const stockOf = p => (p.variants || []).reduce((a, v) => a + (v.stock || 0), 0);
const short = id => String(id).slice(0, 6);
const digits = s => String(s || '').replace(/\D/g, '');
const waLink = (phone, text) => { let d = digits(phone); if (d && !(d.startsWith('55') && d.length >= 12)) d = '55' + d; return `https://wa.me/${d}` + (text ? `?text=${encodeURIComponent(text)}` : ''); };
const prodById = id => S.products.find(p => p.id === id);
const thumb = (url, c = '') => url ? `<img class="thumb ${c}" src="${esc(url)}" alt="" loading="lazy">` : `<div class="thumb ${c} ph">${ico('image')}</div>`;
const badge = s => `<span class="badge b-${s}">${STLBL[s] || esc(s)}</span>`;
const compact = v => { v = Math.abs(v); if (v >= 1e6) return (v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' mi'; if (v >= 1e3) return (v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' mil'; return v.toLocaleString('pt-BR',{maximumFractionDigits:0}); };
const niceMax = v => { if (v <= 0) return 100; const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const cats = () => [...new Set(['Sandálias','Roupas', ...S.products.map(p => p.category).filter(Boolean)])];
const txCats = () => [...new Set(['Mercadoria','Frete','Embalagem','Anúncios','Taxas','Aluguel','Outros','Vendas', ...S.tx.map(t => t.category).filter(Boolean)])];

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = ico(type === 'ok' ? 'check' : 'alert') + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = 0; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, type === 'ok' ? 2800 : 6000);
}
function fail(e) {
  console.error(e);
  let m = e?.message || 'Algo deu errado.';
  if (e?.code === '23503') m = 'Não foi possível excluir: há registros ligados. Rode o arquivo atualizar-admin.sql no Supabase e tente de novo.';
  else if (e?.code === '42883' || e?.code === 'PGRST202') m = 'Falta atualizar o banco: rode o arquivo atualizar-admin.sql no Supabase (SQL Editor).';
  else if (e?.code === '42501') m = 'Sem permissão para esta ação.';
  else if (/column .* does not exist|Could not find the .* column/i.test(m)) m = 'Falta atualizar o banco: rode o arquivo atualizar-admin.sql no Supabase.';
  toast(m, 'err');
}
const ok = async p => { const r = await p; if (r.error) throw r.error; return r.data; };
async function fetchAll(make) {
  let out = [], from = 0; const step = 1000;
  for (;;) { const { data, error } = await make(from, from + step - 1); if (error) throw error; out = out.concat(data || []); if (!data || data.length < step) break; from += step; }
  return out;
}
const busy = (btn, on, txt) => { if (!btn) return; if (on) { btn.dataset.t = btn.innerHTML; btn.disabled = true; btn.innerHTML = txt || 'Salvando…'; } else { btn.disabled = false; btn.innerHTML = btn.dataset.t || btn.innerHTML; } };

/* ---------- dados ---------- */
async function loadAll() {
  const [products, orders, tx] = await Promise.all([
    fetchAll((a, b) => sb.from('products').select('*,variants(id,size,stock)').order('created_at', {ascending:false}).range(a, b)),
    fetchAll((a, b) => sb.from('orders').select('*,order_items(*)').order('created_at', {ascending:false}).range(a, b)),
    fetchAll((a, b) => sb.from('transactions').select('*').order('date', {ascending:false}).range(a, b)),
  ]);
  products.forEach(p => p.variants = (p.variants || []).sort((x, y) => sizeCmp(x.size, y.size)));
  S.products = products; S.orders = orders; S.tx = tx; S.loaded = true;
  updateNav();
}
async function reload() { try { await loadAll(); } catch (e) { fail(e); } }

/* ---------- camadas: drawer / modal ---------- */
const drawerOpen = () => $('#drawer').classList.contains('show');
function openDrawer({ title, body, footer = '' }) {
  $('#drawer').innerHTML = `<div class="dr-h"><h2>${title}</h2><button class="ibtn" data-act="closeDrawer" aria-label="Fechar">${ico('x')}</button></div><div class="dr-b" id="drb">${body}</div>${footer ? `<div class="dr-f">${footer}</div>` : ''}`;
  $('#ov').classList.add('show'); $('#drawer').classList.add('show'); $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() { $('#ov').classList.remove('show'); $('#drawer').classList.remove('show'); $('#drawer').setAttribute('aria-hidden', 'true'); ED = null; }

let modalResolve = null;
function confirmBox({ title, text, ok: okTxt = 'Confirmar', danger = true, checks = [], icon = 'trash' }) {
  return new Promise(res => {
    modalResolve = res;
    $('#modal').innerHTML = `<div class="ic ${danger ? '' : 'pri'}">${ico(icon, 'lg')}</div><h3>${esc(title)}</h3><p>${text}</p>
      ${checks.length ? `<div class="chks">${checks.map(c => `<label class="chk"><input type="checkbox" id="mc-${c.id}" ${c.checked ? 'checked' : ''} ${c.disabled ? 'disabled' : ''}> ${esc(c.label)}</label>`).join('')}</div>` : ''}
      <div class="btns"><button class="btn out" data-act="modalNo">Cancelar</button><button class="btn ${danger ? 'danger' : 'pri'}" data-act="modalYes">${esc(okTxt)}</button></div>`;
    $('#ov2').classList.add('show'); $('#modal').classList.add('show');
    const f = $('#modal [data-act=modalYes]'); f && f.focus();
    modalChecks = checks;
  });
}
let modalChecks = [];
function closeModal(result) {
  $('#ov2').classList.remove('show'); $('#modal').classList.remove('show');
  const r = modalResolve; modalResolve = null;
  if (r) r(result);
}

/* =========================================================
   ROTAS
   ========================================================= */
const R = {
  dashboard: { t:'Resumo', icon:'dash', render: vDash,
    sub: () => new Date().toLocaleDateString('pt-BR', {weekday:'long', day:'numeric', month:'long'}) },
  pedidos: { t:'Pedidos', icon:'orders', render: vOrd,
    sub: () => `${S.orders.length} pedidos · ${S.orders.filter(o => o.status === 'novo').length} aguardando pagamento` },
  produtos: { t:'Produtos', icon:'tag', render: vProd,
    sub: () => `${S.products.length} produtos · ${S.products.filter(p => !p.active).length} ocultos`,
    acts: () => `<button class="btn pri" data-act="newProduct">${ico('plus','sm')} Novo produto</button>` },
  estoque: { t:'Estoque', icon:'box', render: vStk,
    sub: () => 'Ajuste as quantidades direto na tabela',
    acts: () => `<button class="btn pri" data-act="openStockIn">${ico('plus','sm')} Entrada de mercadoria</button>` },
  financeiro: { t:'Financeiro', icon:'wallet', render: vFin,
    sub: () => 'Entradas, saídas e resultado da loja',
    acts: () => `<button class="btn out" data-act="exportCsv">${ico('down','sm')} Exportar CSV</button><button class="btn pri" data-act="newTx">${ico('plus','sm')} Novo lançamento</button>` },
  clientes: { t:'Clientes', icon:'users', render: vCli, sub: () => 'Quem comprou, quanto e quando' },
};
const ORDER = ['dashboard','pedidos','produtos','estoque','financeiro','clientes'];

function buildNav() {
  $('#nav').innerHTML = ORDER.map(k => `<a href="#/${k}" data-r="${k}">${ico(R[k].icon)}<span>${R[k].t}</span>${k === 'pedidos' ? '<span class="badge-n" id="nbadge" hidden></span>' : ''}</a>`).join('');
  const tab = ['dashboard','pedidos','produtos','estoque','financeiro','clientes'];
  $('#tabbar').innerHTML = tab.map(k => `<a href="#/${k}" data-r="${k}">${ico(R[k].icon)}<span>${R[k].t === 'Financeiro' ? 'Caixa' : R[k].t}</span></a>`).join('');
  $('#tabbar').hidden = false;
}
function updateNav() {
  const n = S.orders.filter(o => o.status === 'novo' || o.status === 'pago').length;
  const b = $('#nbadge'); if (b) { b.textContent = n; b.hidden = !n; }
}
function route() {
  const key = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const r = R[key] ? key : 'dashboard';
  S.route = r; closeDrawer();
  $('#ttl').textContent = R[r].t; $('#sub').textContent = R[r].sub(); $('#acts').innerHTML = R[r].acts ? R[r].acts() : '';
  $$('[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r));
  document.title = `${R[r].t} · Kafe`;
  R[r].render(); window.scrollTo(0, 0);
}
function repaint() { // atualiza a tela atual sem perder o scroll
  const y = window.scrollY; $('#sub').textContent = R[S.route].sub(); R[S.route].render(); window.scrollTo(0, y);
}
const empty = (icn, t, s) => `<div class="empty">${ico(icn)}<b>${t}</b>${s || ''}</div>`;

/* =========================================================
   RESUMO
   ========================================================= */
function barChart(labels, A, B) {
  const W = 640, H = 230, pl = 54, pr = 8, pt = 12, pb = 28, max = niceMax(Math.max(1, ...A, ...B));
  const iw = W - pl - pr, ih = H - pt - pb, n = labels.length, gw = iw / n, bw = Math.min(24, gw * .3);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = pt + ih - ih * i / 4; g += `<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="#f0e6e8"/><text x="${pl-8}" y="${y+4}" text-anchor="end">${compact(max*i/4)}</text>`; }
  labels.forEach((lb, i) => {
    const cx = pl + gw*i + gw/2, ha = ih*A[i]/max, hb = ih*B[i]/max;
    g += `<rect x="${cx-bw-2}" y="${pt+ih-ha}" width="${bw}" height="${ha}" rx="4" fill="#b8546e"><title>${lb} · Entradas ${BRL(A[i])}</title></rect>`;
    g += `<rect x="${cx+2}" y="${pt+ih-hb}" width="${bw}" height="${hb}" rx="4" fill="#d9bfa6"><title>${lb} · Saídas ${BRL(B[i])}</title></rect>`;
    g += `<text x="${cx}" y="${H-8}" text-anchor="middle">${lb}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de entradas e saídas">${g}</svg>`;
}
const sumTx = (type, pred) => S.tx.filter(t => t.type === type && pred(t)).reduce((a, t) => a + +t.amount, 0);
function delta(cur, prev, inverse = false) {
  if (!prev) return cur ? `<span class="delta z">novo</span>` : '';
  const p = (cur - prev) / prev * 100, good = inverse ? p <= 0 : p >= 0;
  return `<span class="delta ${Math.abs(p) < .5 ? 'z' : good ? 'up' : 'dn'}">${ico(p >= 0 ? 'up' : 'dn', 'sm')}${Math.abs(p).toFixed(0)}%</span>`;
}
function vDash() {
  const now = mkey(today()), prev = addM(now, -1);
  const ent = sumTx('entrada', t => mkey(t.date) === now), entP = sumTx('entrada', t => mkey(t.date) === prev);
  const sai = sumTx('saida', t => mkey(t.date) === now), saiP = sumTx('saida', t => mkey(t.date) === prev);
  const res = ent - sai, resP = entP - saiP;
  const pedMes = S.orders.filter(o => PAID.includes(o.status) && mkey(isoOf(new Date(o.created_at))) === now);
  const ticket = pedMes.length ? pedMes.reduce((a, o) => a + +o.total, 0) / pedMes.length : 0;
  const novos = S.orders.filter(o => o.status === 'novo').length, enviar = S.orders.filter(o => o.status === 'pago').length;
  const low = []; S.products.filter(p => p.active).forEach(p => p.variants.forEach(v => { if (v.stock <= 1) low.push({p, v}); }));
  low.sort((a, b) => a.v.stock - b.v.stock);
  const months = [...Array(6)].map((_, i) => addM(now, i - 5));
  const A = months.map(m => sumTx('entrada', t => mkey(t.date) === m)), B = months.map(m => sumTx('saida', t => mkey(t.date) === m));
  const sold = {};
  S.orders.filter(o => o.status !== 'cancelado').forEach(o => o.order_items.forEach(i => { const k = i.product_id || i.name; (sold[k] = sold[k] || {name:i.name, pid:i.product_id, q:0, v:0}); sold[k].q += i.qty; sold[k].v += i.qty * i.price; }));
  const top = Object.values(sold).sort((a, b) => b.q - a.q).slice(0, 5), topMax = Math.max(1, ...top.map(t => t.q));
  const rec = S.orders.slice(0, 6);

  $('#view').innerHTML = `
  <div class="kpis">
    <div class="kpi"><span class="l"><i class="ok">${ico('cash','sm')}</i>Entradas do mês</span><b class="pos">${BRL(ent)}</b><em>${delta(ent, entP)}vs. mês anterior</em></div>
    <div class="kpi"><span class="l"><i class="er">${ico('wallet','sm')}</i>Saídas do mês</span><b class="neg">${BRL(sai)}</b><em>${delta(sai, saiP, true)}vs. mês anterior</em></div>
    <div class="kpi"><span class="l"><i>${ico('dash','sm')}</i>Resultado do mês</span><b class="${res < 0 ? 'neg' : ''}">${BRL(res)}</b><em>${delta(res, resP)}vs. mês anterior</em></div>
    <div class="kpi"><span class="l"><i class="g">${ico('bag','sm')}</i>Ticket médio</span><b>${BRL(ticket)}</b><em>${pedMes.length} pedido(s) pago(s) no mês</em></div>
    <div class="kpi"><span class="l"><i class="in">${ico('clock','sm')}</i>Pedidos em aberto</span><b>${novos + enviar}</b><em>${novos} aguardando pagamento · ${enviar} para enviar</em></div>
    <div class="kpi"><span class="l"><i class="er">${ico('alert','sm')}</i>Estoque baixo</span><b>${low.length}</b><em>${low.filter(x => x.v.stock === 0).length} tamanho(s) zerado(s)</em></div>
  </div>
  <div class="cols">
    <div class="card pad"><h3>Entradas × Saídas <span class="legend"><span><i style="background:#b8546e"></i>Entradas</span><span><i style="background:#d9bfa6"></i>Saídas</span></span></h3>${barChart(months.map(mlabel), A, B)}</div>
    <div class="card"><h3 style="padding:1.2rem 1.3rem .6rem">Mais vendidos <small>por quantidade</small></h3>
      ${top.length ? top.map((t, i) => `<div class="rank"><span class="n">${i+1}</span><div><div class="t1">${esc(t.name)}</div><div class="hbar"><i style="width:${t.q/topMax*100}%"></i></div></div><div class="rt"><b>${t.q}</b> <span class="mut">un.</span></div></div>`).join('') : empty('bag', 'Sem vendas ainda')}</div>
  </div>
  <div class="cols eq">
    <div class="card"><h3 style="padding:1.2rem 1.3rem .6rem">Pedidos recentes <a href="#/pedidos" style="font:500 .78rem var(--ui)">ver todos</a></h3>
      <div class="mini">${rec.map(o => `<div class="tr click" data-act="openOrder" data-id="${o.id}"><div><div class="t1">${esc(o.customer_name)} <span class="mut" style="font-weight:400">#${short(o.id)}</span></div><div class="t2">${ago(o.created_at)} · ${o.order_items.reduce((a, i) => a + i.qty, 0)} item(ns)</div></div><div class="rt"><div class="t1 num">${BRL(o.total)}</div>${badge(o.status)}</div></div>`).join('') || empty('orders', 'Nenhum pedido ainda', 'Quando um cliente comprar, ele aparece aqui.')}</div></div>
    <div class="card"><h3 style="padding:1.2rem 1.3rem .6rem">Estoque crítico <a href="#/estoque" style="font:500 .78rem var(--ui)">abrir estoque</a></h3>
      <div class="mini">${low.slice(0, 7).map(x => `<div class="tr click" data-act="openProduct" data-id="${x.p.id}"><div class="pcell">${thumb(x.p.image_url, 'sm')}<div><div class="t1">${esc(x.p.name)}</div><div class="t2">Tamanho ${esc(x.v.size)}</div></div></div><div class="rt"><span class="badge ${x.v.stock === 0 ? 'b-zero' : 'b-low'}">${x.v.stock === 0 ? 'Zerado' : '1 un.'}</span></div></div>`).join('') || empty('box', 'Estoque em dia', 'Nenhum tamanho zerado ou no limite.')}</div></div>
  </div>`;
}

/* =========================================================
   PRODUTOS
   ========================================================= */
function vProd() {
  const f = S.f.prod;
  $('#view').innerHTML = `
  <div class="bar">
    <div class="inp-ico grow"><svg class="i sm"><use href="#i-search"/></svg><input class="inp" placeholder="Buscar produto…" value="${esc(f.q)}" data-inp="prod.q"></div>
    <select class="inp" style="width:auto" data-inp="prod.cat"><option value="">Todas as categorias</option>${cats().map(c => `<option ${c === f.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <div class="seg" id="pseg"></div>
  </div>
  <div class="card tbl"><div class="th cols-prod"><span>Produto</span><span class="hide-m">Preço</span><span class="hide-m">Custo</span><span class="hide-m">Margem</span><span>Estoque</span><span class="hide-m ct">Na loja</span><span></span></div><div id="plist"></div></div>`;
  paintProd();
}
function paintProd() {
  const f = S.f.prod, q = f.q.toLowerCase();
  const all = S.products;
  const L = all.filter(p => (!q || (p.name + ' ' + (p.category || '')).toLowerCase().includes(q)) && (!f.cat || p.category === f.cat) &&
    (f.st === 'all' || (f.st === 'on' && p.active) || (f.st === 'off' && !p.active) || (f.st === 'out' && stockOf(p) === 0)));
  const cnt = { all: all.length, on: all.filter(p => p.active).length, off: all.filter(p => !p.active).length, out: all.filter(p => stockOf(p) === 0).length };
  $('#pseg').innerHTML = [['all','Todos'],['on','Na loja'],['off','Ocultos'],['out','Esgotados']].map(([k, l]) => `<button class="${f.st === k ? 'on' : ''}" data-act="pst" data-v="${k}">${l}<em>${cnt[k]}</em></button>`).join('');
  $('#plist').innerHTML = L.map(p => {
    const st = stockOf(p), m = p.price > 0 && p.cost > 0 ? (p.price - p.cost) / p.price * 100 : null;
    const bd = st === 0 ? '<span class="badge b-zero">Esgotado</span>' : st <= 3 ? '<span class="badge b-low">Baixo</span>' : '';
    const det = p.variants.filter(v => v.stock > 0).map(v => `${v.size}: ${v.stock}`).join(' · ');
    return `<div class="tr cols-prod click" data-act="openProduct" data-id="${p.id}">
      <div class="pcell">${thumb(p.image_url)}<div><div class="t1">${esc(p.name)}</div><div class="t2">${esc(p.category || 'Sem categoria')}${p.active ? '' : ' · oculto'}</div></div></div>
      <div class="num">${BRL(p.price)}</div>
      <div class="num mut hide-m">${p.cost > 0 ? BRL(p.cost) : '—'}</div>
      <div class="num hide-m ${m !== null && m < 30 ? 'neg' : ''}">${m !== null ? m.toFixed(0) + '%' : '—'}</div>
      <div title="${esc(det)}"><span class="num"><b>${st}</b> un.</span> ${bd}</div>
      <div class="ct hide-m"><label class="switch" data-act="noop"><input type="checkbox" ${p.active ? 'checked' : ''} data-chg="toggleActive" data-id="${p.id}"><span></span></label></div>
      <div class="rt hide-m"><button class="ibtn" data-act="dupProduct" data-id="${p.id}" title="Duplicar">${ico('copy','sm')}</button><button class="ibtn del" data-act="delProduct" data-id="${p.id}" title="Excluir">${ico('trash','sm')}</button></div>
    </div>`;
  }).join('') || empty('tag', all.length ? 'Nada encontrado' : 'Nenhum produto ainda', all.length ? 'Tente outra busca ou filtro.' : 'Clique em “Novo produto” para cadastrar o primeiro.');
}

/* ---- editor de produto ---- */
let ED = null;
const PRESETS = { 'Calçado 33–40':['33','34','35','36','37','38','39','40'], 'Calçado 33–44':['33','34','35','36','37','38','39','40','41','42','43','44'], 'Roupa PP–GG':['PP','P','M','G','GG'],'Roupa P–XG':['P','M','G','GG','XG'], 'Tamanho único':['Único'] };
function openProduct(id) {
  const p = id ? prodById(id) : null;
  ED = { id: p?.id || null, image: p?.image_url || null, blob: null, sizes: {}, existing: p ? p.variants.map(v => ({id:v.id, size:v.size})) : [] };
  if (p) p.variants.forEach(v => ED.sizes[v.size] = v.stock); else PRESETS['Calçado 33–40'].forEach(s => ED.sizes[s] = 0);
  const x = p || { active: true, category: 'Sandálias' };
  openDrawer({
    title: p ? 'Editar produto' : 'Novo produto',
    body: `
    <div class="sec">Foto</div>
    <div class="drop" id="drop" data-act="pickImg"></div><input type="file" id="pf" accept="image/*" hidden>
    <div class="sec">Informações</div>
    <div class="field"><label>Nome</label><input class="inp" id="pn" value="${esc(x.name)}" placeholder="Ex.: Sandália Rasteira Dourada"></div>
    <div class="field"><label>Descrição</label><textarea class="inp" id="pd" rows="3" placeholder="Material, caimento, detalhes…">${esc(x.description)}</textarea></div>
    <div class="g2"><div class="field"><label>Categoria</label><input class="inp" id="pc" list="catl" value="${esc(x.category)}"><datalist id="catl">${cats().map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Visível na loja</label><label class="chk" style="padding:.62rem 0"><span class="switch"><input type="checkbox" id="pa" ${x.active ? 'checked' : ''}><span></span></span><span id="patxt">${x.active ? 'Sim' : 'Não'}</span></label></div></div>
    <div class="sec">Preço</div>
    <div class="g2"><div class="field"><label>Preço de venda</label><div class="inp-wrap"><span class="pre">R$</span><input class="inp" id="pp" type="number" step="0.01" min="0" inputmode="decimal" value="${x.price ?? ''}" data-inp="mgn"></div></div>
      <div class="field"><label>Custo (quanto você pagou)</label><div class="inp-wrap"><span class="pre">R$</span><input class="inp" id="pk" type="number" step="0.01" min="0" inputmode="decimal" value="${x.cost || ''}" data-inp="mgn"></div></div></div>
    <div class="margin" id="mgn"></div>
    <div class="sec">Tamanhos e estoque</div>
    <div class="presets">${Object.keys(PRESETS).map(k => `<button class="chip" data-act="preset" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
    <div class="sizes" id="szGrid"></div>
    <div class="addsz"><input class="inp" id="nsz" placeholder="Outro tamanho"><button class="btn out sm" data-act="addSize">${ico('plus','sm')} Adicionar</button></div>`,
    footer: `${p ? `<button class="btn danger-o" data-act="delProduct" data-id="${p.id}">${ico('trash','sm')} Excluir</button>` : ''}<span class="sp"></span><button class="btn out" data-act="closeDrawer">Cancelar</button><button class="btn pri" data-act="saveProduct">Salvar</button>`
  });
  paintDrop(); paintSizes(); calcMargin();
  const drop = $('#drop'), pf = $('#pf');
  pf.onchange = () => pf.files[0] && setImage(pf.files[0]);
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) setImage(f); });
  $('#pa').onchange = e => $('#patxt').textContent = e.target.checked ? 'Sim' : 'Não';
  $('#nsz').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); A.addSize(); } };
}
function paintDrop() {
  const src = ED.blob ? ED.blobUrl : ED.image;
  $('#drop').innerHTML = src ? `<img src="${esc(src)}" alt=""><span class="chg">Trocar foto</span>` : `<div>${ico('image','lg')}<div style="margin-top:.4rem;font-weight:500;color:var(--ink-2)">Clique ou arraste a foto aqui</div><small>JPG ou PNG · reduzimos automaticamente</small></div>`;
}
async function setImage(file) {
  try { const b = await resizeImage(file); ED.blob = b; ED.blobUrl = URL.createObjectURL(b); } catch { ED.blob = file; ED.blobUrl = URL.createObjectURL(file); }
  paintDrop();
}
function resizeImage(file, max = 1400) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); b ? res(b) : rej(); }, 'image/jpeg', .86);
    };
    img.onerror = rej; img.src = url;
  });
}
function paintSizes() {
  const ks = Object.keys(ED.sizes).sort(sizeCmp);
  $('#szGrid').innerHTML = ks.map(s => `<div class="sz"><b>${esc(s)}<button data-act="szdel" data-s="${esc(s)}" title="Remover tamanho">×</button></b><div class="step"><button data-act="szinc" data-s="${esc(s)}" data-d="-1">−</button><input type="number" min="0" value="${ED.sizes[s]}" data-inp="szin" data-s="${esc(s)}"><button data-act="szinc" data-s="${esc(s)}" data-d="1">+</button></div></div>`).join('') || '<p class="mut" style="grid-column:1/-1">Nenhum tamanho. Use os atalhos acima.</p>';
}
function calcMargin() {
  const el = $('#mgn'); if (!el) return;
  const pr = +$('#pp').value || 0, ck = +$('#pk').value || 0;
  el.innerHTML = pr > 0 && ck > 0 ? `<span>Lucro por peça <b>${BRL(pr - ck)}</b></span><span>Margem <b>${((pr - ck) / pr * 100).toFixed(0)}%</b></span>` : `<span>Informe preço e custo para ver o lucro por peça.</span>`;
}
async function saveProduct(btn) {
  const name = $('#pn').value.trim(), price = +$('#pp').value;
  if (!name) return toast('Informe o nome do produto.', 'err');
  if (!(price > 0)) return toast('Informe o preço de venda.', 'err');
  busy(btn, true);
  try {
    let img = ED.image, oldImg = null;
    if (ED.blob) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await ok(sb.storage.from('produtos').upload(path, ED.blob, {contentType: ED.blob.type || 'image/jpeg'}));
      oldImg = ED.image; img = sb.storage.from('produtos').getPublicUrl(path).data.publicUrl;
    }
    const body = { name, description: $('#pd').value.trim(), category: $('#pc').value.trim() || 'Sandálias', price, cost: +$('#pk').value || 0, image_url: img, active: $('#pa').checked };
    const row = ED.id ? await ok(sb.from('products').update(body).eq('id', ED.id).select().single()) : await ok(sb.from('products').insert(body).select().single());
    const rows = Object.entries(ED.sizes).map(([size, stock]) => ({ product_id: row.id, size, stock: Math.max(0, +stock || 0) }));
    if (rows.length) await ok(sb.from('variants').upsert(rows, { onConflict: 'product_id,size' }));
    const gone = ED.existing.filter(v => !(v.size in ED.sizes)).map(v => v.id);
    if (gone.length) await ok(sb.from('variants').delete().in('id', gone));
    if (oldImg) dropImage(oldImg, row.id);
    await reload(); closeDrawer(); repaint(); toast('Produto salvo.');
  } catch (e) { fail(e); } finally { busy(btn, false); }
}
async function dropImage(url, exceptId) { // apaga a foto do storage se nenhum outro produto usa
  try { if (!url || S.products.some(p => p.id !== exceptId && p.image_url === url)) return; const path = url.split('/produtos/')[1]; if (path) await sb.storage.from('produtos').remove([decodeURIComponent(path)]); } catch {}
}
async function delProduct(id) {
  const p = prodById(id); if (!p) return;
  const r = await confirmBox({ title: 'Excluir produto?', text: `<b>${esc(p.name)}</b> será removido da loja e do estoque. Os pedidos antigos continuam no histórico.`, ok: 'Excluir produto' });
  if (!r.ok) return;
  try { await ok(sb.from('products').delete().eq('id', id)); dropImage(p.image_url, id); await reload(); closeDrawer(); repaint(); toast('Produto excluído.'); } catch (e) { fail(e); }
}
async function dupProduct(id) {
  const p = prodById(id); if (!p) return;
  try {
    const row = await ok(sb.from('products').insert({ name: p.name + ' (cópia)', description: p.description, category: p.category, price: p.price, cost: p.cost, image_url: p.image_url, active: false }).select().single());
    if (p.variants.length) await ok(sb.from('variants').insert(p.variants.map(v => ({ product_id: row.id, size: v.size, stock: 0 }))));
    await reload(); repaint(); toast('Cópia criada (oculta). Ajuste e publique.'); openProduct(row.id);
  } catch (e) { fail(e); }
}

/* =========================================================
   PEDIDOS
   ========================================================= */
function vOrd() {
  const f = S.f.ord;
  $('#view').innerHTML = `
  <div class="bar"><div class="inp-ico grow"><svg class="i sm"><use href="#i-search"/></svg><input class="inp" placeholder="Buscar por cliente, telefone, código ou produto…" value="${esc(f.q)}" data-inp="ord.q"></div><div class="seg" id="oseg"></div></div>
  <div class="card tbl"><div class="th cols-ord"><span class="hide-m">Pedido</span><span>Cliente</span><span class="hide-m">Itens</span><span class="rt">Total</span><span>Status</span><span class="hide-m"></span></div><div id="olist"></div></div>`;
  paintOrd();
}
const NEXT = { novo:['pago','Confirmar pagamento'], pago:['enviado','Marcar enviado'], enviado:['entregue','Marcar entregue'] };
function paintOrd() {
  const f = S.f.ord, q = f.q.toLowerCase().trim(), qd = digits(f.q);
  const L = S.orders.filter(o => (f.st === 'all' || o.status === f.st) && (!q || o.customer_name?.toLowerCase().includes(q) || o.id.startsWith(q.replace('#', '')) || (qd && digits(o.phone).includes(qd)) || o.order_items.some(i => i.name?.toLowerCase().includes(q))));
  const c = k => k === 'all' ? S.orders.length : S.orders.filter(o => o.status === k).length;
  $('#oseg').innerHTML = [['all','Todos'], ...Object.entries(STLBL)].map(([k, l]) => `<button class="${f.st === k ? 'on' : ''}" data-act="ost" data-v="${k}">${l}<em>${c(k)}</em></button>`).join('');
  $('#olist').innerHTML = L.map(o => {
    const its = o.order_items, first = its.slice(0, 2).map(i => `${esc(i.name)} <span class="mut">${esc(i.size)}×${i.qty}</span>`).join(', ') + (its.length > 2 ? ` <span class="mut">+${its.length - 2}</span>` : '');
    const n = NEXT[o.status];
    return `<div class="tr cols-ord click" data-act="openOrder" data-id="${o.id}">
      <div class="hide-m"><div class="t1 num">#${short(o.id)}</div><div class="t2">${ago(o.created_at)}</div></div>
      <div style="min-width:0"><div class="t1">${esc(o.customer_name)}</div><div class="t2">${esc(o.phone || '')}${o.proof_url ? ' · 📎 comprovante' : ''}</div></div>
      <div class="hide-m" style="font-size:.82rem">${first}</div>
      <div class="rt num"><b>${BRL(o.total)}</b></div>
      <div>${badge(o.status)}</div>
      <div class="rt hide-m">${n ? `<button class="btn out sm" data-act="quickStatus" data-id="${o.id}" data-s="${n[0]}">${n[1]}</button>` : ''}</div>
    </div>`;
  }).join('') || empty('orders', S.orders.length ? 'Nenhum pedido neste filtro' : 'Nenhum pedido ainda', S.orders.length ? '' : 'Quando um cliente comprar na loja, o pedido aparece aqui.');
}
function openOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const idx = FLOW.indexOf(o.status), cancelled = o.status === 'cancelado';
  const items = o.order_items.map(i => { const p = i.product_id ? prodById(i.product_id) : null; return { i, p }; });
  const lucro = items.every(x => x.p) && items.some(x => x.p.cost > 0) ? items.reduce((a, x) => a + (x.i.price - x.p.cost) * x.i.qty, 0) : null;
  const proof = o.proof_url ? (/\.pdf($|\?)/i.test(o.proof_url) ? `<a class="btn out" href="${esc(o.proof_url)}" target="_blank" rel="noopener">${ico('ext','sm')} Abrir comprovante (PDF)</a>` : `<a href="${esc(o.proof_url)}" target="_blank" rel="noopener"><img class="proof" src="${esc(o.proof_url)}" alt="Comprovante"></a>`) : `<p class="mut">O cliente ainda não enviou o comprovante.</p>`;
  const hasIncome = S.tx.some(t => t.order_id === o.id);
  openDrawer({
    title: `Pedido #${short(o.id)}`,
    body: `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.2rem">${badge(o.status)}<span class="mut">${fmtDT(o.created_at)}</span></div>
    <div class="sec">Andamento</div>
    ${cancelled ? `<p class="mut" style="margin-bottom:.6rem">Pedido cancelado. As peças voltaram ao estoque.</p><button class="btn out sm" data-act="setStatus" data-id="${o.id}" data-s="novo">Reabrir pedido</button>`
      : `<div class="steps">${FLOW.map((s, k) => `<button class="${k < idx ? 'done' : k === idx ? 'on' : ''}" data-act="setStatus" data-id="${o.id}" data-s="${s}">${k < idx ? '✓ ' : ''}${STLBL[s]}</button>`).join('')}</div><button class="btn ghost sm" style="color:var(--err)" data-act="cancelOrder" data-id="${o.id}">Cancelar pedido</button>`}
    <div class="sec">Cliente</div>
    <dl class="kv"><dt>Nome</dt><dd>${esc(o.customer_name)}</dd><dt>WhatsApp</dt><dd>${esc(o.phone || '—')} ${o.phone ? `<a class="btn out sm" style="margin-left:.4rem" href="${waLink(o.phone, `Olá, ${(o.customer_name || '').split(' ')[0]}! Aqui é da Kafe Coleção sobre o seu pedido #${short(o.id)}.`)}" target="_blank" rel="noopener">${ico('chat','sm')} Chamar</a>` : ''}</dd>
    <dt>Endereço</dt><dd>${esc(o.address || '—')} <button class="ibtn" data-act="copy" data-t="${esc(o.address)}" title="Copiar">${ico('copy','sm')}</button></dd></dl>
    <div class="sec">Itens</div>
    <div class="items">${items.map(({ i, p }) => `<div class="it">${thumb(p?.image_url, 'sm')}<div><div class="t1">${esc(i.name)}</div><div class="t2">Tam. ${esc(i.size)} · ${i.qty} × ${BRL(i.price)}</div></div><b class="num">${BRL(i.price * i.qty)}</b></div>`).join('')}</div>
    <div class="tot"><span>Total</span><span class="num">${BRL(o.total)}</span></div>
    ${lucro !== null ? `<div class="margin" style="margin-top:.8rem"><span>Lucro estimado do pedido</span><b>${BRL(lucro)}</b></div>` : ''}
    <div class="sec">Comprovante Pix</div>${proof}
    <div class="sec">Envio e observações</div>
    <div class="field"><label>Código de rastreio</label><input class="inp" id="otr" value="${esc(o.tracking)}" placeholder="Ex.: BR123456789BR"></div>
    <div class="field"><label>Observação interna (o cliente não vê)</label><textarea class="inp" id="onote" rows="2">${esc(o.notes)}</textarea></div>
    <div class="danger-zone"><span>Excluir este pedido apaga o histórico dele.<br>Prefira <b>Cancelar</b> se só quer desfazer a venda.</span><button class="btn danger-o sm" data-act="delOrder" data-id="${o.id}">${ico('trash','sm')} Excluir</button></div>`,
    footer: `<span class="sp"></span><button class="btn out" data-act="closeDrawer">Fechar</button><button class="btn pri" data-act="saveOrderMeta" data-id="${o.id}">Salvar</button>`
  });
}
async function setStatus(id, s, reopen = true) {
  try {
    await ok(sb.from('orders').update({ status: s }).eq('id', id));
    await reload(); repaint(); if (reopen && drawerOpen()) openOrder(id);
    toast(`Pedido marcado como ${STLBL[s].toLowerCase()}.`);
  } catch (e) { fail(e); }
}
async function cancelOrder(id) {
  const o = S.orders.find(x => x.id === id);
  const r = await confirmBox({ title: 'Cancelar pedido?', text: `As peças voltam ao estoque${S.tx.some(t => t.order_id === id) ? ' e a entrada deste pedido sai do financeiro' : ''}. Você pode reabrir depois.`, ok: 'Cancelar pedido' });
  if (r.ok) setStatus(id, 'cancelado');
}
async function delOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const hasIncome = S.tx.some(t => t.order_id === id);
  const r = await confirmBox({ title: 'Excluir pedido?', text: `O pedido <b>#${short(id)}</b> de <b>${esc(o.customer_name)}</b> será apagado de vez. Essa ação não tem volta.`, ok: 'Excluir pedido',
    checks: [ { id:'restock', label:'Devolver as peças ao estoque', checked: o.status !== 'cancelado', disabled: o.status === 'cancelado' }, ...(hasIncome ? [{ id:'income', label:'Remover a entrada deste pedido do financeiro', checked:true }] : []) ] });
  if (!r.ok) return;
  try { await ok(sb.rpc('admin_delete_order', { p_order: id, p_restock: !!r.checks.restock, p_remove_income: hasIncome ? !!r.checks.income : false })); await reload(); closeDrawer(); repaint(); toast('Pedido excluído.'); } catch (e) { fail(e); }
}
async function saveOrderMeta(id, btn) {
  busy(btn, true);
  try { await ok(sb.from('orders').update({ tracking: $('#otr').value.trim() || null, notes: $('#onote').value.trim() || null }).eq('id', id)); await reload(); toast('Alterações salvas.'); } catch (e) { fail(e); } finally { busy(btn, false); }
}

/* =========================================================
   CLIENTES
   ========================================================= */
function clients() {
  const m = new Map();
  S.orders.forEach(o => {
    const key = digits(o.phone).slice(-11) || (o.customer_name || '').toLowerCase();
    const c = m.get(key) || { key, name:o.customer_name, phone:o.phone, orders:[], paid:0, open:0, last:o.created_at };
    c.orders.push(o);
    if (PAID.includes(o.status)) c.paid += +o.total; else if (o.status === 'novo') c.open += +o.total;
    if (new Date(o.created_at) > new Date(c.last)) { c.last = o.created_at; c.name = o.customer_name; c.phone = o.phone; }
    m.set(key, c);
  });
  return [...m.values()].sort((a, b) => b.paid - a.paid || new Date(b.last) - new Date(a.last));
}
function vCli() {
  const C = clients(), buyers = C.filter(c => c.paid > 0), rec = C.filter(c => c.orders.filter(o => PAID.includes(o.status)).length >= 2);
  const tp = buyers.reduce((a, c) => a + c.paid, 0);
  $('#view').innerHTML = `
  <div class="kpis">
    <div class="kpi"><span class="l"><i class="in">${ico('users','sm')}</i>Clientes</span><b>${C.length}</b><em>${buyers.length} já pagaram</em></div>
    <div class="kpi"><span class="l"><i class="ok">${ico('cash','sm')}</i>Total vendido</span><b class="pos">${BRL(tp)}</b><em>soma dos pedidos pagos</em></div>
    <div class="kpi"><span class="l"><i class="g">${ico('bag','sm')}</i>Compra média por cliente</span><b>${BRL(buyers.length ? tp / buyers.length : 0)}</b><em>entre quem pagou</em></div>
    <div class="kpi"><span class="l"><i>${ico('users','sm')}</i>Clientes recorrentes</span><b>${rec.length}</b><em>2 ou mais compras</em></div>
  </div>
  <div class="bar"><div class="inp-ico grow"><svg class="i sm"><use href="#i-search"/></svg><input class="inp" placeholder="Buscar cliente…" value="${esc(S.f.cli.q)}" data-inp="cli.q"></div></div>
  <div class="card tbl"><div class="th cols-cli"><span>Cliente</span><span class="hide-m">WhatsApp</span><span class="hide-m ct">Pedidos</span><span class="rt">Total pago</span><span class="hide-m rt">Em aberto</span><span></span></div><div id="clist"></div></div>`;
  paintCli();
}
function paintCli() {
  const q = S.f.cli.q.toLowerCase().trim(), qd = digits(S.f.cli.q);
  const L = clients().filter(c => !q || c.name?.toLowerCase().includes(q) || (qd && digits(c.phone).includes(qd)));
  $('#clist').innerHTML = L.map(c => `<div class="tr cols-cli click" data-act="openClient" data-k="${esc(c.key)}">
    <div><div class="t1">${esc(c.name)}</div><div class="t2">Última compra ${ago(c.last)}</div></div>
    <div class="hide-m num">${esc(c.phone || '—')}</div><div class="hide-m ct num">${c.orders.length}</div>
    <div class="rt num"><b class="${c.paid ? 'pos' : 'mut'}">${BRL(c.paid)}</b></div><div class="hide-m rt num ${c.open ? '' : 'mut'}">${c.open ? BRL(c.open) : '—'}</div>
    <div class="rt">${c.phone ? `<a class="ibtn" href="${waLink(c.phone)}" target="_blank" rel="noopener" title="WhatsApp" data-act="noop">${ico('chat','sm')}</a>` : ''}</div></div>`).join('') || empty('users', 'Nenhum cliente ainda', 'Os clientes aparecem aqui depois do primeiro pedido.');
}
function openClient(key) {
  const c = clients().find(x => x.key === key); if (!c) return;
  openDrawer({ title: esc(c.name), body: `<dl class="kv"><dt>WhatsApp</dt><dd>${esc(c.phone || '—')} ${c.phone ? `<a class="btn out sm" style="margin-left:.4rem" href="${waLink(c.phone)}" target="_blank" rel="noopener">${ico('chat','sm')} Chamar</a>` : ''}</dd><dt>Total pago</dt><dd><b class="pos">${BRL(c.paid)}</b></dd><dt>Pedidos</dt><dd>${c.orders.length}</dd></dl>
    <div class="sec">Histórico de pedidos</div>${c.orders.map(o => `<div class="tr click" style="grid-template-columns:1fr auto;padding:.8rem 0" data-act="openOrder" data-id="${o.id}"><div><div class="t1">#${short(o.id)} · ${fmtD(isoOf(new Date(o.created_at)))}</div><div class="t2">${o.order_items.map(i => esc(i.name) + ' ' + esc(i.size)).join(', ')}</div></div><div class="rt"><div class="num"><b>${BRL(o.total)}</b></div>${badge(o.status)}</div></div>`).join('')}` });
}

/* =========================================================
   ESTOQUE
   ========================================================= */
function vStk() {
  const act = S.products;
  const units = act.reduce((a, p) => a + stockOf(p), 0), cost = act.reduce((a, p) => a + stockOf(p) * (p.cost || 0), 0), sale = act.reduce((a, p) => a + stockOf(p) * p.price, 0);
  const zero = act.reduce((a, p) => a + p.variants.filter(v => v.stock === 0).length, 0);
  $('#view').innerHTML = `
  <div class="kpis">
    <div class="kpi"><span class="l"><i>${ico('box','sm')}</i>Peças em estoque</span><b>${units}</b><em>${act.length} produtos</em></div>
    <div class="kpi"><span class="l"><i class="er">${ico('wallet','sm')}</i>Capital parado (custo)</span><b>${BRL(cost)}</b><em>quanto você investiu</em></div>
    <div class="kpi"><span class="l"><i class="ok">${ico('cash','sm')}</i>Valor de venda</span><b class="pos">${BRL(sale)}</b><em>se vender tudo</em></div>
    <div class="kpi"><span class="l"><i class="er">${ico('alert','sm')}</i>Tamanhos zerados</span><b>${zero}</b><em>em ${act.filter(p => p.variants.some(v => v.stock === 0)).length} produto(s)</em></div>
  </div>
  <div class="bar"><div class="inp-ico grow"><svg class="i sm"><use href="#i-search"/></svg><input class="inp" placeholder="Buscar produto…" value="${esc(S.f.stk.q)}" data-inp="stk.q"></div></div>
  <div class="card tbl stkwrap" id="stkc"></div>`;
  paintStk();
}
function paintStk() {
  const q = S.f.stk.q.toLowerCase(), L = S.products.filter(p => !q || p.name.toLowerCase().includes(q));
  const sizes = [...new Set(S.products.flatMap(p => p.variants.map(v => v.size)))].sort(sizeCmp), n = sizes.length;
  if (!S.products.length) { $('#stkc').innerHTML = empty('box', 'Nenhum produto ainda', 'Cadastre produtos para controlar o estoque.'); return; }
  $('#stkc').innerHTML = `<div class="th cols-stk" style="--n:${n}"><span>Produto</span>${sizes.map(s => `<span class="ct">${esc(s)}</span>`).join('')}<span class="rt">Total</span></div>` +
    L.map(p => `<div class="tr cols-stk" style="--n:${n}"><div class="pcell">${thumb(p.image_url, 'sm')}<div><div class="t1">${esc(p.name)}</div><div class="t2">${p.active ? esc(p.category || '') : 'oculto'}</div></div></div>${sizes.map(s => { const v = p.variants.find(x => x.size === s); return v ? `<div><input class="stk ${v.stock === 0 ? 'z' : v.stock === 1 ? 'l' : ''}" type="number" min="0" value="${v.stock}" data-chg="stk" data-v="${v.id}" data-p="${p.id}" aria-label="${esc(p.name)} tamanho ${esc(s)}"></div>` : `<div><input class="stk na" disabled value="·"></div>`; }).join('')}<div class="rt num"><b>${stockOf(p)}</b></div></div>`).join('');
}
let SI = null;
function openStockIn(pid) {
  SI = { pid: pid || S.products[0]?.id, add: {} };
  if (!S.products.length) return toast('Cadastre um produto primeiro.', 'err');
  openDrawer({
    title: 'Entrada de mercadoria',
    body: `<p class="mut" style="margin-bottom:1rem">Soma as peças no estoque e lança o valor pago como <b>saída</b> no financeiro.</p>
    <div class="field"><label>Produto</label><select class="inp" id="sip" data-chg="sip">${S.products.map(p => `<option value="${p.id}" ${p.id === SI.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="sec">Quantidade que chegou</div><div class="sizes" id="sigrid"></div>
    <div class="addsz"><input class="inp" id="sins" placeholder="Outro tamanho"><button class="btn out sm" data-act="sinAdd">${ico('plus','sm')} Adicionar</button></div>
    <div class="sec">Pagamento</div>
    <div class="g2"><div class="field"><label>Fornecedor</label><input class="inp" id="sisup" placeholder="Opcional"></div><div class="field"><label>Data</label><input class="inp" id="sidt" type="date" value="${today()}"></div></div>
    <div class="g2"><div class="field"><label>Valor total pago</label><div class="inp-wrap"><span class="pre">R$</span><input class="inp" id="sitot" type="number" step="0.01" min="0" inputmode="decimal" data-inp="sicalc"></div></div><div class="field"><label>Custo por peça</label><div class="inp-wrap"><span class="pre">R$</span><input class="inp" id="siuc" type="number" step="0.01" min="0" inputmode="decimal"></div><small class="hint">Calculado sozinho; atualiza o custo do produto.</small></div></div>`,
    footer: `<span class="sp"></span><button class="btn out" data-act="closeDrawer">Cancelar</button><button class="btn pri" data-act="saveStockIn">Lançar entrada</button>`
  });
  paintSi();
}
function paintSi() {
  const p = prodById($('#sip').value), ks = [...new Set([...(p?.variants.map(v => v.size) || []), ...Object.keys(SI.add)])].sort(sizeCmp);
  ks.forEach(k => { if (!(k in SI.add)) SI.add[k] = 0; });
  $('#sigrid').innerHTML = ks.map(s => `<div class="sz"><b>${esc(s)}<small class="mut" style="font-weight:400">${p?.variants.find(v => v.size === s) ? 'tem ' + p.variants.find(v => v.size === s).stock : 'novo'}</small></b><div class="step"><button data-act="sinc" data-s="${esc(s)}" data-d="-1">−</button><input type="number" min="0" value="${SI.add[s]}" data-inp="siq" data-s="${esc(s)}"><button data-act="sinc" data-s="${esc(s)}" data-d="1">+</button></div></div>`).join('');
}
function siCalc() { const q = Object.values(SI.add).reduce((a, b) => a + (+b || 0), 0), t = +$('#sitot').value; if (q && t) $('#siuc').value = (t / q).toFixed(2); }
async function saveStockIn(btn) {
  const items = Object.entries(SI.add).filter(([, q]) => +q > 0).map(([size, qty]) => ({ size, qty: +qty }));
  if (!items.length) return toast('Informe a quantidade de ao menos um tamanho.', 'err');
  busy(btn, true);
  try {
    await ok(sb.rpc('admin_stock_in', { p_product: $('#sip').value, p_items: items, p_total: +$('#sitot').value || 0, p_supplier: $('#sisup').value.trim(), p_date: $('#sidt').value || today(), p_unit_cost: +$('#siuc').value > 0 ? +$('#siuc').value : null }));
    await reload(); closeDrawer(); repaint(); toast('Entrada registrada: estoque e financeiro atualizados.');
  } catch (e) { fail(e); } finally { busy(btn, false); }
}

/* =========================================================
   FINANCEIRO
   ========================================================= */
function finRange() {
  const f = S.f.fin, now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const last = (yy, mm) => isoOf(new Date(yy, mm + 1, 0));
  switch (f.per) {
    case 'month': return [`${y}-${p2(m+1)}-01`, last(y, m)];
    case 'prev': { const d = new Date(y, m - 1, 1); return [isoOf(d), last(d.getFullYear(), d.getMonth())]; }
    case '90': { const d = new Date(); d.setDate(d.getDate() - 89); return [isoOf(d), today()]; }
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    case 'custom': return [f.from || '0000-01-01', f.to || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}
function finSet() {
  const [a, b] = finRange(), f = S.f.fin, q = f.q.toLowerCase().trim();
  const inP = S.tx.filter(t => t.date >= a && t.date <= b);
  const list = inP.filter(t => (f.type === 'all' || t.type === f.type) && (!f.cat || t.category === f.cat) && (!q || (t.description || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q)));
  return { inP, list };
}
function vFin() {
  const f = S.f.fin;
  $('#view').innerHTML = `
  <div class="bar"><div class="seg">${[['month','Este mês'],['prev','Mês passado'],['90','90 dias'],['year','Este ano'],['all','Tudo'],['custom','Personalizado']].map(([k, l]) => `<button class="${f.per === k ? 'on' : ''}" data-act="per" data-v="${k}">${l}</button>`).join('')}</div>
    ${f.per === 'custom' ? `<input class="inp" type="date" style="width:auto" value="${f.from}" data-inp="fin.from"> <span class="mut">até</span> <input class="inp" type="date" style="width:auto" value="${f.to}" data-inp="fin.to">` : ''}</div>
  <div class="kpis" id="fk"></div><div class="cols" id="fc"></div>
  <div class="bar"><div class="inp-ico grow"><svg class="i sm"><use href="#i-search"/></svg><input class="inp" placeholder="Buscar lançamento…" value="${esc(f.q)}" data-inp="fin.q"></div>
    <div class="seg">${[['all','Todos'],['entrada','Entradas'],['saida','Saídas']].map(([k, l]) => `<button class="${f.type === k ? 'on' : ''}" data-act="ftype" data-v="${k}">${l}</button>`).join('')}</div>
    <select class="inp" style="width:auto" data-inp="fin.cat"><option value="">Todas as categorias</option>${txCats().map(c => `<option ${c === f.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
  <div class="card tbl"><div class="th cols-fin"><span class="hide-m">Data</span><span class="hide-m">Categoria</span><span>Descrição</span><span class="rt">Valor</span><span class="hide-m"></span></div><div id="flist"></div></div>`;
  paintFin();
}
function paintFin() {
  const { inP, list } = finSet(), sum = (a, ty) => a.filter(t => t.type === ty).reduce((s, t) => s + +t.amount, 0);
  const e = sum(inP, 'entrada'), s = sum(inP, 'saida'), r = e - s;
  $('#fk').innerHTML = `
    <div class="kpi"><span class="l"><i class="ok">${ico('cash','sm')}</i>Entradas</span><b class="pos">${BRL(e)}</b><em>${inP.filter(t => t.type === 'entrada').length} lançamento(s)</em></div>
    <div class="kpi"><span class="l"><i class="er">${ico('wallet','sm')}</i>Saídas</span><b class="neg">${BRL(s)}</b><em>${inP.filter(t => t.type === 'saida').length} lançamento(s)</em></div>
    <div class="kpi"><span class="l"><i>${ico('dash','sm')}</i>Resultado</span><b class="${r < 0 ? 'neg' : ''}">${BRL(r)}</b><em>entradas − saídas</em></div>
    <div class="kpi"><span class="l"><i class="g">${ico('bag','sm')}</i>Margem</span><b>${e ? (r / e * 100).toFixed(0) + '%' : '—'}</b><em>do que entrou, quanto sobrou</em></div>`;
  const now = mkey(today()), months = [...Array(8)].map((_, i) => addM(now, i - 7));
  const A = months.map(m => sum(S.tx.filter(t => mkey(t.date) === m), 'entrada')), B = months.map(m => sum(S.tx.filter(t => mkey(t.date) === m), 'saida'));
  const byCat = {}; inP.filter(t => t.type === 'saida').forEach(t => byCat[t.category || 'Sem categoria'] = (byCat[t.category || 'Sem categoria'] || 0) + +t.amount);
  const cl = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('#fc').innerHTML = `<div class="card pad"><h3>Últimos 8 meses <span class="legend"><span><i style="background:#b8546e"></i>Entradas</span><span><i style="background:#d9bfa6"></i>Saídas</span></span></h3>${barChart(months.map(mlabel), A, B)}</div>
    <div class="card"><h3 style="padding:1.2rem 1.3rem .6rem">Para onde foi o dinheiro <small>saídas no período</small></h3>${cl.length ? cl.map(([k, v]) => `<div class="rank" style="grid-template-columns:1fr auto"><div><div class="t1">${esc(k)}</div><div class="hbar"><i style="width:${v / cl[0][1] * 100}%"></i></div></div><div class="rt num"><b>${BRL(v)}</b><div class="t2">${s ? (v / s * 100).toFixed(0) : 0}%</div></div></div>`).join('') : empty('wallet', 'Sem saídas no período')}</div>`;
  $('#flist').innerHTML = list.map(t => `<div class="tr cols-fin click" data-act="openTx" data-id="${t.id}">
    <div class="hide-m num">${fmtD(t.date)}</div><div class="hide-m">${esc(t.category || '—')}</div>
    <div style="min-width:0"><div class="t1">${esc(t.description || t.category || 'Sem descrição')}${t.order_id ? ' <span class="badge b-auto" style="margin-left:.3rem">Pedido</span>' : ''}</div><div class="t2">${fmtD(t.date)} · ${esc(t.category || '')}</div></div>
    <div class="rt num ${t.type === 'entrada' ? 'pos' : 'neg'}"><b>${t.type === 'entrada' ? '+' : '−'}${BRL(t.amount)}</b></div>
    <div class="rt hide-m"><button class="ibtn" data-act="openTx" data-id="${t.id}" title="Editar">${ico('edit','sm')}</button><button class="ibtn del" data-act="delTx" data-id="${t.id}" title="Excluir">${ico('trash','sm')}</button></div></div>`).join('') || empty('wallet', 'Nenhum lançamento', 'Mude o período ou clique em “Novo lançamento”.');
}
let TX = null;
function openTx(id) {
  const t = id ? S.tx.find(x => x.id === id) : null;
  TX = { id: t?.id || null, type: t?.type || 'saida' };
  openDrawer({
    title: t ? 'Editar lançamento' : 'Novo lançamento',
    body: `<div class="seg" id="txseg" style="width:100%;margin-bottom:1.2rem"><button style="flex:1;justify-content:center" class="${TX.type === 'saida' ? 'on' : ''}" data-act="txType" data-v="saida">Saída</button><button style="flex:1;justify-content:center" class="${TX.type === 'entrada' ? 'on' : ''}" data-act="txType" data-v="entrada">Entrada</button></div>
    ${t?.order_id ? `<p class="mut" style="margin-bottom:1rem">${ico('alert','sm')} Entrada gerada automaticamente por um pedido.</p>` : ''}
    <div class="g2"><div class="field"><label>Valor</label><div class="inp-wrap"><span class="pre">R$</span><input class="inp" id="tv" type="number" step="0.01" min="0" inputmode="decimal" value="${t?.amount ?? ''}"></div></div><div class="field"><label>Data</label><input class="inp" id="td" type="date" value="${t?.date || today()}"></div></div>
    <div class="field"><label>Categoria</label><input class="inp" id="tc" list="tcl" value="${esc(t?.category)}" placeholder="Ex.: Mercadoria, Frete, Anúncios"><datalist id="tcl">${txCats().map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="field"><label>Descrição</label><input class="inp" id="tdsc" value="${esc(t?.description)}" placeholder="O que foi?"></div>`,
    footer: `${t ? `<button class="btn danger-o" data-act="delTx" data-id="${t.id}">${ico('trash','sm')} Excluir</button>` : ''}<span class="sp"></span><button class="btn out" data-act="closeDrawer">Cancelar</button><button class="btn pri" data-act="saveTx">Salvar</button>`
  });
}
async function saveTx(btn) {
  const amount = +$('#tv').value; if (!(amount > 0)) return toast('Informe o valor.', 'err');
  const body = { type: TX.type, amount, date: $('#td').value || today(), category: $('#tc').value.trim() || (TX.type === 'entrada' ? 'Vendas' : 'Outros'), description: $('#tdsc').value.trim() };
  busy(btn, true);
  try { await ok(TX.id ? sb.from('transactions').update(body).eq('id', TX.id) : sb.from('transactions').insert(body)); await reload(); closeDrawer(); repaint(); toast('Lançamento salvo.'); } catch (e) { fail(e); } finally { busy(btn, false); }
}
async function delTx(id) {
  const t = S.tx.find(x => x.id === id); if (!t) return;
  const r = await confirmBox({ title: 'Excluir lançamento?', text: `${t.type === 'entrada' ? 'Entrada' : 'Saída'} de <b>${BRL(t.amount)}</b> — ${esc(t.description || t.category || '')}.${t.order_id ? '<br><br>Este valor veio de um pedido pago. O pedido continua marcado como pago.' : ''}`, ok: 'Excluir' });
  if (!r.ok) return;
  try { await ok(sb.from('transactions').delete().eq('id', id)); await reload(); closeDrawer(); repaint(); toast('Lançamento excluído.'); } catch (e) { fail(e); }
}
function exportCsv() {
  const { list } = finSet(); if (!list.length) return toast('Nada para exportar neste filtro.', 'err');
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data','Tipo','Categoria','Descrição','Valor'], ...list.map(t => [fmtD(t.date), t.type === 'entrada' ? 'Entrada' : 'Saída', t.category, t.description, (t.type === 'entrada' ? '' : '-') + Number(t.amount).toFixed(2).replace('.', ',')])];
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kafe-financeiro-${today()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* =========================================================
   AÇÕES (delegação de eventos)
   ========================================================= */
const A = {
  noop() {},
  closeDrawer, modalNo() { closeModal({ ok: false, checks: {} }); },
  modalYes() { const c = {}; modalChecks.forEach(k => c[k.id] = $('#mc-' + k.id)?.checked); closeModal({ ok: true, checks: c }); },
  openProduct: el => openProduct(el.dataset.id), newProduct: () => openProduct(), dupProduct: el => dupProduct(el.dataset.id), delProduct: el => delProduct(el.dataset.id),
  saveProduct: el => saveProduct(el), pickImg: () => $('#pf').click(),
  pst: el => { S.f.prod.st = el.dataset.v; paintProd(); },
  preset: el => { PRESETS[el.dataset.k].forEach(s => { if (!(s in ED.sizes)) ED.sizes[s] = 0; }); paintSizes(); },
  addSize() { const v = $('#nsz').value.trim(); if (!v) return; if (!(v in ED.sizes)) ED.sizes[v] = 0; $('#nsz').value = ''; paintSizes(); },
  szinc: el => { const s = el.dataset.s; ED.sizes[s] = Math.max(0, (+ED.sizes[s] || 0) + +el.dataset.d); paintSizes(); },
  szdel: el => { delete ED.sizes[el.dataset.s]; paintSizes(); },
  ost: el => { S.f.ord.st = el.dataset.v; paintOrd(); },
  openOrder: el => openOrder(el.dataset.id),
  quickStatus: el => setStatus(el.dataset.id, el.dataset.s, false),
  setStatus: el => setStatus(el.dataset.id, el.dataset.s), cancelOrder: el => cancelOrder(el.dataset.id), delOrder: el => delOrder(el.dataset.id),
  saveOrderMeta: el => saveOrderMeta(el.dataset.id, el),
  copy: el => { navigator.clipboard?.writeText(el.dataset.t || ''); toast('Copiado.'); },
  openClient: el => openClient(el.dataset.k),
  openStockIn: () => openStockIn(),
  sinc: el => { const s = el.dataset.s; SI.add[s] = Math.max(0, (+SI.add[s] || 0) + +el.dataset.d); paintSi(); siCalc(); },
  sinAdd() { const v = $('#sins').value.trim(); if (!v) return; if (!(v in SI.add)) SI.add[v] = 0; $('#sins').value = ''; paintSi(); },
  saveStockIn: el => saveStockIn(el),
  per: el => { S.f.fin.per = el.dataset.v; vFin(); },
  ftype: el => { S.f.fin.type = el.dataset.v; vFin(); },
  newTx: () => openTx(), openTx: el => openTx(el.dataset.id), saveTx: el => saveTx(el), delTx: el => delTx(el.dataset.id),
  txType: el => { TX.type = el.dataset.v; $$('#txseg button').forEach(b => b.classList.toggle('on', b === el)); },
  exportCsv,
  logout: async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); },
};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'A' && el.dataset.act === 'noop') { e.stopPropagation(); return; }
  const fn = A[el.dataset.act]; if (!fn) return;
  try { await fn(el, e); } catch (err) { fail(err); }
});
document.addEventListener('change', async e => {
  const el = e.target.closest('[data-chg]'); if (!el) return;
  try {
    if (el.dataset.chg === 'toggleActive') {
      const p = prodById(el.dataset.id); await ok(sb.from('products').update({ active: el.checked }).eq('id', p.id)); p.active = el.checked; paintProd(); $('#sub').textContent = R.produtos.sub(); toast(el.checked ? 'Produto visível na loja.' : 'Produto oculto da loja.');
    } else if (el.dataset.chg === 'stk') {
      const v = Math.max(0, parseInt(el.value, 10) || 0); await ok(sb.from('variants').update({ stock: v }).eq('id', el.dataset.v));
      const p = prodById(el.dataset.p); p.variants.find(x => x.id === el.dataset.v).stock = v; vStk(); toast('Estoque atualizado.');
    } else if (el.dataset.chg === 'sip') { SI.add = {}; paintSi(); siCalc(); }
  } catch (err) { fail(err); if (S.route === 'produtos') paintProd(); if (S.route === 'estoque') vStk(); }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-inp]'); if (!el) return;
  const k = el.dataset.inp;
  if (k === 'mgn') return calcMargin();
  if (k === 'szin') { ED.sizes[el.dataset.s] = Math.max(0, parseInt(el.value, 10) || 0); return; }
  if (k === 'siq') { SI.add[el.dataset.s] = Math.max(0, parseInt(el.value, 10) || 0); return siCalc(); }
  if (k === 'sicalc') return siCalc();
  const [g, f] = k.split('.'); S.f[g][f] = el.value;
  ({ prod: paintProd, ord: paintOrd, cli: paintCli, stk: paintStk, fin: paintFin })[g]?.();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#modal').classList.contains('show')) A.modalNo(); else if (drawerOpen()) closeDrawer();
});
$('#ov').addEventListener('click', closeDrawer);
$('#ov2').addEventListener('click', () => A.modalNo());

/* =========================================================
   LOGIN / INICIALIZAÇÃO
   ========================================================= */
function showLogin(msg) {
  $('#app').hidden = true; $('#tabbar').hidden = true; $('#login').hidden = false;
  const er = $('#lerr'); er.hidden = !msg; er.textContent = msg || '';
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const b = $('#lbtn'); busy(b, true, 'Entrando…'); $('#lerr').hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('#le').value.trim(), password: $('#lp').value });
  busy(b, false);
  if (error) { $('#lerr').hidden = false; $('#lerr').textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message; return; }
  init();
});
async function init() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    const { data: adm } = await sb.from('admins').select('user_id');
    if (!adm?.length) { await sb.auth.signOut(); return showLogin('Esta conta não tem acesso de administrador.'); }
    S.user = session.user;
    $('#login').hidden = true; $('#app').hidden = false;
    $('#who').textContent = session.user.email; $('#av').textContent = (session.user.email || 'A')[0].toUpperCase();
    buildNav();
    $('#view').innerHTML = '<div class="kpis">' + '<div class="sk" style="height:110px"></div>'.repeat(4) + '</div><div class="sk" style="height:260px"></div>';
    await loadAll();
    window.addEventListener('hashchange', route); route();
    setInterval(async () => { if (document.hidden || drawerOpen() || $('#modal').classList.contains('show')) return; try { await loadAll(); if (['dashboard','pedidos'].includes(S.route)) { $('#sub').textContent = R[S.route].sub(); S.route === 'pedidos' ? paintOrd() : vDash(); } } catch {} }, 60000);
  } catch (e) { console.error(e); showLogin('Não foi possível conectar. Confira o config.js.'); }
}
init();
})();
