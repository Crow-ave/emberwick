import crypto from 'node:crypto';
// The Emberwick economy engine.
// All money lives in one ledger (state.balances). Money only ever moves between
// accounts, so the total always equals TOKEN.totalSupply. This mirrors how the
// EMWK token will behave on NEAR.

import { levelPrice, stepTowards, priceReasons, WANT_FACTOR, USE_UP } from './pricing.js';
import { TOKEN, GENESIS, GOODS, GATHER_SPOTS, CRAFTSMEN, START_PATHS, RULES, QUESTS, PATH_ROUTE, BUILDINGS, SKILL_OF, SKILLS, JOBS, HOUSES, COUNCIL, LAND, DISTRICTS, CENTRE_FACTOR, MARKET } from './world.js';

const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function createState(seed = Date.now()) {
  const state = {
    version: 1,
    seed,
    tick: 0,
    day: 1,
    balances: {
      treasury: GENESIS.treasury,
      newcomerFund: GENESIS.newcomerFund,
      adventurerFund: GENESIS.adventurerFund,
      botFund: 0,
    },
    npcs: {},
    players: {},
    bots: {},
    events: { drought: 0, dragon: 0, winter: false, attackDay: null },
    readiness: 0,
    history: {},
    log: [],
    nextId: 1,
  };
  for (const c of CRAFTSMEN) {
    state.balances['npc:' + c.id] = c.wallet;
    state.npcs[c.id] = {
      id: c.id,
      buys: { ...c.buys },
      sells: { ...c.sells },
      base: { ...c.buys, ...c.sells },
      stock: { ...c.stock },
      damagedUntil: 0,
      mood: c.lines[0],
    };
  }
  // Twelve bot villagers keep the village busy in the demo.
  const botNames = ['Ada', 'Bo', 'Cora', 'Dex', 'Elin', 'Finn', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lea'];
  const paths = ['farmer', 'miner', 'woodcutter'];
  const each = GENESIS.botFund / botNames.length;
  botNames.forEach((name, n) => {
    const id = 'b' + (n + 1);
    const path = paths[n % 3];
    state.bots[id] = { id, name, path, energy: RULES.energyMax, inv: { ...START_PATHS[path].items } };
    state.balances['bot:' + id] = each;
  });
  for (const g of Object.keys(GOODS)) state.history[g] = [];
  ensureContracts(state);
  addLog(state, 'The embers of Emberwick are lit again. Newcomers are welcome at the gate.', 'info', 'log.start');
  return state;
}

// ---------- ledger ----------

export function balance(state, acct) {
  return state.balances[acct] || 0;
}

// Something outside the game (the NEAR bridge) can watch every money move.
const watchers = [];
export function onTransfer(fn) { watchers.push(fn); }
// ...and other events that belong on chain, such as a new land deed
const eventWatchers = [];
export function onGameEvent(fn) { eventWatchers.push(fn); }
const emit = (type, data) => { for (const w of eventWatchers) w(type, data); };

export function transfer(state, from, to, amount, note = null) {
  amount = r2(amount);
  if (amount <= 0) return true;
  if (balance(state, from) + 1e-9 < amount) return false;
  state.balances[from] = r2(balance(state, from) - amount);
  state.balances[to] = r2(balance(state, to) + amount);
  if (from === 'treasury' || to === 'treasury') noteTreasury(state, from === 'treasury' ? 'out' : 'in', from === 'treasury' ? to : from, amount, note);
  // the village's money history: every transfer, with why it happened (kept for the last 3000)
  const why = (note && (note.why || (note.memo && String(note.memo).replace(/^Emberwick( council #\d+)?: /, '')))) || 'transfer';
  state.ledger = state.ledger || [];
  state.ledgerSeq = (state.ledgerSeq || 0) + 1;
  state.ledger.push({ id: state.ledgerSeq, day: state.day, from, to, amount, why: String(why).slice(0, 120) });
  if (state.ledger.length > 3000) state.ledger.splice(0, state.ledger.length - 3000);
  note = { ...(note || {}), ref: state.ledgerSeq };
  for (const w of watchers) w(from, to, amount, note);
  return true;
}

// the market fee: 2%, and 0.1 point lower for every village seal on the council wall (at least 1%)
export const SEAL_CUT = 0.001, SEAL_MAX = 10;
export const marketFee = (state) => Math.round(Math.max(MARKET.fee - SEAL_CUT * SEAL_MAX, MARKET.fee - SEAL_CUT * Math.min(SEAL_MAX, state.sealCount || 0)) * 1000) / 1000;
// a real swap gives its player one village seal (a split gives one for all its parts)
export function giveSeal(state, playerId, key) {
  const p = state.players[playerId];
  if (!p) return false;
  p.sealsFrom = p.sealsFrom || [];
  if (p.sealsFrom.includes(key)) return false;
  p.sealsFrom = [...p.sealsFrom, key].slice(-60);
  p.inv = p.inv || {};
  p.inv.seal = (p.inv.seal || 0) + 1;
  return true;
}

// the money history of one account (a player, a craftsman, the treasury, a fund), newest first
export function moneyHistory(state, acct, limit = 60) {
  const out = [];
  const L = state.ledger || [];
  for (let k = L.length - 1; k >= 0 && out.length < limit; k--) {
    const e = L[k];
    if (e.from === acct || e.to === acct) out.push({ ...e, dir: e.to === acct ? 'in' : 'out', other: e.to === acct ? e.from : e.to });
  }
  return out;
}

// ---------- the treasury's books: what came in, what went out, and to whom ----------
const flowKind = (who) => who.startsWith('player:') || who.startsWith('bot:') ? 'villagers' : who === 'npc:tower' ? 'guards' : who.startsWith('npc:') ? 'craftsmen'
  : who === 'newcomerFund' ? 'newcomers' : who === 'adventurerFund' ? 'travellers' : who === 'deposits' ? 'deposits' : 'other';
// money in the treasury that may not be spent: the fixed reserve plus what the council set aside
export function heldReserve(state) { return r2((state.reserveHolds || []).reduce((a, h) => a + h.amount, 0)); }
export function lockedFunds(state) { return RULES.treasuryReserve + heldReserve(state); }

// ---------- the live NEAR price (from NEAR Intents) and what it does to the village ----------
export function setOracle(state, usd) {
  if (!(usd > 0)) return;
  const o = (state.oracle = state.oracle || { days: {} });
  o.usd = usd; o.at = Date.now();
  o.days[state.day] = usd;
  for (const d of Object.keys(o.days)) if (Number(d) < state.day - 7) delete o.days[d];
  const past = Object.entries(o.days).filter(([d]) => Number(d) < state.day).map(([, v]) => v);
  o.ref = past.length ? past.reduce((a, v) => a + v, 0) / past.length : (o.ref || usd);
}
// travellers pay with NEAR: when NEAR is up against its 7-day average, they pay more for the village's goods
export function oracleFactor(state) {
  const o = state.oracle;
  if (!o || !o.usd || !o.ref) return 1;
  return Math.round(Math.min(RULES.oracle.max, Math.max(RULES.oracle.min, o.usd / o.ref)) * 1000) / 1000;
}

function noteTreasury(state, dir, who, amount, note) {
  const day = state.day;
  const b = (state.tBooks = state.tBooks || { days: {}, recent: [] });
  const d = (b.days[day] = b.days[day] || { in: {}, out: {} });
  const k = flowKind(who);
  d[dir][k] = r2((d[dir][k] || 0) + amount);
  for (const old of Object.keys(b.days)) if (Number(old) < day - 6) delete b.days[old];
  if (amount >= 1) { // small market taxes are summed per day, not listed one by one
    b.recent.unshift({ day, dir, who, amount: r2(amount), memo: note && note.memo ? String(note.memo).replace(/^Emberwick( council #\d+)?: ?/, '').slice(0, 80) : null });
    b.recent.length = Math.min(b.recent.length, 12);
  }
}
function treasuryView(state) {
  const b = state.tBooks || { days: {}, recent: [] };
  const name = (who) => who.startsWith('player:') ? (state.players[who.slice(7)] || {}).name || '?' : who.startsWith('bot:') ? (state.bots[who.slice(4)] || {}).name || '?' : who;
  const week = { in: {}, out: {} };
  for (const d of Object.values(b.days)) for (const dir of ['in', 'out']) for (const [k, v] of Object.entries(d[dir])) week[dir][k] = r2((week[dir][k] || 0) + v);
  const days = Object.keys(b.days).map(Number).sort((a, c) => a - c).map((day) => {
    const d = b.days[day], sum = (o) => r2(Object.values(o).reduce((a, v) => a + v, 0));
    return { day, in: sum(d.in), out: sum(d.out) };
  });
  return {
    balance: r2(balance(state, 'treasury')), reserve: RULES.treasuryReserve, held: heldReserve(state), holds: (state.reserveHolds || []).map((h) => ({ ...h })), spare: r2(Math.max(0, balance(state, 'treasury') - lockedFunds(state))),
    tax: taxRate(state), week, days, recent: b.recent.map((x) => ({ ...x, name: name(x.who) })),
  };
}

// ---------- NEAR wallet link and cash-out ----------

const NEAR_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function validNearId(id) { return NEAR_ID.test(String(id || '')); }

// the NEAR bridge reports where a land deed now is
export function setDeed(state, plotId, info) {
  const plot = state.plots && state.plots[plotId];
  if (!plot || !plot.deed) return;
  Object.assign(plot.deed, info);
  state.rev = (state.rev || 0) + 1;
}

export function linkWallet(state, playerId, accountId, verified = false) {
  const p = state.players[playerId];
  if (!p) return { ok: false, error: 'Unknown player.', code: 'err.unknownPlayer' };
  accountId = String(accountId || '').trim().toLowerCase();
  if (!validNearId(accountId) || !accountId.endsWith('.testnet') && !/^[0-9a-f]{64}$/.test(accountId)) {
    return { ok: false, error: 'That is not a NEAR testnet account.', code: 'err.badWallet' };
  }
  // one NEAR wallet, one character: the same wallet cannot collect several characters' coins
  const other = Object.values(state.players).find((q) => q.id !== p.id && q.near === accountId);
  if (other) return { ok: false, error: 'That NEAR wallet is already linked to another villager.', code: 'err.walletUsed' };
  // a wallet the player proved is theirs can only be replaced by another signed one
  if (p.near && p.nearVerified && !verified && accountId !== p.near) return { ok: false, error: 'Your verified wallet can only be changed by signing with the new one.', code: 'err.walletLocked' };
  if (p.near === accountId && p.nearVerified && !verified) return { ok: true, near: accountId }; // never downgrade a signed link
  p.near = accountId;
  p.nearVerified = !!verified;
  state.rev = (state.rev || 0) + 1;
  addLog(state, `${p.name} linked a NEAR wallet.`, 'info', 'log.linked', { name: p.name });
  return { ok: true, near: accountId };
}

// EMWK sent from the player's own wallet to the village bank comes back into the
// game. It first comes out of the 'withdrawn' bucket; anything beyond that (tokens
// cashed out before a village reset) re-enters through the newcomer fund, so the
// game's total stays exactly the fixed supply.
export function depositIn(state, playerId, amount, hash) {
  const p = state.players[playerId];
  if (!p) return { ok: false, error: 'Unknown player.', code: 'err.unknownPlayer' };
  state.seenDeposits = state.seenDeposits || [];
  if (state.seenDeposits.includes(hash)) return { ok: false, error: 'That deposit was already counted.', code: 'err.depositSeen' };
  amount = Math.floor(Number(amount) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: 'Nothing was deposited.', code: 'err.depositEmpty' };
  state.seenDeposits.push(hash);
  const fromOut = Math.min(amount, balance(state, 'withdrawn'));
  transfer(state, 'withdrawn', 'player:' + playerId, fromOut, { why: 'deposit from your NEAR wallet' });
  transfer(state, 'newcomerFund', 'player:' + playerId, r2(amount - fromOut), { why: 'deposit from your NEAR wallet' });
  p.withdrawn = r2(Math.max(0, (p.withdrawn || 0) - amount));
  p.deposited = r2((p.deposited || 0) + amount);
  state.rev = (state.rev || 0) + 1;
  addLog(state, `${p.name} brought ${amount} EMWK into the village from NEAR.`, 'trade', 'log.deposited', { name: p.name, n: amount });
  return { ok: true, amount };
}

// Moves coins out of the game to the player's own NEAR wallet. They are kept in
// the 'withdrawn' bucket so the game's total stays exactly the fixed supply.
export function withdrawable(state, playerId) {
  const p = state.players[playerId];
  if (!p) return 0;
  return Math.max(0, Math.floor((balance(state, 'player:' + playerId) - (p.startCoins || 0)) * 100) / 100);
}

export function withdraw(state, playerId, amount) {
  const p = state.players[playerId];
  if (!p) return { ok: false, error: 'Unknown player.', code: 'err.unknownPlayer' };
  if (!p.near) return { ok: false, error: 'Link a NEAR wallet first.', code: 'err.noWallet' };
  // coins only go to a wallet the player proved is theirs (signed with it, NEP-413)
  if (!p.nearVerified) return { ok: false, error: 'Confirm the wallet is yours by signing with it first.', code: 'err.verifyWallet' };
  amount = Math.floor(Number(amount) * 100) / 100;
  if (!(amount >= 1)) return { ok: false, error: 'Cash out at least 1 EMWK.', code: 'err.minWithdraw' };
  if (balance(state, 'player:' + playerId) + 1e-9 < amount) return { ok: false, error: 'You do not have that much.', code: 'err.noMoney' };
  // only what the player earned can leave the village: the starting money from the newcomer fund stays,
  // so nobody can empty the fund by opening many characters and cashing out their starting money
  const can = withdrawable(state, playerId);
  if (amount > can + 1e-9) return { ok: false, error: `You can cash out ${can} EMWK: your starting money stays in the village.`, code: 'err.startLocked', params: { n: can, s: p.startCoins || 0 } };
  transfer(state, 'player:' + playerId, 'withdrawn', amount, { why: 'cash-out to your NEAR wallet' });
  p.withdrawn = r2((p.withdrawn || 0) + amount);
  state.rev = (state.rev || 0) + 1;
  addLog(state, `${p.name} cashed out ${amount} EMWK to NEAR.`, 'trade', 'log.withdrew', { name: p.name, n: amount });
  return { ok: true, amount, wallet: p.near };
}

export function totalMoney(state) {
  return r2(Object.values(state.balances).reduce((a, b) => a + b, 0));
}

// ---------- helpers ----------

// night: the last part of each day. Shops close (the inn stays open), nobody gathers, people sleep.
export const NIGHT_START = 0.8;
export function isNight(state) { return (state.tick % RULES.ticksPerDay) / RULES.ticksPerDay >= NIGHT_START; }
const NIGHT_ERR = { ok: false, error: 'It is night. Shops are closed and work starts again in the morning. The inn is open.', code: 'err.night' };
// how close the dragon is: 0 = calm, 1 = attacking now. Rises smoothly during the warning days.
export function threatLevel(state) {
  const ev = state.events;
  if (ev.attackDay === null || ev.attackDay === undefined) return 0;
  const now = state.day + (state.tick % RULES.ticksPerDay) / RULES.ticksPerDay;
  const left = ev.attackDay - now, span = RULES.dragonWarningDays;
  return Math.round(Math.max(0.15, Math.min(1, 1 - left / (span + 0.0001))) * 100) / 100;
}

// rooms at the inn: travellers take some, players the rest
// the inn grows with the village: one more room for every few players active today
export function innRooms(state) {
  const active = Object.values(state.players).filter((p) => p.seenAt !== undefined && state.tick - p.seenAt < RULES.ticksPerDay).length;
  return RULES.innRooms + Math.floor(active / RULES.innRoomsPerPlayers);
}
export function innFree(state) {
  const players = Object.values(state.players).filter((p) => p.sleep && p.sleep.day === state.day && p.sleep.place === 'inn').length;
  return Math.max(0, innRooms(state) - (state.innGuests || 0) - players);
}

function rng(state) {
  // small deterministic generator so a saved game replays the same way
  state.seed = (state.seed * 1103515245 + 12345) % 2147483648;
  return state.seed / 2147483648;
}

export function addLog(state, text, kind = 'info', key = null, p = {}) {
  state.log.unshift({ day: state.day, text, kind, key, p });
  if (state.log.length > 40) state.log.length = 40;
}

const npcAcct = (id) => 'npc:' + id;
const price = (n) => Math.max(RULES.minPrice, Math.round(n));

function inv(holder, good) {
  return holder.inv[good] || 0;
}
function addInv(holder, good, qty) {
  holder.inv[good] = (holder.inv[good] || 0) + qty;
  if (holder.inv[good] <= 0) delete holder.inv[good];
}

// ---------- skills and levels ----------

export function levelFromXp(xp) {
  let lvl = 1;
  RULES.levelXp.forEach((need, k) => { if (xp >= need) lvl = k + 1; });
  return lvl;
}
function ensurePlayer(p) {
  if (!p.xp) p.xp = { farming: 0, woodcutting: 0, mining: 0, trading: 0 };
  if (!p.wear) p.wear = {};
  if (!p.stats) p.stats = { gathers: 0, sells: 0, sold: 0, earned: 0, visited: {} };
  if (p.stats.spent === undefined) { p.stats.spent = 0; p.stats.taxes = 0; }
  if (p.startCoins === undefined) p.startCoins = (START_PATHS[p.path] || { coins: 50 }).coins;
}
const skillLevel = (p, skill) => levelFromXp((p.xp && p.xp[skill]) || 0);
export function maxEnergy(p) {
  if (!p.xp) return RULES.energyMax;
  const total = SKILLS.reduce((a, s) => a + skillLevel(p, s), 0);
  const base = Math.min(RULES.energyCap, RULES.energyMax + total - SKILLS.length);
  return Math.max(4, base - (p.cold ? RULES.coldMaxEnergy : 0) - (p.hungry ? RULES.hungryMaxEnergy : 0));
}
// ---------- land: prices by distance, districts, levels ----------
const PLOT_DEFS = BUILDINGS.filter((b) => b.type === 'plot');
const plotDef = (id) => PLOT_DEFS.find((b) => b.id === id);
export function playerLevel(p) { return SKILLS.reduce((a, s) => a + skillLevel(p, s), 0) - (SKILLS.length - 1); }
export function plotPrice(id) {
  const d = plotDef(id);
  if (!d) return LAND.price;
  const f = d.district ? DISTRICTS[d.district].factors[Number(id.split('-')[1]) - 1] : (CENTRE_FACTOR[id] || 1);
  return Math.round(LAND.price * f);
}
const plotBuild = (id) => { const d = plotDef(id); return d && d.district ? { ...LAND.build, ...DISTRICTS[d.district].build } : LAND.build; };
// what a plot is worth: the land, plus the house (lumber + builder's fee) and the bed if there are any
export function fairValue(state, id) {
  const plot = state.plots[id], b = plotBuild(id);
  let v = plotPrice(id);
  if (plot && plot.built) v += b.fee + b.lumber * price((state.npcs.carpenter && state.npcs.carpenter.sells.lumber) || state.npcs.woodcutter.sells.lumber || 4);
  if (plot && plot.bed) v += price((state.npcs.carpenter && state.npcs.carpenter.sells.bed) || 30);
  return Math.round(v);
}
// newcomer families: each morning the village treasury buys one fairly priced deed (at most 10% over its
// value) that has waited a day, for families moving in; the plot is then sold again by the village at that value
const BUYBACK_OVER = 1.1;
function villageBuysDeeds(state) {
  const spare = balance(state, 'treasury') - lockedFunds(state);
  const offers = Object.entries(state.plots).filter(([, x]) => x.sale && x.owner && state.day - x.sale.since >= 1)
    .map(([id, x]) => ({ id, x, fair: fairValue(state, id) })).filter((o) => o.x.sale.price <= o.fair * BUYBACK_OVER && o.x.sale.price <= spare - 200)
    .sort((a, b) => a.x.sale.price / a.fair - b.x.sale.price / b.fair);
  const o = offers[0];
  if (!o) return;
  const { id, x } = o, seller = state.players[x.owner], price = x.sale.price, fee = r2(price * marketFee(state));
  if (!transfer(state, 'treasury', 'player:' + x.owner, price, { memo: `Emberwick: the village buys deed ${id} from ${seller ? seller.name : '?'} for a newcomer family` })) return;
  transfer(state, 'player:' + x.owner, 'treasury', fee, { why: 'exchange fee (deed sale)' });
  if (seller) {
    seller.plot = null;
    if (seller.sleep && seller.sleep.place === id) seller.sleep = null;
    seller.stats.earned = r2(seller.stats.earned + price - fee);
    // the deed NFT is already in the village bank's escrow (listing a deed puts it there), so nothing moves on chain
  }
  if (x.lease && x.lease.tenant && state.players[x.lease.tenant]) state.players[x.lease.tenant].lease = null;
  x.owner = null; x.sale = null; x.lease = null; x.since = state.day; x.resale = o.fair; // the deed stays with the village bank
  recordTrade(state, { deed: id, qty: 1, price, seller: seller ? seller.name : '?', buyer: 'village' });
  addLog(state, `A newcomer family bought ${seller ? seller.name : '?'}'s land through the village (${price} EMWK).`, 'good', 'log.buyback', { name: seller ? seller.name : '?', place: { $place: id }, n: price });
}
const districtOpen = (state, n) => !n || !!(DISTRICTS[n] && DISTRICTS[n].alwaysOpen) || (state.districts || []).includes(n);
const plotOpen = (state, id) => { const d = plotDef(id); return !!d && districtOpen(state, d.district); };
const nextDistrict = (state) => Object.keys(DISTRICTS).map(Number).find((n) => !districtOpen(state, n) && districtOpen(state, DISTRICTS[n].needs)) || null;
const freePlots = (state) => PLOT_DEFS.filter((d) => plotOpen(state, d.id) && !(state.plots[d.id] || {}).owner).length;
const hasCoat = (p) => ((p.inv && p.inv.coat) || 0) > 0;
// cold: winter without a coat
const freezing = (state, p) => !!state.events.winter && !hasCoat(p);
function energyCost(p, spotKey, state = null) {
  if (state && freezing(state, p)) return energyCostBase(p, spotKey) + RULES.winterNoCoatCost;
  return energyCostBase(p, spotKey);
}
function energyCostBase(p, spotKey) {
  const s = GATHER_SPOTS[spotKey], lvl = skillLevel(p, SKILL_OF[s.good]);
  return Math.max(1, s.energy - (lvl >= 3 ? 1 : 0) - (lvl >= 5 ? 1 : 0));
}
function gainXp(p, skill, n = 1) {
  const before = skillLevel(p, skill);
  p.xp[skill] = (p.xp[skill] || 0) + n;
  const after = skillLevel(p, skill);
  return after > before ? { skill, level: after } : null;
}

const FOOD_CHAIN = { bakery: ['bread', 'flour', 'wood'], mill: ['wheat', 'flour'] };
function targetFor(state, npcId, good) {
  const def = CRAFTSMEN.find((c) => c.id === npcId);
  let t = def.target[good] || 0;
  const npc = state.npcs && state.npcs[npcId];
  if (npc) {
    if (npc.learn && npc.learn[good]) t *= npc.learn[good];   // what this craftsman learned about demand
    if (npc.level > 1) t *= 1 + 0.2 * (npc.level - 1);        // a bigger workshop keeps more in stock
    if (npc.ai && npc.ai.day >= state.day - 1 && npc.ai.want[good]) t *= npc.ai.want[good]; // today's NEAR AI plan
  }
  // more mouths to feed: the bread chain keeps more in stock for every player who eats in the village
  if (FOOD_CHAIN[npcId] && FOOD_CHAIN[npcId].includes(good) && state.activePlayers) t *= 1 + state.activePlayers / RULES.foodChainPerPlayers;
  if (state.events.dragon > 0) {
    if (npcId === 'tower' && good === 'sword') t *= 3;
    if (npcId === 'smithy' && good === 'ore') t *= 2;
  }
  if (state.events.winter && npcId === 'bakery' && good === 'wood') t *= 2;
  if (state.events.winter && npcId === 'tailor' && (good === 'coat' || good === 'wool')) t *= 2;
  return t;
}

// ---------- trading (shared by players, bots and npcs) ----------

// `actor` is { acct, holder } where holder has .inv
function sellToNpc(state, actor, npcId, good, qty) {
  const npc = state.npcs[npcId];
  if (!npc || npc.buys[good] === undefined) return { ok: false, error: 'This shop does not buy that.', code: 'err.notBuying' };
  if (inv(actor.holder, good) < qty) return { ok: false, error: 'You do not have enough.', code: 'err.notEnough' };
  // the craftsman haggles: they take only what they need, and every extra unit is worth a bit less to them
  const offered = qty, q = sellQuote(state, npcId, good, qty, actor.bonus || 0);
  if (q.want < 1) return { ok: false, error: 'The store room is full. Try another shop or come back later.', code: 'err.storeFull' };
  if (q.qty < 1) return { ok: false, error: 'The shopkeeper cannot afford that right now.', code: 'err.shopBroke' };
  qty = q.qty;
  const total = q.total, unit = r2(total / qty);
  const tax = r2(total * taxRate(state));
  transfer(state, npcAcct(npcId), actor.acct, total, { why: `sold ${q.qty} ${good}` });
  transfer(state, actor.acct, 'treasury', tax, { why: 'market tax' });
  addInv(actor.holder, good, -qty);
  npc.stock[good] = (npc.stock[good] || 0) + qty;
  return { ok: true, unit, total, tax, qty, offered, want: q.want };
}

// what a craftsman would pay for `qty` of a good right now: unit by unit, the price falls as their
// store fills (the same supply-and-demand rule that moves prices), and they stop at what they need
export function sellQuote(state, npcId, good, qty, bonus = 0) {
  const npc = state.npcs[npcId];
  if (!npc || npc.buys[good] === undefined) return { qty: 0, total: 0, want: 0 };
  const t = Math.max(1, targetFor(state, npcId, good)), s0 = npc.stock[good] || 0;
  const want = Math.max(0, Math.ceil(t * WANT_FACTOR - s0));
  const cash = balance(state, npcAcct(npcId)) - 60;
  let n = 0, total = 0;
  const units = [];
  while (n < Math.min(qty, want)) {
    const level = levelPrice(npc.base[good], s0 + n + 0.5, t, 'buy'); // each extra unit counts as more stock
    const unit = Math.max(RULES.minPrice, Math.round(Math.min(npc.buys[good], level) * (1 + bonus) * 100) / 100);
    if (total + unit > cash) break;
    total += unit; units.push(unit); n++;
  }
  return { qty: n, total: r2(total), want, first: units[0] || 0, last: units[units.length - 1] || 0 };
}

function buyFromNpc(state, actor, npcId, good, qty) {
  const npc = state.npcs[npcId];
  if (!npc || npc.sells[good] === undefined) return { ok: false, error: 'This shop does not sell that.', code: 'err.notSelling' };
  if ((npc.stock[good] || 0) < qty) return { ok: false, error: 'Out of stock.', code: 'err.outOfStock' };
  const unit = price(npc.sells[good]);
  const total = unit * qty;
  if (balance(state, actor.acct) < total) return { ok: false, error: 'You do not have enough EMWK.', code: 'err.noMoney' };
  const tax = r2(total * taxRate(state));
  transfer(state, actor.acct, npcAcct(npcId), total, { why: `bought ${qty} ${good}` });
  transfer(state, npcAcct(npcId), 'treasury', tax, { why: 'market tax' });
  npc.stock[good] -= qty;
  addInv(actor.holder, good, qty);
  npc.soldToday = npc.soldToday || {};
  npc.soldToday[good] = (npc.soldToday[good] || 0) + qty; // the craftsman learns how much people want
  return { ok: true, unit, total, tax };
}

// ---------- what the AI craftsmen know about the village and the customer ----------
// so a craftsman can say "a sofa? nobody makes those here; the carpenter makes beds" and point the way
export function villageDirectory(state) {
  const shops = CRAFTSMEN.filter((d) => d.id !== 'tower').map((d) => {
    const n = state.npcs[d.id], r = d.recipe;
    return { id: d.id, name: d.name, sells: Object.keys(n.sells), buys: Object.keys(n.buys),
      makesFromCustomerMaterials: r && d.id !== 'inn' ? `${Object.entries(r.in).map(([g, q]) => q + ' ' + g).join(' + ')} -> ${Object.entries(r.out).map(([g, q]) => q + ' ' + g).join(' + ')}` : null };
  });
  const gather = Object.entries(GATHER_SPOTS).map(([id, g]) => `${g.good}: gather it yourself at the ${id}${toolFor(g.good) ? ' (needs a ' + toolFor(g.good) + ')' : ''}`);
  return { shops, rawGoods: gather, note: 'Only these goods exist in Emberwick. Nothing else can be bought, made or ordered.' };
}
export function customerBrief(state, pid) {
  const p = state.players[pid];
  if (!p) return null;
  return { name: p.name, coins: Math.floor(balance(state, 'player:' + pid)), energy: `${Math.round(p.energy)}/${maxEnergy(p)}`,
    bag: Object.fromEntries(Object.entries(p.inv || {}).filter(([, v]) => v > 0).map(([g, v]) => [g, Math.floor(v)])), hasLand: !!p.plot, job: p.job ? p.job.npc : null };
}
// the AI may only *suggest* actions; each one is checked against the rules here and shown as a button the
// player can press (nothing happens unless they do)
export function checkAiActions(state, pid, npcId, list) {
  const p = state.players[pid], n = state.npcs[npcId], out = [];
  if (!p || !n || !Array.isArray(list)) return out;
  const shopIds = CRAFTSMEN.map((c) => c.id).filter((x) => x !== 'tower');
  for (const a of list.slice(0, 4)) {
    if (!a || typeof a !== 'object') continue;
    const type = String(a.type || '').toLowerCase(), good = String(a.good || '').toLowerCase(), qty = clamp(Math.round(Number(a.qty) || 1), 1, 50);
    if (type === 'buy' && n.sells[good] !== undefined && good !== 'meal' && (n.stock[good] || 0) >= 1) out.push({ type: 'buy', npc: npcId, good, qty: Math.min(qty, Math.floor(n.stock[good])), price: price(n.sells[good]) });
    else if (type === 'buy' && good === 'meal' && npcId === 'inn') out.push({ type: 'meal', npc: npcId, price: price(n.sells.meal) });
    else if (type === 'sell' && n.buys[good] !== undefined && inv(p, good) >= 1) out.push({ type: 'sell', npc: npcId, good, qty: Math.min(qty, Math.floor(inv(p, good))) });
    else if (type === 'order') { const o = commissionPolicy(state, pid, npcId, 1); if (o) out.push({ type: 'order', npc: npcId, ...o }); }
    else if (type === 'credit') { const c = creditPolicy(state, pid, npcId); if (c && c.ok) out.push({ type: 'credit', npc: npcId, good: c.good, qty: Math.min(qty, c.max), price: c.unitPrice }); }
    else if (type === 'haggle' && npcId !== 'tower' && Number(a.price) > 0 && Number(a.price) < 10000) {
      // a price the customer named in conversation becomes an offer at the counter: the haggling rules decide
      const side = String(a.side) === 'sell' ? 'sell' : 'buy', offer = Math.round(Number(a.price) * 10) / 10;
      if (side === 'buy' && n.sells[good] !== undefined && good !== 'meal' && (n.stock[good] || 0) >= 1) out.push({ type: 'haggle', npc: npcId, side, good, qty: Math.min(qty, Math.floor(n.stock[good])), offer });
      else if (side === 'sell' && n.buys[good] !== undefined && inv(p, good) >= 1) out.push({ type: 'haggle', npc: npcId, side, good, qty: Math.min(qty, Math.floor(inv(p, good))), offer });
    }
    else if (type === 'goto' && (shopIds.includes(String(a.place)) || GATHER_SPOTS[a.place]) && a.place !== npcId) out.push({ type: 'goto', place: String(a.place) });
  }
  const seen = new Set();
  return out.filter((a) => { const k = JSON.stringify(a); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- orders: bring your own materials, pay for the work ----------
// a craftsman makes their product from the customer's own materials (e.g. 3 wool -> 1 coat at the tailor).
// The fee is part of what the work adds (product price minus the materials' price), at least 2 EMWK
export function commissionPolicy(state, pid, npcId, n = 1) {
  const p = state.players[pid], def = CRAFTSMEN.find((c) => c.id === npcId), npc = state.npcs[npcId];
  if (!p || !def || !npc || !def.recipe || npcId === 'inn' || npcId === 'tower') return null;
  const r = def.recipe, out = Object.keys(r.out)[0];
  if (npc.sells[out] === undefined) return null;
  const inVal = Object.entries(r.in).reduce((a, [g, q]) => a + q * price(npc.buys[g] ?? (GOODS[g] && GOODS[g].base) ?? 3), 0);
  const fee = Math.max(2, Math.round((price(npc.sells[out]) * r.out[out] - inVal) * 0.6));
  const base = { inputs: r.in, output: out, outQty: r.out[out], fee, max: 3 };
  if (npc.damagedUntil > state.day || isNight(state)) return { ...base, ok: false, key: 'closed', reason: 'the workshop is closed now' };
  const done = (p.orders && p.orders.day === state.day && p.orders[npcId]) || 0;
  if (done + n > 3) return { ...base, ok: false, key: 'max', reason: 'you make at most 3 orders a day for one customer' };
  const lack = Object.entries(r.in).filter(([g, q]) => inv(p, g) < q * n).map(([g]) => g);
  if (lack.length) return { ...base, ok: false, key: 'need', lack, reason: `the customer does not have enough ${lack.join(' and ')}` };
  if (balance(state, 'player:' + pid) < fee * n) return { ...base, ok: false, key: 'fee', reason: 'the customer cannot pay the fee' };
  return { ...base, ok: true };
}
function commission(state, p, actor, npcId, n) {
  n = clamp(Math.round(n) || 1, 1, 3);
  const pol = commissionPolicy(state, p.id, npcId, n);
  if (!pol) return { ok: false, error: 'This workshop does not take orders.', code: 'order.none' };
  if (!pol.ok) return { ok: false, error: pol.reason, code: /closed/.test(pol.reason) ? 'err.closedNight' : /fee/.test(pol.reason) ? 'err.noMoney' : /3 orders/.test(pol.reason) ? 'order.max' : 'order.need' };
  const total = pol.fee * n;
  if (!transfer(state, actor.acct, npcAcct(npcId), total, { memo: `Emberwick: ${p.name} orders ${n * pol.outQty} ${pol.output} (own materials)` })) return { ok: false, error: 'You cannot pay the fee.', code: 'err.noMoney' };
  transfer(state, npcAcct(npcId), 'treasury', r2(total * taxRate(state)), { why: 'market tax' });
  for (const [g, q] of Object.entries(pol.inputs)) addInv(p, g, -q * n);
  addInv(p, pol.output, pol.outQty * n);
  p.orders = p.orders && p.orders.day === state.day ? p.orders : { day: state.day };
  p.orders[npcId] = (p.orders[npcId] || 0) + n;
  p.stats.spent = r2(p.stats.spent + total);
  addLog(state, `${p.name} had ${pol.outQty * n} ${pol.output} made from their own materials.`, 'info', 'log.order', { name: p.name, npc: { $npc: npcId }, n: pol.outQty * n, good: { $good: pol.output } });
  return { ok: true, order: true, npc: npcId, n, output: pol.output, qty: pol.outQty * n, fee: total };
}

// ---------- food on credit ----------
// a hungry player with no money can ask the baker or the innkeeper for food on credit. The rules
// decide what is possible (needy, no open debt, paid back last time); NEAR AI decides whether to say yes.
const CREDIT_GOODS = { bakery: 'bread', inn: 'meal' };
export function creditPolicy(state, pid, npcId) {
  const p = state.players[pid], n = state.npcs[npcId], good = CREDIT_GOODS[npcId];
  if (!p || !n || !good) return null;
  const owe = p.debts && p.debts[npcId], unit = price(n.sells[good]), coins = balance(state, 'player:' + pid);
  if (owe) return { ok: false, good, reason: `they already owe you ${owe.amount} EMWK (due on day ${owe.due})` };
  if (p.badCredit && p.badCredit[npcId]) return { ok: false, good, reason: 'they did not pay you back last time' };
  if (coins >= unit * 3) return { ok: false, good, reason: `they have ${Math.floor(coins)} EMWK, enough to pay` };
  const stock = Math.floor(n.stock[good] || 0);
  if (stock < 1) return { ok: false, good, reason: 'you have nothing left to give' };
  return { ok: true, good, max: Math.min(good === 'meal' ? 1 : 2, stock), unitPrice: unit, payBackWithinDays: 3 };
}
export function orderFromChat(state, pid, npcId, n) { const p = state.players[pid]; return p ? commission(state, p, { acct: 'player:' + pid }, npcId, n) : null; }
export function giveCredit(state, pid, npcId, qty) {
  const pol = creditPolicy(state, pid, npcId);
  if (!pol || !pol.ok) return null;
  const p = state.players[pid], n = state.npcs[npcId], good = pol.good;
  qty = clamp(Math.round(qty) || 1, 1, pol.max);
  n.stock[good] -= qty;
  if (good === 'meal') p.energy = Math.min(maxEnergy(p), r2(p.energy + RULES.mealEnergy * qty)); // eaten on the spot
  else addInv(p, good, qty);
  const amount = r2(pol.unitPrice * qty);
  p.debts = p.debts || {};
  p.debts[npcId] = { amount, good, qty, day: state.day, due: state.day + 3 };
  addLog(state, `${p.name} got ${qty} ${good} on credit (${amount} EMWK, to pay back by day ${state.day + 3}).`, 'info', 'log.credit', { name: p.name, npc: { $npc: npcId }, n: amount, d: state.day + 3 });
  state.rev = (state.rev || 0) + 1;
  return { qty, good, amount, due: state.day + 3 };
}
function repayDebt(state, p, npcId, auto = false) {
  const d = p.debts && p.debts[npcId];
  if (!d) return { ok: false, error: 'You owe nothing here.', code: 'credit.none' };
  if (!transfer(state, 'player:' + p.id, npcAcct(npcId), d.amount, { memo: `Emberwick: ${p.name} paid back a debt` })) return { ok: false, error: 'You do not have enough EMWK.', code: 'err.noMoney' };
  delete p.debts[npcId];
  if (p.badCredit) delete p.badCredit[npcId];
  addLog(state, `${p.name} paid back ${d.amount} EMWK.`, 'good', 'log.repaid', { name: p.name, npc: { $npc: npcId }, n: d.amount });
  return { ok: true, amount: d.amount, npc: npcId, auto };
}
// each morning debts are paid from what the player has; an overdue debt costs the player their credit
function collectDebts(state) {
  for (const p of Object.values(state.players)) {
    for (const npcId of Object.keys(p.debts || {})) {
      const d = p.debts[npcId];
      if (balance(state, 'player:' + p.id) >= d.amount + 5) repayDebt(state, p, npcId, true);
      else if (state.day > d.due && !(p.badCredit && p.badCredit[npcId])) {
        p.badCredit = p.badCredit || {};
        p.badCredit[npcId] = true;
        addLog(state, `${p.name} did not pay back in time. No more credit there.`, 'bad', 'log.creditLate', { name: p.name, npc: { $npc: npcId } });
      }
    }
  }
}

// ---------- haggling ----------
const r1 = (n) => Math.round(n * 10) / 10;
export function haggle(state, p, npcId, good, side, qty, offer) {
  const n = state.npcs[npcId], def = CRAFTSMEN.find((c) => c.id === npcId);
  if (!n || !def || npcId === 'tower') return { ok: false, error: 'You cannot haggle here.', code: 'haggle.no' };
  if (n.damagedUntil > state.day || (isNight(state) && npcId !== 'inn')) return NIGHT_ERR;
  if (!(offer > 0) || offer > 10000) return { ok: false, error: 'Name a price.', code: 'haggle.price' };
  p.haggle = p.haggle && p.haggle.day === state.day ? p.haggle : { day: state.day };
  const mood = (p.haggle[npcId] = p.haggle[npcId] || { tries: 0, angry: 0 });
  p.deal = null; // a new offer replaces any older counter offer
  if (mood.angry >= 2) return { ok: true, outcome: 'closed', side, good, npc: npcId, qty: 0, unit: null, offer, ask: null };
  mood.tries++;
  const lvl = skillLevel(p, 'trading');
  offer = r1(offer);
  let ask, floor, list;
  if (side === 'buy') {
    if (n.sells[good] === undefined || good === 'meal') return { ok: false, error: 'This shop does not sell that.', code: 'err.notSelling' };
    qty = Math.min(qty, Math.floor(n.stock[good] || 0));
    if (qty < 1) return { ok: false, error: 'Out of stock.', code: 'err.outOfStock' };
    list = price(n.sells[good]);
    const t = Math.max(1, targetFor(state, npcId, good)), s0 = n.stock[good] || 0;
    // a full shelf makes them softer; a skilled trader gets a little more off
    const give = (s0 > 1.5 * t ? 0.25 : s0 > t ? 0.18 : 0.1) + 0.02 * (lvl - 1);
    floor = Math.max(RULES.minPrice * 0.8, r1(list * (1 - Math.min(0.3, give))));
    ask = list;
  } else {
    if (inv(p, good) < 1) return { ok: false, error: 'You do not have that.', code: 'err.notEnough' };
    const q = sellQuote(state, npcId, good, Math.min(qty, inv(p, good)), (lvl - 1) * RULES.tradeBonus); // the same quote as a plain sale
    if (q.want < 1) return { ok: false, error: 'The store room is full.', code: 'err.storeFull' };
    if (q.qty < 1) return { ok: false, error: 'The shopkeeper cannot afford that right now.', code: 'err.shopBroke' };
    qty = q.qty;
    list = r1(q.total / q.qty);
    const t = Math.max(1, targetFor(state, npcId, good)), s0 = n.stock[good] || 0;
    const give = (s0 < 0.5 * t ? 0.25 : s0 < t ? 0.18 : 0.1) + 0.02 * (lvl - 1); // they pay more when they run short
    floor = r1(list * (1 + Math.min(0.3, give))); // the most they would pay
    ask = list;
    const cash = balance(state, npcAcct(npcId)) - 60;
    if (floor * qty > cash) floor = Math.max(list, r1(cash / qty));
  }
  // how good is the offer for the craftsman? 1 = their own price, 0 = their limit, below 0 = past it
  const good01 = side === 'buy' ? (offer - floor) / Math.max(0.1, ask - floor) : (floor - offer) / Math.max(0.1, floor - ask);
  const pastLimit = side === 'buy' ? offer / ask : ask / offer; // how far from their price, as a ratio
  let outcome, unit = null;
  if (good01 >= 1) { outcome = 'accept'; unit = ask; }
  else if (mood.tries > 4) { outcome = 'final'; unit = side === 'buy' ? r1(Math.max(floor, (floor + ask) / 2)) : r1(Math.min(floor, (floor + ask) / 2)); }
  else if (good01 >= 0.5) { outcome = 'accept'; unit = offer; }
  else if (good01 >= 0) { outcome = 'counter'; unit = r1((offer + ask) / 2); }
  else if (pastLimit >= 0.6) { outcome = 'favor'; unit = side === 'buy' ? r1(floor + (ask - floor) * 0.3) : r1(floor - (floor - ask) * 0.3); }
  else { outcome = 'angry'; mood.angry++; }
  if (outcome === 'angry' && mood.angry >= 2) outcome = 'closed';
  const res = { ok: true, outcome, side, good, npc: npcId, qty, offer, ask, unit, tries: mood.tries, plainTotal: r2(ask * qty) };
  if (unit !== null) p.deal = { npc: npcId, good, side, qty, unit, day: state.day, tick: state.tick };
  res.fair = outcome === 'accept' && unit !== offer; // you asked for less (or offered more) than their own price: they keep to theirs
  return res;
}

// a trade at an agreed price per unit (after haggling)
function tradeAt(state, p, actor, npcId, good, side, qty, unit) {
  const n = state.npcs[npcId];
  if (!n) return { ok: false, error: 'Unknown shop.', code: 'err.unknownPlace' };
  if (isNight(state) && npcId !== 'inn') return NIGHT_ERR;
  const total = r2(unit * qty), tax = r2(total * taxRate(state));
  if (side === 'buy') {
    if ((n.stock[good] || 0) < qty) return { ok: false, error: 'Out of stock.', code: 'err.outOfStock' };
    if (balance(state, actor.acct) < total) return { ok: false, error: 'You do not have enough EMWK.', code: 'err.noMoney' };
    transfer(state, actor.acct, npcAcct(npcId), total, { memo: `Emberwick: ${p.name} haggled ${qty} ${good} at ${unit}` });
    transfer(state, npcAcct(npcId), 'treasury', tax, { why: 'market tax' });
    n.stock[good] -= qty;
    addInv(p, good, qty);
    n.soldToday = n.soldToday || {};
    n.soldToday[good] = (n.soldToday[good] || 0) + qty;
    p.stats.spent = r2(p.stats.spent + total);
  } else {
    if (inv(p, good) < qty) return { ok: false, error: 'You do not have enough.', code: 'err.notEnough' };
    if (balance(state, npcAcct(npcId)) - 60 < total) return { ok: false, error: 'The shopkeeper cannot afford that right now.', code: 'err.shopBroke' };
    transfer(state, npcAcct(npcId), actor.acct, total, { memo: `Emberwick: ${p.name} haggled ${qty} ${good} at ${unit}` });
    transfer(state, actor.acct, 'treasury', tax, { why: 'market tax' });
    addInv(p, good, -qty);
    n.stock[good] = (n.stock[good] || 0) + qty;
    p.stats.sells++; p.stats.sold += qty; p.stats.earned = r2(p.stats.earned + total - tax); p.stats.taxes = r2(p.stats.taxes + tax);
  }
  const levelUp = gainXp(p, 'trading');
  return { ok: true, deal: true, side, good, npc: npcId, qty, unit, total, tax, levelUp };
}

// npc-to-npc trade, e.g. the baker buying flour from the miller
function npcTrade(state, buyerId, sellerId, good, qty) {
  const buyer = state.npcs[buyerId];
  const actor = { acct: npcAcct(buyerId), holder: { inv: buyer.stock } };
  return buyFromNpc(state, actor, sellerId, good, qty);
}

export const toolFor = (good) => Object.keys(GOODS).find((k) => GOODS[k].boosts === good);

function gatherYield(state, spot, holder) {
  const s = GATHER_SPOTS[spot];
  let amount = s.base + Math.floor(rng(state) * 2);
  if (holder.xp) amount += Math.floor((skillLevel(holder, SKILL_OF[s.good]) - 1) / 2); // +1 at level 3 and 5
  // players and bots must hold the right tool (checked by the caller)
  if (s.good === 'wheat' && state.events.drought > 0) amount = Math.max(1, Math.floor(amount / 2));
  return amount;
}

// ---------- players ----------

export function joinPlayer(state, name, pathKey) {
  const path = START_PATHS[pathKey];
  if (!path) return { ok: false, error: 'Unknown starting path.', code: 'err.unknownPath' };
  name = String(name || '').trim().slice(0, 20);
  if (!name) return { ok: false, error: 'Enter a name.', code: 'err.enterName' };
  const id = 'p' + state.nextId++;
  state.players[id] = {
    id, name, path: pathKey, rank: 'Newcomer',
    energy: RULES.energyMax, inv: { ...path.items }, skills: { wood: 0, wheat: 0, ore: 0 },
    joinedDay: state.day, quest: 0, stats: { gathers: 0, sells: 0, sold: 0, earned: 0, spent: 0, taxes: 0, visited: {} },
    xp: { farming: 0, woodcutting: 0, mining: 0, trading: 0 }, wear: {}, startCoins: path.coins,
  };
  state.balances['player:' + id] = 0;
  const coins = Math.min(path.coins, balance(state, 'newcomerFund'));
  transfer(state, 'newcomerFund', 'player:' + id, coins, { why: 'starting money' });
  state.players[id].startCoins = coins; // the starting money stays in the village: it cannot be cashed out
  state.rev = (state.rev || 0) + 1;
  addLog(state, `${name} arrived at the gate as a ${path.name.toLowerCase()}.`, 'join', 'log.join', { name, path: pathKey });
  return { ok: true, id };
}

export function playerAction(state, playerId, action) {
  const p = state.players[playerId];
  if (!p) return { ok: false, error: 'Unknown player. Join the village first.', code: 'err.unknownPlayer' };
  const actor = { acct: 'player:' + playerId, holder: p };
  const qty = Math.max(1, Math.min(200, parseInt(action.qty, 10) || 1));

  ensurePlayer(p);
  ensureContracts(state);
  p.quest = p.quest || 0;
  // where the player is, so other players can see them walking around the village
  const where = action.place || action.spot || action.npc || action.house || (['vote', 'propose'].includes(action.type) ? 'council' : null);
  if (where && BUILDINGS.some((b) => b.id === where)) p.where = where;
  p.seenAt = state.tick;
  actor.bonus = (skillLevel(p, 'trading') - 1) * RULES.tradeBonus;
  const res = doAction(state, p, actor, action, qty);
  if (res.ok) {
    state.rev = (state.rev || 0) + 1;
    if (action.type === 'sleep' || action.type === 'rest') p.stats.slept = (p.stats.slept || 0) + 1;
    if (action.type === 'vote') p.stats.votes = (p.stats.votes || 0) + 1;
    const done = advanceQuest(state, p);
    if (done) res.quest = done;
  }
  return res;
}

const CHAT = { maxLen: 140, gapMs: 2500, keep: 60 };

function doAction(state, p, actor, action, qty) {
  const c = contractAction(state, p, action);
  if (c) return c;
  // walking to a spot of your own on the village map (other players see you go there)
  if (action.type === 'walk') {
    const i = Math.floor(Number(action.i)), j = Math.floor(Number(action.j));
    if (!(i >= 0 && j >= 0 && i < 14 && j < 14)) return { ok: false, error: 'Unknown place.', code: 'err.unknownPlace' };
    p.where = `@${i},${j}`;
    return { ok: true, silent: true };
  }
  // change your name: once a day, 2-20 letters, not the same as another villager's
  if (action.type === 'rename') {
    const nm = String(action.name || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (nm.length < 2) return { ok: false, error: 'Enter a name.', code: 'err.enterName' };
    if (Object.values(state.players).some((o) => o.id !== p.id && o.name.toLowerCase() === nm.toLowerCase())) return { ok: false, error: 'Someone in the village already has that name.', code: 'err.nameTaken' };
    if (p.renamedDay === state.day) return { ok: false, error: 'You can change your name once a day.', code: 'err.renameDaily' };
    const old = p.name; p.name = nm; p.renamedDay = state.day;
    addLog(state, `${old} is now called ${nm}.`, 'info', 'log.renamed', { old, name: nm });
    return { ok: true, silent: true };
  }
  // village chat: short public messages, a few seconds apart, the last 60 are kept
  if (action.type === 'chat') {
    const text = String(action.text || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT.maxLen);
    if (!text) return { ok: false, error: 'Write something first.', code: 'err.chatEmpty' };
    const now = Date.now();
    if (p.lastChat && now - p.lastChat < CHAT.gapMs) return { ok: false, error: 'Wait a moment before sending another message.', code: 'err.chatSlow' };
    p.lastChat = now;
    state.chat = state.chat || [];
    state.chatId = (state.chatId || 0) + 1;
    state.chat.push({ id: state.chatId, pid: p.id, name: p.name, text, day: state.day });
    if (state.chat.length > CHAT.keep) state.chat.splice(0, state.chat.length - CHAT.keep);
    return { ok: true, silent: true, id: state.chatId };
  }
  if (action.type === 'visit') {
    if (!BUILDINGS.some((b) => b.id === action.place)) return { ok: false, error: 'Unknown place.', code: 'err.unknownPlace' };
    p.stats.visited[action.place] = true;
    return { ok: true, silent: true };
  }
  const night = isNight(state);
  if (night && (action.type === 'gather' || ((action.type === 'buy' || action.type === 'sell') && action.npc !== 'inn'))) return NIGHT_ERR;
  if (action.type === 'gather') {
    if (p.job) return { ok: false, error: 'You are an apprentice. You can only work at your shop until you quit.', code: 'err.employed' };
    const spot = GATHER_SPOTS[action.spot];
    if (!spot) return { ok: false, error: 'You cannot gather there.', code: 'err.cannotGather' };
    if (state.events.winter && action.spot === 'fields') return { ok: false, error: 'Nothing grows in winter. The fields are under snow until spring.', code: 'err.winterFields' };
    const need = toolFor(spot.good);
    if (inv(p, need) < 1) return { ok: false, error: 'You need the right tool to work here.', code: 'err.noTool', tool: need };
    const cost = energyCost(p, action.spot, state);
    if (p.energy < cost) return { ok: false, error: 'You are too tired. Rest a little.', code: 'err.tired' };
    p.energy = r2(p.energy - cost);
    const got = gatherYield(state, action.spot, p);
    addInv(p, spot.good, got);
    p.skills[spot.good] = (p.skills[spot.good] || 0) + 1;
    p.stats.gathers++;
    const levelUp = gainXp(p, SKILL_OF[spot.good]);
    // the tool for this work wears out
    let toolBroke = null;
    const tool = Object.keys(GOODS).find((k) => GOODS[k].boosts === spot.good && inv(p, k) > 0);
    if (tool) {
      p.wear[tool] = (p.wear[tool] || 0) + 1;
      if (p.wear[tool] >= RULES.toolUses) { addInv(p, tool, -1); p.wear[tool] = 0; toolBroke = tool; }
    }
    return { ok: true, got, good: spot.good, cost, levelUp, toolBroke, message: `You gathered ${got} ${GOODS[spot.good].name.toLowerCase()}.` };
  }
  if (action.type === 'eat') {
    if (inv(p, 'bread') < 1) return { ok: false, error: 'You have no bread. Buy some at the bakery.', code: 'err.noBread' };
    if (p.energy >= maxEnergy(p)) return { ok: false, error: 'You are not hungry yet.', code: 'err.notHungry' };
    addInv(p, 'bread', -1);
    p.energy = Math.min(maxEnergy(p), r2(p.energy + RULES.breadEnergy));
    return { ok: true, energy: RULES.breadEnergy, message: `You ate bread. +${RULES.breadEnergy} energy.` };
  }
  if (action.type === 'meal') {
    if (p.energy >= maxEnergy(p)) return { ok: false, error: 'You are not hungry yet.', code: 'err.notHungry' };
    const res = buyFromNpc(state, actor, 'inn', 'meal', 1);
    if (!res.ok) return res.code === 'err.outOfStock' ? { ok: false, error: 'The kitchen is out of food. Try again soon, or eat bread.', code: 'err.kitchenEmpty' } : res;
    addInv(p, 'meal', -1);
    p.stats.spent = r2(p.stats.spent + res.total);
    p.energy = Math.min(maxEnergy(p), r2(p.energy + RULES.mealEnergy));
    return { ok: true, energy: RULES.mealEnergy, total: res.total, message: `You had a hot meal for ${res.total} EMWK. +${RULES.mealEnergy} energy.` };
  }
  // haggling: the player names a price per unit. The village rules decide (accept, counter, a favour, or
  // offence); NEAR AI only puts the craftsman's answer into words. A counter offer waits as p.deal.
  if (action.type === 'haggle') {
    // nothing changes hands yet: every agreed price waits for the player to confirm it (p.deal)
    return haggle(state, p, action.npc, action.good, action.side === 'sell' ? 'sell' : 'buy', qty, Number(action.offer));
  }
  if (action.type === 'repay') return repayDebt(state, p, String(action.npc || ''));
  if (action.type === 'credit') { const c = giveCredit(state, p.id, String(action.npc || ''), Number(action.qty) || 1); return c ? { ok: true, credit: c } : { ok: false, error: 'No credit here right now.', code: 'credit.no' }; }
  if (action.type === 'commission') return commission(state, p, actor, String(action.npc || ''), Number(action.n) || 1);
  if (action.type === 'deal') {
    const d = p.deal;
    if (!d || d.day !== state.day || state.tick - d.tick > 24) { p.deal = null; return { ok: false, error: 'That offer is gone. Ask again.', code: 'haggle.gone' }; }
    p.deal = null;
    return tradeAt(state, p, actor, d.npc, d.good, d.side, d.qty, d.unit);
  }
  if (action.type === 'sell') {
    const res = sellToNpc(state, actor, action.npc, action.good, qty);
    if (res.ok) {
      p.stats.sells++; p.stats.sold += res.qty; p.stats.earned = r2(p.stats.earned + res.total - res.tax); p.stats.taxes = r2(p.stats.taxes + res.tax);
      res.levelUp = gainXp(p, 'trading');
    }
    if (res.ok) res.message = `Sold ${res.qty} ${GOODS[action.good].name.toLowerCase()} for ${res.total} EMWK (tax ${res.tax}).`;
    return res;
  }
  if (action.type === 'buy') {
    const res = buyFromNpc(state, actor, action.npc, action.good, qty);
    if (res.ok) p.stats.spent = r2(p.stats.spent + res.total);
    if (res.ok && action.good === 'bed') {
      const home = p.plot && state.plots[p.plot];
      if (home && home.built && !home.bed) { addInv(p, 'bed', -1); home.bed = true; res.installed = p.plot; }
    }
    if (res.ok) res.message = `Bought ${qty} ${GOODS[action.good].name.toLowerCase()} for ${res.total} EMWK.`;
    return res;
  }
  return { ok: false, error: 'Unknown action.', code: 'err.unknownAction' };
}

// what a player owns: coins plus goods at the best price a craftsman would pay today
export function playerWorth(state, p) {
  let goods = 0;
  for (const [g, q] of Object.entries(p.inv || {})) {
    if (!(q > 0)) continue;
    let best = 0;
    for (const n of Object.values(state.npcs)) best = Math.max(best, (n.buys && n.buys[g]) || 0, ((n.sells && n.sells[g]) || 0) * 0.5);
    goods += q * best;
  }
  return Math.round(balance(state, 'player:' + p.id) + goods);
}

export function questFor(p, state) {
  const q = QUESTS[Math.min(p.quest || 0, QUESTS.length - 1)];
  const route = PATH_ROUTE[p.path] || PATH_ROUTE.farmer;
  const name = (id) => (BUILDINGS.find((b) => b.id === id) || {}).name || id;
  const freePlot = state ? (PLOT_DEFS.find((d) => state.plots[d.id] && !state.plots[d.id].owner && plotOpen(state, d.id)) || {}).id || 'roadsign' : 'roadsign';
  const fill = (t) => t && t.replace('{spot}', route.spot).replace('{shop}', route.shop).replace('{plot}', freePlot).replace('{myplot}', p.plot || freePlot);
  const fillText = (t) => t.replace('{spot}', name(route.spot).toLowerCase()).replace('{shop}', name(route.shop).toLowerCase());
  const st = p.stats || { gathers: 0, sells: 0, sold: 0, earned: 0, visited: {} };
  const sh = st.shifts || 0;
  // an apprentice cannot gather, so the work goals count shifts at their shop instead
  const job = p.job && ['gather', 'sell', 'supply'].includes(q.id) ? p.job.npc : null;
  // no job and no tool for your work: first find a way to earn
  const workGoal = ['gather', 'sell', 'supply'].includes(q.id);
  const findJob = !job && workGoal && p.inv && !(p.inv[toolFor(GATHER_SPOTS[route.spot].good)] > 0);
  const progress = job
    ? { gather: [st.gathers + sh, 2], sell: [Math.max(st.sells ? 3 : 0, sh), 3], supply: [Math.max(Math.round(st.sold * 8 / 15), sh), 8] }[q.id]
    : { gather: [st.gathers, 2], earn: [Math.floor(st.earned), 40], supply: [st.sold, 15], worth: state ? [Math.min(1000, playerWorth(state, p)), 1000] : null }[q.id] || null;
  const target = job || (findJob ? 'market' : fill(q.target));
  return { index: p.quest || 0, total: QUESTS.length - 1, id: q.id, title: q.title, text: fillText(q.text), target, reward: q.reward, progress, spot: route.spot, shop: route.shop, job, findJob };
}

function questDone(state, p, q) {
  const st = p.stats, route = PATH_ROUTE[p.path] || PATH_ROUTE.farmer;
  switch (q.id) {
    case 'meet': return !!st.visited.gate;
    case 'gather': return st.gathers + (st.shifts || 0) >= 2;
    case 'sell': return st.sells >= 1 || (st.shifts || 0) >= 3;
    case 'peak': return !!st.visited.dragonpeak;
    case 'earn': return st.earned >= 40;
    case 'supply': return st.sold >= 15 || (st.shifts || 0) >= 8;
    case 'home': return (st.slept || 0) >= 1;
    case 'job': return !!p.job || (st.shifts || 0) >= 1;
    case 'land': return !!p.plot;
    case 'house': { const pl = p.plot && state.plots[p.plot]; return !!(pl && pl.built && pl.bed); }
    case 'vote': return (st.votes || 0) >= 1;
    case 'worth': return playerWorth(state, p) >= 1000;
    default: return false;
  }
}

function advanceQuest(state, p) {
  // goals already met (say, a home built before the goal existed) are passed straight through
  let last = null, total = 0;
  for (let i = 0; i < QUESTS.length; i++) {
    const r = advanceOne(state, p);
    if (!r) break;
    last = r; total += r.reward;
  }
  return last ? { ...last, reward: total } : null;
}
function advanceOne(state, p) {
  const q = QUESTS[p.quest || 0];
  if (!q || !questDone(state, p, q)) return null;
  const reward = Math.min(q.reward, balance(state, 'newcomerFund'));
  transfer(state, 'newcomerFund', 'player:' + p.id, reward, { why: 'goal reward' });
  p.quest = (p.quest || 0) + 1;
  if (p.quest >= 4 && p.rank === 'Newcomer') { p.rank = 'Settler'; addLog(state, `${p.name} is now a settler of Emberwick.`, 'good', 'log.settler', { name: p.name }); }
  return { id: q.id, title: q.title, reward };
}

// ---------- the simulation tick ----------

export function tick(state) {
  ensureContracts(state);
  state.tick++;
  state.rev = (state.rev || 0) + 1;
  const newDay = state.tick % RULES.ticksPerDay === 0;

  // energy recovers for everyone
  const nightNow = isNight(state);
  for (const p of Object.values(state.players)) {
    let gain = RULES.energyPerTick;
    const asleep = p.sleep && p.sleep.day === state.day;
    if (nightNow) {
      if (asleep) gain *= RULES.sleepRegen;          // warm bed
      else {                                         // out in the dark: no rest
        gain = 0;
        if (freezing(state, p) && p.seenAt !== undefined && state.tick - p.seenAt < RULES.ticksPerDay) gain = -RULES.winterNightDrain;
        p.nightOut = (p.nightOut || 0) + 1;
      }
    } else if (freezing(state, p)) gain *= 0.5;      // cold days drain you
    p.energy = Math.max(0, Math.min(maxEnergy(p), r2(p.energy + gain)));
  }
  for (const b of Object.values(state.bots)) b.energy = Math.min(RULES.energyMax, r2(b.energy + RULES.energyPerTick));

  const night = isNight(state);
  if (!night) runBots(state); // at night bot villagers go home and sleep
  else for (const b of Object.values(state.bots)) b.energy = Math.min(RULES.energyMax, r2(b.energy + RULES.energyPerTick));
  runCouncil(state, newDay);
  if (!night) runCraftsmen(state); // workshops are shut for the night
  if (!night && state.tick % INTERVIEW_EVERY === 0) runInterviews(state);
  if (!night && state.tick % 3 === 0) runMarket(state);
  runInn(state);
  adjustPrices(state);
  updateReadiness(state);

  if (state.tick % 5 === 0) recordHistory(state);
  if (newDay) startNewDay(state);
}

// Each morning the bot villagers look at prices and move to the work that pays
// best per unit of energy (with some loyalty to yesterday's work). This keeps
// supply in balance: when ore floods the market, miners drift to the fields.
function chooseBotWork(state) {
  const value = {};
  for (const [key, spot] of Object.entries(GATHER_SPOTS)) {
    if (state.events.winter && key === 'fields') { value[key] = 0; continue; } // nothing to harvest under the snow
    const buyers = Object.values(state.npcs).filter((n) => n.buys[spot.good] !== undefined && (n.stock[spot.good] || 0) < targetFor(state, n.id, spot.good) * 1.5);
    const best = buyers.length ? Math.max(...buyers.map((n) => n.buys[spot.good])) : 0;
    value[key] = (best * (spot.base + 0.5)) / spot.energy;
  }
  const ranked = Object.keys(value).sort((a, c) => value[c] - value[a]);
  for (const b of Object.values(state.bots)) {
    const now = b.spot || { farmer: 'fields', miner: 'mine', woodcutter: 'forest' }[b.path];
    if (value[now] >= value[ranked[0]] * 0.75 || rng(state) < 0.5) { b.spot = now; continue; }
    b.spot = ranked[0];
  }
}

function runBots(state) {
  for (const b of Object.values(state.bots)) {
    if (rng(state) > 0.22) continue;
    const spotKey = b.spot || { farmer: 'fields', miner: 'mine', woodcutter: 'forest' }[b.path];
    const spot = GATHER_SPOTS[spotKey];
    if (b.energy >= spot.energy && inv(b, spot.good) < 6 && !(state.events.winter && spotKey === 'fields')) { // no point gathering what nobody buys
      b.energy = r2(b.energy - spot.energy);
      addInv(b, spot.good, gatherYield(state, spotKey, b));
    }
    // sell to whoever pays the most for this raw good
    const good = spot.good;
    const have = inv(b, good);
    if (have > 0) {
      const best = Object.values(state.npcs)
        .filter((n) => n.buys[good] !== undefined && (n.stock[good] || 0) < targetFor(state, n.id, good) * 1.5)
        .sort((a, c) => c.buys[good] - a.buys[good])[0];
      if (best) sellToNpc(state, { acct: 'bot:' + b.id, holder: b }, best.id, good, Math.min(have, 3));
    }
    // bots eat, which sends money back into the economy
    if (rng(state) < 0.08) {
      const res = buyFromNpc(state, { acct: 'bot:' + b.id, holder: b }, 'bakery', 'bread', 1);
      if (res.ok) addInv(b, 'bread', -1);
    }
  }
}

const TOOL_MAKER = {
  smithy: { good: 'pickaxe', in: { ore: 2, wood: 1 } },
  woodcutter: { good: 'axe', in: { wood: 3 } },
  mill: { good: 'plow', in: { wheat: 2 } },
  tailor: { good: 'shears', in: { ore: 1 } },
  carpenter: [{ good: 'bed', in: { lumber: 2 } }, { good: 'rod', in: { lumber: 1 } }],
};

function runCraftsmen(state) {
  for (const def of CRAFTSMEN) {
    const npc = state.npcs[def.id];
    if (npc.damagedUntil > state.day) continue;

    // buy missing inputs from other craftsmen
    for (const good of Object.keys(npc.buys)) {
      const need = targetFor(state, def.id, good) - (npc.stock[good] || 0);
      if (need <= 0) continue;
      const supplier = Object.values(state.npcs).find((n) => n.id !== def.id && n.sells[good] !== undefined && (n.stock[good] || 0) > 0);
      if (supplier && rng(state) < 0.5) npcTrade(state, def.id, supplier.id, good, Math.min(need, supplier.stock[good], 2));
    }

    // tools are made only when the shelf runs low, so they keep their value
    for (const tool of [].concat(TOOL_MAKER[def.id] || [])) {
      if ((npc.stock[tool.good] || 0) < def.target[tool.good] && rng(state) < 0.08 &&
          Object.entries(tool.in).every(([g, q]) => (npc.stock[g] || 0) >= q)) {
        for (const [g, q] of Object.entries(tool.in)) npc.stock[g] -= q;
        npc.stock[tool.good] = (npc.stock[tool.good] || 0) + 1;
      }
    }
    // a second recipe (the inn also cooks fish)
    if (def.alt && (npc.stock[Object.keys(def.alt.out)[0]] || 0) < targetFor(state, def.id, Object.keys(def.alt.out)[0]) * 1.5 &&
        Object.entries(def.alt.in).every(([g, q]) => (npc.stock[g] || 0) >= q) && rng(state) < 0.4) {
      for (const [g, q] of Object.entries(def.alt.in)) npc.stock[g] -= q;
      for (const [g, q] of Object.entries(def.alt.out)) npc.stock[g] = (npc.stock[g] || 0) + q;
    }

    // produce
    if (!def.recipe) continue;
    const outGood = Object.keys(def.recipe.out)[0];
    if ((npc.stock[outGood] || 0) >= targetFor(state, def.id, outGood) * 1.5) continue;
    const canMake = Object.entries(def.recipe.in).every(([g, q]) => (npc.stock[g] || 0) >= q);
    if (canMake && rng(state) < 0.5 * (1 + 0.3 * ((npc.level || 1) - 1))) { // a bigger workshop works faster
      for (const [g, q] of Object.entries(def.recipe.in)) npc.stock[g] -= q;
      for (const [g, q] of Object.entries(def.recipe.out)) npc.stock[g] = (npc.stock[g] || 0) + q;
      // the woodcutter, miller and smith also make tools now and then
    }
  }
}

// travelling merchants buy finished goods the village has too much of, paid from
// the adventurer fund (the inn sends travellers' money back into that fund)
function runMerchants(state) {
  if (balance(state, 'adventurerFund') < 500) return;
  const wants = [['carpenter', 'cart'], ['tailor', 'coat'], ['tailor', 'wool'], ['woodcutter', 'lumber'], ['mill', 'flour'], ['smithy', 'sword'], ['smithy', 'ore'], ['woodcutter', 'wood'], ['mill', 'wheat']];
  for (const [npcId, good] of wants) {
    const npc = state.npcs[npcId];
    const made = npc.sells[good] !== undefined;
    const extra = Math.floor((npc.stock[good] || 0) - targetFor(state, npcId, good) * (made ? 1 : 1.5));
    if (extra < 1 || rng(state) > 0.6) continue;
    const qty = Math.min(extra, 4);
    // made goods sell at 80% of the shop price; raw goods at the price the shop paid
    const unit = price((npc.sells[good] ?? npc.buys[good]) * (npc.sells[good] !== undefined ? 0.8 : 1) * oracleFactor(state));
    if (!transfer(state, 'adventurerFund', npcAcct(npcId), unit * qty, { why: `travelling merchant bought ${qty} ${good}` })) return;
    npc.stock[good] -= qty;
  }
}

function runInn(state) {
  // travellers arrive from outside and spend money at the inn
  const inn = state.npcs.inn;
  const visitors = rng(state) < 0.5 ? 1 : 0;
  for (let v = 0; v < visitors; v++) {
    if ((inn.stock.meal || 0) < 1) break;
    const unit = price(inn.sells.meal * oracleFactor(state));
    if (!transfer(state, 'adventurerFund', npcAcct('inn'), unit, { why: 'a traveller ate a meal' })) break;
    inn.stock.meal -= 1;
  }
}

// Prices follow supply and demand: each shop compares its stock with the stock it
// wants. Short on something, it pays more; overflowing, it pays less. Prices move a
// little toward that level every step, so they react smoothly.
function adjustPrices(state) {
  const k = RULES.priceStep;
  for (const def of CRAFTSMEN) {
    const npc = state.npcs[def.id];
    // the rules are in pricing.js
    for (const good of Object.keys(npc.buys)) npc.buys[good] = stepTowards(npc.buys[good], levelPrice(npc.base[good], npc.stock[good] || 0, targetFor(state, def.id, good), 'buy'), k);
    const plan = npc.ai && npc.ai.day >= state.day - 1 ? npc.ai.price : {};
    for (const good of Object.keys(npc.sells)) npc.sells[good] = stepTowards(npc.sells[good], levelPrice(npc.base[good], npc.stock[good] || 0, targetFor(state, def.id, good), 'sell', GOODS[good] && GOODS[good].kind === 'tool') * ((plan && plan[good]) || 1), k);
  }
}

// ---------- NEAR AI craftsmen ----------
// what the AI is told each morning: the real numbers of every shop
export function aiBrief(state) {
  return {
    day: state.day, season: state.events.winter ? 'winter' : 'normal',
    events: { dragonComing: state.events.dragon > 0, drought: state.events.drought > 0 },
    nearPriceUsd: state.oracle ? state.oracle.usd : null,
    craftsmen: CRAFTSMEN.filter((d) => d.id !== 'tower').map((d) => shopCard(state, d.id)),
  };
}
export function shopCard(state, id) {
  const def = CRAFTSMEN.find((c) => c.id === id), n = state.npcs[id];
  if (!def || !n) return null;
  const goods = {};
  for (const g of new Set([...Object.keys(n.buys), ...Object.keys(n.sells)])) {
    goods[g] = { stock: Math.round(n.stock[g] || 0), target: Math.round(targetFor(state, id, g) * 10) / 10,
      ...(n.buys[g] !== undefined ? { buysAt: price(n.buys[g]) } : {}), ...(n.sells[g] !== undefined ? { sellsAt: price(n.sells[g]), soldRecently: (n.history && n.history[g]) || [] } : {}) };
  }
  // the price list in plain words, so a model never mistakes a recipe amount for a price
  const priceList = Object.entries(goods).map(([g, x]) => [x.sellsAt !== undefined ? `you sell ${g} at ${x.sellsAt} EMWK each` : null, x.buysAt !== undefined ? `you buy ${g} at ${x.buysAt} EMWK each` : null].filter(Boolean).join(', ')).join('; ');
  const r = def.recipe, recipe = r ? `from ${Object.entries(r.in || {}).map(([g, q]) => q + ' ' + g).join(' + ')} you make ${Object.entries(r.out || {}).map(([g, q]) => q + ' ' + g).join(' + ')} (amounts, not prices)` : null;
  // what one batch costs to make at today's buying prices and what it sells for, and yesterday's profit
  let margin = null;
  if (r && r.in && r.out) {
    const cost = Object.entries(r.in).reduce((a, [g, q]) => a + q * (n.buys[g] !== undefined ? n.buys[g] : 0), 0);
    const revenue = Object.entries(r.out).reduce((a, [g, q]) => a + q * (n.sells[g] !== undefined ? n.sells[g] : 0), 0);
    margin = { costPerBatch: Math.round(cost * 10) / 10, sellsForPerBatch: Math.round(revenue * 10) / 10, profitPerBatch: Math.round((revenue - cost) * 10) / 10 };
  }
  const profitYesterday = n.walletStart !== undefined && n.walletPrev !== undefined ? Math.round((n.walletStart - n.walletPrev) * 10) / 10 : null;
  return { id, name: def.name, priceList, wallet: Math.round(balance(state, npcAcct(id))), profitYesterday, margin, workshopLevel: n.level || 1, recipe, goods };
}
// ---------- the village's daily record on NEAR ----------
// At the end of every village day the public state (no chat, no private data) is hashed and the
// SHA-256 goes on NEAR in a 0.01 EMWK memo, so the server cannot quietly rewrite the past.
// The exact JSON is served at /api/state-record?day=N; anyone can hash it and compare with the memo.
export function dayStateRecord(state) {
  const sum = (pre) => r2(Object.entries(state.balances).filter(([k]) => k.startsWith(pre)).reduce((a, [, v]) => a + v, 0));
  const funds = Object.fromEntries(Object.entries(state.balances).filter(([k]) => !k.startsWith('player:') && !k.startsWith('bot:')).map(([k, v]) => [k, r2(v)]).sort());
  return {
    day: state.day, supply: TOKEN.totalSupply,
    accounts: funds, players: { count: Object.keys(state.players).length, holding: sum('player:') }, villagers: sum('bot:'),
    shops: Object.fromEntries(Object.entries(state.npcs).map(([id, n]) => [id, { level: n.level || 1, stock: Object.fromEntries(Object.entries(n.stock || {}).map(([g, v]) => [g, r2(v)]).sort()), buys: n.buys, sells: n.sells }])),
    land: Object.fromEntries(Object.entries(state.plots || {}).map(([id, x]) => [id, { owner: x.owner ? (state.players[x.owner] ? state.players[x.owner].name : x.owner) : null, house: !!x.house }])),
    council: (state.council && state.council.closed || []).slice(0, 8).map((x) => ({ id: x.id, kind: x.kind, result: x.result || x.status || null })),
    readiness: state.readiness, ledger: state.ledgerSeq || 0,
  };
}
function recordDayState(state) {
  if (!state.day) return;
  const json = JSON.stringify(dayStateRecord(state));
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  state.dayLog = [{ day: state.day, hash, json }, ...(state.dayLog || []).filter((x) => x.day !== state.day)].slice(0, 60); // about 60 village days; tools/archive-records.mjs keeps a copy elsewhere
  transfer(state, 'treasury', 'newcomerFund', 0.01, { memo: `Emberwick village record day ${state.day}: sha256 ${hash.slice(0, 32)} (public state at the end of the day)`, dayRecord: state.day });
}

// the morning plan goes on NEAR: a 0.01 EMWK record from the treasury carries a SHA-256 of the exact plan
// (served at /api/ai/plan?day=N so anyone can check it) and a short summary in the memo
export function aiPlanRecord(state) {
  const plan = {};
  for (const d of CRAFTSMEN) { const a = state.npcs[d.id] && state.npcs[d.id].ai; if (a && a.day === state.day) plan[d.id] = { want: a.want, price: a.price, why: a.why }; }
  return plan;
}
function recordAiPlan(state, model, extra) {
  const plan = aiPlanRecord(state), json = JSON.stringify({ day: state.day, model, plan });
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  const short = Object.entries(plan).map(([id, x]) => id + ':' + [...Object.entries(x.want).filter(([, v]) => Math.abs(v - 1) >= 0.1).map(([g, v]) => g + (v > 1 ? '+' : '-')),
    ...Object.entries(x.price).filter(([, v]) => Math.abs(v - 1) >= 0.03).map(([g, v]) => g + '$' + (v > 1 ? '+' : '-'))].join(',')).filter((x) => !x.endsWith(':')).join(' ');
  const pr = extra.proof || null, signed = pr ? (pr.ok ? ' answer signed in TEE' : ' signature not verified') : '';
  const memo = `Emberwick AI plan day ${state.day} by NEAR AI (${model || '?'})${extra.tee && extra.signer ? ' TEE ' + extra.signer.slice(0, 12) : ' no TEE report'}${signed}: sha256 ${hash.slice(0, 24)}. ${short}`.slice(0, 240);
  const proof = pr ? { ok: !!pr.ok, chatId: pr.chatId || null, signer: pr.signer || null, signedBy: pr.signedBy || null, error: pr.error || null } : null;
  state.aiLog = [{ day: state.day, model, hash, json, short, tee: !!extra.tee, signer: extra.signer || null, proof }, ...(state.aiLog || []).filter((x) => x.day !== state.day)].slice(0, 10);
  transfer(state, 'treasury', 'newcomerFund', 0.01, { memo, aiPlan: state.day });
}

// the plan is only allowed to nudge, inside fixed limits; money still moves only by the village rules
export function applyAiPlan(state, plan, model, extra = {}) {
  let used = 0;
  for (const c of (plan && plan.craftsmen) || []) {
    const def = CRAFTSMEN.find((d) => d.id === c.id), n = def && def.id !== 'tower' && state.npcs[c.id];
    if (!n) continue;
    const pick = (obj, lo, hi, ok) => Object.fromEntries(Object.entries(obj || {}).filter(([g, v]) => ok(g) && Number.isFinite(Number(v))).map(([g, v]) => [g, Math.round(clamp(Number(v), lo, hi) * 100) / 100]));
    const text = (v, m) => String(v || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, m);
    n.ai = {
      day: state.day, model: model || null,
      want: pick(c.want, 0.7, 1.4, (g) => n.buys[g] !== undefined || n.sells[g] !== undefined),
      price: pick(c.price, 0.9, 1.1, (g) => n.sells[g] !== undefined),
      why: text(c.why, 140), say: text(c.say, 160),
    };
    used++;
  }
  if (used) {
    state.aiDays = (state.aiDays || 0) + 1;
    recordAiPlan(state, model, extra);
  }
  return used;
}

// Public works: taxes would otherwise pile up in the treasury while the shops lack customers and the
// villagers lack work (players earn by selling raw goods but spend little). When the treasury holds
// more than publicWorksAbove, it spends a share of the surplus each morning: it orders finished goods
// from the shops (used for repairs, the guard and newcomer families, so they leave the market) and pays
// wages to the poorest villagers for the work. Every payment is an ordinary transfer, on NEAR like all.
function publicWorks(state) {
  const surplus = balance(state, 'treasury') - Math.max(RULES.publicWorksAbove, lockedFunds(state));
  if (surplus < 20) return;
  let budget = r2(surplus * RULES.publicWorksShare);
  const spent = { goods: 0, wages: 0, n: 0 };
  // newcomers first: keep the newcomer fund able to give starting money
  const fund = balance(state, 'newcomerFund');
  if (fund < 1000) { const top = r2(Math.min(budget * 0.3, 1000 - fund)); if (top >= 1 && transfer(state, 'treasury', 'newcomerFund', top, { why: 'public works: newcomer fund' })) budget = r2(budget - top); }
  // orders from the shops: finished goods they have on the shelf, a few at a time, cheapest first
  let goodsBudget = r2(budget * 0.6);
  const offers = [];
  for (const def of CRAFTSMEN) {
    if (def.id === 'tower') continue;
    const npc = state.npcs[def.id];
    if (!npc || npc.damagedUntil > state.day) continue;
    for (const g of Object.keys(npc.sells)) if (GOODS[g] && GOODS[g].kind !== 'tool' && g !== 'meal' && (npc.stock[g] || 0) >= 1) offers.push([def.id, g, npc.sells[g]]);
  }
  for (let round = 0; round < 3 && goodsBudget > 0; round++) {
    for (const [id, g, unit0] of offers) {
      const npc = state.npcs[id], unit = price(npc.sells[g] || unit0);
      if ((npc.stock[g] || 0) < 1 || unit > goodsBudget) continue;
      if (!transfer(state, 'treasury', npcAcct(id), unit, { why: `public works: bought ${g}` })) continue;
      npc.stock[g] -= 1; npc.soldToday = npc.soldToday || {}; npc.soldToday[g] = (npc.soldToday[g] || 0) + 1;
      goodsBudget = r2(goodsBudget - unit); spent.goods = r2(spent.goods + unit); spent.n++;
    }
  }
  // wages: the rest goes to the villagers with the thinnest purses
  const wages = r2(budget - spent.goods - (budget * 0.6 - spent.goods > 0 ? 0 : 0));
  const poor = Object.keys(state.balances).filter((k) => k.startsWith('bot:')).sort((a, b) => balance(state, a) - balance(state, b)).slice(0, 6);
  if (poor.length && wages >= poor.length) {
    const each = Math.floor((wages / poor.length) * 100) / 100;
    for (const k of poor) if (transfer(state, 'treasury', k, each, { why: 'public works wage' })) spent.wages = r2(spent.wages + each);
  }
  state.publicWorks = { day: state.day, ...spent };
  if (spent.goods + spent.wages >= 1 && state.day % 7 === 0) addLog(state, `Public works this week: the treasury ordered goods from the shops and paid villagers' wages.`, 'info', 'log.publicWorks', {});
}

function updateReadiness(state) {
  const tower = state.npcs.tower;
  const swords = tower.stock.sword || 0, bread = tower.stock.bread || 0;
  const towers = (state.watchtowers || []).length * COUNCIL.tower.readiness; // each extra watchtower helps
  state.readiness = Math.round(Math.min(100, (swords / 8) * 70 + (bread / 6) * 30 + towers));
}

function recordHistory(state) {
  for (const g of Object.keys(GOODS)) {
    const producers = Object.values(state.npcs).filter((n) => n.sells[g] !== undefined);
    const buyers = Object.values(state.npcs).filter((n) => n.buys[g] !== undefined);
    const src = producers.length ? producers.map((n) => n.sells[g]) : buyers.map((n) => n.buys[g]);
    if (!src.length) continue;
    const avg = src.reduce((a, b) => a + b, 0) / src.length;
    (state.history[g] = state.history[g] || []).push(r2(avg));
    if (state.history[g].length > 60) state.history[g].shift();
  }
}

function startNewDay(state) {
  recordDayState(state); // the day that just ended goes on NEAR before anything of the new day happens
  state.day++;
  for (const [id, n] of Object.entries(state.npcs)) { n.walletPrev = n.walletStart; n.walletStart = Math.round(balance(state, npcAcct(id)) * 100) / 100; }
  ensureContracts(state);
  settleContracts(state);
  collectDebts(state);
  villageBuysDeeds(state);
  const ev = state.events;
  if (ev.drought > 0 && --ev.drought === 0) addLog(state, 'Rain returns to the fields. The drought is over.', 'good', 'log.rain');

  // seasons: every 8 days, the last 2 are winter
  const wasWinter = ev.winter;
  ev.winter = state.day % 8 === 0 || state.day % 8 === 7;
  if (ev.winter && !wasWinter) addLog(state, 'Winter arrives. Firewood is in demand.', 'warn', 'log.winter');

  // morning: who slept in a bed, who spent the night outside; coats wear out in winter
  state.activePlayers = Object.values(state.players).filter((p) => p.seenAt !== undefined && state.tick - p.seenAt < RULES.ticksPerDay * 1.5).length;
  for (const p of Object.values(state.players)) {
    const active = p.seenAt !== undefined && state.tick - p.seenAt < RULES.ticksPerDay * 1.5;
    const slept = p.sleep && p.sleep.day === state.day - 1;
    const outside = (p.nightOut || 0) >= RULES.ticksPerDay * 0.1; // more than half the night outside
    p.cold = !!(active && !slept && outside);
    p.nightOut = 0;
    // the day's food: bread from the bag first, the rest bought at the bakery. Only players who
    // played yesterday eat (and pay); someone who was away is not charged.
    p.hungry = false;
    if (active) {
      let need = RULES.dailyBread, fromBag = 0, bought = 0, paid = 0;
      const own = Math.min(need, inv(p, 'bread'));
      if (own > 0) { addInv(p, 'bread', -own); need -= own; fromBag = own; }
      if (need > 0) {
        p.foodWhy = null;
        while (need > 0) {
          const res = buyFromNpc(state, { acct: 'player:' + p.id, holder: p }, 'bakery', 'bread', 1);
          if (!res.ok) { p.foodWhy = res.code === 'err.noMoney' ? 'money' : 'stock'; break; }
          addInv(p, 'bread', -1); bought++; paid = r2(paid + res.total); need--;
          p.stats = p.stats || {}; p.stats.spent = r2((p.stats.spent || 0) + res.total);
        }
      }
      // no money: the baker gives bread on credit if the usual credit rules allow it (paid back within 3 days)
      let credit = 0;
      if (need > 0 && p.foodWhy === 'money') {
        const c = giveCredit(state, p.id, 'bakery', need);
        if (c && c.good === 'bread') { const eat = Math.min(need, inv(p, 'bread')); addInv(p, 'bread', -eat); need -= eat; credit = eat; }
      }
      p.hungry = need > 0;
      p.food = { day: state.day, fromBag, bought, paid, credit, missing: need, why: need > 0 ? p.foodWhy || 'stock' : null };
    }
    if (p.cold || p.hungry) p.energy = Math.min(p.energy, maxEnergy(p));
    if (ev.winter && hasCoat(p)) {
      p.wear = p.wear || {};
      p.wear.coat = (p.wear.coat || 0) + 1;
      if (p.wear.coat >= RULES.coatWinterDays) { addInv(p, 'coat', -1); p.wear.coat = 0; p.coatWorn = state.day; }
    }
  }
  // the AI craftsmen get better at their trade: they learn demand from yesterday's sales,
  // and a craftsman who makes good money expands the workshop (paid to the carpenter, who builds it)
  for (const def of CRAFTSMEN) {
    const npc = state.npcs[def.id];
    if (!npc) continue;
    // materials piled far above the target get used up, so the store room frees up again
    for (const g of Object.keys(npc.buys)) {
      if (npc.sells[g] !== undefined) continue;
      const cap = 2 * targetFor(state, def.id, g), s0 = npc.stock[g] || 0;
      if (s0 > cap) npc.stock[g] = s0 - Math.ceil((s0 - cap) * USE_UP);
    }
    npc.level = npc.level || 1;
    npc.learn = npc.learn || {};
    npc.history = npc.history || {};
    for (const good of Object.keys(npc.sells)) {
      const sold = (npc.soldToday && npc.soldToday[good]) || 0;
      const h = (npc.history[good] = [...(npc.history[good] || []), sold].slice(-5));
      const avg = h.reduce((a, x) => a + x, 0) / h.length, base = def.target[good] || 1;
      const goal = clamp((avg * 1.5) / base, 0.6, 2);
      npc.learn[good] = Math.round((((npc.learn[good] || 1) * 0.7) + goal * 0.3) * 100) / 100;
    }
    npc.soldToday = {};
    const cost = 250 * npc.level;
    if (npc.level < 3 && def.id !== 'tower' && balance(state, npcAcct(def.id)) > 650 + cost && rng(state) < 0.3) {
      const builder = def.id === 'carpenter' ? 'woodcutter' : 'carpenter';
      if (transfer(state, npcAcct(def.id), npcAcct(builder), cost, { memo: `Emberwick: ${def.name} expands the workshop to level ${npc.level + 1}` })) {
        npc.level++;
        addLog(state, `${def.name} expanded the workshop to level ${npc.level}.`, 'good', 'log.upgraded', { name: { $npc: def.id }, n: npc.level });
      }
    }
  }
  // travellers take some of the inn's rooms tonight
  state.innGuests = Math.floor(rng(state) * 3);

  // bot villagers buy a coat when winter comes (or is near)
  if (ev.winter || state.day % 8 === 6) {
    for (const b of Object.values(state.bots)) {
      if (inv(b, 'coat') > 0 || rng(state) > 0.35) continue;
      const res = buyFromNpc(state, { acct: 'bot:' + b.id, holder: b }, 'tailor', 'coat', 1);
      if (res.ok) b.coatDays = 0;
    }
  }
  if (ev.winter) for (const b of Object.values(state.bots)) if (inv(b, 'coat') > 0 && (b.coatDays = (b.coatDays || 0) + 1) >= RULES.coatWinterDays) { addInv(b, 'coat', -1); b.coatDays = 0; }

  // treasury pays the guard captain when his purse runs low
  const spare = balance(state, 'treasury') - lockedFunds(state);
  if (spare >= RULES.guardSalaryPerDay && balance(state, npcAcct('tower')) < 400) {
    transfer(state, 'treasury', npcAcct('tower'), RULES.guardSalaryPerDay, { why: 'guard salary' });
  }

  // a craftsman whose purse is almost empty gets a small loan from the treasury, so one
  // bad winter cannot stop a whole supply chain (wheat -> flour -> bread)
  for (const def of CRAFTSMEN) {
    if (def.id === 'tower') continue;
    const left = balance(state, 'treasury') - lockedFunds(state);
    if (balance(state, npcAcct(def.id)) < 150 && left >= 150) {
      transfer(state, 'treasury', npcAcct(def.id), 150, { memo: `Emberwick: the treasury helps ${def.name} through a hard time` });
      addLog(state, `The treasury helped ${def.name} with 150 EMWK.`, 'info', 'log.bailout', { name: { $npc: def.id }, n: 150 });
    }
  }

  // the guard eats bread and swords wear out on patrol
  const tower = state.npcs.tower;
  if ((tower.stock.bread || 0) > 0) tower.stock.bread--;
  if (state.day % 2 === 0 && (tower.stock.sword || 0) > 0) tower.stock.sword--;

  // money keeps circulating: rich shops pay a profit tax to the treasury,
  // and the inn buys imported ale from travelling merchants
  for (const def of CRAFTSMEN) {
    const acct = npcAcct(def.id), bal = balance(state, acct);
    if (bal > RULES.profitTaxAbove) transfer(state, acct, 'treasury', (bal - RULES.profitTaxAbove) * RULES.profitTaxRate, { why: 'profit tax' });
  }
  publicWorks(state);
  // council reserves are released when their time is up
  if ((state.reserveHolds || []).length) {
    const done = state.reserveHolds.filter((h) => h.until <= state.day);
    state.reserveHolds = state.reserveHolds.filter((h) => h.until > state.day);
    for (const h of done) addLog(state, `The ${h.asset} reserve of ${h.amount} EMWK is released and can be spent again.`, 'info', 'log.reserveFree', { n: h.amount, asset: h.asset });
  }
  // village tax: anyone holding more than villageTaxAbove pays a small share of the extra each morning.
  // Without it, money slowly piles up with the villagers while the treasury pays the guards and helps shops.
  let villageTax = 0;
  for (const k of Object.keys(state.balances)) {
    if (!k.startsWith('player:') && !k.startsWith('bot:')) continue;
    const bal = balance(state, k), extra = bal - RULES.villageTaxAbove;
    const due = Math.floor((extra * RULES.villageTaxRate + Math.max(0, bal - RULES.richTaxAbove) * RULES.richTaxRate) * 100) / 100;
    if (due >= 0.01 && transfer(state, k, 'treasury', due, { memo: 'Emberwick: morning village tax' })) {
      villageTax += due;
      if (k.startsWith('player:')) { const pl = state.players[k.slice(7)]; if (pl) { pl.stats = pl.stats || {}; pl.stats.taxes = r2((pl.stats.taxes || 0) + due); pl.lastTax = { day: state.day, amount: due }; } }
    }
  }
  state.weekTax = r2((state.weekTax || 0) + villageTax);
  if (state.day % 7 === 0 && state.weekTax >= 1) { // one line a week in the news, not every morning
    addLog(state, `This week's village tax: ${state.weekTax} EMWK went to the treasury.`, 'info', 'log.villageTax', { n: state.weekTax });
    state.weekTax = 0;
  }
  // shops buy supplies from outside the village (salt, nails, cloth): rich shops
  // send part of their extra money to the travellers' fund, which pays the merchants
  for (const def of CRAFTSMEN) {
    const acct = npcAcct(def.id), extra = balance(state, acct) - 500;
    if (extra > 0) transfer(state, acct, 'adventurerFund', extra * 0.15, { why: 'trade with travellers' });
  }
  const innBal = balance(state, npcAcct('inn'));
  if (innBal > 500) transfer(state, npcAcct('inn'), 'adventurerFund', (innBal - 500) * 0.8, { why: 'supplies bought from travellers' });

  // random events
  if (ev.drought === 0 && rng(state) < RULES.droughtChance) {
    ev.drought = 2;
    addLog(state, 'A drought hits the fields. Wheat harvests are halved.', 'warn', 'log.drought');
  }
  const rested = state.day - (ev.lastAttack || 0) >= RULES.daysBetweenAttacks;
  if (ev.dragon === 0 && ev.attackDay === null && state.day > 2 && rested && rng(state) < RULES.dragonChance) {
    ev.dragon = RULES.dragonWarningDays;
    ev.attackDay = state.day + RULES.dragonWarningDays;
    addLog(state, `Smoke rises over Dragon peak. The dragon may attack in ${RULES.dragonWarningDays} days.`, 'danger', 'log.smoke', { days: RULES.dragonWarningDays });
  } else if (ev.dragon > 0) {
    ev.dragon--;
  }
  if (ev.attackDay !== null && state.day >= ev.attackDay) resolveAttack(state);
  for (let i = 0; i < 3; i++) runMerchants(state);
  chooseBotWork(state);
  postJobOffers(state);
}

// ---------- jobs and homes ----------

// ---------- the village council ----------

export const taxRate = (state) => (state.taxRate ?? RULES.taxRate);

function ensureCouncil(state) {
  if (!state.council) state.council = { open: [], closed: [], nextId: 1 };
}

// vote weight: sqrt(wealth) * 0.5 + days lived here (max 10) + what you gave (max 10)
export function voteWeight(state, voter) {
  const W = COUNCIL.weight;
  let bal = 0, days = 0, gave = 0;
  if (voter.startsWith('player:')) {
    const p = state.players[voter.slice(7)];
    if (!p) return null;
    bal = balance(state, voter);
    days = state.day - (p.joinedDay || state.day);
    const st = p.stats || {};
    gave = (st.taxes || 0) + (st.shifts || 0) + (st.sold || 0) * 0.2;
  } else if (voter.startsWith('bot:')) {
    bal = balance(state, voter); days = state.day; gave = 2;
  } else if (voter.startsWith('npc:')) {
    bal = balance(state, voter); days = W.residencyCap; gave = 5;
  }
  const parts = {
    wealth: r2(Math.sqrt(Math.max(0, bal)) * W.wealth),
    residency: Math.min(W.residencyCap, Math.max(0, days)),
    contribution: r2(Math.min(W.contributionCap, gave)),
  };
  return { ...parts, total: r2(parts.wealth + parts.residency + parts.contribution) };
}

function freeTowerSpot(state) {
  return COUNCIL.tower.spots.find((id) => !(state.watchtowers || []).includes(id)) || null;
}

function clampProposal(kind, a) {
  const c = COUNCIL[kind];
  if (kind === 'grant') {
    if (!CRAFTSMEN.some((d) => d.id === a.npc)) return null;
    return { npc: a.npc, amount: Math.round(Math.min(c.max, Math.max(c.min, Number(a.amount) || 0))) };
  }
  if (kind === 'tax') return { rate: Math.round(Math.min(c.max, Math.max(c.min, Number(a.rate) || 0)) * 100) / 100 };
  if (kind === 'welcome') return { amount: Math.round(Math.min(c.max, Math.max(c.min, Number(a.amount) || 0))) };
  if (kind === 'festival') return { amount: Math.round(Math.min(c.max, Math.max(c.min, Number(a.amount) || 0))) };
  if (kind === 'tower') return { cost: c.cost };
  if (kind === 'district') return { n: Number(a.n) || null };
  if (kind === 'reserve') return { pct: Math.round(Math.min(c.max, Math.max(c.min, Number(a.pct) || 10))), asset: c.assets.includes(a.asset) ? a.asset : c.assets[0] };
  return null;
}

function voters(state) {
  return [
    ...Object.keys(state.players).map((id) => 'player:' + id),
    ...Object.keys(state.bots).map((id) => 'bot:' + id),
    ...CRAFTSMEN.map((c) => 'npc:' + c.id),
  ];
}

function voterName(state, v) {
  if (v.startsWith('player:')) return (state.players[v.slice(7)] || {}).name || '?';
  if (v.startsWith('bot:')) return (state.bots[v.slice(4)] || {}).name || '?';
  return v; // craftsmen are named on the client, in the player's language
}

function propose(state, by, kind, args) {
  ensureCouncil(state);
  if (!COUNCIL.kinds.includes(kind)) return { ok: false, error: 'Unknown proposal.', code: 'err.badProposal' };
  const params = clampProposal(kind, args || {});
  if (!params) return { ok: false, error: 'Unknown proposal.', code: 'err.badProposal' };
  if (kind === 'tower' && !freeTowerSpot(state)) return { ok: false, error: 'There is no room for another watchtower.', code: 'err.noTowerSpot' };
  if (kind === 'district') {
    const n = nextDistrict(state);
    if (!n) return { ok: false, error: 'There is no new land to open right now.', code: 'err.noDistrict' };
    params.n = n; params.cost = DISTRICTS[n].cost;
  }
  if (state.council.open.length >= COUNCIL.maxOpen) return { ok: false, error: 'The council is full. Wait for a vote to end.', code: 'err.councilFull' };
  if (state.council.open.some((x) => x.kind === kind && JSON.stringify(x.params) === JSON.stringify(params))) return { ok: false, error: 'That is already being voted on.', code: 'err.sameProposal' };
  if (by.startsWith('player:') && !transfer(state, by, 'treasury', COUNCIL.fee, { why: 'council proposal fee' })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
  const id = state.council.nextId++;
  const prop = { id, kind, params, by, byName: voterName(state, by), day: state.day, closesTick: state.tick + RULES.ticksPerDay, votes: {}, aiPlan: {} };
  // AI voters decide at different moments during the day
  for (const v of voters(state)) if (!v.startsWith('player:')) prop.aiPlan[v] = state.tick + 1 + Math.floor(rng(state) * RULES.ticksPerDay * 0.8);
  state.council.open.push(prop);
  addLog(state, `New council proposal #${id}.`, 'info', 'log.proposal', { name: by.startsWith('npc:') ? { $npc: by.slice(4) } : prop.byName, n: id });
  return { ok: true, id };
}

function vote(state, voter, id, yes) {
  ensureCouncil(state);
  const prop = state.council.open.find((x) => x.id === Number(id));
  if (!prop) return { ok: false, error: 'That vote has ended.', code: 'err.voteClosed' };
  if (prop.votes[voter]) return { ok: false, error: 'You already voted.', code: 'err.voted' };
  const w = voteWeight(state, voter);
  if (!w) return { ok: false, error: 'Unknown player.', code: 'err.unknownPlayer' };
  prop.votes[voter] = { yes: !!yes, w: w.total };
  return { ok: true, weight: w.total };
}

// how an AI villager or craftsman feels about a proposal, and why (shown in the vote list)
function aiOpinion(state, voter, prop) {
  const tre = balance(state, 'treasury');
  const rich = tre > 6000, r = rng(state);
  const isNpc = voter.startsWith('npc:');
  const danger = state.events.attackDay !== null || state.readiness < 60;
  const say = (yes, why) => ({ yes, why });
  switch (prop.kind) {
    case 'grant':
      if (voter === 'npc:' + prop.params.npc) return say(true, 'self');
      if (prop.params.npc === 'tower' && danger) return r < 0.9 ? say(true, 'danger') : say(false, 'notMyShop');
      if (rich) return r < 0.55 ? say(true, 'rich') : say(false, 'notMyShop');
      return r < 0.25 ? say(true, 'help') : say(false, 'poor');
    case 'tax': {
      const lower = prop.params.rate < taxRate(state);
      if (isNpc) return lower ? (r < 0.85 ? say(true, 'taxShop') : say(false, 'treasuryNeeds')) : (r < 0.15 ? say(true, 'treasuryNeeds') : say(false, 'taxShop'));
      if (lower) return tre > 4000 ? (r < 0.7 ? say(true, 'cheaper') : say(false, 'treasuryNeeds')) : (r < 0.35 ? say(true, 'cheaper') : say(false, 'poor'));
      return tre < 4000 ? (r < 0.6 ? say(true, 'treasuryNeeds') : say(false, 'pricier')) : (r < 0.25 ? say(true, 'treasuryNeeds') : say(false, 'pricier'));
    }
    case 'welcome':
      if (isNpc) return (rich ? r < 0.6 : r < 0.3) ? say(true, 'customers') : say(false, rich ? 'notNeeded' : 'poor');
      return r < 0.6 ? say(true, 'newcomers') : say(false, 'notNeeded');
    case 'district': {
      if (voter === 'npc:carpenter' || voter === 'npc:woodcutter') return say(true, 'self');
      const few = freePlots(state) <= 1;
      if (few) return r < 0.8 ? say(true, 'growth') : say(false, 'poor');
      return (rich ? r < 0.5 : r < 0.2) ? say(true, 'growth') : say(false, rich ? 'notNeeded' : 'poor');
    }
    case 'tower':
      if (voter === 'npc:carpenter' || voter === 'npc:tower') return say(true, 'self');
      if (danger) return r < 0.85 ? say(true, 'danger') : say(false, 'poor');
      return (rich ? r < 0.5 : r < 0.2) ? say(true, 'safety') : say(false, rich ? 'notNeeded' : 'poor');
    case 'reserve':
      // craftsmen would rather see the money spent in the village; villagers like a safety net, more so with the dragon near
      if (isNpc) return (danger ? r < 0.45 : r < 0.25) ? say(true, 'safety') : say(false, 'spendIt');
      return (danger || rich ? r < 0.75 : r < 0.45) ? say(true, 'safety') : say(false, 'spendIt');
    case 'festival':
      if (isNpc) return (rich ? r < 0.45 : r < 0.15) ? say(true, 'customers') : say(false, rich ? 'waste' : 'poor');
      return r < 0.85 ? say(true, 'festival') : say(false, 'waste');
    default: return say(false, 'waste');
  }
}

function enact(state, prop) {
  const p = prop.params;
  const spare = balance(state, 'treasury') - lockedFunds(state);
  if (prop.kind === 'grant') {
    if (spare < p.amount) return 'poor';
    transfer(state, 'treasury', npcAcct(p.npc), p.amount, { why: `council #${prop.id}: grant` });
  } else if (prop.kind === 'tax') {
    state.taxRate = p.rate;
  } else if (prop.kind === 'welcome') {
    if (spare < p.amount) return 'poor';
    transfer(state, 'treasury', 'newcomerFund', p.amount, { why: `council #${prop.id}: newcomer fund` });
  } else if (prop.kind === 'district') {
    const n = p.n;
    if (!n || districtOpen(state, n) || !districtOpen(state, DISTRICTS[n].needs)) return 'poor';
    if (spare < DISTRICTS[n].cost) return 'poor';
    // the roads and the clearing are built by the carpenter and the woodcutter
    transfer(state, 'treasury', npcAcct('carpenter'), DISTRICTS[n].cost / 2, { memo: `Emberwick council #${prop.id}: open ${DISTRICTS[n].name}` });
    transfer(state, 'treasury', npcAcct('woodcutter'), DISTRICTS[n].cost / 2, { memo: `Emberwick council #${prop.id}: clear land for ${DISTRICTS[n].name}` });
    state.districts = [...(state.districts || []), n];
    addLog(state, `${DISTRICTS[n].name} is open. New plots are for sale.`, 'good', 'log.districtOpen', { place: { $district: n } });
  } else if (prop.kind === 'tower') {
    const spot = freeTowerSpot(state);
    if (!spot) return 'poor';
    if (spare < p.cost) return 'poor';
    transfer(state, 'treasury', npcAcct('carpenter'), p.cost, { memo: `Emberwick council #${prop.id}: build a watchtower (${spot})` });
    state.watchtowers = [...(state.watchtowers || []), spot];
    addLog(state, 'A new watchtower stands. The village is better prepared.', 'good', 'log.towerBuilt', {});
  } else if (prop.kind === 'reserve') {
    const amount = Math.round(spare * p.pct / 100);
    if (amount < 50) return 'poor';
    const q = prop.quote && prop.quote.ok ? prop.quote : null;
    state.reserveHolds = [...(state.reserveHolds || []), { id: prop.id, asset: p.asset, pct: p.pct, amount, day: state.day, until: state.day + COUNCIL.reserve.days,
      near: r2(amount / RULES.emwkPerNear), out: q ? q.out : null, usd: q ? q.usd : null }];
    prop.params.amount = amount;
    addLog(state, `The council set ${amount} EMWK aside as a ${p.asset} reserve for ${COUNCIL.reserve.days} days.`, 'good', 'log.reserveSet', { n: amount, asset: p.asset, days: COUNCIL.reserve.days });
  } else if (prop.kind === 'festival') {
    const people = [...Object.keys(state.players).map((id) => 'player:' + id), ...Object.keys(state.bots).map((id) => 'bot:' + id)];
    if (spare < p.amount * people.length) return 'poor';
    for (const h of people) transfer(state, 'treasury', h, p.amount, { why: `council #${prop.id}: payout to villagers` });
  }
  return 'done';
}

function runCouncil(state, newDay) {
  ensureCouncil(state);
  const c = state.council;
  for (const prop of c.open) {
    for (const [v, at] of Object.entries(prop.aiPlan)) {
      if (state.tick < at || prop.votes[v]) continue;
      const w = voteWeight(state, v);
      if (w) { const o = aiOpinion(state, v, prop); prop.votes[v] = { yes: o.yes, w: w.total, why: o.why }; }
      delete prop.aiPlan[v];
    }
  }
  // close the votes that have run for a full day
  for (const prop of c.open.filter((x) => state.tick >= x.closesTick)) {
    const vs = Object.values(prop.votes);
    prop.yes = r2(vs.filter((x) => x.yes).reduce((a, x) => a + x.w, 0));
    prop.no = r2(vs.filter((x) => !x.yes).reduce((a, x) => a + x.w, 0));
    prop.voters = vs.length;
    if (vs.length < COUNCIL.quorum) prop.result = 'quorum';
    else if (prop.yes <= prop.no) prop.result = 'rejected';
    else prop.result = enact(state, prop) === 'done' ? 'passed' : 'poor';
    prop.closedDay = state.day;
    delete prop.aiPlan;
    // the decision goes on NEAR: a 0.01 EMWK record from the treasury carries it in the memo
    const what = { grant: `grant ${prop.params.amount} to ${prop.params.npc}`, tax: `market tax ${Math.round(prop.params.rate * 100)}%`, welcome: `${prop.params.amount} to newcomer fund`, festival: `festival ${prop.params.amount} per villager`, tower: `build a watchtower for ${prop.params.cost}`, district: `open ${(DISTRICTS[prop.params.n] || {}).name} for ${prop.params.cost}`, reserve: `set ${prop.params.pct}% aside as ${prop.params.asset}${prop.params.amount ? ` (${prop.params.amount} EMWK` + (prop.quote && prop.quote.ok ? `, NEAR Intents quote ${prop.quote.out} ${prop.params.asset}` : '') + ')' : ''}` }[prop.kind];
    transfer(state, 'treasury', 'newcomerFund', 0.01, { memo: `Emberwick council #${prop.id} (${what}): ${prop.result.toUpperCase()}. Yes ${prop.yes} / No ${prop.no}, ${prop.voters} voters.`, council: prop.id });
    c.open = c.open.filter((x) => x !== prop);
    c.closed.unshift(prop);
    c.closed.length = Math.min(c.closed.length, 8);
    addLog(state, `Council proposal #${prop.id}: ${prop.result}.`, prop.result === 'passed' ? 'good' : 'warn', 'log.decided.' + prop.result, { n: prop.id });
  }
  if (!newDay) return;
  // the AI villagers bring their own ideas to the council now and then (each idea at most every 3 days)
  if (c.open.length < 2 && rng(state) < 0.5) {
    c.lastIdea = c.lastIdea || {};
    const fresh = (k) => (c.lastIdea[k] || -99) <= state.day - 3;
    const tre = balance(state, 'treasury');
    const bot = () => 'bot:b' + (1 + Math.floor(rng(state) * 12));
    const ideas = [];
    if (state.events.attackDay !== null || state.readiness < 45) ideas.push(['npc:tower', 'grant', { npc: 'tower', amount: 150 }]);
    const nd = nextDistrict(state);
    if (nd && freePlots(state) <= 1 && tre > RULES.treasuryReserve + DISTRICTS[nd].cost + 500) ideas.push([bot(), 'district', { n: nd }]);
    if ((state.events.attackDay !== null || state.readiness < 60) && freeTowerSpot(state) && tre > RULES.treasuryReserve + 1500) ideas.push(['npc:tower', 'tower', {}]);
    if (tre > 7000) ideas.push([bot(), 'festival', { amount: 4 }]);
    if (tre > 7500 && !(state.reserveHolds || []).length) ideas.push([bot(), 'reserve', { pct: 10, asset: 'USDC' }]);
    if (taxRate(state) > COUNCIL.tax.min) ideas.push(['npc:' + CRAFTSMEN[Math.floor(rng(state) * CRAFTSMEN.length)].id, 'tax', { rate: Math.max(COUNCIL.tax.min, r2(taxRate(state) - 0.01)) }]);
    if (tre < 4000 && taxRate(state) < COUNCIL.tax.max) ideas.push([bot(), 'tax', { rate: Math.min(COUNCIL.tax.max, r2(taxRate(state) + 0.01)) }]);
    if (balance(state, 'newcomerFund') < 1500) ideas.push([bot(), 'welcome', { amount: 200 }]);
    const pick = ideas.filter(([, k]) => fresh(k));
    if (pick.length) {
      const [by, kind, args] = pick[Math.floor(rng(state) * pick.length)];
      if (propose(state, by, kind, args).ok) c.lastIdea[kind] = state.day;
    }
  }
}

function councilView(state, playerId) {
  ensureCouncil(state);
  const me = playerId ? 'player:' + playerId : null;
  const show = (prop, open) => {
    const vs = Object.entries(prop.votes);
    const yes = r2(vs.filter(([, x]) => x.yes).reduce((a, [, x]) => a + x.w, 0));
    const no = r2(vs.filter(([, x]) => !x.yes).reduce((a, [, x]) => a + x.w, 0));
    return {
      id: prop.id, kind: prop.kind, params: prop.params, by: prop.by, byName: prop.byName,
      left: open ? Math.max(0, prop.closesTick - state.tick) / RULES.ticksPerDay : 0,
      yes, no, voters: vs.length, myVote: me && prop.votes[me] ? prop.votes[me].yes : null,
      list: vs.map(([v, x]) => ({ who: v.startsWith('npc:') ? v : voterName(state, v), yes: x.yes, w: x.w, why: x.why || null, me: v === me })).sort((a, b) => b.w - a.w).slice(0, 20),
      result: open ? null : prop.result, closedDay: prop.closedDay, quote: prop.quote || null,
    };
  };
  return {
    open: state.council.open.map((x) => show(x, true)),
    closed: state.council.closed.slice(0, 5).map((x) => show(x, false)),
    taxRate: taxRate(state), rules: COUNCIL, reserve: RULES.treasuryReserve, held: heldReserve(state), emwkPerNear: RULES.emwkPerNear,
    myWeight: me ? voteWeight(state, me) : null,
  };
}

export function ensureContracts(state) {
  ensureCouncil(state);
  // villages saved before the tailor opened: the shop opens with money from the treasury
  for (const c of CRAFTSMEN) if (!state.npcs[c.id]) {
    state.npcs[c.id] = { id: c.id, buys: { ...c.buys }, sells: { ...c.sells }, base: { ...c.buys, ...c.sells }, stock: { ...c.stock }, damagedUntil: 0, mood: c.lines[0] };
    if (!transfer(state, 'treasury', npcAcct(c.id), c.wallet, { memo: `Emberwick: ${c.name} opens a shop` })) state.balances[npcAcct(c.id)] = state.balances[npcAcct(c.id)] || 0;
    addLog(state, `${c.name} opened a new shop in the village.`, 'good', 'log.newShop', { name: { $npc: c.id } });
  }
  if (!state.plots) state.plots = {};
  for (const d of PLOT_DEFS) if (!state.plots[d.id]) state.plots[d.id] = { owner: null, built: false, deed: null };
  if (!state.districts) state.districts = [];
  if (!state.market) state.market = { orders: [], nextId: 1, trades: [] };
  // shops learn new goods added in later versions (e.g. the carpenter's beds)
  for (const c of CRAFTSMEN) {
    const n = state.npcs[c.id];
    if (!n) continue;
    for (const [g, v] of Object.entries(c.sells)) if (n.sells[g] === undefined) { n.sells[g] = v; n.base[g] = v; n.stock[g] = c.stock[g] || 0; }
    for (const [g, v] of Object.entries(c.buys)) if (n.buys[g] === undefined) { n.buys[g] = v; n.base[g] = v; n.stock[g] = n.stock[g] || c.stock[g] || 0; }
  }
  if (!state.jobOffers) state.jobOffers = {};
  if (!state.houses) state.houses = Object.fromEntries(Object.keys(HOUSES).map((id) => [id, { tenant: null, since: null }]));
  if (state.balances.deposits === undefined) state.balances.deposits = 0;
  if (!state.jobsPosted) { state.jobsPosted = true; postJobOffers(state); }
}

function wageFor(state, npc) {
  const bal = balance(state, npcAcct(npc));
  return Math.max(4, Math.round(JOBS.wageBase[npc] * Math.min(1.4, Math.max(0.7, bal / 500))));
}

function employs(state, npc) {
  return Object.values(state.players).some((p) => p.job && p.job.npc === npc);
}

function postJobOffers(state) {
  state.jobOffers = {};
  for (const def of CRAFTSMEN) {
    const n = state.npcs[def.id];
    if (!JOBS.wageBase[def.id] || n.damagedUntil > state.day || employs(state, def.id)) continue;
    const wage = wageFor(state, def.id);
    if (balance(state, npcAcct(def.id)) < wage * JOBS.shiftsPerDay * JOBS.days + JOBS.reserve) continue;
    state.jobOffers[def.id] = { npc: def.id, wage, days: JOBS.days, day: state.day, require: JOBS.require[def.id] || null };
  }
}

function endJob(state, p, reason) {
  const j = p.job;
  if (!j) return;
  let severance = 0;
  if (reason === 'closed' || reason === 'broke') {
    severance = r2(j.wage * JOBS.severanceDays);
    // the employer pays; if they cannot, the village treasury steps in
    const payer = balance(state, npcAcct(j.npc)) >= severance ? npcAcct(j.npc) : 'treasury';
    transfer(state, payer, 'player:' + p.id, severance, { why: 'severance pay' });
    p.stats.earned = r2(p.stats.earned + severance);
    addLog(state, `${p.name}'s job ended early. Severance paid: ${severance} EMWK.`, 'warn', 'log.severance', { name: p.name, n: severance, place: { $place: j.npc }, payer: payer === 'treasury' ? 'treasury' : 'npc' });
  } else if (reason === 'quit') {
    // quitting early: the apprentice pays the employer a notice fee, as far as they can
    const fee = r2(Math.min(j.wage * JOBS.noticeShifts, balance(state, 'player:' + p.id)));
    if (fee > 0) {
      transfer(state, 'player:' + p.id, npcAcct(j.npc), fee, { why: 'notice fee (left the job early)' });
      p.stats.spent = r2(p.stats.spent + fee);
    }
    j.fee = fee;
    p.quitUntil = state.day + JOBS.coolDownDays;
    addLog(state, `${p.name} quit a job and paid a ${fee} EMWK notice fee.`, 'warn', 'log.quit', { name: p.name, n: fee, place: { $place: j.npc } });
  } else if (reason === 'done') {
    addLog(state, `${p.name} finished an apprenticeship.`, 'good', 'log.jobDone', { name: p.name, place: { $place: j.npc }, n: j.shifts });
  }
  p.jobsDone = (p.jobsDone || 0) + (reason === 'quit' ? 0 : 1);
  p.job = null;
}

function settleContracts(state) {
  for (const p of Object.values(state.players)) {
    if (p.job) {
      const j = p.job, n = state.npcs[j.npc];
      j.daysLeft--;
      if (n.damagedUntil > state.day) endJob(state, p, 'closed');
      else if (j.daysLeft <= 0) endJob(state, p, 'done');
      else if (balance(state, npcAcct(j.npc)) < j.wage) endJob(state, p, 'broke');
    }
    if (p.lease) {
      const plot = state.plots[p.lease];
      if (!plot || !plot.lease || plot.lease.tenant !== p.id) p.lease = null;
      else if (!transfer(state, 'player:' + p.id, 'player:' + plot.owner, plot.lease.rent, { memo: `Emberwick: rent for ${p.lease}` })) {
        addLog(state, `${p.name} could not pay the rent and had to move out.`, 'warn', 'log.evicted', { name: p.name, place: { $place: p.lease } });
        plot.lease.tenant = null; p.lease = null;
      } else p.stats.spent = r2(p.stats.spent + plot.lease.rent);
    }
    if (p.home) {
      const h = HOUSES[p.home];
      if (!transfer(state, 'player:' + p.id, 'treasury', h.rent, { why: 'daily rent' })) {
        // cannot pay: the deposit covers the debt and the home is given back
        transfer(state, 'deposits', 'treasury', h.deposit, { why: 'rent deposit kept (rent not paid)' });
        addLog(state, `${p.name} could not pay the rent and had to move out.`, 'warn', 'log.evicted', { name: p.name, place: { $place: p.home } });
        state.houses[p.home] = { tenant: null, since: null };
        p.home = null;
      } else {
        p.stats.spent = r2(p.stats.spent + h.rent);
      }
    }
  }
}

// an AI craftsman decides on a job application, with a reason the player can read
// interview rounds: every 12 steps while shops are open (nights wait for the morning)
const INTERVIEW_EVERY = 12;
function nextInterview(state) {
  const per = RULES.ticksPerDay, inDay = state.tick % per;
  if (isNight(state)) return { tick: (Math.floor(state.tick / per) + 1) * per, morning: true };
  return { tick: state.tick + (INTERVIEW_EVERY - (state.tick % INTERVIEW_EVERY)), morning: false, inDay };
}
// how much a craftsman values an applicant (the AI's own judgement), and the wage it offers them
function applicantScore(state, p, npc) {
  const req = JOBS.require[npc];
  const skill = req ? skillLevel(p, req.skill) : Math.max(...['farming', 'woodcutting', 'mining'].map((k) => skillLevel(p, k)));
  return { skill, score: skill * 2 + (p.jobsDone || 0) + skillLevel(p, 'trading') * 0.5 + rng(state) * 0.5 };
}
function runInterviews(state) {
  const apps = state.applications || {};
  for (const [npc, list] of Object.entries(apps)) {
    if (!list.length) continue;
    const o = state.jobOffers[npc];
    const people = list.map((x) => state.players[x.pid]).filter((p) => p && !p.job);
    apps[npc] = [];
    if (!o) { for (const p of people) p.appResult = { npc, day: state.day, hired: false, why: 'filled', count: people.length }; continue; }
    const judged = people.map((p) => ({ p, v: judgeApplicant(state, p, npc), ...applicantScore(state, p, npc) }));
    const fit = judged.filter((x) => x.v.ok).sort((a, b) => b.score - a.score);
    const best = fit[0];
    for (const x of judged) {
      if (x === best) continue;
      x.p.appResult = { npc, day: state.day, hired: false, why: x.v.ok ? 'otherBetter' : x.v.why, need: x.v.need, count: people.length };
      addLog(state, `${x.p.name} applied for a job and was turned down.`, 'warn', 'log.turnedDown', { name: x.p.name, place: { $place: npc } });
    }
    if (!best) continue;
    // a better-skilled apprentice is offered more per shift (up to +60%)
    const wage = Math.round(o.wage * Math.min(1.6, 1 + 0.15 * (best.skill - 1)));
    hire(state, best.p, o, wage);
    best.p.appResult = { npc, day: state.day, hired: true, why: best.v.why, wage, base: o.wage, count: people.length };
  }
}
function hire(state, p, o, wage) {
  const acct = 'player:' + p.id;
  const contractId = (state.contractSeq = (state.contractSeq || 0) + 1);
  p.job = { npc: o.npc, wage, daysLeft: o.days, startDay: state.day, shiftDay: null, shiftsToday: 0, shifts: 0, contractId };
  delete state.jobOffers[o.npc];
  // signing: a small bonus from the employer carries the contract terms onto NEAR
  const terms = `Emberwick contract #${contractId}: ${o.npc} hires ${p.name}. ${wage} EMWK/shift, max ${JOBS.shiftsPerDay}/day, ${o.days} days, severance ${wage * JOBS.severanceDays}, notice fee ${wage * JOBS.noticeShifts}.`;
  p.job.terms = terms;
  transfer(state, npcAcct(o.npc), acct, JOBS.signingBonus, { memo: terms, contract: contractId });
  p.stats.earned = r2(p.stats.earned + JOBS.signingBonus);
  addLog(state, `${p.name} became an apprentice.`, 'join', 'log.hired', { name: p.name, place: { $place: o.npc }, n: wage });
}

function judgeApplicant(state, p, npc) {
  const req = JOBS.require[npc];
  if (p.quitUntil && p.quitUntil > state.day) return { ok: false, why: 'quitRecently' };
  if (req && skillLevel(p, req.skill) < req.level) return { ok: false, why: 'needSkill', need: { skill: req.skill, level: req.level, have: skillLevel(p, req.skill) } };
  if (req) return { ok: true, why: 'skilled' };
  return { ok: true, why: (p.jobsDone || 0) > 0 ? 'experienced' : 'beginner' };
}

function contractAction(state, p, action) {
  const acct = 'player:' + p.id;
  if (action.type === 'buyPlot') {
    const plot = state.plots[action.plot];
    if (!plot) return { ok: false, error: 'Unknown place.', code: 'err.unknownPlace' };
    if (plot.owner) return { ok: false, error: 'This plot is already sold.', code: 'err.plotSold' };
    if (p.plot) return { ok: false, error: 'You already own a plot.', code: 'err.havePlot' };
    if (!plotOpen(state, action.plot)) return { ok: false, error: 'This neighbourhood is not open yet. The council decides when it opens.', code: 'err.districtClosed' };
    const def = plotDef(action.plot), need = def.district ? DISTRICTS[def.district].minLevel : 0;
    if (playerLevel(p) < need) return { ok: false, error: `You need level ${need} to buy here.`, code: 'err.needLevel', need, have: playerLevel(p) };
    const cost = plot.resale || plotPrice(action.plot); // a plot the village bought back comes with its house
    if (!transfer(state, acct, 'treasury', cost, { why: `bought land (${action.plot})` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
    p.stats.spent = r2(p.stats.spent + cost);
    const old = plot.deed && plot.deed.minted ? plot.deed : null;
    plot.owner = p.id; plot.since = state.day; plot.resale = null;
    if (old) { emit('deedMove', { plot: action.plot, tokenId: old.tokenId, wallet: (p.nearVerified && p.near) || null }); }
    else plot.deed = { tokenId: `${action.plot}-${state.day}-${p.id}`, minted: false };
    p.plot = action.plot;
    addLog(state, `${p.name} bought land.`, 'good', 'log.boughtPlot', { name: p.name, place: { $place: action.plot } });
    if (!old) emit('deed', { plot: action.plot, tokenId: plot.deed.tokenId, player: p.id, name: p.name, wallet: (p.nearVerified && p.near) || null, day: state.day });
    return { ok: true, plot: action.plot, price: cost };
  }
  if (action.type === 'buildHouse') {
    const plot = state.plots[action.plot];
    if (!plot || plot.owner !== p.id) return { ok: false, error: 'This is not your land.', code: 'err.notYourPlot' };
    if (plot.built) return { ok: false, error: 'Your home is already built.', code: 'err.built' };
    const b = plotBuild(action.plot);
    if (inv(p, 'lumber') < b.lumber) return { ok: false, error: 'You need more lumber.', code: 'err.needLumber', need: b.lumber, have: inv(p, 'lumber') };
    if (!transfer(state, acct, npcAcct(b.builder), b.fee, { memo: `Emberwick: ${p.name} builds a home on ${action.plot}` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
    addInv(p, 'lumber', -b.lumber);
    p.stats.spent = r2(p.stats.spent + b.fee);
    plot.built = true; plot.builtDay = state.day;
    if (inv(p, 'bed') > 0) { addInv(p, 'bed', -1); plot.bed = true; } // a bed you already bought goes straight in
    addLog(state, `${p.name} built a home.`, 'good', 'log.builtHome', { name: p.name, place: { $place: action.plot } });
    return { ok: true, plot: action.plot };
  }
  // ---- renting out a home you built: the rent goes from the tenant to you every morning ----
  if (action.type === 'listHome') {
    const plot = state.plots[action.plot];
    if (!plot || plot.owner !== p.id || !plot.built) return { ok: false, error: 'This is not your home.', code: 'err.notYourPlot' };
    if (!plot.bed) return { ok: false, error: 'Put a bed in your home first. The carpenter sells beds.', code: 'err.noBedYet' };
    const rent = Math.round(Math.min(LAND.lease.max, Math.max(LAND.lease.min, Number(action.rent) || 0)));
    plot.lease = { ...(plot.lease || {}), rent, tenant: (plot.lease && plot.lease.tenant) || null };
    return { ok: true, rent };
  }
  if (action.type === 'unlistHome') {
    const plot = state.plots[action.plot];
    if (!plot || plot.owner !== p.id || !plot.lease) return { ok: false, error: 'This is not your home.', code: 'err.notYourPlot' };
    if (plot.lease.tenant) return { ok: false, error: 'Someone lives there now. They can move out first.', code: 'err.hasTenant' };
    plot.lease = null;
    return { ok: true };
  }
  if (action.type === 'leaseHome') {
    const plot = state.plots[action.plot];
    if (!plot || !plot.lease || plot.lease.tenant || plot.owner === p.id) return { ok: false, error: 'This home is not for rent.', code: 'err.notForRent' };
    if (p.home || p.lease) return { ok: false, error: 'You already rent a home.', code: 'err.haveHome' };
    const owner = state.players[plot.owner];
    if (!transfer(state, acct, 'player:' + plot.owner, plot.lease.rent, { memo: `Emberwick: ${p.name} rents the home of ${owner ? owner.name : '?'} on ${action.plot}` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
    p.stats.spent = r2(p.stats.spent + plot.lease.rent);
    plot.lease.tenant = p.id; plot.lease.since = state.day;
    p.lease = action.plot;
    addLog(state, `${p.name} rents a home from ${owner ? owner.name : '?'}.`, 'info', 'log.leased', { name: p.name, owner: owner ? owner.name : '?', place: { $place: action.plot } });
    return { ok: true, rent: plot.lease.rent };
  }
  if (action.type === 'leaveLease') {
    const plot = p.lease && state.plots[p.lease];
    if (!plot) return { ok: false, error: 'You do not rent a home.', code: 'err.noHome' };
    if (plot.lease) plot.lease.tenant = null;
    p.lease = null;
    return { ok: true };
  }
  const m = marketAction(state, p, action);
  if (m) return m;
  if (action.type === 'propose') return propose(state, acct, action.kind, action);
  if (action.type === 'vote') return vote(state, acct, action.id, action.yes);
  if (action.type === 'pinSeal') {
    if (!(p.inv && p.inv.seal >= 1)) return { ok: false, error: 'You have no village seal.', code: 'err.noSeal' };
    p.inv.seal -= 1; if (!p.inv.seal) delete p.inv.seal;
    const before = marketFee(state);
    state.sealCount = (state.sealCount || 0) + 1;
    state.sealWall = [{ name: p.name, pid: p.id, day: state.day, at: Date.now() }, ...(state.sealWall || [])].slice(0, 60);
    const fee = marketFee(state);
    addLog(state, `${p.name} hung a village seal on the council wall. Market fee: ${Math.round(fee * 1000) / 10}%.`, 'good', 'log.sealPinned', { name: p.name, fee: Math.round(fee * 1000) / 10 });
    return { ok: true, fee, before };
  }
  if (action.type === 'takeJob' || action.type === 'apply') {
    // applications are collected; the craftsman interviews everyone at the next interview round
    // (several times a day while the shop is open, first thing in the morning after a night)
    const o = state.jobOffers[action.npc];
    if (!o) return { ok: false, error: 'That job is no longer offered.', code: 'err.noJob' };
    if (p.job) return { ok: false, error: 'You already have a job.', code: 'err.haveJob' };
    const apps = (state.applications = state.applications || {});
    for (const list of Object.values(apps)) if (list.some((x) => x.pid === p.id)) return { ok: false, error: 'You are already waiting for an interview.', code: 'err.applied' };
    // the written requirements on the notice board are checked at once; the choice between applicants waits for the interview
    const verdict = judgeApplicant(state, p, o.npc);
    if (!verdict.ok) return { ok: false, error: 'The craftsman turned you down.', code: 'err.turnedDown', why: verdict.why, need: verdict.need };
    (apps[o.npc] = apps[o.npc] || []).push({ pid: p.id, day: state.day, tick: state.tick });
    p.appResult = null;
    return { ok: true, applied: o.npc, waiting: apps[o.npc].length, next: nextInterview(state) };
  }
  if (action.type === 'withdrawApplication') {
    const apps = state.applications || {};
    for (const k of Object.keys(apps)) apps[k] = apps[k].filter((x) => x.pid !== p.id);
    return { ok: true };
  }
  if (action.type === 'shift') {
    if (isNight(state)) return NIGHT_ERR;
    const j = p.job;
    if (!j || (action.npc && action.npc !== j.npc)) return { ok: false, error: 'You do not work here.', code: 'err.noJobHere' };
    if (j.shiftDay !== state.day) { j.shiftDay = state.day; j.shiftsToday = 0; }
    if (j.shiftsToday >= JOBS.shiftsPerDay) return { ok: false, error: 'You worked all your shifts today.', code: 'err.shiftDone' };
    if (state.npcs[j.npc].damagedUntil > state.day) return { ok: false, error: 'This shop is closed.', code: 'err.closed' };
    if (p.energy < JOBS.shiftEnergy) return { ok: false, error: 'You are too tired.', code: 'err.tired' };
    if (!transfer(state, npcAcct(j.npc), acct, j.wage, { why: 'shift wage' })) {
      endJob(state, p, 'broke');
      return { ok: false, error: 'The shopkeeper cannot pay. Your contract ended.', code: 'err.employerBroke' };
    }
    p.energy = r2(p.energy - JOBS.shiftEnergy);
    j.shiftsToday++;
    j.shifts++;
    p.stats.shifts = (p.stats.shifts || 0) + 1;
    p.stats.earned = r2(p.stats.earned + j.wage);
    // your work turns into goods on the craftsman's shelf
    const def = CRAFTSMEN.find((c) => c.id === j.npc);
    let made = null;
    if (def.recipe) {
      made = Object.keys(def.recipe.out)[0];
      const n = state.npcs[j.npc];
      n.stock[made] = (n.stock[made] || 0) + 1;
    }
    const levelUp = gainXp(p, 'trading');
    return { ok: true, wage: j.wage, made, levelUp };
  }
  if (action.type === 'quitJob') {
    if (!p.job) return { ok: false, error: 'You have no job.', code: 'err.noJobHere' };
    const j = p.job;
    endJob(state, p, 'quit');
    return { ok: true, fee: j.fee || 0 };
  }
  if (action.type === 'rentHouse') {
    const h = HOUSES[action.house], st = state.houses[action.house];
    if (!h) return { ok: false, error: 'Unknown place.', code: 'err.unknownPlace' };
    if (p.home) return { ok: false, error: 'You already rent a home.', code: 'err.haveHome' };
    if (st.tenant) return { ok: false, error: 'Someone already lives here.', code: 'err.houseTaken' };
    if (balance(state, acct) + 1e-9 < h.deposit + h.rent) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
    transfer(state, acct, 'deposits', h.deposit, { why: 'rent deposit' });
    transfer(state, acct, 'treasury', h.rent, { why: 'first day of rent' });
    p.stats.spent = r2(p.stats.spent + h.rent);
    p.home = action.house;
    p.restedDay = null;
    state.houses[action.house] = { tenant: p.id, since: state.day };
    addLog(state, `${p.name} rented a home.`, 'join', 'log.rented', { name: p.name, place: { $place: action.house } });
    return { ok: true, rent: h.rent, deposit: h.deposit };
  }
  if (action.type === 'leaveHouse') {
    if (!p.home) return { ok: false, error: 'You do not rent a home.', code: 'err.noHome' };
    const h = HOUSES[p.home];
    transfer(state, 'deposits', acct, h.deposit, { why: 'rent deposit back' });
    state.houses[p.home] = { tenant: null, since: null };
    p.home = null;
    return { ok: true, deposit: h.deposit };
  }
  if (action.type === 'sleep') {
    // go to bed for the night: your rented home, your own built home, or a bed at the inn
    if (!isNight(state)) return { ok: false, error: 'It is not night yet. You can sleep once it gets dark.', code: 'err.notNight' };
    if (p.sleep && p.sleep.day === state.day) return { ok: false, error: 'You are already asleep.', code: 'err.asleep' };
    const place = action.place;
    const ownPlot = p.plot && place === p.plot && state.plots[p.plot];
    if (ownPlot && ownPlot.lease) return { ok: false, error: 'Your home is rented out. Sleep somewhere else, or stop renting it out.', code: 'err.homeLeased' };
    const own = ownPlot && ownPlot.built;
    if (own && !ownPlot.bed) return { ok: false, error: 'There is no bed in your home yet. The carpenter sells beds.', code: 'err.noBedYet' };
    const rented = (p.home && place === p.home) || (p.lease && place === p.lease);
    if (place === 'inn') {
      if (innFree(state) < 1) return { ok: false, error: 'All rooms at the inn are taken tonight.', code: 'err.innFull' };
      if (!transfer(state, acct, npcAcct('inn'), RULES.innBed, { memo: `Emberwick: ${p.name} sleeps at the inn` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
      p.stats.spent = r2(p.stats.spent + RULES.innBed);
    } else if (!own && !rented) return { ok: false, error: 'You can only sleep in your own home or at the inn.', code: 'err.noBed' };
    p.sleep = { day: state.day, place };
    p.where = place;
    return { ok: true, place, paid: place === 'inn' ? RULES.innBed : 0 };
  }
  if (action.type === 'rest') {
    const mine = p.plot && state.plots[p.plot];
    const own = mine && mine.built && !mine.lease && (!p.home || action.house === p.plot);
    if (own && !mine.bed) return { ok: false, error: 'There is no bed in your home yet. The carpenter sells beds.', code: 'err.noBedYet' };
    if (!p.home && !own) return { ok: false, error: 'You do not rent a home.', code: 'err.noHome' };
    if (p.restedDay === state.day) return { ok: false, error: 'You already slept here today.', code: 'err.rested' };
    const before = p.energy;
    p.energy = Math.min(maxEnergy(p), r2(p.energy + (own ? LAND.rest : HOUSES[p.home].rest)));
    if (p.energy <= before) return { ok: false, error: 'You are not tired.', code: 'err.notTired' };
    p.restedDay = state.day;
    return { ok: true, energy: r2(p.energy - before) };
  }
  return null;
}

// ---------- the exchange: player market and land-deed market ----------
function recordTrade(state, t) {
  state.market.trades.unshift({ day: state.day, ...t });
  state.market.trades.length = Math.min(state.market.trades.length, 14);
}
// a buyer (player, bot or craftsman account) fills part or all of an order
function fillOrder(state, buyerAcct, buyerHolder, order, qty, buyerName) {
  qty = Math.min(qty, order.qty);
  if (qty < 1) return { ok: false, error: 'Nothing left in that order.', code: 'err.orderGone' };
  const total = r2(order.price * qty), fee = r2(total * marketFee(state));
  const seller = state.players[order.seller];
  if (!transfer(state, buyerAcct, 'player:' + order.seller, total, { memo: `Emberwick exchange: ${qty} ${order.good} from ${seller ? seller.name : '?'} to ${buyerName}` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
  transfer(state, 'player:' + order.seller, 'treasury', fee, { why: 'exchange fee' });
  if (buyerHolder) addInv(buyerHolder, order.good, qty);
  order.qty -= qty;
  if (seller) { seller.stats.earned = r2((seller.stats.earned || 0) + total - fee); seller.stats.sold = (seller.stats.sold || 0) + qty; }
  recordTrade(state, { good: order.good, qty, price: order.price, seller: seller ? seller.name : '?', buyer: buyerName });
  state.market.orders = state.market.orders.filter((o) => o.qty > 0);
  return { ok: true, qty, total, fee };
}
function marketAction(state, p, action) {
  const acct = 'player:' + p.id, mk = state.market;
  if (action.type === 'postOrder') {
    const good = action.good, qty = Math.floor(Number(action.qty) || 0), unit = r2(Number(action.price) || 0);
    if (!MARKET.goods.includes(good)) return { ok: false, error: 'That cannot be sold on the exchange.', code: 'err.notTradable' };
    if (qty < 1 || inv(p, good) < qty) return { ok: false, error: 'You do not have enough.', code: 'err.notEnough' };
    if (unit < 1 || unit > MARKET.maxPrice) return { ok: false, error: 'Choose a price between 1 and 500 EMWK.', code: 'err.badPrice' };
    if (mk.orders.filter((o) => o.seller === p.id).length >= MARKET.maxOrders) return { ok: false, error: 'You have too many open orders.', code: 'err.tooManyOrders' };
    addInv(p, good, -qty); // the goods wait in the exchange until someone buys them
    const o = { id: mk.nextId++, seller: p.id, good, qty, price: unit, day: state.day };
    mk.orders.push(o);
    return { ok: true, id: o.id, good, qty, price: unit };
  }
  if (action.type === 'cancelOrder') {
    const o = mk.orders.find((x) => x.id === Number(action.id) && x.seller === p.id);
    if (!o) return { ok: false, error: 'That order is gone.', code: 'err.orderGone' };
    addInv(p, o.good, o.qty);
    mk.orders = mk.orders.filter((x) => x !== o);
    return { ok: true, good: o.good, qty: o.qty };
  }
  if (action.type === 'fillOrder') {
    const o = mk.orders.find((x) => x.id === Number(action.id));
    if (!o) return { ok: false, error: 'That order is gone.', code: 'err.orderGone' };
    if (o.seller === p.id) return { ok: false, error: 'That is your own order.', code: 'err.ownOrder' };
    const res = fillOrder(state, acct, p, o, Math.max(1, Math.floor(Number(action.qty) || 1)), p.name);
    if (res.ok) { p.stats.spent = r2(p.stats.spent + res.total); res.good = o.good; }
    return res;
  }
  // ---- land deeds ----
  if (action.type === 'listDeed') {
    const plot = state.plots[action.plot];
    if (!plot || plot.owner !== p.id) return { ok: false, error: 'This is not your land.', code: 'err.notYourPlot' };
    const price = Math.round(Number(action.price) || 0);
    if (price < 1 || price > MARKET.deedMax) return { ok: false, error: 'Choose a price between 1 and 5000 EMWK.', code: 'err.badPrice' };
    // a deed that already sits in the player's own wallet must first go to the village bank (escrow)
    if (plot.deed && plot.deed.minted && state.nearBank && plot.deed.owner && plot.deed.owner !== state.nearBank) return { ok: false, error: 'Send the deed NFT to the village bank first, so the buyer can receive it.', code: 'err.deedInWallet', bank: state.nearBank, tokenId: plot.deed.tokenId };
    plot.sale = { price, since: state.day };
    return { ok: true, price };
  }
  if (action.type === 'unlistDeed') {
    const plot = state.plots[action.plot];
    if (!plot || plot.owner !== p.id || !plot.sale) return { ok: false, error: 'This is not your land.', code: 'err.notYourPlot' };
    plot.sale = null;
    return { ok: true };
  }
  if (action.type === 'buyDeed') {
    const plot = state.plots[action.plot];
    if (!plot || !plot.sale || !plot.owner) return { ok: false, error: 'This land is not for sale.', code: 'err.notForSale' };
    if (plot.owner === p.id) return { ok: false, error: 'This is your own land.', code: 'err.ownOrder' };
    if (p.plot) return { ok: false, error: 'You already own a plot.', code: 'err.havePlot' };
    const def = plotDef(action.plot), need = def && def.district ? DISTRICTS[def.district].minLevel : 0;
    if (playerLevel(p) < need) return { ok: false, error: `You need level ${need} to buy here.`, code: 'err.needLevel', need };
    const seller = state.players[plot.owner], price = plot.sale.price, fee = r2(price * marketFee(state));
    if (!transfer(state, acct, 'player:' + plot.owner, price, { memo: `Emberwick exchange: deed ${action.plot} from ${seller ? seller.name : '?'} to ${p.name}` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
    transfer(state, 'player:' + plot.owner, 'treasury', fee, { why: 'exchange fee (deed sale)' });
    if (seller) { seller.plot = null; if (seller.sleep && seller.sleep.place === action.plot) seller.sleep = null; }
    if (plot.lease && plot.lease.tenant === p.id) { plot.lease = null; p.lease = null; } // the tenant bought the house
    plot.owner = p.id; plot.sale = null; plot.since = state.day;
    p.plot = action.plot; p.stats.spent = r2(p.stats.spent + price);
    recordTrade(state, { deed: action.plot, qty: 1, price, seller: seller ? seller.name : '?', buyer: p.name });
    addLog(state, `${p.name} bought land from ${seller ? seller.name : '?'} on the exchange.`, 'good', 'log.deedSold', { name: p.name, seller: seller ? seller.name : '?', place: { $place: action.plot } });
    if (plot.deed) emit('deedMove', { plot: action.plot, tokenId: plot.deed.tokenId, wallet: (p.nearVerified && p.near) || null });
    return { ok: true, plot: action.plot, price };
  }
  return null;
}
// the AI craftsmen and villagers also buy on the exchange when an order is cheaper than the shops
function runMarket(state) {
  const mk = state.market;
  if (!mk || !mk.orders.length) return;
  for (const o of [...mk.orders]) {
    if (state.day - o.day >= MARKET.days) { // expired: the goods go back to the seller
      const s = state.players[o.seller];
      if (s) addInv(s, o.good, o.qty);
      mk.orders = mk.orders.filter((x) => x !== o);
      continue;
    }
    if (rng(state) > 0.25) continue;
    // a craftsman who uses this good and would pay at least the asking price
    const npc = Object.values(state.npcs).find((n) => n.buys[o.good] !== undefined && price(n.buys[o.good]) >= o.price && (n.stock[o.good] || 0) < targetFor(state, n.id, o.good) * 1.5 && !(n.damagedUntil > state.day));
    if (npc) {
      const before = npc.stock[o.good] || 0;
      const r = fillOrder(state, npcAcct(npc.id), null, o, Math.min(o.qty, 3), npc.id);
      if (r.ok) npc.stock[o.good] = before + r.qty;
      continue;
    }
    // villagers buy bread or a coat if it is cheaper than at the shop
    const shop = Object.values(state.npcs).find((n) => n.sells[o.good] !== undefined && ['bread', 'coat'].includes(o.good));
    if (shop && o.price < price(shop.sells[o.good])) {
      const b = Object.values(state.bots)[Math.floor(rng(state) * Object.keys(state.bots).length)];
      if (b && (o.good === 'bread' || !inv(b, 'coat'))) fillOrder(state, 'bot:' + b.id, b, o, 1, b.name);
    }
  }
}

// ---------- fast-forward: a week of village life in about a minute (for players and judges) ----------
const WATCH = [['bakery', 'bread', 'sells'], ['mill', 'flour', 'sells'], ['smithy', 'sword', 'sells'], ['tailor', 'coat', 'sells'], ['mill', 'wheat', 'buys'], ['smithy', 'ore', 'buys'], ['woodcutter', 'wood', 'buys'], ['tailor', 'wool', 'buys']];
// ---------- while you were away: what changed for a player since they last played ----------
// remembered at the player's last action (or the last summary): the ledger position and the watched prices
export function markSeen(state, playerId) {
  const p = state.players[playerId];
  if (!p) return;
  p.seen = { at: Date.now(), day: state.day, tick: state.tick, led: state.ledgerSeq || 0,
    prices: Object.fromEntries(WATCH.map(([npc, g, side]) => [`${npc}.${g}.${side}`, state.npcs[npc] ? r2(state.npcs[npc][side][g]) : null])) };
}
// shown when the player comes back after at least one village day and ten minutes; then the mark moves to now
export function awaySummary(state, playerId, minMs = 10 * 60000) {
  const p = state.players[playerId];
  if (!p) return null;
  const seen = p.seen;
  if (!seen || Date.now() - seen.at < minMs || state.tick - seen.tick < RULES.ticksPerDay) { if (!seen) markSeen(state, playerId); return null; }
  const me = 'player:' + playerId, money = new Map();
  let net = 0;
  for (const e of state.ledger || []) {
    if (e.id <= seen.led || (e.from !== me && e.to !== me)) continue;
    const amt = e.to === me ? e.amount : -e.amount;
    net += amt;
    const k = e.why || 'transfer', m = money.get(k) || { why: k, amount: 0, n: 0 };
    m.amount += amt; m.n += 1; money.set(k, m);
  }
  const lines = [...money.values()].map((m) => ({ ...m, amount: r2(m.amount) })).filter((m) => Math.abs(m.amount) >= 0.01).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 6);
  const prices = WATCH.map(([npc, g, side]) => {
    const from = seen.prices && seen.prices[`${npc}.${g}.${side}`], to = state.npcs[npc] ? r2(state.npcs[npc][side][g]) : null;
    return from && to ? { npc, good: g, side, from, to, change: Math.round((to / from - 1) * 100) } : null;
  }).filter((x) => x && x.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 4);
  const news = (state.log || []).filter((l) => l.day > seen.day && l.kind !== 'info').slice(0, 6);
  const out = { days: state.day - seen.day, fromDay: seen.day, toDay: state.day, net: r2(net), lines, prices, news, balance: r2(balance(state, me)) };
  markSeen(state, playerId);
  return out;
}

export function weekSnapshot(state) {
  return {
    day: state.day, tick: state.tick, treasury: r2(balance(state, 'treasury')), readiness: state.readiness,
    prices: Object.fromEntries(WATCH.map(([npc, g, side]) => [`${npc}.${g}`, state.npcs[npc] ? r2(state.npcs[npc][side][g]) : null])),
    levels: Object.fromEntries(Object.entries(state.npcs).map(([id, n]) => [id, n.level || 1])),
    wallets: Object.fromEntries(Object.keys(state.npcs).map((id) => [id, r2(balance(state, npcAcct(id)))])),
    decided: (state.council && state.council.closed || []).map((x) => x.id),
    trades: state.market ? state.market.trades.length : 0, towers: (state.watchtowers || []).length, districts: (state.districts || []).length,
  };
}
export function weekSummary(state, before) {
  const after = weekSnapshot(state);
  const prices = WATCH.map(([npc, g, side]) => {
    const k = `${npc}.${g}`, a = before.prices[k], b = after.prices[k];
    return { npc, good: g, side, from: a, to: b, change: a ? Math.round(((b - a) / a) * 100) : 0 };
  });
  const upgrades = Object.keys(after.levels).filter((id) => after.levels[id] > (before.levels[id] || 1)).map((id) => ({ npc: id, level: after.levels[id] }));
  const richest = Object.keys(after.wallets).map((id) => ({ npc: id, change: r2(after.wallets[id] - (before.wallets[id] || 0)) })).sort((a, b) => b.change - a.change);
  const decisions = (state.council && state.council.closed || []).filter((x) => !before.decided.includes(x.id)).map((x) => ({ id: x.id, kind: x.kind, params: x.params, result: x.result }));
  return {
    days: after.day - before.day, fromDay: before.day, toDay: after.day,
    treasury: { from: before.treasury, to: after.treasury }, readiness: { from: before.readiness, to: after.readiness },
    prices, upgrades, winners: richest.slice(0, 2), losers: richest.slice(-2).reverse(), decisions,
    events: state.log.filter((l) => l.day > before.day || (l.day === before.day && l.key && /smoke|repelled|burned|drought|winter|towerBuilt|districtOpen|upgraded|bailout/.test(l.key))).slice(0, 10),
  };
}

function resolveAttack(state) {
  const ev = state.events;
  ev.attackDay = null;
  ev.dragon = 0;
  ev.lastAttack = state.day;
  const tower = state.npcs.tower;
  if (state.readiness >= 60) {
    tower.stock.sword = Math.max(0, (tower.stock.sword || 0) - 3);
    // a small reward from the treasury to every villager, within the reserve
    const players = Object.keys(state.players);
    const reward = 5;
    for (const id of players) {
      if (balance(state, 'treasury') - reward >= lockedFunds(state)) transfer(state, 'treasury', 'player:' + id, reward, { why: 'reward for defending the village' });
    }
    addLog(state, `The dragon attacked and was driven back! Readiness was ${state.readiness}%. Every villager earns ${reward} EMWK.`, 'good', 'log.repelled', { ready: state.readiness, reward });
  } else {
    const victims = Object.keys(state.npcs).filter((id) => id !== 'tower');
    const hit = victims[Math.floor(rng(state) * victims.length)];
    state.npcs[hit].damagedUntil = state.day + 1;
    tower.stock.sword = 0;
    addLog(state, `The dragon burned part of the village. Readiness was only ${state.readiness}%. One shop is closed for repairs.`, 'danger', 'log.burned', { ready: state.readiness });
  }
}

// ---------- public view ----------

function playerView(state, p) {
  ensurePlayer(p);
  const skills = {};
  for (const s of SKILLS) {
    const xp = p.xp[s] || 0, level = levelFromXp(xp);
    skills[s] = { xp, level, from: RULES.levelXp[level - 1], to: RULES.levelXp[level] ?? null };
  }
  const costs = Object.fromEntries(Object.keys(GATHER_SPOTS).map((k) => [k, energyCost(p, k, state)]));
  return {
    ...p, coins: r2(balance(state, 'player:' + p.id)), withdrawable: withdrawable(state, p.id), questInfo: questFor(p, state),
    job: p.job ? (() => {
      const today = p.job.shiftDay === state.day ? p.job.shiftsToday : 0;
      return { ...p.job, shiftsToday: today, maxShifts: JOBS.shiftsPerDay, shiftToday: today >= JOBS.shiftsPerDay, energy: JOBS.shiftEnergy };
    })() : null,
    home: p.home ? { id: p.home, ...HOUSES[p.home], restedToday: p.restedDay === state.day } : null,
    restedToday: p.restedDay === state.day,
    asleep: !!(p.sleep && p.sleep.day === state.day && isNight(state)), sleepPlace: p.sleep && p.sleep.day === state.day ? p.sleep.place : null,
    cold: !!p.cold, hungry: !!p.hungry, food: p.food && p.food.day === state.day ? p.food : null, freezing: freezing(state, p), coatLeft: hasCoat(p) ? RULES.coatWinterDays - ((p.wear && p.wear.coat) || 0) : 0,
    innBed: RULES.innBed, level: playerLevel(p), deal: p.deal && p.deal.day === state.day && state.tick - p.deal.tick <= 24 ? p.deal : null, debts: p.debts || {},
    application: (() => { for (const [npc, list] of Object.entries(state.applications || {})) { const i = list.findIndex((x) => x.pid === p.id); if (i >= 0) return { npc, others: list.length - 1, next: nextInterview(state) }; } return null; })(),
    appResult: p.appResult || null,
    skills, maxEnergy: maxEnergy(p), costs, tradeBonus: r2((skills.trading.level - 1) * RULES.tradeBonus), toolUses: RULES.toolUses,
  };
}

export function publicView(state, playerId) {
  if (CRAFTSMEN.some((c) => !state.npcs[c.id])) ensureContracts(state);
  const npcs = {};
  for (const def of CRAFTSMEN) {
    const n = state.npcs[def.id];
    npcs[def.id] = {
      id: def.id,
      name: def.name,
      wallet: Math.round(balance(state, npcAcct(def.id))),
      buys: Object.fromEntries(Object.entries(n.buys).map(([g, v]) => [g, price(v)])),
      sells: Object.fromEntries(Object.entries(n.sells).map(([g, v]) => [g, price(v)])),
      stock: n.stock,
      closed: n.damagedUntil > state.day,
      shut: isNight(state) && def.id !== 'inn', // closed for the night
      level: n.level || 1, learn: n.learn || {},
      ai: n.ai && n.ai.day >= state.day - 1 ? n.ai : null,
      order: playerId ? commissionPolicy(state, playerId, def.id) : null,
      why: Object.fromEntries([...new Set([...Object.keys(n.buys), ...Object.keys(n.sells)])].map((g) => {
        const target = targetFor(state, def.id, g), stock = n.stock[g] || 0;
        return [g, { stock: Math.round(stock * 10) / 10, target: Math.round(target * 10) / 10, reasons: priceReasons({ stock, target, learned: n.learn && n.learn[g], level: n.level || 1, winter: state.events.winter, dragon: state.events.dragon > 0, drought: state.events.drought > 0, good: g, npc: def.id }) }];
      })),
      offers: playerId && state.players[playerId] ? Object.fromEntries(Object.keys(n.buys).filter((g) => inv(state.players[playerId], g) > 0).map((g) => {
        const q = sellQuote(state, def.id, g, inv(state.players[playerId], g), (skillLevel(state.players[playerId], 'trading') - 1) * RULES.tradeBonus);
        return [g, { qty: q.qty, total: q.total, want: q.want, first: q.first, last: q.last }];
      })) : {},
      full: Object.keys(n.buys).filter((g) => (n.stock[g] || 0) >= targetFor(state, def.id, g) * WANT_FACTOR - 0.5),
      line: def.lines[(state.day + def.id.length) % def.lines.length],
      lineKey: `${def.id}.${(state.day + def.id.length) % def.lines.length}`,
    };
  }
  const p = playerId && state.players[playerId];
  return {
    aiLog: (state.aiLog || []).map(({ json, ...x }) => x),
    onchain: { tx: (state.onchain && state.onchain.tx) || 0, aiPlans: state.aiDays || 0 },
    realSwaps: playerId ? (state.realSwaps || []).filter((x) => x.player === playerId && x.status !== 'CANCELLED').slice(0, 8) : [],
    realDone: (state.realSwaps || []).filter((x) => x.status === 'SUCCESS').slice(0, 12).map((x) => ({ name: (state.players[x.player] || {}).name || '?', amountIn: x.amountIn, amountOut: x.amountOut, to: x.to, fromSym: x.dir === 'in' || x.dir === 'any' ? x.fromSym : 'NEAR', dir: x.dir || 'out', toSym: x.toSym, chain: x.chain, fromChain: x.dir === 'in' || x.dir === 'any' ? x.fromChain : 'near', usdOut: x.usdOut || null, depositAddress: x.depositAddress, sentTx: x.sentTx || null, at: x.doneAt || x.at || null, batch: x.batch || null, leg: x.leg || null, origin: x.origin || [], dest: x.dest || [] })),
    token: TOKEN,
    rev: state.rev || 0,
    day: state.day,
    dayProgress: (state.tick % RULES.ticksPerDay) / RULES.ticksPerDay,
    night: isNight(state),
    inn: { rooms: innRooms(state), free: innFree(state) },
    nightStart: NIGHT_START,
    threat: threatLevel(state),
    watchtowers: state.watchtowers || [],
    events: state.events,
    readiness: state.readiness,
    treasury: Math.round(balance(state, 'treasury')),
    oracle: state.oracle && state.oracle.usd ? { usd: state.oracle.usd, ref: r2(state.oracle.ref * 1000) / 1000, factor: oracleFactor(state), at: state.oracle.at } : null,
    reserveHolds: (state.reserveHolds || []).map((h) => ({ ...h })),
    books: treasuryView(state),
    ff: state.ff ? { running: !!state.ff.running, done: state.ff.done || 0, total: state.ff.total, startDay: state.ff.startDay, by: state.ff.by } : null,
    week: state.ffResult || null,
    market: state.market ? {
      fee: marketFee(state), goods: MARKET.goods, maxOrders: MARKET.maxOrders, days: MARKET.days,
      orders: state.market.orders.map((o) => ({ ...o, sellerName: (state.players[o.seller] || {}).name || '?', mine: o.seller === playerId, left: MARKET.days - (state.day - o.day) })),
      trades: state.market.trades.map((x) => ({ ...x, buyer: x.buyer && state.npcs[x.buyer] ? { $npc: x.buyer } : x.buyer })),
    } : null,
    totalMoney: totalMoney(state),
    population: Object.keys(state.players).length + Object.keys(state.bots).length,
    npcs,
    history: state.history,
    log: state.log.slice(0, 12),
    player: p ? playerView(state, p) : null,
    bots: Object.values(state.bots).map((b) => ({ id: b.id, name: b.name, path: b.path })),
    jobOffers: Object.values(state.jobOffers || {}),
    council: councilView(state, playerId),
    sealWall: { count: state.sealCount || 0, list: (state.sealWall || []).slice(0, 12).map((x) => ({ name: x.name, day: x.day })), fee: marketFee(state), base: MARKET.fee, cut: SEAL_CUT, max: SEAL_MAX },
    land: LAND,
    districts: { open: state.districts || [], defs: DISTRICTS, next: nextDistrict(state), free: freePlots(state) },
    plots: Object.fromEntries(Object.entries(state.plots || {}).map(([id, x]) => {
      const d = plotDef(id) || {};
      return [id, {
        owner: x.owner ? (state.players[x.owner] || {}).name || '?' : null, mine: !!(x.owner && x.owner === playerId),
        built: x.built, since: x.since || null, deed: x.deed, bed: !!x.bed,
        price: x.resale || plotPrice(id), fair: fairValue(state, id), build: plotBuild(id), district: d.district || 0, villa: !!d.villa, open: plotOpen(state, id), minLevel: d.district ? DISTRICTS[d.district].minLevel : 0,
        sale: x.sale ? { price: x.sale.price, since: x.sale.since } : null,
        lease: x.lease ? { rent: x.lease.rent, tenant: x.lease.tenant ? (state.players[x.lease.tenant] || {}).name || '?' : null, mine: x.lease.tenant === playerId } : null,
      }];
    })),
    // other players who were active recently (about the last game day)
    others: Object.values(state.players).filter((o) => o.id !== playerId && o.seenAt !== undefined && state.tick - o.seenAt < RULES.ticksPerDay)
      .map((o) => ({ id: o.id, name: o.name, path: o.path, where: o.where || 'gate', level: playerLevel(o) })),
    chat: (state.chat || []).slice(-40).map((m) => ({ id: m.id, pid: m.pid, name: m.name, text: m.text, day: m.day, me: m.pid === playerId })),
    houses: Object.fromEntries(Object.entries(HOUSES).map(([id, h]) => {
      const st = (state.houses || {})[id] || {};
      return [id, { ...h, tenant: st.tenant ? (state.players[st.tenant] || {}).name || '?' : null, mine: !!(st.tenant && st.tenant === playerId) }];
    })),
  };
}
