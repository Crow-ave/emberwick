// Isometric renderer for Emberwick. This is the "visual layer": it only reads
// game data and draws it. Swapping this file for a pixel-art renderer later does
// not touch anyone's coins, items, houses or contracts.

export const N = 12, TW = 88, TH = 44, OX = 690, OY = 70, VW = 1230, VH = 640;
const K = 1.45; // building scale relative to the original 60px tile art
const BT = 60, BH = 30; // tile size the building art was drawn for

export function cellCenter(i, j) {
  return [OX + (i - j) * TW / 2, OY + (i + j) * TH / 2 + TH / 2];
}

const pts = (a) => a.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (a, fill, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" stroke="rgba(60,40,20,.35)" stroke-width=".6" ${extra}/>`;
const diamond = (cx, cy, hw, hh) => [[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]];

function house(cx, cy, s, h, wallL, wallR, roofL, roofR, roofH = 16) {
  const hw = BT / 2 * s * 0.8, hh = BH / 2 * s * 0.8;
  const [t, r, b, l] = diamond(cx, cy, hw, hh);
  const up = (p) => [p[0], p[1] - h];
  const apex = [cx, cy - h - roofH];
  return poly([l, b, up(b), up(l)], wallL) + poly([b, r, up(r), up(b)], wallR) +
    poly([up(l), up(b), apex], roofL) + poly([up(b), up(r), apex], roofR) +
    poly([up(t), up(l), apex], roofL, 'opacity=".6"') + poly([up(t), up(r), apex], roofR, 'opacity=".6"');
}
function door(cx, cy, s) {
  const hw = BT / 2 * s * 0.8, hh = BH / 2 * s * 0.8;
  const x = cx - hw * 0.45, y = cy + hh * 0.55;
  return poly([[x - 4, y - 2], [x + 4, y + 2], [x + 4, y - 12], [x - 4, y - 16]], '#5a3a22');
}
function window2(cx, cy, s, h) {
  const hw = BT / 2 * s * 0.8, hh = BH / 2 * s * 0.8;
  const x = cx + hw * 0.45, y = cy + hh * 0.3;
  return poly([[x - 4, y - h * 0.45], [x + 4, y - h * 0.45 - 4], [x + 4, y - h * 0.45 - 11], [x - 4, y - h * 0.45 - 7]], '#f6d27a');
}
function tree(x, y, k = 1) {
  return `<ellipse cx="${x + 2}" cy="${y + 7}" rx="${10 * k}" ry="${4 * k}" fill="rgba(40,60,20,.25)"/>` +
    `<rect x="${x - 2 * k}" y="${y - 2}" width="${4 * k}" height="${10 * k}" fill="#7a5236"/>` +
    `<circle cx="${x}" cy="${y - 8 * k}" r="${11 * k}" fill="#3f7f36"/><circle cx="${x - 4 * k}" cy="${y - 12 * k}" r="${6 * k}" fill="#57a04a"/>`;
}
function smoke(x, y, big) {
  let s = '';
  for (let k = 0; k < (big ? 3 : 2); k++) s += `<circle class="smoke" style="animation-delay:${k}s" cx="${x + k * 3}" cy="${y - k * 7}" r="${(big ? 6 : 4) - k}" fill="#cfc8bc"/>`;
  return s;
}
const shadow = (cx, cy, w = 26) => `<ellipse cx="${cx + 4}" cy="${cy + 4}" rx="${w}" ry="${w / 2.4}" fill="rgba(40,60,20,.22)"/>`;

const DRAW = {
  forest(cx, cy) {
    let s = '';
    const spots = [[-50, -8], [-20, -22], [12, -30], [-30, 12], [0, -2], [32, -10], [-6, 24], [26, 16], [50, 2], [-44, -24], [44, -24]];
    spots.sort((a, b) => a[1] - b[1]);
    for (const [dx, dy] of spots) s += tree(cx + dx, cy + dy, 1);
    return s;
  },
  fields(cx, cy, v) {
    const dry = v.events.drought > 0, snow = v.events.winter;
    let s = poly(diamond(cx, cy, BT * 1.35, BH * 1.35), snow ? '#e6e2d6' : dry ? '#c9a46a' : '#b98f4e');
    for (let r = -3; r <= 3; r++) for (let c = -3; c <= 3; c++) {
      if (Math.abs(r) + Math.abs(c) > 4) continue;
      const x = cx + (r - c) * 12, y = cy + (r + c) * 6;
      if (snow) { s += `<circle cx="${x}" cy="${y}" r="2" fill="#c9c2b0"/>`; continue; }
      s += `<ellipse cx="${x}" cy="${y - 4}" rx="3" ry="6" fill="${dry ? '#a88a46' : '#e8c83c'}"/><rect x="${x - .6}" y="${y}" width="1.2" height="4" fill="#6e8f2e"/>`;
    }
    s += `<rect x="${cx + 44}" y="${cy - 30}" width="2" height="22" fill="#7a5236"/><rect x="${cx + 37}" y="${cy - 26}" width="16" height="2" fill="#7a5236"/><circle cx="${cx + 45}" cy="${cy - 33}" r="4" fill="#e8d2a6"/>`;
    return s;
  },
  mine(cx, cy) {
    return shadow(cx, cy, 44) + poly([[cx - 52, cy + 6], [cx - 10, cy - 40], [cx + 30, cy - 26], [cx + 54, cy + 6], [cx, cy + 28]], '#8c8173') +
      poly([[cx - 10, cy - 40], [cx + 30, cy - 26], [cx + 54, cy + 6], [cx + 10, cy - 6]], '#a69b8c') +
      `<path d="M${cx - 16} ${cy + 14} Q${cx - 4} ${cy - 10} ${cx + 10} ${cy + 14} Z" fill="#2e2823"/>` +
      `<rect x="${cx - 18}" y="${cy - 4}" width="30" height="3" fill="#7a5236"/>` +
      `<rect x="${cx + 16}" y="${cy + 4}" width="14" height="8" fill="#7a5236"/><circle cx="${cx + 20}" cy="${cy + 14}" r="2.5" fill="#444"/><circle cx="${cx + 28}" cy="${cy + 14}" r="2.5" fill="#444"/>`;
  },
  dragonpeak(cx, cy, v) {
    const active = v.events.dragon > 0 || v.events.attackDay;
    return poly([[cx - 62, cy + 10], [cx - 6, cy - 92], [cx + 58, cy + 10], [cx, cy + 34]], '#7c6c5e') +
      poly([[cx - 6, cy - 92], [cx + 58, cy + 10], [cx, cy + 34], [cx + 6, cy - 30]], '#958473') +
      poly([[cx - 22, cy - 62], [cx - 6, cy - 92], [cx + 12, cy - 60], [cx, cy - 66], [cx - 10, cy - 58]], '#efe9df') +
      (active ? smoke(cx - 4, cy - 98, true) + `<circle cx="${cx - 6}" cy="${cy - 90}" r="5" fill="#e5803a"/>` : '');
  },
  woodcutter(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#9a6b4a', '#7d5539', '#5e7a3a', '#4c6430') + door(cx, cy, 1) + window2(cx, cy, 1, 18) +
      `<g fill="#b07a4a" stroke="#7a5236" stroke-width=".6"><circle cx="${cx + 24}" cy="${cy + 6}" r="4"/><circle cx="${cx + 32}" cy="${cy + 2}" r="4"/><circle cx="${cx + 28}" cy="${cy - 4}" r="4"/></g>` +
      `<rect x="${cx - 34}" y="${cy + 2}" width="10" height="6" fill="#8a6a4a"/>`;
  },
  mill(cx, cy) {
    const hx = cx + 2, hy = cy - 44;
    return shadow(cx, cy) + house(cx, cy, 0.85, 26, '#e7d9bd', '#cdbb98', '#8c3a2a', '#6f2d20', 12) + door(cx, cy, 0.85) +
      `<g class="blades"><rect x="${hx - 1.5}" y="${hy - 26}" width="3" height="52" fill="#6b5a48"/><rect x="${hx - 26}" y="${hy - 1.5}" width="52" height="3" fill="#6b5a48"/>` +
      `<rect x="${hx + 2}" y="${hy - 26}" width="7" height="22" fill="#f4efe4"/><rect x="${hx - 9}" y="${hy + 4}" width="7" height="22" fill="#f4efe4"/><rect x="${hx + 4}" y="${hy + 2}" width="22" height="7" fill="#f4efe4"/><rect x="${hx - 26}" y="${hy - 9}" width="22" height="7" fill="#f4efe4"/></g>` +
      `<circle cx="${hx}" cy="${hy}" r="3" fill="#4a3a2a"/>`;
  },
  smithy(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#a89888', '#8a7a6a', '#55606e', '#434c58') + door(cx, cy, 1) +
      `<rect x="${cx + 10}" y="${cy - 44}" width="8" height="18" fill="#4a4038"/>` + smoke(cx + 14, cy - 48, false) +
      `<rect x="${cx - 30}" y="${cy + 4}" width="12" height="7" fill="#4a4038"/><rect x="${cx - 28}" y="${cy + 1}" width="8" height="3" fill="#e5803a"/>`;
  },
  carpenter(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#c49a6c', '#a57e54', '#a04a34', '#83392a') + door(cx, cy, 1) + window2(cx, cy, 1, 18) +
      `<g fill="#d8b98a" stroke="#9a7a5a" stroke-width=".6"><rect x="${cx + 20}" y="${cy + 2}" width="18" height="3"/><rect x="${cx + 20}" y="${cy - 2}" width="18" height="3"/><rect x="${cx + 20}" y="${cy - 6}" width="18" height="3"/></g>`;
  },
  bakery(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#f0dcb4', '#d4bc8e', '#c4473a', '#a33a2f') + door(cx, cy, 1) + window2(cx, cy, 1, 18) +
      `<rect x="${cx + 8}" y="${cy - 42}" width="7" height="14" fill="#8a5a3a"/>` + smoke(cx + 11, cy - 46, false) +
      `<ellipse cx="${cx + 24}" cy="${cy + 4}" rx="7" ry="4" fill="#d99a4a"/>`;
  },
  inn(cx, cy) {
    return shadow(cx, cy, 32) + house(cx, cy, 1.15, 26, '#e3c79c', '#c6a97c', '#7a3b2a', '#62301f', 18) + door(cx, cy, 1.15) + window2(cx, cy, 1.15, 26) +
      `<rect x="${cx + 28}" y="${cy - 24}" width="2" height="22" fill="#5a3a22"/><rect x="${cx + 20}" y="${cy - 24}" width="16" height="10" rx="2" fill="#d9622b"/>`;
  },
  tower(cx, cy) {
    const hw = 13, hh = 7, h = 46;
    const [, r, b, l] = diamond(cx, cy, hw, hh);
    const up = (p) => [p[0], p[1] - h];
    return shadow(cx, cy, 18) + poly([l, b, up(b), up(l)], '#9a9286') + poly([b, r, up(r), up(b)], '#7f776b') + poly(diamond(cx, cy - h, hw + 4, hh + 2), '#6b645a') +
      `<rect x="${cx - 1}" y="${cy - h - 26}" width="2" height="24" fill="#5a4a38"/><polygon points="${cx + 1},${cy - h - 26} ${cx + 16},${cy - h - 21} ${cx + 1},${cy - h - 16}" fill="#d9622b"/>` +
      `<rect x="${cx - 8}" y="${cy - 30}" width="4" height="8" fill="#3a332c"/>`;
  },
  market(cx, cy) {
    let s = poly(diamond(cx, cy, BT * 0.95, BH * 0.95), '#dcc8a2');
    const cols = ['#c4473a', '#3a7fc0', '#e2b640', '#4f9a48'];
    [[-26, -8], [8, -16], [-8, 10], [26, 2]].sort((a, b) => a[1] - b[1]).forEach(([dx, dy], k) => {
      const x = cx + dx, y = cy + dy;
      s += `<rect x="${x - 12}" y="${y - 6}" width="24" height="12" fill="#8a6a4a"/>`;
      for (let q = 0; q < 4; q++) s += `<rect x="${x - 14 + q * 7}" y="${y - 18}" width="7" height="8" fill="${q % 2 ? '#f4efe4' : cols[k]}"/>`;
      s += `<circle cx="${x - 5}" cy="${y - 7}" r="2.5" fill="#e8c83c"/><circle cx="${x + 2}" cy="${y - 7}" r="2.5" fill="#c4473a"/>`;
    });
    return s + `<circle cx="${cx}" cy="${cy - 2}" r="5" fill="#9ec7e0" stroke="#7a6a58"/>`;
  },
  council(cx, cy) {
    let s = shadow(cx, cy, 30) + house(cx, cy, 1.1, 22, '#e9e2d4', '#cfc6b4', '#5a6a8a', '#46546e', 14);
    for (let k = 0; k < 3; k++) s += `<rect x="${cx - 22 + k * 8}" y="${cy - 14 + k * 4}" width="3" height="18" fill="#fff"/>`;
    return s;
  },
  treasury(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 0.9, 18, '#b8b0a2', '#9c9486', '#6b645a', '#57514a', 10) +
      `<circle cx="${cx - 12}" cy="${cy - 10}" r="5" fill="#e2b640" stroke="#a07a20"/>`;
  },
  'house-1'(cx, cy) { return shadow(cx, cy, 20) + house(cx, cy, 0.75, 14, '#e8d2a6', '#c9ae80', '#c4473a', '#a33a2f', 10) + door(cx, cy, 0.75); },
  'house-2'(cx, cy) { return shadow(cx, cy, 24) + house(cx, cy, 0.9, 18, '#efd9b0', '#d0b688', '#8c3a2a', '#6f2d20', 14) + door(cx, cy, 0.9) + window2(cx, cy, 0.9, 18); },
  'house-3'(cx, cy) { return shadow(cx, cy, 30) + house(cx, cy, 1.1, 22, '#f2e0bc', '#d6c098', '#5e7a3a', '#4c6430', 16) + door(cx, cy, 1.1) + window2(cx, cy, 1.1, 22); },
  gate(cx, cy) {
    return `<rect x="${cx - 22}" y="${cy - 34}" width="7" height="36" fill="#7a6450"/><rect x="${cx + 15}" y="${cy - 34}" width="7" height="36" fill="#7a6450"/>` +
      `<rect x="${cx - 26}" y="${cy - 40}" width="52" height="8" fill="#5e4a38"/><circle cx="${cx - 18}" cy="${cy - 44}" r="3" fill="#e5803a"/><circle cx="${cx + 18}" cy="${cy - 44}" r="3" fill="#e5803a"/>`;
  },
  expansion(cx, cy) {
    return `<polygon points="${pts(diamond(cx, cy, BT * 0.95, BH * 0.95))}" fill="rgba(255,255,255,.25)" stroke="#7a6a58" stroke-dasharray="5 4"/>` +
      `<rect x="${cx - 2}" y="${cy - 24}" width="3" height="22" fill="#7a5236"/><rect x="${cx - 16}" y="${cy - 30}" width="32" height="12" rx="2" fill="#efe4cf" stroke="#9a7a5a"/>`;
  },
};

// ---------- the walkable grid ----------

export const ROAD = new Set();
for (let j = 7; j <= 10; j++) ROAD.add(`5,${j}`);
for (let i = 0; i <= 11; i++) ROAD.add(`${i},4`);
for (let j = 5; j <= 8; j++) ROAD.add(`7,${j}`);
const WATER = new Set(['8,7', '9,7', '8,8']);

let blocked = null, entrances = {}, workCells = {};
const OPEN_AREAS = new Set(['gate', 'expansion', 'fields', 'forest']); // people can walk inside these
export function buildGrid(buildings) {
  blocked = new Set(WATER);
  for (const b of buildings) {
    if (OPEN_AREAS.has(b.id)) {
      const cells = [];
      for (let i = b.i; i < b.i + b.w; i++) for (let j = b.j; j < b.j + b.w; j++) cells.push([i, j]);
      workCells[b.id] = cells;
      continue;
    }
    for (let i = b.i; i < b.i + b.w; i++) for (let j = b.j; j < b.j + b.w; j++) blocked.add(`${i},${j}`);
  }
  for (const b of buildings) {
    const cand = [];
    for (let k = 0; k < b.w; k++) cand.push([b.i + b.w, b.j + k], [b.i + k, b.j + b.w], [b.i - 1, b.j + k], [b.i + k, b.j - 1]);
    const ok = cand.filter(([i, j]) => i >= 0 && j >= 0 && i < N && j < N && !blocked.has(`${i},${j}`));
    ok.sort((a, c) => (ROAD.has(`${c[0]},${c[1]}`) - ROAD.has(`${a[0]},${a[1]}`)));
    entrances[b.id] = ok[0] || [b.i, b.j];
  }
}
export const entranceOf = (id) => entrances[id];
// where a person stands to work: inside fields and forest, at the door elsewhere
export function workCellOf(id, k = 0) {
  const cells = workCells[id];
  if (cells && (id === 'fields' || id === 'forest')) return cells[Math.abs(k) % cells.length];
  return entrances[id];
}
export const isOpenArea = (id) => OPEN_AREAS.has(id);

// a little sign over a building showing who is inside
export function hereBadge(x, y, text) {
  const w = text.length * 7 + 26;
  return `<g><rect x="${x - w / 2}" y="${y - 12}" width="${w}" height="22" rx="11" fill="#d9622b" opacity=".95"/>` +
    `<circle cx="${x - w / 2 + 12}" cy="${y - 3}" r="3" fill="#fff"/><rect x="${x - w / 2 + 8}" y="${y + 1}" width="8" height="6" rx="3" fill="#fff"/>` +
    `<text x="${x - w / 2 + 21}" y="${y + 4}" font-size="12" fill="#fff">${text}</text></g>`;
}

export function speech(x, y, text) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) { if ((line + ' ' + w).trim().length > 30) { lines.push(line.trim()); line = w; } else line += ' ' + w; }
  if (line.trim()) lines.push(line.trim());
  const w = Math.max(...lines.map((l) => l.length)) * 7 + 22, h = lines.length * 17 + 12;
  const bx = Math.min(VW - w - 6, Math.max(6, x - w / 2)), by = y - 52 - h;
  return `<g><rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="10" fill="#fffaf2" stroke="#7a6a58" stroke-width="1"/>` +
    `<polygon points="${x - 7},${by + h - 1} ${x + 7},${by + h - 1} ${x},${by + h + 10}" fill="#fffaf2" stroke="#7a6a58" stroke-width="1"/><rect x="${x - 6}" y="${by + h - 3}" width="12" height="4" fill="#fffaf2"/>` +
    lines.map((l, k) => `<text x="${bx + 11}" y="${by + 21 + k * 17}" font-size="13" fill="#2f2418">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('') + `</g>`;
}

export function findPath(from, to) {
  const key = (c) => `${c[0]},${c[1]}`;
  const prev = new Map([[key(from), null]]);
  const q = [from];
  while (q.length) {
    const c = q.shift();
    if (c[0] === to[0] && c[1] === to[1]) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [c[0] + di, c[1] + dj], k = key(n);
      if (n[0] < 0 || n[1] < 0 || n[0] >= N || n[1] >= N || blocked.has(k) || prev.has(k)) continue;
      prev.set(k, c);
      q.push(n);
    }
  }
  if (!prev.has(key(to))) return [from];
  const path = [];
  for (let c = to; c; c = prev.get(key(c))) path.unshift(c);
  return path;
}

// ---------- people ----------

export function person(x, y, look, t) {
  return `<g transform="translate(${x} ${y}) scale(1.3) translate(${-x} ${-y})">${personInner(x, y, look, t)}</g>`;
}
function personInner(x, y, look, t) {
  const bob = Math.sin(t * 10) * (look.moving ? 1.2 : 0);
  const step = look.moving ? Math.sin(t * 10) * 2 : 0;
  let s = `<ellipse cx="${x}" cy="${y}" rx="7" ry="3" fill="rgba(0,0,0,.22)"/>`;
  if (look.you) s += `<ellipse cx="${x}" cy="${y}" rx="11" ry="5" fill="none" stroke="#d9622b" stroke-width="2"/>`;
  s += `<rect x="${x - 4 + step / 2}" y="${y - 8}" width="3" height="8" fill="#4a3a2a"/><rect x="${x + 1 - step / 2}" y="${y - 8}" width="3" height="8" fill="#4a3a2a"/>`;
  s += `<rect x="${x - 6}" y="${y - 20 + bob}" width="12" height="13" rx="4" fill="${look.color}"/>`;
  s += `<circle cx="${x}" cy="${y - 25 + bob}" r="5.5" fill="${look.skin || '#f0c8a0'}"/>`;
  s += `<path d="M${x - 5.5} ${y - 26 + bob} Q${x} ${y - 33 + bob} ${x + 5.5} ${y - 26 + bob} Z" fill="${look.hair || '#5a3a22'}"/>`;
  if (look.beard) s += `<path d="M${x - 4} ${y - 23 + bob} Q${x} ${y - 16 + bob} ${x + 4} ${y - 23 + bob} Z" fill="#e8e2d6"/>`;
  if (look.carry) s += `<rect x="${x + 5}" y="${y - 17 + bob}" width="7" height="7" rx="1.5" fill="${look.carry}" stroke="rgba(0,0,0,.3)" stroke-width=".6"/>`;
  if (look.work != null) s += `<rect x="${x - 14}" y="${y - 46 + bob}" width="28" height="5" rx="2.5" fill="rgba(0,0,0,.25)"/><rect x="${x - 14}" y="${y - 46 + bob}" width="${28 * look.work}" height="5" rx="2.5" fill="#e2b640"/>` +
    `<g transform="rotate(${Math.sin(t * 14) * 35} ${x + 7} ${y - 16})"><rect x="${x + 6}" y="${y - 30}" width="2" height="14" fill="#6b4a2e"/><rect x="${x + 3}" y="${y - 31}" width="9" height="4" fill="#8a8a90"/></g>`;
  if (look.name) s += `<text class="tag you-tag" x="${x}" y="${y - 36 + bob}" text-anchor="middle">${look.name}</text>`;
  return s;
}

// ---------- drawing the map ----------

export function setupMap(svg) {
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  svg.innerHTML = `<g id="ground"></g><g id="marker"></g><g id="walkers"></g><g id="labels"></g><g id="fx" pointer-events="none"></g><rect id="night" x="0" y="0" width="${VW}" height="${VH}" fill="#1a2240" opacity="0" pointer-events="none"/>`;
}

function centerOf(b) {
  return cellCenter(b.i + (b.w - 1) / 2, b.j + (b.w - 1) / 2);
}

export function renderMap(svg, world, view, ui) {
  const winter = view.events.winter;
  let s = '';
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const [cx, cy] = cellCenter(i, j);
    const k = `${i},${j}`;
    let fill = (i + j) % 2 ? '#8cc65a' : '#80bd4e';
    if (winter) fill = (i + j) % 2 ? '#e4ece6' : '#d8e3dc';
    if (ROAD.has(k)) fill = winter ? '#e8e0cc' : '#e3cb94';
    if (WATER.has(k)) fill = winter ? '#b9d6ea' : '#5fa8dc';
    s += poly(diamond(cx, cy, TW / 2, TH / 2), fill);
  }
  const order = [...world.buildings].sort((a, b) => (a.i + a.j + a.w) - (b.i + b.j + b.w));
  let labels = '';
  for (const b of order) {
    const [cx, cy] = centerOf(b);
    const draw = DRAW[b.id];
    if (!draw) continue;
    const npc = view.npcs[b.id];
    const closed = npc && npc.closed;
    const nm = ui.nameOf ? ui.nameOf(b.id) : b.name;
    s += `<g class="bld" data-id="${b.id}" tabindex="0" role="button" aria-label="${nm}"${closed ? ' opacity=".55"' : ''}>` +
      `<title>${nm}</title><g transform="translate(${cx} ${cy}) scale(${K}) translate(${-cx} ${-cy})">${draw(cx, cy, view)}</g></g>`;
    const show = ui.hover === b.id || ui.selected === b.id || ui.target === b.id || ui.showAll;
    if (show) {
      const label = nm + (closed ? ' ' + (ui.closedTag || '(closed)') : '');
      const ly = cy + (b.w > 1 ? TH * 1.25 : TH * 0.85), lw = label.length * 7.4 + 16;
      labels += `<g class="lbl${ui.selected === b.id ? ' sel' : ''}" pointer-events="none"><rect x="${cx - lw / 2}" y="${ly - 14}" width="${lw}" height="20" rx="10" fill="rgba(255,250,242,.92)" stroke="rgba(120,90,60,.3)"/>` +
        `<text class="tag" x="${cx}" y="${ly}" text-anchor="middle">${label}</text></g>`;
    }
  }
  svg.querySelector('#ground').innerHTML = s;
  svg.querySelector('#labels').innerHTML = labels;
  svg.querySelector('#night').setAttribute('opacity', view.dayProgress > 0.8 ? '0.28' : '0');

  // quest marker: a bouncing arrow over the building the player should visit
  const tb = ui.target && world.buildings.find((b) => b.id === ui.target);
  if (tb) {
    const [cx, cy] = centerOf(tb);
    const top = cy - (tb.id === 'dragonpeak' ? 150 : tb.w > 1 ? 80 : 70);
    svg.querySelector('#marker').innerHTML = `<ellipse class="pulse" cx="${cx}" cy="${cy + 4}" rx="${tb.w * 34}" ry="${tb.w * 17}" fill="none" stroke="#d9622b" stroke-width="3"/>` +
      `<g class="bounce"><polygon points="${cx - 11},${top - 16} ${cx + 11},${top - 16} ${cx},${top}" fill="#d9622b" stroke="#fff" stroke-width="2"/></g>`;
  } else svg.querySelector('#marker').innerHTML = '';
}
