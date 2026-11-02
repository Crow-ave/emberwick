import { setupMap, renderMap, buildGrid, entranceOf, findPath, cellCenter, person } from './iso.js';

const $ = (id) => document.getElementById(id);
let world, view, playerId = null, pathChoice = 'farmer';
const ui = { selected: null, hover: null, target: null, showAll: false };

const store = {
  get() { try { return localStorage.getItem('emberwick-player'); } catch { return null; } },
  set(v) { try { localStorage.setItem('emberwick-player', v); } catch { /* storage unavailable */ } },
};

const PATH_LOOK = {
  farmer: { color: '#5e9a38', hair: '#8a5a2a', label: 'Farmer' },
  miner: { color: '#6b6f7a', hair: '#2a2a2a', label: 'Miner' },
  woodcutter: { color: '#a0522d', hair: '#5a3a22', label: 'Woodcutter' },
  apprentice: { color: '#3a6ec0', hair: '#c98a3a', label: 'Apprentice' },
};
const CARRY = { wheat: '#e8c83c', ore: '#7a7a80', wood: '#8a5a3a' };
const PATH_GOOD = { farmer: 'wheat', miner: 'ore', woodcutter: 'wood', apprentice: 'wood' };

function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
}

const goodName = (g) => (world.goods[g] ? world.goods[g].name : g);
const placeName = (id) => (world.buildings.find((b) => b.id === id) || {}).name || id;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function spark(series) {
  if (!series || series.length < 2) return '';
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const d = series.map((v, k) => `${(k / (series.length - 1)) * 80},${18 - ((v - min) / span) * 16}`).join(' ');
  const up = series[series.length - 1] >= series[0];
  return `<svg class="spark" viewBox="0 0 80 20"><polyline points="${d}" fill="none" stroke="${up ? '#b23a2e' : '#3d7a34'}" stroke-width="1.5"/></svg>`;
}

// ---------- walking villagers ----------

const walkers = [];
let you = null;
const fx = []; // floating "+4 Wheat" texts

function popup(placeId, text, color) {
  const b = world.buildings.find((x) => x.id === placeId);
  if (!b) return;
  const [x, y] = cellCenter(b.i + (b.w - 1) / 2, b.j + (b.w - 1) / 2);
  fx.push({ x, y: y - 40, text, color, t0: performance.now() });
}

function makeWalker(look, route, startCell) {
  return { look, route, idx: 0, cell: startCell, path: [], prog: 0, wait: Math.random() * 3, carry: null };
}

function setupWalkers() {
  walkers.length = 0;
  const homes = ['house-1', 'house-2', 'house-3', 'inn'];
  const shopFor = { farmer: 'mill', miner: 'smithy', woodcutter: 'woodcutter' };
  const spotFor = { farmer: 'fields', miner: 'mine', woodcutter: 'forest' };
  (view.bots || []).forEach((b, n) => {
    const look = { ...PATH_LOOK[b.path], hair: ['#5a3a22', '#2a2a2a', '#c98a3a', '#8a5a2a'][n % 4] };
    const home = homes[n % homes.length];
    const w = makeWalker(look, [spotFor[b.path], shopFor[b.path], 'market', home], entranceOf(home));
    w.good = PATH_GOOD[b.path];
    w.wait = n * 0.7;
    walkers.push(w);
  });
  for (let k = 0; k < 3; k++) {
    const w = makeWalker({ color: '#7a3b8a', hair: '#3a2a1a' }, ['inn', 'market', 'gate'], entranceOf('gate'));
    w.wait = 2 + k * 4;
    walkers.push(w);
  }
  // the elder waits at the gate
  walkers.push({ look: { color: '#6b5a8a', hair: '#e8e2d6', beard: true }, route: [], cell: entranceOf('gate'), path: [], prog: 0, wait: 1e9, fixed: [-14, -4] });
}

function stepWalker(w, dt) {
  if (w.path.length > 1) {
    w.look.moving = true;
    w.prog += dt * (w === you ? 2.6 : 1.4);
    while (w.prog >= 1 && w.path.length > 1) { w.prog -= 1; w.path.shift(); w.cell = w.path[0]; }
    if (w.path.length <= 1) {
      w.prog = 0; w.path = []; w.look.moving = false; w.wait = 1.5 + Math.random() * 2;
      const done = w.arrived; w.arrived = null;
      if (done) done();
    }
    return;
  }
  w.look.moving = false;
  if (!w.route.length) return;
  if ((w.wait -= dt) > 0) return;
  const dest = w.route[w.idx];
  if (w.good) w.carry = dest === w.route[1] ? CARRY[w.good] : null;
  w.path = findPath(w.cell, entranceOf(dest));
  w.idx = (w.idx + 1) % w.route.length;
}

function walkerPos(w) {
  const [ax, ay] = cellCenter(...w.cell);
  if (w.path.length > 1) {
    const [bx, by] = cellCenter(...w.path[1]);
    return [ax + (bx - ax) * w.prog, ay + (by - ay) * w.prog];
  }
  return w.fixed ? [ax + w.fixed[0], ay + w.fixed[1]] : [ax, ay];
}

let last = performance.now();
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!still) for (const w of walkers) stepWalker(w, dt);
  if (you) stepWalker(you, dt);
  const all = [...walkers, ...(you ? [you] : [])].map((w) => [w, walkerPos(w)]).sort((a, b) => a[1][1] - b[1][1]);
  const t = now / 1000;
  $('map').querySelector('#walkers').innerHTML = all.map(([w, [x, y]]) => person(x, y, w.look, t + (w.cell[0] * 0.3))).join('');
  for (let k = fx.length - 1; k >= 0; k--) if (now - fx[k].t0 > 1800) fx.splice(k, 1);
  $('map').querySelector('#fx').innerHTML = fx.map((f) => {
    const p = (now - f.t0) / 1800;
    return `<text x="${f.x}" y="${f.y - p * 50}" text-anchor="middle" font-size="22" font-weight="bold" fill="${f.color}" stroke="#fffaf2" stroke-width="4" paint-order="stroke" opacity="${1 - p * p}">${f.text}</text>`;
  }).join('');
  requestAnimationFrame(animate);
}

function walkYouTo(id, then) {
  if (!you) { if (then) then(); return; }
  const dest = entranceOf(id);
  if (!dest) return;
  const atDest = you.cell[0] === dest[0] && you.cell[1] === dest[1] && you.path.length <= 1;
  you.path = atDest ? [] : findPath(you.cell, dest);
  you.prog = 0;
  you.arrived = null;
  if (atDest || you.path.length <= 1) { you.path = []; if (then) then(); }
  else you.arrived = then || null;
}

// walk to a place, do the work there, then tell the server
const status = {}; // placeId -> text shown while walking or working
const result = {}; // placeId -> last result card
function goAndDo(placeId, verb, run) {
  status[placeId] = `Walking to the ${placeName(placeId).toLowerCase()}…`;
  renderPanel();
  walkYouTo(placeId, () => {
    if (verb === 'gather' && you && !still) {
      status[placeId] = 'Working…';
      renderPanel();
      const t0 = performance.now();
      const tickWork = () => {
        const k = Math.min(1, (performance.now() - t0) / 1400);
        you.look.work = k;
        if (k < 1) requestAnimationFrame(tickWork);
        else { you.look.work = null; delete status[placeId]; run(); }
      };
      tickWork();
    } else { delete status[placeId]; run(); }
  });
}

// ---------- side panel ----------

function panelCraftsman(b) {
  const n = view.npcs[b.id];
  const me = view.player;
  let h = `<h2>${esc(n.name)}</h2><div class="muted">${esc(b.name)} · purse ${n.wallet} EMWK · AI craftsman</div>`;
  if (n.closed) h += `<p class="closed">Closed for repairs after the dragon attack.</p>`;
  h += `<div class="quote">"${esc(n.line)}"</div>`;
  const buys = Object.entries(n.buys);
  if (buys.length) {
    h += `<h4>Buys from you</h4><table>`;
    for (const [g, p] of buys) {
      const have = me ? me.inv[g] || 0 : 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(you have ${have})</span></td><td class="n">${p} EMWK</td>` +
        `<td class="n"><button class="${have ? 'sellbtn' : ''}" data-act="sell" data-good="${g}" ${!have || n.closed ? 'disabled' : ''}>${have ? `Sell all ${have}` : 'Sell'}</button></td></tr>`;
    }
    h += `</table>`;
  }
  const sells = Object.entries(n.sells);
  if (sells.length) {
    h += `<h4>Sells</h4><table>`;
    for (const [g, p] of sells) {
      const stock = n.stock[g] || 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(${stock} left)</span></td><td class="n">${p} EMWK ${spark(view.history[g])}</td>` +
        `<td class="n"><button data-act="buy" data-good="${g}" ${!me || !stock || n.closed ? 'disabled' : ''}>Buy</button></td></tr>`;
    }
    h += `</table>`;
  }
  h += `<p class="muted" style="font-size:12px">Prices move with supply and demand. Haggling and apprentice jobs arrive in the next update.</p>`;
  return h;
}

const GATHER_INFO = {
  forest: ['wood', 2, 'Chop wood here. An axe gives +2 per trip.'],
  fields: ['wheat', 2, 'Harvest wheat here. A plow gives +2. Droughts halve the harvest.'],
  mine: ['ore', 3, 'Dig iron ore here. A pickaxe gives +2.'],
};

function buyersOf(good) {
  return Object.values(view.npcs).filter((n) => n.buys[good] !== undefined).sort((a, b) => b.buys[good] - a.buys[good]);
}

function panelGather(b) {
  const [good, energy, text] = GATHER_INFO[b.id];
  const me = view.player;
  const best = buyersOf(good)[0];
  return `<h2>${esc(b.name)}</h2><p>${text}</p><p class="muted">Costs ${energy} energy.${me ? ` You have ${Math.floor(me.energy)}.` : ''}</p>` +
    (me ? `<p>You carry <b>${me.inv[good] || 0} ${goodName(good).toLowerCase()}</b>.</p>` : '') +
    `<button class="primary big" data-act="gather" ${!me || me.energy < energy ? 'disabled' : ''}>${{ wood: 'Chop wood', wheat: 'Harvest wheat', ore: 'Dig ore' }[good]} (${energy} energy)</button>` +
    (me && me.energy < energy ? `<p class="closed" style="font-size:13px">You are tired. Energy comes back by itself in a minute.</p>` : '') +
    (best ? `<p style="font-size:13px;margin-top:14px">Best price right now: <b>${best.name}</b> pays <b>${best.buys[good]} EMWK</b>.</p><button data-go="${best.id}">Go to ${esc(placeName(best.id))}</button>` : '');
}

function panelMarket() {
  let h = `<h2>Market</h2><p class="muted">Average prices across the village.</p><table>`;
  for (const g of Object.keys(world.goods)) {
    const s = view.history[g];
    if (!s || !s.length) continue;
    h += `<tr><td>${goodName(g)}</td><td class="n">${Math.round(s[s.length - 1])} EMWK</td><td class="n">${spark(s)}</td></tr>`;
  }
  return h + `</table><p class="muted" style="font-size:12px">Red line: getting more expensive. Green: getting cheaper. Every sale pays a 3% tax to the village treasury.</p>`;
}

function panelDragon() {
  const e = view.events;
  const warn = e.attackDay ? `<p class="closed">The dragon may attack on day ${e.attackDay}.</p>` : `<p>The peak is quiet for now.</p>`;
  return `<h2>Dragon peak</h2>${warn}<p>Village readiness: <b>${view.readiness}%</b>.</p><p>At 60% or more the guards drive the dragon back and every villager is rewarded. Below that, part of the village burns.</p>` +
    `<p class="muted" style="font-size:13px">Readiness grows with swords and bread in the guard tower. Bring ore to the smith so he can forge swords, and wheat to the miller so the baker can bake.</p>`;
}

function panelSimple(b) {
  const texts = {
    treasury: `<h2>Treasury</h2><p>The village's shared purse: <b>${view.treasury} EMWK</b>.</p><p class="muted">It collects market tax and profit tax from rich shops, and pays the guard captain and dragon rewards. Nobody can take money out on their own. Spending will be decided by council votes.</p>`,
    council: `<h2>Council hall</h2><p>Villagers who rent a home will propose and vote on taxes, building projects and the defence budget here.</p><p class="muted">Opens in the next update.</p>`,
    gate: `<h2>Village gate</h2><p>Elder Rowan greets newcomers here, and travellers arrive to spend their coin at the inn.</p><button class="primary" data-act="elder">Talk to Elder Rowan</button><p class="muted">Population: ${view.population}</p>`,
    expansion: `<h2>Expansion land</h2><p>Reserved for future neighbourhoods and new shops. New buildings will go here without moving anything that exists today.</p>`,
  };
  if (texts[b.id]) return texts[b.id];
  if (b.type === 'house') return `<h2>${esc(b.name)}</h2><p>A home in Emberwick. Renting with a deposit, and the council vote that comes with living here, open in the next update.</p>`;
  return `<h2>${esc(b.name)}</h2>`;
}

function renderPanel() {
  const b = world.buildings.find((x) => x.id === ui.selected);
  const panel = $('panel');
  if (!b) { panel.hidden = true; return; }
  let h;
  if (b.type === 'craftsman') h = panelCraftsman(b);
  else if (b.type === 'gather') h = panelGather(b);
  else if (b.id === 'market') h = panelMarket();
  else if (b.id === 'dragonpeak') h = panelDragon();
  else h = panelSimple(b);
  let top = '';
  if (status[b.id]) top = `<div class="status">${esc(status[b.id])}</div>`;
  else if (result[b.id]) {
    const r = result[b.id];
    top = `<div class="result"><b>Done!</b> ${esc(r.text)}${r.next ? `<button class="primary next" data-go="${r.next.go}">${esc(r.next.label)} →</button>` : ''}</div>`;
  }
  panel.innerHTML = `<button class="close" data-act="close" aria-label="Close">×</button>` + top + h;
  panel.hidden = false;
}

// ---------- character card and goal ----------

function avatarSvg(path) {
  const look = PATH_LOOK[path] || PATH_LOOK.farmer;
  return `<svg class="avatar" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="22" fill="#f3e8d6"/><rect x="11" y="27" width="24" height="19" rx="8" fill="${look.color}"/><circle cx="23" cy="19" r="9" fill="#f0c8a0"/><path d="M14 18 Q23 6 32 18 Z" fill="${look.hair}"/><circle cx="19.5" cy="20" r="1.2" fill="#2a2a2a"/><circle cx="26.5" cy="20" r="1.2" fill="#2a2a2a"/></svg>`;
}

function renderHud() {
  const me = view.player;
  if (!me) { $('me').innerHTML = `<p class="muted" style="margin:0">Join the village to play.</p>`; $('quest').hidden = true; return; }
  const look = PATH_LOOK[me.path];
  const bag = Object.entries(me.inv).map(([g, q]) => `<span class="chip">${goodName(g)} × ${q}</span>`).join('') || '<span class="muted">Your bag is empty.</span>';
  $('me').innerHTML = `<div class="me-row">${avatarSvg(me.path)}<div><h3>${esc(me.name)}</h3><div class="sub">${look.label} · ${me.rank}</div></div></div>` +
    `<div class="coins">${me.coins.toFixed(0)} EMWK</div>` +
    `<div class="energy">Energy <div class="bar"><div class="fill" style="width:${me.energy * 10}%"></div></div>${Math.floor(me.energy)}/10</div>` +
    `<div class="bag">${bag}</div>`;
  const q = me.questInfo;
  ui.target = q.target;
  const prog = q.progress ? `<div class="prog"><div style="width:${Math.min(100, (q.progress[0] / q.progress[1]) * 100)}%"></div></div><div class="reward" style="margin:-4px 0 8px">${Math.min(q.progress[0], q.progress[1])} / ${q.progress[1]}</div>` : '';
  $('quest').innerHTML = `<div class="step">${q.id === 'done' ? 'All goals done' : `Goal ${q.index + 1} of ${q.total}`}</div><h4>${esc(q.title)}</h4><p>${esc(q.text)}</p>${prog}` +
    (q.target ? `<button class="primary" data-go="${q.target}">Show me</button>` : '') +
    (q.reward ? ` <span class="reward">Reward: ${q.reward} EMWK</span>` : '');
  $('quest').hidden = false;
}

function renderChrome() {
  $('day').textContent = `Day ${view.day}${view.events.winter ? ' · Winter' : ''}${view.dayProgress > 0.8 ? ' · Night' : ''}`;
  $('pop').textContent = `${view.population} villagers · Treasury ${view.treasury} EMWK`;
  $('ready-fill').style.width = view.readiness + '%';
  $('ready-num').textContent = view.readiness + '%';
  $('log').innerHTML = view.log.map((l) => `<li class="${l.kind}">Day ${l.day}: ${esc(l.text)}</li>`).join('');
  const e = view.events, banner = $('banner');
  if (e.attackDay) { banner.className = 'banner danger'; banner.textContent = `Smoke over Dragon peak! The dragon may attack on day ${e.attackDay}. Readiness is ${view.readiness}%: the guards need swords and bread.`; banner.hidden = false; }
  else if (e.drought > 0) { banner.className = 'banner warn'; banner.textContent = 'Drought: wheat harvests are halved and bread is getting expensive.'; banner.hidden = false; }
  else banner.hidden = true;
}

function renderMapNow() { renderMap($('map'), world, view, ui); }
function render() { renderHud(); renderMapNow(); renderChrome(); renderPanel(); }

// ---------- actions ----------

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

async function act(type, extra = {}) {
  if (!playerId) return toast('Join the village first.', 'bad');
  const body = { player: playerId, type, ...extra };
  if (type === 'sell') body.qty = view.player.inv[extra.good] || 0;
  const before = view.player ? view.player.coins : 0;
  const r = await post('/api/action', body);
  if (r.ok && type !== 'visit') explain(type, extra, r, before);
  if (r.state && (r.state.rev || 0) >= (view.rev || 0)) { view = r.state; render(); }
  if (r.quest) toast(`Goal complete: ${r.quest.title}${r.quest.reward ? ` · +${r.quest.reward} EMWK` : ''}`, 'win');
  else if (!r.ok) toast(r.error, 'bad');
}

function bestBuyer(good) {
  return Object.values(view.npcs).filter((n) => n.buys[good] !== undefined && !n.closed).sort((a, b) => b.buys[good] - a.buys[good])[0];
}

function explain(type, extra, r, before) {
  const place = type === 'gather' ? extra.spot : extra.npc;
  if (type === 'gather') {
    popup(place, `+${r.got} ${goodName(r.good)}`, '#3d7a34');
    flash('bag');
    const best = bestBuyer(r.good), have = view.player ? view.player.inv[r.good] || 0 : r.got;
    result[place] = {
      text: `You gathered ${r.got} ${goodName(r.good).toLowerCase()}. You now carry ${have}.`,
      next: best ? { label: `Sell it at the ${placeName(best.id).toLowerCase()} (${best.buys[r.good]} EMWK each)`, go: best.id } : null,
    };
  } else if (type === 'sell') {
    const got = Math.round((r.total - r.tax) * 100) / 100;
    popup(place, `+${got.toFixed(0)} EMWK`, '#a8461a');
    flash('coins');
    result[place] = {
      text: `Sold for ${r.total} EMWK (${r.unit} each). Village tax: ${r.tax}. You received ${got} EMWK.`,
      next: view.player && view.player.questInfo.target && view.player.questInfo.target !== place ? { label: `Next: ${view.player.questInfo.text}`, go: view.player.questInfo.target } : null,
    };
  } else if (type === 'buy') {
    popup(place, `+1 ${goodName(extra.good)}`, '#3a5fa0');
    flash('bag');
    result[place] = { text: `You bought 1 ${goodName(extra.good).toLowerCase()} for ${r.total} EMWK.` };
  }
  renderPanel();
}

function flash(what) {
  const el = what === 'coins' ? document.querySelector('#me .coins') : document.querySelector('#me .bag');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function select(id) {
  ui.selected = id;
  walkYouTo(id);
  render();
  if (playerId && id === ui.target && id !== 'gate') act('visit', { place: id });
}

function elderText() {
  const me = view.player;
  const route = world.routes[me ? me.path : 'farmer'];
  return `Welcome to Emberwick, ${esc(me ? me.name : 'friend')}. The embers are lit again, but this village is still weak. ` +
    `Your work starts at the ${placeName(route.spot).toLowerCase()}. Gather there, then sell to the ${placeName(route.shop).toLowerCase()}. ` +
    `Every sale feeds the craftsmen, and a little tax goes to our treasury. Keep an eye on Dragon peak: when smoke rises, the guards need swords and bread, and fast.`;
}
function openElder() { $('elder-text').innerHTML = elderText(); $('elder').hidden = false; }
$('elder-ok').addEventListener('click', () => {
  $('elder').hidden = true;
  if (playerId) act('visit', { place: 'gate' });
});

$('map').addEventListener('click', (e) => {
  const g = e.target.closest('.bld');
  if (g) select(g.dataset.id);
});
$('map').addEventListener('keydown', (e) => {
  const g = e.target.closest('.bld');
  if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.dataset.id); }
});
$('map').addEventListener('mousemove', (e) => {
  const g = e.target.closest('.bld');
  const id = g ? g.dataset.id : null;
  if (id !== ui.hover) { ui.hover = id; renderMapNow(); $('hint').hidden = true; }
});
document.body.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { select(go.dataset.go); if (go.dataset.go === 'gate' && view.player && view.player.questInfo.id === 'meet') openElder(); return; }
  const btn = e.target.closest('#panel button[data-act]');
  if (!btn) return;
  const a = btn.dataset.act;
  if (a === 'close') { ui.selected = null; renderMapNow(); renderPanel(); }
  else if (a === 'elder') openElder();
  else if (a === 'gather') { const spot = ui.selected; delete result[spot]; goAndDo(spot, 'gather', () => act('gather', { spot })); }
  else { const npc = ui.selected, good = btn.dataset.good; delete result[npc]; goAndDo(npc, a, () => act(a, { npc, good, qty: 1 })); }
});

// ---------- joining ----------

const PATH_BLURB = {
  farmer: 'Grows wheat for the miller.',
  miner: 'Digs ore for the smith.',
  woodcutter: 'Chops wood for the village.',
  apprentice: 'No tools, more coins. Learns any trade.',
};
function showJoin() {
  $('paths').innerHTML = Object.entries(world.paths).map(([k, p]) =>
    `<div class="path${k === pathChoice ? ' on' : ''}" data-path="${k}" tabindex="0" role="radio" aria-checked="${k === pathChoice}"><b>${p.name}</b>${PATH_BLURB[k]}<br><span class="muted">${p.coins} EMWK${Object.keys(p.items).length ? ' + ' + Object.keys(p.items).map(goodName).join(', ') : ''}</span></div>`).join('');
  $('join').hidden = false;
}
$('paths').addEventListener('click', (e) => {
  const d = e.target.closest('.path');
  if (d) { pathChoice = d.dataset.path; showJoin(); }
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
  view = await (await fetch(`/api/state?player=${playerId}`)).json();
  makeYou();
  render();
  connect();
  select('gate');
  openElder();
});

function makeYou() {
  const me = view.player;
  if (!me) { you = null; return; }
  you = { look: { ...PATH_LOOK[me.path], name: me.name, you: true }, route: [], cell: entranceOf('gate'), path: [], prog: 0, wait: 0 };
}

// ---------- live connection ----------

let source;
function connect() {
  if (source) source.close();
  source = new EventSource('/api/stream' + (playerId ? `?player=${playerId}` : ''));
  source.onmessage = (m) => {
    const next = JSON.parse(m.data);
    if ((next.rev || 0) < (view.rev || 0)) return; // an older update arrived late
    view = next;
    if (playerId && !view.player) { playerId = null; you = null; showJoin(); }
    render();
  };
}

(async function start() {
  world = await (await fetch('/api/world')).json();
  buildGrid(world.buildings);
  setupMap($('map'));
  playerId = store.get();
  view = await (await fetch('/api/state' + (playerId ? `?player=${playerId}` : ''))).json();
  if (!view.player) { playerId = null; showJoin(); } else makeYou();
  setupWalkers();
  render();
  connect();
  requestAnimationFrame(animate);
})();
