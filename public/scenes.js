// Close-up scenes that open when the player walks into a work place or a shop.
// Like iso.js this is visual only: it reads game data and never changes it.

export const SW = 1112, SH = 616;
const GROUND = 470;

// a big person. Feet at (x, y). `tool` is drawn in the hand and swings while working.
export function bigPerson(x, y, s, look, tool = null, cls = '') {
  const toolSvg = {
    pickaxe: `<rect x="5" y="-44" width="2.6" height="30" fill="#6b4a2e"/><path d="M-6 -42 Q6 -52 20 -42 L18 -39 Q6 -46 -4 -39 Z" fill="#9aa0a8"/>`,
    axe: `<rect x="5" y="-46" width="2.6" height="32" fill="#6b4a2e"/><path d="M7 -46 L17 -50 L17 -36 L7 -40 Z" fill="#a8adb4"/>`,
    scythe: `<rect x="5" y="-50" width="2.4" height="38" fill="#7a5236"/><path d="M6 -50 Q-14 -54 -22 -40 Q-10 -48 6 -46 Z" fill="#c9ced4"/>`,
    shears: `<rect x="4" y="-30" width="3" height="10" fill="#6b4a2e"/><path d="M4 -30 L1 -44 L5 -31 Z M7 -30 L11 -44 L6 -31 Z" fill="#c9ced4"/>`,
    rod: `<path d="M6 -20 L30 -64" stroke="#7a5236" stroke-width="2"/><path d="M30 -64 Q44 -40 40 -6" stroke="#e8e8e8" stroke-width=".7" fill="none"/>`,
    hammer: `<rect x="5" y="-38" width="2.4" height="24" fill="#6b4a2e"/><rect x="1" y="-42" width="11" height="6" rx="1" fill="#55606e"/>`,
  }[tool] || '';
  return `<g class="${cls}" transform="translate(${x} ${y}) scale(${s})">` +
    `<ellipse cx="0" cy="0" rx="12" ry="3" fill="rgba(0,0,0,.3)"/>` +
    `<rect x="-6" y="-12" width="5" height="12" fill="#3a2e26"/><rect x="1" y="-12" width="5" height="12" fill="#3a2e26"/>` +
    `<rect x="-8" y="-30" width="16" height="20" rx="5" fill="${look.color}"/>` +
    (look.apron ? `<rect x="-6" y="-24" width="12" height="14" rx="2" fill="${look.apron}"/>` : '') +
    `<circle cx="0" cy="-37" r="7.5" fill="${look.skin || '#f0c8a0'}"/>` +
    `<path d="M-7.5 -38 Q0 -48 7.5 -38 Z" fill="${look.hair || '#5a3a22'}"/>` +
    (look.hat ? `<rect x="-8" y="-46" width="16" height="4" rx="2" fill="${look.hat}"/><rect x="-5" y="-52" width="10" height="7" rx="2" fill="${look.hat}"/>` : '') +
    (look.beard ? `<path d="M-5 -34 Q0 -26 5 -34 Z" fill="${look.beardColor || '#7a5a3a'}"/>` : '') +
    `<circle cx="-2.5" cy="-37" r="1" fill="#2a2a2a"/><circle cx="2.5" cy="-37" r="1" fill="#2a2a2a"/>` +
    (toolSvg ? `<g class="swing">${toolSvg}</g>` : '') + `</g>`;
}

// a person lying in bed, asleep (head on the pillow, blanket up to the chin)
function sleeper(x, y, s, look) {
  // (x, y) = the middle of the pillow; the blanket of the bed covers the body
  return `<g transform="translate(${x} ${y}) scale(${s})"><circle cx="0" cy="-2" r="7.5" fill="${look.skin || '#f0c8a0'}"/><path d="M-7.5 -3 Q0 -12 7.5 -3 Z" fill="${look.hair || '#5a3a22'}"/>` +
    `<path d="M-4 -1 q1.5 1.5 3 0 M1 -1 q1.5 1.5 3 0" stroke="#2a2a2a" stroke-width="1" fill="none"/></g>` +
    `<g class="zzz"><text x="${x + 24}" y="${y - 30}" font-size="${9 * s}" font-weight="bold" fill="#4a5a8a">z</text><text x="${x + 46}" y="${y - 58}" font-size="${11 * s}" font-weight="bold" fill="#4a5a8a">z</text><text x="${x + 72}" y="${y - 92}" font-size="${13 * s}" font-weight="bold" fill="#4a5a8a">Z</text></g>`;
}
// a bed: frame, mattress, pillow and blanket. (x, y) = the foot end on the floor
function bedSvg(x, y, w = 260, color = '#3a6ea8') {
  return `<g>${rect(x, y - 40, w, 40, '#7a5236', 'rx="6"')}${rect(x - 10, y - 96, 22, 96, '#6b4528', 'rx="5"')}${rect(x + w - 12, y - 66, 20, 66, '#6b4528', 'rx="5"')}` +
    `${rect(x + 6, y - 58, w - 16, 22, '#f4efe4', 'rx="8"')}${rect(x + 14, y - 74, 70, 22, '#ffffff', 'rx="10" stroke="#e0d8c8"')}` +
    `${rect(x + 78, y - 64, w - 92, 30, color, 'rx="10"')}<path d="M${x + 90} ${y - 52} H${x + w - 22}" stroke="rgba(255,255,255,.35)" stroke-width="3"/></g>`;
}

// a speech bubble with wrapped text, pointing down at (x, y)
export function bubble(x, y, text, maxChars = 34) {
  // Chinese and Japanese have no spaces: wrap by character, and count each as about two letters wide
  const cjk = /[\u2e80-\u9fff\uff00-\uffef]/.test(text);
  const len = (t) => [...t].reduce((a, c) => a + (/[\u2e80-\u9fff\uff00-\uffef]/.test(c) ? 1.9 : 1), 0);
  const words = cjk ? [...String(text)] : String(text).split(/\s+/), lines = [];
  const join = (a, b) => (cjk ? a + b : (a + ' ' + b).trim());
  let line = '';
  for (const w of words) { if (len(join(line, w)) > maxChars && line) { lines.push(line); line = w.trim(); } else line = join(line, w); }
  if (line) lines.push(line);
  const shown = lines.slice(0, 5), lh = 26, w = Math.max(...shown.map((l) => len(l))) * 11.4 + 40, h = shown.length * lh + 26;
  const bx = Math.max(10, Math.min(SW - w - 10, x - w / 2)), by = y - h - 18;
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<g class="bubble"><rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="16" fill="#fffaf2" stroke="#7a5236" stroke-width="2.5"/>` +
    `<path d="M${x - 12} ${by + h - 1} L${x} ${y - 4} L${x + 12} ${by + h - 1} Z" fill="#fffaf2" stroke="#7a5236" stroke-width="2.5"/><rect x="${x - 11}" y="${by + h - 4}" width="22" height="6" fill="#fffaf2"/>` +
    shown.map((l, k) => `<text x="${bx + w / 2}" y="${by + 30 + k * lh}" font-size="20" text-anchor="middle" fill="#3a2a1e">${esc(l)}</text>`).join('') + `</g>`;
}
export const KEEPER_HEAD = [520, 270];

const rect = (x, y, w, h, f, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" ${extra}/>`;

// ---------- work places ----------

// outdoor sky: the sun by day, the moon and stars at night (the same clock as the village map)
function sky(view, dayColor, h = SH) {
  if (view && view.night) {
    let s = rect(0, 0, SW, h, '#1d2a4e') + `<circle cx="960" cy="100" r="34" fill="#f4efd0"/><circle cx="948" cy="92" r="30" fill="#1d2a4e" opacity=".0"/>`;
    for (const [x, y] of [[90, 60], [220, 120], [380, 50], [520, 140], [660, 70], [800, 40], [1050, 170], [300, 200], [720, 190]]) s += `<circle cx="${x}" cy="${y}" r="2" fill="#fff" class="twinkle"/>`;
    return s;
  }
  const dry = view && view.events.drought > 0, snow = view && view.events.winter;
  return rect(0, 0, SW, h, snow ? '#dfe6ea' : dayColor) + `<circle cx="960" cy="110" r="46" fill="${dry ? '#f2a23a' : '#f6d25a'}" opacity="${snow ? 0.4 : 1}"/>`;
}
const nightShade = (view) => (view && view.night ? rect(0, 0, SW, SH, 'rgba(18,26,64,.38)') : '');

function sheep(x, y, k = 1, flip = false, shorn = false) {
  const wool = shorn ? '#f3ead8' : '#fbf8f0';
  return `<g transform="translate(${x} ${y}) scale(${flip ? -k : k} ${k})">` +
    `<rect x="-26" y="-10" width="7" height="22" fill="#3a3330"/><rect x="14" y="-10" width="7" height="22" fill="#3a3330"/>` +
    (shorn ? `<ellipse cx="0" cy="-22" rx="34" ry="20" fill="${wool}" stroke="#e0d6c0" stroke-width="2"/>`
      : [[-22, -22], [-8, -30], [8, -30], [22, -22], [-12, -14], [12, -14], [0, -20]].map(([a, b]) => `<circle cx="${a}" cy="${b}" r="16" fill="${wool}"/>`).join('')) +
    `<ellipse cx="38" cy="-28" rx="11" ry="9" fill="#3a3330"/><ellipse cx="32" cy="-35" rx="6" ry="3" fill="#3a3330" transform="rotate(-30 32 -35)"/>` +
    `<circle cx="41" cy="-30" r="1.8" fill="#fff"/></g>`;
}

function pastureScene(look, view) {
  const snow = view.events.winter;
  let s = sky(view, '#cfe7f2');
  s += `<path d="M0 250 Q280 200 560 240 Q840 270 ${SW} 220 V${SH} H0 Z" fill="${snow ? '#e8ece6' : '#8cc15a'}"/>`;
  s += rect(0, 300, SW, SH - 300, snow ? '#eef0ea' : '#9ccc6a');
  // fence along the back
  for (let x = 30; x < SW; x += 90) s += rect(x, 262, 10, 58, '#8a6040');
  s += rect(20, 274, SW - 40, 8, '#a8743e') + rect(20, 298, SW - 40, 8, '#a8743e');
  if (!snow) for (const [x, y] of [[120, 520], [260, 560], [880, 540], [1010, 500], [700, 590]]) s += `<circle cx="${x}" cy="${y}" r="5" fill="#f2e38a"/><circle cx="${x + 9}" cy="${y + 3}" r="4" fill="#fff"/>`;
  s += sheep(160, 380, 1.1) + sheep(330, 340, 0.8, true) + sheep(900, 350, 0.9) + sheep(1010, 430, 1.2, true) + sheep(250, 500, 1.3, true);
  // the sheep being shorn, next to the player, and the wool pile
  s += sheep(720, GROUND - 2, 1.5, true, true);
  s += `<g>${[[820, GROUND - 16, 22], [846, GROUND - 22, 18], [868, GROUND - 14, 20], [842, GROUND - 38, 16]].map(([a, b, r]) => `<circle cx="${a}" cy="${b}" r="${r}" fill="#fbf8f0" stroke="#e6dcc6" stroke-width="2"/>`).join('')}</g>`;
  s += `<g class="chips"><circle class="c1" cx="690" cy="${GROUND - 40}" r="7" fill="#fbf8f0"/><circle class="c2" cx="700" cy="${GROUND - 50}" r="6" fill="#fbf8f0"/><circle class="c3" cx="684" cy="${GROUND - 30}" r="5" fill="#fbf8f0"/></g>`;
  s += nightShade(view);
  s += `<g id="you-scene">${bigPerson(600, GROUND + 6, 3.2, { ...look, hat: '#b9864a' }, 'shears', 'worker')}</g>`;
  return s;
}

function pondScene(look, view) {
  const snow = view.events.winter;
  let s = sky(view, '#cfe7f2');
  s += `<path d="M0 240 Q300 200 600 236 Q860 260 ${SW} 230 V${SH} H0 Z" fill="${snow ? '#e8ece6' : '#7fb556'}"/>`;
  s += `<ellipse cx="620" cy="440" rx="560" ry="150" fill="${snow ? '#b8cdd8' : '#4f8fb8'}"/><ellipse cx="620" cy="440" rx="500" ry="120" fill="${snow ? '#c9dbe4' : '#5fa0c8'}"/>`;
  for (const [x, y, w] of [[380, 420, 70], [820, 470, 90], [560, 500, 60]]) s += `<path d="M${x - w / 2} ${y} Q${x} ${y - 6} ${x + w / 2} ${y}" stroke="#a9d2ea" stroke-width="3" fill="none" class="ripple"/>`;
  if (!snow) {
    for (const [x, y] of [[300, 480], [900, 410], [760, 520]]) s += `<ellipse cx="${x}" cy="${y}" rx="24" ry="9" fill="#4f9a48"/><circle cx="${x + 6}" cy="${y - 3}" r="4" fill="#f4a6c0"/>`;
    for (let x = 60; x < 220; x += 18) s += `<rect x="${x}" y="${330 + (x % 3) * 8}" width="4" height="${70 - (x % 4) * 6}" fill="#5f8a3a"/><ellipse cx="${x + 2}" cy="${326 + (x % 3) * 8}" rx="4" ry="10" fill="#7a5236"/>`;
  }
  // wooden jetty the player stands on
  s += `<polygon points="900,${GROUND + 8} ${SW},${GROUND - 10} ${SW},${GROUND + 30} 900,${GROUND + 40}" fill="#8a6040"/>`;
  for (let x = 910; x < SW; x += 36) s += `<line x1="${x}" y1="${GROUND + 6}" x2="${x}" y2="${GROUND + 38}" stroke="#6b4528" stroke-width="3"/>`;
  s += rect(930, GROUND + 30, 10, 60, '#6b4528') + rect(1060, GROUND + 22, 10, 60, '#6b4528');
  // the float on the water and a jumping fish while working
  s += `<circle cx="1026" cy="${GROUND + 0}" r="0" fill="none"/>`;
  s += `<g class="chips"><path class="c1" d="M820 430 q14 -12 28 0 q-14 8 -28 0 Z" fill="#e0a050"/><circle class="c2" cx="840" cy="440" r="5" fill="#a9d2ea"/><circle class="c3" cx="826" cy="444" r="4" fill="#a9d2ea"/></g>`;
  s += `<g class="bob"><circle cx="846" cy="452" r="7" fill="#e5503a"/><rect x="839" y="452" width="14" height="5" fill="#fff"/></g>`;
  s += nightShade(view);
  s += `<g id="you-scene">${bigPerson(980, GROUND + 2, 3.2, { ...look, hat: '#4a7a9a' }, 'rod', 'worker')}</g>`;
  return s;
}

function mineScene(look) {
  let s = rect(0, 0, SW, SH, '#2e2620');
  s += `<path d="M0 0 H${SW} V90 Q900 130 760 100 Q560 60 400 110 Q200 140 0 100 Z" fill="#3e342c"/>`;
  s += `<path d="M0 ${SH} V${GROUND} Q260 ${GROUND - 24} 560 ${GROUND - 8} Q840 ${GROUND + 8} ${SW} ${GROUND - 16} V${SH} Z" fill="#4a3e34"/>`;
  s += [[140, 220, 90, 60], [320, 170, 80, 46], [900, 230, 110, 66], [740, 160, 72, 40], [100, 360, 64, 40], [1000, 370, 70, 44]]
    .map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#5a4d40"/>`).join('');
  s += rect(230, 100, 20, 370, '#7a5236') + rect(860, 100, 20, 370, '#7a5236') + rect(216, 92, 678, 22, '#8a6040');
  for (const x of [262, 848]) s += `<g class="flick"><circle cx="${x}" cy="160" r="60" fill="#f2b04a" opacity=".16"/><rect x="${x - 9}" y="142" width="18" height="26" rx="4" fill="#e5803a"/></g>`;
  // ore wall
  s += `<polygon points="600,${GROUND} 630,370 690,348 740,380 752,${GROUND}" fill="#7c6c5e"/><polygon points="630,370 690,348 740,380 690,404" fill="#958473"/>`;
  s += [[656, 400, 9], [700, 420, 8], [676, 440, 7], [720, 446, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#b2552c"/>`).join('');
  s += `<circle cx="664" cy="430" r="4" fill="#cfd3d8"/><circle cx="728" cy="404" r="4" fill="#cfd3d8"/>`;
  s += `<g class="chips"><rect class="c1" x="616" y="410" width="9" height="9" fill="#b2552c"/><rect class="c2" x="622" y="420" width="7" height="7" fill="#9a8a7a"/><rect class="c3" x="612" y="400" width="6" height="6" fill="#b2552c"/></g>`;
  // cart
  s += `<g>${rect(300, 420, 96, 44, '#7a5236', 'rx="5"')}${rect(294, 414, 108, 10, '#5a3a22')}` +
    `<circle cx="318" cy="414" r="11" fill="#b2552c"/><circle cx="344" cy="408" r="12" fill="#b2552c"/><circle cx="370" cy="414" r="11" fill="#8a7a6a"/>` +
    `<circle cx="314" cy="468" r="9" fill="#2a2a2a"/><circle cx="380" cy="468" r="9" fill="#2a2a2a"/></g>`;
  s += rect(0, GROUND + 2, SW, 6, '#3a2e26');
  s += `<g id="you-scene">${bigPerson(540, GROUND, 3.2, { ...look, hat: '#e2b640' }, 'pickaxe', 'worker')}</g>`;
  return s;
}

function forestScene(look, view) {
  let s = (view && view.night ? sky(view, '#cfe7f2') : rect(0, 0, SW, SH, '#cfe7f2')) + rect(0, 300, SW, SH - 300, '#9ccc6a');
  s += `<path d="M0 320 Q200 270 420 300 Q700 340 ${SW} 290 V${SH} H0 Z" fill="#8cc15a"/>`;
  const tree = (x, y, k, dark) => `<rect x="${x - 7 * k}" y="${y - 70 * k}" width="${14 * k}" height="${72 * k}" fill="#7a5236"/>` +
    `<circle cx="${x}" cy="${y - 100 * k}" r="${44 * k}" fill="${dark ? '#2f6a2c' : '#3f7f36'}"/><circle cx="${x - 24 * k}" cy="${y - 76 * k}" r="${32 * k}" fill="${dark ? '#2f6a2c' : '#4b8f3e'}"/><circle cx="${x + 26 * k}" cy="${y - 80 * k}" r="${30 * k}" fill="#57a04a"/>`;
  for (const [x, y, k] of [[80, 330, 1.1], [230, 310, 0.9], [400, 300, 0.8], [880, 300, 0.9], [1030, 320, 1.2]]) s += tree(x, y, k, true);
  for (const [x, y, k] of [[150, 470, 1.4], [980, 480, 1.5]]) s += tree(x, y, k, false);
  // the tree being chopped
  s += rect(690, 250, 40, 222, '#7a5236') + `<polygon points="690,400 712,392 690,384" fill="#e8d2a6"/>`;
  s += `<circle cx="710" cy="200" r="90" fill="#3f7f36"/><circle cx="660" cy="240" r="60" fill="#4b8f3e"/><circle cx="770" cy="236" r="58" fill="#57a04a"/>`;
  s += `<g class="leaves"><ellipse class="l1" cx="660" cy="280" rx="6" ry="3" fill="#6fae4a"/><ellipse class="l2" cx="740" cy="270" rx="6" ry="3" fill="#8cc15a"/><ellipse class="l3" cx="700" cy="300" rx="5" ry="3" fill="#6fae4a"/></g>`;
  s += `<g class="chips"><rect class="c1" x="680" y="396" width="8" height="5" fill="#e8d2a6"/><rect class="c2" x="676" y="404" width="6" height="4" fill="#c9a06a"/><rect class="c3" x="684" y="388" width="5" height="4" fill="#e8d2a6"/></g>`;
  // log pile
  s += `<g fill="#b07a4a" stroke="#7a5236" stroke-width="2">` + [[330, 452], [372, 452], [414, 452], [351, 418], [393, 418], [372, 384]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="20"/>`).join('') + `</g>`;
  s += `<g fill="#e8d2a6">` + [[330, 452], [372, 452], [414, 452], [351, 418], [393, 418], [372, 384]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7"/>`).join('') + `</g>`;
  s += nightShade(view);
  s += `<g id="you-scene">${bigPerson(600, GROUND + 6, 3.2, look, 'axe', 'worker')}</g>`;
  return s;
}

function fieldsScene(look, view) {
  const dry = view.events.drought > 0, snow = view.events.winter;
  let s = sky(view, '#cfe7f2');
  s += `<path d="M0 260 Q300 220 600 250 Q860 270 ${SW} 240 V${SH} H0 Z" fill="${snow ? '#e8ece6' : '#9ccc6a'}"/>`;
  s += rect(0, 300, SW, SH - 300, snow ? '#e6e2d6' : dry ? '#c9a46a' : '#b98f4e');
  const stalk = dry ? '#a88a46' : '#e8c83c';
  for (let row = 0; row < 6; row++) {
    const y = 330 + row * 34;
    for (let x = 20 + (row % 2) * 22; x < SW; x += 44) {
      if (x > 470 && x < 640 && row > 2) continue; // the cut patch where the player works
      if (snow) { s += `<circle cx="${x}" cy="${y}" r="3" fill="#c9c2b0"/>`; continue; }
      s += `<g class="sway" style="animation-delay:${((x + row * 17) % 10) / 10}s"><rect x="${x}" y="${y - 30}" width="2.4" height="32" fill="#7a8f2e"/><ellipse cx="${x + 1}" cy="${y - 34}" rx="5" ry="10" fill="${stalk}"/></g>`;
    }
  }
  // basket
  s += `<g><path d="M300 ${GROUND - 40} L392 ${GROUND - 40} L380 ${GROUND} L312 ${GROUND} Z" fill="#a8743e"/>` +
    `<g stroke="#7a5236" stroke-width="3">${[0, 1, 2].map((k) => `<line x1="304" y1="${GROUND - 30 + k * 10}" x2="388" y2="${GROUND - 30 + k * 10}"/>`).join('')}</g>` +
    `<ellipse cx="346" cy="${GROUND - 44}" rx="44" ry="12" fill="${stalk}"/></g>`;
  s += `<g class="chips"><ellipse class="c1" cx="520" cy="${GROUND - 50}" rx="5" ry="9" fill="${stalk}"/><ellipse class="c2" cx="530" cy="${GROUND - 60}" rx="4" ry="8" fill="${stalk}"/><ellipse class="c3" cx="512" cy="${GROUND - 44}" rx="4" ry="8" fill="${stalk}"/></g>`;
  s += rect(840, 300, 6, 80, '#7a5236') + rect(818, 316, 50, 5, '#7a5236') + `<circle cx="843" cy="296" r="12" fill="#e8d2a6"/>`;
  s += nightShade(view);
  s += `<g id="you-scene">${bigPerson(560, GROUND + 10, 3.2, { ...look, hat: '#d9b35e' }, 'scythe', 'worker')}</g>`;
  return s;
}

// ---------- shops ----------

const KEEPERS = {
  woodcutter: { color: '#5e7a3a', hair: '#7a4a2a', beard: true, beardColor: '#7a4a2a' },
  mill: { color: '#e7d9bd', hair: '#c98a3a', apron: '#fff' },
  bakery: { color: '#f0dcb4', hair: '#3a2a1a', apron: '#fff', hat: '#fff' },
  smithy: { color: '#55606e', hair: '#2a2a2a', apron: '#6b4a2e', beard: true, beardColor: '#2a2a2a' },
  carpenter: { color: '#a04a34', hair: '#5a3a22', apron: '#c9a06a' },
  inn: { color: '#7a3b2a', hair: '#8a3a2a', apron: '#f3e8d6' },
  tower: { color: '#6b645a', hair: '#3a3a3a', hat: '#8a8a90' },
  tailor: { color: '#3f5f8f', hair: '#2a1a12', apron: '#e9d8c2' },
};

const ITEM_ICON = {
  lumber: (x, y) => rect(x - 16, y - 6, 32, 6, '#d8b98a', 'stroke="#9a7a5a"') + rect(x - 16, y - 13, 32, 6, '#d8b98a', 'stroke="#9a7a5a"'),
  axe: (x, y) => rect(x - 1, y - 22, 3, 22, '#6b4a2e') + `<path d="M${x + 2} ${y - 22} L${x + 12} ${y - 26} L${x + 12} ${y - 12} L${x + 2} ${y - 16} Z" fill="#a8adb4"/>`,
  flour: (x, y) => `<path d="M${x - 12} ${y} Q${x - 14} ${y - 22} ${x} ${y - 26} Q${x + 14} ${y - 22} ${x + 12} ${y} Z" fill="#f4efe4" stroke="#c9bfae"/>`,
  plow: (x, y) => rect(x - 14, y - 4, 28, 4, '#7a5236') + `<path d="M${x + 8} ${y - 4} L${x + 16} ${y - 16} L${x + 18} ${y - 4} Z" fill="#9aa0a8"/>`,
  bread: (x, y) => `<ellipse cx="${x}" cy="${y - 7}" rx="14" ry="8" fill="#d99a4a"/><path d="M${x - 8} ${y - 10} L${x - 4} ${y - 4} M${x} ${y - 12} L${x + 4} ${y - 5} M${x + 7} ${y - 11} L${x + 10} ${y - 5}" stroke="#a86a2a" stroke-width="1.5"/>`,
  sword: (x, y) => rect(x - 1.5, y - 34, 3, 26, '#cfd3d8') + rect(x - 8, y - 10, 16, 3, '#8a6a3a') + rect(x - 1.5, y - 7, 3, 7, '#5a3a22'),
  pickaxe: (x, y) => rect(x - 1, y - 24, 3, 24, '#6b4a2e') + `<path d="M${x - 12} ${y - 22} Q${x} ${y - 30} ${x + 12} ${y - 22} L${x + 10} ${y - 19} Q${x} ${y - 25} ${x - 10} ${y - 19} Z" fill="#9aa0a8"/>`,
  cart: (x, y) => rect(x - 18, y - 16, 36, 12, '#a87a4a') + `<circle cx="${x - 10}" cy="${y - 3}" r="5" fill="#3a2a1a"/><circle cx="${x + 10}" cy="${y - 3}" r="5" fill="#3a2a1a"/>`,
  coat: (x, y) => `<path d="M${x - 6} ${y - 28} L${x - 16} ${y - 22} L${x - 14} ${y} L${x + 14} ${y} L${x + 16} ${y - 22} L${x + 6} ${y - 28} L${x} ${y - 22} Z" fill="#3a6ea8" stroke="#2a4e78"/><path d="M${x} ${y - 22} V${y}" stroke="#e9d8c2" stroke-width="1.5"/>`,
  shears: (x, y) => `<circle cx="${x - 6}" cy="${y - 5}" r="5" fill="none" stroke="#c4473a" stroke-width="2.5"/><circle cx="${x + 6}" cy="${y - 5}" r="5" fill="none" stroke="#c4473a" stroke-width="2.5"/><path d="M${x - 3} ${y - 9} L${x + 4} ${y - 30} M${x + 3} ${y - 9} L${x - 4} ${y - 30}" stroke="#9aa0a8" stroke-width="3"/>`,
  rod: (x, y) => `<path d="M${x - 14} ${y} L${x + 14} ${y - 34}" stroke="#7a5236" stroke-width="3"/><path d="M${x + 14} ${y - 34} Q${x + 20} ${y - 20} ${x + 18} ${y - 6}" stroke="#ccc" stroke-width="1" fill="none"/>`,
  bed: (x, y) => `<rect x="${x - 18}" y="${y - 12}" width="36" height="12" rx="3" fill="#7a5236"/><rect x="${x - 16}" y="${y - 18}" width="12" height="7" rx="3" fill="#fff"/><rect x="${x - 4}" y="${y - 16}" width="20" height="6" rx="3" fill="#3a6ea8"/>`,
  meal: (x, y) => `<ellipse cx="${x}" cy="${y - 3}" rx="15" ry="5" fill="#f4efe4"/><ellipse cx="${x}" cy="${y - 7}" rx="9" ry="5" fill="#a84a2a"/>`,
};

function shopProp(id) {
  switch (id) {
    case 'smithy':
      return `<g>${rect(820, 300, 160, 170, '#4a4038', 'rx="10"')}<path d="M840 470 V360 Q900 320 960 360 V470 Z" fill="#2e2620"/>` +
        `<g class="flick"><ellipse cx="900" cy="440" rx="44" ry="26" fill="#e5803a"/><ellipse cx="900" cy="444" rx="26" ry="14" fill="#f6d25a"/></g>` +
        `<path d="M700 ${GROUND} L716 430 H688 L676 418 H780 L768 430 H740 L756 ${GROUND} Z" fill="#55606e"/>${rect(712, 404, 18, 14, '#e5803a')}` +
        `<g class="sparks"><circle class="s1" cx="721" cy="402" r="3" fill="#f6d25a"/><circle class="s2" cx="724" cy="400" r="2.5" fill="#f2a23a"/><circle class="s3" cx="718" cy="400" r="2" fill="#f6d25a"/></g></g>`;
    case 'bakery':
      return `<g>${rect(800, 260, 200, 210, '#b0a090', 'rx="16"')}<path d="M836 470 V360 Q900 300 964 360 V470 Z" fill="#3a2a1a"/>` +
        `<g class="flick"><ellipse cx="900" cy="440" rx="50" ry="22" fill="#e5803a"/></g>${rect(880, 210, 40, 60, '#8a7a6a')}` +
        `<g class="steam"><circle cx="900" cy="200" r="10" fill="#e6e1d8"/><circle cx="910" cy="180" r="8" fill="#e6e1d8"/></g></g>`;
    case 'mill':
      return `<g><ellipse cx="880" cy="440" rx="110" ry="30" fill="#8a8073"/><g class="spin"><ellipse cx="880" cy="420" rx="96" ry="26" fill="#a69b8c"/><rect x="876" y="398" width="8" height="44" fill="#6b5a48"/></g>` +
        `${rect(866, 300, 28, 120, '#6b5a48')}<path d="M760 470 Q750 420 790 410 Q830 420 820 470 Z" fill="#f4efe4" stroke="#c9bfae"/></g>`;
    case 'woodcutter':
      return `<g fill="#b07a4a" stroke="#7a5236" stroke-width="2">` + [[820, 452], [862, 452], [904, 452], [946, 452], [841, 418], [883, 418], [925, 418], [862, 384], [904, 384]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="20"/>`).join('') +
        `</g><g fill="#e8d2a6">` + [[820, 452], [862, 452], [904, 452], [946, 452], [841, 418], [883, 418], [925, 418], [862, 384], [904, 384]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7"/>`).join('') + `</g>`;
    case 'carpenter':
      return `<g>${rect(780, 400, 220, 18, '#a87a4a')}${rect(790, 418, 12, 52, '#7a5236')}${rect(978, 418, 12, 52, '#7a5236')}` +
        `${rect(800, 384, 120, 16, '#d8b98a', 'stroke="#9a7a5a"')}<g class="saw">${rect(900, 350, 4, 40, '#6b4a2e')}${rect(880, 372, 48, 6, '#9aa0a8')}</g></g>`;
    case 'inn':
      return `<g>${rect(820, 250, 180, 220, '#8a7a6a', 'rx="8"')}<path d="M850 470 V350 Q910 310 970 350 V470 Z" fill="#2e2620"/>` +
        `<g class="flick"><ellipse cx="910" cy="446" rx="40" ry="20" fill="#e5803a"/><ellipse cx="910" cy="448" rx="22" ry="10" fill="#f6d25a"/></g>` +
        `${rect(120, 410, 160, 14, '#8a5a3a')}${rect(130, 424, 10, 46, '#6b4a2e')}${rect(260, 424, 10, 46, '#6b4a2e')}` +
        `${rect(160, 392, 16, 18, '#e2b640', 'rx="3"')}${rect(220, 392, 16, 18, '#e2b640', 'rx="3"')}</g>`;
    case 'tailor':
      return `<g>${rect(830, 300, 8, 170, '#5a3a22')}${rect(800, 300, 70, 6, '#5a3a22')}` +
        `<path d="M820 310 L790 330 L795 420 L880 420 L885 330 L855 310 L838 326 Z" fill="#b5501e" stroke="#8a3a14"/>` +
        `${rect(900, 430, 50, 40, '#7a3b8a', 'rx="6"')}${rect(950, 440, 50, 30, '#2f7a3a', 'rx="6"')}${rect(910, 400, 70, 30, '#e2b640', 'rx="6"')}</g>`;
    case 'tower':
      return `<g>${rect(800, 300, 200, 14, '#6b4a2e')}${rect(800, 380, 200, 14, '#6b4a2e')}${rect(810, 260, 10, 210, '#5a3a22')}${rect(980, 260, 10, 210, '#5a3a22')}` +
        `<path d="M860 300 L880 240 L900 300 Z" fill="#a33a2f"/><path d="M920 300 L940 240 L960 300 Z" fill="#3a5fa0"/></g>`;
    default: return '';
  }
}

function shopScene(id, look, view) {
  const n = view.npcs[id];
  let s = rect(0, 0, SW, SH, '#d9b98a');
  for (let x = 0; x < SW; x += 64) s += rect(x, 0, 2, GROUND, '#c4a272');
  s += rect(0, GROUND, SW, SH - GROUND, '#8a6a4a');
  for (let x = 0; x < SW; x += 90) s += rect(x, GROUND, 2, SH - GROUND, '#7a5a3a');
  // window
  s += `<g>${rect(90, 90, 170, 130, '#9ec7e0', 'rx="6"')}${rect(172, 90, 6, 130, '#7a5236')}${rect(90, 152, 170, 6, '#7a5236')}${rect(84, 84, 182, 142, 'none', 'stroke="#7a5236" stroke-width="10" rx="8"')}</g>`;
  // shelves with what the shop sells; each item drawn up to the stock count
  const goods = Object.keys(n.sells).filter((g) => g !== 'meal');
  s += rect(330, 120, 380, 10, '#7a5236') + rect(330, 210, 380, 10, '#7a5236');
  goods.slice(0, 2).forEach((g, row) => {
    const y = 120 + row * 90;
    const count = Math.min(8, n.stock[g] || 0);
    for (let k = 0; k < count; k++) s += (ITEM_ICON[g] || (() => ''))(360 + k * 44, y);
  });
  s += shopProp(id);
  // the keeper behind the counter
  s += `<g>${bigPerson(520, 400, 3.3, KEEPERS[id] || {}, id === 'smithy' ? 'hammer' : null, id === 'smithy' ? 'worker idle' : '')}</g>`;
  s += rect(330, 380, 400, 90, '#8a5a3a', 'rx="6"') + rect(320, 372, 420, 16, '#6b4a2e', 'rx="4"');
  if (id === 'inn') s += ITEM_ICON.meal(470, 372) + ITEM_ICON.meal(580, 372);
  if (id === 'bakery') s += ITEM_ICON.bread(450, 372) + ITEM_ICON.bread(490, 372) + ITEM_ICON.bread(610, 372);
  const me = view.player, asleep = id === 'inn' && me && view.night && me.sleepPlace === 'inn';
  if (id === 'inn') s += `<g>${bedSvg(40, GROUND + 80, 300, '#7a3b2a')}</g>`; // a guest bed by the window
  s += asleep ? `<g id="you-scene">${sleeper(40 + 49, GROUND + 80 - 63, 3, look)}</g>` : `<g id="you-scene">${bigPerson(id === 'inn' ? 420 : 250, GROUND + 70, 3.0, look)}</g>`;
  if (view.night) s += rect(0, 0, SW, SH, 'rgba(20,30,70,.28)');
  if (n.closed) s += rect(0, 0, SW, SH, 'rgba(40,30,20,.45)');
  return s;
}

// inside a home: a bedroom. With a bed you can sleep; without one the room is bare.
function homeScene(id, look, view) {
  const me = view.player || {};
  const plot = view.plots && view.plots[id], house = view.houses && view.houses[id];
  const hasBed = house ? true : !!(plot && plot.bed);
  const asleep = view.night && me.sleepPlace === id;
  let s = rect(0, 0, SW, SH, '#e8d6b6');
  for (let x = 0; x < SW; x += 80) s += rect(x, 0, 3, GROUND, '#dcc7a2');
  s += rect(0, GROUND, SW, SH - GROUND, '#9a7450');
  for (let x = 0; x < SW; x += 110) s += rect(x, GROUND, 2, SH - GROUND, '#86623f');
  // window: day sky or night sky with the moon
  s += `<g>${rect(760, 90, 220, 160, view.night ? '#24305a' : '#9ec7e0', 'rx="8"')}${view.night ? '<circle cx="920" cy="140" r="22" fill="#f4efd0"/><circle cx="800" cy="120" r="2" fill="#fff"/><circle cx="850" cy="200" r="2" fill="#fff"/>' : '<circle cx="930" cy="130" r="20" fill="#f6d25a"/>'}` +
    `${rect(866, 90, 8, 160, '#7a5236')}${rect(760, 166, 220, 8, '#7a5236')}${rect(752, 82, 236, 176, 'none', 'stroke="#7a5236" stroke-width="12" rx="10"')}</g>`;
  // a little table with a candle, a rug
  s += `<ellipse cx="560" cy="${GROUND + 70}" rx="200" ry="34" fill="#b5501e" opacity=".55"/>`;
  s += `${rect(820, GROUND - 60, 120, 14, '#7a5236', 'rx="4"')}${rect(832, GROUND - 46, 10, 46, '#6b4528')}${rect(918, GROUND - 46, 10, 46, '#6b4528')}${rect(872, GROUND - 92, 12, 32, '#f4efe4')}<ellipse cx="878" cy="${GROUND - 98}" rx="5" ry="9" fill="#f6b23a" class="flick"/>`;
  if (hasBed) s += bedSvg(90, GROUND + 80, 320, house ? '#4f7a3a' : '#3a6ea8');
  else s += `<g>${rect(90, GROUND + 40, 300, 60, 'rgba(0,0,0,.08)', 'rx="10" stroke="#9a7450" stroke-dasharray="10 8" stroke-width="3"')}</g>`;
  s += asleep ? sleeper(90 + 49, GROUND + 80 - 63, 3, look) : `<g id="you-scene">${bigPerson(600, GROUND + 70, 3.0, look)}</g>`;
  if (view.night) s += rect(0, 0, SW, SH, 'rgba(20,30,70,.3)');
  return s;
}
export const homeHasScene = (id, view) => {
  const h = view.houses && view.houses[id];
  if (h) return !!h.mine;
  const p = view.plots && view.plots[id];
  return !!(p && p.built && (p.mine || (p.lease && p.lease.mine)));
};

export function sceneMarkup(id, view, look) {
  if (homeHasScene(id, view)) return homeScene(id, look, view);
  if (id === 'mine') return mineScene(look);
  if (id === 'forest') return forestScene(look, view);
  if (id === 'pasture') return pastureScene(look, view);
  if (id === 'pond') return pondScene(look, view);
  if (id === 'fields') return fieldsScene(look, view);
  if (view.npcs[id]) return shopScene(id, look, view);
  return '';
}

export const hasScene = (id, view) => id === 'mine' || id === 'forest' || id === 'fields' || id === 'pasture' || id === 'pond' || !!(view && view.npcs[id]) || !!(view && homeHasScene(id, view));
