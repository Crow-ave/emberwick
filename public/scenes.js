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

const rect = (x, y, w, h, f, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" ${extra}/>`;

// ---------- work places ----------

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

function forestScene(look) {
  let s = rect(0, 0, SW, SH, '#cfe7f2') + rect(0, 300, SW, SH - 300, '#9ccc6a');
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
  s += `<g id="you-scene">${bigPerson(600, GROUND + 6, 3.2, look, 'axe', 'worker')}</g>`;
  return s;
}

function fieldsScene(look, view) {
  const dry = view.events.drought > 0, snow = view.events.winter;
  let s = rect(0, 0, SW, SH, snow ? '#dfe6ea' : '#cfe7f2');
  s += `<circle cx="960" cy="110" r="46" fill="${dry ? '#f2a23a' : '#f6d25a'}" opacity="${snow ? 0.4 : 1}"/>`;
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
  s += `<g id="you-scene">${bigPerson(250, GROUND + 70, 3.0, look)}</g>`;
  if (n.closed) s += rect(0, 0, SW, SH, 'rgba(40,30,20,.45)');
  return s;
}

export function sceneMarkup(id, view, look) {
  if (id === 'mine') return mineScene(look);
  if (id === 'forest') return forestScene(look);
  if (id === 'fields') return fieldsScene(look, view);
  if (view.npcs[id]) return shopScene(id, look, view);
  return '';
}

export const hasScene = (id, view) => id === 'mine' || id === 'forest' || id === 'fields' || !!(view && view.npcs[id]);
