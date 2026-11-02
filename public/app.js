import { renderMap } from './iso.js';

const $ = (id) => document.getElementById(id);
let world, view, selected = null, playerId = null, pathChoice = 'farmer';

const store = {
  get() { try { return localStorage.getItem('emberwick-player'); } catch { return null; } },
  set(v) { try { localStorage.setItem('emberwick-player', v); } catch { /* storage unavailable */ } },
};

function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

const goodName = (g) => (world.goods[g] ? world.goods[g].name : g);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function spark(series) {
  if (!series || series.length < 2) return '';
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const d = series.map((v, k) => `${(k / (series.length - 1)) * 90},${20 - ((v - min) / span) * 18}`).join(' ');
  const up = series[series.length - 1] >= series[0];
  return `<svg class="spark" viewBox="0 0 90 22"><polyline points="${d}" fill="none" stroke="${up ? '#b23a2e' : '#3d7a34'}" stroke-width="1.5"/></svg>`;
}

// ---------- panels ----------

function panelCraftsman(b) {
  const n = view.npcs[b.id];
  const me = view.player;
  let h = `<h2>${esc(n.name)}</h2><div class="muted">${esc(b.name)} · Wallet ${n.wallet} EMWK · AI agent</div>`;
  if (n.closed) h += `<p class="closed">Closed for repairs after the dragon attack.</p>`;
  h += `<div class="quote">"${esc(n.line)}"</div>`;
  const sells = Object.entries(n.sells);
  if (sells.length) {
    h += `<h4>For sale</h4><table>`;
    for (const [g, p] of sells) {
      const stock = n.stock[g] || 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(${stock} left)</span></td><td class="n">${p} EMWK ${spark(view.history[g])}</td>` +
        `<td class="n"><button data-act="buy" data-good="${g}" ${!me || !stock || n.closed ? 'disabled' : ''}>Buy</button></td></tr>`;
    }
    h += `</table>`;
  }
  const buys = Object.entries(n.buys);
  if (buys.length) {
    h += `<h4>Buying</h4><table>`;
    for (const [g, p] of buys) {
      const have = me ? me.inv[g] || 0 : 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(you have ${have})</span></td><td class="n">${p} EMWK</td>` +
        `<td class="n"><button data-act="sell" data-good="${g}" ${!have || n.closed ? 'disabled' : ''}>Sell ${Math.min(have, 5) || ''}</button></td></tr>`;
    }
    h += `</table>`;
  }
  h += `<p class="muted" style="font-size:13px">Haggling and apprentice jobs open in the next update.</p>`;
  return h;
}

const GATHER_INFO = {
  forest: ['wood', 2, 'Chop wood. An axe gives +2.'],
  fields: ['wheat', 2, 'Harvest wheat. A plow gives +2. Droughts halve the harvest.'],
  mine: ['ore', 3, 'Dig iron ore. A pickaxe gives +2.'],
};

function panelGather(b) {
  const [good, energy, text] = GATHER_INFO[b.id];
  const me = view.player;
  return `<h2>${esc(b.name)}</h2><p>${text}</p><p class="muted">Costs ${energy} energy.${me ? ` You have ${Math.floor(me.energy)}.` : ''}</p>` +
    `<button class="primary" data-act="gather" ${!me || me.energy < energy ? 'disabled' : ''}>Gather ${goodName(good).toLowerCase()}</button>` +
    `<p class="muted" style="font-size:13px;margin-top:12px">Sell what you gather to the craftsman who pays the most. Prices change with supply and demand.</p>`;
}

function panelMarket() {
  let h = `<h2>Market</h2><p class="muted">Average prices across the village, last few hours.</p><table>`;
  for (const g of Object.keys(world.goods)) {
    const s = view.history[g];
    if (!s || !s.length) continue;
    h += `<tr><td>${goodName(g)}</td><td class="n">${Math.round(s[s.length - 1])} EMWK</td><td class="n">${spark(s)}</td></tr>`;
  }
  return h + `</table><p class="muted" style="font-size:13px">Red line: getting more expensive. Green: getting cheaper. Every sale pays a 3% tax to the village treasury.</p>`;
}

function panelDragon() {
  const e = view.events;
  const warn = e.attackDay ? `<p class="closed">The dragon may attack on day ${e.attackDay}.</p>` : `<p>The peak is quiet for now.</p>`;
  return `<h2>Dragon peak</h2>${warn}<p>Village readiness: <b>${view.readiness}%</b>. At 60% or more the guards drive the dragon back and every villager is rewarded. Below that, part of the village burns.</p>` +
    `<p class="muted" style="font-size:13px">Readiness grows with swords and bread in the Guard tower. Bring ore to the smith so he can forge swords.</p>`;
}

function panelSimple(b) {
  const texts = {
    treasury: `<h2>Treasury</h2><p>The village's shared purse: <b>${view.treasury} EMWK</b>.</p><p class="muted">It collects market tax and profit tax from rich shops, and pays the guard captain and dragon rewards. Nobody can take money out on their own. Spending will be decided by council votes.</p>`,
    council: `<h2>Council hall</h2><p>Villagers who rent a home here will propose and vote on taxes, building projects and the defence budget.</p><p class="muted">Opens in the next update.</p>`,
    gate: `<h2>Village gate</h2><p>Newcomers and travelling adventurers arrive here. Travellers spend their coin at the inn.</p><p class="muted">Population: ${view.population}</p>`,
    expansion: `<h2>Expansion land</h2><p>Reserved for future neighbourhoods and new shops. New buildings will go here without moving anything that exists today.</p>`,
  };
  if (texts[b.id]) return texts[b.id];
  if (b.type === 'house') return `<h2>${esc(b.name)}</h2><p>A home in Emberwick. Renting with a deposit, and the vote that comes with living here, open in the next update.</p>`;
  return `<h2>${esc(b.name)}</h2>`;
}

function renderPanel() {
  const b = world.buildings.find((x) => x.id === selected);
  let h;
  if (!b) h = `<h2>Welcome to Emberwick</h2><p class="muted">Click any building on the map to visit it. Gather in the forest, fields or mine, then sell to the craftsmen.</p>`;
  else if (b.type === 'craftsman') h = panelCraftsman(b);
  else if (b.type === 'gather') h = panelGather(b);
  else if (b.id === 'market') h = panelMarket();
  else if (b.id === 'dragonpeak') h = panelDragon();
  else h = panelSimple(b);
  $('panel').innerHTML = h;
}

// ---------- top bar, inventory, news ----------

function renderChrome() {
  $('day').textContent = `Day ${view.day}${view.events.winter ? ' · Winter' : ''}${view.dayProgress > 0.8 ? ' · Night' : ''}`;
  const me = view.player;
  $('coins').textContent = me ? `${me.coins.toFixed(0)} EMWK` : '— EMWK';
  $('energy').textContent = me ? `Energy ${Math.floor(me.energy)}/10` : 'Energy —';
  $('who').textContent = me ? `${me.name} · ${me.rank}` : 'Not joined';
  $('ready-fill').style.width = view.readiness + '%';
  $('ready-num').textContent = view.readiness + '%';
  $('inventory').innerHTML = me
    ? Object.entries(me.inv).map(([g, q]) => `<span class="chip">${goodName(g)} × ${q}</span>`).join('') || '<span class="muted">Your bag is empty.</span>'
    : '';
  $('log').innerHTML = view.log.map((l) => `<li class="${l.kind}">Day ${l.day}: ${esc(l.text)}</li>`).join('');
  const e = view.events, banner = $('banner');
  if (e.attackDay) { banner.className = 'banner danger'; banner.textContent = `Smoke over Dragon peak. The dragon may attack on day ${e.attackDay}. Readiness ${view.readiness}%.`; banner.hidden = false; }
  else if (e.drought > 0) { banner.className = 'banner warn'; banner.textContent = 'Drought: wheat harvests are halved.'; banner.hidden = false; }
  else banner.hidden = true;
}

function render() {
  renderMap($('map'), world, view, selected);
  renderChrome();
  renderPanel();
}

// ---------- actions ----------

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

async function act(type, extra = {}) {
  if (!playerId) return toast('Join the village first.', true);
  const body = { player: playerId, type, ...extra };
  if (type === 'sell') body.qty = Math.min(5, view.player.inv[extra.good] || 0);
  const r = await post('/api/action', body);
  if (r.state) { view = r.state; render(); }
  toast(r.ok ? r.message : r.error, !r.ok);
}

$('map').addEventListener('click', (e) => {
  const g = e.target.closest('.bld');
  if (!g) return;
  selected = g.dataset.id;
  render();
});
$('map').addEventListener('keydown', (e) => {
  const g = e.target.closest('.bld');
  if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selected = g.dataset.id; render(); }
});
$('panel').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const a = btn.dataset.act;
  if (a === 'gather') act('gather', { spot: selected });
  else act(a, { npc: selected, good: btn.dataset.good, qty: 1 });
});

// ---------- joining ----------

function showJoin() {
  $('paths').innerHTML = Object.entries(world.paths).map(([k, p]) =>
    `<div class="path${k === pathChoice ? ' on' : ''}" data-path="${k}" tabindex="0" role="radio" aria-checked="${k === pathChoice}"><b>${p.name}</b>${p.coins} EMWK${Object.keys(p.items).length ? ' + ' + Object.keys(p.items).map(goodName).join(', ') : ''}</div>`).join('');
  $('join').hidden = false;
}
$('paths').addEventListener('click', (e) => {
  const d = e.target.closest('.path');
  if (!d) return;
  pathChoice = d.dataset.path;
  showJoin();
});
$('join-name').addEventListener('input', () => { $('join-error').textContent = ''; });
$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('join-name').value.trim();
  if (!name) { $('join-error').textContent = 'Enter a name first.'; return; }
  const r = await post('/api/join', { name, path: pathChoice });
  if (!r.ok) { $('join-error').textContent = r.error; return; }
  playerId = r.id;
  store.set(playerId);
  $('join').hidden = true;
  connect();
});

// ---------- live connection ----------

let source;
function connect() {
  if (source) source.close();
  source = new EventSource('/api/stream' + (playerId ? `?player=${playerId}` : ''));
  source.onmessage = (m) => {
    view = JSON.parse(m.data);
    if (playerId && !view.player) { playerId = null; showJoin(); }
    render();
  };
}

(async function start() {
  world = await (await fetch('/api/world')).json();
  playerId = store.get();
  view = await (await fetch('/api/state' + (playerId ? `?player=${playerId}` : ''))).json();
  if (!view.player) { playerId = null; showJoin(); }
  render();
  connect();
})();
