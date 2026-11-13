// Emberwick City: a bigger map you walk through. The camera follows your villager along streets, past the
// station, the city hall, the square with its clock tower, the park, the market, the Exchange tower, Orin's
// branch, the building site, the hospital and the harbour. Nothing here moves money: the city is a preview,
// and its buildings lead to the places in the game that already work (council, exchange, Orin, market).
import { person, isoTree, isoCityArt, isoShade } from './iso.js';

const CN = 24, TW = 80, TH = 40;
const VIEW_CX = 556, VIEW_CY = 330; // where your villager stands on the screen
export const ccell = (i, j) => [(i - j) * TW / 2, (i + j) * TH / 2];
const pts = (a) => a.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (a, fill, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" stroke="rgba(40,30,20,.28)" stroke-width=".6" ${extra}/>`;
const diamond = (cx, cy, hw, hh) => [[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]];
const lift = (p, h) => [p[0], p[1] - h];
const hash = (i, j, k = 0) => { let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const tlen = (t) => [...String(t)].reduce((a, c) => a + (/[⺀-鿿＀-￯]/.test(c) ? 1.85 : 1), 0);

// ---------- the plan of the city ----------
const ROAD = (i, j) => i <= 20 && (i % 6 === 5 || j % 6 === 5);
const kind = new Map(); // "i,j" -> road | plaza | park | market | sand | pier | sea | pond | lot
const K = (i, j) => `${i},${j}`;
function area(i0, i1, j0, j1, k) { for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!ROAD(i, j)) kind.set(K(i, j), k); }
for (let i = 0; i < CN; i++) for (let j = 0; j < CN; j++) kind.set(K(i, j), i >= 21 ? 'sea' : i >= 18 ? 'sand' : ROAD(i, j) ? 'road' : 'lot');
area(6, 10, 6, 10, 'plaza');
area(6, 10, 12, 16, 'park'); area(8, 9, 13, 14, 'pond');
area(12, 16, 6, 10, 'market');
for (let i = 21; i < CN; i++) for (const j of [14, 15]) kind.set(K(i, j), 'pier');
// things standing on walkable ground block it
const BLOCKED = new Set([K(8, 8), K(13, 7), K(13, 9), K(15, 7), K(15, 9), K(22, 3), K(18, 12), K(18, 13), K(19, 12), K(19, 13), K(19, 2), K(19, 7), K(18, 9), K(19, 19), K(18, 21)]);
export const walkable = (i, j) => i >= 0 && j >= 0 && i < CN && j < CN && !BLOCKED.has(K(i, j)) && ['road', 'plaza', 'park', 'market', 'sand', 'pier'].includes(kind.get(K(i, j)));

// landmarks: where they stand (tiles), where you stop in front of them (door) and what a click opens
export const PLACES = {
  station: { tiles: [1, 3, 1, 3], door: [5, 2] },
  hall: { tiles: [7, 9, 1, 3], door: [8, 5] },
  clock: { tiles: [8, 8, 8, 8], door: [7, 8] },
  park: { tiles: [6, 10, 12, 16], door: [7, 14] },
  market: { tiles: [12, 16, 6, 10], door: [12, 8] },
  tower: { tiles: [13, 14, 1, 2], door: [11, 2] },
  branch: { tiles: [15, 16, 2, 3], door: [17, 3] },
  site: { tiles: [12, 16, 12, 16], door: [11, 14], id: 'city' },
  hospital: { tiles: [1, 3, 13, 15], door: [5, 14] },
  harbor: { tiles: [18, 19, 12, 13], door: [17, 13] },
  lighthouse: { tiles: [22, 22, 3, 3], door: [20, 3] },
};
export function placeAt(i, j) {
  for (const [k, p] of Object.entries(PLACES)) { const [a, b, c, d] = p.tiles; if (i >= a && i <= b && j >= c && j <= d) return k; }
  if (i >= 21 && (j === 14 || j === 15)) return 'harbor';
  return null;
}

// ---------- drawing ----------
// an isometric box over tiles [i0..i0+w-1] x [j0..j0+d-1], a little inside the tiles so streets have pavements
function box(i0, j0, w, d, h, c, o = {}) {
  const ins = o.inset ?? 0.14, a0 = i0 - 0.5 + ins, a1 = i0 + w - 0.5 - ins, b0 = j0 - 0.5 + ins, b1 = j0 + d - 0.5 - ins;
  const N = ccell(a0, b0), E = ccell(a1, b0), S = ccell(a1, b1), W = ccell(a0, b1);
  const left = c.left || isoShade(c.wall, 0.92), right = c.right || isoShade(c.wall, 0.78);
  let s = `<ellipse cx="${S[0] + 6}" cy="${S[1] - (S[1] - N[1]) / 2 + 6}" rx="${(E[0] - W[0]) / 2 + 6}" ry="${(S[1] - N[1]) / 2 + 4}" fill="rgba(30,30,30,.16)"/>`;
  s += poly([W, S, lift(S, h), lift(W, h)], left) + poly([S, E, lift(E, h), lift(S, h)], right);
  // windows: rows on both visible faces, lit at night
  const win = o.night ? '#ffd76a' : (c.glass || '#cfe6f2'), wr = o.winRows ?? Math.max(1, Math.floor((h - 14) / 16));
  const face = (P, Q, cols, sh) => {
    let g = '';
    for (let r = 0; r < wr; r++) for (let k = 0; k < cols; k++) {
      const f0 = (k + 0.25) / cols, f1 = (k + 0.75) / cols, y0 = 10 + r * 16, y1 = y0 + 8;
      const A = [P[0] + (Q[0] - P[0]) * f0, P[1] + (Q[1] - P[1]) * f0], B = [P[0] + (Q[0] - P[0]) * f1, P[1] + (Q[1] - P[1]) * f1];
      const lit = !o.night || hash(i0 * 7 + k, j0 * 5 + r, sh) < 0.6;
      g += `<polygon points="${pts([lift(A, y0), lift(B, y0), lift(B, y1), lift(A, y1)])}" fill="${lit ? win : '#5a6470'}" opacity=".9"/>`;
    }
    return g;
  };
  if (!o.noWin) s += face(W, S, Math.max(1, Math.round(w * 2)), 1) + face(S, E, Math.max(1, Math.round(d * 2)), 2);
  const top = [lift(N, h), lift(E, h), lift(S, h), lift(W, h)];
  if (o.roof === 'gable') { // a pitched roof along the i axis
    const r = c.roof || '#b5543a', mN = [(top[0][0] + top[3][0]) / 2, (top[0][1] + top[3][1]) / 2 - 22], mE = [(top[1][0] + top[2][0]) / 2, (top[1][1] + top[2][1]) / 2 - 22];
    s += poly([top[3], top[2], mE, mN], isoShade(r, 1.05)) + poly([top[2], top[1], mE], isoShade(r, 0.8));
  } else {
    s += poly(top, c.top || isoShade(c.wall, 1.12));
    if (!o.noParapet) s += `<polygon points="${pts(top)}" fill="none" stroke="${isoShade(c.wall, 0.7)}" stroke-width="2"/>`;
  }
  if (o.door !== false) { const D = [(W[0] + S[0]) / 2, (W[1] + S[1]) / 2]; s += `<polygon points="${pts([[D[0] - 5, D[1] - 2.5], [D[0] + 5, D[1] + 2.5], [D[0] + 5, D[1] - 12.5], [D[0] - 5, D[1] - 17.5]])}" fill="#5a3a22"/>`; }
  return { s, top, N, E, S, W };
}
const lamp = (x, y, night) => `<rect x="${x - 1}" y="${y - 30}" width="2" height="30" fill="#3d3d44"/><circle cx="${x}" cy="${y - 32}" r="3.4" fill="${night ? '#ffe28a' : '#f4f1e6'}" stroke="#3d3d44" stroke-width=".8"/>` + (night ? `<circle cx="${x}" cy="${y - 32}" r="14" fill="#ffd36a" opacity=".22"/>` : '');
const tag = (x, y, text, color = '#5a3a22') => { const w = tlen(text) * 6.9 + 18; return `<g pointer-events="none"><rect x="${x - w / 2}" y="${y - 13}" width="${w}" height="19" rx="9.5" fill="rgba(255,250,242,.94)" stroke="${color}" stroke-opacity=".5"/><text x="${x}" y="${y + 1}" font-size="11.5" font-weight="bold" text-anchor="middle" fill="${color}">${esc(text)}</text></g>`; };

function ground(winter) {
  let s = '';
  const col = {
    road: ['#7a7e86', '#767a82'], plaza: ['#dccfb4', '#d4c6aa'], park: winter ? ['#d7e2d0', '#cfdbc8'] : ['#8fca63', '#86c25a'], market: ['#e6c98e', '#dcbd80'],
    sand: ['#f1dfae', '#ecd8a2'], pier: ['#9a7046', '#8e6740'], sea: ['#5fa8d3', '#5aa2cd'], pond: ['#6fb8dc', '#69b2d6'], lot: winter ? ['#e2e2dc', '#dbdbd4'] : ['#a7c98a', '#a0c283'],
  };
  for (let i = 0; i < CN; i++) for (let j = 0; j < CN; j++) {
    const k = kind.get(K(i, j)), [x, y] = ccell(i, j), c = col[k][(i + j) % 2];
    s += `<polygon points="${pts(diamond(x, y, TW / 2 + 0.4, TH / 2 + 0.4))}" fill="${c}"${k === 'sea' ? ' class="sea"' : ''}/>`;
    if (k === 'road') { // lane marks along the street
      const alongI = j % 6 === 5 && i % 6 !== 5, alongJ = i % 6 === 5 && j % 6 !== 5;
      if (alongI) s += `<path d="M${x - 14} ${y - 7} L${x + 14} ${y + 7}" stroke="#f4f1e6" stroke-width="1.6" stroke-dasharray="7 6" opacity=".8"/>`;
      if (alongJ) s += `<path d="M${x + 14} ${y - 7} L${x - 14} ${y + 7}" stroke="#f4f1e6" stroke-width="1.6" stroke-dasharray="7 6" opacity=".8"/>`;
      if (!alongI && !alongJ) s += `<polygon points="${pts(diamond(x, y, 24, 12))}" fill="none" stroke="#f4f1e6" stroke-width="1.2" stroke-dasharray="3 4" opacity=".6"/>`; // a crossing
    }
    if (k === 'plaza' && (i + j) % 2 === 0) s += `<polygon points="${pts(diamond(x, y, 10, 5))}" fill="#c9b994" opacity=".6"/>`;
    if (k === 'sea' && hash(i, j, 4) < 0.25) s += `<path class="wave" d="M${x - 12} ${y} q6 -4 12 0 t12 0" stroke="#e8f6ff" stroke-width="1.4" fill="none" opacity=".7"/>`;
  }
  // the coastline: a stone edge between sand and sea
  for (let j = 0; j < CN; j++) { const a = ccell(20.5, j - 0.5), b = ccell(20.5, j + 0.5); s += `<path d="M${a[0]} ${a[1]} L${b[0]} ${b[1]}" stroke="#b8a77f" stroke-width="3"/>`; }
  return s;
}

// all the buildings and street things, drawn back to front
function scene(view, T) {
  const night = !!view.night, items = []; // [depth, svg]
  const add = (depth, s) => items.push([depth, s]);
  const lm = (key, s) => `<g class="cbld" data-city="${key}" tabindex="0" role="button" aria-label="${esc(T('city.p.' + key))}"><title>${esc(T('city.p.' + key))}</title>${s}</g>`;
  const labels = [];
  // houses and flats in the plain blocks: four buildings round a small yard
  const palette = [['#e8d5b5', '#b5543a'], ['#d9e1e8', '#4f6d8a'], ['#f0c9a0', '#8a3b2a'], ['#cfd8c4', '#5a7a4a'], ['#e9dccb', '#6a5a8a'], ['#f2e3c2', '#b07a2a'], ['#d6c4b0', '#7a4a3a']];
  for (const [bi, bj] of [[0, 6], [0, 18], [6, 18], [12, 18]]) { // block corners (i0, j0) with plain houses
    for (const [di, dj] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
      const i0 = bi + di, j0 = bj + dj, r = hash(i0, j0, 11), [wall, roof] = palette[Math.floor(r * palette.length)];
      const tall = hash(i0, j0, 12) < 0.35, h = tall ? 70 + Math.floor(hash(i0, j0, 13) * 70) : 34 + Math.floor(r * 22);
      const b = box(i0, j0, 2, 2, h, { wall, roof }, { night, roof: tall ? 'flat' : 'gable', winRows: tall ? undefined : 1 });
      add(i0 + j0 + 3, b.s);
    }
    const [tx, ty] = ccell(bi + 2, bj + 2); add(bi + bj + 4.5, isoTree(tx, ty, 0.9));
  }
  // the station: a long hall with a clock and a platform roof, rails in front
  { const b = box(1, 1, 3, 3, 46, { wall: '#c98a5a', roof: '#6a3a2a' }, { night, roof: 'gable' });
    const [cx, cy] = ccell(2.6, 2.6);
    add(7, lm('station', b.s + `<circle cx="${cx}" cy="${cy - 70}" r="9" fill="#fffaf0" stroke="#5a3a22" stroke-width="2"/><path d="M${cx} ${cy - 70} v-6 M${cx} ${cy - 70} h4" stroke="#5a3a22" stroke-width="1.4"/>`));
    const r0 = ccell(0.2, 4.4), r1 = ccell(4.4, 4.4), q0 = ccell(0.2, 4.1), q1 = ccell(4.4, 4.1);
    add(3, `<path d="M${r0[0]} ${r0[1]} L${r1[0]} ${r1[1]} M${q0[0]} ${q0[1]} L${q1[0]} ${q1[1]}" stroke="#5a5048" stroke-width="2"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const p = ccell(0.4 + k * 0.5, 4.25); return `<path d="M${p[0] - 5} ${p[1] - 5} l10 6" stroke="#7a5a3a" stroke-width="2"/>`; }).join(''));
    labels.push(tag(cx, cy - 92, T('city.p.station'))); }
  // the city hall: white columns, a dome and the village flag
  { const b = box(7, 1, 3, 3, 64, { wall: '#efe9dc', roof: '#6a8aa8', top: '#e2dccd' }, { night, winRows: 2 });
    const [cx, cy] = ccell(8.5, 2.5);
    let s = b.s + `<ellipse cx="${cx}" cy="${cy - 70}" rx="30" ry="13" fill="#6a8aa8"/><path d="M${cx - 30} ${cy - 70} a30 30 0 0 1 60 0" fill="#7d9dbb" stroke="#4f6d8a"/><rect x="${cx - 1}" y="${cy - 128}" width="2" height="30" fill="#555"/><path d="M${cx + 1} ${cy - 128} h18 l-4 6 l4 6 h-18 z" fill="#c0392b"/>`;
    for (let k = 0; k < 5; k++) { const p = ccell(9.7, 1.3 + k * 0.6); s += `<rect x="${p[0] - 2}" y="${p[1] - 52}" width="4" height="50" fill="#fffaf0" stroke="#cfc6b2" stroke-width=".6"/>`; }
    add(14, lm('hall', s)); labels.push(tag(cx, cy - 140, T('city.p.hall'))); }
  // the square: a clock tower that shows the village time, benches and lamps
  { const b = box(8, 8, 1, 1, 120, { wall: '#c9b48a', top: '#8a6a46' }, { night, noWin: true, inset: 0.2 });
    const [cx, cy] = ccell(8, 8), hand = (view.dayProgress || 0) * Math.PI * 4;
    let s = b.s + `<polygon points="${pts([[cx, cy - 158], [cx - 22, cy - 126], [cx + 22, cy - 126]])}" fill="#7a4a2a"/><circle cx="${cx - 8}" cy="${cy - 106}" r="9" fill="#fffaf0" stroke="#5a3a22" stroke-width="1.6"/>` +
      `<path id="cityhand" data-x="${cx - 8}" data-y="${cy - 106}" d="M${cx - 8} ${cy - 106} l${(Math.sin(hand) * 6).toFixed(1)} ${(-Math.cos(hand) * 6).toFixed(1)}" stroke="#2a2a2a" stroke-width="1.6"/>`;
    add(16, lm('clock', s)); labels.push(tag(cx, cy - 172, T('city.p.clock')));
    for (const [i, j] of [[6.6, 6.6], [10.4, 6.6], [6.6, 10.4], [10.4, 10.4]]) { const [x, y] = ccell(i, j); add(i + j, lamp(x, y, night)); }
    for (const [i, j] of [[7, 10], [10, 7]]) { const [x, y] = ccell(i, j); add(i + j, `<rect x="${x - 10}" y="${y - 6}" width="20" height="4" rx="1" fill="#8a5a36"/><rect x="${x - 9}" y="${y - 2}" width="2" height="5" fill="#5a3a22"/><rect x="${x + 7}" y="${y - 2}" width="2" height="5" fill="#5a3a22"/>`); } }
  // the park: trees, a pond with ducks, a bandstand
  { for (let i = 6; i <= 10; i++) for (let j = 12; j <= 16; j++) if (kind.get(K(i, j)) === 'park' && hash(i, j, 21) < 0.45 && !(i === 7 && j === 14)) { const [x, y] = ccell(i + (hash(i, j, 2) - 0.5) * 0.4, j); add(i + j + 0.5, isoTree(x, y, 0.8 + hash(i, j, 3) * 0.3)); }
    const [px, py] = ccell(8.5, 13.5);
    add(22, `<ellipse cx="${px}" cy="${py}" rx="58" ry="26" fill="#6fb8dc" stroke="#cfe6c0" stroke-width="3"/>` + [[-20, 2], [12, -6], [26, 8]].map(([dx, dy]) => `<ellipse class="duck" cx="${px + dx}" cy="${py + dy}" rx="4" ry="2.4" fill="#fffaf0"/><circle cx="${px + dx + 3}" cy="${py + dy - 3}" r="1.8" fill="#2e8b57"/>`).join(''));
    const [cx, cy] = ccell(8, 14); labels.push(tag(cx, cy - 46, T('city.p.park'), '#2e6b3a'));
    add(0, `<g class="cbld" data-city="park" pointer-events="none"></g>`); }
  // the market: stalls with striped awnings
  { const stripes = [['#c0392b', '#fffaf0'], ['#2e8b57', '#fffaf0'], ['#d98a2b', '#fffaf0'], ['#3b5680', '#fffaf0']];
    [[13, 7], [13, 9], [15, 7], [15, 9]].forEach(([i, j], k) => {
      const b = box(i, j, 1, 1, 18, { wall: '#a07850' }, { night: false, noWin: true, door: false, inset: 0.2 }), [x, y] = ccell(i, j), [a, c] = stripes[k];
      let aw = ''; for (let q = 0; q < 4; q++) aw += `<polygon points="${pts([[x - 30 + q * 15, y - 30 + q * 7.5], [x - 15 + q * 15, y - 22.5 + q * 7.5], [x - 15 + q * 15, y - 14 + q * 7.5], [x - 30 + q * 15, y - 21.5 + q * 7.5]])}" fill="${q % 2 ? c : a}"/>`;
      const goods = [0, 1, 2].map((q) => `<circle cx="${x - 8 + q * 8}" cy="${y - 20 + q * 2}" r="3" fill="${['#e2b640', '#c0392b', '#7a9a3a'][q]}"/>`).join('');
      add(i + j + 0.6, lm('market', b.s + goods + aw));
    });
    const [cx, cy] = ccell(14, 8); labels.push(tag(cx, cy - 62, T('city.p.market'), '#8a3b12')); }
  // the Exchange tower: glass, a live board on top
  { const b = box(13, 1, 2, 2, 230, { wall: '#5b7a92', glass: '#bfe3f4' }, { night, winRows: 13 });
    const [cx, cy] = ccell(14, 2), y = cy - 252;
    const bd = view.exBoard, line = bd ? `NEAR ${bd.NEAR || '–'}  EMWK ${bd.EMWK || '–'}` : 'NEAR · EMWK · BTC';
    add(16, lm('tower', b.s + `<rect x="${cx - 46}" y="${y - 16}" width="92" height="18" rx="3" fill="#1e2a36" stroke="#e8b52e"/><text x="${cx}" y="${y - 3.5}" font-size="9.5" font-weight="bold" text-anchor="middle" fill="#7fe08a">${esc(line)}</text>`));
    labels.push(tag(cx, cy - 282, T('city.p.tower'), '#3b5680')); }
  // Orin's branch: a small gold-domed bank
  { const b = box(15, 2, 2, 2, 52, { wall: '#f4ecd6', top: '#e8dcbc' }, { night, winRows: 2 });
    const [cx, cy] = ccell(16, 3);
    add(19, lm('branch', b.s + `<path d="M${cx - 22} ${cy - 58} a22 22 0 0 1 44 0 z" fill="#f2c94c" stroke="#c9971f"/><circle cx="${cx}" cy="${cy - 82}" r="3" fill="#c9971f"/><rect x="${cx - 13}" y="${cy - 50}" width="26" height="9" rx="2" fill="#2f6b4f"/><text x="${cx}" y="${cy - 43}" font-size="7" font-weight="bold" text-anchor="middle" fill="#f2c94c">ORIN</text>`));
    labels.push(tag(cx, cy - 98, T('city.p.branch'), '#2f6b4f')); }
  // the building site: the towers in scaffolding and the crane (the first art of the city)
  { const [cx, cy] = ccell(14, 14);
    add(28, `<g class="bld cbld" data-id="city" data-city="site" tabindex="0" role="button"><title>${esc(T('city.p.site'))}</title><g transform="translate(${cx} ${cy}) scale(1.35) translate(${-cx} ${-cy})">${isoCityArt(cx, cy, view)}</g></g>`);
    labels.push(tag(cx, cy + 92, T('city.p.site'), '#c0392b')); }
  // the hospital, half built
  { const b = box(1, 13, 3, 3, 78, { wall: '#f6f3ec', glass: '#d6ecf6' }, { night, winRows: 3 });
    const [cx, cy] = ccell(2.5, 14.5);
    let s = b.s + `<rect x="${cx - 12}" y="${cy - 118}" width="24" height="24" rx="3" fill="#fff" stroke="#d33" stroke-width="1.4"/><path d="M${cx} ${cy - 114} v16 M${cx - 8} ${cy - 106} h16" stroke="#d33" stroke-width="4.5"/>`;
    const s0 = lift(b.E, 78), s1 = lift(b.S, 78); s += `<path d="M${s0[0]} ${s0[1]} v-26 M${s1[0]} ${s1[1]} v-26 M${s0[0]} ${s0[1] - 13} L${s1[0]} ${s1[1] - 13} M${s0[0]} ${s0[1] - 26} L${s1[0]} ${s1[1] - 26}" stroke="#d98a2b" stroke-width="1.4"/>`;
    add(31, lm('hospital', s)); labels.push(tag(cx, cy - 132, T('city.p.hospital'), '#b23a2e')); }
  // the harbour: a harbour master's house, the pier, boats; a lighthouse on the point
  { const b = box(18, 12, 2, 2, 40, { wall: '#e9e1cf', roof: '#3b5680' }, { night, roof: 'gable', winRows: 1 });
    const [cx, cy] = ccell(19, 13);
    add(32, lm('harbor', b.s)); labels.push(tag(cx, cy - 80, T('city.p.harbor'), '#3b5680'));
    for (let i = 21; i < CN; i++) { const [x, y] = ccell(i, 14.5); add(i + 14 + 0.2, lm('harbor', `<polygon points="${pts(diamond(x, y, 44, 22))}" fill="#9a7046" stroke="#6a4a2a" stroke-width=".8"/><rect x="${x - 1.5}" y="${y - 8}" width="3" height="10" fill="#5a3a22"/>`)); }
    const [lx, ly] = ccell(22, 3);
    add(25.5, lm('lighthouse', `<ellipse cx="${lx}" cy="${ly + 2}" rx="30" ry="14" fill="#8a8f96"/><polygon points="${pts([[lx - 12, ly], [lx + 12, ly], [lx + 7, ly - 96], [lx - 7, ly - 96]])}" fill="#fffaf0" stroke="#999"/>` +
      [0, 1, 2].map((k) => `<polygon points="${pts([[lx - 11 + k * 1.6, ly - 14 - k * 30], [lx + 11 - k * 1.6, ly - 14 - k * 30], [lx + 10.4 - k * 1.6, ly - 28 - k * 30], [lx - 10.4 + k * 1.6, ly - 28 - k * 30]])}" fill="#c0392b"/>`).join('') +
      `<rect x="${lx - 9}" y="${ly - 112}" width="18" height="16" fill="${night ? '#ffe28a' : '#cfe6f2'}" stroke="#555"/><path d="M${lx - 11} ${ly - 112} L${lx} ${ly - 124} L${lx + 11} ${ly - 112} Z" fill="#3b3b44"/>` +
      (night ? `<path class="beam" d="M${lx} ${ly - 104} L${lx - 220} ${ly - 150} L${lx - 220} ${ly - 70} Z" fill="#ffe28a" opacity=".18"/>` : '')));
    labels.push(tag(lx, ly - 138, T('city.p.lighthouse'), '#3b5680'));
    // beach umbrellas
    for (const [i, j] of [[19, 2], [19, 7], [18, 9], [19, 19], [18, 21]]) { const [x, y] = ccell(i, j), c = ['#c0392b', '#2e8b57', '#d98a2b', '#3b5680', '#7a3b8a'][Math.floor(hash(i, j, 5) * 5)]; add(i + j + 0.5, `<rect x="${x - 1}" y="${y - 24}" width="2" height="24" fill="#6a5a4a"/><path d="M${x - 16} ${y - 20} Q${x} ${y - 36} ${x + 16} ${y - 20} Z" fill="${c}"/><rect x="${x - 12}" y="${y - 2}" width="18" height="5" rx="2" fill="#fffaf0" opacity=".9"/>`); } }
  // street trees and lamps along the avenues
  for (let i = 0; i <= 20; i++) for (let j = 0; j < CN; j++) {
    if (kind.get(K(i, j)) !== 'road') continue;
    if (i % 6 === 5 && j % 6 !== 5 && j % 3 === 1) { const [x, y] = ccell(i - 0.42, j); add(i + j - 0.4, lamp(x, y, night)); }
    if (j % 6 === 5 && i % 6 !== 5 && i % 3 === 2) { const [x, y] = ccell(i, j - 0.42); add(i + j - 0.4, isoTree(x, y, 0.6)); }
  }
  items.sort((a, b) => a[0] - b[0]);
  return { s: items.map((x) => x[1]).join(''), labels: labels.join('') };
}

// ---------- people, cars and boats that move ----------
const LOOKS = ['#c0392b', '#3b5680', '#2e8b57', '#d98a2b', '#7a3b8a', '#4a4a52', '#b07a2a', '#1f7a8a'];
const HAIR = ['#5a3a22', '#2a2a2a', '#c9971f', '#8a3b12', '#e8e2d6'];
const SKIN = ['#f0c8a0', '#e2b089', '#c98e62', '#8d5a3b'];
const city = { ready: false, me: null, people: [], cars: [], boats: [], cam: null, lastKey: '' };
function neighbours(i, j) { return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [i + a, j + b]).filter(([a, b]) => walkable(a, b)); }
export function cityPath(from, to) {
  if (!walkable(to[0], to[1])) return [];
  const prev = new Map([[K(...from), null]]), q = [from];
  while (q.length) {
    const c = q.shift(); if (c[0] === to[0] && c[1] === to[1]) break;
    for (const n of neighbours(...c)) if (!prev.has(K(...n))) { prev.set(K(...n), c); q.push(n); }
  }
  if (!prev.has(K(...to))) return [];
  const path = []; for (let c = to; c; c = prev.get(K(...c))) path.unshift(c);
  return path;
}
function setup() {
  city.ready = true;
  const roads = []; for (let i = 0; i < CN; i++) for (let j = 0; j < CN; j++) if (walkable(i, j) && kind.get(K(i, j)) !== 'pier') roads.push([i, j]);
  for (let k = 0; k < 22; k++) {
    const c = roads[Math.floor(hash(k, 3, 9) * roads.length)];
    city.people.push({ cell: c, path: [], prog: 0, wait: hash(k, 4) * 3, look: { color: LOOKS[k % LOOKS.length], hair: HAIR[k % HAIR.length], skin: SKIN[k % SKIN.length], bot: true, scale: 0.95 } });
  }
  // cars drive up and down the avenues
  const carCol = ['#c0392b', '#f2c94c', '#3b5680', '#f4f1e6', '#2e8b57', '#1e2a36', '#d98a2b'];
  [[5, 'i'], [11, 'i'], [17, 'i'], [5, 'j'], [11, 'j'], [17, 'j'], [11, 'i']].forEach(([line, ax], k) => city.cars.push({ line, ax, t: hash(k, 7) * 20, dir: k % 2 ? 1 : -1, col: carCol[k], speed: 1.6 + hash(k, 8) }));
  city.boats = [{ i: 22.6, j: 6, dir: 1, sp: 0.5 }, { i: 23.2, j: 19, dir: -1, sp: 0.35 }];
}
function stepPerson(w, dt) {
  if (!w.path.length) {
    if (w.mine) return; // your villager only walks where you click; the passers-by wander
    w.wait -= dt; if (w.wait > 0) return;
    const opts = neighbours(...w.cell); let c = w.cell;
    for (let s = 0; s < 6; s++) { const n = opts[Math.floor(Math.random() * opts.length)]; if (n) c = n; }
    w.path = cityPath(w.cell, c).slice(1); w.prog = 0; w.wait = 1 + Math.random() * 4;
    if (!w.path.length) return;
  }
  w.prog += dt * (w.speed || 1.6);
  while (w.prog >= 1 && w.path.length) { w.cell = w.path.shift(); w.prog -= 1; if (!w.path.length) { w.prog = 0; if (w.arrived) { const f = w.arrived; w.arrived = null; f(); } } }
}
function posOf(w) {
  if (!w.path.length) return ccell(...w.cell);
  const a = ccell(...w.cell), b = ccell(...w.path[0]);
  return [a[0] + (b[0] - a[0]) * w.prog, a[1] + (b[1] - a[1]) * w.prog];
}
function carSvg(x, y, ax, col, dir) {
  // a small isometric car body along its street
  const along = ax === 'i' ? [TW / 2, TH / 2] : [-TW / 2, TH / 2], L = 0.26, Wd = 0.12, side = ax === 'i' ? [-TW / 2, TH / 2] : [TW / 2, TH / 2];
  const p = (a, b) => [x + along[0] * a + side[0] * b, y + along[1] * a + side[1] * b];
  const off = dir > 0 ? 0.13 : -0.13; // keep to its lane
  const q = (a, b) => p(a, b + off);
  const base = [q(-L, -Wd), q(L, -Wd), q(L, Wd), q(-L, Wd)], h = 9;
  const top = base.map((v) => lift(v, h)), roof = [q(-L * 0.45, -Wd * 0.9), q(L * 0.35, -Wd * 0.9), q(L * 0.35, Wd * 0.9), q(-L * 0.45, Wd * 0.9)].map((v) => lift(v, h + 7));
  return `<ellipse cx="${x}" cy="${y + 3}" rx="16" ry="6" fill="rgba(0,0,0,.18)"/>` + poly([base[3], base[2], top[2], top[3]], isoShade(col, 0.8)) + poly([base[2], base[1], top[1], top[2]], isoShade(col, 0.65)) + poly(top, col) +
    poly([top[0].map((v, k) => (v + roof[0][k]) / 2), roof[1], roof[2], roof[3]], '#cfe6f2');
}

// ---------- the parts the game calls ----------
export function cityKey(view, lang) { return [view.night ? 1 : 0, view.events && view.events.winter ? 1 : 0, lang, view.exBoard ? view.exBoard.NEAR : ''].join('|'); }
export function renderCity(svg, view, ui, T, lang) {
  if (!city.ready) setup();
  if (!city.me) city.me = { cell: [5, 7], path: [], prog: 0, speed: 3.2, mine: true }; // you arrive by the square
  const key = cityKey(view, lang);
  city.view = view;
  const g = svg.querySelector('#ground');
  if (!svg.querySelector('#citycam') || city.lastKey !== key) {
    city.lastKey = key;
    const winter = !!(view.events && view.events.winter), sc = scene(view, T);
    g.innerHTML = `<g id="citycam"><g id="cityground">${ground(winter)}</g>${sc.s}<g id="citymove"></g>${signposts(ui)}<g id="citylabels">${sc.labels}</g></g>`;
    applyCam(svg, true);
  }
  const title = ui.districtTitle || 'Emberwick City', tw = tlen(title) * 9 + 40;
  svg.querySelector('#labels').innerHTML = `<g pointer-events="none"><rect x="${VIEW_CX - tw / 2}" y="18" width="${tw}" height="34" rx="17" fill="rgba(255,250,242,.95)" stroke="rgba(120,90,60,.35)"/><text x="${VIEW_CX}" y="41" font-size="17" font-weight="bold" text-anchor="middle" fill="#5a3a22">${esc(title)}</text></g>` +
    `<g pointer-events="none"><rect x="${VIEW_CX - 170}" y="58" width="340" height="22" rx="11" fill="rgba(30,40,60,.72)"/><text x="${VIEW_CX}" y="73" font-size="11.5" text-anchor="middle" fill="#fffaf0">${esc(ui.cityHint || '')}</text></g>`;
  svg.querySelector('#marker').innerHTML = '';
  svg.querySelector('#night').setAttribute('opacity', view.night ? '0.30' : '0');
  svg.classList.toggle('is-night', !!view.night);
}
function signposts(ui) {
  const post = (id, i, j, text, dir) => {
    const [cx, cy] = ccell(i, j), w = tlen(text) * 6.6 + 18, x0 = dir < 0 ? cx - w : cx;
    return `<g class="bld" data-id="${id}" tabindex="0" role="button" aria-label="${esc(text)}"><title>${esc(text)}</title><rect x="${cx - 2}" y="${cy - 46}" width="4" height="48" fill="#5a3a22"/>` +
      `<polygon points="${dir < 0 ? `${x0 - 8},${cy - 38} ${x0},${cy - 47} ${cx + 2},${cy - 47} ${cx + 2},${cy - 29} ${x0},${cy - 29}` : `${cx - 2},${cy - 47} ${cx + w},${cy - 47} ${cx + w + 8},${cy - 38} ${cx + w},${cy - 29} ${cx - 2},${cy - 29}`}" fill="#efe4cf" stroke="#7a5236" stroke-width="1.4"/>` +
      `<text x="${dir < 0 ? x0 + w / 2 : cx + w / 2}" y="${cy - 34}" font-size="11" text-anchor="middle" fill="#5a3a22" font-weight="bold">${esc(text)}</text></g>`;
  };
  return post('go-d4', 6.2, 6.3, ui.goldBackTag || '← Gold Row', -1) + post('go-village', 6.2, 7.3, ui.backTag || '← Village', -1) + post('go-d1', 7.3, 6.2, ui.laneTag || 'Ember Lane →', 1);
}
function applyCam(svg, snap) {
  const [x, y] = posOf(city.me), want = [VIEW_CX - x, VIEW_CY - y];
  if (!city.cam || snap) city.cam = want.slice();
  else { city.cam[0] += (want[0] - city.cam[0]) * 0.12; city.cam[1] += (want[1] - city.cam[1]) * 0.12; }
  const c = svg.querySelector('#citycam'); if (c) c.setAttribute('transform', `translate(${city.cam[0].toFixed(1)} ${city.cam[1].toFixed(1)})`);
}
// one animation frame: move everyone, follow your villager
export function cityFrame(svg, now, dt, myLook, say) {
  if (!svg.querySelector('#citycam')) return;
  const sec = now / 1000;
  stepPerson(city.me, dt);
  for (const p of city.people) stepPerson(p, dt);
  for (const c of city.cars) c.t += dt * c.speed * c.dir;
  for (const b of city.boats) { b.j += dt * b.sp * b.dir; if (b.j > 22 || b.j < 1) b.dir *= -1; }
  const ents = [];
  for (const c of city.cars) {
    const span = 23, u = ((c.t % span) + span) % span, along = u;
    const [x, y] = c.ax === 'i' ? ccell(along, c.line) : ccell(c.line, along);
    if (c.ax === 'i' && along > 20.4) continue; // not into the sea
    ents.push([y, carSvg(x, y, c.ax, c.col, c.dir)]);
  }
  for (const b of city.boats) { const [x, y] = ccell(b.i, b.j); ents.push([y, `<g transform="translate(${x} ${y + Math.sin(sec * 2 + b.i) * 1.5})"><path d="M-22 0 L22 0 L14 9 L-14 9 Z" fill="#8a5a36"/><rect x="-1" y="-34" width="2" height="34" fill="#5a3a22"/><path d="M1 -32 L20 -6 L1 -6 Z" fill="#fffaf0"/></g>`]); }
  for (const p of city.people) { const [x, y] = posOf(p); ents.push([y, person(x, y, { ...p.look, moving: p.path.length > 0 }, sec + p.cell[0] * 0.3)]); }
  if (myLook) { const [x, y] = posOf(city.me); ents.push([y + 0.1, person(x, y, { ...myLook, moving: city.me.path.length > 0 }, sec) + (say ? say(x, y) : '')]); }
  if (city.target) { const [x, y] = ccell(...city.target); ents.unshift([-1e9, `<ellipse class="walkmark" cx="${x}" cy="${y}" rx="16" ry="8"/>`]); }
  ents.sort((a, b) => a[0] - b[0]);
  const m = svg.querySelector('#citymove'); if (m) m.innerHTML = ents.map((e) => e[1]).join('');
  const hand = svg.querySelector('#cityhand'); // the clock tower shows the village time
  if (hand && city.view) { const a = (city.view.dayProgress || 0) * Math.PI * 4, x = hand.dataset.x, y = hand.dataset.y; hand.setAttribute('d', `M${x} ${y} l${(Math.sin(a) * 6).toFixed(1)} ${(-Math.cos(a) * 6).toFixed(1)}`); }
  applyCam(svg, false);
}
// a click in the city: a landmark, a signpost, or a spot on the street to walk to
export function cityClick(svg, e) {
  const sign = e.target.closest('[data-id]');
  const land = e.target.closest('[data-city]');
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse()), cam = city.cam || [0, 0];
  const x = p.x - cam[0], y = p.y - cam[1];
  const fi = (x / (TW / 2) + y / (TH / 2)) / 2, fj = (y / (TH / 2) - x / (TW / 2)) / 2, i = Math.round(fi), j = Math.round(fj);
  const place = land ? land.dataset.city : placeAt(i, j);
  if (sign && !land) return { go: sign.dataset.id };
  if (place) { walkTo(PLACES[place].door); return { place }; }
  if (walkable(i, j)) { walkTo([i, j]); return { walk: true }; }
  return null;
}
function walkTo(to) {
  const me = city.me, from = me.path.length ? me.path[0] : me.cell;
  const path = cityPath(from, to);
  if (!path.length) return false;
  if (me.path.length) { me.cell = from; me.prog = 0; }
  me.path = path.slice(1); city.target = to;
  me.arrived = () => { city.target = null; };
  if (!me.path.length) city.target = null;
  return true;
}
export function cityReset() { city.me = null; city.cam = null; city.target = null; }
