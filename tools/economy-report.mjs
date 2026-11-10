// Emberwick economy report: runs the village for 100 game days with no players and no one
// touching prices, then prints what happened. Same seed, same result: `npm run report`.
//
// `npm run report -- --ai` runs the same village twice from the same seed: once on the
// craftsmen's rules alone, once with a NEAR AI morning plan every village day (exactly the
// call the game makes), and compares the two. It needs a NEAR AI key (NEARAI_API_KEY or
// ~/.emberwick/nearai-key.txt) and makes one request per village day (100 requests).
import { EventEmitter } from 'node:events';
import { createState, tick, totalMoney, balance, aiBrief, applyAiPlan, joinPlayer, playerAction, isNight, innFree, sellQuote } from '../server/economy.js';
import { TOKEN, RULES, CRAFTSMEN, GATHER_SPOTS } from '../server/world.js';

EventEmitter.defaultMaxListeners = 50; // many requests in a row over one connection: not a leak
const args = process.argv.slice(2);
const WITH_AI = args.includes('--ai');
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const DAYS = nums[0] || 100;
let SEED = nums[1] || 42;
const SPREAD = args.includes('--spread');
const CROWD = args.includes('--players');
let PLAYERS = 0;
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
  const crowd = PLAYERS ? newCrowd(state, PLAYERS) : null;
  for (let t = 0; t < RULES.ticksPerDay * DAYS; t++) {
    if (crowd) crowd.step(t);
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
  return { state, crowd: crowd && crowd.result(), prices, priceOf, shops, shopIds, treasuryStart, treasuryEnd: r2(balance(state, 'treasury')), treasuryIn, treasuryOut, botStart, botEnd, moved, transfers, maxDrift, events, plans, planFails };
}

// ---------- scripted players (npm run report -- --players) ----------
// They play the way a simple, careful player would: work with their tool, sell to the best buyer,
// eat when tired, sleep at the inn when they can afford it, buy a coat in winter, replace a broken
// tool, and apprentices look for a job. They are not real people: they never haggle, trade land,
// rent homes or use the exchange, so the results show the village's basic loop under load.
const TOOL_SHOP = { pickaxe: 'smithy', axe: 'woodcutter', plow: 'mill', shears: 'tailor', rod: 'carpenter' };
const TOOL_SPOT = { pickaxe: 'mine', axe: 'forest', plow: 'fields', shears: 'pasture', rod: 'pond' };
const PATHS = ['miner', 'woodcutter', 'farmer', 'apprentice'];
const START_COINS = { miner: 50, woodcutter: 50, farmer: 50, apprentice: 80 };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function newCrowd(state, n) {
  const rnd = mulberry(SEED * 7919 + n);
  const ids = [], start = {}, joinTick = [];
  const m = { mornings: 0, unfed: 0, unfedMoney: 0, playerDays: 0, hungryDays: 0, creditDays: 0, nights: 0, innNights: 0, toolsBought: 0, toolless: 0, workTries: 0, noDemand: 0, innFull: 0, actions: 0 };
  const days = {}; // per player and day: { hungry, credit }
  for (let k = 0; k < n; k++) joinTick.push(Math.floor(rnd() * RULES.ticksPerDay * Math.min(10, DAYS / 2))); // they arrive over the first days
  const coins = (id) => balance(state, 'player:' + id);
  const inv = (p, g) => (p.inv && p.inv[g]) || 0;
  const act = (id, a) => { m.actions++; return playerAction(state, id, a); };
  const dayOf = (id) => { const k = id + ':' + state.day; if (!days[k]) { days[k] = {}; m.playerDays++; } return days[k]; };
  const RAW = Object.values(GATHER_SPOTS).map((x) => x.good);
  const buyersOf = (g) => Object.values(state.npcs).filter((x) => x.buys && x.buys[g] !== undefined && sellQuote(state, x.id, g, 1).qty > 0).sort((a, b) => b.buys[g] - a.buys[g]);
  const bestPrice = (g) => { const b = buyersOf(g)[0]; return b ? b.buys[g] : 0; };
  function feed(id, p) {
    if (inv(p, 'bread') > 0 && act(id, { type: 'eat' }).ok) return true;
    const price = state.npcs.bakery.sells.bread;
    if (coins(id) >= price + 1 && act(id, { type: 'buy', npc: 'bakery', good: 'bread', qty: 1 }).ok && act(id, { type: 'eat' }).ok) return true;
    if (act(id, { type: 'credit', npc: 'bakery', qty: 1 }).ok) { const d = dayOf(id); if (!d.credit) { d.credit = 1; m.creditDays++; } return act(id, { type: 'eat' }).ok; }
    return false;
  }
  function day(id, p) {
    const d = dayOf(id);
    if (p.path === 'apprentice' && !p.job) {
      for (const o of Object.values(state.jobOffers || {})) if (act(id, { type: 'apply', npc: o.npc }).ok) break;
    }
    if (p.job) {
      const r = act(id, { type: 'shift' });
      if (!r.ok && r.code === 'err.tired' && !feed(id, p) && !d.hungry) { d.hungry = 1; m.hungryDays++; }
      if (r.ok || r.code !== 'err.shiftDone') return;
    }
    // winter: a coat keeps outdoor work cheap
    if (state.events.winter && !inv(p, 'coat') && coins(id) > state.npcs.tailor.sells.coat + 20) act(id, { type: 'buy', npc: 'tailor', good: 'coat', qty: 1 });
    const tool = Object.keys(TOOL_SPOT).find((t) => inv(p, t) > 0 && !(state.events.winter && TOOL_SPOT[t] === 'fields'));
    if (!tool) {
      // a broken or missing tool: buy the one that pays best today, if affordable
      const opts = Object.keys(TOOL_SPOT).filter((t) => state.npcs[TOOL_SHOP[t]] && state.npcs[TOOL_SHOP[t]].sells[t] && (state.npcs[TOOL_SHOP[t]].stock[t] || 0) > 0 && coins(id) >= state.npcs[TOOL_SHOP[t]].sells[t] + 3)
        .filter((t) => !(state.events.winter && TOOL_SPOT[t] === 'fields'))
        .filter((t) => buyersOf(GATHER_SPOTS[TOOL_SPOT[t]].good).length)
        .sort((a, b) => state.npcs[TOOL_SHOP[a]].sells[a] - state.npcs[TOOL_SHOP[b]].sells[b]);
      if (opts.length && act(id, { type: 'buy', npc: TOOL_SHOP[opts[0]], good: opts[0], qty: 1 }).ok) m.toolsBought++;
      else { if (!d.toolless) { d.toolless = 1; m.toolless++; } if (!p.job) for (const o of Object.values(state.jobOffers || {})) if (act(id, { type: 'apply', npc: o.npc }).ok) break; return; }
    }
    // sell what they carry to whoever still wants it, best price first
    for (const g of RAW) {
      let have = inv(p, g);
      if (!have) continue;
      for (const b of buyersOf(g)) { if (have < 1) break; const r = act(id, { type: 'sell', npc: b.id, good: g, qty: have }); if (r.ok) have = inv(p, g); }
    }
    // work with a tool whose good someone still buys; carrying a pile nobody wants is pointless
    const usable = Object.keys(TOOL_SPOT).filter((t) => inv(p, t) > 0 && !(state.events.winter && TOOL_SPOT[t] === 'fields'))
      .map((t) => ({ t, spot: TOOL_SPOT[t], good: GATHER_SPOTS[TOOL_SPOT[t]].good }))
      .filter((x) => inv(p, x.good) < 6 && buyersOf(x.good).length)
      .sort((a, b) => bestPrice(b.good) * (GATHER_SPOTS[b.spot].base + 0.5) / GATHER_SPOTS[b.spot].energy - bestPrice(a.good) * (GATHER_SPOTS[a.spot].base + 0.5) / GATHER_SPOTS[a.spot].energy);
    m.workTries++;
    if (!usable.length) { m.noDemand++; return; }
    const spot = usable[0].spot;
    const r = act(id, { type: 'gather', spot });
    if (!r.ok && r.code === 'err.tired') {
      if (feed(id, p)) act(id, { type: 'gather', spot });
      else if (!d.hungry) { d.hungry = 1; m.hungryDays++; }
    }
  }
  function night(id, p) {
    if (p.sleep && p.sleep.day === state.day) return;
    const d = dayOf(id);
    if (d.nightDone) return;
    d.nightDone = 1; m.nights++;
    if (coins(id) < RULES.innBed + 3) return;
    if (innFree(state) < 1) { m.innFull++; return; }
    if (act(id, { type: 'sleep', place: 'inn' }).ok) m.innNights++;
  }
  return {
    step(t) {
      if (t % RULES.ticksPerDay === 1) for (const id of ids) { const f = id && state.players[id].food; if (f && f.day === state.day) { m.mornings++; if (f.missing > 0) { m.unfed++; if (f.why === 'money') m.unfedMoney++; } } }
      for (let k = ids.length; k < n && joinTick[k] <= t; k++) {
        const r = joinPlayer(state, 'Sim' + k, PATHS[k % PATHS.length]);
        if (r.ok) { ids.push(r.id); start[r.id] = coins(r.id); } else ids.push(null);
      }
      const dark = isNight(state);
      for (const id of ids) {
        if (!id) continue;
        const p = state.players[id];
        if (dark) { if (rnd() < 0.5) night(id, p); continue; }
        if (rnd() < (Number(process.env.CROWD_ACTIVE) || 0.3)) day(id, p); // nobody plays every minute
      }
    },
    result() {
      const live = ids.filter(Boolean);
      const end = live.map((id) => coins(id)), gain = live.map((id) => coins(id) - start[id]);
      const sorted = [...end].sort((a, b) => a - b);
      const top10 = sorted.slice(-Math.max(1, Math.round(sorted.length / 10))).reduce((a, b) => a + b, 0), total = sorted.reduce((a, b) => a + b, 0);
      return { n: live.length, wanted: n, startAvg: avg(live.map((id) => start[id])), endAvg: avg(end), gainAvg: avg(gain), richest: sorted[sorted.length - 1] || 0, poorest: sorted[0] || 0,
        fullStart: live.filter((id) => start[id] >= START_COINS[state.players[id].path] - 0.01).length,
        losers: gain.filter((g) => g < 0).length, top10Share: total > 0 ? top10 / total : 0, ...m,
        debug: process.env.CROWD_DEBUG ? live.map((id) => { const p = state.players[id]; return `${p.path} c${Math.round(coins(id))} job:${p.job ? p.job.npc : '-'} inv:${JSON.stringify(p.inv)} e${p.energy}`; }) : null };
    },
  };
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

// --players: the same village with 0, 10, 30 and 100 scripted players, each from 5 seeds
if (CROWD) {
  const sizes = nums.length > 1 ? nums.slice(1) : [0, 10, 30, 100];
  const seeds = [42, 43, 44, 45, 46];
  const pct = (x) => `${Math.round(x * 100)}%`, span = (v, f = (x) => Math.round(x)) => (Math.min(...v) === Math.max(...v) ? `${f(v[0])}` : `${f(Math.min(...v))} to ${f(Math.max(...v))}`);
  const res = {};
  for (const n of sizes) {
    PLAYERS = n; res[n] = [];
    for (const sd of seeds) {
      SEED = sd;
      const r = await run(null), shops7 = r.shopIds.filter((id) => id !== 'tower');
      res[n].push({ r, shops7, profit: shops7.reduce((a, id) => a + r.shops[id].end - r.shops[id].start, 0), broke: shops7.filter((id) => r.shops[id].min < 25).length,
        rescues: r.events['treasury rescues of a shop'] || 0, swing: avg(WATCH.map(([a, g, s]) => r.prices[`${a}.${g}.${s}`].moves)) * 100,
        bread: r.priceOf('bakery', 'bread', 'sells'), ore: r.priceOf('smithy', 'ore', 'buys'), wood: r.priceOf('woodcutter', 'wood', 'buys'), purse: avg(r.botEnd) });
      console.error(`  ${n} players, seed ${sd} done`);
    }
  }
  const out = [];
  out.push(`Emberwick with scripted players: ${DAYS} village days, seeds 42 to 46 for each size, no NEAR AI. Ranges are over the 5 seeds.`, '');
  out.push(`| Measure | ${sizes.map((n) => `${n} players`).join(' | ')} |`, `|---|${sizes.map(() => '---').join('|')}|`);
  const line = (name, f) => out.push(row(name, ...sizes.map((n) => f(res[n]))));
  const C = (x) => x.r.crowd;
  line('Treasury at the end (EMWK, started at 9600)', (a) => span(a.map((x) => x.r.treasuryEnd)));
  line('Shops whose wallet fell below 25 EMWK (of 7)', (a) => span(a.map((x) => x.broke)));
  line('Treasury: biggest flows (seed 42)', (a) => `in: ${top(a[0].r.treasuryIn).split(' · ').slice(0, 3).join(' · ')}; out: ${top(a[0].r.treasuryOut).split(' · ').slice(0, 3).join(' · ')}`);
  line('Treasury rescues of a shop', (a) => span(a.map((x) => x.rescues)));
  line('Shops\' combined profit (EMWK)', (a) => span(a.map((x) => x.profit)));
  line('Price swings (watched goods)', (a) => span(a.map((x) => x.swing), (v) => `${Math.round(v)}%`));
  line('Bread price at the end (bakery sells)', (a) => span(a.map((x) => x.bread)));
  line('Ore price at the end (smith pays)', (a) => span(a.map((x) => x.ore)));
  line('Wood price at the end (woodcutter pays)', (a) => span(a.map((x) => x.wood)));
  line('Villagers\' (12 bots) average purse at the end', (a) => span(a.map((x) => x.purse)));
  if (sizes.some((n) => n > 0)) {
    const P = (f) => (a) => (C(a[0]) && C(a[0]).n ? f(a) : '–');
    line('Players who got their full starting money', P((a) => span(a.map((x) => C(x).fullStart / C(x).n), pct)));
    line('Player\'s average coins: start → end', P((a) => `${Math.round(avg(a.map((x) => C(x).startAvg)))} → ${span(a.map((x) => C(x).endAvg))}`));
    line('Richest / poorest player at the end', P((a) => `${span(a.map((x) => C(x).richest))} / ${span(a.map((x) => C(x).poorest))}`));
    line('Share of all player coins held by the richest 10%', P((a) => span(a.map((x) => C(x).top10Share), pct)));
    line('Players who ended with less than they started with', P((a) => span(a.map((x) => C(x).losers / C(x).n), pct)));
    line('Player-days with a hungry moment (tired, no bread, no money, no credit)', P((a) => span(a.map((x) => C(x).hungryDays / Math.max(1, C(x).playerDays)), pct)));
    line('Mornings without the day\'s food (2 bread): bakery sold out', P((a) => span(a.map((x) => (C(x).unfed - C(x).unfedMoney) / Math.max(1, C(x).mornings)), pct)));
    line('Mornings without the day\'s food: no money', P((a) => span(a.map((x) => C(x).unfedMoney / Math.max(1, C(x).mornings)), pct)));
    line('Player-days fed on credit', P((a) => span(a.map((x) => C(x).creditDays / Math.max(1, C(x).playerDays)), pct)));
    line('Nights in an inn bed (the rest sleep outside)', P((a) => span(a.map((x) => C(x).innNights / Math.max(1, C(x).nights)), pct)));
    line('Nights a player could pay but the inn was full', P((a) => span(a.map((x) => C(x).innFull / Math.max(1, C(x).nights)), pct)));
    line('Work turns with nothing worth gathering (shops already full of it)', P((a) => span(a.map((x) => C(x).noDemand / Math.max(1, C(x).workTries)), pct)));
    line('Player-days without a tool and no money to buy one', P((a) => span(a.map((x) => C(x).toolless / Math.max(1, C(x).playerDays)), pct)));
  }
  if (process.env.CROWD_DEBUG) for (const n of sizes) console.log(res[n][0].r.crowd && res[n][0].r.crowd.debug && res[n][0].r.crowd.debug.join('\n'));
  console.log(out.join('\n'));
  console.log('\nScripted players: they gather with their tool, sell to the best buyer, eat when tired, sleep at the inn when they can, buy a coat in winter and replace broken tools; apprentices look for a job. They do not haggle, trade land, rent homes or use the exchange.');
  process.exit(0);
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
