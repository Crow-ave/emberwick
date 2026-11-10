// Emberwick economy report: runs the village for 100 game days with no players and no one
// touching prices, then prints what happened. Same seed, same result: `npm run report`.
// (NEAR AI is not called here; the craftsmen use their rule-based behaviour.)
import { createState, tick, totalMoney, balance } from '../server/economy.js';
import { TOKEN, RULES, CRAFTSMEN } from '../server/world.js';

const DAYS = Number(process.argv[2]) || 100;
const SEED = Number(process.argv[3]) || 42;
const state = createState(SEED);
const r2 = (n) => Math.round(n * 100) / 100;

const WATCH = [['bakery', 'bread', 'sells'], ['mill', 'flour', 'sells'], ['smithy', 'sword', 'sells'], ['tailor', 'coat', 'sells'],
  ['mill', 'wheat', 'buys'], ['smithy', 'ore', 'buys'], ['woodcutter', 'wood', 'buys'], ['tailor', 'wool', 'buys']];
const priceOf = (npc, g, side) => (state.npcs[npc] && state.npcs[npc][side][g]) || null;
const prices = Object.fromEntries(WATCH.map(([n, g, s]) => [`${n}.${g}.${s}`, { start: priceOf(n, g, s), min: Infinity, max: 0 }]));
const shopIds = CRAFTSMEN.map((c) => c.id).filter((id) => state.npcs[id]);
const wallets = Object.fromEntries(shopIds.map((id) => [id, { start: r2(balance(state, 'npc:' + id)), min: Infinity }]));
const treasuryStart = r2(balance(state, 'treasury'));
const botStart = Object.entries(state.balances).filter(([k]) => k.startsWith('bot:')).map(([, v]) => v);

let moved = 0, transfers = 0, lastLedger = state.ledgerSeq || 0, maxDrift = 0;
const treasuryIn = {}, treasuryOut = {}, events = {};
const EVENT_KEYS = { 'log.drought': 'droughts', 'log.winter': 'winters', 'log.smoke': 'dragon warnings', 'log.repelled': 'dragon attacks repelled',
  'log.burned': 'dragon attacks that did damage', 'log.upgraded': 'workshop upgrades', 'log.bailout': 'treasury rescues of a shop',
  'log.newShop': 'new shops opened', 'log.towerBuilt': 'watchtowers built', 'log.districtOpen': 'neighbourhoods opened', 'log.settler': 'newcomer families', 'log.proposal': 'council proposals' };
let lastLog = state.log[0];
const kind = (why) => {
  const w = String(why || 'other').replace(/^Emberwick:?\s*/, '');
  if (/^village record/.test(w)) return 'daily village record on NEAR';
  if (/^AI plan/.test(w)) return 'AI plan record on NEAR';
  if (/^council #\d+: payout/.test(w)) return 'council payout to villagers';
  if (/^council #\d+/.test(w)) return 'council decisions';
  return w.replace(/\s*#?\d+(\.\d+)?/g, '').split(/[:(,]/)[0].trim().slice(0, 40);
};

for (let t = 0; t < RULES.ticksPerDay * DAYS; t++) {
  tick(state);
  for (const e of state.ledger) {
    if (e.id <= lastLedger) continue;
    moved += e.amount; transfers++;
    if (e.to === 'treasury') treasuryIn[kind(e.why)] = (treasuryIn[kind(e.why)] || 0) + e.amount;
    if (e.from === 'treasury') treasuryOut[kind(e.why)] = (treasuryOut[kind(e.why)] || 0) + e.amount;
  }
  lastLedger = state.ledgerSeq || 0;
  for (const l of state.log) { if (l === lastLog) break; if (EVENT_KEYS[l.key]) events[EVENT_KEYS[l.key]] = (events[EVENT_KEYS[l.key]] || 0) + 1; }
  lastLog = state.log[0];
  for (const [n, g, s] of WATCH) { const p = priceOf(n, g, s), x = prices[`${n}.${g}.${s}`]; if (p) { x.min = Math.min(x.min, p); x.max = Math.max(x.max, p); } }
  for (const id of shopIds) wallets[id].min = Math.min(wallets[id].min, balance(state, 'npc:' + id));
  maxDrift = Math.max(maxDrift, Math.abs(totalMoney(state) - TOKEN.totalSupply));
}

const botEnd = Object.entries(state.balances).filter(([k]) => k.startsWith('bot:')).map(([, v]) => v);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const row = (...c) => '| ' + c.join(' | ') + ' |';
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ') || 'none';

const out = [];
out.push(`Emberwick economy report: ${DAYS} village days, seed ${SEED}, no players, no NEAR AI, nobody touching prices`, '');
out.push('| Measure | Result |', '|---|---|');
out.push(row('Money supply (EMWK)', `${TOKEN.totalSupply} at the start, ${r2(totalMoney(state))} at the end; largest drift during the run ${r2(maxDrift)}`));
out.push(row('Money moved', `${Math.round(moved)} EMWK in ${transfers} transfers (${Math.round(moved / DAYS)} EMWK a day)`));
out.push(row('Treasury', `${Math.round(treasuryStart)} → ${Math.round(balance(state, 'treasury'))} EMWK; in: ${top(treasuryIn)}; out: ${top(treasuryOut)}`));
out.push(row('Villagers (12 bots), average purse', `${Math.round(avg(botStart))} → ${Math.round(avg(botEnd))} EMWK (richest ${Math.round(Math.max(...botEnd))}, poorest ${Math.round(Math.min(...botEnd))})`));
out.push(row('Village events', Object.entries(events).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none'));
out.push('', '| Shop | Wallet start → end (EMWK) | Lowest point | Workshop level |', '|---|---|---|---|');
for (const id of shopIds) out.push(row(id === 'tower' ? 'tower (guard; paid daily by the treasury, spends it on swords and bread)' : id, `${Math.round(wallets[id].start)} → ${Math.round(balance(state, 'npc:' + id))}`, Math.round(wallets[id].min), state.npcs[id].level || 1));
out.push('', '| Price (EMWK) | Start | End | Low | High |', '|---|---|---|---|---|');
for (const [n, g, s] of WATCH) { const x = prices[`${n}.${g}.${s}`]; out.push(row(`${g} (${n} ${s === 'sells' ? 'sells' : 'pays'})`, Math.round(x.start), Math.round(priceOf(n, g, s)), Math.round(x.min), Math.round(x.max))); }
console.log(out.join('\n'));
