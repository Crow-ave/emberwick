import { setupMap, renderMap, renderDistrict, buildGrid, entranceOf, findPath, cellCenter, cellAt, isWalkable, person, workCellOf, isOpenArea, hereBadge, speech } from './iso.js';
import { t, LANGS, getLang, setLang, has as hasKey } from './i18n.js';
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
function openScene(id) { if (ui.scene !== id) ui.bub = null; ui.scene = id; sceneKey = null; renderScene(); } // a new visit: lines may be said again
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
      // each line is shown once per visit: a greeting that faded does not pop up again
      const seen = b0 ? b0.seen : new Set();
      const again = seen.has(talkKey);
      seen.add(talkKey);
      ui.bub = { scene: id, key: talkKey, gone: again, seen };
      clearTimeout(ui.talkTimer);
      const ttl = Math.min(22000, 7000 + talkKey.length * 60);
      if (!again) ui.talkTimer = setTimeout(() => { if (ui.bub && ui.bub.key === talkKey) { ui.bub.gone = true; const g = document.querySelector('#scene-talk'); if (g) g.classList.add('gone'); } }, ttl);
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
    out.push({ x: youHead[0], y: youHead[1], text: t(hasKey('haggle.myOffer.' + hg.side) ? 'haggle.myOffer.' + hg.side : 'haggle.myOffer', { p: hg.offer, n: hg.qty, good: goodWord(hg.good) }), anchor: 0.35, max: 26 });
    if (hg.reply) out.push({ x: KEEPER_HEAD[0], y: KEEPER_HEAD[1], text: hg.reply.line || hagSay(hg.reply) , anchor: 0.85, max: 34 });
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
// the built-in line, from the craftsman's side: buying from them or selling to them reads differently
const hagSay = (r) => { const k = r.fair ? (r.side === 'buy' ? 'haggle.say.fair.buy' : 'haggle.say.fair') : 'haggle.say.' + r.outcome + (r.side === 'sell' ? '.sell' : ''); return t(hasKey(k) ? k : 'haggle.say.' + r.outcome, { p: r.unit, ask: r.ask, good: goodWord(r.good) }); };
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
    const line = r.line || hagSay(r);
    h += `<div class="hag-reply ${r.outcome}"><span class="quote">"${esc(line)}"</span></div>`;
    if (r.side === 'sell' && r.unit !== null && r.unit !== undefined && r.plainTotal) h += `<p class="muted small">${t('haggle.vsPlain', { n: r.qty, plain: r.plainTotal, deal: Math.round(r.unit * r.qty * 100) / 100 })}</p>`;
    const d = me.deal;
    if (d && d.npc === id && d.good === hg.good && d.side === hg.side) h += `<p class="small">${t(d.side === 'sell' ? 'haggle.confirmSell' : 'haggle.confirmBuy')}</p><button class="primary" data-hagdeal="1">${t('haggle.take', { n: d.qty, p: d.unit, total: Math.round(d.qty * d.unit * 100) / 100 })}</button> <button data-hagclose="1">${t('haggle.no2')}</button>`;
  }
  return h + `</div>`;
}

// an order: bring your own materials, pay for the work, get the product
function orderRow(id) {
  const n = view.npcs[id], o = n && n.order, me = view.player;
  if (!o || !me) return '';
  const ins = Object.entries(o.inputs).map(([g, q]) => `${q} ${goodWord(g)}`).join(' + ');
  return `<div class="orderrow"><b>🧵 ${t('order.title')}</b><p class="small">${t('order.line', { ins, fee: o.fee, n: o.outQty, good: goodWord(o.output) })}</p>` +
    (o.ok ? '' : `<p class="muted small">${t('order.r.' + o.key, { goods: (o.lack || []).map(goodWord).join(', ') })}</p>`) +
    `<button class="primary" data-order="${id}" ${o.ok ? '' : 'disabled'}>${t('order.btn', { n: o.outQty, good: goodWord(o.output) })}</button></div>`;
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
  h += orderRow(id);
  return h;
}

function panelCraftsman(b) {
  const n = view.npcs[b.id];
  const me = view.player;
  const acct = view.chain && view.chain.accounts && view.chain.accounts.npcs ? view.chain.accounts.npcs[b.id] : null;
  let h = `<h2>${esc(npcName(b.id))}</h2><div class="muted">${esc(t('panel.purse', { place: placeName(b.id), n: n.wallet }))}</div>` +
    `<div class="agentline"><button class="linkbtn small" data-money="npc:${b.id}">📜 ${t('mh.npc')}</button></div><div class="agentline">🤖 ${t('ni.agentLine')}${acct && chainOk() ? ' · ' + exLink('address/' + acct, esc(acct)) : ''}${view.ai && view.ai.tee ? ' · 🔒 ' + t('ni.teeShort') : ''}</div>`;
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

// the buttons a craftsman offers in conversation (checked by the village rules on the server)
function aiActions(list) {
  if (!list.length) return '';
  return `<div class="ai-acts">${list.map((x, k) => {
    const lab = x.type === 'buy' ? t('aiact.buy', { n: x.qty, good: goodWord(x.good), p: Math.round(x.qty * x.price * 100) / 100 })
      : x.type === 'meal' ? t('aiact.meal', { p: x.price })
      : x.type === 'sell' ? t('aiact.sell', { n: x.qty, good: goodWord(x.good) })
      : x.type === 'order' ? (x.ok ? t('order.btn', { n: x.outQty, good: goodWord(x.output) }) + ` (${x.fee} EMWK)` : t('aiact.orderNeed', { ins: Object.entries(x.inputs).map(([g, q]) => q + ' ' + goodWord(g)).join(' + '), n: x.outQty, good: goodWord(x.output) }))
      : x.type === 'credit' ? t('aiact.credit', { n: x.qty, good: goodWord(x.good) })
      : t('go.to', { place: placeName(x.place) });
    const dis = x.type === 'order' && !x.ok;
    return `<button class="${x.type === 'goto' ? '' : 'primary'} small" data-aiact="${k}" ${dis ? 'disabled' : ''}>${esc(lab)}</button>`;
  }).join(' ')}</div>`;
}
async function runAiAction(npc, x) {
  if (x.type === 'goto') { ui.scene = null; select(x.place); return; }
  const body = x.type === 'buy' ? { type: 'buy', npc, good: x.good, qty: x.qty } : x.type === 'sell' ? { type: 'sell', npc, good: x.good, qty: x.qty }
    : x.type === 'meal' ? { type: 'meal' } : x.type === 'order' ? { type: 'commission', npc, n: 1 } : { type: 'credit', npc, qty: x.qty };
  const r = await post('/api/action', { player: playerId, ...body });
  if (r.state && newer(r.state)) view = r.state;
  if (!r.ok) { toast(errText(r), 'bad'); play('bad'); render(); return; }
  play('coin');
  toast(x.type === 'order' ? t('order.done', { n: r.qty, good: goodWord(r.output), fee: r.fee }) : x.type === 'credit' ? t('credit.got', { n: r.credit.qty, good: goodWord(r.credit.good), p: r.credit.amount, d: r.credit.due }) : t('aiact.done'), 'win');
  const qa = (ui.aiAnswers || {})[npc];
  if (qa) qa.actions = (qa.actions || []).filter((y) => y !== x);
  render();
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
    h += `<p class="small ai-proof">⛓ ${t(chainOk() ? 'ai.onChain' : 'ai.planHash', { d: rec.day, h: rec.hash.slice(0, 10) })} · <a href="/api/ai/plan?day=${rec.day}" target="_blank" rel="noopener">${t('ai.planJson')}</a>${tx ? ' · ' + exLink('txns/' + tx, t('ai.planTx')) : chainOk() ? ` · <span class="muted">${t('job.contractWait')}</span>` : ''}</p>`;
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
  if (a) h += `<div class="ai-qa"><div class="small muted">${t('ai.you')} ${esc(a.q)}</div><div class="quote">${a.a ? '"' + esc(a.a) + '"' : t('ai.thinkingS', { s: Math.round((Date.now() - (a.at || Date.now())) / 1000) })}</div>${aiActions(a.actions || [])}</div>`;
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
  const mh = `<p><button class="linkbtn" data-money="treasury">📜 ${t('mh.treasury')}</button></p>`;
  if (!k) return mh + `<p>${t('treasury.text', { n: view.treasury })}</p>`;
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
  return h + mh + `<p class="muted small">${t('treasury.note')}</p>`;
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
      if (x.sale) h += `<p class="small">${t('ex.listedAt', { n: x.sale.price })}</p>${fairNote(x)}<button data-act="unlistDeed" data-plot="${me.plot}">${t('ex.unlist')}</button>`;
      else h += `<p class="muted small">${t('ex.sellDeedHelp')}</p><p class="small">${t('ex.fair', { n: x.fair, max: Math.floor(x.fair * 1.1) })}</p><div class="row exform"><input id="ex-deed-price" type="number" min="1" max="5000" value="${x.fair || Math.round((x.price || 120) * (x.built ? 1.6 : 1.1))}"> EMWK <button class="primary" data-act="listDeed" data-plot="${me.plot}">${t('ex.listDeed')}</button></div>`;
    }
    const dt = mk.trades.filter((x) => x.deed);
    if (dt.length) h += `<p class="sub2">${t('ex.trades')}</p><ul class="decided">${dt.slice(0, 5).map((x) => `<li>${esc(placeName(x.deed))} · ${x.price} EMWK · ${esc(x.seller)} → ${esc(x.buyer)}</li>`).join('')}</ul>`;
    h += `<p class="muted small">${t('ex.deedNote')}</p>`;
  }
  if (tab === 'change') {
    // two ways over the bridge: a free quote (dry run) or a real swap on mainnet with your own wallet
    const realMode = ui.exMode === 'real';
    h += `<div class="modeswitch"><button class="${realMode ? '' : 'on'}" data-exmode="dry">${t('real.modeDry')}</button><button class="${realMode ? 'on' : ''}" data-exmode="real">⚡ ${t('real.modeReal')}</button></div>`;
    if (realMode) h += realSwapBox();
    // the live cross-chain quote comes first, with the bridge picture right under it
    const eq = ui.exQuote && ui.exQuote.ok ? ui.exQuote : null;
    if (!realMode) {
    h += `<p class="sub2">${t('ex.quoteTitle')}</p><div class="row exform"><input id="ex-q-amount" type="number" min="0.1" max="1000" step="0.1" value="${ui.exQAmount || 1}"> NEAR → <select id="ex-q-to">${['USDC', 'BTC', 'ETH', 'SOL'].map((k) => `<option${ui.exQTo === k ? ' selected' : ''}>${k}</option>`).join('')}</select><button class="primary" data-act="exQuote">${t('ex.getQuote')}</button></div>`;
    h += bridgeSvg(eq ? { sym: 'NEAR', chain: 'near', amount: eq.amountIn } : { sym: 'NEAR', chain: 'near' }, eq ? { sym: eq.to, chain: eq.chain, amount: eq.amountOut } : { sym: ui.exQTo || 'USDC', chain: ({ USDC: 'near', BTC: 'btc', ETH: 'eth', SOL: 'sol' })[ui.exQTo || 'USDC'] || '' }, !!eq, 'swap');
    const q = ui.exQuote;
    if (q === 'wait') h += `<p class="muted small">${t('ex.loading')}</p>`;
    else if (q && q.ok) h += `<div class="contract"><b>${t('ex.quoteOut', { a: q.amountIn, b: q.amountOut, sym: q.to, chain: q.chain })}</b>${q.usdOut ? `<div class="small">≈ $${q.usdOut}</div>` : ''}<p class="muted small">${t('ex.quoteNote')}</p></div>`;
    else if (q) h += `<p class="muted small">${/fetch failed|abort|ENOTFOUND|ECONN/i.test(q.error || '') || !q.error ? t('ex.offline') : t('ex.quoteFailed', { why: esc(q.error) })}</p>`;
    h += COL + oracleBox() + reserveBox(true);
    }
    const extraAt = h.length; // in the real swap, prices and the council money fold away
    const pr = ui.exPrices;
    h += `<p class="sub2">${t('ex.pricesTitle')}</p>`;
    if (!pr) h += `<p class="muted small">${t('ex.loading')}</p>`;
    else if (!pr.ok) h += `<p class="muted small">${t('ex.offline')}</p>`;
    else h += `<table>${pr.tokens.map((x) => `<tr><td><b>${esc(x.symbol)}</b> <span class="muted small">${esc(x.chain)}</span></td><td class="n">$${Number(x.price).toLocaleString(undefined, { maximumFractionDigits: x.price < 10 ? 3 : 0 })}</td></tr>`).join('')}</table><p class="muted small">${t('ex.pricesSource')}</p>`;
    h += `<p class="sub2">${t('ex.bridgeTitle')}</p><p class="small">${t('ex.bridgeHelp', { n: me ? Math.floor(me.coins) : 0 })}</p><button class="primary" data-act="open-near">${t('ex.openNear')}</button>`;
    h += `<p class="muted small">${t('ex.changeNote')}</p>`;
    if (realMode) h = h.slice(0, extraAt) + `<details class="realextra" data-keep="extra"${keepOpen('extra')}><summary>${t('real.extra')}</summary>${oracleBox()}${reserveBox(true)}${h.slice(extraAt)}</details>`;
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

// ---------- money history: every transfer of an account, why it happened, and its NEAR transaction ----------
const WHY_RX = [
  [/^sold (\d+(?:\.\d+)?) (\w+)$/, (m) => t('mh.w.sold', { n: m[1], good: goodWord(m[2]) })],
  [/^bought (\d+(?:\.\d+)?) (\w+)$/, (m) => t('mh.w.bought', { n: m[1], good: goodWord(m[2]) })],
  [/^travelling merchant bought (\d+) (\w+)$/, (m) => t('mh.w.merchant', { n: m[1], good: goodWord(m[2]) })],
  [/^bought land \((.+)\)$/, (m) => t('mh.w.land', { place: placeName(m[1]) })],
  [/^council #(\d+): (.+)$/, (m) => t('mh.w.council', { n: m[1] }) + ' · ' + m[2]],
];
const WHY_FIXED = ['market tax', 'daily rent', 'shift wage', 'starting money', 'goal reward', 'guard salary', 'profit tax', 'morning village tax', 'rent deposit', 'rent deposit back', 'first day of rent', 'exchange fee', 'exchange fee (deed sale)', 'severance pay', 'council proposal fee', 'cash-out to your NEAR wallet', 'deposit from your NEAR wallet', 'a traveller ate a meal', 'reward for defending the village', 'trade with travellers', 'supplies bought from travellers', 'notice fee (left the job early)', 'rent deposit kept (rent not paid)', 'transfer'];
function whyText(w, dir) {
  // a sale for one side is a purchase for the other
  if (dir === 'out' && /^sold /.test(w)) w = w.replace(/^sold /, 'bought ');
  else if (dir === 'in' && /^bought \d/.test(w)) w = w.replace(/^bought /, 'sold ');
  for (const [rx, f] of WHY_RX) { const m = rx.exec(w); if (m) return f(m); }
  const k = WHY_FIXED.indexOf(w);
  return k >= 0 && hasKey('mh.f.' + k) ? t('mh.f.' + k) : w;
}
async function openMoney(acct) {
  const box = $('money-box');
  box.innerHTML = `<p>${t('ai.thinking')}</p>`;
  $('money').hidden = false;
  const r = await (await fetch(`/api/money?acct=${encodeURIComponent(acct)}&player=${encodeURIComponent(playerId || '')}`)).json().catch(() => ({ ok: false }));
  if (!r.ok) { box.innerHTML = `<p>${t('mh.none')}</p><button class="primary" data-moneyclose="1">${t('tour.done')}</button>`; return; }
  const name = acct.startsWith('npc:') ? npcName(acct.slice(4)) : acct === 'treasury' ? placeName('treasury') : acct.startsWith('player:') ? t('mh.you') : acct;
  const other = (e) => e.other.startsWith('npc:') ? npcName(e.other.slice(4)) : e.other === 'treasury' ? placeName('treasury') : e.other.startsWith('player:') || e.other.startsWith('bot:') ? esc(e.otherName) : t('mh.acct.' + e.other);
  const near = (e) => !r.chain ? '' : e.tx === 'netted' ? `<span class="muted" title="${esc(t('mh.nettedTip'))}">${t('mh.netted')}</span>`
    : e.tx === 'sync' ? `<span class="muted" title="${esc(t('mh.syncTip'))}">${t('mh.sync')}</span>` : e.tx === 'internal' ? `<span class="muted" title="${esc(t('mh.internalTip'))}">${t('mh.internal')}</span>` : e.tx ? exLink('txns/' + e.tx, t('mh.tx')) : `<span class="muted">${t('mh.pending')}</span>`;
  const sumIn = r.rows.filter((e) => e.dir === 'in').reduce((a, e) => a + e.amount, 0), sumOut = r.rows.filter((e) => e.dir === 'out').reduce((a, e) => a + e.amount, 0);
  box.innerHTML = `<div class="mh-head"><h2>📜 ${t('mh.title', { name })}</h2><button class="linkbtn" data-moneyclose="1">✕</button></div>` +
    `<p class="muted small">${t('mh.lead', { n: r.rows.length, bal: r.balance, inn: Math.round(sumIn), out: Math.round(sumOut) })}${r.chain ? ' ' + t('mh.chainNote') : ''}</p>` +
    (r.rows.length ? `<div class="mh-wrap"><table class="mh"><tr><th>${t('mh.day')}</th><th>${t('mh.what')}</th><th>${t('mh.who')}</th><th class="n">EMWK</th>${r.chain ? '<th>NEAR</th>' : ''}</tr>` +
      r.rows.map((e) => `<tr><td>${e.day}</td><td>${esc(whyText(e.why, e.dir))}</td><td>${e.dir === 'in' ? '← ' : '→ '}${other(e)}</td><td class="n ${e.dir}">${e.dir === 'in' ? '+' : '−'}${e.amount}</td>${r.chain ? `<td>${near(e)}</td>` : ''}</tr>`).join('') + `</table></div>` : `<p>${t('mh.none')}</p>`);
}

// ---------- a REAL NEAR Intents swap on mainnet (small amounts, the player's own wallet) ----------
// a readable amount: 6 decimals under 1, 4 above (1Click can give 24)
const amt = (v) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? String(Number(n.toFixed(n >= 100 ? 2 : n >= 1 ? 4 : 6))) : v; };
const REAL_STEPS = ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'];
const NEAR_MAIN = 'https://nearblocks.io';
const REAL_SRC = { 'USDC-SOL': ['USDC', 'sol', 0.5, 15, 0.5], SOL: ['SOL', 'sol', 0.003, 0.1, 0.005], 'USDC-BASE': ['USDC', 'base', 0.5, 15, 0.5] };
const REAL_DST = { USDC: ['USDC', 'near'], 'USDC-SOL': ['USDC', 'sol'], SOL: ['SOL', 'sol'], 'USDC-BASE': ['USDC', 'base'] };
// the player's current real swap (a finished one they put away with "New swap" stays away)
try { ui.realDismissed = JSON.parse(localStorage.getItem('ew.dismissed') || '[]'); } catch { ui.realDismissed = []; }
function dismissSwaps(list) { ui.realDismissed = [...new Set([...(ui.realDismissed || []), ...list])].slice(-60); try { localStorage.setItem('ew.dismissed', JSON.stringify(ui.realDismissed)); } catch {} }
const curSwap = () => (view.realSwaps || []).filter((x) => !(ui.realDismissed || []).includes(x.depositAddress))[0];
// the last finished swap, as one short line over the card (the card stays ready for a new one)
const swapFromSym = (x) => (x.dir === 'out' ? 'NEAR' : ds(x.fromSym || 'NEAR'));
const swapToLabel = (x) => (x.dir === 'any' ? `${ds(x.toSym)} (${netName(x.chain)})` : x.dir === 'in' ? 'NEAR' : DST_LABEL(x.to));
function lastResult(group) {
  const x = group[0], ok = group.every((y) => y.status === 'SUCCESS');
  const what = group.length > 1 ? t('split.head', { n: group.length, total: legSum(group.map((y) => ({ amount: y.amountIn }))) })
    : `${x.amountIn} ${esc(swapFromSym(x))} → ${esc(String(amt(x.amountOut)))} ${esc(swapToLabel(x))}`;
  const tx = (x.dest || [])[0];
  return `<div class="lastres ${ok ? 'ok' : 'bad'}"><span>${ok ? '✓' : '↩'} <b>${t(ok ? 'last.ok' : 'last.bad')}</b> ${what}${tx && tx.url ? ` · <a href="${esc(tx.url)}" target="_blank" rel="noopener">tx ↗</a>` : ''}</span><button type="button" class="linkbtn" data-realnew="1" title="${esc(t('last.hide'))}">✕</button></div>`;
}
function realSwapBox() {
  const me = view.player;
  let sw = curSwap();
  // one short line on top; the long explanation and the warning fold away
  let R = `<details class="realinfo" data-keep="info"${keepOpen('info')}><summary>ⓘ <b>${t('real.infoShort')}</b></summary><p class="small">${t('real.lead')}</p><p class="small closed">${t('real.warn')}</p></details>`;
  if (!me) return R + COL_MARK + `<p class="muted">${t('toast.join')}</p>`;
  let banner = '';
  if (sw && swapGroup(sw).every((x) => REAL_END.includes(x.status) || x.status === 'INCOMPLETE_DEPOSIT')) { banner = lastResult(swapGroup(sw)); sw = null; }
  if (sw && sw.batch) return splitView(swapGroup(sw), R);
  let f = ui.real || { dir: 'out', to: 'USDC', from: 'USDC-SOL', amount: 0.3, refundTo: '', recipient: '' };
  if (!ui.assets) loadAssets();
  if (ui.assets && !f.any && !f.anyOff) { const conv = oldToAny(f); f = ui.real = conv.any ? { ...f, ...conv } : { ...f, any: true, fromId: WNEAR_ID, toId: (findAsset('USDC', 'near') || ui.assets.find((x) => x.id !== WNEAR_ID) || {}).id }; }
  const anyMode = !!(ui.assets && f.any && A(f.fromId) && A(f.toId));
  const active = sw && !['SUCCESS', 'REFUNDED', 'FAILED'].includes(sw.status) && (!sw.deadline || Date.parse(sw.deadline) > Date.now() - 3600000);
  const shown = !!active;
  const dir = shown ? sw.dir || 'out' : f.dir || 'out';
  const moving = !!(sw && ['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'].includes(sw.status));
  // the picture: what leaves on the left, what arrives on the right; the ⇄ on it turns the swap round
  const src = (dir === 'in' && REAL_SRC[shown ? sw.from : f.from]) || REAL_SRC['USDC-SOL'];
  const dst = (dir === 'out' && REAL_DST[shown ? sw.to : f.to]) || REAL_DST.USDC;
  let left = dir === 'out' ? { sym: 'NEAR', chain: 'near', amount: shown ? sw.amountIn : f.amount } : { sym: src[0], chain: src[1], amount: shown ? sw.amountIn : f.amount };
  let right = dir === 'out' ? { sym: dst[0], chain: dst[1], amount: shown ? amt(sw.amountOut) : null } : { sym: 'NEAR', chain: 'near', amount: shown ? amt(sw.amountOut) : null };
  if (shown && sw.dir === 'any') { left = { sym: ds(sw.fromSym), chain: sw.fromChain, amount: sw.amountIn }; right = { sym: ds(sw.toSym), chain: sw.chain, amount: amt(sw.amountOut) }; }
  else if (!shown && anyMode) { const a = A(f.fromId), b = A(f.toId); left = { sym: ds(a.sym), chain: a.chain, amount: f.amount }; right = { sym: ds(b.sym), chain: b.chain, amount: null }; }
  // first column: the wallet (step 1), the picture, and the AI that can fill the card; second column: the card itself
  const splitting = !shown && (anyMode ? f.fromId === WNEAR_ID : dir === 'out') && f.legs;
  if (!shown) R += splitting ? walletTiles('near', 'near') : walletTiles(left.chain, right.chain);
  R += splitting ? bridgeSvg({ sym: 'NEAR', chain: 'near', amount: legSum(f.legs) }, { sym: ds(legDst(f.legs[0])[0]), chain: legDst(f.legs[0])[1], amount: null }, false, 'real') + `<p class="small muted">${t('split.picture', { n: f.legs.length, c: new Set(f.legs.map((l) => legDst(l)[1])).size })}</p>` : bridgeSvg(left, right, moving, shown ? 'real' : 'real-flip');
  if (!shown || (ui.aiSwap && ui.aiSwap.reply && ui.aiSwap.reply.swap && sw && ui.aiSwap.reply.swap.depositAddress === sw.depositAddress)) R += aiSwapBox();
  let L = banner;
  if (!shown) L += anyMode ? (ui.picker ? pickerView(ui.picker.side, ui.picker.step) : swapCardAny(f)) : swapCard(f, dir);
  if (sw) {
    const k = REAL_STEPS.indexOf(sw.status), bad = ['REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'].includes(sw.status);
    const anyS = sw.dir === 'any', inDir = sw.dir === 'in', srcName = anyS ? netName(sw.fromChain) : sw.fromChain === 'base' ? 'Base' : 'Solana', srcChain = anyS || inDir ? sw.fromChain : 'near';
    L += `<div class="realswap"><p class="small"><b>${anyS ? t('any.quote', { a: sw.amountIn, fs: esc(ds(sw.fromSym)), fc: esc(netName(sw.fromChain)), b: amt(sw.amountOut), ts: esc(ds(sw.toSym)), tc: esc(netName(sw.chain)) }) : inDir ? t('real.quoteIn', { a: sw.amountIn, sym: sw.fromSym, chain: srcName, b: amt(sw.amountOut) }) : t('real.quote', { a: sw.amountIn, b: amt(sw.amountOut), to: REAL_DST[sw.to] ? `${REAL_DST[sw.to][0]} (${CH_NAME[REAL_DST[sw.to][1]]})` : sw.to })}</b>${sw.usdOut ? ` (≈ $${Number(sw.usdOut).toFixed(2)})` : ''}</p>`;
    if (sw.status === 'PENDING_DEPOSIT' && !sw.sentTx) L += `<button type="button" class="editquote" data-realedit="1">✎ ${t('real.edit')}</button>`;
    L += `<ol class="realsteps">${REAL_STEPS.map((s2, i) => `<li class="${i < k || sw.status === 'SUCCESS' ? 'done' : i === k ? 'now' : ''}">${t('real.s.' + s2)}</li>`).join('')}</ol>`;
    if (sw.status === 'PENDING_DEPOSIT') {
      R += feeBox([sw]);
      L += walletSendBox(sw);
      // sending by hand: open by itself only when no wallet is connected for that chain
      const manualOpen = !(ui.wallet || {})[walletKind(srcChain)] && !sw.sentTx;
      L += `<details class="realmanual" data-keep="manual"${keepOpen('manual', manualOpen)}><summary>${t('real.manual')}</summary><p class="small">${anyS ? t('any.send', { a: sw.amountIn, sym: esc(sw.fromSym), chain: esc(srcName) }) : inDir ? t('real.sendIn', { a: sw.amountIn, sym: sw.fromSym, chain: srcName }) : t('real.send', { a: sw.amountIn })}</p><div class="realaddr"><code>${esc(sw.depositAddress)}</code> <button class="linkbtn" data-copy="${esc(sw.depositAddress)}">${t('real.copy')}</button></div>` +
        (sw.depositMemo ? `<p class="small">${t('real.memo')} <code>${esc(sw.depositMemo)}</code></p>` : '') + `<p class="muted small">${anyS ? t('any.how', { chain: esc(srcName), sym: esc(sw.fromSym) }) : t(inDir ? 'real.howIn' : 'real.how', { chain: srcName })}</p>` +
        `<div class="row"><input id="real-tx" placeholder="${esc(t('real.txPh'))}"><button data-realsubmit="1">${t('real.submit')}</button></div></details>`;
      L += sw.sentTx ? '' : ui.realCancelAsk ? `<div class="realcancel"><p class="small"><b>${t('real.cancelSure')}</b></p><div class="row"><button class="danger" data-realcancel="yes">${t('real.cancelYes')}</button><button data-realcancel="no">${t('real.cancelNo')}</button></div></div>`
        : `<button class="linkbtn realcancel-btn" data-realcancel="ask">✕ ${t('real.cancel')}</button>`;
    }
    if (bad) L += `<p class="closed small">${t('real.s.' + sw.status)}</p>`;
    const lk = (x, base) => x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.hash.slice(0, 10))}… ↗</a>` : base ? `<a href="${base}${encodeURIComponent(x.hash)}" target="_blank" rel="noopener">${esc(x.hash.slice(0, 10))}… ↗</a>` : esc(x.hash.slice(0, 10));
    if ((sw.origin || []).length) L += `<p class="small">${t('real.originTx')} ${sw.origin.map((x) => lk(x, txBase(srcChain))).join(' ')}</p>`;
    if ((sw.dest || []).length) L += `<p class="small">${t('real.destTx')} ${sw.dest.map((x) => lk(x, txBase(sw.chain))).join(' ')}</p>`;
    L += `<p class="muted small"><a href="https://explorer.near-intents.org/transactions/${encodeURIComponent(sw.depositAddress)}" target="_blank" rel="noopener">${t('real.explorer')} ↗</a></p></div>`;
    if (sw.status === 'SUCCESS' || bad) L += `<button class="primary" data-realnew="1">${t('real.again')}</button>`;
  }
  const done = view.realDone || [];
  if (done.length) R += `<details class="realdone" data-keep="done"${keepOpen('done')}><summary>${t('real.doneTitle')} (${done.length})</summary><ul class="decided">${done.map((x) => `<li>${esc(x.name)} · ${x.amountIn} ${esc(ds(x.fromSym || 'NEAR'))} → ${esc(String(amt(x.amountOut)))} ${x.dir === 'in' ? 'NEAR' : x.dir === 'any' ? esc(`${ds(x.toSym)} (${netName(x.chain)})`) : esc(REAL_DST[x.to] ? `${REAL_DST[x.to][0]} (${CH_NAME[REAL_DST[x.to][1]]})` : x.to)}${x.dest[0] && x.dest[0].url ? ` · <a href="${esc(x.dest[0].url)}" target="_blank" rel="noopener">tx ↗</a>` : ''}</li>`).join('')}</ul></details>`;
  return R + COL_MARK + L;
}
// ---------- one NEAR send split to several receivers ----------
const DST_LABEL = (k) => (REAL_DST[k] ? `${REAL_DST[k][0]} (${CH_NAME[REAL_DST[k][1]]})` : A(k) ? `${ds(A(k).sym)} (${netName(A(k).chain)})` : String(k || ''));
const legSum = (legs) => Math.round(legs.reduce((a, l) => a + (Number(l.amount) || 0), 0) * 1000) / 1000;
function legOptions(sel) {
  if (!(ui.real && ui.real.any && ui.assets)) return Object.keys(REAL_DST).map((k) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(DST_LABEL(k))}</option>`).join('');
  const order = (c) => { const i = POP_CHAINS.indexOf(c); return i < 0 ? 99 : i; };
  const chains = [...new Set(ui.assets.map((x) => x.chain))].sort((a, b) => order(a) - order(b) || netName(a).localeCompare(netName(b)));
  return chains.map((c) => `<optgroup label="${esc(netName(c))}">${ui.assets.filter((x) => x.chain === c && x.id !== WNEAR_ID).sort((a, b) => a.sym.localeCompare(b.sym)).map((x) => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.sym)} (${esc(netName(c))})</option>`).join('')}</optgroup>`).join('');
}
function legPick(i, x) {
  const ch = chainOf(x.chain), col = ch ? ch[1] : '#556';
  return `<span class="legpick"><button type="button" class="netbtn sm" data-pickopen="leg${i}:chain" style="--c:${col}"><span class="nb-ic">${CHAIN_ICON[x.chain] || esc(netName(x.chain)[0])}</span><b>${esc(netName(x.chain))}</b><span class="tp-caret">▾</span></button><button type="button" class="tokbtn sm" data-pickopen="leg${i}:token"><span class="tc-coin" style="background:${coinBg(x.sym)}">${coinGlyph(x.sym)}</span><b>${esc(x.sym)}</b><span class="tp-caret">▾</span></button></span>`;
}
function legRows(f) {
  const legs = f.legs;
  return legs.map((l, i) => {
    const d = legDst(l), ch = chainOf(d[1]);
    return `<div class="legrow" style="--c:${ch ? ch[1] : '#556'}"><span class="leg-n">${i + 1}</span>` +
      (ui.real && ui.real.any && A(l.to) ? legPick(i, A(l.to)) : `<select data-legto="${i}">${legOptions(l.to)}</select>`) +
      `<span class="leg-amt"><input data-legamt="${i}" type="number" min="0.1" max="5" step="0.1" value="${l.amount}"> NEAR</span>` +
      `<button type="button" class="linkbtn leg-x" data-legdel="${i}" title="${esc(t('split.remove'))}">✕</button>` +
      `<input class="leg-rec" data-legrec="${i}" placeholder="${esc(addrPh(d[1]))}" value="${esc(l.recipient || '')}"></div>`;
  }).join('') + `<div class="leg-foot">${legs.length < 5 ? `<button type="button" class="linkbtn" data-legadd="1">＋ ${t('split.add')}</button>` : '<span></span>'}<span class="leg-total">${t('split.total', { n: legSum(legs) })}</span></div>`;
}
const SPLIT_ST = { PENDING_DEPOSIT: '⏳', KNOWN_DEPOSIT_TX: '👀', PROCESSING: '⚙️', SUCCESS: '✓', REFUNDED: '↩', FAILED: '✕', INCOMPLETE_DEPOSIT: '!' };
function splitView(group, R) {
  const total = legSum(group.map((x) => ({ amount: x.amountIn })));
  const pending = group.every((x) => x.status === 'PENDING_DEPOSIT'), sent = group.some((x) => x.sentTx);
  const ended = group.every((x) => REAL_END.includes(x.status) || x.status === 'INCOMPLETE_DEPOSIT');
  const moving = group.some((x) => ['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'].includes(x.status));
  const d0 = REAL_DST[group[0].to] || REAL_DST.USDC;
  R += bridgeSvg({ sym: 'NEAR', chain: 'near', amount: total }, { sym: ds(d0[0]), chain: d0[1], amount: null }, moving, 'real');
  R += `<p class="small muted">${t('split.picture', { n: group.length, c: new Set(group.map((x) => x.chain)).size })}</p>`;
  const lk = (x) => x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">tx ↗</a>` : '';
  let L = `<div class="realswap"><p class="small"><b>${t('split.head', { n: group.length, total })}</b></p>${pending && !sent ? `<button type="button" class="editquote" data-realedit="1">✎ ${t('real.edit')}</button>` : ''}<ol class="legst">` +
    group.map((x) => `<li class="st-${x.status}"><span class="leg-n">${x.leg || ''}</span><span class="legst-tx">${x.amountIn} NEAR → <b>${esc(String(amt(x.amountOut)))} ${esc(DST_LABEL(x.to))}</b><br><span class="muted small" title="${esc(x.recipient)}">${esc(shortAddr(x.recipient))}</span> ${(x.dest || []).map(lk).join(' ')}</span><span class="legst-st" title="${esc(t('real.s.' + x.status))}">${SPLIT_ST[x.status] || '·'} ${t('split.st.' + x.status)}</span></li>`).join('') + `</ol>`;
  if (pending && !sent) {
    R += feeBox(group);
    const w = (ui.wallet || {}).near;
    L += w ? `<div class="walletsend"><button class="primary big" data-walletsend="1" ${ui.walletBusy ? 'disabled' : ''}>${ui.walletBusy ? t('wallet.sending') : '👛 ' + t('split.send', { n: group.length })}</button><p class="small">${t('split.sendNote', { total, n: group.length })}</p></div>`
      : `<div class="walletsend"><button class="primary" data-wallet="near">🔗 ${t('wallet.needConnect', { w: WALLET_NAME.near })}</button></div>`;
    L += `<details class="realmanual" data-keep="manual"${keepOpen('manual', !w)}><summary>${t('real.manual')}</summary><p class="small">${t('split.manual')}</p><ul class="small">${group.map((x) => `<li>${x.amountIn} wNEAR → <code>${esc(x.depositAddress)}</code> <button class="linkbtn" data-copy="${esc(x.depositAddress)}">${t('real.copy')}</button></li>`).join('')}</ul></details>`;
    L += ui.realCancelAsk ? `<div class="realcancel"><p class="small"><b>${t('real.cancelSure')}</b></p><div class="row"><button class="danger" data-realcancel="yes">${t('real.cancelYes')}</button><button data-realcancel="no">${t('real.cancelNo')}</button></div></div>`
      : `<button class="linkbtn realcancel-btn" data-realcancel="ask">✕ ${t('split.cancel')}</button>`;
  } else if (sent && !ended) L += `<p class="ok small">✓ ${t('wallet.sentTx', { h: esc(shortAddr(group.find((x) => x.sentTx).sentTx)) })}</p>`;
  L += `</div>`;
  if (ended) L += `<button class="primary" data-realnew="1">${t('real.again')}</button>`;
  return R + COL_MARK + L;
}
// ---------- what the swap really costs, shown before the player approves ----------
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '?' : '$' + Number(v).toFixed(2));
function feeBox(list) {
  if (!list.length) return '';
  const x0 = list[0], anyS = x0.dir === 'any', inDir = x0.dir === 'in', sym = anyS || inDir ? ds(x0.fromSym) : 'NEAR', chain = anyS || inDir ? x0.fromChain : 'near';
  const add = (k) => list.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const amountIn = Math.round(add('amountIn') * 1e6) / 1e6, usdIn = add('usdIn'), usdOut = add('usdOut');
  const mk = list.every((x) => x.mkt) ? { in: list.reduce((a, x) => a + x.mkt.in, 0), out: list.reduce((a, x) => a + x.mkt.out, 0) } : null;
  const vin = mk ? mk.in : usdIn, vout = mk ? mk.out : usdOut, cost = vin - vout, pct = vin > 0 ? (cost / vin) * 100 : null;
  const level = pct == null ? '' : pct < 0 ? 'good' : pct < 1 ? 'good' : pct < 3 ? 'mid' : 'high';
  const outTxt = list.length === 1 ? `${esc(String(amt(x0.amountOut)))} ${esc(anyS ? `${ds(x0.toSym)} (${netName(x0.chain)})` : inDir ? 'NEAR' : DST_LABEL(x0.to))}` : t('fee.parts', { n: list.length });
  const gas = chain === 'near' || chain === 'sol' || chain === 'base' ? t('fee.gas.' + chain) : isEvm(chain) ? t('fee.gas.evm', { chain: netName(chain) }) : t('fee.gas.other', { chain: netName(chain) });
  const time = Math.max(...list.map((x) => Number(x.timeEstimate) || 0));
  return `<div class="feebox"><div class="fee-h">🧾 ${t('fee.title')}</div><table>` +
    `<tr><td>${t('fee.send')}</td><td class="n"><b>${amountIn} ${esc(sym)}</b> <span class="muted">≈ ${money(vin)}</span></td></tr>` +
    `<tr><td>${t('fee.arrives')}</td><td class="n"><b>${outTxt}</b> <span class="muted">≈ ${money(vout)}</span></td></tr>` +
    `<tr class="fee-cost ${level}"><td>${t(cost < 0 ? 'fee.gain' : 'fee.cost')}</td><td class="n"><b>${money(Math.abs(cost))}</b>${pct != null ? ` (%${Math.abs(pct).toFixed(1)})` : ''}</td></tr></table>` +
    `<p class="small muted">${mk ? t('fee.costNoteMarket') : t('fee.costNoteIntents')}${mk ? ` ${t('fee.intentsSays', { a: money(usdIn), b: money(usdOut) })}` : ''}</p>` +
    `<p class="small muted">⛽ ${gas}${time ? ` · ⏱ ${t('fee.time', { n: time })}` : ''}</p>` + (list.length === 1 ? altBox(x0, cost) : '') + `</div>`;
}
// other ways to do this swap, checked live when the quote was taken (only to compare; the swap uses NEAR Intents)
function altBox(sw, cost) {
  const a = sw.alt;
  if (!a) return '';
  const o = a.omni || {}, l = a.lifi || {}, inDir = sw.dir === 'in';
  const omniTxt = o.ok ? `<b>${money(o.usd)}</b> ${t('alt.omniFee')} · <span class="muted">${t(inDir ? 'alt.omniNoteIn' : 'alt.omniNoteOut', { sym: inDir ? sw.fromSym : DST_LABEL(sw.to) })}</span>`
    : `<span class="muted">${t(o.why === 'same-chain' ? 'alt.sameChain' : o.why === 'token' ? 'alt.omniNoToken' : o.why === 'no-near' ? 'alt.omniNoNear' : 'alt.omniFail')}</span>`;
  const lq = a.lifiQuote, outSym = sw.dir === 'any' ? ds(sw.toSym) : inDir ? 'NEAR' : DST_LABEL(sw.to);
  const lifiTxt = lq ? (lq.ok ? `<b>${esc(String(lq.toAmount))} ${esc(outSym)}</b>${lq.usdOut ? ` ≈ ${money(lq.usdOut)}` : ''} <span class="muted">· ${t('alt.lifiVia', { tool: esc(lq.tool) })}${lq.feeUsd || lq.gasUsd ? ` · ${t('alt.lifiCosts', { f: money(lq.feeUsd), g: money(lq.gasUsd) })}` : ''}</span><br><b>${Number(lq.toAmount) > Number(sw.amountOut) ? t('alt.lifiBetter') : t('alt.intentsBetter')}</b>` : `<span class="muted">${t('alt.lifiNoQuote')}</span>`)
    : !l.checked ? `<span class="muted">${t('alt.lifiFail')}</span>` : l.near ? t('alt.lifiYes') : `<span class="muted">${t('alt.lifiNo', { n: l.chains })}</span>`;
  const sum = `${t('alt.title')}: Omni ${o.ok ? money(o.usd) : '—'} · LI.FI ${lq ? (lq.ok ? `${esc(String(lq.toAmount))} ${esc(outSym)}` : '—') : l.checked ? (l.near ? '✓' : t('alt.noNear')) : '?'}`;
  return `<details class="altbox" data-keep="alt"${keepOpen('alt')}><summary>🔎 ${sum}</summary><table>` +
    `<tr><td><b>NEAR Intents</b></td><td>${lq && lq.ok ? `<b>${esc(String(amt(sw.amountOut)))} ${esc(outSym)}</b> · ` : ''}<b>${money(cost)}</b> ${t('alt.intentsNote')} ✓</td></tr>` +
    `<tr><td><b>Omni Bridge</b><br><span class="muted small">${t('alt.omniWho')}</span></td><td>${omniTxt}</td></tr>` +
    `<tr><td><b>LI.FI / Jumper</b><br><span class="muted small">${t('alt.lifiWho')}</span></td><td>${lifiTxt}</td></tr></table>` +
    `<p class="muted small">${t('alt.note', { time: new Date(a.at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }) })}</p></details>`;
}
// the screen is drawn again every few seconds (live village), so a section the player opened or closed
// keeps that state: each one remembers it under its own name
ui.open = ui.open || {};
const keepOpen = (key, byDefault = false) => ((key in ui.open ? ui.open[key] : byDefault) ? ' open' : '');
document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.tagName === 'DETAILS' && d.dataset.keep && d.isConnected) ui.open[d.dataset.keep] = d.open; }, true);
// ---------- any token on any chain (the list comes live from NEAR Intents) ----------
const WNEAR_ID = 'nep141:wrap.near';
const ds = (sym) => (sym === 'wNEAR' ? 'NEAR' : sym);
const CHAIN_LABEL = { near: 'NEAR', sol: 'Solana', eth: 'Ethereum', base: 'Base', arb: 'Arbitrum', op: 'Optimism', pol: 'Polygon', bsc: 'BNB Chain', avax: 'Avalanche', gnosis: 'Gnosis', bera: 'Berachain', btc: 'Bitcoin', tron: 'Tron', sui: 'Sui', ton: 'TON', doge: 'Dogecoin', xrp: 'XRP', zec: 'Zcash', ltc: 'Litecoin', aptos: 'Aptos', cardano: 'Cardano', stellar: 'Stellar', bch: 'Bitcoin Cash' };
const netName = (c) => CHAIN_LABEL[c] || String(c || '').toUpperCase();
const EVM_IDS = { eth: 1, base: 8453, arb: 42161, op: 10, pol: 137, bsc: 56, avax: 43114, gnosis: 100, bera: 80094 };
const isEvm = (c) => !!EVM_IDS[c];
// which wallet in this browser can send from a chain ('base' stands for any EVM wallet such as MetaMask)
const walletKind = (c) => (c === 'near' ? 'near' : c === 'sol' ? 'sol' : isEvm(c) ? 'base' : null);
const POP_CHAINS = ['near', 'sol', 'base', 'eth', 'arb', 'op', 'pol', 'bsc', 'avax', 'btc', 'tron'];
const POP_SYMS = ['USDC', 'USDT', 'NEAR', 'wNEAR', 'ETH', 'SOL', 'BTC', 'ARB', 'OP', 'POL', 'BNB', 'AVAX'];
const A = (id) => (ui.assets || []).find((x) => x.id === id) || null;
const findAsset = (sym, chain) => (ui.assets || []).find((x) => x.sym === sym && x.chain === chain) || null;
const assetLabel = (id) => { const x = A(id); return x ? `${ds(x.sym)} (${netName(x.chain)})` : id; };
const nice = (n) => { n = Number(n); if (!Number.isFinite(n) || n <= 0) return 0; const d = n >= 100 ? 0 : n >= 1 ? 2 : Math.min(8, Math.ceil(-Math.log10(n)) + 2); return Number(n.toFixed(d)); };
const usdLimits = (x) => (x.id === WNEAR_ID ? { min: 0.1, max: 5 } : { min: nice(((ui.assetLimits || {}).min || 0.4) / x.price), max: nice(((ui.assetLimits || {}).max || 20) / x.price) });
async function loadAssets() {
  if (ui.assets || ui.assetsLoading) return;
  ui.assetsLoading = true;
  const r = await (await fetch('/api/intents/assets')).json().catch(() => null);
  ui.assetsLoading = false;
  if (r && r.ok && r.assets && r.assets.length) { ui.assets = r.assets; ui.assetLimits = { min: r.min, max: r.max }; render(); }
}
// the old menu choices, written as asset ids (so the AI and older swaps fit the new card)
function oldToAny(f) {
  const w = A(WNEAR_ID) ? WNEAR_ID : null;
  const pick = (pair) => (pair ? (findAsset(pair[0], pair[1]) || {}).id : null);
  const fromId = f.dir === 'in' ? pick(REAL_SRC[f.from]) : w;
  const toId = f.dir === 'in' ? w : pick(REAL_DST[f.to]);
  return fromId && toId ? { any: true, fromId, toId } : { any: false };
}
const savedFor = (w, c) => w[c] || (isEvm(c) ? w.evm || w.base || '' : '');
const coinBg = (sym) => ASSET_COLOR[sym] || `hsl(${[...String(sym)].reduce((a, ch) => a + ch.charCodeAt(0), 0) * 37 % 360} 45% 45%)`;
const coinGlyph = (sym) => GLYPH[sym] || esc(String(sym).replace(/^w(?=[A-Z])/, '')[0] || '?');
// one side of the card: "Network ▾" and "Token ▾" as two separate, clear buttons
function sidePick(side, x) {
  const ch = chainOf(x.chain), col = ch ? ch[1] : '#556';
  return `<div class="netrow"><button type="button" class="netbtn" data-pickopen="${side}:chain" style="--c:${col}"><span class="nb-lab">${t('any.network')}</span><span class="nb-ic">${CHAIN_ICON[x.chain] || esc(netName(x.chain)[0])}</span><b>${esc(netName(x.chain))}</b><span class="tp-caret">▾</span></button>` +
    `<button type="button" class="tokbtn" data-pickopen="${side}:token"><span class="nb-lab">${t('any.token')}</span><span class="tc-coin" style="background:${coinBg(x.sym)}">${coinGlyph(x.sym)}</span><b>${esc(ds(x.sym))}</b><span class="tp-caret">▾</span></button></div>`;
}
// choosing, in place of the card: first the network (big buttons), then a token on it (most used first)
function pickerView(side, step) {
  const f = ui.real || {}, cur = pickCur(side) || {};
  const order = (c) => { const i = POP_CHAINS.indexOf(c); return i < 0 ? 99 : i; };
  const symOrder = (sym) => { const i = POP_SYMS.indexOf(sym); return i < 0 ? 99 : i; };
  const title = side.startsWith('leg') ? t('any.pickLeg', { n: Number(side.slice(3)) + 1 }) : t(side === 'from' ? 'any.pickFrom' : 'any.pickTo');
  let h = `<div class="pickview"><div class="pv-head"><button type="button" class="linkbtn" data-pickclose="1">← ${t('any.back')}</button><b>${title}</b></div>`;
  if (step === 'chain') {
    const counts = {}; for (const x of ui.assets || []) counts[x.chain] = (counts[x.chain] || 0) + 1;
    const chains = Object.keys(counts).sort((a, b) => order(a) - order(b) || netName(a).localeCompare(netName(b)));
    h += `<div class="step-h"><span class="stepn">a</span>${t('any.stepChain')}</div><div class="pv-chains" data-keepscroll="pvc-${side}">${chains.map((c) => { const ch = chainOf(c), col = ch ? ch[1] : '#556';
      return `<button type="button" class="pv-chain${cur.chain === c ? ' on' : ''}" data-pickchainset="${side}|${c}" style="--c:${col}"><span class="nb-ic">${CHAIN_ICON[c] || esc(netName(c)[0])}</span><b>${esc(netName(c))}</b><span class="pv-n">${t('any.tokens', { n: counts[c] })}${walletKind(c) ? '' : ' · ' + t('any.byHand')}</span></button>`; }).join('')}</div>`;
  } else {
    const c = ui.pickChain || cur.chain, ch = chainOf(c), col = ch ? ch[1] : '#556';
    const list = (ui.assets || []).filter((x) => x.chain === c).sort((a, b) => symOrder(a.sym) - symOrder(b.sym) || a.sym.localeCompare(b.sym));
    const q = (ui.pickQ || '').trim().toLowerCase();
    h += `<div class="step-h"><span class="stepn">b</span>${t('any.stepToken', { chain: `<span style="color:${col}">${esc(netName(c))}</span>` })} <button type="button" class="linkbtn small" data-pickopen="${side}:chain">${t('any.otherChain')}</button></div>` +
      (list.length > 8 ? `<input id="pick-search" class="pv-search" autocomplete="off" placeholder="${esc(t('any.searchToken'))}" value="${esc(ui.pickQ || '')}">` : '') +
      `<div class="pv-tokens" data-keepscroll="pv-${side}">${list.map((x) => `<button type="button" class="pv-token${cur.id === x.id ? ' on' : ''}" data-pickasset="${side}|${esc(x.id)}" data-q="${esc(x.sym.toLowerCase())}"${q && !x.sym.toLowerCase().includes(q) ? ' hidden' : ''}><span class="tc-coin" style="background:${coinBg(x.sym)}">${coinGlyph(x.sym)}</span><b>${esc(ds(x.sym))}</b><span class="pk-price">$${x.price >= 1 ? x.price.toFixed(2) : x.price.toPrecision(3)}</span></button>`).join('')}<p class="muted small pk-none" hidden>${t('any.none')}</p></div>`;
  }
  return h + `</div>`;
}
function tokPick(side, x) {
  const ch = chainOf(x.chain);
  return `<button type="button" class="tokpick${ui.picker === side ? ' on' : ''}" data-pickopen="${side}"><span class="tc-coin" style="background:${coinBg(x.sym)}">${coinGlyph(x.sym)}</span><span class="tc-txt"><b>${esc(ds(x.sym))}</b><span class="tc-chain" style="color:${ch ? ch[1] : '#555'}">${esc(netName(x.chain))}</span></span><span class="tp-caret">▾</span></button>`;
}
function pickerPanel(side) {
  const q = (ui.pickQ || '').trim().toLowerCase(), only = ui.pickChain || '';
  const present = [...new Set((ui.assets || []).map((x) => x.chain))];
  const order = (c) => { const i = POP_CHAINS.indexOf(c); return i < 0 ? 99 : i; };
  const chains = present.sort((a, b) => order(a) - order(b) || netName(a).localeCompare(netName(b)));
  const symOrder = (s) => { const i = POP_SYMS.indexOf(s); return i < 0 ? 99 : i; };
  const list = (ui.assets || []).filter((x) => !only || x.chain === only)
    .sort((a, b) => order(a.chain) - order(b.chain) || symOrder(a.sym) - symOrder(b.sym) || a.sym.localeCompare(b.sym));
  const key = (x) => `${x.sym} ${netName(x.chain)} ${x.chain}`.toLowerCase();
  return `<div class="pickpanel"><div class="pk-top"><input id="pick-search" autocomplete="off" placeholder="${esc(t('any.search'))}" value="${esc(ui.pickQ || '')}"><button type="button" class="linkbtn" data-pickclose="1">✕</button></div>` +
    `<div class="pk-chains"><button type="button" class="${only ? '' : 'on'}" data-pickchain="">${t('any.allChains')}</button>${chains.map((c) => { const ch = chainOf(c); return `<button type="button" class="${only === c ? 'on' : ''}" data-pickchain="${c}" style="--c:${ch ? ch[1] : '#556'}">${esc(netName(c))}</button>`; }).join('')}</div>` +
    `<div class="pk-list" data-keepscroll="pk-${side}">${list.map((x) => { const ch = chainOf(x.chain); return `<button type="button" class="pk-item" data-pickasset="${side}|${esc(x.id)}" data-q="${esc(key(x))}"${q && !key(x).includes(q) ? ' hidden' : ''}><span class="tc-coin" style="background:${coinBg(x.sym)}">${coinGlyph(x.sym)}</span><b>${esc(ds(x.sym))}</b><span class="pk-chain" style="color:${ch ? ch[1] : '#555'}">${esc(netName(x.chain))}</span><span class="pk-price">$${x.price >= 1 ? x.price.toFixed(2) : x.price.toPrecision(3)}</span></button>`; }).join('')}<p class="muted small pk-none" hidden>${t('any.none')}</p></div></div>`;
}
function swapCardAny(f) {
  const a = A(f.fromId) || A(WNEAR_ID), b = A(f.toId) || (ui.assets || []).find((x) => x.id !== a.id);
  const lim = usdLimits(a);
  const amtV = f.amount >= lim.min && f.amount <= lim.max ? f.amount : nice(1 / a.price);
  const need = ((ui.aiSwap && ui.aiSwap.reply && ui.aiSwap.reply.missing) || []);
  const kA = walletKind(a.chain), kB = walletKind(b.chain), wA = kA && (ui.wallet || {})[kA], wB = kB && (ui.wallet || {})[kB];
  const sw0 = savedWallets(), refundV = f.refundTo || wA || savedFor(sw0, a.chain);
  const recipV = f.recipient || (ui.recipTyped ? '' : wB) || (b.chain !== a.chain ? savedFor(sw0, b.chain) : '');
  const using = wA && wA === refundV;
  const splitOk = a.id === WNEAR_ID;
  const legs = splitOk && f.legs;
  return `<div class="step-h"><span class="stepn">2</span>${t('real.step2')}</div><div class="swapcard">` +
    `<div class="sc-side"><div class="sc-head">${t('real.youSend')}</div>${sidePick('from', a)}` +
    (legs ? `<div class="sc-amt"><b class="split-sum">${legSum(f.legs)}</b> <b>NEAR</b> <span class="sc-range">${t('split.sumNote')}</span></div>`
      : `<div class="sc-amt" title="${esc(t('any.range', { min: lim.min, max: lim.max, sym: ds(a.sym) }))}"><input id="real-amount" type="text" inputmode="decimal" autocomplete="off" value="${amtV}"><b>${esc(ds(a.sym))}</b><span class="sc-range">${lim.min}–${lim.max}</span></div><div class="sc-usd small muted" data-price="${a.price}">≈ $${(amtV * a.price).toFixed(2)}</div>`) +
    (using ? `<div class="sc-lab sc-using" title="${esc(refundV)}">✓ ${t('wallet.usingThis', { a: esc(shortAddr(refundV)) })}</div><input type="hidden" id="real-refund" value="${esc(refundV)}">`
      : `<label class="sc-lab" title="${esc(t('real.fromHint'))}">${t('any.fromWallet', { chain: esc(netName(a.chain)) })} ⓘ</label><input id="real-refund" class="${need.length && !refundV ? 'need' : ''}" placeholder="${esc(addrPh(a.chain))}" value="${esc(refundV)}">`) +
    tokenProof(a) + `</div><button type="button" class="sc-flip" data-realflip="1" title="${esc(t('real.flip'))}">⇅</button>` +
    (legs ? `<div class="sc-side"><div class="sc-head sc-headrow">${t('split.receivers')} <button type="button" class="linkbtn small" data-splitoff="1">← ${t('split.one')}</button></div>${legRows(f)}</div>`
      : `<div class="sc-side"><div class="sc-head">${t('real.youGet')}</div>${sidePick('to', b)}` +
        `<label class="sc-lab" title="${esc(t('any.toHint', { sym: ds(b.sym), chain: netName(b.chain) }))}">${t('any.toWallet', { chain: esc(netName(b.chain)) })} ⓘ</label><div class="recip-row"><input id="real-recip" class="${need.length && !recipV ? 'need' : ''}" placeholder="${esc(addrPh(b.chain))}" value="${esc(recipV)}">${recipV ? `<button type="button" class="linkbtn small" data-recipclear="1">${t('any.otherAddr')}</button>` : ''}</div>` +
        `<div class="sc-hint">${wB && recipV === wB ? '✓ ' + t('any.toOwn') : recipV ? '⚠️ ' + t('any.toOther') : ''}</div>${tokenProof(b)}</div>` +
        (splitOk ? `<button type="button" class="linkbtn split-btn" data-legadd="1">＋ ${t('split.start')}</button>` : `<button type="button" class="linkbtn split-btn" data-splitnear="1" title="${esc(t('split.fromNearHint'))}">＋ ${t('split.startNear')}</button>`)) +
    `</div><button class="primary sc-go" data-realquote="1" ${ui.realBusy ? 'disabled' : ''}><span class="stepn">3</span> ${ui.realBusy ? t('ai.thinking') : legs ? t('split.getQuotes', { n: f.legs.length }) : t('real.getQuote')}</button>`;
}
const TOKEN_PAGE = { near: 'https://nearblocks.io/token/', sol: 'https://solscan.io/token/', base: 'https://basescan.org/token/', eth: 'https://etherscan.io/token/', arb: 'https://arbiscan.io/token/', op: 'https://optimistic.etherscan.io/token/', pol: 'https://polygonscan.com/token/', bsc: 'https://bscscan.com/token/', avax: 'https://snowtrace.io/token/', gnosis: 'https://gnosisscan.io/token/', tron: 'https://tronscan.org/#/token20/' };
function tokenProof(x) {
  if (!x) return '';
  if (!x.contract) return `<div class="tproof">🪙 ${t('any.native', { chain: esc(netName(x.chain)) })}</div>`;
  const page = TOKEN_PAGE[x.chain], short = x.contract.length > 18 ? x.contract.slice(0, 8) + '…' + x.contract.slice(-6) : x.contract;
  return `<div class="tproof" title="${esc(x.contract)}">🔎 ${t('any.contract')}: <code>${esc(short)}</code>${page ? ` <a href="${page}${encodeURIComponent(x.contract)}" target="_blank" rel="noopener">${t('any.verify')} ↗</a>` : ''}</div>`;
}
const addrPh = (c) => (c === 'near' ? 'yourname.near' : c === 'sol' ? 'Solana address (e.g. 7xKX…)' : isEvm(c) ? '0x…' : c === 'btc' ? 'bc1…' : c === 'tron' ? 'T…' : t('any.addrOf', { chain: netName(c) }));
// choose a token for one side; picking the other side's token swaps the two
const pickCur = (side) => { const f = ui.real || {}; if (side.startsWith('leg')) { const l = (f.legs || [])[Number(side.slice(3))]; return l ? A(l.to) : null; } return A(side === 'from' ? f.fromId : f.toId); };
function pickAsset(side, id) {
  readRealForm();
  const f = ui.real, x = A(id);
  if (!x) return;
  if (side.startsWith('leg')) {
    const l = (f.legs || [])[Number(side.slice(3))];
    if (l) { const before = A(l.to); l.to = id; if (before && before.chain !== x.chain && !(isEvm(before.chain) && isEvm(x.chain))) l.recipient = ''; }
    ui.picker = null; ui.pickQ = ''; render(); return;
  }
  const other = side === 'from' ? 'toId' : 'fromId', mine = side === 'from' ? 'fromId' : 'toId';
  const before = A(f[mine]);
  if (f[other] === id) { f[other] = f[mine]; [f.refundTo, f.recipient] = [f.recipient, f.refundTo]; }
  f[mine] = id;
  if (side === 'from' && before) f.amount = nice((Number(f.amount) || 0) * before.price / x.price) || nice(1 / x.price);
  const same = (c1, c2) => c1 === c2 || (isEvm(c1) && isEvm(c2));
  if (before && !same(before.chain, x.chain)) { if (side === 'from') f.refundTo = ''; else f.recipient = ''; }
  if (side === 'from' && x.id !== WNEAR_ID) f.legs = null;
  ui.picker = null; ui.pickQ = ''; ui.pickChain = '';
  render();
}
function flipAny() {
  const f = ui.real, a = A(f.fromId), b = A(f.toId);
  if (!a || !b) return;
  const usd = (Number(f.amount) || 0) * a.price;
  ui.real = { ...f, fromId: b.id, toId: a.id, amount: nice(usd / b.price) || nice(1 / b.price), refundTo: f.recipient, recipient: f.refundTo, legs: null };
  play('pick'); render();
}
const TX_BASE = { near: NEAR_MAIN + '/txns/', sol: 'https://solscan.io/tx/', base: 'https://basescan.org/tx/', eth: 'https://etherscan.io/tx/', arb: 'https://arbiscan.io/tx/', op: 'https://optimistic.etherscan.io/tx/', pol: 'https://polygonscan.com/tx/', bsc: 'https://bscscan.com/tx/', avax: 'https://snowtrace.io/tx/', gnosis: 'https://gnosisscan.io/tx/', btc: 'https://mempool.space/tx/', tron: 'https://tronscan.org/#/transaction/' };
const txBase = (c) => TX_BASE[c] || null;
// a part of a split: [symbol, chain] whether it uses the old menu or a live asset id
const legDst = (l) => { const x = A(l.to); return x ? [x.sym, x.chain] : REAL_DST[l.to] || REAL_DST.USDC; };
const COL_MARK = '<!--col-->';
// step 1: big, coloured buttons for the wallets this swap needs
const CHAIN_ICON = { near: 'Ⓝ', sol: '◎', base: 'B', eth: 'Ξ', btc: '₿', arb: 'A', op: 'O', pol: 'P', bsc: 'B', avax: 'A', tron: 'T' };
const WALLET_SHORT = { near: 'Meteor / MyNearWallet', sol: 'Phantom, Solflare…', base: 'MetaMask, Rabby…', evm: 'MetaMask, Rabby…' };
function walletTiles(srcChain, dstChain) {
  const w = ui.wallet || {}, seen = new Set(), tiles = [];
  for (const c of [srcChain, dstChain]) {
    const k = walletKind(c), id = k || 'none:' + c;
    if (seen.has(id)) continue; seen.add(id);
    const ch = chainOf(c), col = ch ? ch[1] : '#556', role = c === srcChain ? t('wallet.roleSend') : t('wallet.roleGet');
    const icon = CHAIN_ICON[c] || esc(netName(c)[0]), cname = k === 'base' && isEvm(c) && c !== 'base' ? netName(c) : CH_NAME[c] || netName(c);
    if (!k) { tiles.push(`<div class="wtile manual" style="--c:${col}"><span class="wt-ic">${icon}</span><span class="wt-tx"><b>${esc(netName(c))}</b><span>${t('wallet.noBrowser')} · ${role}</span></span></div>`); continue; }
    tiles.push(w[k]
      ? `<div class="wtile on" style="--c:${col}"><span class="wt-ic">${icon}</span><span class="wt-tx"><b title="${esc(w[k])}">✓ ${esc(w[k].length > 16 ? w[k].slice(0, 5) + '…' + w[k].slice(-4) : w[k])}</b><span>${esc(cname)} · ${esc((ui.walletName || {})[k] || '')}${(ui.walletName || {})[k] ? ' · ' : ''}${role}</span></span><span class="wt-acts"><button type="button" class="wt-act" data-walletswap="${k}" title="${esc(t('wallet.swapHint'))}">⇄ ${t('wallet.swap')}</button><button type="button" class="wt-act off" data-walletoff="${k}">⏻ ${t('wallet.off')}</button></span></div>`
      : `<button type="button" class="wtile" style="--c:${col}" data-wallet="${k}"><span class="wt-ic">${icon}</span><span class="wt-tx"><b>${t('wallet.connectShort', { chain: esc(cname) })}</b><span>${WALLET_SHORT[k]} · ${role}</span></span></button>`);
  }
  return `<div class="wtiles"><div class="step-h"><span class="stepn">1</span>${t('wallet.step')}</div><div class="wtiles-row">${tiles.join('')}</div>${walletChooser()}</div>`;
}
// which of the wallets installed in this browser to connect
function walletChooser(only) {
  const ch = ui.walletChoose;
  if (!ch || (only && ch.kind !== only)) return '';
  return `<div class="wchoose"><b>${t('wallet.which', { kind: ch.kind === 'sol' ? 'Solana' : 'EVM' })}</b><div class="wchoose-row">${ch.list.map((w) => `<button type="button" class="wc-btn" data-walletpick="${ch.kind}|${esc(w.id)}">${esc(w.name)}</button>`).join('')}<button type="button" class="linkbtn" data-walletpickoff="1">${t('real.cancelNo')}</button></div><p class="muted small">${t('wallet.whichHint')}</p></div>`;
}
// a swap card like an exchange: "you send" on top, "you get" below, a ⇄ button between them
const CH_NAME = { near: 'NEAR', sol: 'Solana', base: 'Base' };
const ADDR_PH = { near: 'yourname.near', sol: 'Solana address (e.g. 7xKX…)', base: '0x…' };
function tokChip(kind, key, sym, chain, on) {
  const c = ASSET_COLOR[sym] || '#556', ch = chainOf(chain);
  return `<button type="button" class="tokchip${on ? ' on' : ''}" ${kind ? `data-realpick="${kind}:${key}"` : 'disabled'}><span class="tc-coin" style="background:${c}">${GLYPH[sym] || esc(sym[0])}</span><span class="tc-txt"><b>${esc(sym)}</b><span class="tc-chain" style="color:${ch ? ch[1] : '#555'}">${t('real.onChain', { chain: ch ? ch[0] : chain })}</span></span></button>`;
}
function swapCard(f, dir) {
  const out = dir === 'out';
  const src = out ? ['wNEAR', 'near', 0.1, 5, 0.3] : REAL_SRC[f.from] || REAL_SRC['USDC-SOL'];
  const dst = out ? REAL_DST[f.to] || REAL_DST.USDC : ['NEAR', 'near'];
  const amt = f.amount >= src[2] && f.amount <= src[3] ? f.amount : src[4];
  const need = ((ui.aiSwap && ui.aiSwap.reply && ui.aiSwap.reply.missing) || []);
  const sw0 = savedWallets(), refundV = f.refundTo || sw0[src[1]] || '', recipV = f.recipient || (dst[1] !== src[1] ? sw0[dst[1]] || '' : '');
  const sendChips = out ? tokChip(null, 'wNEAR', 'wNEAR', 'near', true)
    : Object.entries(REAL_SRC).map(([k, v]) => tokChip('from', k, v[0], v[1], f.from === k)).join('');
  const getChips = out ? Object.entries(REAL_DST).map(([k, v]) => tokChip('to', k, v[0], v[1], f.to === k)).join('')
    : tokChip(null, 'NEAR', 'NEAR', 'near', true);
  return `<div class="step-h"><span class="stepn">2</span>${t('real.step2')}</div><div class="swapcard">` +
    (out ? `<div class="sc-side"><div class="sc-head sc-headrow">${t('real.youSend')} ${sendChips}</div>` : `<div class="sc-side"><div class="sc-head">${t('real.youSend')}</div><div class="tokrow">${sendChips}</div>`) +
    (out && f.legs ? `<div class="sc-amt"><b class="split-sum">${legSum(f.legs)}</b> <b>NEAR</b> <span class="sc-range">${t('split.sumNote')}</span></div>` : `<div class="sc-amt" title="${esc(t('real.range', { min: src[2], max: src[3], sym: src[0] }))}"><input id="real-amount" type="number" min="${src[2]}" max="${src[3]}" step="${src[0] === 'SOL' ? 0.001 : 0.1}" value="${amt}"><b>${esc(src[0])}</b><span class="sc-range">${src[2]}–${src[3]}</span></div>`) +
        ((ui.wallet || {})[src[1]] && (ui.wallet || {})[src[1]] === refundV
          ? `<div class="sc-lab sc-using" title="${esc(refundV)}">✓ ${t('wallet.usingThis', { a: esc(shortAddr(refundV)) })}</div><input type="hidden" id="real-refund" value="${esc(refundV)}">`
          : `<label class="sc-lab" title="${esc(t('real.fromHint'))}">${t('real.fromWallet', { chain: CH_NAME[src[1]] })} ⓘ</label><input id="real-refund" class="${need.includes('wallet:' + src[1]) && !refundV ? 'need' : ''}" placeholder="${esc(ADDR_PH[src[1]])}" value="${esc(refundV)}">`) +
    `</div>` +
    `<button type="button" class="sc-flip" data-realflip="1" title="${esc(t('real.flip'))}">⇅</button>` +
    (out && f.legs ? `<div class="sc-side"><div class="sc-head">${t('split.receivers')}</div>${legRows(f)}` : (!out ? `<div class="sc-side"><div class="sc-head sc-headrow">${t('real.youGet')} ${getChips}</div>` : `<div class="sc-side"><div class="sc-head">${t('real.youGet')}</div><div class="tokrow">${getChips}</div>`) +
    
    `<label class="sc-lab" title="${esc(out ? t('real.toHint', { sym: dst[0], chain: CH_NAME[dst[1]] }) : t('real.toHintNear'))}">${t('real.toWallet', { chain: CH_NAME[dst[1]] })} ⓘ</label><input id="real-recip" class="${need.includes('wallet:' + dst[1]) && !recipV ? 'need' : ''}" placeholder="${esc(ADDR_PH[dst[1]])}" value="${esc(recipV)}">` +
    `</div>` + (out ? `<button type="button" class="linkbtn split-btn" data-legadd="1">＋ ${t('split.start')}</button>` : '')) +
    `</div><button class="primary sc-go" data-realquote="1" ${ui.realBusy ? 'disabled' : ''}><span class="stepn">3</span> ${ui.realBusy ? t('ai.thinking') : out && f.legs ? t('split.getQuotes', { n: f.legs.length }) : t('real.getQuote')}</button>`;
}
// turn the swap round, keeping the token and the wallets that still fit
function flipReal() {
  readRealForm();
  if (ui.real.any && A(ui.real.fromId) && A(ui.real.toId)) { flipAny(); return; }
  if (ui.real.legs) { const l = ui.real.legs[0]; ui.real.to = l.to; ui.real.amount = l.amount; ui.real.recipient = l.recipient; ui.real.legs = null; }
  const f = ui.real;
  if (f.dir === 'out') {
    const d = REAL_DST[f.to] || REAL_DST.USDC;
    const from = d[1] === 'near' ? 'USDC-SOL' : f.to;
    const s0 = REAL_SRC[from];
    ui.real = { ...f, dir: 'in', from, amount: s0[4], refundTo: d[1] === s0[1] ? f.recipient : '', recipient: f.refundTo };
  } else {
    const s0 = REAL_SRC[f.from] || REAL_SRC['USDC-SOL'];
    ui.real = { ...f, dir: 'out', to: f.from, amount: 0.3, refundTo: f.recipient, recipient: f.refundTo };
    if (!REAL_DST[ui.real.to]) ui.real.to = 'USDC';
    if ((REAL_DST[ui.real.to] || [])[1] !== s0[1]) ui.real.recipient = '';
  }
  play('pick');
  render();
}
function pickReal(spec) {
  readRealForm();
  const [kind, key] = spec.split(':'), f = ui.real;
  if (kind === 'from' && f.from !== key) { const old = REAL_SRC[f.from] || [], s0 = REAL_SRC[key]; ui.real = { ...f, from: key, amount: s0[4], refundTo: old[1] === s0[1] ? f.refundTo : '' }; }
  if (kind === 'to' && f.to !== key) { const old = REAL_DST[f.to] || [], d = REAL_DST[key]; ui.real = { ...f, to: key, recipient: old[1] === d[1] ? f.recipient : '' }; }
  render();
}
// ---------- say the swap in words: NEAR AI fills the card ----------
// wallets the player used before are remembered in this browser only, so "to my Solana wallet" just works
function savedWallets() { try { return JSON.parse(localStorage.getItem('ew.wallets') || '{}') || {}; } catch { return {}; } }
function rememberWallets(f) {
  const w = savedWallets();
  if (f.any && A(f.fromId) && A(f.toId)) {
    const sc = A(f.fromId).chain, dc = A(f.toId).chain;
    if (f.refundTo) { w[sc] = f.refundTo; if (isEvm(sc)) w.evm = f.refundTo; }
    if (f.recipient && dc !== sc) { w[dc] = f.recipient; if (isEvm(dc)) w.evm = f.recipient; }
    try { localStorage.setItem('ew.wallets', JSON.stringify(w)); } catch {}
    return;
  }
  const src = f.dir === 'in' ? (REAL_SRC[f.from] || [])[1] : 'near', dst = f.dir === 'in' ? 'near' : (REAL_DST[f.to] || [])[1];
  if (f.refundTo && src) w[src] = f.refundTo;
  if (f.recipient && dst && !(dst === 'near' && src === 'near')) w[dst] = f.recipient;
  try { localStorage.setItem('ew.wallets', JSON.stringify(w)); } catch {}
}
// wallets to offer the AI: ones used before, overridden by what is typed in the card right now
function walletsNow() {
  const w = { ...savedWallets() }, f = ui.real || {};
  const src = f.dir === 'in' ? (REAL_SRC[f.from] || [])[1] : 'near', dst = f.dir === 'in' ? 'near' : (REAL_DST[f.to] || [])[1];
  if (f.refundTo && src) w[src] = f.refundTo;
  if (f.recipient && dst && !(dst === 'near' && src === 'near')) w[dst] = f.recipient;
  return w;
}
function aiSwapBox() {
  const a = ui.aiSwap || {}, ex = t('aiswap.example');
  let h = `<div class="aiswap"><div class="aiswap-head">🤖 ${t('aiswap.title')} <span class="aiswap-tag">NEAR AI${view.ai && view.ai.tee ? ' · TEE' : ''}</span></div>` +
    `<div class="row"><input id="ai-swap" placeholder="${esc(ex)}" value="${esc(a.text || '')}" maxlength="300"><button class="primary" data-aiswap="1" ${a.busy ? 'disabled' : ''}>${t(a.busy ? 'ai.thinking' : 'aiswap.go')}</button></div>`;
  if (!a.text && !a.reply) h += `<div class="aiswap-ex">${[ex, t('aiswap.example3')].map((x) => `<button type="button" class="linkbtn" data-aiswapex="${esc(x)}">“${esc(x)}”</button>`).join('')}</div>`;
  const r = a.reply;
  if (r) {
    const f = r.form, src = f.dir === 'in' ? REAL_SRC[f.from] : ['NEAR', 'near'], dst = f.dir === 'in' ? ['NEAR', 'near'] : REAL_DST[f.to];
    h += `<div class="aiswap-reply"><p><b>${t('aiswap.understood')}</b> ${f.amount} ${esc(src[0])} (${CH_NAME[src[1]]}) → ${esc(dst[0])} (${CH_NAME[dst[1]]})</p>`;
    if (r.say) h += `<p class="aiswap-say">“${esc(r.say)}”</p>`;
    const shortA = (x) => x ? (x.length > 22 ? x.slice(0, 8) + '…' + x.slice(-6) : x) : '—';
    h += `<p class="small">${t('aiswap.wallets', { a: esc(shortA(f.refundTo)), b: esc(shortA(f.recipient)) })}</p>`;
    if (r.missing.length) h += `<p class="closed small">${t('aiswap.missing')} ${r.missing.map((m) => m.startsWith('wallet:') ? t('aiswap.m.wallet', { chain: CH_NAME[m.slice(7)] }) : m === 'range' ? t('aiswap.m.range', r.limits) : t('aiswap.m.' + m)).join(' · ')}</p><p class="muted small">${t('aiswap.fillBelow')}</p>`;
    else if (r.quoteError) h += `<p class="closed small">${t(r.quoteError)}</p>`;
    h += `<p class="muted small">${r.by === 'ai' ? t('aiswap.byAi', { m: esc(r.model || 'NEAR AI') }) : t('aiswap.byRules')}</p></div>`;
  }
  return h + `</div>`;
}
async function aiSwapNow() {
  const el = $('ai-swap'), text = el ? el.value.trim() : '';
  if (!text) return;
  if (el) el.blur(); // a focused field keeps the card from redrawing
  readRealForm();
  ui.aiSwap = { text, busy: true, reply: null }; render();
  const r = await post('/api/ai/swap', { player: playerId, text, lang: getLang(), wallets: walletsNow() });
  ui.aiSwap = { text, busy: false, reply: r && r.ok ? r : null };
  if (!r || !r.ok) { toast(t('aiswap.fail'), 'bad'); render(); return; }
  ui.real = { ...r.form };
  if (ui.assets) Object.assign(ui.real, oldToAny(ui.real));
  if (r.swap) { rememberWallets(ui.real); view.realSwaps = [r.swap, ...(view.realSwaps || [])]; pollReal(r.swap.depositAddress); play('coin'); }
  render();
}
// ---------- the player's own wallets (loaded only when used) ----------
// connecting only fills the address; every transfer is approved by the player in their wallet
let WL = null;
async function walletLib() {
  if (!WL) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/vendor/wallets.css'; document.head.appendChild(l);
    WL = await import('/vendor/wallets.js');
    try { localStorage.setItem('ew.walletUsed', '1'); } catch {}
  }
  return WL;
}
const WALLET_NAME = { near: 'Meteor / MyNearWallet', sol: 'Phantom, Solflare…', base: 'MetaMask, Rabby…' };
const shortAddr = (x) => (x && x.length > 22 ? x.slice(0, 6) + '…' + x.slice(-5) : x || '');
function walletRow(srcChain, dstChain) {
  const chains = [...new Set([srcChain, dstChain])];
  const w = ui.wallet || {};
  return `<div class="walletrow"><span class="wr-title">👛 ${t('wallet.title')}</span>${chains.map((c) => w[c]
    ? `<span class="wr-on" title="${esc(w[c])}">✓ ${esc(CH_NAME[c])}: <b>${esc(shortAddr(w[c]))}</b>${c === 'near' ? ` <button type="button" class="linkbtn" data-walletoff="near">${t('wallet.off')}</button>` : ''}</span>`
    : `<button type="button" class="wr-btn" data-wallet="${c}">🔗 ${t('wallet.connect', { chain: CH_NAME[c], w: WALLET_NAME[c] })}</button>`).join('')}<div class="sc-hint">${t('wallet.hint')}</div></div>`;
}
function walletSendBox(sw) {
  if (sw.status !== 'PENDING_DEPOSIT') return '';
  const chain = sw.dir === 'in' || sw.dir === 'any' ? sw.fromChain : 'near', sym = sw.dir === 'in' || sw.dir === 'any' ? ds(sw.fromSym) : 'NEAR', kind = walletKind(chain), w = (ui.wallet || {})[kind];
  if (sw.sentTx) return `<p class="ok small">✓ ${t('wallet.sentTx', { h: esc(shortAddr(sw.sentTx)) })}</p>`;
  if (!kind) return `<p class="muted small">${t('wallet.noBrowserSend', { chain: esc(netName(chain)) })}</p>`;
  if (sw.dir === 'any' && chain === 'sol' && sym !== 'SOL' && !sw.fromContract) return `<p class="muted small">${t('wallet.noBrowserSend', { chain: esc(netName(chain)) })}</p>`;
  if (!w) return `<div class="walletsend"><button class="primary" data-wallet="${kind}">🔗 ${t('wallet.needConnect', { w: WALLET_NAME[kind] || 'MetaMask, Rabby…' })}</button>${walletChooser(kind)}</div>`;
  const differs = sw.refundTo && sw.refundTo.toLowerCase() !== String(w).toLowerCase();
  return `<div class="walletsend"><button class="primary big" data-walletsend="1" ${ui.walletBusy ? 'disabled' : ''}>${ui.walletBusy ? t('wallet.sending') : '👛 ' + t('wallet.send')}</button>` +
    `<p class="small">${chain === 'near' && sym === 'NEAR' ? t('wallet.sendNear', { a: sw.amountIn }) : t('wallet.sendOther', { a: sw.amountIn, sym: esc(sym) }) + (isEvm(chain) ? ' ' + t('wallet.evmChain', { chain: esc(netName(chain)) }) : '')}</p>` +
    (differs ? `<p class="closed small">${t('wallet.differs', { a: esc(w), b: esc(sw.refundTo) })}</p>` : '') +
    `<p class="muted small">${t('wallet.orManual')}</p></div>`;
}
async function connectWallet(chain, pickId) {
  try {
    const L = await walletLib();
    if (chain !== 'near' && !pickId) {
      const list = chain === 'sol' ? L.solWallets() : await new Promise((r) => setTimeout(() => r(L.evmWallets()), 150));
      if (!list.length) { toast(t('wallet.noneFound', { kind: chain === 'sol' ? 'Solana' : 'EVM' }), 'bad'); return; }
      if (list.length > 1) { ui.walletChoose = { kind: chain, list }; render(); return; }
      pickId = list[0].id;
    }
    ui.walletChoose = null;
    let a = chain === 'near' ? await L.nearConnect() : chain === 'sol' ? await L.solConnect(pickId) : await L.evmConnect(pickId);
    if (a && typeof a === 'object') { ui.walletName = { ...(ui.walletName || {}), [chain]: a.name }; a = a.address; }
    if (!a) return;
    ui.wallet = { ...(ui.wallet || {}), [chain]: a };
    readRealForm();
    const f = ui.real, live = f.any && A(f.fromId) && A(f.toId);
    const src = live ? A(f.fromId).chain : f.dir === 'in' ? (REAL_SRC[f.from] || [])[1] : 'near', dst = live ? A(f.toId).chain : f.dir === 'in' ? 'near' : (REAL_DST[f.to] || [])[1];
    if (walletKind(src) === chain) f.refundTo = a;
    if (walletKind(dst) === chain && (walletKind(dst) !== walletKind(src) || !f.recipient)) f.recipient = a;
    rememberWallets(f);
    toast(t('wallet.connected', { a: shortAddr(a) }), 'win');
  } catch (e) { toast(t('wallet.fail', { why: esc(String((e && e.message) || e).slice(0, 100)) }), 'bad'); }
  render();
}
// disconnect a wallet (and forget its address in the card); with again=true, connect a different one right away
async function walletOff(chain, again) {
  const was = (ui.wallet || {})[chain];
  try { const L = await walletLib(); await (chain === 'near' ? L.nearDisconnect() : chain === 'sol' ? L.solDisconnect() : L.evmDisconnect()); } catch { /* forget it here anyway */ }
  ui.wallet = { ...(ui.wallet || {}), [chain]: null };
  ui.walletName = { ...(ui.walletName || {}), [chain]: null };
  readRealForm();
  if (ui.real.refundTo === was) ui.real.refundTo = '';
  if (ui.real.recipient === was) ui.real.recipient = '';
  const w = savedWallets(); if (w[chain] === was) { delete w[chain]; try { localStorage.setItem('ew.wallets', JSON.stringify(w)); } catch {} }
  if (chain === 'near') { try { localStorage.removeItem('ew.walletUsed'); } catch {} }
  if (!again) { toast(t('wallet.disconnected'), 'win'); render(); return; }
  render();
  if (chain === 'sol' || chain === 'base') toast(t('wallet.pickOther'), 'win');
  connectWallet(chain);
}
async function walletSend() {
  const sw = curSwap();
  if (!sw || sw.status !== 'PENDING_DEPOSIT' || ui.walletBusy) return;
  const chain = sw.dir === 'in' || sw.dir === 'any' ? sw.fromChain : 'near';
  ui.walletBusy = true; render();
  try {
    const L = await walletLib();
    let hash;
    const group = swapGroup(sw);
    if (sw.batch) {
      hash = await L.nearSendMany(group.map((x) => ({ depositAddress: x.depositAddress, amount: String(x.amountIn) })));
      if (hash) for (const x of group) { x.sentTx = hash; post('/api/intents/real/submit', { depositAddress: x.depositAddress, txHash: hash }); }
      play('coin'); toast(t('wallet.sent'), 'win'); pollReal(group.map((x) => x.depositAddress));
      ui.walletBusy = false; render(); return;
    }
    if (sw.dir === 'any') {
      const native = !sw.fromContract;
      if (chain === 'near') hash = sw.fromId === WNEAR_ID ? await L.nearSend(sw.depositAddress, String(sw.amountIn)) : await L.nearSendFt(sw.fromContract, sw.depositAddress, String(sw.amountIn), sw.fromDecimals);
      else if (chain === 'sol') {
        const bh = await (await fetch('/api/sol/blockhash')).json().catch(() => ({}));
        if (!bh.ok) throw new Error(t('wallet.noBlockhash'));
        hash = await L.solSendAny(sw.depositAddress, native ? null : sw.fromContract, String(sw.amountIn), sw.fromDecimals, bh.blockhash);
      } else if (isEvm(chain)) hash = await L.evmSendAny(EVM_IDS[chain], native ? null : sw.fromContract, sw.depositAddress, String(sw.amountIn), sw.fromDecimals);
      else throw new Error(t('wallet.noBrowserSend', { chain: netName(chain) }));
    } else if (chain === 'near') hash = await L.nearSend(sw.depositAddress, String(sw.amountIn));
    else if (chain === 'sol') {
      const bh = await (await fetch('/api/sol/blockhash')).json().catch(() => ({}));
      if (!bh.ok) throw new Error(t('wallet.noBlockhash'));
      hash = await L.solSend(sw.depositAddress, sw.fromSym, String(sw.amountIn), bh.blockhash);
    } else hash = await L.evmSendUsdc(sw.depositAddress, String(sw.amountIn));
    if (hash) { sw.sentTx = hash; post('/api/intents/real/submit', { depositAddress: sw.depositAddress, txHash: hash }); }
    play('coin'); toast(t('wallet.sent'), 'win');
    pollReal(sw.depositAddress);
  } catch (e) { toast(t('wallet.sendFail', { why: esc(String((e && e.message) || e).slice(0, 100)) }), 'bad'); }
  ui.walletBusy = false; render();
}
// back from a wallet that opens its own page (MyNearWallet): it returns with the transaction hash in the address
const nearReturnHash = (() => { try { const q = new URLSearchParams(location.search), h = q.get('transactionHashes'); if (h || q.get('errorCode')) history.replaceState(null, '', location.pathname); return h ? h.split(',').pop() : null; } catch { return null; } })();
function afterNearReturn() {
  if (!nearReturnHash || ui.nearReturnDone || !view || !view.realSwaps) return;
  const sw = view.realSwaps.find((x) => x.status === 'PENDING_DEPOSIT' && (x.dir || 'out') === 'out');
  if (!sw) return;
  ui.nearReturnDone = true;
  const group = sw.batch ? view.realSwaps.filter((x) => x.batch === sw.batch) : [sw];
  for (const x of group) { x.sentTx = nearReturnHash; post('/api/intents/real/submit', { depositAddress: x.depositAddress, txHash: nearReturnHash }); }
  toast(t('wallet.sent'), 'win'); pollReal(group.map((x) => x.depositAddress));
}
// a NEAR wallet connected before stays connected: check quietly, only if one was used in this browser
(function restoreWallet() {
  let used = false; try { used = localStorage.getItem('ew.walletUsed') === '1'; } catch {}
  if (!used && !nearReturnHash) return;
  walletLib().then((L) => L.nearAccount()).then((a) => { if (a) { ui.wallet = { ...(ui.wallet || {}), near: a }; render(); } }).catch(() => {});
})();
function readRealForm() {
  const g = (id) => { const el = $(id); return el ? el.value : ''; };
  const prev = ui.real || {};
  ui.real = { dir: prev.dir || 'out', to: g('real-to') || prev.to || 'USDC', from: g('real-from') || prev.from || 'USDC-SOL', amount: Number(String(g('real-amount')).replace(',', '.')) || prev.amount || 0.3, refundTo: g('real-refund').trim(), recipient: g('real-recip').trim(), legs: prev.legs || null, any: prev.any, anyOff: prev.anyOff, fromId: prev.fromId, toId: prev.toId };
  // the rows of a split, as typed right now
  if (ui.real.legs && document.querySelector('[data-legrec]')) {
    ui.real.legs = ui.real.legs.map((l, i) => {
      const to = (document.querySelector(`[data-legto="${i}"]`) || {}).value || l.to;
      const am = Number((document.querySelector(`[data-legamt="${i}"]`) || {}).value);
      const rec = ((document.querySelector(`[data-legrec="${i}"]`) || {}).value || '').trim();
      return { to, amount: am > 0 ? am : l.amount, recipient: rec };
    });
  }
}
// start a split, add a receiver, or take one away (one left: back to a normal swap)
function legAdd(skipRead) {
  if (!skipRead) readRealForm();
  const f = ui.real;
  const live = f.any && ui.assets, usdcSol = live && (findAsset('USDC', 'sol') || {}).id, usdcNear = live && (findAsset('USDC', 'near') || {}).id;
  if (!f.legs) f.legs = live ? [{ to: f.toId, amount: f.amount, recipient: f.recipient }, { to: f.toId === usdcSol ? usdcNear || f.toId : usdcSol || f.toId, amount: 0.1, recipient: '' }]
    : [{ to: f.to, amount: f.amount, recipient: f.recipient }, { to: f.to === 'USDC-SOL' ? 'USDC' : 'USDC-SOL', amount: 0.1, recipient: '' }];
  else if (f.legs.length < 5) f.legs.push({ to: live ? usdcNear || f.toId : 'USDC', amount: 0.1, recipient: '' });
  render();
}
function legDel(i) {
  readRealForm();
  const f = ui.real;
  f.legs.splice(i, 1);
  if (f.legs.length < 2) { const l = f.legs[0] || {}; if (f.any && A(l.to)) f.toId = l.to; else f.to = l.to || f.to; f.amount = l.amount || f.amount; f.recipient = l.recipient || ''; f.legs = null; }
  render();
}
async function realQuoteNow() {
  readRealForm();
  ui.realBusy = true; render();
  if (ui.real.any && !ui.real.legs) {
    const r = await post('/api/intents/real/any', { player: playerId, from: ui.real.fromId, to: ui.real.toId, amount: ui.real.amount, refundTo: ui.real.refundTo, recipient: ui.real.recipient });
    ui.realBusy = false;
    if (!r.ok) { toast(t(r.code || 'real.noQuote', { min: r.min, max: r.max }), 'bad'); render(); return; }
    rememberWallets(ui.real);
    view.realSwaps = [r.swap, ...(view.realSwaps || [])];
    pollReal(r.swap.depositAddress);
    render(); return;
  }
  if ((ui.real.dir === 'out' || ui.real.any) && ui.real.legs) {
    const r = await post('/api/intents/real/multi', { player: playerId, refundTo: ui.real.refundTo, legs: ui.real.legs });
    ui.realBusy = false;
    if (!r.ok) { toast((r.leg ? t('split.legFail', { n: r.leg }) + ' ' : '') + t(r.code || 'real.noQuote'), 'bad'); render(); return; }
    rememberWallets({ ...ui.real, to: ui.real.legs[0].to, recipient: ui.real.legs[0].recipient });
    view.realSwaps = [...r.swaps, ...(view.realSwaps || [])];
    pollReal(r.swaps.map((x) => x.depositAddress));
    render(); return;
  }
  const r = await post('/api/intents/real', { player: playerId, ...ui.real });
  ui.realBusy = false;
  if (!r.ok) { toast(t(r.code || 'real.noQuote'), 'bad'); render(); return; }
  rememberWallets(ui.real);
  view.realSwaps = [r.swap, ...(view.realSwaps || [])];
  pollReal(r.swap.depositAddress);
  render();
}
// give up a swap that is still waiting for the deposit, and go back to an empty card with the same choices
async function cancelReal(edit) {
  ui.realCancelAsk = false;
  const sw = curSwap();
  if (!sw) return;
  const r = await post('/api/intents/real/cancel', { player: playerId, depositAddress: sw.depositAddress });
  if (!r || !r.ok) { toast(t((r && r.code) || 'real.cantCancel'), 'bad'); return; }
  clearInterval(realTimer);
  const group = swapGroup(sw);
  view.realSwaps = (view.realSwaps || []).filter((x) => !group.includes(x));
  ui.aiSwap = null;
  ui.real = sw.dir === 'any' ? { dir: 'out', any: true, fromId: sw.fromId, toId: group.length > 1 ? group[0].toId : sw.toId, amount: sw.batch ? group[0].amountIn : sw.amountIn, refundTo: sw.refundTo, recipient: sw.batch ? group[0].recipient : sw.recipient,
    legs: sw.batch ? group.map((x) => ({ to: x.to, amount: x.amountIn, recipient: x.recipient })) : null }
    : { dir: sw.dir || 'out', to: sw.dir === 'in' ? 'USDC' : sw.to, from: sw.dir === 'in' ? sw.from : 'USDC-SOL', amount: sw.amountIn, refundTo: sw.refundTo, recipient: sw.recipient,
    legs: sw.batch ? group.map((x) => ({ to: x.to, amount: x.amountIn, recipient: x.recipient })) : null };
  toast(t(edit ? 'real.editing' : 'real.cancelled'), 'win');
  render();
}
let realTimer = null;
const REAL_END = ['SUCCESS', 'REFUNDED', 'FAILED'];
// follow one swap, or every part of a split, until each one has finished
function pollReal(addr) {
  const list = [].concat(addr);
  clearInterval(realTimer);
  realTimer = setInterval(async () => {
    let open = 0, won = 0;
    for (const a of list) {
      const x0 = (view.realSwaps || []).find((x) => x.depositAddress === a);
      if (x0 && REAL_END.includes(x0.status)) continue;
      const r = await (await fetch('/api/intents/real/status?depositAddress=' + encodeURIComponent(a))).json().catch(() => null);
      if (!r || !r.swap) { open++; continue; }
      const k = (view.realSwaps || []).findIndex((x) => x.depositAddress === a);
      if (k >= 0) view.realSwaps[k] = r.swap;
      if (REAL_END.includes(r.swap.status)) { if (r.swap.status === 'SUCCESS') won++; } else open++;
    }
    if (won) { play('level'); toast(t('real.success'), 'win'); }
    if (!open) clearInterval(realTimer);
    render();
  }, 6000);
}
// the swap (or all parts of the split) shown right now
const swapGroup = (sw) => (!sw ? [] : sw.batch ? (view.realSwaps || []).filter((x) => x.batch === sw.batch && !(ui.realDismissed || []).includes(x.depositAddress)).sort((a, b) => (a.leg || 0) - (b.leg || 0)) : [sw]);
function pollCurrent() { const g = swapGroup(curSwap()).filter((x) => !REAL_END.includes(x.status)); if (g.length) pollReal(g.map((x) => x.depositAddress)); }

// ---------- what NEAR does in Emberwick, visible at a glance ----------
const NEAR_FEATURES = [
  { k: 'agents', icon: '🤖', tour: 1 },
  { k: 'tee', icon: '🔒', tour: 1 },
  { k: 'intents', icon: '🌉', tour: 5 },
  { k: 'economy', icon: '⛓', tour: 3 },
];
function nearInside(clickable) {
  return `<div class="nearinside"><div class="ni-title">${t('ni.title')}</div><div class="ni-grid">${NEAR_FEATURES.map((f) =>
    `<${clickable ? 'button type="button"' : 'div'} class="ni-item" ${clickable ? `data-tour="${f.tour}"` : ''}><span class="ni-icon">${f.icon}</span><b>${t('ni.' + f.k)}</b><span>${t('ni.' + f.k + '.d')}</span></${clickable ? 'button' : 'div'}>`).join('')}</div></div>`;
}
// the chain at work: totals and the latest transactions, with links
function chainStrip() {
  const c = view.chain || {}, oc = view.onchain || {};
  const deeds = Object.values(view.plots || {}).filter((x) => x.deed && x.deed.minted).length;
  if (!chainOk()) return `<p class="small muted chainstrip">${t('ni.offline')}</p>`;
  const last = (c.feed || []).filter((f) => f.ok && f.hash).slice(0, 3);
  return `<div class="chainstrip"><div class="small"><b>${t('ni.live')}</b> ${t('ni.counts', { tx: oc.tx || c.txCount || 0, ai: (view.aiLog || []).length ? oc.aiPlans || (view.aiLog || []).length : 0, d: deeds })}</div>` +
    (last.length ? `<ul class="small">${last.map((f) => `<li>${exLink('txns/' + f.hash, esc(((f.items[0] && (f.items[0].memo || `${f.items[0].label} · ${f.items[0].amount} EMWK`)) || 'tx').replace(/^Emberwick: /, '').slice(0, 70)))}</li>`).join('')}</ul>` : '') + `</div>`;
}

// a small card on the map: the four NEAR parts (each opens its step of the judge tour) and live counts
function renderNearbar() {
  const box = $('nearbar');
  let closed = false; try { closed = localStorage.getItem('ew.nearbar') === '0'; } catch {}
  // out of the way while a scene or a card on the map is open
  if (!view || ui.scene || onMapCard(ui.selected)) { box.hidden = true; return; }
  const oc = view.onchain || {}, c = view.chain || {};
  const key = JSON.stringify([getLang(), closed, oc.tx, chainOk(), (view.aiLog || []).length]);
  box.hidden = false;
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  if (closed) { box.innerHTML = `<button class="nb-open" data-nearbar="1">⛓ ${t('ni.title')}</button>`; return; }
  box.innerHTML = `<div class="nb-head"><b>⛓ ${t('ni.title')}</b><button class="linkbtn" data-nearbar="0" aria-label="close">✕</button></div>` +
    `<div class="nb-row">${NEAR_FEATURES.map((f) => `<button type="button" class="nb-item" data-tour="${f.tour}" title="${esc(t('ni.' + f.k + '.d'))}"><span>${f.icon}</span>${t('ni.' + f.k)}</button>`).join('')}</div>` +
    `<div class="nb-foot">${chainOk() ? t('ni.counts', { tx: oc.tx || c.txCount || 0, ai: oc.aiPlans || 0, d: Object.values(view.plots || {}).filter((x) => x.deed && x.deed.minted).length }) : t('ni.offlineShort')}</div>`;
}

function panelGuide() {
  const me = view.player;
  if (!me) return `<h2>${t('guide.title')}</h2><p>${t('guide.join')}</p>` + nearInside(false);
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
  return nearInside(true) + chainStrip() + `<h2>${t('guide.title')}</h2><p class="muted" style="font-size:13px;margin-top:2px">${t('guide.sentence')}</p>` + howLink +
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
  if (!typing) {
    // keep where the player had scrolled (the card itself and lists such as the token picker)
    const at = card.scrollTop, lists = [...card.querySelectorAll('[data-keepscroll]')].map((el) => [el.dataset.keepscroll, el.scrollTop]);
    card.innerHTML = closeBtn() + top + html;
    card.scrollTop = at;
    for (const [k, v] of lists) { const el = card.querySelector(`[data-keepscroll="${k}"]`); if (el) el.scrollTop = v; }
  }
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
  let h = `<h2>${t('lands.title')}</h2><p class="muted small">${t('lands.intro')}</p><p class="small">${t('lands.buyback')}</p>`;
  if (me && me.plot) h += `<p class="small closed">${t('plot.haveOne', { place: placeName(me.plot) })}</p>`;
  const sale = plots.filter(([, x]) => x.sale).sort((a, b) => a[1].sale.price - b[1].sale.price);
  h += `<h4>${t('lands.deeds', { n: sale.length })}</h4>`;
  h += sale.length ? `<table>${sale.map(([id, x]) => `<tr><td><b>${esc(placeName(id))}</b><div class="muted small">${x.mine ? `<b>${t('lands.yours')}</b>` : esc(x.owner)} · ${x.built ? t(x.bed ? 'ex.withHouseBed' : 'ex.withHouse') : t('ex.bareLand')}${x.lease && x.lease.tenant ? ' · ' + t('ex.rented', { n: x.lease.rent }) : ''}${deedLink(x)}</div></td><td class="n">${x.sale.price} EMWK<div class="muted small">${t('lands.fairShort', { n: x.fair })}</div></td><td class="n">` +
    (x.mine ? `<button data-act="unlistDeed" data-plot="${id}">${t('ex.unlist')}</button>` : `<button class="primary" data-act="buyDeed" data-plot="${id}" ${!me || me.plot || me.coins < x.sale.price || (x.minLevel && me.level < x.minLevel) ? 'disabled' : ''}>${t('ex.buy1')}</button>`) +
    ` <button class="linkbtn" data-go="${id}">${t('lands.see')}</button></td></tr>`).join('')}</table>` : `<p class="muted small">${t('ex.noDeeds')}</p>`;
  const free = plots.filter(([, x]) => !x.owner && x.open).sort((a, b) => a[1].price - b[1].price);
  h += `<h4>${t('lands.free', { n: free.length })}</h4>`;
  h += free.length ? `<table>${free.map(([id, x]) => `<tr><td><b>${esc(placeName(id))}</b><div class="muted small">${x.district ? t('district.' + x.district) : t('lands.district.village')}${x.minLevel ? ' · ' + t('lands.minLevel', { n: x.minLevel }) : ''}</div></td><td class="n">${x.price} EMWK</td><td class="n"><button class="primary" data-go="${id}">${t('lands.see')}</button></td></tr>`).join('')}</table>` : `<p class="muted small">${t('lands.noFree')}</p>`;
  if (me && me.plot && !view.plots[me.plot].sale) h += `<p class="small">${t('lands.sellYours')}</p><button data-go="exchange">${esc(t('go.to', { place: placeName('exchange') }))}</button>`;
  const dt = (view.market.trades || []).filter((x) => x.deed);
  if (dt.length) h += `<h4>${t('ex.trades')}</h4><ul class="decided">${dt.slice(0, 6).map((x) => `<li>${esc(placeName(x.deed))} · ${x.price} EMWK · ${esc(x.seller)} → ${esc(x.buyer === 'village' ? t('lands.village') : x.buyer)}</li>`).join('')}</ul>`;
  return h + `<p class="muted small">${t('ex.deedNote')}</p>`;
}

function panelPlot(b) {
  const p = view.plots[b.id] || {}, me = view.player, B = p.build || view.land.build;
  let h = `<h2>${esc(placeName(b.id))}</h2>`;
  if (p.district) h += `<p class="muted small">${t('district.where.' + p.district)}</p>`;
  const deed = p.deed;
  if (p.mine) {
    h += deedCard(b.id, p, true) + `<p class="small fairline">${t('plot.fairNow', { n: p.fair })}</p>` + (p.sale ? fairNote(p) : '') + `<div class="contract"><b>${t('plot.yours')}</b>`;
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
// will a newcomer family buy this listing? (at most 10% over the fair value)
function fairNote(x) {
  if (!x || !x.sale || !x.fair) return '';
  const ok = x.sale.price <= x.fair * 1.1;
  return `<p class="small ${ok ? 'fair-ok' : 'fair-no'}">${t(ok ? 'ex.fairOk' : 'ex.fairNo', { n: x.fair, max: Math.floor(x.fair * 1.1), p: x.sale.price })}</p>`;
}

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
const ASSET_COLOR = { BTC: '#f2a33a', ETH: '#7b8cde', SOL: '#9b6bf2', USDC: '#3a7bd5', NEAR: '#24302e', wNEAR: '#24302e' };
// each chain gets its own colour and short name, drawn as the bank of the river and a badge on the coin
const CHAINS = { arb: ['Arbitrum', '#2d8fd5'], op: ['Optimism', '#e5193b'], pol: ['Polygon', '#8247e5'], bsc: ['BNB Chain', '#d9a40b'], avax: ['Avalanche', '#e84142'], tron: ['Tron', '#d1131f'], gnosis: ['Gnosis', '#04795b'], bera: ['Berachain', '#8a5a2b'], sui: ['Sui', '#3d8ee8'], ton: ['TON', '#0098ea'], doge: ['Dogecoin', '#b8962e'], xrp: ['XRP', '#23292f'], zec: ['Zcash', '#c99a10'], ltc: ['Litecoin', '#345d9d'], aptos: ['Aptos', '#1e9c82'], near: ['NEAR', '#1f9d76'], sol: ['Solana', '#8a4de8'], solana: ['Solana', '#8a4de8'], base: ['Base', '#1652f0'], eth: ['Ethereum', '#627eea'], ethereum: ['Ethereum', '#627eea'], btc: ['Bitcoin', '#f7931a'], bitcoin: ['Bitcoin', '#f7931a'] };
const chainOf = (c) => CHAINS[String(c || '').toLowerCase()] || null;
// a token is drawn as a shiny coin with its currency sign and ticker; the chain it lives on is a big pill under it
const GLYPH = { BTC: '₿', ETH: 'Ξ', USDC: '$', SOL: '◎', NEAR: 'Ⓝ', wNEAR: 'Ⓝ' };
function bridgeSvg(from, to, live, mode) {
  const uid = 'b' + Math.random().toString(36).slice(2, 7);
  const grad = (id, c) => `<radialGradient id="${uid}${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".92"/></radialGradient>`;
  const node = (x, a, gid) => {
    const c = ASSET_COLOR[a.sym] || '#556', ch = chainOf(a.chain);
    return `<g><ellipse cx="${x}" cy="108" rx="30" ry="5" fill="#000" opacity=".12"/>` +
      `<circle cx="${x}" cy="70" r="34" fill="#fff"/><circle cx="${x}" cy="70" r="31" fill="url(#${uid}${gid})" stroke="${c}" stroke-width="1"/><circle cx="${x}" cy="70" r="25" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="2 3"/>` +
      `<text x="${x}" y="72" text-anchor="middle" font-size="26" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">${GLYPH[a.sym] || esc(a.sym[0])}</text>` +
      `<text x="${x}" y="91" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" letter-spacing=".5">${esc(a.sym)}</text>` +
      (ch ? `<rect x="${x - 40}" y="114" width="80" height="22" rx="11" fill="${ch[1]}" stroke="#fff" stroke-width="2"/><text x="${x}" y="129" text-anchor="middle" font-size="12.5" font-weight="800" fill="#fff">${esc(ch[0])}</text>` : '') +
      (a.amount != null ? `<rect x="${x - 34}" y="14" width="68" height="20" rx="10" fill="${live ? '#e6f4e9' : '#f3ece1'}"/><text x="${x}" y="28" text-anchor="middle" font-size="12.5" font-weight="800" fill="${live ? '#2f7a3a' : '#7a6b58'}">${esc(String(a.amount))} ${esc(a.sym)}</text>` : '') + `</g>`;
  };
  const deck = (x1, x2) => `M${x1} 74 Q${(x1 + x2) / 2} 40 ${x2} 74`;
  const arch = (x1, x2) => `<path d="${deck(x1, x2)}" fill="none" stroke="#b98a5a" stroke-width="5" stroke-linecap="round" ${live ? '' : 'stroke-dasharray="6 6" opacity=".6"'}/>` +
    [0.25, 0.5, 0.75].map((f) => { const x = x1 + (x2 - x1) * f, y = 74 - 34 * 4 * f * (1 - f) * 1; return `<line x1="${x}" y1="${y + 2}" x2="${x}" y2="96" stroke="#c9a77f" stroke-width="2"/>`; }).join('');
  // the coins that cross carry the token's colour and first letter
  const coins = (x1, x2, color, delay, sym) => live ? [0, 0.8, 1.6].map((b) => `<g opacity="0"><set attributeName="opacity" to="1" begin="${b + delay}s"/><animateMotion dur="2.4s" begin="${b + delay}s" repeatCount="indefinite" path="${deck(x1, x2)}"/><circle r="7" fill="${color}" stroke="#fff" stroke-width="1.5"/><text y="3" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${esc((sym || '?')[0] === 'w' ? 'N' : (sym || '?')[0])}</text></g>`).join('') : '';
  const fc = ASSET_COLOR[from.sym] || '#556', tc = ASSET_COLOR[to.sym] || '#556';
  let svg = `<svg class="bridge" viewBox="0 0 440 142" role="img" aria-label="${esc(t('bridge.aria', { a: from.sym, b: to.sym }))}"><defs>${grad('f', ASSET_COLOR[from.sym] || '#556')}${grad('t', ASSET_COLOR[to.sym] || '#556')}</defs>` +
    `<rect x="0" y="96" width="440" height="44" rx="10" fill="#cfe3ee"/><path d="M0 104 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#a9cbe0" stroke-width="2" fill="none"/>` +
    // the two banks, coloured by chain
    (chainOf(from.chain) ? `<path d="M0 96 L0 60 Q40 50 118 62 L118 96 Z" fill="${chainOf(from.chain)[1]}" opacity=".16"/>` : '') +
    (chainOf(to.chain) ? `<path d="M440 96 L440 60 Q400 50 322 62 L322 96 Z" fill="${chainOf(to.chain)[1]}" opacity=".16"/>` : '') +
    arch(85, 168) + arch(272, 355) + coins(85, 168, fc, 0, from.sym) + coins(272, 355, tc, 1.2, to.sym) +
    `<g><rect x="168" y="48" width="104" height="52" rx="12" fill="#fff8ee" stroke="#e0742b" stroke-width="2"/><text x="220" y="70" text-anchor="middle" font-size="13" font-weight="700" fill="#b4531c">NEAR Intents</text>` +
    `<text x="220" y="88" text-anchor="middle" font-size="10" fill="#7a6b58">${esc(t('bridge.solvers'))}</text>` +
    [196, 220, 244].map((x, i) => `<circle cx="${x}" cy="56" r="3" fill="#e0742b">${live ? `<animate attributeName="opacity" values="1;.2;1" dur="1.2s" begin="${i * 0.3}s" repeatCount="indefinite"/>` : ''}</circle>`).join('') + `</g>` +
    node(55, from, 'f') + node(385, to, 't');
  if (mode === 'real-flip') svg += `<g class="bflip" data-realflip="1" style="cursor:pointer"><title>${esc(t('real.flip'))}</title><circle cx="220" cy="24" r="17" fill="#e0742b" stroke="#fff" stroke-width="3"/><text x="220" y="31" text-anchor="middle" font-size="20" font-weight="800" fill="#fff">⇄</text></g>`;
  if (mode === 'plot' || mode === 'house') svg += `<g transform="translate(408 40)"><polygon points="0,10 12,0 24,10" fill="#c0443a"/><rect x="3" y="10" width="18" height="13" fill="#f3e3c4"/></g>`;
  svg += `</svg>`;
  if (mode === 'real' || mode === 'real-flip') return `<div class="bridgebox">${svg}</div>`;
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
      h += `<details class="small" data-keep="claim"${keepOpen('claim')}><summary>${t('near.claimTitle')}</summary><p class="muted small">${t('near.claimHelp', { id: esc(me.near) })}</p>` +
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
    `<div class="muted small" title="${esc(t('w.taxes'))}: ${(st.taxes || 0).toFixed(1)} EMWK">${t('w.earned')} ${(st.earned || 0).toFixed(0)} · ${t('w.spent')} ${(st.spent || 0).toFixed(0)}</div>` +
    `<button class="linkbtn small" data-money="player:${playerId}">📜 ${t('mh.mine')}</button></div>`;
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
  afterNearReturn();
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
  renderNearbar();
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

const pendingActs = new Set(); // a one-time action (buying land, building) cannot be sent twice while the server answers
const ONCE = new Set(['buyPlot', 'buyDeed', 'buildHouse', 'buyBed', 'listDeed', 'unlistDeed', 'leaseHome', 'listHome', 'apply', 'commission', 'deal', 'repay']);
async function act(type, extra = {}) {
  if (!playerId) return toast(t('toast.join'), 'bad');
  const onceKey = ONCE.has(type) ? type + ':' + (extra.plot || extra.npc || '') : null;
  if (onceKey) { if (pendingActs.has(onceKey)) return; pendingActs.add(onceKey); document.body.classList.add('busy-act'); }
  try { return await actNow(type, extra); } finally { if (onceKey) { pendingActs.delete(onceKey); if (!pendingActs.size) document.body.classList.remove('busy-act'); } }
}
async function actNow(type, extra) {
  const body = { player: playerId, type, ...extra };
  if (type === 'sell') setTimeout(() => { if (ui.sellQty) delete ui.sellQty[extra.good]; }, 0);
  if (type === 'sell') body.qty = Math.min(view.player.inv[extra.good] || 0, (ui.sellQty || {})[extra.good] || view.player.inv[extra.good] || 0);
  const r = await post('/api/action', body);
  if (r.state && newer(r.state)) { view = r.state; render(); }
  // a second click on a slow connection: the land is already yours, so this is no error
  if (!r.ok && r.code === 'err.havePlot' && (type === 'buyPlot' || type === 'buyDeed') && view.player && view.player.plot === extra.plot) { toast(t('plot.boughtOk', { place: placeName(extra.plot) }), 'win'); return r; }
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
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ai-swap') { e.preventDefault(); e.stopPropagation(); aiSwapNow(); } }, true);
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
  const aa = e.target.closest('[data-aiact]');
  if (aa) { const npc = ui.selected, qa = (ui.aiAnswers || {})[npc], x = qa && (qa.actions || [])[Number(aa.dataset.aiact)]; if (x) runAiAction(npc, x); return; }
  const od = e.target.closest('[data-order]');
  if (od) { post('/api/action', { player: playerId, type: 'commission', npc: od.dataset.order, n: 1 }).then((r) => { if (r.state && newer(r.state)) view = r.state; if (r.ok) { play('coin'); toast(t('order.done', { n: r.qty, good: goodWord(r.output), fee: r.fee }), 'win'); } else toast(errText(r), 'bad'); render(); }); return; }
  const rp = e.target.closest('[data-repay]');
  if (rp) { post('/api/action', { player: playerId, type: 'repay', npc: rp.dataset.repay }).then((r) => { if (r.state && newer(r.state)) view = r.state; if (r.ok) { play('coin'); toast(t('credit.paid', { n: r.amount }), 'win'); } else toast(errText(r), 'bad'); render(); }); return; }
  if (e.target.closest('[data-lands]')) { ui.selected = 'lands'; renderMapNow(); renderPanel(); return; }
  if (e.target.closest('[data-eat]')) { act('eat'); return; }
  if (e.target.closest('[data-guide]')) { ui.selected = 'guide'; renderMapNow(); renderPanel(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { select(go.dataset.go); if (go.dataset.go === 'gate' && view.player && view.player.questInfo.id === 'meet') openElder(); return; }
  const tabBtn = e.target.closest('[data-extab]');
  if (tabBtn) { ui.exTab = tabBtn.dataset.extab; if (ui.exTab === 'real') pollCurrent(); if (ui.exTab === 'change' && (!ui.exPrices || Date.now() - (ui.exPricesAt || 0) > 60000)) loadExPrices(); renderPanel(); return; }
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
  const rc = e.target.closest('[data-realcancel]');
  if (rc) { const v = rc.dataset.realcancel; if (v === 'ask') ui.realCancelAsk = true; else if (v === 'no') ui.realCancelAsk = false; else cancelReal(); render(); return; }
  if (e.target.closest('[data-recipclear]')) { readRealForm(); ui.real.recipient = ''; ui.recipTyped = true; render(); setTimeout(() => { const i = $('real-recip'); if (i) i.focus(); }, 30); return; }
  const po = e.target.closest('[data-pickopen]');
  if (po) { readRealForm(); const [side, step] = po.dataset.pickopen.split(':'); const cur = pickCur(side); ui.picker = { side, step: step || 'chain' }; ui.pickQ = ''; ui.pickChain = cur ? cur.chain : ''; render(); return; }
  const pcs = e.target.closest('[data-pickchainset]');
  if (pcs) { const [side, c] = pcs.dataset.pickchainset.split('|'); ui.pickChain = c; ui.pickQ = ''; ui.picker = { side, step: 'token' }; render(); return; }
  if (e.target.closest('[data-pickclose]')) { ui.picker = null; ui.pickQ = ''; render(); return; }
  const pc = e.target.closest('[data-pickchain]');
  if (pc) { readRealForm(); ui.pickChain = pc.dataset.pickchain; render(); return; }
  const pa = e.target.closest('[data-pickasset]');
  if (pa) { const [side, id] = pa.dataset.pickasset.split('|'); pickAsset(side, id); return; }
  if (e.target.closest('[data-realedit]')) { ui.realCancelAsk = false; cancelReal(true); return; }
  if (e.target.closest('[data-splitnear]')) { readRealForm(); const a = A(ui.real.fromId), w = A(WNEAR_ID); if (w) { ui.real.amount = a ? Math.min(5, Math.max(0.1, nice((Number(ui.real.amount) || 0) * a.price / w.price))) : 0.3; ui.real.fromId = WNEAR_ID; ui.real.refundTo = (ui.wallet || {}).near || ''; } legAdd(true); return; }
  if (e.target.closest('[data-splitoff]')) { readRealForm(); const l = (ui.real.legs || [])[0]; if (l) { if (A(l.to)) ui.real.toId = l.to; ui.real.recipient = l.recipient || ''; } ui.real.legs = null; render(); return; }
  if (e.target.closest('[data-legadd]')) { legAdd(); return; }
  const ld = e.target.closest('[data-legdel]');
  if (ld) { legDel(Number(ld.dataset.legdel)); return; }
  const wp = e.target.closest('[data-walletpick]');
  if (wp) { const [k, id] = wp.dataset.walletpick.split('|'); connectWallet(k, id); return; }
  if (e.target.closest('[data-walletpickoff]')) { ui.walletChoose = null; render(); return; }
  const wc = e.target.closest('[data-wallet]');
  if (wc) { connectWallet(wc.dataset.wallet); return; }
  if (e.target.closest('[data-walletsend]')) { walletSend(); return; }
  const wo = e.target.closest('[data-walletoff]');
  if (wo) { walletOff(wo.dataset.walletoff); return; }
  const ws = e.target.closest('[data-walletswap]');
  if (ws) { walletOff(ws.dataset.walletswap, true); return; }
  if (e.target.closest('[data-aiswap]')) { aiSwapNow(); return; }
  const axe = e.target.closest('[data-aiswapex]');
  if (axe) { ui.aiSwap = { text: axe.dataset.aiswapex }; render(); const i = $('ai-swap'); if (i) i.focus(); return; }
  if (e.target.closest('[data-realflip]')) { flipReal(); return; }
  const rpk = e.target.closest('[data-realpick]');
  if (rpk) { pickReal(rpk.dataset.realpick); return; }
  const rd = e.target.closest('[data-realdir]');
  if (rd) { readRealForm(); ui.real = { ...ui.real, dir: rd.dataset.realdir, refundTo: '', recipient: '', amount: rd.dataset.realdir === 'in' ? 0.5 : 0.3 }; render(); return; }
  const em = e.target.closest('[data-exmode]');
  if (em) { ui.exMode = em.dataset.exmode; if (ui.exMode === 'real') pollCurrent(); render(); return; }
  if (e.target.closest('[data-realquote]')) { realQuoteNow(); return; }
  if (e.target.closest('[data-realnew]')) { dismissSwaps((view.realSwaps || []).filter((x) => REAL_END.includes(x.status) || x.status === 'INCOMPLETE_DEPOSIT').map((x) => x.depositAddress)); ui.aiSwap = null; render(); return; }
  if (e.target.closest('[data-realsubmit]')) { const sw = curSwap(), tx = ($('real-tx') || {}).value || ''; if (sw && tx.trim()) post('/api/intents/real/submit', { depositAddress: sw.depositAddress, txHash: tx.trim() }).then((r) => toast(r.ok ? t('real.submitted') : errText(r), r.ok ? 'win' : 'bad')); return; }
  const cp = e.target.closest('[data-copy]');
  if (cp) { try { navigator.clipboard.writeText(cp.dataset.copy); toast(t('real.copied'), 'win'); } catch {} return; }
  const mo = e.target.closest('[data-money]');
  if (mo) { openMoney(mo.dataset.money); return; }
  if (e.target.closest('[data-moneyclose]') || e.target.id === 'money') { $('money').hidden = true; return; }
  const nb = e.target.closest('[data-nearbar]');
  if (nb) { try { localStorage.setItem('ew.nearbar', nb.dataset.nearbar); } catch {} renderNearbar(); return; }
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
  $('join-near').innerHTML = nearInside(false);
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
// keep what was typed in the real-swap form across redraws; a new destination changes the address field
document.addEventListener('input', (e) => { if (e.target.id === 'pick-search') { ui.pickQ = e.target.value; const q = ui.pickQ.trim().toLowerCase(); let n = 0; document.querySelectorAll('.pk-item, .pv-token').forEach((b) => { const on = !q || b.dataset.q.includes(q); b.hidden = !on; if (on) n++; }); document.querySelectorAll('.pk-none').forEach((el) => { el.hidden = n > 0; }); return; } if (e.target.id === 'real-amount') { const u = document.querySelector('.sc-usd'); if (u) u.textContent = '≈ $' + ((Number(String(e.target.value).replace(',', '.')) || 0) * Number(u.dataset.price || 0)).toFixed(2); } if (e.target.id && e.target.id.startsWith('real-') && e.target.id !== 'real-tx') readRealForm(); if (e.target.dataset && (e.target.dataset.legamt !== undefined || e.target.dataset.legrec !== undefined)) { readRealForm(); const n = legSum(ui.real.legs || []); document.querySelectorAll('.leg-total').forEach((el) => { el.textContent = t('split.total', { n }); }); document.querySelectorAll('.split-sum').forEach((el) => { el.textContent = n; }); } });
document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.legto !== undefined) { const i = Number(e.target.dataset.legto), before = ((ui.real.legs || [])[i] || {}).to; readRealForm(); const l = ui.real.legs[i]; if (legDst({ to: before })[1] !== legDst(l)[1]) l.recipient = ''; render(); return; } if (e.target.id === 'real-to') { readRealForm(); ui.real.recipient = ''; render(); } if (e.target.id === 'real-from') { readRealForm(); const s0 = REAL_SRC[ui.real.from]; ui.real.refundTo = ''; ui.real.amount = s0 ? s0[4] : 0.5; render(); } });

document.addEventListener('submit', async (e) => {
  if (e.target.classList && e.target.classList.contains('ai-ask')) {
    e.preventDefault();
    const npc = e.target.dataset.npc, inp = e.target.querySelector('.ai-q'), q = inp.value.trim();
    if (!q) return;
    ui.aiAnswers = ui.aiAnswers || {};
    ui.aiAnswers[npc] = { q, a: '' };
    inp.value = ''; inp.blur(); render();
    ui.aiAnswers[npc].at = Date.now();
    const tick = setInterval(() => { if (ui.aiAnswers[npc] && !ui.aiAnswers[npc].a) renderPanel(); else clearInterval(tick); }, 1000);
    const r = await post('/api/ai/ask', { player: playerId, npc, q, lang: getLang() });
    if (r.state && newer(r.state)) view = r.state;
    ui.aiAnswers[npc] = { q, a: r.ok ? r.answer : '', at: Date.now(), actions: r.ok ? r.actions || [] : [] };
    clearInterval(tick);
    if (!r.ok) { delete ui.aiAnswers[npc]; toast(t(r.code || 'ai.busy'), 'bad'); }
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
