import { setupMap, renderMap, renderDistrict, buildGrid, entranceOf, findPath, cellCenter, cellAt, isWalkable, person, workCellOf, isOpenArea, hereBadge, speech } from './iso.js';
import { t, LANGS, getLang, setLang } from './i18n.js';
import { play, playWork, unlockSound, setSfx, setMusic, setNight, sound } from './sound.js';
import { sceneMarkup, hasScene, homeHasScene, bubble, KEEPER_HEAD, SW, SH } from './scenes.js';

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
const CARRY = { wheat: '#e8c83c', ore: '#7a7a80', wood: '#8a5a3a', wool: '#f4f1ea', fish: '#5aa0d8' };
const PATH_GOOD = { farmer: 'wheat', miner: 'ore', woodcutter: 'wood', apprentice: 'wood' };
const SPOT_GOOD = { fields: 'wheat', forest: 'wood', mine: 'ore', pasture: 'wool', pond: 'fish' };
const SPOT_COST = { fields: 2, forest: 2, mine: 3, pasture: 2, pond: 2 };

// ---------- text helpers ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const goodName = (g) => t('g.' + g);
// goods inside a sentence: lower case, except German where nouns keep their capital
const goodWord = (g) => (getLang() === 'de' ? goodName(g) : goodName(g).toLocaleLowerCase(getLang()));
const placeName = (id) => {
  const m = /^d(\d)-(\d+)$/.exec(id || ''); // neighbourhood plots: "Ember Lane No. 3", villas get tree names
  if (m && m[1] === '2') return t('villa.' + m[2]);
  return m ? t('plot.street', { street: t('district.' + m[1]), n: m[2] }) : t('b.' + id);
};
const npcName = (id) => t('npc.' + id);
const errText = (r) => (r.code ? t(r.code) : r.error);
// params that must follow the current language are stored as ids and resolved when drawn
function resolve(p = {}) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (v && v.$place) out[k] = placeName(v.$place);
    else if (v && v.$npc) out[k] = npcName(v.$npc);
    else if (v && v.$district) out[k] = t('district.' + v.$district);
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
    const look = { ...PATH_LOOK[b.path], hair: ['#5a3a22', '#2a2a2a', '#c98a3a', '#8a5a2a'][n % 4], scale: 0.82, bot: true };
    const home = homes[n % homes.length];
    const w = makeWalker(look, [spotFor[b.path], shopFor[b.path], 'market', home], entranceOf(home));
    w.good = PATH_GOOD[b.path];
    w.wait = n * 0.7;
    w.name = b.name; w.role = b.path; w.k = n; w.home = home;
    walkers.push(w);
  });
  const travellers = ['Sir Odo', 'Mira', 'Old Tam'];
  for (let k = 0; k < 3; k++) {
    const w = makeWalker({ color: '#7a3b8a', hair: '#3a2a1a', scale: 0.82, bot: true }, ['inn', 'market', 'gate'], entranceOf('gate'));
    w.wait = 2 + k * 4;
    w.name = travellers[k]; w.role = 'traveller'; w.k = k; w.home = 'inn';
    walkers.push(w);
  }
  // the elder waits at the gate
  walkers.push({ look: { color: '#6b5a8a', hair: '#e8e2d6', beard: true, scale: 0.9 }, route: [], cell: entranceOf('gate'), path: [], prog: 0, wait: 1e9, fixed: [-14, -4], name: 'Rowan', role: 'elder' });
}

// other real players: walk to where they last did something
const others = new Map();
function syncOthers() {
  const seen = new Set();
  for (const o of view.others || []) {
    seen.add(o.id);
    let w = others.get(o.id);
    if (!w) {
      w = makeWalker({ ...PATH_LOOK[o.path], name: o.name, other: true, scale: 1 }, [], entranceOf('gate'));
      w.name = o.name; w.role = o.path; w.k = others.size + 5; w.player = true; w.pid = o.id;
      others.set(o.id, w);
    }
    w.name = o.name; w.look.name = o.name; // follows a rename
    if (w.where !== o.where) {
      w.where = o.where;
      const at = /^@(\d+),(\d+)$/.exec(o.where || ''); // a player who walked to a spot of their own
      w.path = findPath(w.cell, at ? [Number(at[1]), Number(at[2])] : workCellOf(o.where, w.k));
      w.prog = 0;
    }
  }
  for (const id of [...others.keys()]) if (!seen.has(id)) others.delete(id);
  if (you && view.player) you.look.name = view.player.name;
}

function stepWalker(w, dt) {
  if (w.hold) { w.look.moving = false; return; } // the mouse is on them: they stop so you can click
  if (w.path.length > 1) {
    w.look.moving = true;
    w.prog += dt * (w === you ? 2.6 : 0.75);
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
  // at night villagers walk home and stay inside until morning
  if (view && view.night && w.home) {
    if (w.inside === w.home) { w.wait = 2; return; }
    w.look.work = null; w.atWork = false; w.inside = null; w.carry = null;
    w.path = findPath(w.cell, entranceOf(w.home)); w.dest = w.home;
    w.arrived = () => { w.inside = w.home; w.wait = 2; };
    if (w.path.length <= 1) { w.path = []; w.inside = w.home; }
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
  for (const w of others.values()) stepWalker(w, dt);
  if (you) stepWalker(you, dt);
  const everyone = [...walkers, ...others.values(), ...(you ? [you] : [])];
  const visible = everyone.filter((w) => !w.inside).map((w) => [w, walkerPos(w)]).sort((a, b) => a[1][1] - b[1][1]);
  const sec = now / 1000;
  if (ui.district) { $('map').querySelector('#walkers').innerHTML = ''; $('map').querySelector('#fx').innerHTML = ''; requestAnimationFrame(animate); return; }
  $('map').querySelector('#walkers').innerHTML = visible.map(([w, [x, y]]) => person(x, y, w.look, sec + (w.cell[0] * 0.3))).join('');
  let over = '';
  if (you && you.inside) {
    const b = world.buildings.find((x) => x.id === you.inside);
    if (b) {
      const [bx, by] = cellCenter(b.i + (b.w - 1) / 2, b.j + (b.w - 1) / 2);
      over += hereBadge(bx, by - (b.w > 1 ? 70 : 62), esc(`${you.look.name}: ${t('ui.youHere')}`));
    }
  }
  if (ui.walkTo && you && !ui.district) { const [mx, my] = cellCenter(ui.walkTo[0], ui.walkTo[1]); over = `<ellipse class="walkmark" cx="${mx}" cy="${my}" rx="16" ry="8"/>` + over; }
  for (const [w, [x, y]] of visible) if (w.say && w.say.until > now) over += speech(x, y - 12, w.say.raw != null ? w.say.raw : t(w.say.key, w.say.p));
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
  if (!dest) { if (then) then(); return; } // neighbourhood plots: no walking on the village map
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
      playWork(placeId);
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
  // the bar now sits at the bottom of the picture area (CSS); only the background changes
  $('view').classList.toggle('scene-on', !$('scene').hasAttribute('hidden'));
}
addEventListener('resize', placeSceneBar);
setInterval(() => { if (view && world) $('day-left').textContent = t('ui.dayLeft', { n: dayLeftText() }); }, 1000);

function renderScene() {
  const sc = $('scene'), mini = $('mini'), bar = $('scene-bar');
  const id = ui.scene;
  // svg elements have no .hidden property, so toggle the attribute itself
  const show = (el, on) => (on ? el.removeAttribute('hidden') : el.setAttribute('hidden', ''));
  if (!id || !view) { if ($('scene-menu')) $('scene-menu').hidden = true; show(sc, false); show(mini, false); show(bar, false); show($('map'), true); $('view').classList.remove('scene-on'); return; }
  show($('map'), false); show(sc, true); show(mini, true); show(bar, true); $('hint').hidden = true;
  mini.innerHTML = `<span>${t('scene.back')}</span>`;
  mini.setAttribute('aria-label', t('scene.back'));
  const n = view.npcs[id];
  const me0 = view.player || {}, pl = view.plots && view.plots[id];
  const key = [id, getLang(), n ? JSON.stringify(n.stock) + n.closed : '', view.events.drought, view.events.winter, !!view.night, me0.sleepPlace, pl ? pl.bed : ''].join('|');
  if (key !== sceneKey) {
    sceneKey = key;
    sc.setAttribute('viewBox', `0 0 ${SW} ${SH}`);
    sc.setAttribute('aria-label', placeName(id));
    const look = you ? you.look : PATH_LOOK.farmer;
    sc.innerHTML = `<g>${sceneMarkup(id, view, look)}</g><g id="scene-talk"></g><g id="scene-fx"></g>`;
  }
  const me = view.player;
  // what the keeper (or you, at home) says right now, in a speech bubble inside the picture
  const bubbles = sceneBubbles(id);
  const talkKey = bubbles.map((b) => b.text).join('|');
  const talkG = sc.querySelector('#scene-talk');
  if (talkG) {
    // a new line appears and fades after a while (a long answer stays a little longer). The scene
    // picture is redrawn when stock changes, so what was said and when lives in ui.bub, not in the drawing
    const b0 = ui.bub && ui.bub.scene === id ? ui.bub : null;
    if (!b0 || b0.key !== talkKey) {
      ui.bub = { scene: id, key: talkKey, gone: false };
      clearTimeout(ui.talkTimer);
      const ttl = Math.min(22000, 7000 + talkKey.length * 60);
      ui.talkTimer = setTimeout(() => { if (ui.bub && ui.bub.key === talkKey) { ui.bub.gone = true; const g = document.querySelector('#scene-talk'); if (g) g.classList.add('gone'); } }, ttl);
    }
    if (talkG.dataset.k !== talkKey) { talkG.dataset.k = talkKey; talkG.innerHTML = bubbles.map((b) => bubble(b.x, b.y, b.text, b.max || 34, b.anchor ?? (b.x > 400 ? 0.78 : 0.5))).join(''); }
    talkG.classList.toggle('gone', !!ui.bub.gone);
  }
  if (SPOT_GOOD[id]) {
    const cost = me ? me.costs[id] : SPOT_COST[id];
    const working = status[id] && status[id].key === 'status.working';
    const frozen = id === 'fields' && view.events.winter;
    bar.innerHTML = `<div class="info"><b>${esc(placeName(id))}</b>${frozen ? esc(t('err.winterFields')) : working ? esc(t('scene.working', { name: me ? me.name : '' })) : t('scene.ready')}<div class="prog"><div id="scene-prog"></div></div></div>` +
      `<button class="primary" data-act="gather" data-spot="${id}" ${!me || frozen || me.energy < cost || working || me.job || !(me.inv[TOOL_OF[SPOT_GOOD[id]]] > 0) ? 'disabled' : ''}>${t('scene.again', { n: cost })}</button>`;
  } else if (n) {
    bar.innerHTML = `<div class="info"><b>${esc(placeName(id))} · ${esc(npcName(id))}</b><span class="quote">"${esc(t('line.' + n.lineKey))}"</span><div class="muted" style="font-size:12px;margin-top:4px">${t(phoneLayout() ? 'scene.tradeHintBelow' : 'scene.tradeHint')}</div></div>` +
      (id === 'inn' ? sleepButton('inn') : '');
  } else if (homeHasScene(id, view)) {
    bar.innerHTML = `<div class="info"><b>${esc(placeName(id))}</b><span class="quote">${esc(t('scene.home'))}</span></div>` + sleepButton(id);
  }
  // the shop counter inside the picture: buy and sell without scrolling the side panel
  const menu = $('scene-menu');
  if (menu) {
    if (n && me && !(menu.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) {
      menu.innerHTML = `<div class="sm-head">${esc(npcName(id))}<span class="muted"> · ${t('scene.counter')}</span></div>` + (n.closed ? `<p class="closed small">${t('panel.closed')}</p>` : n.shut ? `<p class="closed small">${t('talk.shut')}</p>` : '') + tradeBlock(id);
      menu.hidden = false;
    } else if (!n) menu.hidden = true;
  }
  placeSceneBar();
}
$('mini').addEventListener('click', () => closeScene());

// a sleep button for the scene bar (only at night, only where you may sleep)
function sleepButton(place) {
  const me = view.player;
  if (!me || !view.night || me.sleepPlace) return '';
  const plot = view.plots[place];
  if (plot && plot.mine && (!plot.bed || plot.lease)) return '';
  if (place === 'inn' && view.inn && view.inn.free < 1) return `<button disabled>${t('err.innFull')}</button>`;
  const paid = place === 'inn';
  return `<button class="primary" data-act="sleep" data-place="${place}" ${paid && me.coins < me.innBed ? 'disabled' : ''}>${t(paid ? 'sleep.innBtn' : 'sleep.btn', { n: me.innBed })}</button>`;
}

// the line in the speech bubble: the result of what you just did, or what fits the moment
function sceneTalk(id) {
  const me = view.player;
  if (!me) return null;
  const home = homeHasScene(id, view), sleepingHere = view.night && me.sleepPlace === id;
  const at = home ? (sleepingHere ? [300, 330] : [600, 250]) : id === 'inn' && sleepingHere ? [190, 330] : view.npcs[id] ? KEEPER_HEAD : [556, 200];
  const r = result[id];
  // "good night" belongs to the night: in the morning the keeper greets you again
  if (r && /^result\.slept/.test(r.key) && !view.night) delete result[id];
  else if (r && !r.bad) return { x: at[0], y: at[1], text: t(r.key, resolve(r.p)) };
  if (result[id] && result[id].bad) return { x: at[0], y: at[1], text: t(result[id].key, resolve(result[id].p)) };
  if (home) {
    const plot = view.plots[id];
    if (plot && plot.mine && !plot.bed) return { x: at[0], y: at[1], text: t('talk.home.noBed', { p: view.npcs.carpenter.sells.bed }) };
    if (view.night) return { x: at[0], y: at[1], text: t(me.sleepPlace === id ? 'talk.home.asleep' : 'talk.home.night') };
    return null;
  }
  if (id === 'inn' && view.night) return { x: at[0], y: at[1], text: me.sleepPlace === 'inn' ? t('talk.inn.asleep', { name: me.name }) : view.inn && view.inn.free < 1 ? t('talk.inn.full') : t('talk.inn.bed', { n: me.innBed }) + ' ' + t('inn.rooms', { n: view.inn ? view.inn.free : '?', all: view.inn ? view.inn.rooms : 4 }) };
  const n = view.npcs[id];
  if (n && n.shut) return { x: at[0], y: at[1], text: t('talk.shut') };
  if (id === 'tailor' && view.events.winter && !me.inv.coat) return { x: at[0], y: at[1], text: t('talk.tailor.winter', { p: n.sells.coat }) };
  // otherwise the keeper greets you with their own words
  if (n) return { x: at[0], y: at[1], text: t('talk.greet', { name: me.name }) + ' ' + (n.ai && n.ai.say && getLang() === 'en' ? n.ai.say : t('line.' + n.lineKey)) };
  return null;
}

// the bubbles in a shop scene: a conversation shows you and the keeper talking, each over their own head
function sceneBubbles(id) {
  const me = view.player, n = view.npcs[id], out = [];
  const youHead = [id === 'inn' ? 420 : 250, 405];
  const qa = (ui.aiAnswers || {})[id], hg = ui.haggle && ui.haggle.npc === id ? ui.haggle : null;
  if (me && n && qa && Date.now() - (qa.at || 0) < 25000) {
    out.push({ x: youHead[0], y: youHead[1], text: qa.q, anchor: 0.35, max: 26 });
    out.push({ x: KEEPER_HEAD[0], y: KEEPER_HEAD[1], text: qa.a || '…', anchor: 0.85, max: 34 });
    return out;
  }
  if (qa && Date.now() - (qa.at || 0) < 60000) return []; // just talked: no greeting popping up again
  if (me && n && hg && (hg.wait || (hg.reply && Date.now() - hg.reply.at < 25000))) {
    out.push({ x: youHead[0], y: youHead[1], text: t('haggle.myOffer', { p: hg.offer, n: hg.qty, good: goodWord(hg.good) }), anchor: 0.35, max: 26 });
    if (hg.reply) out.push({ x: KEEPER_HEAD[0], y: KEEPER_HEAD[1], text: hg.reply.line || t(hg.reply.fair ? 'haggle.say.fair' : 'haggle.say.' + hg.reply.outcome, { p: hg.reply.unit, ask: hg.reply.ask, good: goodWord(hg.reply.good) }) , anchor: 0.85, max: 34 });
    return out;
  }
  const said = sceneTalk(id, true);
  return said ? [said] : [];
}

// ---------- side panel ----------

function bestBuyer(good) {
  return Object.values(view.npcs).filter((n) => n.buys[good] !== undefined && !n.closed && !(n.full || []).includes(good)).sort((a, b) => b.buys[good] - a.buys[good])[0];
}

// buying and selling at a shop: used in the side panel and on the counter inside the scene
// the craftsman's reasoning behind a price, shown in a tooltip
function whyTip(n, g) {
  const w = n.why && n.why[g];
  if (!w) return '';
  const text = [t('why.stockLine', { s: w.stock, t: w.target }), ...w.reasons.map((r) => t('price.' + r))].join(' · ');
  return ` <span class="tip" tabindex="0" data-tip="${esc(text)}" aria-label="${esc(text)}">ⓘ</span>`;
}
// haggling: name your price per unit; the craftsman answers (the rules decide, NEAR AI speaks)
// the price the shop would pay or ask per unit right now (a big sale gets a lower average price per unit)
const hagList = (n, g, side) => { const o = (n.offers || {})[g]; return side === 'buy' ? n.sells[g] : o && o.qty ? Math.round((o.total / o.qty) * 10) / 10 : n.buys[g]; };
const hagBtn = (id, g, side) => `<button class="hagbtn" data-haggle="${side}" data-npc="${id}" data-good="${g}" title="${esc(t('haggle.btn'))}">🤝 ${t('haggle.short')}</button>`;
function haggleBox(id) {
  const hg = ui.haggle, me = view.player, n = view.npcs[id];
  if (!hg || hg.npc !== id || !me) return '';
  const max = hg.side === 'sell' ? me.inv[hg.good] || 0 : Math.floor(n.stock[hg.good] || 0);
  const list = hagList(n, hg.good, hg.side);
  let h = `<div class="haggle"><div class="hag-head"><b>🤝 ${t(hg.side === 'buy' ? 'haggle.buyTitle' : 'haggle.sellTitle', { good: goodName(hg.good) })}</b><button class="linkbtn" data-hagclose="1">✕</button></div>` +
    `<p class="muted small">${t(hg.side === 'buy' ? 'haggle.listBuy' : 'haggle.listSell', { p: list })}</p>` +
    (hg.side === 'sell' && (n.offers || {})[hg.good] && n.offers[hg.good].qty > 1 ? `<p class="muted small">${t('haggle.plain', { n: n.offers[hg.good].qty, total: Math.round(n.offers[hg.good].total), first: n.offers[hg.good].first, last: n.offers[hg.good].last })}</p>` : '') +
    `<div class="row hag-row"><input class="hag-qty" type="number" min="1" max="${max}" value="${Math.min(max, hg.qty || 1)}" aria-label="${esc(t('panel.howMany'))}"> × <input class="hag-offer" type="number" min="0.1" step="0.1" value="${hg.offer}" aria-label="${esc(t('haggle.yourPrice'))}"> EMWK ` +
    `<button class="primary" data-hagsend="1" ${hg.wait ? 'disabled' : ''}>${t(hg.wait ? 'ai.thinking' : 'haggle.offer')}</button></div>`;
  if (hg.reply) {
    const r = hg.reply;
    const line = r.line || t(r.fair ? 'haggle.say.fair' : 'haggle.say.' + r.outcome, { p: r.unit, ask: r.ask, good: goodWord(r.good) });
    h += `<div class="hag-reply ${r.outcome}"><span class="quote">"${esc(line)}"</span></div>`;
    if (r.side === 'sell' && r.unit !== null && r.unit !== undefined && r.plainTotal) h += `<p class="muted small">${t('haggle.vsPlain', { n: r.qty, plain: r.plainTotal, deal: Math.round(r.unit * r.qty * 100) / 100 })}</p>`;
    const d = me.deal;
    if (d && d.npc === id && d.good === hg.good && d.side === hg.side) h += `<p class="small">${t(d.side === 'sell' ? 'haggle.confirmSell' : 'haggle.confirmBuy')}</p><button class="primary" data-hagdeal="1">${t('haggle.take', { n: d.qty, p: d.unit, total: Math.round(d.qty * d.unit * 100) / 100 })}</button> <button data-hagclose="1">${t('haggle.no2')}</button>`;
  }
  return h + `</div>`;
}

function tradeBlock(id) {
  const n = view.npcs[id], me = view.player;
  let h = haggleBox(id);
  if (id === 'inn') {
    const full = me && me.energy >= me.maxEnergy;
    h += `<button class="primary big" data-act="meal" ${!me || n.closed || full ? 'disabled' : ''}>${t('panel.meal', { p: n.sells.meal })}</button>` +
      `<p class="muted" style="font-size:12px">${full ? t('panel.full') : t('panel.mealsReady', { n: n.stock.meal || 0 })}</p>`;
  }
  if (id === 'bakery') h += `<p style="font-size:13px">${t('panel.breadHint')}</p>`;
  const buys = Object.entries(n.buys);
  if (buys.length) {
    h += `<h4>${t('panel.buysFromYou')}</h4><table>`;
    for (const [g, p] of buys) {
      const have = me ? me.inv[g] || 0 : 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(${t('panel.youHave', { n: have })})</span></td><td class="n">${p} EMWK${whyTip(n, g)}</td>` +
        ((n.full || []).includes(g) ? `<td class="n"><span class="muted small">${t('panel.full')}</span></td></tr>`
          : (() => {
            const o = (n.offers || {})[g];
            if (have && o && o.qty < 1) return `<td class="n"><span class="muted small">${t('panel.noNeed')}</span></td></tr>`;
            const label = have && o ? t('panel.sellQuote', { n: o.qty, p: Math.round(o.total) }) : have ? t('panel.sellAll', { n: have }) : t('panel.sell');
            // how many to sell: the player picks; by default as many as the shopkeeper wants
            const def = Math.max(1, Math.min(have, o ? o.qty : have)), pick = Math.min(have, (ui.sellQty || {})[g] || def);
            const box = have > 1 ? `<div class="qtyrow"><button class="qbtn" data-qstep="-1" data-good="${g}" aria-label="−">−</button><input class="sellqty" type="number" min="1" max="${have}" value="${pick}" data-good="${g}" aria-label="${esc(t('panel.howMany'))}"><button class="qbtn" data-qstep="1" data-good="${g}" aria-label="+">+</button><button class="qbtn all" data-qall="${have}" data-good="${g}">${t('panel.all')}</button></div>` : '';
            const btnLabel = have > 1 ? t('panel.sellN', { n: pick }) : label;
            return `<td class="n">${box}<button class="${have ? 'sellbtn' : ''}" data-act="sell" data-good="${g}" ${!have || n.closed || n.shut ? 'disabled' : ''}>${btnLabel}</button>${have && id !== 'tower' && !n.closed && !n.shut ? hagBtn(id, g, 'sell') : ''}${have && o ? `<div class="muted small">${o.qty < have ? t('panel.onlyNeeds', { n: o.qty }) + ' · ' : ''}${t('panel.quoteAll', { n: o.qty, p: Math.round(o.total) })}</div>` : ''}</td></tr>`;
          })());
    }
    h += `</table>`;
  }
  const sells = Object.entries(n.sells).filter(([g]) => g !== 'meal');
  if (sells.length) {
    h += `<h4>${t('panel.sells')}</h4><table>`;
    for (const [g, p] of sells) {
      const stock = n.stock[g] || 0;
      h += `<tr><td>${goodName(g)} <span class="muted">(${t('panel.left', { n: stock })})</span></td><td class="n">${p} EMWK${whyTip(n, g)}</td>` +
        `<td class="n"><button data-act="buy" data-good="${g}" ${!me || !stock || n.closed ? 'disabled' : ''}>${t('panel.buy')}</button>${me && stock && id !== 'tower' && !n.closed && !n.shut ? hagBtn(id, g, 'buy') : ''}</td></tr>`;
    }
    h += `</table>`;
  }
  return h;
}

function panelCraftsman(b) {
  const n = view.npcs[b.id];
  const me = view.player;
  let h = `<h2>${esc(npcName(b.id))}</h2><div class="muted">${esc(t('panel.purse', { place: placeName(b.id), n: n.wallet }))}</div>`;
  if (n.closed) h += `<p class="closed">${t('panel.closed')}</p>`;
  else if (n.shut) h += `<p class="closed">${t('err.night')}</p>`;
  if (b.id !== 'tower') {
    const learned = Object.entries(n.learn || {}).filter(([, v]) => Math.abs(v - 1) >= 0.15).map(([g, v]) => t(v > 1 ? 'ai.more' : 'ai.less', { good: goodName(g) }));
    h += `<p class="small ai-note">${t('ai.level', { n: n.level || 1 })}${learned.length ? ' · ' + learned.join(' · ') : ''}</p>`;
  }
  h += `<div class="quote">"${esc(n.ai && n.ai.say && getLang() === 'en' ? n.ai.say : t('line.' + n.lineKey))}"</div>`;
  h += debtBox(b.id) + aiBox(b.id, n);
  if (b.id === 'inn') h += sleepBox('inn');
  if (b.id === 'tailor' && view.events.winter && me && !me.inv.coat) h += `<p class="closed small">${t('coat.need')}</p>`;
  // inside the shop the counter on the game screen has the buy/sell lists, so the side panel stays short
  h += (ui.scene === b.id && me && !phoneLayout() ? `<p class="small muted">${t('scene.tradeHint')}</p>` : tradeBlock(b.id)) + jobSection(b.id);
  if (chainOk()) h += `<p class="small">${exLink('address/' + view.chain.accounts.npcs[b.id], t('near.view') + ' · ' + esc(view.chain.accounts.npcs[b.id]))}</p>`;
  return h + `<p class="muted" style="font-size:12px">${t('panel.pricesNote')}</p>`;
}

// food on credit: what you owe here, and paying it back
function debtBox(id) {
  const d = view.player && (view.player.debts || {})[id];
  if (!d) return '';
  const late = view.day > d.due;
  return `<div class="contract debt${late ? ' late' : ''}"><b>${t('credit.owe', { n: d.amount, d: d.due })}</b><p class="small">${t(late ? 'credit.late' : 'credit.how')}</p>` +
    `<button class="primary" data-repay="${id}" ${view.player.coins < d.amount ? 'disabled' : ''}>${t('credit.pay', { n: d.amount })}</button></div>`;
}

// proof for judges: today's plan is on NEAR (hash in the memo, exact JSON to check) and the model runs in a TEE
function aiTx(day) {
  const c = view.chain;
  if (c && c.feed) for (const f of c.feed) if (f.ok && f.hash && f.items.some((it) => it.aiPlan === day)) return f.hash;
  return null;
}
function aiProof(short) {
  const rec = (view.aiLog || [])[0], at = (view.ai || {}).attest;
  let h = '';
  if (rec) {
    const tx = chainOk() ? aiTx(rec.day) : null;
    h += `<p class="small ai-proof">⛓ ${t('ai.onChain', { d: rec.day, h: rec.hash.slice(0, 10) })} · <a href="/api/ai/plan?day=${rec.day}" target="_blank" rel="noopener">${t('ai.planJson')}</a>${tx ? ' · ' + exLink('txns/' + tx, t('ai.planTx')) : chainOk() ? ` · <span class="muted">${t('job.contractWait')}</span>` : ''}</p>`;
  }
  if (at && at.signer) h += `<p class="small ai-proof">🔒 ${t(at.gatewayOnly ? 'ai.attestGw' : 'ai.attest', { s: esc(String(at.signer).slice(0, 10)) + '…', q: at.quote ? 'Intel TDX ✓' : '' })} · <a href="/api/ai/attestation" target="_blank" rel="noopener">${t('ai.attestLink')}</a></p>`;
  return h;
}

// the craftsman's NEAR AI mind: today's plan, and a box to ask them something
function aiBox(id, n) {
  const st = view.ai || {};
  if (st.status !== 'ready') return id === 'tower' ? '' : `<p class="small muted ai-off">${t('ai.offNote')}</p>`;
  let h = `<div class="ai-box"><div class="ai-head"><span class="ai-dot${st.planFailed ? ' off' : ''}"></span>${t('ai.mind', { model: esc(st.model || '') })}${st.tee ? ` · <span class="ai-tee">${t('ai.tee')}</span>` : ''}</div>`;
  if (n.ai && n.ai.why) {
    const moves = [...Object.entries(n.ai.want || {}).filter(([, v]) => Math.abs(v - 1) >= 0.1).map(([g, v]) => t(v > 1 ? 'ai.stockUp' : 'ai.stockDown', { good: goodName(g) })),
      ...Object.entries(n.ai.price || {}).filter(([, v]) => Math.abs(v - 1) >= 0.03).map(([g, v]) => t(v > 1 ? 'ai.priceUp' : 'ai.priceDown', { good: goodName(g) }))];
    h += `<p class="small"><b>${t('ai.plan')}</b> ${esc(n.ai.why)}</p>` + (moves.length ? `<p class="small muted">${moves.join(' · ')}</p>` : '');
  } else if (id !== 'tower') h += `<p class="small muted">${t(st.planFailed ? 'ai.unreachable' : 'ai.waiting')}</p>`;
  h += aiProof(true);
  const a = (ui.aiAnswers || {})[id];
  if (a) h += `<div class="ai-qa"><div class="small muted">${t('ai.you')} ${esc(a.q)}</div><div class="quote">${a.a ? '"' + esc(a.a) + '"' : t('ai.thinking')}</div></div>`;
  if (view.player) h += `<form class="ai-ask row" data-npc="${id}"><input class="ai-q" maxlength="200" placeholder="${esc(t('ai.askPh', { name: npcName(id) }))}"><button type="submit">${t('ai.ask')}</button></form>`;
  return h + `</div>`;
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
    (b.id === 'fields' && view.events.winter ? `<p class="closed">${t('err.winterFields')}</p><p class="small">${t('winter.fieldsTip')}</p>` :
    `<button class="primary big" data-act="gather" ${!me || me.energy < energy ? 'disabled' : ''}>${t('gather.btn.' + good, { n: energy })}</button>`) +
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
  const towers = (view.watchtowers || []).length, tr = view.council ? view.council.rules.tower.readiness : 10;
  return `<h2>${placeName('dragonpeak')}</h2>${warn}${view.threat ? `<p class="closed">${t('dragon.threat', { n: Math.round(view.threat * 100) })}</p>` : ''}<p>${t('dragon.ready', { n: view.readiness })}</p>${towers ? `<p class="small">${t('dragon.towers', { n: towers, r: towers * tr })}</p>` : ''}<p>${t('dragon.rule')}</p>` +
    `<p class="muted" style="font-size:13px">${t('dragon.tip')}</p>`;
}

// the treasury's books: balance, what is locked, where money came from and went this week
function panelTreasury() {
  const k = view.books;
  if (!k) return `<p>${t('treasury.text', { n: view.treasury })}</p>`;
  const who = (x) => x.who.startsWith('npc:') ? npcName(x.who.slice(4)) : x.who.startsWith('player:') || x.who.startsWith('bot:') ? esc(x.name) : t('books.k.' + ({ newcomerFund: 'newcomers', adventurerFund: 'travellers', deposits: 'deposits' }[x.who] || 'other'));
  const kinds = ['villagers', 'craftsmen', 'guards', 'newcomers', 'travellers', 'deposits', 'other'];
  const row = (dir) => kinds.filter((c) => k.week[dir][c]).map((c) => `<tr><td>${t('books.k.' + c)}</td><td class="n">${Math.round(k.week[dir][c])} EMWK</td></tr>`).join('') || `<tr><td class="muted">${t('books.none')}</td><td></td></tr>`;
  const max = Math.max(1, ...k.days.map((d) => Math.max(d.in, d.out)));
  const bars = k.days.map((d) => `<div class="bday"><div class="bb in" style="height:${(d.in / max) * 46}px" title="+${Math.round(d.in)}"></div><div class="bb out" style="height:${(d.out / max) * 46}px" title="-${Math.round(d.out)}"></div><span>${d.day}</span></div>`).join('');
  let h = `<div class="books-top"><div><span class="muted small">${t('books.balance')}</span><b>${Math.round(k.balance)} EMWK</b></div><div><span class="muted small">${t('books.reserve')}</span><b>${k.reserve}${k.held ? ` + ${Math.round(k.held)}` : ''}</b></div><div><span class="muted small">${t('books.spare')}</span><b class="ok">${Math.round(k.spare)}</b></div></div>`;
  h += `<p class="small">${t('books.tax', { n: Math.round(k.tax * 100) })}</p>` + reserveBox(false);
  h += `<p class="sub2">${t('books.week')}</p><div class="bchart">${bars}</div><div class="small muted"><span class="dot in"></span>${t('books.in')} <span class="dot out"></span>${t('books.out')}</div>`;
  h += `<p class="sub2">${t('books.inTitle')}</p><table>${row('in')}</table><p class="sub2">${t('books.outTitle')}</p><table>${row('out')}</table>`;
  h += `<p class="sub2">${t('books.recent')}</p><ul class="decided">${k.recent.slice(0, 8).map((x) => `<li><span class="${x.dir === 'in' ? 'ok' : 'bad'}">${x.dir === 'in' ? '+' : '−'}${x.amount}</span> ${who(x)}${x.memo ? ` <span class="muted small">· ${esc(x.memo)}</span>` : ''} <span class="muted small">(${t('ui.day', { n: x.day })})</span></li>`).join('') || `<li class="muted">${t('books.none')}</li>`}</ul>`;
  if (chainOk()) h += `<p class="small">${exLink('address/' + view.chain.accounts.treasury, t('near.view') + ' · ' + esc(view.chain.accounts.treasury))}</p>`;
  return h + `<p class="muted small">${t('treasury.note')}</p>`;
}

// ---------- the exchange: player market, land deeds, and the change desk (NEAR Intents) ----------
function panelExchange() {
  const me = view.player, mk = view.market;
  const tab = ui.exTab || 'change';
  if (tab === 'change' && !ui.exPrices && !ui.exPricesLoading) { ui.exPricesLoading = true; loadExPrices(); }
  let h = `<h2>${t('b.exchange')}</h2><p class="muted small">${t('ex.intro', { fee: Math.round(mk.fee * 100) })}</p>`;
  const COL = '<!--col-->';
  h += `<div class="tabs">${['change', 'goods', 'deeds'].map((k) => `<button class="tab${tab === k ? ' on' : ''}" data-extab="${k}">${t('ex.tab.' + k)}</button>`).join('')}</div>`;
  if (tab === 'goods') {
    const mine = me ? mk.goods.filter((g) => (me.inv[g] || 0) > 0) : [];
    const shopPrice = (g) => { const n = Object.values(view.npcs).find((x) => x.sells[g] !== undefined); return n ? n.sells[g] : null; };
    const buyPrice = (g) => { const ns = Object.values(view.npcs).filter((x) => x.buys[g] !== undefined); return ns.length ? Math.max(...ns.map((x) => x.buys[g])) : null; };
    if (me) {
      const g0 = ui.exGood && mine.includes(ui.exGood) ? ui.exGood : mine[0];
      h += `<p class="sub2">${t('ex.sellTitle')}</p>`;
      if (!g0) h += `<p class="muted small">${t('ex.nothingToSell')}</p>`;
      else {
        const sug = shopPrice(g0) || buyPrice(g0) || 5;
        h += `<div class="row exform"><select id="ex-good">${mine.map((g) => `<option value="${g}"${g === g0 ? ' selected' : ''}>${goodName(g)} (${me.inv[g]})</option>`).join('')}</select>` +
          `<input id="ex-qty" type="number" min="1" max="${me.inv[g0]}" value="${me.inv[g0]}" title="${t('ex.qty')}"> × <input id="ex-price" type="number" min="1" max="500" value="${sug}" title="${t('ex.price')}"> EMWK` +
          `<button class="primary" data-act="postOrder">${t('ex.post')}</button></div>` +
          `<p class="muted small">${t('ex.priceHint', { shop: shopPrice(g0) ?? '–', buy: buyPrice(g0) ?? '–' })}</p>`;
      }
    }
    h += COL + `<p class="sub2">${t('ex.book')}</p>`;
    h += mk.orders.length ? `<table>${mk.orders.map((o) => `<tr><td><b>${goodName(o.good)}</b> × ${o.qty}<div class="muted small">${esc(o.sellerName)} · ${t('ex.left', { n: o.left })}</div></td><td class="n">${o.price} EMWK${shopPrice(o.good) ? `<div class="muted small">${t('ex.shop', { n: shopPrice(o.good) })}</div>` : ''}</td><td class="n">` +
      (o.mine ? `<button data-act="cancelOrder" data-id="${o.id}">${t('ex.cancel')}</button>` : `<button class="primary" data-act="fillOrder" data-id="${o.id}" ${!me || me.coins < o.price ? 'disabled' : ''}>${t('ex.buy1')}</button>`) + `</td></tr>`).join('')}</table>` : `<p class="muted small">${t('ex.noOrders')}</p>`;
    const tr = mk.trades.filter((x) => x.good);
    if (tr.length) h += `<p class="sub2">${t('ex.trades')}</p><ul class="decided">${tr.slice(0, 6).map((x) => `<li>${x.qty} ${goodName(x.good)} · ${x.price} EMWK · ${esc(x.seller)} → ${esc(typeof x.buyer === 'object' ? npcName(x.buyer.$npc) : x.buyer)} <span class="muted small">(${t('ui.day', { n: x.day })})</span></li>`).join('')}</ul>`;
  }
  if (tab === 'deeds') {
    const sale = Object.entries(view.plots).filter(([, x]) => x.sale);
    h += `<p class="sub2">${t('ex.deedsForSale')}</p>`;
    h += sale.length ? `<table>${sale.map(([id, x]) => `<tr><td><b>${esc(placeName(id))}</b><div class="muted small">${esc(x.owner)} · ${x.built ? t(x.bed ? 'ex.withHouseBed' : 'ex.withHouse') : t('ex.bareLand')}${x.lease && x.lease.tenant ? ' · ' + t('ex.rented', { n: x.lease.rent }) : ''}</div></td><td class="n">${x.sale.price} EMWK</td><td class="n">` +
      (x.mine ? `<span class="muted small">${t('lands.yours')}</span>` : `<button class="primary" data-act="buyDeed" data-plot="${id}" ${!me || me.plot || me.coins < x.sale.price || (x.minLevel && me.level < x.minLevel) ? 'disabled' : ''}>${t('ex.buy1')}</button>`) + `</td></tr>`).join('')}</table>` : `<p class="muted small">${t('ex.noDeeds')}</p>`;
    h += COL;
    if (me && me.plot) {
      const x = view.plots[me.plot];
      h += `<p class="sub2">${t('ex.myDeed', { place: placeName(me.plot) })}</p>`;
      if (x.sale) h += `<p class="small">${t('ex.listedAt', { n: x.sale.price })}</p><button data-act="unlistDeed" data-plot="${me.plot}">${t('ex.unlist')}</button>`;
      else h += `<p class="muted small">${t('ex.sellDeedHelp')}</p><div class="row exform"><input id="ex-deed-price" type="number" min="1" max="5000" value="${Math.round((x.price || 120) * (x.built ? 1.6 : 1.1))}"> EMWK <button class="primary" data-act="listDeed" data-plot="${me.plot}">${t('ex.listDeed')}</button></div>`;
    }
    const dt = mk.trades.filter((x) => x.deed);
    if (dt.length) h += `<p class="sub2">${t('ex.trades')}</p><ul class="decided">${dt.slice(0, 5).map((x) => `<li>${esc(placeName(x.deed))} · ${x.price} EMWK · ${esc(x.seller)} → ${esc(x.buyer)}</li>`).join('')}</ul>`;
    h += `<p class="muted small">${t('ex.deedNote')}</p>`;
  }
  if (tab === 'change') {
    // the live cross-chain quote comes first, with the bridge picture right under it
    const eq = ui.exQuote && ui.exQuote.ok ? ui.exQuote : null;
    h += `<p class="sub2">${t('ex.quoteTitle')}</p><div class="row exform"><input id="ex-q-amount" type="number" min="0.1" max="1000" step="0.1" value="${ui.exQAmount || 1}"> NEAR → <select id="ex-q-to">${['USDC', 'BTC', 'ETH', 'SOL'].map((k) => `<option${ui.exQTo === k ? ' selected' : ''}>${k}</option>`).join('')}</select><button class="primary" data-act="exQuote">${t('ex.getQuote')}</button></div>`;
    h += bridgeSvg(eq ? { sym: 'NEAR', chain: 'near', amount: eq.amountIn } : { sym: 'NEAR', chain: 'near' }, eq ? { sym: eq.to, chain: eq.chain, amount: eq.amountOut } : { sym: ui.exQTo || 'USDC', chain: '' }, !!eq, 'swap');
    const q = ui.exQuote;
    if (q === 'wait') h += `<p class="muted small">${t('ex.loading')}</p>`;
    else if (q && q.ok) h += `<div class="contract"><b>${t('ex.quoteOut', { a: q.amountIn, b: q.amountOut, sym: q.to, chain: q.chain })}</b>${q.usdOut ? `<div class="small">≈ $${q.usdOut}</div>` : ''}<p class="muted small">${t('ex.quoteNote')}</p></div>`;
    else if (q) h += `<p class="muted small">${/fetch failed|abort|ENOTFOUND|ECONN/i.test(q.error || '') || !q.error ? t('ex.offline') : t('ex.quoteFailed', { why: esc(q.error) })}</p>`;
    h += COL + oracleBox() + reserveBox(true);
    const pr = ui.exPrices;
    h += `<p class="sub2">${t('ex.pricesTitle')}</p>`;
    if (!pr) h += `<p class="muted small">${t('ex.loading')}</p>`;
    else if (!pr.ok) h += `<p class="muted small">${t('ex.offline')}</p>`;
    else h += `<table>${pr.tokens.map((x) => `<tr><td><b>${esc(x.symbol)}</b> <span class="muted small">${esc(x.chain)}</span></td><td class="n">$${Number(x.price).toLocaleString(undefined, { maximumFractionDigits: x.price < 10 ? 3 : 0 })}</td></tr>`).join('')}</table><p class="muted small">${t('ex.pricesSource')}</p>`;
    h += `<p class="sub2">${t('ex.bridgeTitle')}</p><p class="small">${t('ex.bridgeHelp', { n: me ? Math.floor(me.coins) : 0 })}</p><button class="primary" data-act="open-near">${t('ex.openNear')}</button>`;
    h += `<p class="muted small">${t('ex.changeNote')}</p>`;
  }
  // two columns side by side, so nothing needs scrolling on a normal screen
  const at = h.indexOf('<div class="tabs">'), endTabs = h.indexOf('</div>', at) + 6, body = h.slice(endTabs);
  if (body.includes(COL)) { const [l, r] = body.split(COL); h = h.slice(0, endTabs) + `<div class="excols"><div class="excol">${l}</div><div class="excol">${r}</div></div>`; }
  return h;
}
// the live NEAR price from NEAR Intents and what it does to the village economy
function oracleBox() {
  const o = view.oracle;
  if (!o) return `<div class="contract"><b>${t('oracle.title')}</b><p class="muted small">${t('oracle.waiting')}</p></div>`;
  const pct = Math.round((o.usd / o.ref - 1) * 1000) / 10, f = Math.round((o.factor - 1) * 100);
  return `<div class="contract"><b>${t('oracle.title')}</b><p class="small">${t('oracle.now', { usd: o.usd.toFixed(3), ref: o.ref.toFixed(3), pct: (pct > 0 ? '+' : '') + pct })}</p>` +
    `<p class="small ${f > 0 ? 'ok' : f < 0 ? 'bad' : ''}">${t(f > 0 ? 'oracle.up' : f < 0 ? 'oracle.down' : 'oracle.flat', { n: Math.abs(f) })}</p><p class="muted small">${t('oracle.how')}</p></div>`;
}
// money the council has set aside in USDC or BTC (priced by a live NEAR Intents quote)
function reserveBox(withHelp) {
  const hs = view.reserveHolds || [];
  if (!hs.length) return withHelp ? `<p class="muted small">${t('reserve.none')}</p>` : '';
  return `<p class="sub2">${t('reserve.title')}</p><ul class="decided">${hs.map((h) => `<li><b>${h.amount} EMWK → ${esc(h.asset)}</b>${h.out ? ` · ${t('reserve.quote', { out: h.out, asset: h.asset, near: h.near })}` : ''} <span class="muted small">(${t('reserve.until', { n: h.until })})</span></li>`).join('')}</ul>`;
}
async function loadExPrices() {
  ui.exPricesLoading = false;
  try { ui.exPrices = await (await fetch('/api/exchange/prices')).json(); } catch { ui.exPrices = { ok: false }; }
  ui.exPricesAt = Date.now();
  if (ui.selected === 'exchange') renderPanel();
  if (ui.district === 3) renderMapNow(); // the price board and the price panel
}
// market actions answer back here; selling a deed that is in your own wallet first sends it to the bank
async function exAct(type, extra) {
  if (!playerId) return toast(t('toast.join'), 'bad');
  let r = await post('/api/action', { player: playerId, type, ...extra });
  if (!r.ok && r.code === 'err.deedInWallet') {
    const W = window.EmberwickWallet, c = view.chain;
    if (!W || !c || !c.deeds || !c.deeds.contract) return toast(errText(r), 'bad');
    toast(t('ex.escrowAsk'), '');
    try {
      await W.nftTransfer(c.network, c.deeds.contract, r.bank, r.tokenId, 'Emberwick: deed to the exchange for sale');
      toast(t('ex.escrowCheck'), '');
      r = await post('/api/market/escrow', { player: playerId, plot: extra.plot, price: extra.price });
    } catch (e) { return toast(t('ex.escrowFailed'), 'bad'); }
  }
  if (r.state && newer(r.state)) { view = r.state; render(); }
  play(r.ok ? 'coin' : 'bad');
  if (r.ok) toast(t('ex.done.' + type, { n: r.price || r.total || r.qty || '', good: r.good ? goodName(r.good) : '' }), 'win');
  else toast(errText(r), 'bad');
}

// what happened in the fast-forwarded week
function panelWeek() {
  const w = view.week;
  const arrow = (c) => (c > 0 ? `<span class="bad">▲ ${c}%</span>` : c < 0 ? `<span class="ok">▼ ${-c}%</span>` : `<span class="muted">=</span>`);
  let h = `<h2>${t('ff.doneTitle', { a: w.fromDay, b: w.toDay })}</h2><p class="muted small">${t('ff.doneIntro')}</p>`;
  h += `<div class="books-top"><div><span class="muted small">${t('books.balance')}</span><b>${Math.round(w.treasury.from)} → ${Math.round(w.treasury.to)}</b></div><div><span class="muted small">${t('ui.readiness')}</span><b>${w.readiness.from}% → ${w.readiness.to}%</b></div><div><span class="muted small">${t('ff.decisions')}</span><b>${w.decisions.length}</b></div></div>`;
  h += `<p class="sub2">${t('ff.prices')}</p><table>${w.prices.filter((x) => x.from).map((x) => `<tr><td>${goodName(x.good)} <span class="muted small">${t(x.side === 'sells' ? 'ff.sells' : 'ff.buys', { name: npcName(x.npc) })}</span></td><td class="n">${Math.round(x.from)} → ${Math.round(x.to)}</td><td class="n">${arrow(x.change)}</td></tr>`).join('')}</table>`;
  h += `<p class="sub2">${t('ff.ai')}</p><ul class="decided">` +
    w.winners.map((x) => `<li class="ok">${npcName(x.npc)}: +${Math.round(x.change)} EMWK</li>`).join('') + w.losers.filter((x) => x.change < 0).map((x) => `<li class="bad">${npcName(x.npc)}: ${Math.round(x.change)} EMWK</li>`).join('') +
    w.upgrades.map((x) => `<li>${t('log.upgraded', { name: npcName(x.npc), n: x.level })}</li>`).join('') + `</ul>`;
  if (w.decisions.length) h += `<p class="sub2">${t('council.closed')}</p><ul class="decided">${w.decisions.map((x) => `<li><span class="res ${x.result}">${t('council.res.' + x.result)}</span> #${x.id} ${esc(proposalText(x))}</li>`).join('')}</ul>`;
  if (w.events.length) h += `<p class="sub2">${t('ui.news')}</p><ul class="decided">${w.events.map((l) => `<li>${esc(t('ui.day', { n: l.day }))}: ${esc(l.key ? t(l.key, resolve(l.p || {})) : l.text)}</li>`).join('')}</ul>`;
  return h + `<p class="muted small">${t('ff.note')}</p>`;
}

function panelSimple(b) {
  const title = `<h2>${esc(placeName(b.id))}</h2>`;
  if (b.id === 'treasury') return title + panelTreasury();
  if (b.id === 'exchange') return panelExchange();
  if (b.id === 'council') return panelCouncil();
  if (b.id === 'gate') return title + `<p>${t('gate.text')}</p><button class="primary" data-act="elder">${t('gate.talk')}</button><p class="muted">${t('gate.pop', { n: view.population })}</p>`;
  if (b.type === 'plot') return panelPlot(b);
  if (b.id === 'roadsign') return panelRoadsign();
  if (b.type === 'house') return panelHouse(b);
  if (b.type === 'watch') {
    const r = world.rules && view.council ? view.council.rules.tower.readiness : 10;
    const built = (view.watchtowers || []).includes(b.id);
    return `<h2>${esc(t(built ? 'b.tower' : 'watch.title'))}</h2><p>${t(built ? 'watch.built' : 'watch.empty', { r })}</p>` +
      (built ? '' : `<button class="primary" data-go="council">${t('watch.go')}</button>`);
  }
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
  if (w.player) { // another real player: show who they are and offer to write to them
    const o = (view.others || []).find((x) => x.id === w.pid) || {};
    ui.selected = 'talk';
    ui.talk = { name: w.name, role: w.role, player: true, level: o.level || 1, where: o.where };
    renderMapNow(); renderPanel(); return;
  }
  const line = lineFor(w);
  w.say = { ...line, until: performance.now() + 5000 };
  ui.selected = 'talk';
  ui.talk = { name: w.name, role: w.role, line, go: ROLE_SHOP[w.role] };
  renderMapNow();
  renderPanel();
}

function panelTalk() {
  const tk = ui.talk;
  if (tk.player) return `<h2>${esc(tk.name)}</h2><div class="muted">${t('path.' + tk.role)} · ${t('me.level', { n: tk.level })}</div>` +
    `<p class="small">${t('chat.playerNote')}${tk.where ? ' ' + esc(t('chat.isAt', { place: placeName(tk.where) })) : ''}</p>` +
    `<button class="primary" data-chatto="${esc(tk.name)}">${t('chat.write')}</button>`;
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
  const howLink = `<p><button class="linkbtn" data-howto="1">${t('how.btn')}</button></p>`;
  const route = world.routes[me.path];
  const steps = [];
  const evening = view.night || view.dayProgress >= 0.7;
  if (evening && !me.sleepPlace) {
    steps.push({ text: t(view.night ? 'night.ask' : 'night.evening', { s: toNight() }) });
    for (const o of bedOptions(me)) steps.push(o);
  }
  if (view.events.winter && route.spot === 'fields' && !me.job) steps.push({ text: t('winter.fieldsTip'), go: 'pasture', label: t('go.to', { place: placeName('pasture') }) });
  if (me.freezing) steps.push({ text: t('guide.coat', { p: view.npcs.tailor ? view.npcs.tailor.sells.coat : '?' }), go: 'tailor', label: t('go.to', { place: placeName('tailor') }) });
  const carried = ['wheat', 'wood', 'ore', 'wool', 'fish'].filter((g) => (me.inv[g] || 0) > 0);
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
  return `<h2>${t('guide.title')}</h2><p class="muted" style="font-size:13px;margin-top:2px">${t('guide.sentence')}</p>` + howLink +
    `<ol class="guide">${steps.map((st) => `<li>${st.text}${st.go ? `<br><button class="primary" data-go="${st.go}">${esc(st.label)} →</button>` : ''}${st.eat ? `<br><button class="primary" data-eat="1">${t('guide.eat')}</button>` : ''}</li>`).join('')}</ol>`;
}

// one list of everything you can sell or buy, with the best price in the village (v43)
function panelTrade() {
  const me = view.player;
  const open = (n) => !n.closed && !n.shut;
  let h = `<h2>${t('trade.title')}</h2><p class="muted small">${t('trade.intro')}</p>`;
  h += `<h4>${t('trade.sellTitle')}</h4>`;
  const mine = me ? Object.entries(me.inv).filter(([g, q]) => q > 0 && !TOOL_GOODS.has(g)) : [];
  if (!mine.length) h += `<p class="muted small">${t('trade.bagEmpty')}</p>`;
  else {
    h += `<table>`;
    for (const [g, q] of mine) {
      let best = null;
      for (const [id, n] of Object.entries(view.npcs)) {
        const p = n.buys && n.buys[g];
        if (!p || (n.full || []).includes(g)) continue;
        const score = (open(n) ? 1e6 : 0) + p;
        if (!best || score > best.score) best = { id, n, p, score };
      }
      h += `<tr><td>${goodName(g)} ×${q}<div class="muted small">${best ? esc(placeName(best.id)) + (open(best.n) ? '' : ' · ' + t('trade.closed')) : t('trade.nobody')}</div></td>` +
        `<td class="n">${best ? best.p + ' EMWK' : ''}</td><td class="n">${best ? `<button class="sellbtn" data-act="tradeGo" data-kind="sell" data-npc="${best.id}" data-good="${g}" ${open(best.n) ? '' : 'disabled'}>${t('panel.sell')}</button>` : ''}</td></tr>`;
    }
    h += `</table>`;
  }
  h += `<h4>${t('trade.buyTitle')}</h4><table>`;
  const goods = {};
  for (const [id, n] of Object.entries(view.npcs)) for (const [g, p] of Object.entries(n.sells || {})) {
    if (g === 'meal') continue;
    const stock = (n.stock || {})[g] || 0, cur = goods[g];
    const score = (stock > 0 && open(n) ? 1e6 : stock > 0 ? 1e3 : 0) - p;
    if (!cur || score > cur.score) goods[g] = { id, n, p, stock, score };
  }
  for (const [g, x] of Object.entries(goods).sort((a, b) => goodName(a[0]).localeCompare(goodName(b[0])))) {
    const ok = me && x.stock > 0 && open(x.n) && me.coins >= x.p;
    h += `<tr><td>${goodName(g)}<div class="muted small">${esc(placeName(x.id))} · ${t('panel.left', { n: x.stock })}${open(x.n) ? '' : ' · ' + t('trade.closed')}</div></td>` +
      `<td class="n">${x.p} EMWK</td><td class="n"><button data-act="tradeGo" data-kind="buy" data-npc="${x.id}" data-good="${g}" ${ok ? '' : 'disabled'}>${t('panel.buy')}</button></td></tr>`;
  }
  return h + `</table>`;
}

// on a phone the shop counter would cover the shopkeeper, so buying and selling stays in the panel under the picture
const phoneLayout = () => matchMedia('(max-width: 700px)').matches;
const closeBtn = () => `<button class="close" data-act="close" aria-label="${t('ui.close')}">×</button>`;

// big places (treasury, council) open as a card over the map, so nothing is lost below the side panel
const MAP_CARD = new Set(['treasury', 'council', 'exchange', 'week']);
// a plot for sale also opens as a big card on the game screen, so its Buy button is right there
const onMapCard = (id) => MAP_CARD.has(id) || !!(id && view && view.plots && view.plots[id] && !view.plots[id].owner && !view.plots[id].built);
function renderMapCard(id, top, html) {
  const card = $('map-card');
  if (!card) return false;
  if (!id || ui.scene) { card.hidden = true; $('view').classList.remove('card-on', 'card-wide'); return false; }
  const typing = card.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (!typing) card.innerHTML = closeBtn() + top + html;
  card.hidden = false;
  $('view').classList.add('card-on');
  $('view').classList.toggle('card-wide', id === 'exchange');
  return true;
}
function renderPanel() {
  const panel = $('panel');
  const typing = document.activeElement && panel.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (typing) return; // keep what the player is typing
  if (!onMapCard(ui.selected) && $('map-card')) { $('map-card').hidden = true; $('view').classList.remove('card-on', 'card-wide'); }
  if (ui.selected === 'near') { panel.innerHTML = closeBtn() + panelNear(); panel.hidden = false; return; }
  if (ui.selected === 'board') { panel.innerHTML = closeBtn() + boardSection(); panel.hidden = false; return; }
  if (ui.selected === 'trade') { panel.innerHTML = closeBtn() + panelTrade(); panel.hidden = false; return; }
  if (ui.selected === 'rename' && view.player) { panel.innerHTML = closeBtn() + `<h2>${t('rename.title')}</h2><p class="small">${t('rename.help')}</p><form id="rename-form" class="row"><input id="rename-input" maxlength="20" value="${esc(view.player.name)}"><button class="primary" type="submit">${t('rename.save')}</button></form>`; panel.hidden = false; return; }
  if (ui.selected === 'talk' && ui.talk) { panel.innerHTML = closeBtn() + panelTalk(); panel.hidden = false; return; }
  if (ui.selected === 'guide') { panel.innerHTML = closeBtn() + panelGuide(); panel.hidden = false; return; }
  if (ui.selected === 'lands') { panel.innerHTML = closeBtn() + panelLands(); panel.hidden = false; return; }
  if (ui.selected === 'week' && view.week && renderMapCard('week', '', panelWeek())) { panel.innerHTML = closeBtn() + `<h2>${t('ff.title')}</h2><p class="muted small">${t('card.onMap')}</p>`; panel.hidden = false; return; }
  const b = world.buildings.find((x) => x.id === ui.selected);
  if (!b && ui.district) { panel.innerHTML = panelRoadsign(); panel.hidden = false; return; }
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
  if (onMapCard(b.id) && renderMapCard(b.id, top, h)) {
    panel.innerHTML = closeBtn() + `<h2>${esc(placeName(b.id))}</h2><p class="muted small">${t('card.onMap')}</p>`;
    panel.hidden = false;
    return;
  }
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

// real seconds until a given game step
function secsTo(tick) {
  const r = world.rules, now = Math.round(view.dayProgress * r.ticksPerDay) + (view.day - 1) * r.ticksPerDay;
  const sec = Math.max(0, Math.round(((tick - now) * r.tickMs) / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`;
}
function jobSection(npc) {
  const me = view.player;
  const j = me && me.job;
  if (j && j.npc === npc) {
    const ar = me.appResult;
    const won = ar && ar.hired && ar.npc === npc && ar.day >= view.day - 1 ? `<p class="small ok">"${esc(t('apply.won', { n: ar.count - 1, w: ar.wage, b: ar.base }))}"</p>` : '';
    return `<div class="contract"><b>${t('job.mine')}</b>${won}<div class="muted small">${t('job.status', { n: j.wage, days: j.daysLeft })} · ${t('job.today', { a: j.shiftsToday, b: j.maxShifts })}</div>` +
      (j.shiftToday ? `<p class="small">${t('job.shiftDone')}</p>`
        : `<button class="primary big" data-act="shift" ${me.energy < j.energy ? 'disabled' : ''}>${t('job.shift', { e: j.energy, n: j.wage })}</button>` + (me.energy < j.energy ? tiredHelp(me) : '')) +
      `<p class="muted small">${t('job.severance', { n: j.wage })} ${t('job.quitNote', { n: j.wage })}</p>` + contractLine(j) + `<button class="linkbtn" data-act="quitJob">${t('job.quit')}</button></div>`;
  }
  const ap = me && me.application, ar = me && me.appResult;
  let note = '';
  if (ap && ap.npc === npc) note = `<div class="contract"><b>${t('apply.waiting')}</b><p class="small">${t(ap.next.morning ? 'apply.waitMorning' : 'apply.waitSoon', { n: ap.others, s: secsTo(ap.next.tick) })}</p><button class="linkbtn" data-act="withdrawApplication">${t('apply.withdraw')}</button></div>`;
  else if (ar && ar.npc === npc && !ar.hired && ar.day >= view.day - 1) note = `<div class="contract"><b class="bad">${t('apply.lost')}</b><p class="small">"${esc(ar.why === 'needSkill' && ar.need ? t('apply.needSkill', { skill: t('skill.' + ar.need.skill), n: ar.need.level, have: ar.need.have }) : t('apply.' + ar.why, { n: ar.count - 1 }))}"</p></div>`;
  const o = view.jobOffers.find((x) => x.npc === npc);
  if (!o) return note;
  if (ap && ap.npc === npc) return note;
  let req = `<p class="small">${t('job.noReq')}</p>`;
  if (o.require) {
    const have = me ? me.skills[o.require.skill].level : 1, ok = have >= o.require.level;
    req = `<p class="small ${ok ? 'ok' : 'bad'}">${t('job.req', { skill: t('skill.' + o.require.skill), n: o.require.level, have })}</p>`;
  }
  return `<div class="contract offer"><b>${t('job.offerTitle')}</b><p class="small">${t('job.offer', { n: o.wage, days: o.days, e: 3 })}</p>${req}<p class="small">${t('job.exclusive')}</p>` +
    (j ? `<p class="muted small">${t('job.haveOther', { place: placeName(j.npc) })}</p>` : `<button class="primary" data-act="takeJob" ${me ? '' : 'disabled'}>${t('job.apply')}</button>`) +
    `<p class="muted small">${t('job.severance', { n: o.wage })} ${t('job.quitNote', { n: o.wage })}</p></div>`;
}

// at night: go to bed here (your home, your own house, or a paid bed at the inn)
function sleepBox(place) {
  const me = view.player;
  if (!me) return '';
  if (view.night && me.sleepPlace === place) return `<div class="contract sleep"><b>${t('sleep.asleep')}</b><p class="small">${t('sleep.asleepInfo')}</p></div>`;
  if (view.night && me.sleepPlace) return `<div class="contract sleep"><p class="small">${t('sleep.elsewhere', { place: placeName(me.sleepPlace) })}</p></div>`;
  const paid = place === 'inn';
  const own = me.plot === place, plot = own ? view.plots[place] : null;
  if (own && plot && plot.lease) return `<div class="contract sleep"><b>${t('sleep.title')}</b><p class="small">${t('err.homeLeased')}</p></div>`;
  if (paid && view.inn && view.night && view.inn.free < 1) return `<div class="contract sleep"><b>${t('sleep.title')}</b><p class="small closed">${t('err.innFull')}</p></div>`;
  if (own && plot && !plot.bed) return `<div class="contract sleep"><b>${t('sleep.title')}</b><p class="small">${t('bed.none', { p: view.npcs.carpenter.sells.bed })}</p><button data-go="carpenter">${esc(t('go.to', { place: placeName('carpenter') }))}</button></div>`;
  if (!view.night) return `<div class="contract sleep day"><b>${t('sleep.titleDay')}</b><p class="small">${t(paid ? 'sleep.innInfo' : 'sleep.homeInfo', { n: me.innBed })}</p><button disabled>${t('sleep.afterDark', { s: toNight() })}</button></div>`;
  return `<div class="contract sleep"><b>${t('sleep.title')}</b><p class="small">${t(paid ? 'sleep.innInfo' : 'sleep.homeInfo', { n: me.innBed })}</p>${paid && view.inn ? `<p class="small">${t('inn.rooms', { n: view.inn.free, all: view.inn.rooms })}</p>` : ''}` +
    `<button class="primary big" data-act="sleep" data-place="${place}" ${paid && me.coins < me.innBed ? 'disabled' : ''}>${t(paid ? 'sleep.innBtn' : 'sleep.btn', { n: me.innBed })}</button></div>`;
}
// real seconds until it gets dark
function toNight() {
  const r = world.rules, left = ((view.nightStart || 0.8) - view.dayProgress) * r.ticksPerDay * r.tickMs / 1000;
  const sec = Math.max(0, Math.round(left));
  return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`;
}
// where can this player sleep tonight? (shown by the guide in the evening and at night)
function bedOptions(me) {
  const o = [];
  const plot = me.plot && view.plots[me.plot];
  if (plot && plot.built && !(plot.lease && plot.lease.tenant)) {
    if (plot.bed) o.push({ text: t('night.optOwn', { place: placeName(me.plot) }), go: me.plot, label: t('go.to', { place: placeName(me.plot) }) });
    else o.push({ text: t('night.optBed', { place: placeName(me.plot), p: view.npcs.carpenter.sells.bed }), go: 'carpenter', label: t('go.to', { place: placeName('carpenter') }) });
  }
  if (me.home) o.push({ text: t('night.optRented', { place: placeName(me.home.id) }), go: me.home.id, label: t('go.to', { place: placeName(me.home.id) }) });
  if (me.lease) o.push({ text: t('night.optRented', { place: placeName(me.lease) }), go: me.lease, label: t('go.to', { place: placeName(me.lease) }) });
  o.push({ text: t('night.optInn', { n: me.innBed }), go: 'inn', label: t('go.to', { place: placeName('inn') }) });
  if (!me.home && !me.lease && !(plot && plot.built)) {
    const free = Object.entries(view.houses).find(([, h]) => !h.tenant);
    if (free) o.push({ text: t('night.optRent', { place: placeName(free[0]), n: free[1].rent }), go: free[0], label: t('go.to', { place: placeName(free[0]) }) });
  }
  return o;
}

function panelHouse(b) {
  const h = view.houses[b.id], me = view.player;
  let x = `<h2>${esc(placeName(b.id))}</h2><p class="muted">${t('house.rentInfo', { r: h.rent, d: h.deposit })}</p>` +
    `<p>${h.rest >= 99 ? t('house.restFull') : t('house.restInfo', { n: h.rest })}</p>`;
  if (h.mine) {
    const rested = me.home && me.home.restedToday;
    x += sleepBox(b.id) + `<div class="contract"><b>${t('house.yours')}</b>` +
      (view.night && me.sleepPlace ? '' : rested ? `<p class="small">${t('house.rested')}</p>` : `<button class="primary big" data-act="rest">${h.rest >= 99 ? t('house.restFullBtn') : t('house.rest', { n: h.rest })}</button>`) +
      `<button class="linkbtn" data-act="leaveHouse">${t('house.leave', { n: h.deposit })}</button></div>`;
  } else if (h.tenant) x += `<p class="muted">${t('house.taken', { name: esc(h.tenant) })}</p>`;
  else if (me && me.home) x += `<p class="muted small">${t('house.haveOther', { place: placeName(me.home.id) })}</p>`;
  else x += `<p class="ok">${t('house.free')}</p><button class="primary" data-act="rentHouse" ${!me || me.coins < h.rent + h.deposit ? 'disabled' : ''}>${t('house.rent', { n: h.rent + h.deposit })}</button>` + payBox('house:' + b.id, h.rent + h.deposit);
  return x + `<p class="muted small">${t('house.note')}</p>`;
}

// the land market: every deed (NFT) for sale and every free village plot, in one list
function panelLands() {
  const me = view.player, plots = Object.entries(view.plots);
  const deedLink = (x) => { const d = (view.chain || {}).deeds || {}; return x.deed && x.deed.minted && d.contract ? ` · ${exLink('nft-token/' + d.contract + '/' + encodeURIComponent(x.deed.tokenId), t('lands.nft', { id: esc(x.deed.tokenId) }))}` : x.deed ? ` · ${t('lands.nft', { id: esc(x.deed.tokenId || '') })}` : ''; };
  let h = `<h2>${t('lands.title')}</h2><p class="muted small">${t('lands.intro')}</p>`;
  if (me && me.plot) h += `<p class="small closed">${t('plot.haveOne', { place: placeName(me.plot) })}</p>`;
  const sale = plots.filter(([, x]) => x.sale).sort((a, b) => a[1].sale.price - b[1].sale.price);
  h += `<h4>${t('lands.deeds', { n: sale.length })}</h4>`;
  h += sale.length ? `<table>${sale.map(([id, x]) => `<tr><td><b>${esc(placeName(id))}</b><div class="muted small">${x.mine ? `<b>${t('lands.yours')}</b>` : esc(x.owner)} · ${x.built ? t(x.bed ? 'ex.withHouseBed' : 'ex.withHouse') : t('ex.bareLand')}${x.lease && x.lease.tenant ? ' · ' + t('ex.rented', { n: x.lease.rent }) : ''}${deedLink(x)}</div></td><td class="n">${x.sale.price} EMWK</td><td class="n">` +
    (x.mine ? `<button data-act="unlistDeed" data-plot="${id}">${t('ex.unlist')}</button>` : `<button class="primary" data-act="buyDeed" data-plot="${id}" ${!me || me.plot || me.coins < x.sale.price || (x.minLevel && me.level < x.minLevel) ? 'disabled' : ''}>${t('ex.buy1')}</button>`) +
    ` <button class="linkbtn" data-go="${id}">${t('lands.see')}</button></td></tr>`).join('')}</table>` : `<p class="muted small">${t('ex.noDeeds')}</p>`;
  const free = plots.filter(([, x]) => !x.owner && x.open).sort((a, b) => a[1].price - b[1].price);
  h += `<h4>${t('lands.free', { n: free.length })}</h4>`;
  h += free.length ? `<table>${free.map(([id, x]) => `<tr><td><b>${esc(placeName(id))}</b><div class="muted small">${x.district ? t('district.' + x.district) : t('lands.district.village')}${x.minLevel ? ' · ' + t('lands.minLevel', { n: x.minLevel }) : ''}</div></td><td class="n">${x.price} EMWK</td><td class="n"><button class="primary" data-go="${id}">${t('lands.see')}</button></td></tr>`).join('')}</table>` : `<p class="muted small">${t('lands.noFree')}</p>`;
  if (me && me.plot && !view.plots[me.plot].sale) h += `<p class="small">${t('lands.sellYours')}</p><button data-go="exchange">${esc(t('go.to', { place: placeName('exchange') }))}</button>`;
  const dt = (view.market.trades || []).filter((x) => x.deed);
  if (dt.length) h += `<h4>${t('ex.trades')}</h4><ul class="decided">${dt.slice(0, 6).map((x) => `<li>${esc(placeName(x.deed))} · ${x.price} EMWK · ${esc(x.seller)} → ${esc(x.buyer)}</li>`).join('')}</ul>`;
  return h + `<p class="muted small">${t('ex.deedNote')}</p>`;
}

function panelPlot(b) {
  const p = view.plots[b.id] || {}, me = view.player, B = p.build || view.land.build;
  let h = `<h2>${esc(placeName(b.id))}</h2>`;
  if (p.district) h += `<p class="muted small">${t('district.where.' + p.district)}</p>`;
  const deed = p.deed;
  if (p.mine) {
    h += deedCard(b.id, p, true) + `<div class="contract"><b>${t('plot.yours')}</b>`;
    if (p.built) {
      const leased = p.lease && p.lease.tenant;
      h += `<p class="small">${t(p.bed ? 'bed.yes' : 'bed.none', { p: view.npcs.carpenter.sells.bed })}</p>`;
      if (!p.bed) h += `<button data-go="carpenter">${esc(t('go.to', { place: placeName('carpenter') }))}</button>`;
      if (!leased) h += sleepBox(b.id) + (p.bed && !(view.night && me.sleepPlace) ? (me.restedToday ? `<p class="small">${t('house.rested')}</p>` : `<button class="primary" data-act="rest">${t('house.restFullBtn')}</button>`) : '');
      // renting it out
      h += `<p class="sub2">${t('lease.title')}</p>`;
      if (leased) h += `<p class="small">${t('lease.tenant', { name: esc(p.lease.tenant), n: p.lease.rent })}</p>`;
      else if (p.lease) h += `<p class="small">${t('lease.listed', { n: p.lease.rent })}</p><button data-act="unlistHome" data-plot="${b.id}">${t('lease.unlist')}</button>`;
      else if (p.bed) h += `<p class="muted small">${t('lease.help')}</p><div class="row"><input id="lease-rent" type="number" min="${view.land.lease.min}" max="${view.land.lease.max}" value="8"> EMWK <button class="primary" data-act="listHome" data-plot="${b.id}">${t('lease.list')}</button></div>`;
      else h += `<p class="muted small">${t('lease.needBed')}</p>`;
    } else {
      const have = me.inv.lumber || 0, ok = have >= B.lumber && me.coins >= B.fee;
      h += `<p class="small">${t('plot.buildInfo', { n: B.lumber, have, fee: B.fee, place: placeName(B.builder || 'carpenter') })}</p>` +
        `<button class="primary big" data-act="buildHouse" ${ok ? '' : 'disabled'}>${t('plot.build')}</button>` +
        (have < B.lumber ? `<p class="muted small">${t('plot.getLumber', { place: placeName('woodcutter') })}</p><button data-go="woodcutter">${esc(t('go.to', { place: placeName('woodcutter') }))}</button>` : '');
    }
    h += `</div>`;
  } else if (p.owner) {
    h += `<p>${t(p.built ? 'plot.homeOf' : 'plot.ownedBy', { name: esc(p.owner) })}</p>` + (deed ? deedCard(b.id, p, false) : '');
    if (p.sale && me) h += `<div class="contract"><b>${t('ex.deedForSale', { n: p.sale.price })}</b>` + (me.plot ? `<p class="muted small">${t('plot.haveOne', { place: placeName(me.plot) })}</p>` : `<button class="primary" data-act="buyDeed" data-plot="${b.id}" ${me.coins < p.sale.price ? 'disabled' : ''}>${t('ex.buyDeed', { n: p.sale.price })}</button>`) + `</div>`;
    if (p.lease && p.lease.mine) h += sleepBox(b.id) + `<div class="contract"><b>${t('lease.youRent', { n: p.lease.rent })}</b><button class="linkbtn" data-act="leaveLease">${t('lease.leave')}</button></div>`;
    else if (p.lease && !p.lease.tenant && me) h += `<div class="contract"><b>${t('lease.offer', { name: esc(p.owner), n: p.lease.rent })}</b><p class="small">${t('lease.offerInfo')}</p>` +
      (me.home || me.lease ? `<p class="muted small">${t('lease.haveHome')}</p>` : `<button class="primary" data-act="leaseHome" data-plot="${b.id}" ${me.coins < p.lease.rent ? 'disabled' : ''}>${t('lease.rentIt', { n: p.lease.rent })}</button>`) + `</div>`;
  } else if (!p.open) {
    h += `<p class="closed">${t('district.notOpen')}</p><button data-go="council">${esc(t('go.to', { place: placeName('council') }))}</button>`;
  } else {
    h += `<p>${t('plot.forSale', { n: p.price })}</p><p class="muted small">${t(p.district ? 'plot.priceFar' : 'plot.priceCentre')}</p><p class="muted small">${t('plot.deedInfo')}</p><p class="small rule">${t('plot.oneRule')}</p>`;
    if (p.minLevel && me && me.level < p.minLevel) h += `<p class="closed small">${t('plot.needLevel', { n: p.minLevel, have: me.level })}</p>`;
    else if (me && me.plot) h += `<p class="closed"><b>${t('plot.haveOne', { place: placeName(me.plot) })}</b><br>${t('plot.oneRule')}</p>`;
    else h += `<button class="primary big" data-act="buyPlot" ${!me || me.coins < p.price ? 'disabled' : ''}>${t('plot.buy', { n: p.price })}</button>` + (me && me.coins < p.price ? `<p class="closed small">${t('plot.needCoins', { n: p.price, have: Math.floor(me.coins) })}</p>` : '') + payBox('plot:' + b.id, p.price);
  }
  return h + `<p class="muted small">${t('plot.note', { n: B.lumber, fee: B.fee })}</p>`;
}

// the signpost by the gate: the neighbourhoods and how to open them
function panelRoadsign() {
  const d = view.districts;
  let h = `<h2>${t('b.roadsign')}</h2><p>${t('district.intro', { free: d.free })}</p>`;
  for (const n of Object.keys(d.defs).map(Number)) {
    const def = d.defs[n], open = d.open.includes(n) || def.alwaysOpen;
    if (def.alwaysOpen) { h += `<div class="contract"><b>${t('district.' + n)}</b><p class="small">${t('district.about.3')}</p><button class="primary" data-go="go-d${n}">${t('district.visit', { name: t('district.' + n) })}</button></div>`; continue; }
    const plots = Object.values(view.plots).filter((x) => x.district === n), freeN = plots.filter((x) => !x.owner).length;
    const prices = plots.map((x) => x.price);
    h += `<div class="contract"><b>${t('district.' + n)}</b><p class="small">${t('district.about.' + n, { min: Math.min(...prices), max: Math.max(...prices), lvl: def.minLevel })}</p>` +
      (open ? `<p class="small ok">${t('district.isOpen', { n: freeN, all: plots.length })}</p>` : `<p class="small">${t(d.next === n ? 'district.canOpen' : 'district.later', { cost: def.cost })}</p>`) +
      `<button class="primary" data-go="go-d${n}">${t('district.visit', { name: t('district.' + n) })}</button></div>`;
  }
  return h;
}

// where each plot lies, in words (shown on the deed)
const PLOT_SIDE = { 'plot-1': 'west', 'plot-2': 'south', 'plot-3': 'east', 'plot-4': 'north' };
// the deed: a paper certificate with the plot, its place, the day it was bought and its NFT on NEAR
function deedCard(id, p, mine) {
  const deed = p.deed;
  if (!deed) return '';
  const c = view.chain || {}, d = c.deeds || {}, me = view.player || {};
  let st, cls = 'wait';
  if (deed.minted && d.contract) {
    const held = c.accounts && deed.owner === c.accounts.bank;
    cls = held ? 'held' : 'ok';
    st = held ? t(mine ? 'deed.st.held' : 'deed.st.heldOther') : t('deed.st.ok', { id: esc(deed.owner) });
  } else if (d.status === 'need-funds') st = t('deed.st.funds', { n: d.detail && d.detail.amount, addr: esc((d.detail && d.detail.address) || '') });
  else if (d.status === 'error') st = t('deed.st.error');
  else if (!c.status || c.status !== 'ready') st = t('deed.st.offline');
  else st = t('plot.deedWait');
  const link = deed.minted && d.contract ? exLink('nft-token/' + d.contract + '/' + encodeURIComponent(deed.tokenId), t('plot.deedLink')) : '';
  const wallet = mine && cls === 'held' ? `<p class="small">${me.near && !me.nearVerified ? t('deed.verifyHint') : t('deed.connectHint')}</p><button data-act="open-near">${t('deed.openNear')}</button>` : '';
  const meteor = mine && cls === 'ok' ? `<p class="muted small">${t('deed.meteorHint')}</p>` : '';
  return `<div class="deed"><div class="deed-head"><span class="seal">✦</span><div><b>${t('deed.title')}</b><div class="small">${esc(placeName(id))} · ${p.district ? t('district.' + p.district) : t('deed.side.' + (PLOT_SIDE[id] || 'west'))}</div></div></div>` +
    `<div class="deed-rows"><div><span>${t('deed.owner')}</span><b>${esc(p.owner || '')}</b></div><div><span>${t('deed.since')}</span><b>${t('ui.day', { n: p.since || '?' })}</b></div><div><span>${t('deed.nft')}</span><code>${esc(deed.tokenId)}</code></div></div>` +
    `<p class="deed-st ${cls}">${st}</p>${link ? `<p class="small">${link}</p>` : ''}${wallet}${meteor}</div>`;
}

function boardSection() {
  const me = view.player;
  let h = `<h3 class="board-h">${t('board.title')}</h3><p class="sub2">${t('board.jobs')}</p>`;
  h += view.jobOffers.length ? view.jobOffers.map((o) => `<div class="trow"><span>${esc(t('board.jobRow', { place: placeName(o.npc), n: o.wage, days: o.days }))}</span><button data-go="${o.npc}">${t('board.go')}</button></div>`).join('')
    : `<p class="muted small">${t('board.noJobs')}</p>`;
  if (me && me.job) h += `<div class="trow"><span><b>${esc(t('me.job', { place: placeName(me.job.npc), days: me.job.daysLeft }))}</b></span><button data-go="${me.job.npc}">${t('board.go')}</button></div>`;
  h += `<p class="sub2">${t('board.homes')}</p>` + Object.entries(view.houses).map(([id, x]) =>
    `<div class="trow"><span>${esc(t('board.homeRow', { place: placeName(id), r: x.rent }))} · <span class="${x.tenant ? 'muted' : 'ok'}">${x.mine ? t('board.yours') : x.tenant ? esc(x.tenant) : t('house.free')}</span></span><button data-go="${id}">${t('board.go')}</button></div>`).join('');
  h += `<p class="sub2">${t('board.land')}</p>` + Object.entries(view.plots || {}).filter(([, x]) => x.open && (!x.owner || x.mine || (x.lease && !x.lease.tenant))).slice(0, 8).map(([id, x]) =>
    `<div class="trow"><span>${esc(placeName(id))} · <span class="${x.owner ? 'muted' : 'ok'}">${x.mine ? t('board.yours') : x.lease && !x.lease.tenant ? t('lease.forRent', { n: x.lease.rent }) : t('plot.price', { n: x.price })}</span></span><button data-go="${id}">${t('board.go')}</button></div>`).join('') +
    `<div class="trow"><span class="muted small">${t('district.boardHint', { n: view.districts.free })}</span><button data-go="roadsign">${t('board.go')}</button></div>`;
  return h;
}




// ---------- the NEAR Intents bridge picture: where the money goes, step by step ----------
const ASSET_COLOR = { BTC: '#f2a33a', ETH: '#7b8cde', SOL: '#9b6bf2', USDC: '#3a7bd5', NEAR: '#24302e' };
function bridgeSvg(from, to, live, mode) {
  const node = (x, a, right) => {
    const c = ASSET_COLOR[a.sym] || '#556';
    return `<g><circle cx="${x}" cy="74" r="30" fill="${c}"/><text x="${x}" y="79" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${esc(a.sym)}</text>` +
      (a.chain ? `<text x="${x}" y="122" text-anchor="middle" font-size="11" fill="#7a6b58">${esc(a.chain)}</text>` : '') +
      (a.amount != null ? `<text x="${x}" y="30" text-anchor="middle" font-size="13" font-weight="700" fill="${live ? '#2f7a3a' : '#7a6b58'}">${esc(String(a.amount))}</text>` : '') + `</g>`;
  };
  const deck = (x1, x2) => `M${x1} 74 Q${(x1 + x2) / 2} 40 ${x2} 74`;
  const arch = (x1, x2) => `<path d="${deck(x1, x2)}" fill="none" stroke="#b98a5a" stroke-width="5" stroke-linecap="round" ${live ? '' : 'stroke-dasharray="6 6" opacity=".6"'}/>` +
    [0.25, 0.5, 0.75].map((f) => { const x = x1 + (x2 - x1) * f, y = 74 - 34 * 4 * f * (1 - f) * 1; return `<line x1="${x}" y1="${y + 2}" x2="${x}" y2="96" stroke="#c9a77f" stroke-width="2"/>`; }).join('');
  const coins = (x1, x2, color, delay) => live ? [0, 0.8, 1.6].map((b) => `<circle r="5" fill="${color}" stroke="#fff" stroke-width="1.5" opacity="0"><set attributeName="opacity" to="1" begin="${b + delay}s"/><animateMotion dur="2.4s" begin="${b + delay}s" repeatCount="indefinite" path="${deck(x1, x2)}"/></circle>`).join('') : '';
  const fc = ASSET_COLOR[from.sym] || '#556', tc = ASSET_COLOR[to.sym] || '#556';
  let svg = `<svg class="bridge" viewBox="0 0 440 140" role="img" aria-label="${esc(t('bridge.aria', { a: from.sym, b: to.sym }))}">` +
    `<rect x="0" y="96" width="440" height="44" rx="10" fill="#cfe3ee"/><path d="M0 104 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#a9cbe0" stroke-width="2" fill="none"/>` +
    arch(85, 168) + arch(272, 355) + coins(85, 168, fc, 0) + coins(272, 355, tc, 1.2) +
    `<g><rect x="168" y="48" width="104" height="52" rx="12" fill="#fff8ee" stroke="#e0742b" stroke-width="2"/><text x="220" y="70" text-anchor="middle" font-size="13" font-weight="700" fill="#b4531c">NEAR Intents</text>` +
    `<text x="220" y="88" text-anchor="middle" font-size="10" fill="#7a6b58">${esc(t('bridge.solvers'))}</text>` +
    [196, 220, 244].map((x, i) => `<circle cx="${x}" cy="56" r="3" fill="#e0742b">${live ? `<animate attributeName="opacity" values="1;.2;1" dur="1.2s" begin="${i * 0.3}s" repeatCount="indefinite"/>` : ''}</circle>`).join('') + `</g>` +
    node(55, from) + node(385, to);
  if (mode === 'plot' || mode === 'house') svg += `<g transform="translate(408 40)"><polygon points="0,10 12,0 24,10" fill="#c0443a"/><rect x="3" y="10" width="18" height="13" fill="#f3e3c4"/></g>`;
  svg += `</svg>`;
  const steps = mode === 'swap'
    ? [['quote', true], ['sign', false], ['solve', false], ['out', false]]
    : [['quote', true], ['deposit', false], ['solve', false], ['arrive', false], [mode, false]];
  const done = (k) => k === 'quote' && live;
  return `<div class="bridgebox">${svg}<ol class="bsteps">${steps.map(([k, now]) => `<li class="${done(k) ? 'done' : now ? 'now' : ''}">${done(k) ? '✓ ' : ''}${t('bridge.s.' + k, { sym: to.sym, chain: to.chain, near: to.amount })}${!now ? ` <span class="muted">· ${t('bridge.mainnet')}</span>` : ''}</li>`).join('')}</ol></div>`;
}

// universal checkout preview: pay an EMWK price from another chain through NEAR Intents (a live quote, nothing is sent)
const PAY_FROM = [['USDC-SOL', 'USDC · Solana'], ['USDC-ETH', 'USDC · Ethereum'], ['ETH', 'ETH · Ethereum'], ['BTC', 'BTC · Bitcoin'], ['SOL', 'SOL · Solana']];
function payBox(what, emwk) {
  const st = ui.pay && ui.pay.what === what ? ui.pay : null;
  if (!st) return `<button class="linkbtn" data-act="payOpen" data-what="${esc(what)}" data-emwk="${emwk}">${t('pay.open')}</button>`;
  let h = `<div class="contract pay"><b>${t('pay.title')}</b><p class="small">${t('pay.lead', { n: emwk, near: Math.round(emwk / (world.rules.emwkPerNear || 100) * 100) / 100 })}</p>` +
    `<div class="row exform"><select id="pay-from">${PAY_FROM.map(([k, label]) => `<option value="${k}"${st.from === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select><button class="primary" data-act="payQuote" data-emwk="${emwk}">${t('pay.get')}</button></div>`;
  const q = st.quote;
  const def = PAY_FROM.find((x) => x[0] === st.from) || PAY_FROM[0], [psym, pchain] = def[1].split(' · ');
  h += bridgeSvg({ sym: psym, chain: pchain, amount: q && q.ok ? q.amountIn : null }, { sym: 'NEAR', chain: 'near', amount: q && q.ok ? q.near : Math.round(emwk / (world.rules.emwkPerNear || 100) * 100) / 100 }, !!(q && q.ok), what.startsWith('house') ? 'house' : 'plot');
  if (q === 'wait') h += `<p class="muted small">${t('ex.loading')}</p>`;
  else if (q && q.ok) h += `<p class="ok"><b>${t('pay.out', { a: q.amountIn, sym: q.from, chain: q.chain, near: q.near })}</b>${q.usdIn ? ` <span class="small">≈ $${q.usdIn}</span>` : ''}${q.timeEstimate ? ` <span class="muted small">· ${t('pay.time', { n: q.timeEstimate })}</span>` : ''}</p>`;
  else if (q) h += `<p class="muted small">${/fetch failed|abort|ENOTFOUND|ECONN/i.test(q.error || '') || !q.error ? t('ex.offline') : t('ex.quoteFailed', { why: esc(q.error) })}</p>`;
  return h + `<p class="muted small">${t('pay.note')}</p></div>`;
}

// ---------- the village council ----------

function proposalText(x) {
  const p = x.params;
  if (x.kind === 'grant') return t('prop.grant', { n: p.amount, name: npcName(p.npc) });
  if (x.kind === 'tax') return t('prop.tax', { n: Math.round(p.rate * 100) });
  if (x.kind === 'welcome') return t('prop.welcome', { n: p.amount });
  if (x.kind === 'festival') return t('prop.festival', { n: p.amount });
  if (x.kind === 'tower') return t('prop.tower', { n: p.cost });
  if (x.kind === 'district') return t('prop.district', { name: t('district.' + p.n), n: p.cost });
  if (x.kind === 'reserve') return t('prop.reserve', { pct: p.pct, asset: p.asset }) + (p.amount ? ` (${p.amount} EMWK)` : '');
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
      (x.kind === 'reserve' ? `<div class="small quote">${x.quote ? (x.quote.ok ? t('prop.reserveQuote', { emwk: x.quote.emwk, near: x.quote.near, out: x.quote.out, asset: x.params.asset, usd: x.quote.usd || '?' }) : t('prop.reserveNoQuote')) : t('prop.reserveWait')}</div>` : '') +
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
    if (k === 'reserve') h += `<input id="prop-pct" type="number" min="${r.reserve.min}" max="${r.reserve.max}" value="10"> % → <select id="prop-asset">${r.reserve.assets.map((a) => `<option>${a}</option>`).join('')}</select>`;
    const nd = view.districts.next, ndef = nd && view.districts.defs[nd];
    h += `<p class="muted small">${k === 'district' ? (nd ? t('prop.help.district', { name: t('district.' + nd), n: ndef.cost, free: view.districts.free }) : t('err.noDistrict')) : t('prop.help.' + k, { n: r.tower ? r.tower.cost : 250, r: r.tower ? r.tower.readiness : 10 })}</p><button class="primary" data-act="propose" ${c.open.length >= r.maxOpen ? 'disabled' : ''}>${t('council.submit', { n: r.fee })}</button></div>`;
    if (c.open.length >= r.maxOpen) h += `<p class="muted small">${t('council.full')}</p>`;
  }

  if (c.closed.length) {
    h += `<p class="sub2">${t('council.closed')}</p><ul class="decided">${c.closed.map((x) => `<li><span class="res ${x.result}">${t('council.res.' + x.result)}</span> #${x.id} ${esc(proposalText(x))} <span class="muted small">(${t('council.tally', { y: Math.round(x.yes), n: Math.round(x.no), v: x.voters })})</span> ${councilTx(x.id)}</li>`).join('')}</ul>`;
  }
  return h + `<p class="muted small">${t('council.rule', { q: c.rules.quorum })}</p>`;
}

// link to the council decision's record on NEAR, once it has been sent
function councilTx(id) {
  const c = view.chain;
  if (!c || !c.feed) return '';
  for (const f of c.feed) if (f.ok && f.hash && f.items.some((it) => it.council === id)) return exLink('txns/' + f.hash, t('council.onNear'));
  return '';
}

async function councilAct(type, extra) {
  const r = await post('/api/action', { player: playerId, type, ...extra });
  if (r.state && newer(r.state)) { view = r.state; render(); }
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
  if (c.lowGas) h += `<div class="near-box warn"><p>${t('near.lowGas')}</p><code class="addr">${esc(c.lowGas.address)}</code>` +
    `<div class="row"><button data-act="near-copy" data-copy="${esc(c.lowGas.address)}">${t('near.copy')}</button>` +
    `<a class="btnlink" href="${c.wallet}" target="_blank" rel="noopener">${t('near.openWallet')}</a></div></div>`;
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
    if (c.deeds && c.deeds.contract) h += `<p class="sub2">${t('near.deeds')}</p><p>${c.deeds.status === 'ready' ? exLink('nft-token/' + c.deeds.contract, esc(c.deeds.contract)) : esc(c.deeds.contract) + ' · ' + esc(c.deeds.status) + (c.deeds.detail && c.deeds.detail.amount ? ` (${t('near.st.need-funds', { n: c.deeds.detail.amount })} <code class="addr">${esc(c.deeds.detail.address)}</code>)` : '')}</p>`;
    h += `<p class="sub2">${t('near.accounts')}</p><table class="near-acc">${[a.bank, a.treasury, a.deposits, ...Object.values(a.npcs)].filter(Boolean).map(row).join('')}</table>`;
  }

  h += `<p class="sub2">${t('near.wallet')}</p>`;
  const meteor = chainOk() && window.EmberwickWallet;
  if (!me) h += `<p class="muted small">${t('near.joinFirst')}</p>`;
  else if (me.near) {
    h += `<p>${t('near.linked', { id: '' })}${c.explorer ? exLink('address/' + me.near, esc(me.near)) : esc(me.near)} ` +
      (me.nearVerified ? `<span class="ok small">${t('near.verified')}</span>` : `<span class="muted small">${t('near.unverified')}</span>`) + `</p>`;
    if (!me.nearVerified && meteor) h += `<button data-act="near-meteor" class="${ui.challenge ? 'primary' : ''}">${ui.challenge ? t('near.signStep', { id: esc(ui.challenge.account) }) : t('near.verifyBtn')}</button>`;
    h += `<p class="muted small">${t('near.cashHelp', { n: me.coins })}</p>`;
    if (me.withdrawn) h += `<p class="muted small">${t('near.withdrawn', { n: me.withdrawn })}</p>`;
    h += chainOk()
      ? `<div class="row"><input id="near-amount" type="number" min="1" step="1" max="${Math.floor(me.coins)}" value="${Math.min(10, Math.floor(me.coins))}"><button class="primary" data-act="near-withdraw" ${me.coins < 1 ? 'disabled' : ''}>${t('near.cashout')}</button></div>`
      : `<p class="muted small">${t('near.needReady')}</p>`;
    if ((me.nearVerified || ui.meteorAccount === me.near) && meteor) {
      h += `<p class="muted small">${t('near.depositHelp', { bank: esc(c.accounts.bank) })}</p>` +
        `<div class="row"><input id="near-dep" type="number" min="1" step="1" value="5"><button data-act="near-deposit">${t('near.deposit')}</button></div>`;
      if (me.deposited) h += `<p class="muted small">${t('near.deposited', { n: me.deposited })}</p>`;
      h += `<details class="small"><summary>${t('near.claimTitle')}</summary><p class="muted small">${t('near.claimHelp', { id: esc(me.near) })}</p>` +
        `<div class="row"><input id="near-claim" placeholder="Fx3…" autocomplete="off" spellcheck="false"><button data-act="near-claim">${t('near.claim')}</button></div></details>`;
    }
    if (ui.nearBusy) h += `<p class="status">${t(ui.nearBusy)}</p>`;
  } else {
    if (meteor) h += `<button class="primary big" data-act="near-meteor">${ui.challenge ? t('near.signStep', { id: esc(ui.challenge.account) }) : t('near.meteor')}</button><p class="muted small">${t('near.meteorHelp')}</p>`;
    if (ui.nearBusy) h += `<p class="status">${t(ui.nearBusy)}</p>`;
    h += `<p class="muted small">${t('near.orType')}</p><div class="row"><input id="near-account" placeholder="name.testnet" autocomplete="off" spellcheck="false"><button data-act="near-link">${t('near.link')}</button></div>`;
  }
  return h;
}

async function nearLink(account) {
  const r = await post('/api/near/link', { player: playerId, account });
  if (r.state) { view = r.state; render(); }
  if (r.ok) toast(t('toast.linked', { id: r.near }), 'win'); else toast(errText(r), 'bad');
}
// Meteor Wallet sign-in: the wallet signs a one-time message (NEP-413), the server checks it
async function nearMeteor() {
  const c = view.chain, W = window.EmberwickWallet;
  try {
    // step 1: sign in (opens Meteor). Step 2 is its own click, so the browser lets the wallet open again.
    if (!ui.challenge) {
      ui.nearBusy = 'near.busyWallet'; renderPanel();
      const account = await W.signIn(c.network, c.accounts.token);
      if (!account) throw new Error('no account');
      const ch = await (await fetch(`/api/near/challenge?player=${playerId}`)).json();
      if (!ch.ok) throw new Error(ch.code);
      ui.challenge = { ...ch, account };
      renderWalletBtn();
      return;
    }
    ui.nearBusy = 'near.busySign'; renderPanel();
    const ch = ui.challenge;
    const signed = await W.signMessage(c.network, ch);
    const r = await post('/api/near/verify', { player: playerId, accountId: (signed && signed.accountId) || ch.account, publicKey: signed && signed.publicKey, signature: signed && signed.signature, page: location.href, origin: location.origin });
    ui.challenge = null;
    ui.meteorAccount = ch.account; // signed in through Meteor in this browser
    if (r.state) view = r.state;
    if (r.ok) toast(r.verified ? t('toast.verified', { id: r.near }) : t('toast.connected', { id: r.near }), r.verified ? 'win' : ''); else toast(errText(r), 'bad');
  } catch (e) {
    console.log('wallet', e);
    clientLog('sign-in failed: ' + (e && (e.message || e)));
    ui.challenge = null;
    toast(t('err.walletFailed'), 'bad');
  } finally { ui.nearBusy = null; render(); }
}

// the player sends EMWK from their own wallet to the village bank, then the server checks the transaction
const clientLog = (msg) => post('/api/near/clientlog', { msg }).catch(() => {});

// a deposit whose result did not come back (closed tab, slow wallet): claim it with its transaction hash
async function nearClaim(hash) {
  hash = String(hash || '').trim();
  if (!hash) return;
  ui.nearBusy = 'near.busyCheck'; renderPanel();
  const r = await post('/api/near/deposit', { player: playerId, hash });
  ui.nearBusy = null;
  if (r.state) view = r.state;
  if (r.ok) { toast(t('toast.deposited', { n: r.amount }), 'win'); popupYou(`+${r.amount} EMWK`, '#a8461a'); flash('coins'); } else toast(errText(r), 'bad');
  render();
}

async function nearDeposit(amount) {
  const c = view.chain, W = window.EmberwickWallet, me = view.player;
  amount = Math.floor(Number(amount));
  if (!(amount >= 1)) return toast(t('err.minWithdraw'), 'bad');
  try {
    ui.nearBusy = 'near.busyWallet'; renderPanel();
    const acct = await W.accountId(c.network);
    if (acct !== me.near) await W.signIn(c.network, c.accounts.token);
    const hash = await W.ftTransfer(c.network, c.accounts.token, c.accounts.bank, String(amount * 100), `Emberwick deposit for ${playerId}`);
    if (!hash) { clientLog('deposit: the wallet returned no transaction hash'); toast(t('near.noHash'), 'bad'); return; }
    ui.nearBusy = 'near.busyCheck'; renderPanel();
    let r;
    for (let i = 0; i < 6; i++) { // the chain needs a moment to finalise
      r = await post('/api/near/deposit', { player: playerId, hash });
      if (r.ok || r.code !== 'err.depositBad') break;
      await new Promise((ok) => setTimeout(ok, 2500));
    }
    if (r.state) view = r.state;
    if (r.ok) { toast(t('toast.deposited', { n: r.amount }), 'win'); popupYou(`+${r.amount} EMWK`, '#a8461a'); flash('coins'); } else toast(errText(r), 'bad');
  } catch (e) {
    console.log('deposit', e);
    clientLog('deposit failed: ' + (e && (e.message || e)));
    toast(t('err.walletFailed'), 'bad');
  } finally { ui.nearBusy = null; render(); }
}

async function nearWithdraw(amount) {
  const r = await post('/api/near/withdraw', { player: playerId, amount });
  if (r.state) { view = r.state; render(); }
  if (r.ok) toast(t('toast.withdrew', { n: r.amount, id: r.wallet }), 'win'); else toast(errText(r), 'bad');
}
// the wallet is always one click away in the top bar
function renderWalletBtn() {
  const btn = $('wallet-btn'), me = view.player;
  if (!me || !chainOk()) { btn.hidden = true; return; }
  btn.hidden = false;
  if (me.near) {
    btn.className = 'wallet-btn linked';
    btn.innerHTML = `<span class="wdot"></span>${esc(shortId(me.near))} ${me.nearVerified ? '✓' : `<span class="muted">${t('near.unverifiedShort')}</span>`}`;
  } else {
    btn.className = 'wallet-btn';
    btn.textContent = ui.challenge ? t('near.signStep', { id: shortId(ui.challenge.account) }) : t('near.meteor');
  }
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
  $('me').innerHTML = `<div class="me-row">${avatarSvg(me.path)}<div class="who"><h3>${esc(me.name)} <button class="editname" data-rename="1" title="${esc(t('rename.title'))}" aria-label="${esc(t('rename.title'))}">✎</button></h3><div class="sub">${t('path.' + me.path)} · ${t('me.level', { n: me.level })}</div></div><div class="coins">${me.coins.toFixed(0)} <small>EMWK</small></div></div>` +
    `<div class="energy" id="energy-row" title="${esc(t('rank.' + String(me.rank).toLowerCase()))}">${t('me.energy')} <div class="bar"><div class="fill" style="width:${(me.energy / me.maxEnergy) * 100}%"></div></div>${Math.floor(me.energy)}/${me.maxEnergy}</div>` +
    ((me.asleep || me.cold || me.freezing || me.coatLeft) ? `<div class="conds">${me.asleep ? `<span class="cond sleep">☾ ${t('cond.asleep')}</span>` : ''}${me.cold ? `<span class="cond bad">${t('cond.cold', { n: view.rules ? '' : 3 })}</span>` : ''}${me.freezing ? `<span class="cond bad">❄ ${t('cond.freezing')}</span>` : ''}${me.coatLeft ? `<span class="cond ok">${t('cond.coat', { n: me.coatLeft })}</span>` : ''}</div>` : '') +
    `<div class="shortcuts"><button class="chip strong" data-trade="1">${t('trade.btn')}</button><button class="chip strong" data-board="1">${t('hud.board', { n: view.jobOffers.length })}</button><button class="chip strong" data-go="council">${t('hud.council', { n: view.council.open.length })}</button><button class="chip strong" data-go="roadsign">${t('hud.districts')}</button><button class="chip strong" data-lands="1">${t('lands.btn', { n: Object.values(view.plots).filter((x) => x.sale || (!x.owner && x.open)).length })}</button></div>` +
    (me.job || me.home || me.plot || me.lease ? `<div class="contracts">${me.job ? `<button class="chip" data-go="${me.job.npc}" title="${esc(t('me.jobInfo', { start: me.job.startDay, done: Math.max(0, view.day - me.job.startDay), total: me.job.daysLeft + Math.max(0, view.day - me.job.startDay), a: me.job.shiftsToday, b: me.job.maxShifts, all: me.job.shifts, earned: me.job.shifts * me.job.wage }))}">${esc(t('me.job', { place: placeName(me.job.npc), days: me.job.daysLeft }))}</button>` : ''}${me.lease ? `<button class="chip" data-go="${me.lease}">${esc(t('me.home', { place: placeName(me.lease) }))}</button>` : ''}${me.home ? `<button class="chip" data-go="${me.home.id}" title="${esc(t('me.homeInfo', { r: me.home.rent, left: dayLeftText() }))}">${esc(t('me.home', { place: placeName(me.home.id) }))}</button>` : ''}${me.plot ? `<button class="chip deedchip" data-go="${me.plot}" title="${esc(t('deed.title'))}">✦ ${esc(t('deed.badge', { place: placeName(me.plot) }))}${(view.plots[me.plot] || {}).deed && view.plots[me.plot].deed.minted ? ' · NFT ✓' : ''}</button>` : ''}</div>` : '') +
  '';
  const q = me.questInfo;
  ui.target = q.target;
  const qt = questTexts(q);
  const prog = q.progress ? `<div class="prog"><div style="width:${Math.min(100, (q.progress[0] / q.progress[1]) * 100)}%"></div></div><div class="reward" style="margin:-4px 0 8px">${Math.min(q.progress[0], q.progress[1])} / ${q.progress[1]}</div>` : '';
  $('quest').innerHTML = `<div class="step">${q.id === 'done' ? t('quest.allDone') : t('quest.step', { n: q.index + 1, total: q.total })}${q.reward ? ` · <span class="reward">${t('quest.reward', { n: q.reward })}</span>` : ''}</div><h4 title="${esc(qt.text)}">${esc(qt.title)}</h4><p>${esc(qt.text)}</p>${prog}` +
    `<div class="qrow">${q.target ? `<button class="primary" data-go="${q.target}">${t('quest.showMe')}</button>` : ''}<button class="linkbtn" data-guide="1">${t('quest.help')}</button></div>`;
  $('quest').hidden = false;
}

// ---------- the bottom panel: bag, wealth, skills, this shop ----------

const TOOL_SHOP = { pickaxe: 'smithy', axe: 'woodcutter', plow: 'mill', shears: 'tailor', rod: 'carpenter' };
const TOOL_OF = { ore: 'pickaxe', wood: 'axe', wheat: 'plow', wool: 'shears', fish: 'rod' };
const TOOL_GOODS = new Set([...Object.values(TOOL_OF), 'coat', 'bed']);

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
  // bag: one chip per item, tools show how worn they are
  let goodsValue = 0;
  const chips = Object.entries(me.inv).filter(([, q]) => q > 0).map(([g, q]) => {
    const v = goodValue(g);
    goodsValue += v * q;
    const tool = world.goods[g] && world.goods[g].kind === 'tool' && TOOL_SHOP[g];
    const left = tool ? me.toolUses - ((me.wear || {})[g] || 0) : null;
    const tip = (v ? t('dock.worth', { p: v }) : '') + (tool ? ' · ' + t('dock.uses', { n: left, max: me.toolUses }) : '');
    return `<span class="ichip" title="${esc(tip)}"><b>${q}</b> ${goodName(g)}` +
      (tool ? `<i class="iwear"><i style="width:${(left / me.toolUses) * 100}%"></i></i>` : '') +
      (g === 'bread' ? `<button class="eat" data-eat="1">${t('me.eat')}</button>` : '') + `</span>`;
  }).join('');
  const bag = `<div class="dcard bagcard"><h4>${t('dock.bag')} <span class="muted">${goodsValue ? '≈ ' + goodsValue.toFixed(0) + ' EMWK' : ''}</span></h4>` +
    (chips ? `<div class="ichips">${chips}</div>` : `<p class="muted small">${t('dock.empty')}</p>`) + `</div>`;
  // wealth: four numbers that matter
  const coins = me.coins, total = coins + goodsValue, profit = total - me.startCoins, st = me.stats || {};
  const big = (k, v, cls = '') => `<div class="num"><span>${t(k)}</span><b class="${cls}">${v}</b></div>`;
  const wealth = `<div class="dcard"><h4>${t('dock.wealth')}</h4><div class="nums">` +
    big('w.coins', coins.toFixed(0)) + big('w.goods', goodsValue.toFixed(0)) + big('w.total', total.toFixed(0)) +
    big('w.profit', `${profit >= 0 ? '+' : ''}${profit.toFixed(0)}`, profit >= 0 ? 'up' : 'down') + `</div>` +
    `<div class="muted small" title="${esc(t('w.taxes'))}: ${(st.taxes || 0).toFixed(1)} EMWK">${t('w.earned')} ${(st.earned || 0).toFixed(0)} · ${t('w.spent')} ${(st.spent || 0).toFixed(0)}</div></div>`;
  // skills: four slim bars
  const skillRow = (s) => {
    const k = me.skills[s];
    const pct = k.to ? ((k.xp - k.from) / (k.to - k.from)) * 100 : 100;
    const spot = { farming: 'fields', woodcutting: 'forest', mining: 'mine' }[s];
    const eff = s === 'trading' ? t('skill.tradeEffect', { p: Math.round(me.tradeBonus * 100) }) : t('skill.effect', { n: k.level - 1, e: me.costs[spot] });
    return `<div class="sk" title="${esc(eff + ' · ' + (k.to ? t('skill.next', { a: k.xp, b: k.to }) : t('skill.max')))}"><span>${t('skill.' + s)}</span><b>${k.level}</b><div class="xp"><div style="width:${pct}%"></div></div></div>`;
  };
  const skills = `<div class="dcard skills"><h4>${t('dock.skills')}</h4><div class="sks">${['farming', 'woodcutting', 'mining', 'trading'].map(skillRow).join('')}</div></div>`;
  // market prices: what the best shop pays for raw goods and what bread costs
  const priceRow = (g, kind) => {
    const shops = Object.values(view.npcs).filter((n) => (kind === 'buy' ? n.buys : n.sells)[g] !== undefined);
    if (!shops.length) return '';
    const best = kind === 'buy' ? Math.max(...shops.map((n) => n.buys[g])) : Math.min(...shops.map((n) => n.sells[g]));
    const hist = view.history[g] || [];
    const prev = hist.length > 6 ? hist[hist.length - 7] : best;
    const arrow = best > prev + 0.4 ? '<span class="up">▲</span>' : best < prev - 0.4 ? '<span class="down">▼</span>' : '<span class="muted">•</span>';
    return `<div class="pr"><span>${goodName(g)}</span><b>${best}</b>${arrow}</div>`;
  };
  const prices = `<div class="dcard"><h4>${t('dock.prices')}</h4><div class="prs">` +
    priceRow('wheat', 'buy') + priceRow('wood', 'buy') + priceRow('ore', 'buy') + priceRow('bread', 'sell') + priceRow('pickaxe', 'sell') + priceRow('sword', 'sell') +
    `</div></div>`;
  dock.innerHTML = bag + wealth + skills + prices;
}

function logText(l) {
  if (!l.key) return l.text;
  const p = resolve(l.p || {});
  if (p.path) p.path = t('path.' + p.path);
  return t(l.key, p);
}

// real time left until the next game day (rent, new job offers, vote results...)
function dayLeftText() {
  const dayMs = world.rules.ticksPerDay * world.rules.tickMs;
  // count down smoothly between server updates
  if (view !== dayLeftText.view) { dayLeftText.view = view; dayLeftText.at = Date.now(); }
  const ms = Math.max(0, (1 - view.dayProgress) * dayMs - (Date.now() - dayLeftText.at));
  const m = Math.floor(ms / 60000), sec = Math.round((ms % 60000) / 1000);
  return m > 0 ? t('ui.minSec', { m, s: String(sec).padStart(2, '0') }) : t('ui.sec', { s: sec });
}

function renderChrome() {
  $('day').textContent = [t('ui.day', { n: view.day }), view.events.winter ? t('ui.winter') : null, view.dayProgress > 0.8 ? t('ui.night') : null].filter(Boolean).join(' · ');
  $('day-left').textContent = t('ui.dayLeft', { n: dayLeftText() });
  $('pop').textContent = t('ui.pop', { n: view.population, t: view.treasury });
  $('ready-fill').style.width = view.readiness + '%';
  $('ready-num').textContent = view.readiness + '%';
  renderNearPill();
  renderWalletBtn();
  $('view').classList.toggle('night', view.dayProgress > 0.8);
  renderChat();
  $('log').innerHTML = view.log.map((l) => `<li class="${l.kind}">${t('log.day', { n: l.day })}: ${esc(logText(l))}</li>`).join('');
  const e = view.events, banner = $('banner');
  if (view.ff && view.ff.running) { banner.className = 'banner ff'; banner.textContent = t('ff.running', { d: Math.min(7, Math.floor(view.ff.done / world.rules.ticksPerDay) + 1), p: Math.round((view.ff.done / view.ff.total) * 100) }); banner.hidden = false; }
  else if (e.attackDay) { banner.className = 'banner danger'; banner.textContent = t('banner.attack', { day: e.attackDay, ready: view.readiness }); banner.hidden = false; }
  else if (e.drought > 0) { banner.className = 'banner warn'; banner.textContent = t('banner.drought'); banner.hidden = false; }
  else if (view.night && !(view.player && view.player.asleep)) { banner.className = 'banner night'; banner.textContent = t('banner.night'); banner.hidden = false; }
  else if (e.winter) { banner.className = 'banner winter'; banner.textContent = t('banner.winter'); banner.hidden = false; }
  else banner.hidden = true;
}

function renderMapNow() {
  ui.closedTag = t('ui.closedTag'); ui.nightTag = t('closed.night'); ui.mineTag = t('plot.mineTag'); ui.nameOf = placeName;
  view.saleLabel = t('plot.saleTag');
  // the exchange board and the price panel in the exchange quarter show live NEAR Intents prices
  const pr = ui.exPrices && ui.exPrices.ok ? ui.exPrices.tokens : null, px = (k) => { const x = pr && pr.find((y) => y.key === k); return x ? Number(x.price) : null; };
  const fmt = (n) => (n == null ? null : '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : n >= 10 ? Math.round(n) : n.toFixed(2)));
  view.exBoard = pr ? { NEAR: fmt(px('NEAR')), BTC: fmt(px('BTC')), EMWK: px('NEAR') ? fmt(px('NEAR') / (world.rules.emwkPerNear || 100)) : null } : null;
  if (ui.district === 3 && !ui.exPricesLoading && (!ui.exPrices || Date.now() - (ui.exPricesAt || 0) > 60000)) { ui.exPricesLoading = true; loadExPrices(); }
  renderTicker(pr);
  ui.laneName = t('district.1'); ui.villaName = t('district.2'); ui.exName = t('district.3');
  if (ui.district && view.districts) {
    ui.backTag = '← ' + t('district.back'); ui.villaTag = t('district.2') + ' →'; ui.laneTag = t('district.1') + ' →';
    ui.districtTitle = t('district.' + ui.district); ui.closedDistrict = t('district.closedTag'); ui.exTag = t('district.3') + ' →';
    renderDistrict($('map'), world, view, ui);
  } else renderMap($('map'), world, view, ui);
}
function render() {
  // when night falls and you are not in bed yet, the guide asks where you will sleep
  if (view && view.player && view.night && !ui.wasNight && !view.player.sleepPlace) {
    toast(t('night.toast'), 'bad');
    if (!ui.selected || ui.selected === 'guide') ui.selected = 'guide';
  }
  if (view) ui.wasNight = !!view.night;
  const ar = view && view.player && view.player.appResult;
  if (ar && ui.lastApp !== `${ar.npc}|${ar.day}|${ar.hired}`) {
    if (ui.lastApp !== undefined) toast(ar.hired ? t('apply.toastWon', { name: npcName(ar.npc), w: ar.wage }) : t('apply.toastLost', { name: npcName(ar.npc) }), ar.hired ? 'win' : 'bad');
    ui.lastApp = `${ar.npc}|${ar.day}|${ar.hired}`;
  } else if (view && view.player && !ar && ui.lastApp === undefined) ui.lastApp = '';
  setNight(view && view.night);
  const sb = $('sfx-btn'), mb = $('music-btn');
  if (sb) { sb.textContent = sound.sfx ? '🔊' : '🔇'; sb.title = t('sound.sfx'); sb.classList.toggle('off', !sound.sfx); }
  if (mb) { mb.textContent = '♪'; mb.title = t('sound.music'); mb.classList.toggle('off', !sound.music); }
  const ffb = $('ff-btn');
  if (ffb && view) {
    const run = view.ff && view.ff.running;
    ffb.textContent = run ? t('ff.btnRunning', { p: Math.round((view.ff.done / view.ff.total) * 100) }) : t('ff.btn');
    ffb.disabled = !!run || !playerId;
    ffb.title = t('ff.title');
  }
  // when a fast-forward ends, its summary opens over the map once
  if (view && view.week && ui.weekSeen !== view.week.toDay && !(view.ff && view.ff.running)) { ui.weekSeen = view.week.toDay; if (ui.ffAsked) { ui.selected = 'week'; ui.scene = null; } }
  if (world && view) syncOthers(); renderHud(); renderMapNow(); renderChrome(); renderPanel(); renderDock(); renderScene(); }

// ---------- static page text and the language menu ----------

function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('map').setAttribute('aria-label', t('ui.mapLabel'));
  $('lang').setAttribute('aria-label', t('ui.language'));
  $('lang').innerHTML = Object.entries(LANGS).map(([code, d]) => `<option value="${code}"${code === getLang() ? ' selected' : ''}>${d['lang.name']}</option>`).join('');
  document.documentElement.lang = getLang();
  renderTour();
}
$('lang').addEventListener('change', (e) => {
  setLang(e.target.value);
  applyStatic();
  if (!$('join').hidden) showJoin();
  if (!$('elder').hidden) openElder();
  render();
});

// ---------- actions ----------

function renderNow() { render(); }
async function sendHaggle(box) {
  const hg = ui.haggle;
  if (!hg || hg.wait) return;
  if (box) { hg.qty = Number(box.querySelector('.hag-qty').value) || 1; hg.offer = Number(box.querySelector('.hag-offer').value) || 0; }
  if (!(hg.offer > 0)) return toast(t('haggle.price'), 'bad');
  hg.wait = true; render();
  const r = await post('/api/ai/haggle', { player: playerId, npc: hg.npc, good: hg.good, side: hg.side, qty: hg.qty, offer: hg.offer, lang: getLang() });
  hg.wait = false;
  if (r.state && newer(r.state)) view = r.state;
  if (!r.ok) { toast(errText(r), 'bad'); render(); return; }
  hg.reply = { ...r, at: Date.now() };
  play(r.outcome === 'angry' || r.outcome === 'closed' ? 'bad' : 'click');
  render(); setTimeout(render, 26000);
}
async function takeDeal() {
  const r = await post('/api/action', { player: playerId, type: 'deal' });
  if (r.state && newer(r.state)) view = r.state;
  if (!r.ok) { toast(errText(r), 'bad'); render(); return; }
  play('coin');
  toast(t('haggle.done', { n: r.qty, good: goodWord(r.good), p: r.unit, total: r.total }), 'win');
  if (ui.haggle) ui.haggle.reply = { outcome: 'accept', line: t('haggle.say.deal'), unit: r.unit, good: r.good, at: Date.now() };
  render();
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

async function act(type, extra = {}) {
  if (!playerId) return toast(t('toast.join'), 'bad');
  const body = { player: playerId, type, ...extra };
  if (type === 'sell') setTimeout(() => { if (ui.sellQty) delete ui.sellQty[extra.good]; }, 0);
  if (type === 'sell') body.qty = Math.min(view.player.inv[extra.good] || 0, (ui.sellQty || {})[extra.good] || view.player.inv[extra.good] || 0);
  const r = await post('/api/action', body);
  if (r.state && newer(r.state)) { view = r.state; render(); }
  if (r.ok && type !== 'visit') { explain(type, extra, r); if (ui.scene) renderScene(); }
  if (r.ok) play(type === 'buildHouse' || type === 'buyBed' ? 'build' : type === 'sleep' || type === 'rest' ? 'sleep' : /sell|buy|meal|rent|lease|Plot|shift/i.test(type) ? 'coin' : '');
  else if (r.code !== 'err.turnedDown') play('bad');
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
    setTimeout(() => play('level'), 500);
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
  const place = type === 'gather' ? extra.spot : extra.npc || extra.house || extra.plot;
  if (type === 'listHome' || type === 'unlistHome' || type === 'leaseHome' || type === 'leaveLease') {
    result[extra.plot] = { key: 'result.' + type, p: { n: r.rent || 0 } };
    return;
  }
  if (type === 'buy' && r.installed) {
    result[extra.npc] = { key: 'result.bedIn', p: { place: { $place: r.installed } }, next: { key: 'go.to', p: { place: { $place: r.installed } }, go: r.installed } };
    return;
  }
  if (type === 'sleep') {
    result[extra.place] = { key: r.paid ? 'result.sleptInn' : 'result.slept', p: { n: r.paid } };
    if (you) you.inside = extra.place;
    return;
  }
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
      key: r.qty < r.offered ? 'result.soldSome' : 'result.sold', p: { total: r.total, unit: r.unit, tax: r.tax, got, n: r.qty, left: r.offered - r.qty, good: { $good: extra.good } },
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
    result[place] = { key: r.next && r.next.morning ? 'result.appliedNight' : 'result.applied', p: { name: { $npc: place }, n: r.waiting - 1 } };
  } else if (type === 'buyPlot') {
    result[extra.plot] = { key: 'result.boughtPlot', p: { n: r.price } };
    flash('coins');
  } else if (type === 'buildHouse') {
    result[extra.plot] = { key: 'result.builtHome' };
    popup(extra.plot, t('result.builtShort'), '#3a6ea8');
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
  // moving between the village and the neighbourhoods
  if (id === 'go-village') { ui.district = 0; ui.selected = 'roadsign'; render(); return; }
  if (/^go-d\d$/.test(id)) { ui.district = Number(id.slice(4)); ui.selected = ui.district === 3 ? 'exchange' : null; render(); return; }
  const bdef = world.buildings.find((x) => x.id === id);
  ui.district = bdef && bdef.district ? bdef.district : (bdef ? 0 : ui.district);
  if (ui.scene && ui.scene !== id) { ui.scene = null; sceneKey = null; }
  ui.selected = id;
  walkYouTo(id);
  render();
  if (playerId && id === ui.target && id !== 'gate') act('visit', { place: id });
  // tell the server where you are going, so other players see you walk there too
  else if (playerId && bdef && !bdef.district) post('/api/action', { player: playerId, type: 'visit', place: id }).catch(() => {});
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
  // the first time only: show the four-card "how to play" right after the elder's welcome
  let seen = null; try { seen = localStorage.getItem('ew.howto'); } catch {}
  if (!seen) openHowto();
});
// ---------- judge tour: the NEAR parts of Emberwick in about two minutes ----------
const NB = 'https://testnet.nearblocks.io/address/';
const TOUR = [
  { k: 'start' },
  { k: 'ai', go: () => select('bakery'), links: [['ai.attestLink', '/api/ai/attestation'], ['ai.planJson', '/api/ai/plan']] },
  { k: 'haggle', go: () => select('inn') },
  { k: 'token', go: () => select('treasury'), links: [['tour.l.token', NB + 'token.emberwick-village.testnet'], ['tour.l.bank', NB + 'emberwick-village.testnet'], ['tour.l.treasury', NB + 'treasury.emberwick-village.testnet']] },
  { k: 'land', go: () => { ui.selected = 'lands'; ui.district = 0; render(); }, links: [['tour.l.deeds', NB + 'deeds.emberwick-village.testnet']] },
  { k: 'intents', go: () => { ui.exTab = 'change'; select('go-d3'); } },
  { k: 'council', go: () => { ui.district = 0; select('council'); } },
  { k: 'week' },
  { k: 'end' },
];
function renderTour() {
  const box = $('tour');
  if (ui.tour === undefined || ui.tour === null) { box.hidden = true; return; }
  const i = ui.tour, st = TOUR[i];
  const links = (st.links || []).map(([k, u]) => `<a href="${u}" target="_blank" rel="noopener">${t(k)} ↗</a>`).join(' · ');
  box.innerHTML = `<div class="tour-head"><b>🧭 ${t('tour.title')} · ${i + 1}/${TOUR.length}</b><button class="linkbtn" data-tourclose="1">✕</button></div>` +
    `<h3>${t('tour.' + st.k + '.t')}</h3><p>${t('tour.' + st.k + '.b')}</p>${links ? `<p class="small">${links}</p>` : ''}` +
    `<div class="tour-nav">${i > 0 ? `<button data-tour="${i - 1}">← ${t('tour.back')}</button>` : '<span></span>'}` +
    (i < TOUR.length - 1 ? `<button class="primary" data-tour="${i + 1}">${t(i === 0 ? 'tour.go' : 'tour.next')} →</button>` : `<button class="primary" data-tourclose="1">${t('tour.done')}</button>`) + `</div>`;
  box.hidden = false;
}
function tourTo(i) {
  ui.tour = Math.max(0, Math.min(TOUR.length - 1, i));
  if (ui.scene && !['ai', 'haggle'].includes(TOUR[ui.tour].k)) { ui.scene = null; }
  const st = TOUR[ui.tour];
  if (st.go) { try { st.go(); } catch {} }
  renderTour();
}

function openHowto() { $('howto').hidden = false; try { localStorage.setItem('ew.howto', '1'); } catch {} }
$('howto-ok').addEventListener('click', () => { $('howto').hidden = true; });
$('howto').addEventListener('click', (e) => { if (e.target.id === 'howto') $('howto').hidden = true; });

let ignoreClick = false;
// the villager under the mouse (a generous area around the little figure)
function walkerAt(p) {
  // real players first: a player standing next to a bot (or the elder at the gate) should win the click
  return nearestWalker(p, [...others.values()]) || nearestWalker(p, walkers);
}
function nearestWalker(p, list) {
  let best = null, bestD = 1e9;
  for (const w of list) {
    if (w.inside) continue;
    const [x, y] = walkerPos(w);
    const dx = Math.abs(p.x - x), dy = y - p.y;
    if (dx < 22 && dy > -14 && dy < 60 && dx + Math.abs(dy - 24) < bestD) { best = w; bestD = dx + Math.abs(dy - 24); }
  }
  return best;
}
$('map').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const svg = $('map'), pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const w = walkerAt(pt.matrixTransform(svg.getScreenCTM().inverse()));
  for (const x of walkers) x.hold = x === w;
  for (const x of others.values()) x.hold = false;
  svg.style.cursor = w ? 'pointer' : '';
});
$('map').addEventListener('mouseleave', () => { for (const x of walkers) x.hold = false; });
$('map').addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' && e.target.closest('.bld')) return; // on a phone, a tap on a building opens the building
  const svg = $('map');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const best = walkerAt(p);
  if (best) { ignoreClick = true; talk(best); }
});
$('map').addEventListener('click', (e) => {
  if (ignoreClick) { ignoreClick = false; return; }
  const g = e.target.closest('.bld');
  if (g) { ui.walkTo = null; select(g.dataset.id); return; }
  walkToGround(e);
});
// click on a road or on grass: your villager walks there (other players see it too)
function walkToGround(e) {
  if (!you || !playerId || ui.district || ui.scene) return;
  const svg = $('map'), pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const c = cellAt(p.x, p.y);
  if (!c || !isWalkable(c[0], c[1])) return;
  const path = findPath(you.cell, c);
  if (path.length <= 1 && !(you.cell[0] === c[0] && you.cell[1] === c[1])) return; // no way there
  you.inside = null; you.path = path; you.prog = 0; you.arrived = () => { ui.walkTo = null; };
  ui.walkTo = c;
  if (ui.selected && ui.selected !== 'guide') { ui.selected = null; renderPanel(); }
  post('/api/action', { player: playerId, type: 'walk', i: c[0], j: c[1] }).catch(() => {});
}
document.addEventListener('toggle', (e) => {
  if (e.target.dataset && e.target.dataset.who) ui.openWho = e.target.open ? Number(e.target.dataset.who) : null;
}, true);
document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('sellqty')) {
    const max = Number(e.target.max) || 1, v = Math.max(1, Math.min(max, Math.floor(Number(e.target.value) || 1)));
    (ui.sellQty = ui.sellQty || {})[e.target.dataset.good] = v;
    const b = e.target.closest('td').querySelector('[data-act="sell"]'); if (b) b.textContent = t('panel.sellN', { n: v });
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'prop-kind') { ui.propKind = e.target.value; e.target.blur(); renderPanel(); }
  if (e.target.id === 'ex-good') { ui.exGood = e.target.value; e.target.blur(); renderPanel(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.scene) { closeScene(); return; }
  if (e.key === 'Escape' && ui.selected) { ui.selected = null; renderMapNow(); renderPanel(); renderDock(); }
});
$('map').addEventListener('keydown', (e) => {
  const g = e.target.closest('.bld');
  if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.dataset.id); }
});
$('map').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return; // no hover on touch screens: re-drawing mid-tap would swallow the tap
  const g = e.target.closest('.bld');
  const id = g ? g.dataset.id : null;
  if (id !== ui.hover) { ui.hover = id; renderMapNow(); $('hint').hidden = true; }
});
document.body.addEventListener('click', (e) => {
  const hb = e.target.closest('[data-haggle]');
  if (hb) {
    if (!playerId) return toast(t('toast.join'), 'bad');
    const n = view.npcs[hb.dataset.npc], g = hb.dataset.good, side = hb.dataset.haggle, me = view.player;
    const list = hagList(n, g, side);
    const qty = side === 'sell' ? Math.min(me.inv[g] || 1, (ui.sellQty || {})[g] || (n.offers[g] ? n.offers[g].qty : 0) || me.inv[g] || 1) : 1;
    ui.haggle = { npc: hb.dataset.npc, good: g, side, qty, offer: Math.max(0.1, Math.round(list * (side === 'buy' ? 0.8 : 1.2) * 10) / 10) };
    renderNow(); return;
  }
  if (e.target.closest('[data-hagclose]')) { ui.haggle = null; renderNow(); return; }
  if (e.target.closest('[data-hagsend]')) { sendHaggle(e.target.closest('.haggle')); return; }
  if (e.target.closest('[data-hagdeal]')) { takeDeal(); return; }
  const rp = e.target.closest('[data-repay]');
  if (rp) { post('/api/action', { player: playerId, type: 'repay', npc: rp.dataset.repay }).then((r) => { if (r.state && newer(r.state)) view = r.state; if (r.ok) { play('coin'); toast(t('credit.paid', { n: r.amount }), 'win'); } else toast(errText(r), 'bad'); render(); }); return; }
  if (e.target.closest('[data-lands]')) { ui.selected = 'lands'; renderMapNow(); renderPanel(); return; }
  if (e.target.closest('[data-eat]')) { act('eat'); return; }
  if (e.target.closest('[data-guide]')) { ui.selected = 'guide'; renderMapNow(); renderPanel(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { select(go.dataset.go); if (go.dataset.go === 'gate' && view.player && view.player.questInfo.id === 'meet') openElder(); return; }
  const tabBtn = e.target.closest('[data-extab]');
  if (tabBtn) { ui.exTab = tabBtn.dataset.extab; if (ui.exTab === 'change' && (!ui.exPrices || Date.now() - (ui.exPricesAt || 0) > 60000)) loadExPrices(); renderPanel(); return; }
  if (e.target.closest('#sfx-btn')) { setSfx(!sound.sfx); play('coin'); render(); return; }
  if (e.target.closest('#music-btn')) { setMusic(!sound.music); render(); return; }
  if (e.target.closest('#ff-btn')) {
    if (!playerId) return toast(t('toast.join'), 'bad');
    ui.ffAsked = true;
    post('/api/fastforward', { player: playerId }).then((r) => { if (!r.ok) toast(errText(r), 'bad'); else toast(t('ff.started'), 'win'); });
    return;
  }
  if (e.target.closest('[data-howto]')) { openHowto(); return; }
  const tb = e.target.closest('[data-tour]');
  if (tb) { if (!playerId && Number(tb.dataset.tour) > 0) return toast(t('toast.join'), 'bad'); tourTo(Number(tb.dataset.tour)); return; }
  if (e.target.closest('[data-tourclose]')) { ui.tour = null; renderTour(); return; }
  if (e.target.closest('[data-rename]')) { ui.selected = 'rename'; renderMapNow(); renderPanel(); setTimeout(() => { const i = $('rename-input'); if (i) { i.focus(); i.select(); } }, 50); return; }
  const qs = e.target.closest('[data-qstep], [data-qall]');
  if (qs) {
    const td = qs.closest('td'), inp = td && td.querySelector('.sellqty');
    if (inp) { const max = Number(inp.max) || 1; const v = qs.dataset.qall ? max : Math.max(1, Math.min(max, (Number(inp.value) || 1) + Number(qs.dataset.qstep)));
      inp.value = v; (ui.sellQty = ui.sellQty || {})[qs.dataset.good] = v; const b = td.querySelector('[data-act="sell"]'); if (b) b.textContent = t('panel.sellN', { n: v }); }
    return;
  }
  const lt = e.target.closest('[data-logtab]');
  if (lt) { showLogTab(lt.dataset.logtab); return; }
  const cto = e.target.closest('[data-chatto]');
  if (cto) { showLogTab('chat'); const inp = $('chat-input'); inp.value = '@' + cto.dataset.chatto + ' '; inp.focus(); inp.scrollIntoView({ block: 'nearest' }); return; }
  const zb = e.target.closest('[data-zoom]');
  if (zb) { mz.z = Math.max(1, Math.min(3, mz.z * (zb.dataset.zoom === 'in' ? 1.35 : 1 / 1.35))); applyZoom(); return; }
  if (e.target.closest('[data-trade]')) { ui.selected = 'trade'; renderMapNow(); renderPanel(); return; }
  if (e.target.closest('[data-board]')) { ui.selected = 'board'; renderMapNow(); renderPanel(); return; }
  if (e.target.closest('#wallet-btn')) {
    ui.selected = 'near'; renderMapNow(); renderPanel();
    const me = view.player;
    if (me && window.EmberwickWallet && (!me.near || ui.challenge)) nearMeteor();
    return;
  }
  if (e.target.closest('#near-pill')) { ui.selected = ui.selected === 'near' ? null : 'near'; renderMapNow(); renderPanel(); return; }
  const btn = e.target.closest('#panel button[data-act], #dock button[data-act], #scene-bar button[data-act], #scene-menu button[data-act], #map-card button[data-act]');
  if (!btn) return;
  const a = btn.dataset.act;
  if (a === 'vote') { if (!playerId) return toast(t('toast.join'), 'bad'); goAndDo('council', 'vote', () => councilAct('vote', { id: Number(btn.dataset.id), yes: btn.dataset.yes === '1' })); return; }
  if (a === 'postOrder') { exAct('postOrder', { good: $('ex-good').value, qty: Number($('ex-qty').value), price: Number($('ex-price').value) }); return; }
  if (a === 'cancelOrder' || a === 'fillOrder') { exAct(a, { id: Number(btn.dataset.id), qty: 1 }); return; }
  if (a === 'listDeed') { exAct('listDeed', { plot: btn.dataset.plot, price: Number(($('ex-deed-price') || {}).value) || 0 }); return; }
  if (a === 'unlistDeed' || a === 'buyDeed') { exAct(a, { plot: btn.dataset.plot }); return; }
  if (a === 'payOpen') { ui.pay = { what: btn.dataset.what, from: (ui.pay && ui.pay.from) || 'USDC-SOL', quote: null }; renderPanel(); return; }
  if (a === 'payQuote') {
    const from = $('pay-from').value, emwk = Number(btn.dataset.emwk) || 0, st = ui.pay;
    st.from = from; st.quote = 'wait'; renderPanel();
    fetch(`/api/exchange/payquote?from=${encodeURIComponent(from)}&emwk=${emwk}`).then((r) => r.json()).then((q) => { st.quote = q; renderPanel(); }).catch(() => { st.quote = { ok: false }; renderPanel(); });
    return;
  }
  if (a === 'exQuote') {
    ui.exQAmount = Number($('ex-q-amount').value) || 1; ui.exQTo = $('ex-q-to').value; ui.exQuote = 'wait'; renderPanel();
    fetch(`/api/exchange/quote?to=${encodeURIComponent(ui.exQTo)}&amount=${ui.exQAmount}`).then((r) => r.json()).then((q) => { ui.exQuote = q; renderPanel(); }).catch(() => { ui.exQuote = { ok: false }; renderPanel(); });
    return;
  }
  if (a === 'open-near') { ui.selected = 'near'; renderMapNow(); renderPanel(); return; }
  if (a === 'propose') {
    if (!playerId) return toast(t('toast.join'), 'bad');
    const kind = $('prop-kind').value, extra = { kind };
    if ($('prop-npc')) extra.npc = $('prop-npc').value;
    if ($('prop-amount')) extra.amount = Number($('prop-amount').value);
    if ($('prop-rate')) extra.rate = Number($('prop-rate').value) / 100;
    if ($('prop-pct')) extra.pct = Number($('prop-pct').value);
    if ($('prop-asset')) extra.asset = $('prop-asset').value;
    goAndDo('council', 'propose', () => councilAct('propose', extra));
    return;
  }
  if (a.startsWith('near-')) {
    if (a === 'near-copy') navigator.clipboard?.writeText(btn.dataset.copy).then(() => toast(t('toast.copied'), 'win')).catch(() => {});
    else if (!playerId) toast(t('toast.join'), 'bad');
    else if (a === 'near-link') nearLink($('near-account').value);
    else if (a === 'near-meteor') nearMeteor();
    else if (a === 'near-deposit') nearDeposit($('near-dep').value);
    else if (a === 'near-claim') nearClaim($('near-claim').value);
    else if (a === 'near-withdraw') nearWithdraw($('near-amount').value);
    return;
  }
  if (a === 'close') { ui.selected = null; renderMapNow(); renderPanel(); renderDock(); }
  else if (a === 'elder') openElder();
  else if (a === 'meal') { delete result.inn; goAndDo('inn', 'meal', () => act('meal')); }
  else if (a === 'withdrawApplication') { act('withdrawApplication'); }
  else if (a === 'takeJob' || a === 'shift' || a === 'quitJob') { const npc = btn.dataset.npc || ui.selected; delete result[npc]; goAndDo(npc, a, () => act(a, { npc })); }
  else if (a === 'buyPlot' || a === 'buildHouse') { const plot = ui.selected; delete result[plot]; goAndDo(plot, a, () => act(a, { plot })); }
  else if (a === 'rentHouse' || a === 'leaveHouse' || a === 'rest') { const house = ui.selected; delete result[house]; goAndDo(house, a, () => act(a, { house })); }
  else if (a === 'listHome' || a === 'unlistHome' || a === 'leaseHome' || a === 'leaveLease') {
    const plot = btn.dataset.plot || ui.selected, extra = { plot };
    if (a === 'listHome') extra.rent = Number(($('lease-rent') || {}).value) || 8;
    delete result[plot]; goAndDo(plot, a, () => act(a, extra));
  }
  else if (a === 'sleep') { const place = btn.dataset.place; delete result[place]; goAndDo(place, 'sleep', () => act('sleep', { place, house: place })); }
  else if (a === 'tradeGo') { const npc = btn.dataset.npc, good = btn.dataset.good, kind = btn.dataset.kind; ui.selected = npc; delete result[npc]; renderMapNow(); goAndDo(npc, kind, () => act(kind, { npc, good, qty: 1 })); }
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
  you = { look: { ...PATH_LOOK[me.path], name: me.name, you: true, scale: 1.05 }, route: [], cell: entranceOf('gate'), path: [], prog: 0, wait: 0 };
}


// ---------- touch screens: pinch or press +/- to zoom the village, drag to look around ----------
const touchMap = matchMedia('(pointer: coarse)').matches;
const mz = { base: null, z: 1, cx: 0, cy: 0 };
function applyZoom() {
  const svg = $('map');
  if (!mz.base) return;
  const [bx, by, bw, bh] = mz.base, w = bw / mz.z;
  // follow the shape of the screen, so a tall phone screen is filled instead of showing empty bands
  const r = svg.getBoundingClientRect(), ratio = r.width ? r.height / r.width : bh / bw;
  const h = Math.min(bh, w * ratio);
  mz.cx = Math.max(bx + w / 2, Math.min(bx + bw - w / 2, mz.cx));
  mz.cy = Math.max(by + h / 2, Math.min(by + bh - h / 2, mz.cy));
  svg.setAttribute('viewBox', `${mz.cx - w / 2} ${mz.cy - h / 2} ${w} ${h}`);
  const zb = $('zoom'); if (zb) zb.hidden = false;
}
function setupTouchMap() {
  const svg = $('map');
  mz.base = svg.getAttribute('viewBox').split(' ').map(Number);
  mz.cx = mz.base[0] + mz.base[2] / 2; mz.cy = mz.base[1] + mz.base[3] * 0.52;
  if (!touchMap) { setupMouseMap(svg); applyZoom(); return; }
  mz.z = matchMedia('(max-width: 700px)').matches ? 1.6 : 1.25;
  applyZoom();
  setTimeout(applyZoom, 300); // once the page has its final size
  addEventListener('resize', applyZoom);
  let start = null;
  const unitsPerPx = () => { const vb = svg.viewBox.baseVal; return Math.max(vb.width / svg.clientWidth, vb.height / svg.clientHeight); };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  svg.addEventListener('touchstart', (e) => {
    const t = e.touches;
    start = t.length >= 2 ? { pinch: dist(t), z: mz.z } : { x: t[0].clientX, y: t[0].clientY, cx: mz.cx, cy: mz.cy, moved: false };
  }, { passive: true });
  svg.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches;
    if (t.length >= 2 && start.pinch) { e.preventDefault(); mz.z = Math.max(1, Math.min(3, start.z * dist(t) / start.pinch)); applyZoom(); return; }
    if (t.length !== 1 || start.pinch) return;
    const dx = t[0].clientX - start.x, dy = t[0].clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 8) return; // still a tap
    start.moved = true; e.preventDefault();
    const u = unitsPerPx();
    mz.cx = start.cx - dx * u; mz.cy = start.cy - dy * u; applyZoom();
  }, { passive: false });
  svg.addEventListener('touchend', (e) => {
    if (start && start.moved) { ignoreClick = true; setTimeout(() => { ignoreClick = false; }, 400); }
    if (!e.touches.length) start = null;
  }, { passive: true });
}


// ---------- price tooltips: one floating box, placed so it never runs off the screen ----------
const tipbox = document.createElement('div');
tipbox.id = 'tipbox'; tipbox.hidden = true; tipbox.setAttribute('role', 'tooltip');
document.body.appendChild(tipbox);
let tipFor = null;
function showTip(el) {
  tipFor = el;
  tipbox.textContent = el.dataset.tip;
  tipbox.hidden = false;
  const r = el.getBoundingClientRect(), b = tipbox.getBoundingClientRect(), pad = 8;
  let x = r.left + r.width / 2 - b.width / 2, y = r.bottom + 6;
  x = Math.max(pad, Math.min(innerWidth - b.width - pad, x));
  if (y + b.height > innerHeight - pad) y = r.top - b.height - 6; // no room below: show it above
  tipbox.style.left = x + 'px'; tipbox.style.top = Math.max(pad, y) + 'px';
}
function hideTip() { tipFor = null; tipbox.hidden = true; }
document.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('.tip'); if (el && e.pointerType === 'mouse') showTip(el); });
document.addEventListener('pointerout', (e) => { const el = e.target.closest && e.target.closest('.tip'); if (el && e.pointerType === 'mouse' && !el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('focusin', (e) => { if (e.target.classList && e.target.classList.contains('tip')) showTip(e.target); });
document.addEventListener('focusout', (e) => { if (e.target.classList && e.target.classList.contains('tip')) hideTip(); });
// touch: tap the ⓘ to open, tap anywhere else to close
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('.tip');
  if (el) { if (tipFor === el) hideTip(); else showTip(el); return; }
  if (tipFor) hideTip();
}, true);
addEventListener('scroll', hideTip, true);
// panels redraw every few seconds; keep the box on the new copy of the same ⓘ under the mouse
let lastPt = null;
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') lastPt = [e.clientX, e.clientY]; }, { passive: true });
setInterval(() => {
  if (!tipFor || tipFor.isConnected) return;
  const el = lastPt && document.elementFromPoint(lastPt[0], lastPt[1]);
  const tip = el && el.closest && el.closest('.tip');
  if (tip) showTip(tip); else hideTip();
}, 250);

// with a mouse: the wheel zooms toward the pointer, dragging moves the view (a drag never counts as a click)
function setupMouseMap(svg) {
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
    const u = Math.max(vb.width / r.width, vb.height / r.height);
    const px = vb.x + (e.clientX - r.left) * u, py = vb.y + (e.clientY - r.top) * u; // the point under the mouse
    const z0 = mz.z;
    mz.z = Math.max(1, Math.min(3, mz.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const k = z0 / mz.z;
    mz.cx = px + (mz.cx - px) * k; mz.cy = py + (mz.cy - py) * k; // keep that point where it is
    applyZoom();
  }, { passive: false });
  let drag = null;
  svg.addEventListener('mousedown', (e) => { if (e.button === 0 && mz.z > 1) drag = { x: e.clientX, y: e.clientY, cx: mz.cx, cy: mz.cy, moved: false }; });
  addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true; svg.style.cursor = 'grabbing';
    const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect(), u = Math.max(vb.width / r.width, vb.height / r.height);
    mz.cx = drag.cx - dx * u; mz.cy = drag.cy - dy * u; applyZoom();
  });
  addEventListener('mouseup', () => {
    if (drag && drag.moved) { ignoreClick = true; setTimeout(() => { ignoreClick = false; }, 300); svg.style.cursor = ''; }
    drag = null;
  });
}

// a live price panel on the left of the exchange quarter
function renderTicker(pr) {
  let el = $('ticker');
  if (!el) { el = document.createElement('div'); el.id = 'ticker'; el.className = 'card hud ticker'; $('view').appendChild(el); }
  const show = ui.district === 3 && !ui.scene;
  el.hidden = !show;
  if (!show) return;
  const o = view.oracle;
  let h = `<div class="tk-title">${t('ticker.title')}</div>`;
  if (!pr) h += `<p class="muted small">${ui.exPrices && !ui.exPrices.ok ? t('ex.offline') : t('ex.loading')}</p>`;
  else h += `<table>${pr.map((x) => `<tr><td><b>${esc(x.key === 'NEAR' ? 'NEAR' : x.symbol)}</b> <span class="muted small">${esc(x.chain)}</span></td><td class="n">$${Number(x.price).toLocaleString(undefined, { maximumFractionDigits: x.price < 10 ? 3 : 0 })}</td></tr>`).join('')}` +
    (pr.find((x) => x.key === 'NEAR') ? `<tr class="emwk"><td><b>EMWK</b> <span class="muted small">${t('ticker.village')}</span></td><td class="n">$${(Number(pr.find((x) => x.key === 'NEAR').price) / (world.rules.emwkPerNear || 100)).toFixed(4)}</td></tr>` : '') + `</table>`;
  if (o && o.ref) { const pct = Math.round((o.usd / o.ref - 1) * 1000) / 10; h += `<p class="small ${pct > 0 ? 'ok' : pct < 0 ? 'bad' : ''}">${t('ticker.week', { pct: (pct > 0 ? '+' : '') + pct })}</p>`; }
  el.innerHTML = h + `<p class="muted small">${t('ticker.src')}</p>`;
}

// ---------- village chat ----------
let chatSeen = null; // the newest message id already shown as a bubble
function renderChat() {
  const list = view.chat || [];
  const box = $('chat-list');
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.innerHTML = list.length ? list.map((m) => {
    const mention = view.player && m.text.toLowerCase().includes('@' + view.player.name.toLowerCase());
    return `<li class="${m.me ? 'mine' : ''}${mention ? ' mention' : ''}"><b>${esc(m.me ? t('near.you') : m.name)}</b> <span class="muted small">${t('log.day', { n: m.day })}</span><br>${esc(m.text)}</li>`;
  }).join('') : `<li class="muted small">${t('chat.empty')}</li>`;
  if (atBottom || ui.logTab === 'chat') box.scrollTop = box.scrollHeight;
  const newest = list.length ? list[list.length - 1].id : 0;
  if (chatSeen === null) chatSeen = newest; // do not replay old messages when the page opens
  const fresh = list.filter((m) => m.id > chatSeen);
  for (const m of fresh) {
    const w = m.me ? you : others.get(m.pid);
    if (w) w.say = { raw: m.text.length > 90 ? m.text.slice(0, 88) + '…' : m.text, until: performance.now() + 7000 };
  }
  if (fresh.length && ui.logTab !== 'chat' && fresh.some((m) => !m.me)) ui.chatUnread = (ui.chatUnread || 0) + fresh.filter((m) => !m.me).length;
  if (fresh.length && fresh.some((m) => !m.me)) play('clink');
  chatSeen = Math.max(chatSeen, newest);
  const badge = $('chat-new');
  if (badge) { badge.hidden = !ui.chatUnread; badge.textContent = ui.chatUnread || ''; }
  const inp = $('chat-input');
  if (inp) { inp.disabled = !playerId; inp.placeholder = t(playerId ? 'chat.placeholder' : 'chat.join'); }
}
function showLogTab(tab) {
  ui.logTab = tab;
  for (const b of document.querySelectorAll('[data-logtab]')) b.classList.toggle('on', b.dataset.logtab === tab);
  $('log').hidden = tab !== 'news';
  $('chat').hidden = tab !== 'chat';
  if (tab === 'chat') { ui.chatUnread = 0; renderChat(); }
}
document.addEventListener('submit', async (e) => {
  if (e.target.classList && e.target.classList.contains('ai-ask')) {
    e.preventDefault();
    const npc = e.target.dataset.npc, inp = e.target.querySelector('.ai-q'), q = inp.value.trim();
    if (!q) return;
    ui.aiAnswers = ui.aiAnswers || {};
    ui.aiAnswers[npc] = { q, a: '' };
    inp.value = ''; inp.blur(); render();
    ui.aiAnswers[npc].at = Date.now();
    const r = await post('/api/ai/ask', { player: playerId, npc, q, lang: getLang() });
    if (r.state && newer(r.state)) view = r.state;
    ui.aiAnswers[npc] = { q, a: r.ok ? r.answer : '', at: Date.now() };
    if (!r.ok) { delete ui.aiAnswers[npc]; toast(t(r.code || 'ai.busy'), 'bad'); }
    if (r.ok && r.credit) { play('coin'); toast(t('credit.got', { n: r.credit.qty, good: goodWord(r.credit.good), p: r.credit.amount, d: r.credit.due }), 'win'); }
    render(); setTimeout(render, 21000); return;
  }
  if (e.target.id === 'rename-form') {
    e.preventDefault();
    const r = await post('/api/action', { player: playerId, type: 'rename', name: $('rename-input').value });
    if (!r.ok) return toast(errText(r), 'bad');
    toast(t('rename.done'), 'good');
    if (r.state && newer(r.state)) { view = r.state; }
    ui.selected = 'guide'; render(); return;
  }
  if (e.target.id !== 'chat-form') return;
  e.preventDefault();
  const inp = $('chat-input'), text = inp.value.trim();
  if (!text) return;
  if (!playerId) return toast(t('toast.join'), 'bad');
  const r = await post('/api/action', { player: playerId, type: 'chat', text });
  if (!r.ok) return toast(errText(r), 'bad');
  inp.value = '';
  if (r.state && newer(r.state)) { view = r.state; render(); }
});

// ---------- live connection ----------

// is this state newer than what the page shows? After a server restart the counter starts again,
// so a different boot id always counts as newer (otherwise the page would freeze on old data)
const newer = (st) => !view || st.boot !== view.boot || (st.rev || 0) >= (view.rev || 0);

let source;
function connect() {
  if (source) source.close();
  const src = new EventSource('/api/stream' + (playerId ? `?player=${playerId}` : ''));
  const forPlayer = playerId;
  source = src;
  src.onmessage = (m) => {
    if (src !== source || forPlayer !== playerId) return; // a message from an old connection
    const next = JSON.parse(m.data);
    if (!newer(next)) return; // an older update arrived late
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
  setupTouchMap();
  playerId = store.get();
  view = await (await fetch('/api/state' + (playerId ? `?player=${playerId}` : ''))).json();
  if (!view.player) { playerId = null; showJoin(); } else makeYou();
  setupWalkers();
  render();
  connect();
  requestAnimationFrame(animate);
})();

// sound may only start after the first click or key press
window.addEventListener('pointerdown', unlockSound, { once: true });
window.addEventListener('keydown', unlockSound, { once: true });
