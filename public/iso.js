// Isometric renderer for Emberwick. This is the "visual layer": it only reads
// game data and draws it. Swapping this file for a pixel-art renderer later does
// not touch anyone's coins, items, houses or contracts.

export const N = 12, TW = 60, TH = 30, OX = 380, OY = 52;

export function cellCenter(i, j) {
  return [OX + (i - j) * TW / 2, OY + (i + j) * TH / 2 + TH / 2];
}

const pts = (a) => a.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (a, fill, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" stroke="rgba(60,40,20,.35)" stroke-width=".6" ${extra}/>`;

function diamond(cx, cy, hw, hh) {
  return [[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]];
}

// an isometric box with a hip roof
function house(cx, cy, s, h, wallL, wallR, roofL, roofR, roofH = 16) {
  const hw = TW / 2 * s * 0.8, hh = TH / 2 * s * 0.8;
  const [t, r, b, l] = diamond(cx, cy, hw, hh);
  const up = (p) => [p[0], p[1] - h];
  const apex = [cx, cy - h - roofH];
  return poly([l, b, up(b), up(l)], wallL) + poly([b, r, up(r), up(b)], wallR) +
    poly([up(l), up(b), apex], roofL) + poly([up(b), up(r), apex], roofR) +
    poly([up(t), up(l), apex], roofL, 'opacity=".6"') + poly([up(t), up(r), apex], roofR, 'opacity=".6"');
}

function door(cx, cy, s, h) {
  const hw = TW / 2 * s * 0.8, hh = TH / 2 * s * 0.8;
  const x = cx - hw * 0.45, y = cy + hh * 0.55;
  return poly([[x - 4, y - 2], [x + 4, y + 2], [x + 4, y - 12], [x - 4, y - 16]], '#5a3a22');
}

function tree(x, y, k = 1) {
  return `<rect x="${x - 2 * k}" y="${y - 2}" width="${4 * k}" height="${10 * k}" fill="#7a5236"/>` +
    `<circle cx="${x}" cy="${y - 8 * k}" r="${11 * k}" fill="#3f7f36"/><circle cx="${x - 4 * k}" cy="${y - 12 * k}" r="${6 * k}" fill="#57a04a"/>`;
}

function smoke(x, y, big) {
  const n = big ? 3 : 2;
  let s = '';
  for (let k = 0; k < n; k++) s += `<circle class="smoke" style="animation-delay:${k}s" cx="${x + k * 3}" cy="${y - k * 7}" r="${(big ? 6 : 4) - k}" fill="#cfc8bc"/>`;
  return s;
}

const DRAW = {
  forest(cx, cy) {
    let s = '';
    const spots = [[-50, -8], [-20, -22], [12, -30], [-30, 12], [0, -2], [32, -10], [-6, 24], [26, 16], [50, 2]];
    for (const [dx, dy] of spots) s += tree(cx + dx, cy + dy, 1);
    return s;
  },
  fields(cx, cy, v) {
    const dry = v.events.drought > 0;
    let s = poly(diamond(cx, cy, TW * 1.3, TH * 1.3), dry ? '#c9a46a' : '#d9b35e');
    for (let r = -3; r <= 3; r++) for (let c = -3; c <= 3; c++) {
      if (Math.abs(r) + Math.abs(c) > 4) continue;
      const x = cx + (r - c) * 12, y = cy + (r + c) * 6;
      s += `<ellipse cx="${x}" cy="${y - 4}" rx="3" ry="6" fill="${dry ? '#a88a46' : '#e8c83c'}"/><rect x="${x - .6}" y="${y}" width="1.2" height="4" fill="#6e8f2e"/>`;
    }
    return s;
  },
  mine(cx, cy) {
    return poly([[cx - 52, cy + 6], [cx - 10, cy - 40], [cx + 30, cy - 26], [cx + 54, cy + 6], [cx, cy + 28]], '#8c8173') +
      poly([[cx - 10, cy - 40], [cx + 30, cy - 26], [cx + 54, cy + 6], [cx + 10, cy - 6]], '#a69b8c') +
      `<path d="M${cx - 16} ${cy + 14} Q${cx - 4} ${cy - 10} ${cx + 10} ${cy + 14} Z" fill="#2e2823"/>` +
      `<rect x="${cx + 16}" y="${cy + 4}" width="14" height="8" fill="#7a5236"/><circle cx="${cx + 20}" cy="${cy + 14}" r="2.5" fill="#444"/><circle cx="${cx + 28}" cy="${cy + 14}" r="2.5" fill="#444"/>`;
  },
  dragonpeak(cx, cy, v) {
    const active = v.events.dragon > 0;
    return poly([[cx - 62, cy + 10], [cx - 6, cy - 92], [cx + 58, cy + 10], [cx, cy + 34]], '#7c6c5e') +
      poly([[cx - 6, cy - 92], [cx + 58, cy + 10], [cx, cy + 34], [cx + 6, cy - 30]], '#958473') +
      poly([[cx - 22, cy - 62], [cx - 6, cy - 92], [cx + 12, cy - 60], [cx, cy - 66], [cx - 10, cy - 58]], '#efe9df') +
      (active ? smoke(cx - 4, cy - 98, true) + `<circle cx="${cx - 6}" cy="${cy - 90}" r="5" fill="#e5803a"/>` : '');
  },
  woodcutter(cx, cy) {
    return house(cx, cy, 1, 18, '#9a6b4a', '#7d5539', '#5e7a3a', '#4c6430') + door(cx, cy, 1, 18) +
      `<g fill="#b07a4a" stroke="#7a5236" stroke-width=".6"><circle cx="${cx + 22}" cy="${cy + 6}" r="4"/><circle cx="${cx + 30}" cy="${cy + 2}" r="4"/><circle cx="${cx + 26}" cy="${cy - 4}" r="4"/></g>`;
  },
  mill(cx, cy) {
    const hx = cx + 2, hy = cy - 44;
    return house(cx, cy, 0.85, 26, '#e7d9bd', '#cdbb98', '#8c3a2a', '#6f2d20', 12) + door(cx, cy, 0.85, 26) +
      `<g class="blades"><rect x="${hx - 1.5}" y="${hy - 26}" width="3" height="52" fill="#6b5a48"/><rect x="${hx - 26}" y="${hy - 1.5}" width="52" height="3" fill="#6b5a48"/>` +
      `<rect x="${hx + 2}" y="${hy - 26}" width="7" height="22" fill="#f4efe4"/><rect x="${hx - 9}" y="${hy + 4}" width="7" height="22" fill="#f4efe4"/><rect x="${hx + 4}" y="${hy + 2}" width="22" height="7" fill="#f4efe4"/><rect x="${hx - 26}" y="${hy - 9}" width="22" height="7" fill="#f4efe4"/></g>` +
      `<circle cx="${hx}" cy="${hy}" r="3" fill="#4a3a2a"/>`;
  },
  smithy(cx, cy) {
    return house(cx, cy, 1, 18, '#a89888', '#8a7a6a', '#55606e', '#434c58') + door(cx, cy, 1, 18) +
      `<rect x="${cx + 10}" y="${cy - 44}" width="8" height="18" fill="#4a4038"/>` + smoke(cx + 14, cy - 48, false) +
      `<rect x="${cx - 20}" y="${cy - 2}" width="10" height="6" fill="#e5803a"/>`;
  },
  carpenter(cx, cy) {
    return house(cx, cy, 1, 18, '#c49a6c', '#a57e54', '#a04a34', '#83392a') + door(cx, cy, 1, 18) +
      `<g fill="#d8b98a" stroke="#9a7a5a" stroke-width=".6"><rect x="${cx + 18}" y="${cy}" width="18" height="3"/><rect x="${cx + 18}" y="${cy - 4}" width="18" height="3"/><rect x="${cx + 18}" y="${cy - 8}" width="18" height="3"/></g>`;
  },
  bakery(cx, cy) {
    return house(cx, cy, 1, 18, '#f0dcb4', '#d4bc8e', '#c4473a', '#a33a2f') + door(cx, cy, 1, 18) +
      `<rect x="${cx + 8}" y="${cy - 42}" width="7" height="14" fill="#8a5a3a"/>` + smoke(cx + 11, cy - 46, false) +
      `<ellipse cx="${cx + 20}" cy="${cy + 2}" rx="7" ry="4" fill="#d99a4a"/>`;
  },
  inn(cx, cy) {
    return house(cx, cy, 1.15, 26, '#e3c79c', '#c6a97c', '#7a3b2a', '#62301f', 18) + door(cx, cy, 1.15, 26) +
      `<rect x="${cx + 26}" y="${cy - 26}" width="2" height="22" fill="#5a3a22"/><rect x="${cx + 18}" y="${cy - 26}" width="16" height="10" rx="2" fill="#d9622b"/>` +
      `<rect x="${cx - 18}" y="${cy - 16}" width="6" height="6" fill="#f6d27a"/><rect x="${cx + 8}" y="${cy - 10}" width="6" height="6" fill="#f6d27a"/>`;
  },
  tower(cx, cy) {
    const hw = 13, hh = 7, h = 46;
    const [t, r, b, l] = diamond(cx, cy, hw, hh);
    const up = (p, k = h) => [p[0], p[1] - k];
    return poly([l, b, up(b), up(l)], '#9a9286') + poly([b, r, up(r), up(b)], '#7f776b') + poly(diamond(cx, cy - h, hw + 4, hh + 2), '#6b645a') +
      `<rect x="${cx - 3}" y="${cy - h - 26}" width="2" height="24" fill="#5a4a38"/><polygon points="${cx - 1},${cy - h - 26} ${cx + 14},${cy - h - 21} ${cx - 1},${cy - h - 16}" fill="#d9622b"/>` +
      `<rect x="${cx - 8}" y="${cy - 34}" width="4" height="8" fill="#3a332c"/>`;
  },
  market(cx, cy) {
    let s = poly(diamond(cx, cy, TW * 0.95, TH * 0.95), '#dcc8a2');
    const cols = ['#c4473a', '#3a7fc0', '#e2b640', '#4f9a48'];
    [[-26, -8], [8, -16], [-8, 10], [26, 2]].forEach(([dx, dy], k) => {
      const x = cx + dx, y = cy + dy;
      s += `<rect x="${x - 12}" y="${y - 6}" width="24" height="12" fill="#8a6a4a"/>`;
      for (let q = 0; q < 4; q++) s += `<rect x="${x - 14 + q * 7}" y="${y - 18}" width="7" height="8" fill="${q % 2 ? '#f4efe4' : cols[k]}"/>`;
      s += `<circle cx="${x - 5}" cy="${y - 7}" r="2.5" fill="#e8c83c"/><circle cx="${x + 2}" cy="${y - 7}" r="2.5" fill="#c4473a"/>`;
    });
    return s;
  },
  council(cx, cy) {
    let s = house(cx, cy, 1.1, 22, '#e9e2d4', '#cfc6b4', '#5a6a8a', '#46546e', 14);
    for (let k = 0; k < 3; k++) s += `<rect x="${cx - 22 + k * 8}" y="${cy - 14 + k * 4}" width="3" height="18" fill="#fff"/>`;
    return s;
  },
  treasury(cx, cy) {
    return house(cx, cy, 0.9, 18, '#b8b0a2', '#9c9486', '#6b645a', '#57514a', 10) +
      `<circle cx="${cx - 12}" cy="${cy - 10}" r="5" fill="#e2b640" stroke="#a07a20"/>`;
  },
  'house-1'(cx, cy) { return house(cx, cy, 0.75, 14, '#e8d2a6', '#c9ae80', '#c4473a', '#a33a2f', 10) + door(cx, cy, 0.75, 14); },
  'house-2'(cx, cy) { return house(cx, cy, 0.9, 18, '#efd9b0', '#d0b688', '#8c3a2a', '#6f2d20', 14) + door(cx, cy, 0.9, 18); },
  'house-3'(cx, cy) { return house(cx, cy, 1.1, 22, '#f2e0bc', '#d6c098', '#5e7a3a', '#4c6430', 16) + door(cx, cy, 1.1, 22); },
  gate(cx, cy) {
    return `<rect x="${cx - 22}" y="${cy - 34}" width="7" height="36" fill="#7a6450"/><rect x="${cx + 15}" y="${cy - 34}" width="7" height="36" fill="#7a6450"/>` +
      `<rect x="${cx - 26}" y="${cy - 40}" width="52" height="8" fill="#5e4a38"/>`;
  },
  expansion(cx, cy) {
    return `<polygon points="${pts(diamond(cx, cy, TW * 0.95, TH * 0.95))}" fill="rgba(255,255,255,.25)" stroke="#7a6a58" stroke-dasharray="5 4"/>` +
      `<rect x="${cx - 2}" y="${cy - 24}" width="3" height="22" fill="#7a5236"/><rect x="${cx - 16}" y="${cy - 30}" width="32" height="12" rx="2" fill="#efe4cf" stroke="#9a7a5a"/>`;
  },
};

const ROAD = new Set();
for (let j = 7; j <= 10; j++) ROAD.add(`5,${j}`);
for (let i = 0; i <= 11; i++) ROAD.add(`${i},4`);
for (let j = 5; j <= 8; j++) ROAD.add(`7,${j}`);
const WATER = new Set(['8,7', '9,7', '8,8']);

export function renderMap(svg, world, view, selected) {
  const night = view.dayProgress > 0.8;
  const winter = view.events.winter;
  let s = '';
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const [cx, cy] = cellCenter(i, j);
    const k = `${i},${j}`;
    let fill = (i + j) % 2 ? '#8cc65a' : '#80bd4e';
    if (winter) fill = (i + j) % 2 ? '#dfe8e0' : '#d3ded6';
    if (ROAD.has(k)) fill = winter ? '#e8e0cc' : '#e3cb94';
    if (WATER.has(k)) fill = winter ? '#b9d6ea' : '#5fa8dc';
    s += poly(diamond(cx, cy, TW / 2, TH / 2), fill);
  }
  let labels = '';
  const order = [...world.buildings].sort((a, b) => (a.i + a.j + a.w) - (b.i + b.j + b.w));
  for (const b of order) {
    const [cx, cy] = cellCenter(b.i + (b.w - 1) / 2, b.j + (b.w - 1) / 2);
    const draw = DRAW[b.id];
    if (!draw) continue;
    const npc = view.npcs[b.id];
    const closed = npc && npc.closed;
    s += `<g class="bld${selected === b.id ? ' sel' : ''}" data-id="${b.id}" tabindex="0" role="button" aria-label="${b.name}"${closed ? ' opacity=".55"' : ''}>`;
    s += `<title>${b.name}</title>` + draw(cx, cy, view);
    s += `</g>`;
    const label = b.name + (closed ? ' (closed)' : '');
    const ly = cy + (b.w > 1 ? TH * 1.1 : TH * 0.75), lw = label.length * 6 + 10;
    labels += `<g class="lbl${selected === b.id ? ' sel' : ''}" pointer-events="none"><rect x="${cx - lw / 2}" y="${ly - 11}" width="${lw}" height="15" rx="7" fill="rgba(255,250,242,.82)"/>` +
      `<text class="tag" x="${cx}" y="${ly}" text-anchor="middle">${label}</text></g>`;
  }
  s += labels;
  if (night) s += `<rect x="0" y="0" width="760" height="450" fill="#1a2240" opacity=".28" pointer-events="none"/>`;
  svg.innerHTML = s;
}
