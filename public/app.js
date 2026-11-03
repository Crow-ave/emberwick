import { setupMap, renderMap, buildGrid, entranceOf, findPath, cellCenter, person, workCellOf, isOpenArea, hereBadge, speech } from './iso.js';
import { t, LANGS, getLang, setLang } from './i18n.js';
import { sceneMarkup, hasScene, SW, SH } from './scenes.js';

const $ = (id) => document.getElementById(id);
let world, view, playerId = null, pathChoice = 'farmer';
const ui = { selected: null, hover: null, target: null, scene: null, nameOf: (id) => t('b.' + id) };

const store = {
  get() { try { return localStorage.getItem('emberwick-player'); } catch { return null; } },
  set(v) { try { localStorage.setItem('emberwick-player', v); } catch { /* storage unavailable */ } },
};

const PATH_LOOK = {
  farmer: { color: '#5e9a38', hair: '#8a5a2a' },
  miner: { color: '#6b6f7a', hair: '#2a2a2a' },
  woodcutter: { color: '#a0522d', hair: '#5a3a22' },
  apprentice: { color: '#3a6ec0', hair: '#c98a3a' },
};
const CARRY = { wheat: '#e8c83c', ore: '#7a7a80', wood: '#8a5a3a' };
const PATH_GOOD = { farmer: 'wheat', miner: 'ore', woodcutter: 'wood', apprentice: 'wood' };
const SPOT_GOOD = { fields: 'wheat', forest: 'wood', mine: 'ore' };
const SPOT_COST = { fields: 2, forest: 2, mine: 3 };

// ---------- text helpers ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const goodName = (g) => t('g.' + g);
// goods inside a sentence: lower case, except German where nouns keep their capital
const goodWord = (g) => (getLang() === 'de' ? goodName(g) : goodName(g).toLocaleLowerCase(getLang()));
const placeName = (id) => t('b.' + id);
const npcName = (id) => t('npc.' + id);
const errText = (r) => (r.code ? t(r.code) : r.error);
// params that must follow the current language are stored as ids and resolved when drawn
function resolve(p = {}) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (v && v.$place) out[k] = placeName(v.$place);
    else if (v && v.$npc) out[k] = npcName(v.$npc);
    else if (v && v.$good) out[k] = goodWord(v.$good);
    else if (v && v.$quest) out[k] = view.player ? questTexts(view.player.questInfo).text : '';
    else out[k] = v;
  }
  return out;
}

function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3000);
}

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

function popupYou(text, color) {
  if (ui.scene) sceneFx.push({ x: SW / 2, y: 230, text, color, t0: performance.now() });
  if (!you) return;
  const [x, y] = walkerPos(you);
  fx.push({ x, y: y - 50, text, color, t0: performance.now() });
}
const sceneFx = [];
function popup(placeId, text, color) {
  if (ui.scene === placeId) sceneFx.push({ x: SW / 2 + 40, y: 260, text, color, t0: performance.now() });
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
    w.name = b.name; w.role = b.path; w.k = n;
    walkers.push(w);
  });
  const travellers = ['Sir Odo', 'Mira', 'Old Tam'];
  for (let k = 0; k < 3; k++) {
    const w = makeWalker({ color: '#7a3b8a', hair: '#3a2a1a' }, ['inn', 'market', 'gate'], entranceOf('gate'));
    w.wait = 2 + k * 4;
    w.name = travellers[k]; w.role = 'traveller'; w.k = k;
    walkers.push(w);
  }
  // the elder waits at the gate
  walkers.push({ look: { color: '#6b5a8a', hair: '#e8e2d6', beard: true }, route: [], cell: entranceOf('gate'), path: [], prog: 0, wait: 1e9, fixed: [-14, -4], name: 'Rowan', role: 'elder' });
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
  if ((w.wait -= dt) > 0) {
    if (w.atWork) w.look.work = Math.min(1, 1 - w.wait / 3);
    return;
  }
  w.look.work = null; w.atWork = false; w.inside = null;
  const dest = w.route[w.idx];
  if (w.good) w.carry = dest === w.route[1] ? CARRY[w.good] : null;
  w.path = findPath(w.cell, workCellOf(dest, (w.k || 0) * 3 + 1));
  w.dest = dest;
  w.idx = (w.idx + 1) % w.route.length;
  w.arrived = () => {
    if (isOpenArea(w.dest)) { if (w.dest !== 'gate') { w.atWork = true; w.wait = 3; } }
    else { w.inside = w.dest; w.wait = 2 + Math.random() * 3; }
  };
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
  const everyone = [...walkers, ...(you ? [you] : [])];
  const visible = everyone.filter((w) => !w.inside).map((w) => [w, walkerPos(w)]).sort((a, b) => a[1][1] - b[1][1]);
  const sec = now / 1000;
  $('map').querySelector('#walkers').innerHTML = visible.map(([w, [x, y]]) => person(x, y, w.look, sec + (w.cell[0] * 0.3))).join('');
  let over = '';
  if (you && you.inside) {
    const b = world.buildings.find((x) => x.id === you.inside);
    if (b) {
      const [bx, by] = cellCenter(b.i + (b.w - 1) / 2, b.j + (b.w - 1) / 2);
      over += hereBadge(bx, by - (b.w > 1 ? 70 : 62), esc(`${you.look.name}: ${t('ui.youHere')}`));
    }
  }
  for (const [w, [x, y]] of visible) if (w.say && w.say.until > now) over += speech(x, y - 12, t(w.say.key, w.say.p));
  for (let k = fx.length - 1; k >= 0; k--) if (now - fx[k].t0 > 1800) fx.splice(k, 1);
  over += fx.map((f) => {
    const p = (now - f.t0) / 1800;
    return `<text x="${f.x}" y="${f.y - p * 50}" text-anchor="middle" font-size="22" font-weight="bold" fill="${f.color}" stroke="#fffaf2" stroke-width="4" paint-order="stroke" opacity="${1 - p * p}">${esc(f.text)}</text>`;
  }).join('');
  $('map').querySelector('#fx').innerHTML = over;
  if (ui.scene) {
    const sc = $('scene');
    sc.classList.toggle('is-working', !!(you && you.look.work != null));
    for (let k = sceneFx.length - 1; k >= 0; k--) if (now - sceneFx[k].t0 > 2000) sceneFx.splice(k, 1);
    const dyn = sc.querySelector('#scene-fx');
    if (dyn) dyn.innerHTML = sceneFx.map((f) => {
      const p = (now - f.t0) / 2000;
      return `<text x="${f.x}" y="${f.y - p * 70}" text-anchor="middle" font-size="40" font-weight="bold" fill="${f.color}" stroke="#fffaf2" stroke-width="7" paint-order="stroke" opacity="${1 - p * p}">${esc(f.text)}</text>`;
    }).join('');
    const bar = $('scene-prog');
    if (bar) bar.style.width = (you && you.look.work != null ? you.look.work * 100 : 0) + '%';
  }
  requestAnimationFrame(animate);
}

function walkYouTo(id, then) {
  if (!you) { if (then) then(); return; }
  const dest = workCellOf(id, 4);
  if (!dest) return;
  const enter = () => {
    you.inside = isOpenArea(id) ? null : id;
    if (hasScene(id, view) && ui.selected === id) openScene(id);
    renderPanel();
    if (then) then();
  };
  const atDest = you.cell[0] === dest[0] && you.cell[1] === dest[1] && you.path.length <= 1;
  if (atDest) { you.path = []; enter(); return; }
  you.inside = null;
  you.path = findPath(you.cell, dest);
  you.prog = 0;
  if (you.path.length <= 1) { you.path = []; enter(); }
  else you.arrived = enter;
}

// walk to a place, do the work there, then tell the server
const status = {}; // placeId -> { key, p } shown while walking or working
const result = {}; // placeId -> last result card { key, p, next }
function goAndDo(placeId, verb, run) {
  status[placeId] = { key: 'status.walking', p: { place: { $place: placeId } } };
  renderPanel();
  walkYouTo(placeId, () => {
    if ((verb === 'gather' || verb === 'shift') && you && !still) {
      status[placeId] = { key: 'status.working' };
      renderPanel();
      renderScene();
      const t0 = performance.now();
      const tickWork = () => {
        const k = Math.min(1, (performance.now() - t0) / 1400);
        you.look.work = k;
        if (k < 1) requestAnimationFrame(tickWork);
        else { you.look.work = null; delete status[placeId]; renderScene(); run(); }
      };
      tickWork();
    } else { delete status[placeId]; run(); }
  });
}

// ---------- close-up scenes ----------

let sceneKey = null;
function openScene(id) { ui.scene = id; sceneKey = null; renderScene(); }
function closeScene() { ui.scene = null; sceneKey = null; renderScene(); renderMapNow(); }

// the info bar sits right under the scene, however tall the side panel gets
function placeSceneBar() {
  const sc = $('scene'), bar = $('scene-bar');
  if (sc.hasAttribute('hidden')) return;
  bar.style.top = sc.getBoundingClientRect().bottom - $('scene').closest('.stage').getBoundingClientRect().top + 10 + 'px';
  bar.style.bottom = 'auto';
}
addEventListener('resize', placeSceneBar);

function renderScene() {
  const sc = $('scene'), mini = $('mini'), bar = $('scene-bar');
  const id = ui.scene;
  // svg elements have no .hidden property, so toggle the attribute itself
  const show = (el, on) => (on ? el.removeAttribute('hidden') : el.setAttribute('hidden', ''));
  if (!id || !view) { show(sc, false); show(mini, false); show(bar, false); show($('map'), true); return; }
  show($('map'), false); show(sc, true); show(mini, true); show(bar, true); $('hint').hidden = true;
  mini.innerHTML = `<span>${t('scene.back')}</span>`;
  mini.setAttribute('aria-label', t('scene.back'));
  const n = view.npcs[id];
  const key = [id, getLang(), n ? JSON.stringify(n.stock) + n.closed : '', view.events.drought, view.events.winter].join('|');
  if (key !== sceneKey) {
    sceneKey = key;
    sc.setAttribute('viewBox', `0 0 ${SW} ${SH}`);
    sc.setAttribute('aria-label', placeName(id));
    const look = you ? you.look : PATH_LOOK.farmer;
    sc.innerHTML = `<g>${sceneMarkup(id, view, look)}</g><g id="scene-fx"></g>`;
  }
  const me = view.player;
  if (SPOT_GOOD[id]) {
    const cost = me ? me.costs[id] : SPOT_COST[id];
    const working = status[id] && status[id].key === 'status.working';
    bar.innerHTML = `<div class="info"><b>${esc(placeName(id))}</b>${working ? esc(t('scene.working', { name: me ? me.name : '' })) : t('scene.ready')}<div class="prog"><div id="scene-prog"></div></div></div>` +
      `<button class="primary" data-act="gather" data-spot="${id}" ${!me || me.energy < cost || working || me.job || !(me.inv[TOOL_OF[SPOT_GOOD[id]]] > 0) ? 'disabled' : ''}>${t('scene.again', { n: cost })}</button>`;
  } else if (n) {
    bar.innerHTML = `<div class="info"><b>${esc(placeName(id))} · ${esc(npcName(id))}</b><span class="quote">"${esc(t('line.' + n.lineKey))}"</span><div class="muted" style="font-size:12px;margin-top:4px">${t('scene.tradeHint')}</div></div>`;
  }
  placeSceneBar();
}
$('mini').addEventListener('click', () => closeScene());

// ---------- side panel ----------

function bestBuyer(good) {
  return Object.values(view.npcs).filter((n) => n.buys[good] !== undefined && !n.closed && !(n.full || []).includes(good)).sort((a, b) => b.buys[good] - a.buys[good])[0];
}

function panelCraftsman(b) {
  const n = view.npcs[b.id];
  const me = view.player;
  let h = `<h2>${esc(npcName(b.id))}</h2><div class="muted">${esc(t('panel.purse', { place: placeName(b.id), n: n.wallet }))}</div>`;
  if (n.closed) h += `<p class="closed">${t('panel.closed')}</p>`;
  h += `<div class="quote">"${esc(t('line.' + n.lineKey))}"</div>`;
  h += jobSection(b.id);
  if (chainOk()) h += `<p class="small">${exLink('address/' + view.chain.accounts.npcs[b.id], t('near.view') + ' · ' + esc(view.chain.accounts.npcs[b.id]))}</p>`;
  if (b.id === 'inn') {
    const full = me && me.energy >= me.maxEnergy;
    h += `<button class="primary big" data-act="meal" ${!me || n.closed || full ? 'disabled' : ''}>${t('panel.meal', { p: n.sells.meal })}</button>` +
      `<p class="muted" style="font-size:12px">${full ? t('panel.full') : t('panel.mealsReady', { n: n.stock.meal || 0 })}</p>`;
  }
  if (b.id === 'bakery') h += `<p style="font-size:13px">${t('panel.breadHint')}</p>`;
  const buys = Object.entries(n.buys);
  if (buys.length) {
    h += `<h4>${t('panel.buysFromYou')}</h4><table>`;
    for (const [g, p] of buys) {
      const have = me ? me.inv[g] || 0 : 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(${t('panel.youHave', { n: have })})</span></td><td class="n">${p} EMWK</td>` +
        ((n.full || []).includes(g) ? `<td class="n"><span class="muted small">${t('panel.full')}</span></td></tr>`
          : `<td class="n"><button class="${have ? 'sellbtn' : ''}" data-act="sell" data-good="${g}" ${!have || n.closed ? 'disabled' : ''}>${have ? t('panel.sellAll', { n: have }) : t('panel.sell')}</button></td></tr>`);
    }
    h += `</table>`;
  }
  const sells = Object.entries(n.sells).filter(([g]) => g !== 'meal');
  if (sells.length) {
    h += `<h4>${t('panel.sells')}</h4><table>`;
    for (const [g, p] of sells) {
      const stock = n.stock[g] || 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(${t('panel.left', { n: stock })})</span></td><td class="n">${p} EMWK</td>` +
        `<td class="n"><button data-act="buy" data-good="${g}" ${!me || !stock || n.closed ? 'disabled' : ''}>${t('panel.buy')}</button></td></tr>`;
    }
    h += `</table>`;
  }
  return h + `<p class="muted" style="font-size:12px">${t('panel.pricesNote')}</p>`;
}

function tiredHelp(me) {
  const opts = [];
  if ((me.inv.bread || 0) > 0) opts.push(`<button class="primary" data-eat="1">${t('tired.eat')}</button>`);
  else opts.push(`<button data-go="bakery">${t('tired.buyBread', { p: view.npcs.bakery.sells.bread })}</button>`);
  opts.push(`<button data-go="inn">${t('tired.meal', { p: view.npcs.inn.sells.meal })}</button>`);
  return `<div class="tired">${t('tired.body')}${opts.map((o) => `<div>${o}</div>`).join('')}</div>`;
}

function panelGather(b) {
  const me = view.player;
  const good = SPOT_GOOD[b.id], energy = me ? me.costs[b.id] : SPOT_COST[b.id];
  const best = bestBuyer(good);
  return `<h2>${esc(placeName(b.id))}</h2><p>${t('gather.' + b.id)}</p><p class="muted">${t('gather.cost', { n: energy })}${me ? ' ' + t('gather.youHave', { n: Math.floor(me.energy) }) : ''}</p>` +
    (me ? `<p>${t('gather.carry', { n: me.inv[good] || 0, good: goodWord(good) })}</p>` : '') +
    (me && !me.job && !(me.inv[TOOL_OF[good]] > 0) ? `<div class="contract"><p class="small">${t('gather.needTool', { tool: goodWord(TOOL_OF[good]), place: placeName(TOOL_SHOP[TOOL_OF[good]]), p: view.npcs[TOOL_SHOP[TOOL_OF[good]]].sells[TOOL_OF[good]] })}</p><button data-go="${TOOL_SHOP[TOOL_OF[good]]}">${esc(t('go.to', { place: placeName(TOOL_SHOP[TOOL_OF[good]]) }))}</button> <button data-board="1">${t('hud.board', { n: view.jobOffers.length })}</button></div>` :
    me && me.job ? `<div class="contract"><p class="small">${t('job.blocked', { place: placeName(me.job.npc) })}</p><button data-go="${me.job.npc}">${esc(t('go.to', { place: placeName(me.job.npc) }))}</button></div>` :
    `<button class="primary big" data-act="gather" ${!me || me.energy < energy ? 'disabled' : ''}>${t('gather.btn.' + good, { n: energy })}</button>` +
    (me && me.energy < energy ? tiredHelp(me) : '')) +
    (best ? `<p style="font-size:13px;margin-top:14px">${t('gather.best', { name: esc(npcName(best.id)), p: best.buys[good] })}</p><button data-go="${best.id}">${esc(t('go.to', { place: placeName(best.id) }))}</button>` : '');
}

function panelMarket() {
  let h = `<h2>${t('market.title')}</h2><p class="muted">${t('market.sub')}</p><table>`;
  for (const g of Object.keys(world.goods)) {
    const s = view.history[g];
    if (!s || !s.length) continue;
    h += `<tr><td>${goodName(g)}</td><td class="n">${Math.round(s[s.length - 1])} EMWK</td><td class="n">${spark(s)}</td></tr>`;
  }
  return h + `</table><p class="muted" style="font-size:12px">${t('market.note')}</p>` + boardSection();
}

function panelDragon() {
  const e = view.events;
  const warn = e.attackDay ? `<p class="closed">${t('dragon.warn', { day: e.attackDay })}</p>` : `<p>${t('dragon.quiet')}</p>`;
  return `<h2>${placeName('dragonpeak')}</h2>${warn}<p>${t('dragon.ready', { n: view.readiness })}</p><p>${t('dragon.rule')}</p>` +
    `<p class="muted" style="font-size:13px">${t('dragon.tip')}</p>`;
}

function panelSimple(b) {
  const title = `<h2>${esc(placeName(b.id))}</h2>`;
  if (b.id === 'treasury') return title + `<p>${t('treasury.text', { n: view.treasury })}</p><p class="muted">${t('treasury.note')}</p>`;
  if (b.id === 'council') return panelCouncil();
  if (b.id === 'gate') return title + `<p>${t('gate.text')}</p><button class="primary" data-act="elder">${t('gate.talk')}</button><p class="muted">${t('gate.pop', { n: view.population })}</p>`;
  if (b.id === 'expansion') return title + `<p>${t('expansion.text')}</p>`;
  if (b.type === 'house') return panelHouse(b);
  return title;
}

// ---------- talking to villagers ----------

const ROLE_SHOP = { farmer: 'mill', miner: 'smithy', woodcutter: 'woodcutter', traveller: 'inn' };

function lineFor(w) {
  const e = view.events, npcs = view.npcs;
  const opts = {
    farmer: [['talk.farmer.0', { p: npcs.mill.buys.wheat }], [e.drought ? 'talk.farmer.1d' : 'talk.farmer.1'], ['talk.farmer.2']],
    miner: [['talk.miner.0', { p: npcs.smithy.buys.ore }], [e.attackDay ? 'talk.miner.1d' : 'talk.miner.1'], ['talk.miner.2']],
    woodcutter: [['talk.woodcutter.0', { p: npcs.woodcutter.buys.wood }], [e.winter ? 'talk.woodcutter.1d' : 'talk.woodcutter.1'], ['talk.woodcutter.2']],
    traveller: [['talk.traveller.0'], ['talk.traveller.1', { p: npcs.inn.sells.meal }], ['talk.traveller.2']],
  }[w.role] || [['talk.traveller.0']];
  w.talkN = ((w.talkN || 0) + 1) % opts.length;
  const [key, p = {}] = opts[w.talkN];
  return { key, p };
}

function talk(w) {
  if (w.role === 'elder') { openElder(); return; }
  const line = lineFor(w);
  w.say = { ...line, until: performance.now() + 5000 };
  ui.selected = 'talk';
  ui.talk = { name: w.name, role: w.role, line, go: ROLE_SHOP[w.role] };
  renderMapNow();
  renderPanel();
}

function panelTalk() {
  const tk = ui.talk;
  return `<h2>${esc(tk.name)}</h2><div class="muted">${t('role.' + tk.role)}</div><div class="quote">"${esc(t(tk.line.key, tk.line.p))}"</div>` +
    (tk.go ? `<button data-go="${tk.go}">${esc(t('go.to', { place: placeName(tk.go) }))}</button>` : '') +
    `<p class="muted" style="font-size:12px;margin-top:12px">${t('talk.note')}</p>`;
}

// ---------- "what should I do now?" ----------

function questTexts(q) {
  const p = { spot: placeName(q.spot), shop: placeName(q.job || q.shop) };
  if (q.job) return { title: t(`quest.${q.id}.title`), text: t(`quest.${q.id}.jobText`, p) };
  if (q.findJob) return { title: t(`quest.${q.id}.title`), text: t('quest.findJob') };
  return { title: t(`quest.${q.id}.title`), text: t(`quest.${q.id}.text`, p) };
}

function panelGuide() {
  const me = view.player;
  if (!me) return `<h2>${t('guide.title')}</h2><p>${t('guide.join')}</p>`;
  const route = world.routes[me.path];
  const steps = [];
  const carried = ['wheat', 'wood', 'ore'].filter((g) => (me.inv[g] || 0) > 0);
  if (carried.length) {
    for (const g of carried) {
      const best = bestBuyer(g);
      if (best) steps.push({ text: t('guide.carry', { n: me.inv[g], good: goodWord(g), name: esc(npcName(best.id)), place: placeName(best.id), p: best.buys[g] }), go: best.id, label: t('go.to', { place: placeName(best.id) }) });
    }
  }
  const j = me.job;
  if (j) {
    // apprentices work only at their shop
    const shop = placeName(j.npc);
    if (j.shiftToday) steps.push({ text: t('guide.jobDone', { place: shop }) + (me.home ? ' ' + t('guide.sleepHome', { place: placeName(me.home.id) }) : ''), go: me.home ? me.home.id : null, label: me.home ? t('go.to', { place: placeName(me.home.id) }) : '' });
    else if (me.energy >= j.energy) steps.push({ text: t('guide.jobShift', { place: shop, n: j.wage, a: j.shiftsToday, b: j.maxShifts }), go: j.npc, label: t('go.to', { place: shop }) });
    else if (me.home && !me.home.restedToday) steps.push({ text: t('guide.tiredHome', { place: placeName(me.home.id) }), go: me.home.id, label: t('go.to', { place: placeName(me.home.id) }) });
    else if ((me.inv.bread || 0) > 0) steps.push({ text: t('guide.tiredBread', { n: Math.floor(me.energy) }), eat: true });
    else steps.push({ text: t('guide.tiredNoBread', { n: Math.floor(me.energy), bread: view.npcs.bakery.sells.bread, meal: view.npcs.inn.sells.meal }), go: 'bakery', label: t('go.to', { place: placeName('bakery') }) });
  } else if (carried.length) {
    // already suggested selling above
  } else if (!(me.inv[TOOL_OF[SPOT_GOOD[route.spot]]] > 0)) {
    const tool = TOOL_OF[SPOT_GOOD[route.spot]], shop = TOOL_SHOP[tool];
    steps.push({ text: t('guide.noTool', { tool: goodWord(tool), place: placeName(shop), p: view.npcs[shop].sells[tool], n: view.jobOffers.length }), go: 'market', label: t('hud.board', { n: view.jobOffers.length }) });
  } else if (me.energy >= me.costs[route.spot]) {
    steps.push({ text: t('guide.empty', { place: placeName(route.spot) }), go: route.spot, label: t('go.to', { place: placeName(route.spot) }) });
  } else if ((me.inv.bread || 0) > 0) {
    steps.push({ text: t('guide.tiredBread', { n: Math.floor(me.energy) }), eat: true });
  } else {
    steps.push({ text: t('guide.tiredNoBread', { n: Math.floor(me.energy), bread: view.npcs.bakery.sells.bread, meal: view.npcs.inn.sells.meal }), go: 'bakery', label: t('go.to', { place: placeName('bakery') }) });
  }
  const q = me.questInfo;
  if (q.target && q.id !== 'done') {
    const qt = questTexts(q);
    steps.push({ text: t('guide.goal', { title: esc(qt.title), text: esc(qt.text) }), go: q.target, label: t('quest.showMe') });
  }
  if (view.events.attackDay) steps.push({ text: t('guide.dragon', { day: view.events.attackDay, today: view.day, ready: view.readiness }), go: 'dragonpeak', label: t('guide.seePeak') });
  return `<h2>${t('guide.title')}</h2><p class="muted" style="font-size:13px;margin-top:2px">${t('guide.sentence')}</p>` +
    `<ol class="guide">${steps.map((st) => `<li>${st.text}${st.go ? `<br><button class="primary" data-go="${st.go}">${esc(st.label)} →</button>` : ''}${st.eat ? `<br><button class="primary" data-eat="1">${t('guide.eat')}</button>` : ''}</li>`).join('')}</ol>`;
}

const closeBtn = () => `<button class="close" data-act="close" aria-label="${t('ui.close')}">×</button>`;

function renderPanel() {
  const panel = $('panel');
  const typing = document.activeElement && panel.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (typing) return; // keep what the player is typing
  if (ui.selected === 'near') { panel.innerHTML = closeBtn() + panelNear(); panel.hidden = false; return; }
  if (ui.selected === 'board') { panel.innerHTML = closeBtn() + boardSection(); panel.hidden = false; return; }
  if (ui.selected === 'talk' && ui.talk) { panel.innerHTML = closeBtn() + panelTalk(); panel.hidden = false; return; }
  if (ui.selected === 'guide') { panel.innerHTML = closeBtn() + panelGuide(); panel.hidden = false; return; }
  const b = world.buildings.find((x) => x.id === ui.selected);
  if (!b) { panel.innerHTML = panelGuide(); panel.hidden = false; return; }
  let h;
  if (b.type === 'craftsman') h = panelCraftsman(b);
  else if (b.type === 'gather') h = panelGather(b);
  else if (b.id === 'market') h = panelMarket();
  else if (b.id === 'dragonpeak') h = panelDragon();
  else h = panelSimple(b);
  let top = '';
  if (status[b.id]) top = `<div class="status">${esc(t(status[b.id].key, resolve(status[b.id].p)))}</div>`;
  else if (result[b.id]) {
    const r = result[b.id];
    const next = r.next ? t(r.next.key, resolve(r.next.p)) : null;
    top = `<div class="result${r.bad ? ' bad' : ''}"><b>${t(r.bad ? 'result.no' : 'result.done')}</b> ${esc(t(r.key, resolve(r.p)))}${next ? `<button class="primary next" data-go="${r.next.go}">${esc(next)} →</button>` : ''}</div>`;
  } else if (you && you.inside === b.id) top = `<div class="status">${esc(t('status.here', { place: placeName(b.id) }))}</div>`;
  panel.innerHTML = closeBtn() + top + h;
  panel.hidden = false;
}



// ---------- jobs and homes ----------

// where the signed contract is on NEAR (once the signing transfer has been sent)
function contractLine(j) {
  if (!j.contractId) return '';
  let link = '';
  const c = view.chain;
  if (c && c.feed) for (const f of c.feed) if (f.ok && f.hash && f.items.some((it) => it.contract === j.contractId)) link = exLink('txns/' + f.hash, t('job.contractTx'));
  return `<p class="small">${t('job.contract', { n: j.contractId })} ${link || (chainOk() ? `<span class="muted">${t('job.contractWait')}</span>` : '')}</p>`;
}

function jobSection(npc) {
  const me = view.player;
  const j = me && me.job;
  if (j && j.npc === npc) {
    return `<div class="contract"><b>${t('job.mine')}</b><div class="muted small">${t('job.status', { n: j.wage, days: j.daysLeft })} · ${t('job.today', { a: j.shiftsToday, b: j.maxShifts })}</div>` +
      (j.shiftToday ? `<p class="small">${t('job.shiftDone')}</p>`
        : `<button class="primary big" data-act="shift" ${me.energy < j.energy ? 'disabled' : ''}>${t('job.shift', { e: j.energy, n: j.wage })}</button>` + (me.energy < j.energy ? tiredHelp(me) : '')) +
      `<p class="muted small">${t('job.severance', { n: j.wage })} ${t('job.quitNote', { n: j.wage })}</p>` + contractLine(j) + `<button class="linkbtn" data-act="quitJob">${t('job.quit')}</button></div>`;
  }
  const o = view.jobOffers.find((x) => x.npc === npc);
  if (!o) return '';
  let req = `<p class="small">${t('job.noReq')}</p>`;
  if (o.require) {
    const have = me ? me.skills[o.require.skill].level : 1, ok = have >= o.require.level;
    req = `<p class="small ${ok ? 'ok' : 'bad'}">${t('job.req', { skill: t('skill.' + o.require.skill), n: o.require.level, have })}</p>`;
  }
  return `<div class="contract offer"><b>${t('job.offerTitle')}</b><p class="small">${t('job.offer', { n: o.wage, days: o.days, e: 3 })}</p>${req}<p class="small">${t('job.exclusive')}</p>` +
    (j ? `<p class="muted small">${t('job.haveOther', { place: placeName(j.npc) })}</p>` : `<button class="primary" data-act="takeJob" ${me ? '' : 'disabled'}>${t('job.apply')}</button>`) +
    `<p class="muted small">${t('job.severance', { n: o.wage })} ${t('job.quitNote', { n: o.wage })}</p></div>`;
}

function panelHouse(b) {
  const h = view.houses[b.id], me = view.player;
  let x = `<h2>${esc(placeName(b.id))}</h2><p class="muted">${t('house.rentInfo', { r: h.rent, d: h.deposit })}</p>` +
    `<p>${h.rest >= 99 ? t('house.restFull') : t('house.restInfo', { n: h.rest })}</p>`;
  if (h.mine) {
    const rested = me.home && me.home.restedToday;
    x += `<div class="contract"><b>${t('house.yours')}</b>` +
      (rested ? `<p class="small">${t('house.rested')}</p>` : `<button class="primary big" data-act="rest">${h.rest >= 99 ? t('house.restFullBtn') : t('house.rest', { n: h.rest })}</button>`) +
      `<button class="linkbtn" data-act="leaveHouse">${t('house.leave', { n: h.deposit })}</button></div>`;
  } else if (h.tenant) x += `<p class="muted">${t('house.taken', { name: esc(h.tenant) })}</p>`;
  else if (me && me.home) x += `<p class="muted small">${t('house.haveOther', { place: placeName(me.home.id) })}</p>`;
  else x += `<p class="ok">${t('house.free')}</p><button class="primary" data-act="rentHouse" ${!me || me.coins < h.rent + h.deposit ? 'disabled' : ''}>${t('house.rent', { n: h.rent + h.deposit })}</button>`;
  return x + `<p class="muted small">${t('house.note')}</p>`;
}

function boardSection() {
  const me = view.player;
  let h = `<h3 class="board-h">${t('board.title')}</h3><p class="sub2">${t('board.jobs')}</p>`;
  h += view.jobOffers.length ? view.jobOffers.map((o) => `<div class="trow"><span>${esc(t('board.jobRow', { place: placeName(o.npc), n: o.wage, days: o.days }))}</span><button data-go="${o.npc}">${t('board.go')}</button></div>`).join('')
    : `<p class="muted small">${t('board.noJobs')}</p>`;
  if (me && me.job) h += `<div class="trow"><span><b>${esc(t('me.job', { place: placeName(me.job.npc), days: me.job.daysLeft }))}</b></span><button data-go="${me.job.npc}">${t('board.go')}</button></div>`;
  h += `<p class="sub2">${t('board.homes')}</p>` + Object.entries(view.houses).map(([id, x]) =>
    `<div class="trow"><span>${esc(t('board.homeRow', { place: placeName(id), r: x.rent }))} · <span class="${x.tenant ? 'muted' : 'ok'}">${x.mine ? t('board.yours') : x.tenant ? esc(x.tenant) : t('house.free')}</span></span><button data-go="${id}">${t('board.go')}</button></div>`).join('');
  return h;
}


// ---------- the village council ----------

function proposalText(x) {
  const p = x.params;
  if (x.kind === 'grant') return t('prop.grant', { n: p.amount, name: npcName(p.npc) });
  if (x.kind === 'tax') return t('prop.tax', { n: Math.round(p.rate * 100) });
  if (x.kind === 'welcome') return t('prop.welcome', { n: p.amount });
  if (x.kind === 'festival') return t('prop.festival', { n: p.amount });
  return x.kind;
}
const voterLabel = (who) => (who.startsWith('npc:') ? npcName(who.slice(4)) : who);
const byLabel = (x) => (x.by.startsWith('npc:') ? npcName(x.by.slice(4)) : x.by === 'player:' + playerId ? t('near.you') : x.byName);

function panelCouncil() {
  const c = view.council, me = view.player;
  let h = `<h2>${t('b.council')}</h2><p class="muted small">${t('council.intro', { tax: Math.round(c.taxRate * 100), t: view.treasury, r: c.reserve })}</p>`;
  if (c.myWeight) {
    const w = c.myWeight;
    h += `<div class="contract"><b>${t('council.myWeight', { n: w.total })}</b><div class="muted small">${t('council.weightParts', { a: w.wealth, b: w.residency, c: w.contribution })}</div></div>`;
  }
  h += `<p class="sub2">${t('council.open')}</p>`;
  h += c.open.length ? c.open.map((x) => {
    const total = x.yes + x.no || 1;
    const mine = x.myVote === null ? (me ? `<div class="row"><button class="primary" data-act="vote" data-id="${x.id}" data-yes="1">${t('council.yes')}</button><button data-act="vote" data-id="${x.id}" data-yes="0">${t('council.no')}</button></div>` : '')
      : `<p class="small ok">${x.myVote ? t('council.youYes') : t('council.youNo')}</p>`;
    return `<div class="prop"><b>#${x.id} ${esc(proposalText(x))}</b><div class="muted small">${t('council.by', { name: esc(byLabel(x)) })} · ${t('council.left', { n: Math.max(1, Math.ceil((x.left * world.rules.ticksPerDay * world.rules.tickMs) / 60000)) })}</div>` +
      `<div class="votebar"><div class="y" style="width:${(x.yes / total) * 100}%"></div></div>` +
      `<div class="small">${t('council.tally', { y: Math.round(x.yes), n: Math.round(x.no), v: x.voters })}</div>` +
      (x.list.length ? `<details${ui.openWho === x.id ? ' open' : ''} data-who="${x.id}"><summary class="small">${t('council.who')}</summary><ul class="voters">${x.list.map((v) => `<li class="${v.yes ? 'ok' : 'bad'}"><b>${v.me ? t('near.you') : esc(voterLabel(v.who))}</b>: ${v.yes ? t('council.yesShort') : t('council.noShort')} (${v.w})${v.why ? ` <span class="muted">· ${t('why.' + v.why)}</span>` : ''}</li>`).join('')}</ul></details>` : '') +
      mine + `</div>`;
  }).join('') : `<p class="muted small">${t('council.none')}</p>`;

  if (me) {
    const r = c.rules;
    h += `<p class="sub2">${t('council.new')}</p><div class="propform">` +
      `<select id="prop-kind">${r.kinds.map((k) => `<option value="${k}"${ui.propKind === k ? ' selected' : ''}>${t('prop.kind.' + k)}</option>`).join('')}</select>`;
    const k = ui.propKind || 'grant';
    if (k === 'grant') h += `<select id="prop-npc">${Object.keys(view.npcs).map((id) => `<option value="${id}">${esc(npcName(id))}</option>`).join('')}</select><input id="prop-amount" type="number" min="${r.grant.min}" max="${r.grant.max}" value="150">`;
    if (k === 'tax') h += `<input id="prop-rate" type="number" min="${r.tax.min * 100}" max="${r.tax.max * 100}" step="1" value="${Math.round(c.taxRate * 100)}"> %`;
    if (k === 'welcome') h += `<input id="prop-amount" type="number" min="${r.welcome.min}" max="${r.welcome.max}" value="200">`;
    if (k === 'festival') h += `<input id="prop-amount" type="number" min="${r.festival.min}" max="${r.festival.max}" value="4">`;
    h += `<p class="muted small">${t('prop.help.' + k)}</p><button class="primary" data-act="propose" ${c.open.length >= r.maxOpen ? 'disabled' : ''}>${t('council.submit', { n: r.fee })}</button></div>`;
    if (c.open.length >= r.maxOpen) h += `<p class="muted small">${t('council.full')}</p>`;
  }

  if (c.closed.length) {
    h += `<p class="sub2">${t('council.closed')}</p><ul class="decided">${c.closed.map((x) => `<li><span class="res ${x.result}">${t('council.res.' + x.result)}</span> #${x.id} ${esc(proposalText(x))} <span class="muted small">(${t('council.tally', { y: Math.round(x.yes), n: Math.round(x.no), v: x.voters })})</span></li>`).join('')}</ul>`;
  }
  return h + `<p class="muted small">${t('council.rule', { q: c.rules.quorum })}</p>`;
}

async function councilAct(type, extra) {
  const r = await post('/api/action', { player: playerId, type, ...extra });
  if (r.state && (r.state.rev || 0) >= (view.rev || 0)) { view = r.state; render(); }
  if (r.ok) toast(type === 'vote' ? t('toast.voted', { n: r.weight }) : t('toast.proposed', { n: r.id }), 'win');
  else toast(errText(r), 'bad');
}

// ---------- NEAR ----------

const chainOk = () => view.chain && view.chain.status === 'ready';
const shortId = (id) => (id && id.length > 48 ? id.slice(0, 12) + '…' + id.slice(-8) : id);
function chainName(id) {
  const a = view.chain && view.chain.accounts;
  if (!a) return shortId(id);
  if (id === a.bank) return t('near.bank');
  if (id === a.treasury) return placeName('treasury');
  if (a.deposits && id === a.deposits) return t('near.h.deposits');
  for (const [npc, acct] of Object.entries(a.npcs)) if (acct === id) return npcName(npc);
  return shortId(id);
}
const exLink = (path, text, cls = 'near-link') => `<a class="${cls}" href="${view.chain.explorer}/${path}" target="_blank" rel="noopener">${text}</a>`;
function timeAgo(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? s + 's' : Math.round(s / 60) + 'm';
}


// who sent what, in the game's own words (falls back to NEAR account names)
function holderName(h, serverName) {
  if (!h) return serverName;
  if (h.startsWith('npc:')) return npcName(h.slice(4));
  if (h === 'treasury') return placeName('treasury');
  if (h.startsWith('player:') && view.player && h.slice(7) === view.player.id) return t('near.you');
  if (['newcomerFund', 'adventurerFund', 'botFund', 'deposits'].includes(h)) return t('near.h.' + h);
  return serverName;
}
function feedList(list, mineOnly) {
  return `<ul class="near-feed">${list.map((f) => {
    const items = f.items.filter((it) => !mineOnly || it.player === playerId).map((it) => {
      const isMine = it.player && it.player === playerId;
      const route = it.who ? `${esc(holderName(it.who.from, it.who.fromName))} → ${esc(holderName(it.who.to, it.who.toName))}`
        : `${esc(chainName(f.from))} → ${esc(chainName(it.to))}${it.n > 1 ? ` <span class="muted">(${t('near.trades', { n: it.n })})</span>` : ''}`;
      const sync = it.label === 'balance sync' ? ` <span class="muted">(${t('near.sync')})</span>` : '';
      return `<span class="${isMine ? 'mine' : ''}">${route} <b>${it.amount} EMWK</b>${sync}</span>`;
    }).join('<br>');
    const link = f.hash ? exLink('txns/' + f.hash, t('near.tx')) : '';
    return `<li class="${f.ok ? '' : 'bad'}"><span class="muted small">${timeAgo(f.at)}</span> ${items} ${f.ok ? link : `<span class="bad small">${t('near.failed')}</span>`}</li>`;
  }).join('')}</ul>`;
}

function panelNear() {
  const c = view.chain || { status: 'off' };
  const me = view.player;
  let h = `<h2>${t('near.title')}</h2><p class="muted small">${t('near.intro')}</p>`;
  const st = c.status;
  if (st === 'setup') h += `<div class="status">${t('near.st.setup', { step: t('near.step.' + ((c.detail && c.detail.step) || 'root')) })}</div>`;
  else if (st === 'need-funds') {
    h += `<div class="near-box warn"><p>${t('near.st.need-funds', { n: c.detail.amount })}</p>` +
      `<code class="addr">${esc(c.detail.address)}</code>` +
      `<div class="row"><button data-act="near-copy" data-copy="${esc(c.detail.address)}">${t('near.copy')}</button>` +
      `<a class="btnlink" href="${c.wallet}" target="_blank" rel="noopener">${t('near.openWallet')}</a></div></div>`;
  } else if (st === 'ready') h += `<div class="status live">${t('near.st.ready', { n: c.txCount })}</div>`;
  else h += `<div class="status">${t('near.st.' + (st in { off: 1, starting: 1, error: 1 } ? st : 'starting'))}</div>`;

  if (c.accounts && st === 'ready') {
    const a = c.accounts, bal = c.balances || {};
    const row = (id) => `<tr><td>${esc(chainName(id))}<br>${exLink('address/' + id, esc(shortId(id)), 'near-link small')}</td><td class="n">${bal[id] !== undefined ? Math.round(bal[id]) + ' EMWK' : ''}</td></tr>`;
    const mine = c.feed.filter((f) => f.items.some((it) => it.player && it.player === playerId));
    h += `<p class="sub2">${t('near.mine')}</p><p class="muted small">${t('near.mineNote')}</p>`;
    h += mine.length ? feedList(mine, true) : `<p class="muted small">${t('near.mineNone')}</p>`;
    h += `<p class="sub2">${t('near.feed')}${c.pending ? ` <span class="muted small">· ${t('near.pending', { n: c.pending })}</span>` : ''}</p>`;
    h += c.feed.length ? feedList(c.feed.slice(0, 15), false) : `<p class="muted small">${t('near.noFeed')}</p>`;
    h += `<p class="sub2">${t('near.token')}</p><p>${exLink('token/' + a.token, esc(a.token))}</p>`;
    h += `<p class="sub2">${t('near.accounts')}</p><table class="near-acc">${[a.bank, a.treasury, a.deposits, ...Object.values(a.npcs)].filter(Boolean).map(row).join('')}</table>`;
  }

  h += `<p class="sub2">${t('near.wallet')}</p>`;
  if (!me) h += `<p class="muted small">${t('near.joinFirst')}</p>`;
  else if (me.near) {
    h += `<p>${t('near.linked', { id: '' })}${c.explorer ? exLink('address/' + me.near, esc(me.near)) : esc(me.near)}</p>`;
    h += `<p class="muted small">${t('near.cashHelp', { n: me.coins })}</p>`;
    if (me.withdrawn) h += `<p class="muted small">${t('near.withdrawn', { n: me.withdrawn })}</p>`;
    h += chainOk()
      ? `<div class="row"><input id="near-amount" type="number" min="1" step="1" max="${Math.floor(me.coins)}" value="${Math.min(10, Math.floor(me.coins))}"><button class="primary" data-act="near-withdraw" ${me.coins < 1 ? 'disabled' : ''}>${t('near.cashout')}</button></div>`
      : `<p class="muted small">${t('near.needReady')}</p>`;
  } else {
    h += `<p class="muted small">${t('near.orType')}</p><div class="row"><input id="near-account" placeholder="name.testnet" autocomplete="off" spellcheck="false"><button class="primary" data-act="near-link">${t('near.link')}</button></div>`;
  }
  return h;
}

async function nearLink(account) {
  const r = await post('/api/near/link', { player: playerId, account });
  if (r.state) { view = r.state; render(); }
  if (r.ok) toast(t('toast.linked', { id: r.near }), 'win'); else toast(errText(r), 'bad');
}
async function nearWithdraw(amount) {
  const r = await post('/api/near/withdraw', { player: playerId, amount });
  if (r.state) { view = r.state; render(); }
  if (r.ok) toast(t('toast.withdrew', { n: r.amount, id: r.wallet }), 'win'); else toast(errText(r), 'bad');
}
function renderNearPill() {
  const c = view.chain || { status: 'off' };
  const pill = $('near-pill');
  pill.className = 'near-pill st-' + c.status;
  $('near-text').textContent = t('near.pill.' + c.status);
}

// ---------- character card and goal ----------

function avatarSvg(path) {
  const look = PATH_LOOK[path] || PATH_LOOK.farmer;
  return `<svg class="avatar" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="22" fill="#f3e8d6"/><rect x="11" y="27" width="24" height="19" rx="8" fill="${look.color}"/><circle cx="23" cy="19" r="9" fill="#f0c8a0"/><path d="M14 18 Q23 6 32 18 Z" fill="${look.hair}"/><circle cx="19.5" cy="20" r="1.2" fill="#2a2a2a"/><circle cx="26.5" cy="20" r="1.2" fill="#2a2a2a"/></svg>`;
}

function renderHud() {
  const me = view.player;
  if (!me) { $('me').innerHTML = `<p class="muted" style="margin:0">${t('me.join')}</p>`; $('quest').hidden = true; return; }
  $('me').innerHTML = `<div class="me-row">${avatarSvg(me.path)}<div><h3>${esc(me.name)}</h3><div class="sub">${t('path.' + me.path)} · ${t('rank.' + String(me.rank).toLowerCase())}</div></div></div>` +
    `<div class="coins">${me.coins.toFixed(0)} EMWK</div>` +
    `<div class="energy" id="energy-row">${t('me.energy')} <div class="bar"><div class="fill" style="width:${(me.energy / me.maxEnergy) * 100}%"></div></div>${Math.floor(me.energy)}/${me.maxEnergy}</div>` +
    `<div class="shortcuts"><button class="chip strong" data-board="1">${t('hud.board', { n: view.jobOffers.length })}</button><button class="chip strong" data-go="council">${t('hud.council', { n: view.council.open.length })}</button></div>` +
    (me.job || me.home ? `<div class="contracts">${me.job ? `<button class="chip" data-go="${me.job.npc}">${esc(t('me.job', { place: placeName(me.job.npc), days: me.job.daysLeft }))}</button>` : ''}${me.home ? `<button class="chip" data-go="${me.home.id}">${esc(t('me.home', { place: placeName(me.home.id) }))}</button>` : ''}</div>` : '');
  const q = me.questInfo;
  ui.target = q.target;
  const qt = questTexts(q);
  const prog = q.progress ? `<div class="prog"><div style="width:${Math.min(100, (q.progress[0] / q.progress[1]) * 100)}%"></div></div><div class="reward" style="margin:-4px 0 8px">${Math.min(q.progress[0], q.progress[1])} / ${q.progress[1]}</div>` : '';
  $('quest').innerHTML = `<div class="step">${q.id === 'done' ? t('quest.allDone') : t('quest.step', { n: q.index + 1, total: q.total })}</div><h4>${esc(qt.title)}</h4><p>${esc(qt.text)}</p>${prog}` +
    (q.target ? `<button class="primary" data-go="${q.target}">${t('quest.showMe')}</button>` : '') +
    (q.reward ? ` <span class="reward">${t('quest.reward', { n: q.reward })}</span>` : '') +
    `<button class="helpbtn" data-guide="1">${t('quest.help')}</button>`;
  $('quest').hidden = false;
}

// ---------- the bottom panel: bag, wealth, skills, this shop ----------

const TOOL_SHOP = { pickaxe: 'smithy', axe: 'woodcutter', plow: 'mill' };
const TOOL_OF = { ore: 'pickaxe', wood: 'axe', wheat: 'plow' };

function goodValue(g) {
  const b = bestBuyer(g);
  if (b) return b.buys[g];
  const s = view.history[g];
  return s && s.length ? Math.round(s[s.length - 1] * 0.6) : 0;
}

function renderDock() {
  const me = view.player;
  const dock = $('dock');
  if (!me) { dock.hidden = true; return; }
  dock.hidden = false;
  // bag
  let goodsValue = 0;
  const rows = Object.entries(me.inv).map(([g, q]) => {
    const v = goodValue(g);
    goodsValue += v * q;
    const tool = world.goods[g] && world.goods[g].kind === 'tool' && TOOL_SHOP[g];
    const left = tool ? me.toolUses - ((me.wear || {})[g] || 0) : null;
    return `<tr><td><b>${goodName(g)}</b> × ${q}` +
      (tool ? `<div class="wear"><div style="width:${(left / me.toolUses) * 100}%"></div></div><span class="muted small">${t('dock.uses', { n: left, max: me.toolUses })}</span>` : '') +
      `</td><td class="n muted small">${v ? t('dock.worth', { p: v }) : ''}</td><td class="n">${v ? t('dock.total', { p: v * q }) : ''}` +
      (g === 'bread' ? ` <button class="eat" data-eat="1">${t('me.eat')}</button>` : '') + `</td></tr>`;
  }).join('');
  const bag = `<div class="dcard bagcard"><h4>${t('dock.bag')}</h4>${rows ? `<table>${rows}</table>` : `<p class="muted small">${t('dock.empty')}</p>`}</div>`;
  // wealth
  const coins = me.coins, total = coins + goodsValue, profit = total - me.startCoins, st = me.stats || {};
  const line = (k, v, cls = '') => `<tr><td>${t(k)}</td><td class="n ${cls}">${v}</td></tr>`;
  const wealth = `<div class="dcard"><h4>${t('dock.wealth')}</h4><table>` +
    line('w.coins', `${coins.toFixed(0)} EMWK`) + line('w.goods', `${goodsValue.toFixed(0)} EMWK`) +
    `<tr class="sum"><td>${t('w.total')}</td><td class="n">${total.toFixed(0)} EMWK</td></tr>` +
    line('w.start', `${me.startCoins} EMWK`) + line('w.profit', `${profit >= 0 ? '+' : ''}${profit.toFixed(0)} EMWK`, profit >= 0 ? 'up' : 'down') +
    line('w.earned', `${(st.earned || 0).toFixed(0)} EMWK`) + line('w.spent', `${(st.spent || 0).toFixed(0)} EMWK`) + line('w.taxes', `${(st.taxes || 0).toFixed(1)} EMWK`) +
    `</table></div>`;
  // skills
  const skillRow = (s) => {
    const k = me.skills[s];
    const pct = k.to ? ((k.xp - k.from) / (k.to - k.from)) * 100 : 100;
    const spot = { farming: 'fields', woodcutting: 'forest', mining: 'mine' }[s];
    const eff = s === 'trading' ? t('skill.tradeEffect', { p: Math.round(me.tradeBonus * 100) }) : t('skill.effect', { n: k.level - 1, e: me.costs[spot] });
    return `<div class="skill"><div class="srow"><b>${t('skill.' + s)}</b><span>${t('skill.level', { n: k.level })}</span></div>` +
      `<div class="xp"><div style="width:${pct}%"></div></div><div class="srow muted small"><span>${eff}</span><span>${k.to ? t('skill.next', { a: k.xp, b: k.to }) : t('skill.max')}</span></div></div>`;
  };
  const skills = `<div class="dcard skills"><h4>${t('dock.skills')}</h4>${['farming', 'woodcutting', 'mining', 'trading'].map(skillRow).join('')}</div>`;
  // this shop
  const b = world.buildings.find((x) => x.id === ui.selected);
  let here = `<div class="dcard"><h4>${t('dock.here')}</h4>`;
  if (b && b.type === 'craftsman') {
    const n = view.npcs[b.id];
    const sellable = Object.keys(n.buys).filter((g) => (me.inv[g] || 0) > 0);
    here += `<div class="muted small">${esc(npcName(b.id))}</div><p class="sub2">${t('here.sell')}</p>` +
      (sellable.length ? sellable.map((g) => `<div class="trow"><span>${goodName(g)} × ${me.inv[g]} · ${n.buys[g]} EMWK</span><button class="sellbtn" data-act="sell" data-npc="${b.id}" data-good="${g}" ${n.closed ? 'disabled' : ''}>${t('panel.sellAll', { n: me.inv[g] })}</button></div>`).join('') : `<p class="muted small">${t('here.nothing')}</p>`);
    const buyable = Object.keys(n.sells).filter((g) => g !== 'meal' && (n.stock[g] || 0) > 0);
    if (buyable.length) here += `<p class="sub2">${t('here.buy')}</p>` + buyable.map((g) => `<div class="trow"><span>${goodName(g)} · ${n.sells[g]} EMWK</span><button data-act="buy" data-npc="${b.id}" data-good="${g}" ${n.closed || me.coins < n.sells[g] ? 'disabled' : ''}>${t('panel.buy')}</button></div>`).join('');
  } else here += `<p class="muted small">${t('here.hint')}</p>`;
  here += `</div>`;
  dock.innerHTML = bag + wealth + skills + here;
}

function logText(l) {
  if (!l.key) return l.text;
  const p = resolve(l.p || {});
  if (p.path) p.path = t('path.' + p.path);
  return t(l.key, p);
}

function renderChrome() {
  $('day').textContent = [t('ui.day', { n: view.day }), view.events.winter ? t('ui.winter') : null, view.dayProgress > 0.8 ? t('ui.night') : null].filter(Boolean).join(' · ');
  $('pop').textContent = t('ui.pop', { n: view.population, t: view.treasury });
  $('ready-fill').style.width = view.readiness + '%';
  $('ready-num').textContent = view.readiness + '%';
  renderNearPill();
  $('log').innerHTML = view.log.map((l) => `<li class="${l.kind}">${t('log.day', { n: l.day })}: ${esc(logText(l))}</li>`).join('');
  const e = view.events, banner = $('banner');
  if (e.attackDay) { banner.className = 'banner danger'; banner.textContent = t('banner.attack', { day: e.attackDay, ready: view.readiness }); banner.hidden = false; }
  else if (e.drought > 0) { banner.className = 'banner warn'; banner.textContent = t('banner.drought'); banner.hidden = false; }
  else banner.hidden = true;
}

function renderMapNow() { ui.closedTag = t('ui.closedTag'); renderMap($('map'), world, view, ui); }
function render() { renderHud(); renderMapNow(); renderChrome(); renderPanel(); renderDock(); renderScene(); }

// ---------- static page text and the language menu ----------

function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('map').setAttribute('aria-label', t('ui.mapLabel'));
  $('lang').setAttribute('aria-label', t('ui.language'));
  $('lang').innerHTML = Object.entries(LANGS).map(([code, d]) => `<option value="${code}"${code === getLang() ? ' selected' : ''}>${d['lang.name']}</option>`).join('');
  document.documentElement.lang = getLang();
}
$('lang').addEventListener('change', (e) => {
  setLang(e.target.value);
  applyStatic();
  if (!$('join').hidden) showJoin();
  if (!$('elder').hidden) openElder();
  render();
});

// ---------- actions ----------

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

async function act(type, extra = {}) {
  if (!playerId) return toast(t('toast.join'), 'bad');
  const body = { player: playerId, type, ...extra };
  if (type === 'sell') body.qty = view.player.inv[extra.good] || 0;
  const r = await post('/api/action', body);
  if (r.state && (r.state.rev || 0) >= (view.rev || 0)) { view = r.state; render(); }
  if (r.ok && type !== 'visit') explain(type, extra, r);
  if (!r.ok && r.code === 'err.turnedDown') {
    const why = r.why === 'needSkill' ? t('apply.needSkill', { skill: t('skill.' + r.need.skill), n: r.need.level, have: r.need.have }) : t('apply.' + r.why);
    result[extra.npc] = { key: 'result.turnedDown', p: { name: { $npc: extra.npc }, why }, bad: true };
    renderPanel();
  }
  if (!r.ok && r.code === 'err.noTool') {
    const shop = TOOL_SHOP[r.tool];
    result[extra.spot] = { key: 'result.noTool', bad: true, p: { tool: { $good: r.tool } }, next: { key: 'go.to', p: { place: { $place: shop } }, go: shop } };
    renderPanel();
  }
  if (r.ok && r.levelUp) {
    const msg = t('toast.level', { skill: t('skill.' + r.levelUp.skill), n: r.levelUp.level });
    popupYou(msg, '#7a3b8a');
    flash('skills');
    setTimeout(() => toast(msg, 'win'), r.quest ? 3200 : 0);
  }
  if (r.ok && r.toolBroke) toast(t('toast.toolBroke', { tool: goodName(r.toolBroke), place: placeName(TOOL_SHOP[r.toolBroke]) }), 'bad');
  if (r.quest) {
    toast(t('toast.goal', { title: t(`quest.${r.quest.id}.title`) }) + (r.quest.reward ? ` · +${r.quest.reward} EMWK` : ''), 'win');
  } else if (!r.ok) toast(errText(r), 'bad');
}

function explain(type, extra, r) {
  const place = type === 'gather' ? extra.spot : extra.npc || extra.house;
  if (type === 'gather') {
    popup(place, `+${r.got} ${goodName(r.good)}`, '#3d7a34');
    flash('bag');
    const best = bestBuyer(r.good), have = view.player ? view.player.inv[r.good] || 0 : r.got;
    result[place] = {
      key: 'result.gathered', p: { n: r.got, good: { $good: r.good }, have },
      next: best ? { key: 'result.sellAt', p: { place: { $place: best.id }, p: best.buys[r.good] }, go: best.id } : null,
    };
  } else if (type === 'sell') {
    const got = Math.round((r.total - r.tax) * 100) / 100;
    popup(place, `+${got.toFixed(0)} EMWK`, '#a8461a');
    flash('coins');
    const q = view.player && view.player.questInfo;
    result[place] = {
      key: 'result.sold', p: { total: r.total, unit: r.unit, tax: r.tax, got },
      next: q && q.target && q.target !== place ? { key: 'result.next', p: { text: { $quest: true } }, go: q.target } : null,
    };
  } else if (type === 'eat' || type === 'meal') {
    popupYou(t('fx.energy', { n: r.energy }), '#b07a12');
    flash('energy');
    if (type === 'meal' && view.player) {
      const spot = world.routes[view.player.path].spot;
      result.inn = { key: 'result.meal', p: { total: r.total }, next: { key: 'go.to', p: { place: { $place: spot } }, go: spot } };
    }
  } else if (type === 'shift') {
    popup(place, `+${r.wage} EMWK`, '#a8461a');
    flash('coins');
    result[place] = r.made ? { key: 'result.shiftMade', p: { n: r.wage, good: { $good: r.made } } } : { key: 'result.shift', p: { n: r.wage } };
  } else if (type === 'takeJob') {
    result[place] = { key: 'result.hiredWhy', p: { name: { $npc: place }, why: t('apply.' + (r.why || 'beginner')) } };
  } else if (type === 'rentHouse') {
    result[extra.house] = { key: 'result.rented', p: { r: r.rent } };
  } else if (type === 'leaveHouse') {
    result[extra.house] = { key: 'result.left', p: { n: r.deposit } };
    popupYou(`+${r.deposit} EMWK`, '#a8461a');
    flash('coins');
    toast(t('result.left', { n: r.deposit }), 'win');
  } else if (type === 'quitJob') {
    toast(t('result.quit', { n: r.fee }), '');
    if (r.fee) { popupYou(`-${r.fee} EMWK`, '#8a2a1a'); flash('coins'); }
  } else if (type === 'rest') {
    popupYou(t('fx.energy', { n: Math.round(r.energy) }), '#b07a12');
    flash('energy');
  } else if (type === 'buy') {
    popup(place, `+1 ${goodName(extra.good)}`, '#3a5fa0');
    flash('bag');
    result[place] = { key: 'result.bought', p: { good: { $good: extra.good }, total: r.total } };
  }
  renderPanel();
}

function flash(what) {
  const el = what === 'coins' ? document.querySelector('#me .coins') : what === 'energy' ? document.querySelector('#energy-row') : what === 'skills' ? document.querySelector('#dock .skills') : document.querySelector('#dock .bagcard');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function select(id) {
  if (ui.scene && ui.scene !== id) { ui.scene = null; sceneKey = null; }
  ui.selected = id;
  walkYouTo(id);
  render();
  if (playerId && id === ui.target && id !== 'gate') act('visit', { place: id });
}

function openElder() {
  const me = view.player;
  const route = world.routes[me ? me.path : 'farmer'];
  $('elder-title').textContent = t('elder.title');
  $('elder-text').textContent = t('elder.text', { name: me ? me.name : '', spot: placeName(route.spot), shop: placeName(route.shop) });
  $('elder-ok').textContent = t('elder.ok');
  $('elder').hidden = false;
}
$('elder-ok').addEventListener('click', async () => {
  $('elder').hidden = true;
  if (playerId) await act('visit', { place: 'gate' });
  ui.selected = 'guide';
  renderMapNow();
  renderPanel();
});

let ignoreClick = false;
$('map').addEventListener('pointerdown', (e) => {
  const svg = $('map');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  let best = null, bestD = 1e9;
  for (const w of walkers) {
    if (w.inside) continue;
    const [x, y] = walkerPos(w);
    const dx = Math.abs(p.x - x), dy = y - p.y;
    if (dx < 13 && dy > -6 && dy < 52 && dx + Math.abs(dy - 24) < bestD) { best = w; bestD = dx + Math.abs(dy - 24); }
  }
  if (best) { ignoreClick = true; talk(best); }
});
$('map').addEventListener('click', (e) => {
  if (ignoreClick) { ignoreClick = false; return; }
  const g = e.target.closest('.bld');
  if (g) select(g.dataset.id);
});
document.addEventListener('toggle', (e) => {
  if (e.target.dataset && e.target.dataset.who) ui.openWho = e.target.open ? Number(e.target.dataset.who) : null;
}, true);
document.addEventListener('change', (e) => {
  if (e.target.id === 'prop-kind') { ui.propKind = e.target.value; e.target.blur(); renderPanel(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.scene) { closeScene(); return; }
  if (e.key === 'Escape' && ui.selected) { ui.selected = null; renderMapNow(); renderPanel(); renderDock(); }
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
  if (e.target.closest('[data-eat]')) { act('eat'); return; }
  if (e.target.closest('[data-guide]')) { ui.selected = 'guide'; renderMapNow(); renderPanel(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { select(go.dataset.go); if (go.dataset.go === 'gate' && view.player && view.player.questInfo.id === 'meet') openElder(); return; }
  if (e.target.closest('[data-board]')) { ui.selected = 'board'; renderMapNow(); renderPanel(); return; }
  if (e.target.closest('#near-pill')) { ui.selected = ui.selected === 'near' ? null : 'near'; renderMapNow(); renderPanel(); return; }
  const btn = e.target.closest('#panel button[data-act], #dock button[data-act], #scene-bar button[data-act]');
  if (!btn) return;
  const a = btn.dataset.act;
  if (a === 'vote') { if (!playerId) return toast(t('toast.join'), 'bad'); goAndDo('council', 'vote', () => councilAct('vote', { id: Number(btn.dataset.id), yes: btn.dataset.yes === '1' })); return; }
  if (a === 'propose') {
    if (!playerId) return toast(t('toast.join'), 'bad');
    const kind = $('prop-kind').value, extra = { kind };
    if ($('prop-npc')) extra.npc = $('prop-npc').value;
    if ($('prop-amount')) extra.amount = Number($('prop-amount').value);
    if ($('prop-rate')) extra.rate = Number($('prop-rate').value) / 100;
    goAndDo('council', 'propose', () => councilAct('propose', extra));
    return;
  }
  if (a.startsWith('near-')) {
    if (a === 'near-copy') navigator.clipboard?.writeText(btn.dataset.copy).then(() => toast(t('toast.copied'), 'win')).catch(() => {});
    else if (!playerId) toast(t('toast.join'), 'bad');
    else if (a === 'near-link') nearLink($('near-account').value);
    else if (a === 'near-withdraw') nearWithdraw($('near-amount').value);
    return;
  }
  if (a === 'close') { ui.selected = null; renderMapNow(); renderPanel(); renderDock(); }
  else if (a === 'elder') openElder();
  else if (a === 'meal') { delete result.inn; goAndDo('inn', 'meal', () => act('meal')); }
  else if (a === 'takeJob' || a === 'shift' || a === 'quitJob') { const npc = btn.dataset.npc || ui.selected; delete result[npc]; goAndDo(npc, a, () => act(a, { npc })); }
  else if (a === 'rentHouse' || a === 'leaveHouse' || a === 'rest') { const house = ui.selected; delete result[house]; goAndDo(house, a, () => act(a, { house })); }
  else if (a === 'gather') { const spot = btn.dataset.spot || ui.selected; delete result[spot]; goAndDo(spot, 'gather', () => act('gather', { spot })); }
  else { const npc = btn.dataset.npc || ui.selected, good = btn.dataset.good; delete result[npc]; goAndDo(npc, a, () => act(a, { npc, good, qty: 1 })); }
});

// ---------- joining ----------

function showJoin() {
  $('paths').innerHTML = Object.entries(world.paths).map(([k, p]) =>
    `<div class="path${k === pathChoice ? ' on' : ''}" data-path="${k}" tabindex="0" role="radio" aria-checked="${k === pathChoice}"><b>${t('path.' + k)}</b>${t('blurb.' + k)}<br><span class="muted">${p.coins} EMWK${Object.keys(p.items).length ? ' + ' + Object.keys(p.items).map(goodName).join(', ') : ''}</span></div>`).join('');
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
  if (!name) { $('join-error').textContent = t('join.errName'); return; }
  const r = await post('/api/join', { name, path: pathChoice });
  if (!r.ok) { $('join-error').textContent = errText(r); return; }
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
  applyStatic();
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
