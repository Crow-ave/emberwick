// Emberwick economy report: runs the village for 100 game days with no players and no one
// touching prices, then prints what happened. Same seed, same result: `npm run report`.
//
// `npm run report -- --ai` runs the same village twice from the same seed: once on the
// craftsmen's rules alone, once with a NEAR AI morning plan every village day (exactly the
// call the game makes), and compares the two. It needs a NEAR AI key (NEARAI_API_KEY or
// ~/.emberwick/nearai-key.txt) and makes one request per village day (100 requests).
import { EventEmitter } from 'node:events';
import { createState, tick, totalMoney, balance, aiBrief, applyAiPlan } from '../server/economy.js';
import { TOKEN, RULES, CRAFTSMEN } from '../server/world.js';

EventEmitter.defaultMaxListeners = 50; // many requests in a row over one connection: not a leak
const args = process.argv.slice(2);
const WITH_AI = args.includes('--ai');
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const DAYS = nums[0] || 100;
let SEED = nums[1] || 42;
const SPREAD = args.includes('--spread');
const r2 = (n) => Math.round(n * 100) / 100;
const WATCH = [['bakery', 'bread', 'sells'], ['mill', 'flour', 'sells'], ['smithy', 'sword', 'sells'], ['tailor', 'coat', 'sells'],
  ['mill', 'wheat', 'buys'], ['smithy', 'ore', 'buys'], ['woodcutter', 'wood', 'buys'], ['tailor', 'wool', 'buys']];
const EVENT_KEYS = { 'log.drought': 'droughts', 'log.winter': 'winters', 'log.smoke': 'dragon warnings', 'log.repelled': 'dragon attacks repelled',
  'log.burned': 'dragon attacks that did damage', 'log.upgraded': 'workshop upgrades', 'log.bailout': 'treasury rescues of a shop',
  'log.newShop': 'new shops opened', 'log.towerBuilt': 'watchtowers built', 'log.districtOpen': 'neighbourhoods opened', 'log.settler': 'newcomer families', 'log.proposal': 'council proposals' };
const kind = (why) => {
  const w = String(why || 'other').replace(/^Emberwick:?\s*/, '');
  if (/^village record/.test(w)) return 'daily village record on NEAR';
  if (/^AI plan/.test(w)) return 'AI plan record on NEAR';
  if (/^council #\d+: payout/.test(w)) return 'council payout to villagers';
  if (/^council #\d+/.test(w)) return 'council decisions';
  return w.replace(/\s*#?\d+(\.\d+)?/g, '').split(/[:(,]/)[0].trim().slice(0, 40);
};

// one run of the village; plan(state) is called every village morning when given
async function run(plan) {
  const state = createState(SEED);
  const priceOf = (npc, g, side) => (state.npcs[npc] && state.npcs[npc][side][g]) || null;
  const prices = Object.fromEntries(WATCH.map(([n, g, s]) => [`${n}.${g}.${s}`, { start: priceOf(n, g, s), min: Infinity, max: 0, moves: 0, last: priceOf(n, g, s) }]));
  const shopIds = CRAFTSMEN.map((c) => c.id).filter((id) => state.npcs[id]);
  const shops = Object.fromEntries(shopIds.map((id) => [id, { start: r2(balance(state, 'npc:' + id)), min: Infinity, sales: 0, empty: 0 }]));
  const treasuryStart = r2(balance(state, 'treasury'));
  const botStart = Object.entries(state.balances).filter(([k]) => k.startsWith('bot:')).map(([, v]) => v);
  let moved = 0, transfers = 0, lastLedger = state.ledgerSeq || 0, maxDrift = 0, plans = 0, planFails = 0;
  const treasuryIn = {}, treasuryOut = {}, events = {};
  let lastLog = state.log[0];
  for (let t = 0; t < RULES.ticksPerDay * DAYS; t++) {
    if (plan && t % RULES.ticksPerDay === 0) { // a village morning: the same NEAR AI plan the game asks for
      try { const p = await plan(state); if (p && applyAiPlan(state, p.plan, p.model, p.extra)) plans++; else planFails++; } catch { planFails++; }
    }
    tick(state);
    for (const e of state.ledger) {
      if (e.id <= lastLedger) continue;
      moved += e.amount; transfers++;
      if (e.to === 'treasury') treasuryIn[kind(e.why)] = (treasuryIn[kind(e.why)] || 0) + e.amount;
      if (e.from === 'treasury') treasuryOut[kind(e.why)] = (treasuryOut[kind(e.why)] || 0) + e.amount;
      const shop = e.to.startsWith('npc:') && shops[e.to.slice(4)];
      if (shop && !e.from.startsWith('npc:') && e.from !== 'treasury') shop.sales += e.amount; // money from customers
    }
    lastLedger = state.ledgerSeq || 0;
    for (const l of state.log) { if (l === lastLog) break; if (EVENT_KEYS[l.key]) events[EVENT_KEYS[l.key]] = (events[EVENT_KEYS[l.key]] || 0) + 1; }
    lastLog = state.log[0];
    for (const [n, g, s] of WATCH) {
      const p = priceOf(n, g, s), x = prices[`${n}.${g}.${s}`];
      if (p) { x.min = Math.min(x.min, p); x.max = Math.max(x.max, p); if (x.last && p !== x.last) x.moves += Math.abs(p / x.last - 1); x.last = p; }
    }
    for (const id of shopIds) {
      const n = state.npcs[id];
      shops[id].min = Math.min(shops[id].min, balance(state, 'npc:' + id));
      for (const g of Object.keys(n.sells || {})) if ((n.stock[g] || 0) < 1) shops[id].empty++; // a shelf with nothing to sell
    }
    maxDrift = Math.max(maxDrift, Math.abs(totalMoney(state) - TOKEN.totalSupply));
  }
  const botEnd = Object.entries(state.balances).filter(([k]) => k.startsWith('bot:')).map(([, v]) => v);
  for (const id of shopIds) shops[id].end = r2(balance(state, 'npc:' + id));
  return { state, prices, priceOf, shops, shopIds, treasuryStart, treasuryEnd: r2(balance(state, 'treasury')), treasuryIn, treasuryOut, botStart, botEnd, moved, transfers, maxDrift, events, plans, planFails };
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const row = (...c) => '| ' + c.join(' | ') + ' |';
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ') || 'none';
const hours = (ticks) => Math.round((ticks / RULES.ticksPerDay) * 24); // shelf-empty time in village hours
const shopName = (id) => (id === 'tower' ? 'tower (guard; paid daily by the treasury, spends it on swords and bread)' : id);

function single(r) {
  const out = [];
  out.push(`Emberwick economy report: ${DAYS} village days, seed ${SEED}, no players, no NEAR AI, nobody touching prices`, '');
  out.push('| Measure | Result |', '|---|---|');
  out.push(row('Money supply (EMWK)', `${TOKEN.totalSupply} at the start, ${r2(totalMoney(r.state))} at the end; largest drift during the run ${r2(r.maxDrift)}`));
  out.push(row('Money moved', `${Math.round(r.moved)} EMWK in ${r.transfers} transfers (${Math.round(r.moved / DAYS)} EMWK a day)`));
  out.push(row('Treasury', `${Math.round(r.treasuryStart)} → ${Math.round(r.treasuryEnd)} EMWK; in: ${top(r.treasuryIn)}; out: ${top(r.treasuryOut)}`));
  out.push(row('Villagers (12 bots), average purse', `${Math.round(avg(r.botStart))} → ${Math.round(avg(r.botEnd))} EMWK (richest ${Math.round(Math.max(...r.botEnd))}, poorest ${Math.round(Math.min(...r.botEnd))})`));
  out.push(row('Village events', Object.entries(r.events).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none'));
  out.push('', '| Shop | Wallet start → end (EMWK) | Lowest point | Workshop level |', '|---|---|---|---|');
  for (const id of r.shopIds) out.push(row(shopName(id), `${Math.round(r.shops[id].start)} → ${Math.round(r.shops[id].end)}`, Math.round(r.shops[id].min), r.state.npcs[id].level || 1));
  out.push('', '| Price (EMWK) | Start | End | Low | High |', '|---|---|---|---|---|');
  for (const [n, g, s] of WATCH) { const x = r.prices[`${n}.${g}.${s}`]; out.push(row(`${g} (${n} ${s === 'sells' ? 'sells' : 'pays'})`, Math.round(x.start), Math.round(r.priceOf(n, g, s)), Math.round(x.min), Math.round(x.max))); }
  return out.join('\n');
}

function compare(a, b, model) {
  const out = [];
  const sum = (r, k) => r.shopIds.filter((id) => id !== 'tower').reduce((s, id) => s + r.shops[id][k], 0);
  const profit = (r) => r.shopIds.filter((id) => id !== 'tower').reduce((s, id) => s + (r.shops[id].end - r.shops[id].start), 0);
  const swing = (r) => avg(WATCH.map(([n, g, s]) => r.prices[`${n}.${g}.${s}`].moves)) * 100;
  out.push(`Emberwick: rules only vs NEAR AI plans. ${DAYS} village days, seed ${SEED}, no players. AI run: ${b.plans} morning plans by ${model}${b.planFails ? `, ${b.planFails} mornings without a plan` : ''}.`, '');
  out.push('| Measure (7 shops, tower left out) | Rules only | With NEAR AI | Change |', '|---|---|---|---|');
  out.push(row('Shops\' combined profit (EMWK)', Math.round(profit(a)), Math.round(profit(b)), `${profit(b) - profit(a) >= 0 ? '+' : ''}${Math.round(profit(b) - profit(a))}`));
  out.push(row('Sales income from customers (EMWK)', Math.round(sum(a, 'sales')), Math.round(sum(b, 'sales')), `${sum(b, 'sales') - sum(a, 'sales') >= 0 ? '+' : ''}${Math.round(sum(b, 'sales') - sum(a, 'sales'))}`));
  out.push(row('Empty-shelf time (village hours, all goods)', hours(sum(a, 'empty')), hours(sum(b, 'empty')), `${hours(sum(b, 'empty')) - hours(sum(a, 'empty')) >= 0 ? '+' : ''}${hours(sum(b, 'empty')) - hours(sum(a, 'empty'))}`));
  out.push(row('Price swings (sum of moves, watched goods)', `${Math.round(swing(a))}%`, `${Math.round(swing(b))}%`, `${Math.round(swing(b) - swing(a))} pts`));
  out.push(row('Treasury at the end (EMWK)', Math.round(a.treasuryEnd), Math.round(b.treasuryEnd), `${Math.round(b.treasuryEnd - a.treasuryEnd)}`));
  out.push(row('Villagers\' average purse at the end (EMWK)', Math.round(avg(a.botEnd)), Math.round(avg(b.botEnd)), `${Math.round(avg(b.botEnd) - avg(a.botEnd))}`));
  out.push(row('Money supply at the end (EMWK)', r2(totalMoney(a.state)), r2(totalMoney(b.state)), 'fixed'));
  out.push('', '| Shop | Profit, rules (EMWK) | Profit, NEAR AI (EMWK) | Empty shelf, rules (h) | Empty shelf, NEAR AI (h) |', '|---|---|---|---|---|');
  for (const id of a.shopIds) out.push(row(shopName(id), Math.round(a.shops[id].end - a.shops[id].start), Math.round(b.shops[id].end - b.shops[id].start), hours(a.shops[id].empty), hours(b.shops[id].empty)));
  return out.join('\n') + '\n\nSame seed for both runs: the only difference is the NEAR AI morning plan.';
}

// --spread: the same rules-only village from 10 different seeds, to show how much results vary by chance
if (SPREAD) {
  const rows = [];
  for (let k = 0; k < 10; k++) {
    SEED = 42 + k;
    const r = await run(null), shops7 = r.shopIds.filter((id) => id !== 'tower');
    rows.push({ seed: SEED, profit: shops7.reduce((a, id) => a + r.shops[id].end - r.shops[id].start, 0), sales: shops7.reduce((a, id) => a + r.shops[id].sales, 0), empty: hours(shops7.reduce((a, id) => a + r.shops[id].empty, 0)), purse: avg(r.botEnd) });
  }
  const stat = (k) => { const v = rows.map((x) => x[k]); return `${Math.round(Math.min(...v))} to ${Math.round(Math.max(...v))} (average ${Math.round(avg(v))})`; };
  console.log(`Emberwick: rules only, ${DAYS} village days, seeds 42 to 51, no players. How much the results vary by chance:\n`);
  console.log('| Measure (7 shops, tower left out) | Range over 10 seeds |\n|---|---|');
  console.log(row('Shops\' combined profit (EMWK)', stat('profit')));
  console.log(row('Sales income from customers (EMWK)', stat('sales')));
  console.log(row('Empty-shelf time (village hours)', stat('empty')));
  console.log(row('Villagers\' average purse at the end (EMWK)', stat('purse')));
  process.exit(0);
}
const rules = await run(null);
if (!WITH_AI) { console.log(single(rules)); process.exit(0); }

const AI = await import('../server/ai.js');
const quiet = console.log; console.log = (...m) => { if (!String(m[0]).startsWith('[AI]') || /error|fail|not|skip/i.test(String(m[0]))) quiet(...m); };
await AI.startAi();
console.log = quiet;
if (AI.ai.status !== 'ready') { console.log(`NEAR AI is not available (${AI.ai.lastError || AI.ai.status}). Set NEARAI_API_KEY or put the key in ~/.emberwick/nearai-key.txt.`); process.exit(1); }
console.error(`Running ${DAYS} village days with a NEAR AI plan every morning (${AI.ai.model}). This takes a few minutes…`);
let n = 0;
const withAi = await run(async (state) => {
  const plan = await AI.planDay(aiBrief(state));
  if (++n % 10 === 0) console.error(`  day ${n}/${DAYS}`);
  return plan ? { plan, model: AI.ai.model, extra: { tee: !!AI.ai.tee } } : null;
});
console.log(compare(rules, withAi, AI.ai.model));
process.exit(0);
