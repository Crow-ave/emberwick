// Isometric renderer for Emberwick. This is the "visual layer": it only reads
// game data and draws it. Swapping this file for a pixel-art renderer later does
// not touch anyone's coins, items, houses or contracts.

export const N = 14, TW = 80, TH = 40, OX = 556, OY = 50, VW = 1112, VH = 660;
const K = 1.34; // building scale relative to the original 60px tile art
const BT = 60, BH = 30; // tile size the building art was drawn for

export function cellCenter(i, j) {
  return [OX + (i - j) * TW / 2, OY + (i + j) * TH / 2 + TH / 2];
}

const pts = (a) => a.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (a, fill, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" stroke="rgba(60,40,20,.35)" stroke-width=".6" ${extra}/>`;
const diamond = (cx, cy, hw, hh) => [[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]];

// ---------- building parts ----------
// A proper isometric building: two walls, a gable roof with eaves and tiles,
// timber corners, framed windows and a door with a step.
const mid = (a, b, k = 0.5) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const lift = (p, h) => [p[0], p[1] - h];
const shade = (hex, f) => { // darken (f<1) or lighten (f>1) a #rrggbb colour
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};
function frame(cx, cy, s, h) {
  const hw = BT / 2 * s * 0.8, hh = BH / 2 * s * 0.8;
  const [T, R, B, L] = diamond(cx, cy, hw, hh);
  return { hw, hh, T, R, B, L, h };
}
let SNOW = false; // set while drawing a winter village
function house(cx, cy, s, h, wallL, wallR, roofL, roofR, roofH = 16) {
  const { T, R, B, L } = frame(cx, cy, s, h);
  const rh = roofH * 1.25 * s + 4;
  const M1 = lift(mid(T, L), h + rh), M2 = lift(mid(R, B), h + rh);
  const out = (p, k = 1.12) => [cx + (p[0] - cx) * k, p[1] + (k - 1) * 6 * s]; // eaves stick out a little
  const uL = lift(L, h), uB = lift(B, h), uR = lift(R, h), uT = lift(T, h);
  let g = '';
  // back roof plane, then walls, then the front roof plane
  g += poly([out(uT), out(uR), out(M2, 1.04), out(M1, 1.04)], shade(roofR, 1.12));
  g += poly([L, B, uB, uL], wallL) + poly([B, R, uR, uB], wallR) + poly([uB, uR, M2], shade(wallR, 0.92));
  // timber: corner posts and a beam across the long wall
  g += `<path d="M${L[0]} ${L[1]} V${uL[1]} M${B[0]} ${B[1]} V${uB[1]} M${R[0]} ${R[1]} V${uR[1]}" stroke="${shade(wallL, 0.55)}" stroke-width="${1.6 * s}"/>`;
  const bL = mid(L, uL, 0.42), bB = mid(B, uB, 0.42), bR = mid(R, uR, 0.42);
  g += `<path d="M${bL[0]} ${bL[1]} L${bB[0]} ${bB[1]} L${bR[0]} ${bR[1]}" stroke="${shade(wallL, 0.62)}" stroke-width="${1.1 * s}" fill="none"/>`;
  // a little round window up in the gable
  const gw = mid(mid(uB, uR), M2, 0.45);
  g += `<ellipse cx="${gw[0]}" cy="${gw[1]}" rx="${2.6 * s}" ry="${3 * s}" fill="#f6d27a" stroke="${shade(wallR, 0.5)}" stroke-width=".8"/>`;
  // front roof with rows of tiles and a ridge cap
  const fL = out(uL), fB = out(uB), fM2 = out(M2, 1.04), fM1 = out(M1, 1.04);
  g += poly([fL, fB, fM2, fM1], roofL);
  for (let k = 1; k <= 3; k++) {
    const a = mid(fL, fM1, k / 4), b = mid(fB, fM2, k / 4);
    g += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${shade(roofL, 0.75)}" stroke-width="${0.9 * s}"/>`;
  }
  g += `<line x1="${fM1[0]}" y1="${fM1[1]}" x2="${fM2[0]}" y2="${fM2[1]}" stroke="${shade(roofL, 0.6)}" stroke-width="${2 * s}" stroke-linecap="round"/>`;
  g += `<line x1="${fL[0]}" y1="${fL[1]}" x2="${fB[0]}" y2="${fB[1]}" stroke="${shade(roofL, 0.55)}" stroke-width="${1.2 * s}"/>`;
  if (SNOW) { // a blanket of snow on the upper half of the roof
    const a = mid(fL, fM1, 0.45), b = mid(fB, fM2, 0.45);
    g += `<polygon points="${pts([a, b, fM2, fM1])}" fill="#f4f7f8" opacity=".92"/><path d="M${a[0]} ${a[1]} Q${mid(a, b)[0]} ${mid(a, b)[1] + 3} ${b[0]} ${b[1]}" stroke="#ffffff" stroke-width="${1.6 * s}" fill="none"/>`;
  }
  return g;
}
function door(cx, cy, s, h = 18) {
  const { L, B } = frame(cx, cy, s, h);
  const p = mid(L, B, 0.56), w = 7 * s, dh = Math.min(h * 0.62, 13 * s), d = [w, w * 0.5];
  const q = [p[0] + d[0], p[1] + d[1]];
  return `<polygon points="${pts([[p[0] - 1.2, p[1] + 1], [q[0] + 1.2, q[1] + 1.6], [q[0] + 1.2, q[1] - dh - 1.4], [p[0] - 1.2, p[1] - dh - 2]])}" fill="#4a2f1c"/>` +
    `<polygon points="${pts([p, q, [q[0], q[1] - dh], [p[0], p[1] - dh]])}" fill="#7a4a2a"/>` +
    `<line x1="${mid(p, q)[0]}" y1="${mid(p, q)[1]}" x2="${mid(p, q)[0]}" y2="${mid(p, q)[1] - dh}" stroke="#5a3620" stroke-width=".7"/>` +
    `<circle cx="${q[0] - 1.6}" cy="${q[1] - dh * 0.45}" r=".9" fill="#e2b640"/>` +
    `<polygon points="${pts([[p[0] - 2, p[1] + 1], [q[0] + 2, q[1] + 2], [q[0] + 4, q[1] + 4], [p[0], p[1] + 3]])}" fill="#b8b0a2"/>`;
}
function windowAt(p0, p1, y, s, glow = true) {
  // a framed window on a wall going from p0 to p1, sitting y above the ground
  const w = 6.5 * s, h = 6 * s, dx = (p1[0] - p0[0]), dy = (p1[1] - p0[1]), len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const a = [p0[0], p0[1] - y], b = [a[0] + ux * w, a[1] + uy * w], c = [b[0], b[1] - h], d = [a[0], a[1] - h];
  const m1 = mid(a, b), m2 = mid(d, c), n1 = mid(a, d), n2 = mid(b, c);
  return `<polygon points="${pts([[a[0] - 1, a[1] + 1], [b[0] + 1, b[1] + 1], [c[0] + 1, c[1] - 1], [d[0] - 1, d[1] - 1]])}" fill="#f4efe4"/>` +
    `<polygon points="${pts([a, b, c, d])}" fill="${glow ? '#f6d27a' : '#9ec7e0'}"/>` +
    `<path d="M${m1[0]} ${m1[1]} L${m2[0]} ${m2[1]} M${n1[0]} ${n1[1]} L${n2[0]} ${n2[1]}" stroke="#f4efe4" stroke-width=".9"/>` +
    `<polygon points="${pts([[a[0] - 1.5, a[1] + 1.5], [b[0] + 1.5, b[1] + 1.5], [b[0] + 1.5, b[1] + 3], [a[0] - 1.5, a[1] + 3]])}" fill="#7a5236"/>`;
}
function window2(cx, cy, s, h) {
  const { L, B, R } = frame(cx, cy, s, h);
  return windowAt(mid(B, R, 0.35), R, h * 0.38, s) + windowAt(mid(L, B, 0.12), B, h * 0.38, s);
}
function chimney(cx, cy, s, h, roofH, color = '#8a5a3a') {
  const { T, R } = frame(cx, cy, s, h);
  const base = lift(mid(T, R, 0.55), h + roofH * 0.9 * s);
  const w = 5 * s;
  return `<rect x="${base[0] - w / 2}" y="${base[1] - 10 * s}" width="${w}" height="${12 * s}" fill="${color}" stroke="rgba(40,20,10,.35)" stroke-width=".6"/><rect x="${base[0] - w / 2 - 1}" y="${base[1] - 11 * s}" width="${w + 2}" height="${2.2 * s}" fill="${shade(color, 0.7)}"/>`;
}
function flowers(x, y, k = 1) {
  return `<rect x="${x - 6 * k}" y="${y}" width="${12 * k}" height="${3 * k}" fill="#7a5236"/>` +
    [0, 1, 2, 3].map((i) => `<circle cx="${x - 4.5 * k + i * 3 * k}" cy="${y - 0.5}" r="${1.4 * k}" fill="${['#e86a8a', '#f4e35c', '#ffffff', '#b48ae8'][i]}"/>`).join('');
}
function fence(x0, y0, x1, y1, n = 5) {
  let f = `<line x1="${x0}" y1="${y0 - 4}" x2="${x1}" y2="${y1 - 4}" stroke="#a07a50" stroke-width="1.2"/><line x1="${x0}" y1="${y0 - 1.5}" x2="${x1}" y2="${y1 - 1.5}" stroke="#a07a50" stroke-width="1.2"/>`;
  for (let i = 0; i <= n; i++) { const p = mid([x0, y0], [x1, y1], i / n); f += `<rect x="${p[0] - .8}" y="${p[1] - 7}" width="1.6" height="7" fill="#8a6440"/>`; }
  return f;
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
function awning(x, y) {
  let a = '';
  for (let k = 0; k < 5; k++) a += `<path d="M${x + k * 5} ${y + k * 2.5} l5 2.5 l0 6 l-5 -2.5 z" fill="${k % 2 ? '#fff' : '#c4473a'}" stroke="rgba(0,0,0,.15)" stroke-width=".4"/>`;
  return a;
}

function sign(x, y, icon, bg = '#efe4cf') {
  const I = {
    anvil: `<path d="M${x - 6} ${y - 1} h12 l-2 3 h-3 v3 h3 v2 h-10 v-2 h3 v-3 h-3 z" fill="#3a3a40"/><rect x="${x - 7}" y="${y - 3}" width="14" height="2.5" fill="#3a3a40"/>`,
    saw: `<path d="M${x - 7} ${y + 3} L${x + 5} ${y - 4} L${x + 7} ${y - 1} L${x - 5} ${y + 6} Z" fill="#9aa0a8"/><rect x="${x + 4}" y="${y - 6}" width="4" height="5" fill="#8a5a3a" transform="rotate(-30 ${x + 6} ${y - 3})"/>`,
    bread: `<ellipse cx="${x}" cy="${y + 1}" rx="7" ry="4.5" fill="#d9963e"/><path d="M${x - 4} ${y - 1} l2 3 M${x} ${y - 2} l2 3 M${x + 3} ${y - 1} l2 3" stroke="#a8641e" stroke-width="1"/>`,
    axe: `<rect x="${x - .8}" y="${y - 6}" width="1.6" height="13" fill="#7a5236"/><path d="M${x} ${y - 6} q7 1 6 7 q-4 -2 -6 -1 z" fill="#9aa0a8"/>`,
    mug: `<rect x="${x - 5}" y="${y - 5}" width="8" height="10" rx="1.5" fill="#e2b640"/><rect x="${x - 5}" y="${y - 6}" width="8" height="3" rx="1.5" fill="#fff"/><path d="M${x + 3} ${y - 3} q4 0 4 3 q0 3 -4 3" stroke="#e2b640" stroke-width="1.6" fill="none"/>`,
    coin: `<circle cx="${x}" cy="${y}" r="5.5" fill="#e2b640" stroke="#a07a20"/><text x="${x}" y="${y + 2.6}" font-size="7" text-anchor="middle" fill="#8a5a10" font-weight="bold">E</text>`,
    coat: `<path d="M${x - 3} ${y - 6} L${x - 7} ${y - 3} L${x - 6} ${y + 6} L${x + 6} ${y + 6} L${x + 7} ${y - 3} L${x + 3} ${y - 6} L${x} ${y - 3} Z" fill="#3a6ea8"/><path d="M${x} ${y - 3} V${y + 6}" stroke="#f4efe4" stroke-width=".8"/><circle cx="${x + 1.5}" cy="${y}" r=".7" fill="#e2b640"/><circle cx="${x + 1.5}" cy="${y + 3}" r=".7" fill="#e2b640"/>`,
    wheat: `<path d="M${x} ${y + 6} V${y - 5}" stroke="#a8841e" stroke-width="1.2"/><ellipse cx="${x - 2}" cy="${y - 2}" rx="1.6" ry="3" fill="#e8c83c"/><ellipse cx="${x + 2}" cy="${y - 3}" rx="1.6" ry="3" fill="#e8c83c"/><ellipse cx="${x}" cy="${y - 6}" rx="1.6" ry="3" fill="#e8c83c"/>`,
  }[icon] || '';
  return `<g><rect x="${x - 1}" y="${y - 24}" width="2" height="30" fill="#5a3a22"/><rect x="${x - 1}" y="${y - 24}" width="14" height="2" fill="#5a3a22"/>` +
    `<g transform="translate(9 -10)"><rect x="${x - 9}" y="${y - 9}" width="18" height="16" rx="3" fill="${bg}" stroke="#7a5236" stroke-width="1.2"/>${I}</g></g>`;
}

const shadow = (cx, cy, w = 26) => `<ellipse cx="${cx + 4}" cy="${cy + 4}" rx="${w}" ry="${w / 2.4}" fill="rgba(40,60,20,.22)"/>`;

function plotArt(id, cx, cy, v) {
  const p = (v.plots || {})[id] || {};
  const d = diamond(cx, cy, BT * 0.46, BH * 0.46);
  if (p.built) {
    const colors = ['#3a6ea8', '#7a3b8a', '#2f7a3a', '#b5501e'];
    const flag = p.mine ? '#d9622b' : colors[id.length % 4];
    return shadow(cx, cy, 20) + house(cx, cy, 0.78, 16, '#f3e3c3', '#d8c29a', '#4a6a9a', '#3a5680', 12) + door(cx, cy, 0.78) + window2(cx, cy, 0.78, 16) +
      `<rect x="${cx + 12}" y="${cy - 40}" width="1.6" height="18" fill="#5a3a22"/><polygon points="${cx + 13.6},${cy - 40} ${cx + 24},${cy - 36} ${cx + 13.6},${cy - 32}" fill="${flag}"/>`;
  }
  let a = `<polygon points="${pts(d)}" fill="${p.owner ? '#c9a46a' : 'rgba(255,255,255,.28)'}" stroke="#7a6a58" stroke-dasharray="${p.owner ? '0' : '4 3'}"/>`;
  if (p.mine) a += `<rect x="${cx + 10}" y="${cy - 34}" width="1.6" height="30" fill="#5a3a22"/><polygon points="${cx + 11.6},${cy - 34} ${cx + 24},${cy - 29} ${cx + 11.6},${cy - 24}" fill="#d9622b"/>`;
  if (p.owner) { // a sold plot: a little fence and a pile of lumber
    for (let k = 0; k < 4; k++) a += `<rect x="${d[3][0] + k * 7}" y="${d[3][1] - 6 + k * 3.5}" width="1.6" height="7" fill="#7a5236"/>`;
    a += `<rect x="${cx - 4}" y="${cy - 2}" width="12" height="3" fill="#d8b98a" stroke="#9a7a5a" stroke-width=".5"/><rect x="${cx - 2}" y="${cy - 5}" width="12" height="3" fill="#d8b98a" stroke="#9a7a5a" stroke-width=".5"/>`;
  } else { // for sale
    a += `<rect x="${cx - 1}" y="${cy - 20}" width="2" height="20" fill="#7a5236"/><rect x="${cx - 11}" y="${cy - 26}" width="22" height="10" rx="2" fill="#efe4cf" stroke="#9a7a5a"/>` +
      `<text x="${cx}" y="${cy - 18.5}" font-size="6.5" text-anchor="middle" fill="#8a3b12" font-weight="bold">${v.land ? v.land.price : ''}</text>`;
  }
  return a;
}

// a stone watchtower: brick walls, an arrow slit, a wooden lookout with a pointed roof and a banner
function watchtower(cx, cy, main = false) {
  const hw = 13, hh = 6.5, h = main ? 50 : 42;
  const [, r, b, l] = diamond(cx, cy, hw, hh);
  const up = (p, d = h) => [p[0], p[1] - d];
  let t = shadow(cx, cy, 18) + poly([l, b, up(b), up(l)], '#a39a8c') + poly([b, r, up(r), up(b)], '#857c70');
  for (let k = 1; k < 6; k++) { // brick courses
    const y = h * k / 6;
    t += `<path d="M${l[0]} ${l[1] - y} L${b[0]} ${b[1] - y} L${r[0]} ${r[1] - y}" stroke="rgba(60,50,40,.28)" stroke-width=".7" fill="none"/>`;
  }
  t += `<rect x="${cx - 7}" y="${cy - h * 0.55}" width="3" height="9" rx="1.4" fill="#2e2822"/><rect x="${cx + 5}" y="${cy - h * 0.5}" width="3" height="8" rx="1.4" fill="#2e2822"/>`;
  // door at the foot
  t += `<path d="M${cx - 6} ${cy + 3} v-9 q3 -4 6 0 v11 z" fill="#5a3a22"/>`;
  // wooden lookout: a wider platform with railings and corner posts
  const top = diamond(cx, cy - h, hw + 5, hh + 2.5), [tT, tR, tB, tL] = top;
  t += poly(top, '#7a5236');
  t += `<path d="M${tL[0]} ${tL[1]} L${tB[0]} ${tB[1]} L${tR[0]} ${tR[1]}" stroke="#5a3a22" stroke-width="2.2" fill="none"/>`;
  for (const q of [tL, tB, tR]) t += `<rect x="${q[0] - 1}" y="${q[1] - 12}" width="2" height="12" fill="#5a3a22"/>`;
  t += `<path d="M${tL[0]} ${tL[1] - 6} L${tB[0]} ${tB[1] - 6} L${tR[0]} ${tR[1] - 6}" stroke="#8a6040" stroke-width="1.6" fill="none"/>`;
  // a guard on the lookout
  t += `<circle cx="${cx + 2}" cy="${cy - h - 9}" r="2.6" fill="#f0c8a0"/><rect x="${cx}" y="${cy - h - 7}" width="4.4" height="6" rx="1" fill="#4a5a8a"/><line x1="${cx + 6}" y1="${cy - h - 1}" x2="${cx + 7}" y2="${cy - h - 17}" stroke="#9aa0a8" stroke-width="1"/>`;
  // pointed roof
  const apex = [cx, cy - h - 34];
  t += poly([[tL[0] - 2, tL[1] - 12], [tB[0], tB[1] - 10], apex], '#a04a34') + poly([[tB[0], tB[1] - 10], [tR[0] + 2, tR[1] - 12], apex], '#83392a');
  t += `<rect x="${cx - .8}" y="${apex[1] - 14}" width="1.6" height="14" fill="#4a3a2a"/><polygon points="${cx + .8},${apex[1] - 14} ${cx + 13},${apex[1] - 10} ${cx + .8},${apex[1] - 6}" fill="${main ? '#d9622b' : '#e2b640'}"/>`;
  return t;
}

// an extra watchtower once the council builds it; before that, a ring of marked stones
function watchSlot(id, cx, cy, v) {
  if ((v.watchtowers || []).includes(id)) return watchtower(cx, cy);
  let a = '';
  for (let k = 0; k < 7; k++) { const t = k / 7 * Math.PI * 2; a += `<ellipse cx="${cx + Math.cos(t) * 13}" cy="${cy + Math.sin(t) * 6.5}" rx="3" ry="2" fill="#b8b0a2" opacity=".8"/>`; }
  return a;
}

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
    // a rocky hill with a timbered tunnel, rails, an ore cart and an ore pile
    const R = (p, f) => poly(p.map(([x, y]) => [cx + x, cy + y]), f);
    let m = shadow(cx, cy + 4, 50);
    m += R([[-56, 12], [-46, -14], [-30, -34], [-8, -48], [14, -44], [34, -30], [50, -10], [58, 12], [0, 32]], '#857a6c');
    m += R([[-8, -48], [14, -44], [34, -30], [50, -10], [58, 12], [20, 2], [6, -20]], '#9d9282');
    m += R([[-30, -34], [-8, -48], [6, -20], [-18, -10]], '#9a8f7f') + R([[-46, -14], [-30, -34], [-18, -10], [-38, 2]], '#776c5f');
    m += R([[22, -36], [30, -40], [36, -30], [28, -28]], '#b3a898') + R([[-26, -40], [-18, -44], [-14, -36], [-22, -34]], '#b3a898');
    m += `<circle cx="${cx + 30}" cy="${cy - 18}" r="2.4" fill="#d9783a"/><circle cx="${cx + 38}" cy="${cy - 8}" r="2" fill="#5aa0d8"/><circle cx="${cx - 34}" cy="${cy - 18}" r="2" fill="#d9783a"/>`;
    // tunnel and timber frame
    m += `<path d="M${cx - 20} ${cy + 16} L${cx - 20} ${cy - 4} Q${cx - 4} ${cy - 26} ${cx + 12} ${cy - 4} L${cx + 12} ${cy + 16} Z" fill="#231d18"/>`;
    m += `<rect x="${cx - 23}" y="${cy - 8}" width="5" height="25" fill="#7a5236"/><rect x="${cx + 10}" y="${cy - 8}" width="5" height="25" fill="#7a5236"/><rect x="${cx - 26}" y="${cy - 12}" width="44" height="6" rx="1" fill="#8a6040"/>`;
    m += `<rect x="${cx - 2}" y="${cy - 6}" width="5" height="6" rx="1" fill="#f6d27a" stroke="#4a3a2a" stroke-width=".8"/><circle cx="${cx + .5}" cy="${cy - 3}" r="7" fill="#ffd87a" opacity=".35"/>`;
    // rails coming out of the tunnel
    m += `<path d="M${cx - 12} ${cy + 16} L${cx - 26} ${cy + 34} M${cx + 4} ${cy + 16} L${cx - 8} ${cy + 36}" stroke="#5a5a60" stroke-width="1.6"/>`;
    for (let k = 0; k < 4; k++) m += `<rect x="${cx - 16 - k * 4}" y="${cy + 18 + k * 5}" width="20" height="2" fill="#7a5236" transform="rotate(-8 ${cx - 6 - k * 4} ${cy + 19 + k * 5})"/>`;
    // ore cart
    m += `<path d="M${cx - 30} ${cy + 22} L${cx - 10} ${cy + 22} L${cx - 13} ${cy + 32} L${cx - 27} ${cy + 32} Z" fill="#6b4a30" stroke="#3a2a1a" stroke-width=".8"/>` +
      `<circle cx="${cx - 26}" cy="${cy + 21}" r="3.5" fill="#c86a2e"/><circle cx="${cx - 20}" cy="${cy + 19}" r="4" fill="#9a8a7a"/><circle cx="${cx - 14}" cy="${cy + 21}" r="3.2" fill="#c86a2e"/><circle cx="${cx - 18}" cy="${cy + 20}" r="1.6" fill="#7ec0ee"/>` +
      `<circle cx="${cx - 25}" cy="${cy + 34}" r="2.4" fill="#2a2a2a"/><circle cx="${cx - 15}" cy="${cy + 34}" r="2.4" fill="#2a2a2a"/>`;
    // ore pile and a pickaxe leaning on it
    m += `<path d="M${cx + 18} ${cy + 26} Q${cx + 30} ${cy + 8} ${cx + 44} ${cy + 26} Z" fill="#8f8374"/>` +
      `<circle cx="${cx + 26}" cy="${cy + 20}" r="2.4" fill="#c86a2e"/><circle cx="${cx + 33}" cy="${cy + 16}" r="2.2" fill="#c86a2e"/><circle cx="${cx + 37}" cy="${cy + 22}" r="1.8" fill="#7ec0ee"/>` +
      `<line x1="${cx + 46}" y1="${cy + 28}" x2="${cx + 38}" y2="${cy + 6}" stroke="#7a5236" stroke-width="2"/><path d="M${cx + 32} ${cy + 8} Q${cx + 38} ${cy + 2} ${cx + 45} ${cy + 7}" stroke="#8a8a90" stroke-width="2.6" fill="none"/>`;
    return m;
  },
  dragonpeak(cx, cy, v) {
    // the mountains themselves are painted behind the island (see backdrop); here: a path
    // sign at the foot of the climb, and an invisible area covering the mountain for clicks
    const [px, py] = PEAK;
    const loc = (x, y) => [cx + (x - cx) / K, cy + (y - cy) / K]; // undo the building scale for map coordinates
    const hit = [[940, 270], [1010, 90], [1090, 4], [1180, 120], [1192, 290]].map(([x, y]) => loc(x, y));
    let m = `<polygon points="${pts(hit)}" fill="transparent"/>`;
    m += `<rect x="${cx - 1.5}" y="${cy - 22}" width="3" height="24" fill="#6b4a2e"/><polygon points="${cx - 12},${cy - 26} ${cx + 12},${cy - 26} ${cx + 14},${cy - 18} ${cx - 10},${cy - 16}" fill="#efe4cf" stroke="#7a5236"/>` +
      `<circle cx="${cx}" cy="${cy - 21}" r="3" fill="#b23a2e"/>`;
    for (const [dx, dy] of [[-22, 8], [18, 6], [8, 14], [-10, -6]]) m += `<ellipse cx="${cx + dx}" cy="${cy + dy}" rx="5" ry="3" fill="#a8a296"/>`;
    return m;
  },
  woodcutter(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#9a6b4a', '#7d5539', '#5e7a3a', '#4c6430') + door(cx, cy, 1) + window2(cx, cy, 1, 18) +
      `<g fill="#b07a4a" stroke="#7a5236" stroke-width=".6"><circle cx="${cx + 24}" cy="${cy + 6}" r="4"/><circle cx="${cx + 32}" cy="${cy + 2}" r="4"/><circle cx="${cx + 28}" cy="${cy - 4}" r="4"/></g>` +
      `<ellipse cx="${cx - 28}" cy="${cy + 8}" rx="7" ry="3.5" fill="#b07a4a" stroke="#7a5236"/><rect x="${cx - 35}" y="${cy + 3}" width="14" height="5" fill="#8a6a4a"/><ellipse cx="${cx - 28}" cy="${cy + 3}" rx="7" ry="3" fill="#d6a874"/>` +
      `<rect x="${cx - 29}" y="${cy - 9}" width="1.6" height="12" fill="#6b4a2e" transform="rotate(20 ${cx - 28} ${cy + 2})"/>` + sign(cx - 40, cy - 8, 'axe');
  },
  mill(cx, cy) {
    const hx = cx + 2, hy = cy - 44;
    return shadow(cx, cy) + house(cx, cy, 0.85, 26, '#e7d9bd', '#cdbb98', '#8c3a2a', '#6f2d20', 12) + door(cx, cy, 0.85) +
      `<g class="blades"><rect x="${hx - 1.5}" y="${hy - 26}" width="3" height="52" fill="#6b5a48"/><rect x="${hx - 26}" y="${hy - 1.5}" width="52" height="3" fill="#6b5a48"/>` +
      `<rect x="${hx + 2}" y="${hy - 26}" width="7" height="22" fill="#f4efe4"/><rect x="${hx - 9}" y="${hy + 4}" width="7" height="22" fill="#f4efe4"/><rect x="${hx + 4}" y="${hy + 2}" width="22" height="7" fill="#f4efe4"/><rect x="${hx - 26}" y="${hy - 9}" width="22" height="7" fill="#f4efe4"/></g>` +
      `<circle cx="${hx}" cy="${hy}" r="3" fill="#4a3a2a"/>` + sign(cx - 34, cy - 4, 'wheat') + `<rect x="${cx + 18}" y="${cy + 2}" width="9" height="7" rx="2" fill="#e8d8b4" stroke="#a08a6a"/><rect x="${cx + 26}" y="${cy + 4}" width="9" height="7" rx="2" fill="#e8d8b4" stroke="#a08a6a"/>`;
  },
  smithy(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#a89888', '#8a7a6a', '#55606e', '#434c58') + door(cx, cy, 1) +
      `<rect x="${cx + 10}" y="${cy - 44}" width="8" height="18" fill="#4a4038"/>` + smoke(cx + 14, cy - 48, false) +
      `<path d="M${cx - 34} ${cy + 4} h14 l-3 3 h-3 v4 h4 v3 h-12 v-3 h4 v-4 h-3 z" fill="#3a3a40"/>` +
      `<rect x="${cx + 18}" y="${cy - 6}" width="12" height="10" fill="#4a4038"/><rect x="${cx + 20}" y="${cy - 3}" width="8" height="5" fill="#ff8a3a"/><circle class="forge" cx="${cx + 24}" cy="${cy}" r="8" fill="#ff9a4a" opacity=".35"/>` +
      sign(cx - 40, cy - 12, 'anvil', '#dcd6cc');
  },
  carpenter(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#c49a6c', '#a57e54', '#a04a34', '#83392a') + door(cx, cy, 1) + window2(cx, cy, 1, 18) +
      `<g fill="#d8b98a" stroke="#9a7a5a" stroke-width=".6"><rect x="${cx + 20}" y="${cy + 2}" width="18" height="3"/><rect x="${cx + 20}" y="${cy - 2}" width="18" height="3"/><rect x="${cx + 20}" y="${cy - 6}" width="18" height="3"/></g>` +
      `<g stroke="#7a5236" stroke-width="1.6"><line x1="${cx - 36}" y1="${cy + 12}" x2="${cx - 32}" y2="${cy + 2}"/><line x1="${cx - 28}" y1="${cy + 12}" x2="${cx - 32}" y2="${cy + 2}"/><line x1="${cx - 20}" y1="${cy + 14}" x2="${cx - 16}" y2="${cy + 4}"/><line x1="${cx - 12}" y1="${cy + 14}" x2="${cx - 16}" y2="${cy + 4}"/></g>` +
      `<rect x="${cx - 38}" y="${cy}" width="26" height="3.5" fill="#e3c28e" stroke="#9a7a5a" stroke-width=".6" transform="rotate(10 ${cx - 25} ${cy + 2})"/>` + sign(cx - 44, cy - 14, 'saw');
  },
  bakery(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 1, 18, '#f0dcb4', '#d4bc8e', '#c4473a', '#a33a2f') + door(cx, cy, 1) + window2(cx, cy, 1, 18) +
      `<rect x="${cx + 8}" y="${cy - 42}" width="7" height="14" fill="#8a5a3a"/>` + smoke(cx + 11, cy - 46, false) +
      `<path d="M${cx + 18} ${cy + 10} q0 -16 12 -16 q12 0 12 16 z" fill="#c9b49a" stroke="#8a7a6a"/><path d="M${cx + 25} ${cy + 10} q0 -7 5 -7 q5 0 5 7 z" fill="#2a1f18"/><circle cx="${cx + 30}" cy="${cy + 7}" r="2.4" fill="#ff8a3a"/>` +
      awning(cx - 28, cy - 2) + sign(cx - 44, cy - 16, 'bread', '#fff3d6');
  },
  inn(cx, cy) {
    return shadow(cx, cy, 32) + house(cx, cy, 1.15, 26, '#e3c79c', '#c6a97c', '#7a3b2a', '#62301f', 18) + door(cx, cy, 1.15) + window2(cx, cy, 1.15, 26) +
      sign(cx + 26, cy - 6, 'mug', '#7a3b2a') + `<rect x="${cx - 36}" y="${cy + 4}" width="12" height="8" fill="#8a6a4a"/><rect x="${cx - 34}" y="${cy + 1}" width="3" height="4" fill="#e2b640"/><rect x="${cx - 29}" y="${cy + 1}" width="3" height="4" fill="#e2b640"/>`;
  },
  tower(cx, cy) { return watchtower(cx, cy, true); },
  tailor(cx, cy) {
    // a narrow two-storey shop with a blue roof, a big display window, a coat on a stand and bolts of cloth
    const f = frame(cx, cy, 0.95, 24);
    let s = shadow(cx, cy, 24) + chimney(cx, cy, 0.95, 24, 14, '#7a6a5a') + house(cx, cy, 0.95, 24, '#e9d8c2', '#cdb99c', '#3f5f8f', '#334d76', 14) + door(cx, cy, 0.95, 24);
    s += windowAt(mid(f.B, f.R, 0.18), f.R, 6, 1.35, true) + windowAt(mid(f.B, f.R, 0.4), f.R, 24 * 0.74, 0.95);
    s += windowAt(mid(f.L, f.B, 0.1), f.B, 24 * 0.74, 0.95);
    // coat stand outside
    const p = [f.R[0] + 6, f.R[1] + 8];
    s += `<line x1="${p[0]}" y1="${p[1]}" x2="${p[0]}" y2="${p[1] - 20}" stroke="#5a3a22" stroke-width="1.4"/><path d="M${p[0] - 4} ${p[1] - 18} L${p[0] - 7} ${p[1] - 14} L${p[0] - 6} ${p[1] - 5} L${p[0] + 6} ${p[1] - 5} L${p[0] + 7} ${p[1] - 14} L${p[0] + 4} ${p[1] - 18} L${p[0]} ${p[1] - 15} Z" fill="#b5501e"/>`;
    // bolts of cloth
    s += `<g stroke="rgba(0,0,0,.2)" stroke-width=".5"><ellipse cx="${f.L[0] - 2}" cy="${f.L[1] + 6}" rx="5" ry="3" fill="#7a3b8a"/><ellipse cx="${f.L[0] + 7}" cy="${f.L[1] + 9}" rx="5" ry="3" fill="#2f7a3a"/><ellipse cx="${f.L[0] + 2}" cy="${f.L[1] + 3}" rx="5" ry="3" fill="#e2b640"/></g>`;
    return s + sign(cx - 40, cy - 12, 'coat', '#eef3fa');
  },
  pasture(cx, cy, v) {
    // a green meadow with a wooden fence, a shed and sheep
    const snow = v.events.winter;
    const d = diamond(cx, cy, BT * 0.95, BH * 0.95), [T, R, B, L] = d;
    let s = poly(d, snow ? '#d9e4d4' : '#9fd46a');
    const inner = diamond(cx, cy, BT * 0.88, BH * 0.88);
    s += fence(inner[0][0], inner[0][1], inner[3][0], inner[3][1], 6) + fence(inner[0][0], inner[0][1], inner[1][0], inner[1][1], 6);
    // little shed
    s += house(cx + 22, cy - 12, 0.5, 11, '#c9a46a', '#a8854e', '#8a5a3a', '#6b4528', 8);
    // sheep (deterministic spots)
    const sheep = [[-30, 2], [-12, -8], [4, 8], [-20, 14], [18, 12], [-2, -2]];
    for (const [dx, dy] of sheep.sort((a, b) => a[1] - b[1])) {
      const x = cx + dx, y = cy + dy;
      s += `<ellipse cx="${x + 1}" cy="${y + 4}" rx="6" ry="2" fill="rgba(40,60,20,.2)"/><rect x="${x - 3}" y="${y}" width="1.4" height="4" fill="#3a3a3a"/><rect x="${x + 2}" y="${y}" width="1.4" height="4" fill="#3a3a3a"/>` +
        `<ellipse cx="${x}" cy="${y - 1}" rx="6" ry="4.2" fill="#fbfaf6" stroke="#d8d2c4" stroke-width=".6"/><circle cx="${x - 3}" cy="${y - 3}" r="2.4" fill="#fbfaf6"/><circle cx="${x + 2}" cy="${y - 4}" r="2.6" fill="#fbfaf6"/>` +
        `<ellipse cx="${x + 6}" cy="${y - 2}" rx="2.4" ry="2" fill="#3a3a3a"/>`;
    }
    // hay bales
    s += `<ellipse cx="${B[0] - 14}" cy="${B[1] - 10}" rx="5" ry="3.4" fill="#e3c26a" stroke="#b8963e"/><ellipse cx="${B[0] - 4}" cy="${B[1] - 7}" rx="5" ry="3.4" fill="#e3c26a" stroke="#b8963e"/>`;
    return s;
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
    // a white hall with a columned porch, steps, a bell and the village banner
    const sc = 1.1, h = 24;
    let s = shadow(cx, cy, 32) + house(cx, cy, sc, h, '#eee8dc', '#d4ccba', '#4f6286', '#3e4e6c', 14);
    const { L, B } = frame(cx, cy, sc, h);
    s += `<polygon points="${pts([mid(L, B, 0.05), mid(L, B, 0.95), [mid(L, B, 0.95)[0] + 3, mid(L, B, 0.95)[1] + 4], [mid(L, B, 0.05)[0] + 3, mid(L, B, 0.05)[1] + 4]])}" fill="#c9c1b2"/>`;
    for (let k = 0; k < 4; k++) {
      const p = mid(L, B, 0.14 + k * 0.24);
      s += `<rect x="${p[0] - 1.8}" y="${p[1] - h + 2}" width="3.6" height="${h - 2}" fill="#fbf8f2" stroke="#b8b0a0" stroke-width=".5"/><rect x="${p[0] - 2.6}" y="${p[1] - h}" width="5.2" height="2" fill="#e4ddcf"/>`;
    }
    s += door(cx, cy, sc, h) + `<path d="M${cx + 30} ${cy - 2} V${cy - 50}" stroke="#5a4a38" stroke-width="1.8"/><path d="M${cx + 31} ${cy - 50} l14 4 l-14 4 z" fill="#3a7fc0"/><circle cx="${cx + 38}" cy="${cy - 46}" r="1.6" fill="#e2b640"/>`;
    return s;
  },
  treasury(cx, cy) {
    return shadow(cx, cy) + house(cx, cy, 0.9, 18, '#b8b0a2', '#9c9486', '#6b645a', '#57514a', 10) +
      `<circle cx="${cx - 12}" cy="${cy - 10}" r="5" fill="#e2b640" stroke="#a07a20"/>` + sign(cx - 34, cy - 6, 'coin', '#fff6d6');
  },
  'house-1'(cx, cy) {
    return shadow(cx, cy, 20) + chimney(cx, cy, 0.78, 15, 10, '#9a6a4a') + house(cx, cy, 0.78, 15, '#ead6ae', '#cdb287', '#c4473a', '#a33a2f', 10) + door(cx, cy, 0.78, 15) +
      windowAt(...(() => { const f = frame(cx, cy, 0.78, 15); return [mid(f.B, f.R, 0.3), f.R]; })(), 6, 0.78) + smoke(cx + 8, cy - 40, false);
  },
  'house-2'(cx, cy) {
    const f = frame(cx, cy, 0.92, 19);
    return shadow(cx, cy, 24) + chimney(cx, cy, 0.92, 19, 14, '#8a5a3a') + house(cx, cy, 0.92, 19, '#f1dcb2', '#d2b88a', '#8c3a2a', '#6f2d20', 14) + door(cx, cy, 0.92, 19) + window2(cx, cy, 0.92, 19) +
      flowers(mid(f.B, f.R, 0.55)[0] + 2, mid(f.B, f.R, 0.55)[1] - 6, 0.7) + fence(f.B[0] + 6, f.B[1] + 6, f.R[0] + 6, f.R[1] + 6, 4);
  },
  'house-3'(cx, cy) {
    const f = frame(cx, cy, 1.12, 24);
    return shadow(cx, cy, 30) + chimney(cx, cy, 1.12, 24, 16, '#7a5a4a') + house(cx, cy, 1.12, 24, '#f4e3c0', '#d8c29a', '#4f7a3a', '#3f6430', 16) + door(cx, cy, 1.12, 24) + window2(cx, cy, 1.12, 24) +
      windowAt(mid(f.B, f.R, 0.35), f.R, 24 * 0.78, 1.12) + windowAt(mid(f.L, f.B, 0.12), f.B, 24 * 0.78, 1.12) +
      flowers(mid(f.L, f.B, 0.25)[0], mid(f.L, f.B, 0.25)[1] - 7, 0.8) + tree(f.R[0] + 10, f.R[1] - 2, 0.6);
  },
  gate(cx, cy) {
    return `<rect x="${cx - 22}" y="${cy - 34}" width="7" height="36" fill="#7a6450"/><rect x="${cx + 15}" y="${cy - 34}" width="7" height="36" fill="#7a6450"/>` +
      `<rect x="${cx - 26}" y="${cy - 40}" width="52" height="8" fill="#5e4a38"/><circle cx="${cx - 18}" cy="${cy - 44}" r="3" fill="#e5803a"/><circle cx="${cx + 18}" cy="${cy - 44}" r="3" fill="#e5803a"/>`;
  },
  // building land: for sale, sold (fenced), or a home with its owner's flag
  'plot-1'(cx, cy, v) { return plotArt('plot-1', cx, cy, v); },
  'plot-2'(cx, cy, v) { return plotArt('plot-2', cx, cy, v); },
  'plot-3'(cx, cy, v) { return plotArt('plot-3', cx, cy, v); },
  'plot-4'(cx, cy, v) { return plotArt('plot-4', cx, cy, v); },
  'watch-1'(cx, cy, v) { return watchSlot('watch-1', cx, cy, v); },
  'watch-2'(cx, cy, v) { return watchSlot('watch-2', cx, cy, v); },
  'watch-3'(cx, cy, v) { return watchSlot('watch-3', cx, cy, v); },
  expansion(cx, cy) {
    return `<polygon points="${pts(diamond(cx, cy, BT * 0.95, BH * 0.95))}" fill="rgba(255,255,255,.25)" stroke="#7a6a58" stroke-dasharray="5 4"/>` +
      `<rect x="${cx - 2}" y="${cy - 24}" width="3" height="22" fill="#7a5236"/><rect x="${cx - 16}" y="${cy - 30}" width="32" height="12" rx="2" fill="#efe4cf" stroke="#9a7a5a"/>`;
  },
};

// ---------- the walkable grid ----------

export const ROAD = new Set();
for (let j = 7; j <= 12; j++) ROAD.add(`5,${j}`);   // main street down to the gate
for (let i = 0; i <= 13; i++) ROAD.add(`${i},4`);   // the long road across the village
for (let j = 5; j <= 8; j++) ROAD.add(`7,${j}`);
for (let i = 6; i <= 11; i++) ROAD.add(`${i},12`);  // the new lane to the southern homes
for (let j = 5; j <= 6; j++) ROAD.add(`11,${j}`);   // a path to the eastern plot
for (let j = 9; j <= 11; j++) ROAD.add(`2,${j}`);   // a path past the mill to the western plot
const WATER = new Set(['8,7', '9,7', '8,8']);

let blocked = null, entrances = {}, workCells = {};
const OPEN_AREAS = new Set(['gate', 'fields', 'forest', 'pasture', 'watch-1', 'watch-2', 'watch-3']); // people can walk inside these
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
  const k = look.scale || 1;
  let tag = '';
  // real players get a name pill: orange for you, blue for other players. Bots have none.
  if (look.name && (look.you || look.other)) {
    const w = look.name.length * 6.6 + 14;
    tag = `<g pointer-events="none"><rect x="${x - w / 2}" y="${y - 58 * k}" width="${w}" height="16" rx="8" fill="${look.you ? '#d9622b' : '#3a6ea8'}" stroke="#fffaf2" stroke-width="1.5"/>` +
      `<text x="${x}" y="${y - 46.5 * k}" text-anchor="middle" font-size="11" font-weight="bold" fill="#fff">${look.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></g>`;
  }
  return `<g class="${look.bot ? 'bot' : 'ppl'}" transform="translate(${x} ${y}) scale(${k}) translate(${-x} ${-y})">${personInner(x, y, look, t)}</g>` + tag;
}
function personInner(x, y, look, t) {
  const bob = Math.sin(t * 10) * (look.moving ? 1.2 : 0);
  const step = look.moving ? Math.sin(t * 10) * 2 : 0;
  let s = `<ellipse cx="${x}" cy="${y}" rx="7" ry="3" fill="rgba(0,0,0,.22)"/>`;
  if (look.you || look.other) s += `<ellipse cx="${x}" cy="${y}" rx="11" ry="5" fill="none" stroke="${look.you ? '#d9622b' : '#3a6ea8'}" stroke-width="2"/>`;
  s += `<rect x="${x - 4 + step / 2}" y="${y - 8}" width="3" height="8" fill="#4a3a2a"/><rect x="${x + 1 - step / 2}" y="${y - 8}" width="3" height="8" fill="#4a3a2a"/>`;
  s += `<rect x="${x - 6}" y="${y - 20 + bob}" width="12" height="13" rx="4" fill="${look.color}"/>`;
  s += `<circle cx="${x}" cy="${y - 25 + bob}" r="5.5" fill="${look.skin || '#f0c8a0'}"/>`;
  s += `<path d="M${x - 5.5} ${y - 26 + bob} Q${x} ${y - 33 + bob} ${x + 5.5} ${y - 26 + bob} Z" fill="${look.hair || '#5a3a22'}"/>`;
  if (look.beard) s += `<path d="M${x - 4} ${y - 23 + bob} Q${x} ${y - 16 + bob} ${x + 4} ${y - 23 + bob} Z" fill="#e8e2d6"/>`;
  if (look.carry) s += `<rect x="${x + 5}" y="${y - 17 + bob}" width="7" height="7" rx="1.5" fill="${look.carry}" stroke="rgba(0,0,0,.3)" stroke-width=".6"/>`;
  if (look.work != null) s += `<rect x="${x - 14}" y="${y - 46 + bob}" width="28" height="5" rx="2.5" fill="rgba(0,0,0,.25)"/><rect x="${x - 14}" y="${y - 46 + bob}" width="${28 * look.work}" height="5" rx="2.5" fill="#e2b640"/>` +
    `<g transform="rotate(${Math.sin(t * 14) * 35} ${x + 7} ${y - 16})"><rect x="${x + 6}" y="${y - 30}" width="2" height="14" fill="#6b4a2e"/><rect x="${x + 3}" y="${y - 31}" width="9" height="4" fill="#8a8a90"/></g>`;
  return s;
}

// ---------- drawing the map ----------

export function setupMap(svg) {
  // a little wider than the island, so Dragon peak fits on the right
  svg.setAttribute('viewBox', `-40 -10 ${VW + 120} ${VH + 10}`);
  svg.innerHTML = `<defs><linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c7e3a8" stop-opacity="0"/><stop offset="1" stop-color="#b9dc93" stop-opacity=".9"/></linearGradient><radialGradient id="ember"><stop offset="0" stop-color="#ff5a1e" stop-opacity=".8"/><stop offset="1" stop-color="#ff5a1e" stop-opacity="0"/></radialGradient></defs><g id="ground"></g><g id="marker"></g><g id="walkers"></g><g id="labels"></g><g id="fx" pointer-events="none"></g><rect id="night" x="-3000" y="-3000" width="8000" height="8000" fill="#1a2240" opacity="0" pointer-events="none"/>`;
}

function centerOf(b) {
  return cellCenter(b.i + (b.w - 1) / 2, b.j + (b.w - 1) / 2);
}

// small deterministic noise so the ground looks hand-painted but never flickers
const hash = (i, j, k = 0) => { let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const corner = (i, j) => [OX + (i - j) * TW / 2, OY + (i + j) * TH / 2];
const LAMPS = [[4, 4], [8, 4], [5, 8], [7, 6], [1, 4], [11, 4], [5, 11], [9, 12], [13, 4]];
export const PEAK = [1090, 4]; // the top of Dragon peak, behind the island's far right corner

// Dragon peak and its range, far behind the village
function backdrop(view) {
  const active = view.events.dragon > 0 || view.events.attackDay;
  const winter = view.events.winter;
  let s = '<g transform="translate(80 -36)">';
  // distant blue ridge
  s += `<path d="M640 230 L720 160 L780 196 L850 120 L905 170 L960 110 L1112 200 L1112 330 L640 330 Z" fill="${winter ? '#c9d3dc' : '#9fb6c4'}" opacity=".7"/>`;
  // side peak
  s += `<path d="M840 320 L905 170 L940 210 L990 300 Z" fill="#9a8c80"/><path d="M905 170 L940 210 L990 300 L930 300 Z" fill="#887a6e"/>`;
  s += `<path d="M905 170 L918 186 L912 196 L900 188 L894 194 Z" fill="#efe9df"/>`;
  // Dragon peak
  s += `<path d="M880 330 L960 150 L1010 40 L1050 110 L1080 170 L1112 240 L1112 330 Z" fill="#8d7d70"/>`;
  s += `<path d="M1010 40 L1050 110 L1080 170 L1112 240 L1112 330 L1030 330 L1020 200 Z" fill="#76675b"/>`;
  s += `<path d="M960 150 L1010 40 L1030 70 L1012 92 L998 84 L986 110 L972 112 Z" fill="#f3eee6"/><path d="M1010 40 L1050 110 L1036 112 L1028 92 L1030 70 Z" fill="#dcd5ca"/>`;
  s += `<path d="M930 260 L975 200 M1000 230 L1040 180 M950 300 L990 250" stroke="#5e5148" stroke-width="2" opacity=".5" fill="none"/>`;
  // the lair: a cave that glows when the dragon wakes
  s += `<path d="M1000 175 Q1012 158 1026 175 L1024 186 L1002 186 Z" fill="#241c18"/>`;
  if (active) {
    s += `<circle class="lairglow" cx="1013" cy="180" r="16" fill="#ff7a2a" opacity=".55"/><circle cx="1008" cy="179" r="1.8" fill="#ffd23a"/><circle cx="1018" cy="179" r="1.8" fill="#ffd23a"/>`;
    for (let k = 0; k < 3; k++) s += `<circle class="smoke" style="animation-delay:${k * 0.9}s" cx="${1008 + k * 5}" cy="${30 - k * 8}" r="${10 - k * 2}" fill="#b9b1a5"/>`;
    s += `<path class="dragonfly" d="M960 70 q10 -10 20 0 q4 -6 8 0 q10 -10 20 0 q-12 2 -24 8 q-12 -6 -24 -8z" fill="#3a2a2a"/>`;
  }
  // as the attack comes closer the mountain slowly turns red, glowing from below
  const th = view.threat || 0;
  if (th > 0) {
    s += `<path d="M880 330 L960 150 L1010 40 L1050 110 L1080 170 L1112 240 L1112 330 Z" fill="#c0301e" opacity="${(0.12 + th * 0.5).toFixed(2)}" style="mix-blend-mode:multiply"/>`;
    s += `<path d="M840 320 L905 170 L940 210 L990 300 Z" fill="#c0301e" opacity="${(th * 0.35).toFixed(2)}" style="mix-blend-mode:multiply"/>`;
    s += `<ellipse cx="1000" cy="260" rx="170" ry="${60 + th * 60}" fill="url(#ember)" opacity="${(0.25 + th * 0.6).toFixed(2)}"/>`;
  }
  s += `<path d="M640 330 L640 250 L1112 250 L1112 330 Z" fill="url(#haze)"/>`;
  return s + '</g>';
}

let groundCache = { key: null, svg: '' };
function ground(world, view) {
  const winter = view.events.winter, dry = view.events.drought > 0;
  const threat = Math.round((view.threat || 0) * 20) / 20;
  const key = `${winter}|${dry}|${view.events.dragon > 0 || !!view.events.attackDay}|${threat}`;
  if (groundCache.key === key) return groundCache.svg;
  const used = new Set();
  for (const b of world.buildings) for (let i = b.i; i < b.i + b.w; i++) for (let j = b.j; j < b.j + b.w; j++) used.add(`${i},${j}`);
  // the island: a thick earth edge under the grass makes the village a plateau
  const T = corner(0, 0), R = corner(N, 0), B = corner(N, N), L = corner(0, N), D = 30;
  const down = (p, d = D) => [p[0], p[1] + d];
  let s = backdrop(view) + `<ellipse cx="${B[0]}" cy="${B[1] + D + 6}" rx="${(R[0] - L[0]) * 0.42}" ry="20" fill="rgba(40,60,20,.16)"/>`;
  s += poly([L, B, down(B), down(L)], winter ? '#b9aa94' : '#8a6a46') + poly([B, R, down(R), down(B)], winter ? '#a6977f' : '#6f5236');
  s += poly([down(L, 12), down(B, 12), down(B), down(L)], winter ? '#a39684' : '#735638', 'opacity=".55"') + poly([down(B, 12), down(R, 12), down(R), down(B)], winter ? '#938670' : '#5c432c', 'opacity=".55"');
  const greens = winter ? ['#cfdcc8', '#c6d5bf', '#d8e3d2'] : dry ? ['#a9c36a', '#a0bb62', '#b3ca74'] : ['#86c457', '#7dbd4f', '#90cb60'];
  let deco = '';
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const [cx, cy] = cellCenter(i, j);
    const k = `${i},${j}`, r = hash(i, j);
    let fill = greens[Math.floor(r * 3)];
    if (ROAD.has(k)) fill = winter ? '#ebe3d0' : (r > 0.5 ? '#e6cf9c' : '#e0c690');
    if (WATER.has(k)) fill = winter ? '#bcd8ea' : '#5aa6dc';
    s += `<polygon points="${pts(diamond(cx, cy, TW / 2, TH / 2))}" fill="${fill}" stroke="${ROAD.has(k) ? 'rgba(150,110,60,.25)' : 'rgba(40,80,20,.10)'}" stroke-width=".6"/>`;
    if (WATER.has(k)) { deco += `<path class="ripple" d="M${cx - 14} ${cy} q7 -4 14 0 t14 0" stroke="#d8eefa" stroke-width="1.6" fill="none" opacity=".8"/>`; continue; }
    if (ROAD.has(k)) { // pebbles along the road
      for (let q = 0; q < 3; q++) { const a = hash(i, j, q + 1); deco += `<ellipse cx="${cx + (a - 0.5) * 40}" cy="${cy + (hash(j, i, q) - 0.5) * 16}" rx="2" ry="1.2" fill="rgba(140,100,60,.35)"/>`; }
      continue;
    }
    if (used.has(k)) continue;
    // a few trees on open land, away from roads and buildings, so the bigger island does not look empty
    const near = (a, b) => used.has(`${a},${b}`) || ROAD.has(`${a},${b}`);
    if (hash(i, j, 99) < 0.34 && !near(i + 1, j) && !near(i, j + 1) && !near(i + 1, j + 1)) {
      const big = hash(i, j, 98);
      deco += winter
        ? `<ellipse cx="${cx + 2}" cy="${cy + 6}" rx="9" ry="3.5" fill="rgba(40,60,20,.2)"/><rect x="${cx - 1.5}" y="${cy - 4}" width="3" height="10" fill="#7a5236"/><polygon points="${cx},${cy - 30} ${cx + 11},${cy - 2} ${cx - 11},${cy - 2}" fill="#3f6f46"/><polygon points="${cx},${cy - 30} ${cx + 6},${cy - 16} ${cx - 6},${cy - 16}" fill="#f4f7f8"/>`
        : big < 0.5 ? tree(cx - 8, cy, 0.85) + tree(cx + 10, cy + 4, 0.7) : `<ellipse cx="${cx + 2}" cy="${cy + 6}" rx="9" ry="3.5" fill="rgba(40,60,20,.22)"/><rect x="${cx - 1.5}" y="${cy - 4}" width="3" height="10" fill="#7a5236"/><polygon points="${cx},${cy - 30} ${cx + 11},${cy - 2} ${cx - 11},${cy - 2}" fill="#3f7f46"/><polygon points="${cx},${cy - 30} ${cx + 7},${cy - 14} ${cx - 7},${cy - 14}" fill="#4f9a54"/>`;
      continue;
    }
    // grass tufts, flowers, stones and bushes on free ground
    const n = Math.floor(hash(i, j, 7) * 4);
    for (let q = 0; q < n; q++) {
      const dx = (hash(i, j, q + 11) - 0.5) * 54, dy = (hash(i, j, q + 21) - 0.5) * 20, x = cx + dx, y = cy + dy, pick = hash(i, j, q + 31);
      if (winter) deco += `<ellipse cx="${x}" cy="${y}" rx="${4 + pick * 6}" ry="${2 + pick * 2.4}" fill="#f4f7f8" opacity=".85"/>`;
      else if (pick < 0.45) deco += `<path d="M${x - 3} ${y} l1.5 -5 l1.5 5 l1.5 -6 l1.5 6" stroke="${dry ? '#8a9a40' : '#4f8f34'}" stroke-width="1.1" fill="none"/>`;
      else if (pick < 0.75) deco += `<circle cx="${x}" cy="${y - 1}" r="1.8" fill="${['#f4e35c', '#f2f2f2', '#e86a8a', '#b48ae8'][Math.floor(pick * 40) % 4]}"/>`;
      else if (pick < 0.9) deco += `<ellipse cx="${x}" cy="${y}" rx="3.5" ry="2.2" fill="#a8a296"/><ellipse cx="${x - 1}" cy="${y - .7}" rx="2" ry="1" fill="#c6c0b4"/>`;
      else deco += `<ellipse cx="${x + 1}" cy="${y + 2}" rx="7" ry="2.6" fill="rgba(40,60,20,.2)"/><circle cx="${x - 3}" cy="${y - 2}" r="4.5" fill="#4f9a3e"/><circle cx="${x + 3}" cy="${y - 3}" r="5" fill="#5eaa48"/>`;
    }
  }
  // street lamps along the road (they glow at night)
  for (const [i, j] of LAMPS) {
    const [cx, cy] = cellCenter(i, j), x = cx + 26, y = cy - 6;
    deco += `<rect x="${x - 1}" y="${y - 22}" width="2" height="22" fill="#4a3a2a"/><rect x="${x - 3.5}" y="${y - 28}" width="7" height="7" rx="1.5" fill="#f6d27a" stroke="#4a3a2a" stroke-width="1"/><circle class="glow" cx="${x}" cy="${y - 24}" r="12" fill="#ffd87a"/>`;
  }
  groundCache = { key, svg: s + deco };
  return groundCache.svg;
}

export function renderMap(svg, world, view, ui) {
  SNOW = !!view.events.winter;
  let s = ground(world, view);
  const order = [...world.buildings].sort((a, b) => (a.i + a.j + a.w) - (b.i + b.j + b.w));
  let labels = '';
  for (const b of order) {
    const [cx, cy] = centerOf(b);
    const draw = DRAW[b.id];
    if (!draw) continue;
    const npc = view.npcs[b.id];
    const closed = npc && npc.closed, shut = npc && npc.shut;
    const nm = ui.nameOf ? ui.nameOf(b.id) : b.name;
    s += `<g class="bld" data-id="${b.id}" tabindex="0" role="button" aria-label="${nm}"${closed ? ' opacity=".55"' : ''}>` +
      `<title>${nm}</title><g transform="translate(${cx} ${cy}) scale(${K}) translate(${-cx} ${-cy})">${draw(cx, cy, view)}</g></g>`;
    const myPlot = b.type === 'plot' && view.plots && view.plots[b.id] && view.plots[b.id].mine;
    const show = ui.hover === b.id || ui.selected === b.id || ui.target === b.id || ui.showAll || myPlot;
    if (show) {
      const label = (myPlot && ui.mineTag ? '✦ ' + ui.mineTag + ' · ' : '') + nm + (closed ? ' ' + (ui.closedTag || '(closed)') : shut ? ' ' + (ui.nightTag || '(closed)') : '');
      const peak = b.id === 'dragonpeak';
      const lx = peak ? PEAK[0] : cx, ly = peak ? PEAK[1] + 150 : cy + (b.w > 1 ? TH * 1.25 : TH * 0.85), lw = label.length * 7.4 + 16;
      labels += `<g class="lbl${ui.selected === b.id ? ' sel' : ''}" pointer-events="none"><rect x="${lx - lw / 2}" y="${ly - 14}" width="${lw}" height="20" rx="10" fill="rgba(255,250,242,.92)" stroke="rgba(120,90,60,.3)"/>` +
        `<text class="tag" x="${lx}" y="${ly}" text-anchor="middle">${label}</text></g>`;
    }
  }
  svg.querySelector('#ground').innerHTML = s;
  svg.querySelector('#labels').innerHTML = labels;
  const night = view.night !== undefined ? view.night : view.dayProgress > 0.8;
  svg.querySelector('#night').setAttribute('opacity', night ? '0.36' : '0');
  svg.classList.toggle('is-night', night);

  // quest marker: a bouncing arrow over the building the player should visit
  const tb = ui.target && world.buildings.find((b) => b.id === ui.target);
  if (tb) {
    let [cx, cy] = centerOf(tb);
    let top = cy - (tb.w > 1 ? 80 : 70);
    if (tb.id === 'dragonpeak') { top = PEAK[1] - 10; cx = PEAK[0]; }
    svg.querySelector('#marker').innerHTML = `<ellipse class="pulse" cx="${cx}" cy="${cy + 4}" rx="${tb.w * 34}" ry="${tb.w * 17}" fill="none" stroke="#d9622b" stroke-width="3"/>` +
      `<g class="bounce"><polygon points="${cx - 11},${top - 16} ${cx + 11},${top - 16} ${cx},${top}" fill="#d9622b" stroke="#fff" stroke-width="2"/></g>`;
  } else svg.querySelector('#marker').innerHTML = '';
}
