// The Emberwick economy engine.
// All money lives in one ledger (state.balances). Money only ever moves between
// accounts, so the total always equals TOKEN.totalSupply. This mirrors how the
// EMWK token will behave on NEAR.

import { TOKEN, GENESIS, GOODS, GATHER_SPOTS, CRAFTSMEN, START_PATHS, RULES, QUESTS, PATH_ROUTE, BUILDINGS, SKILL_OF, SKILLS, JOBS, HOUSES, COUNCIL, LAND } from './world.js';

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

function transfer(state, from, to, amount, note = null) {
  amount = r2(amount);
  if (amount <= 0) return true;
  if (balance(state, from) + 1e-9 < amount) return false;
  state.balances[from] = r2(balance(state, from) - amount);
  state.balances[to] = r2(balance(state, to) + amount);
  for (const w of watchers) w(from, to, amount, note);
  return true;
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
  transfer(state, 'withdrawn', 'player:' + playerId, fromOut);
  transfer(state, 'newcomerFund', 'player:' + playerId, r2(amount - fromOut));
  p.withdrawn = r2(Math.max(0, (p.withdrawn || 0) - amount));
  p.deposited = r2((p.deposited || 0) + amount);
  state.rev = (state.rev || 0) + 1;
  addLog(state, `${p.name} brought ${amount} EMWK into the village from NEAR.`, 'trade', 'log.deposited', { name: p.name, n: amount });
  return { ok: true, amount };
}

// Moves coins out of the game to the player's own NEAR wallet. They are kept in
// the 'withdrawn' bucket so the game's total stays exactly the fixed supply.
export function withdraw(state, playerId, amount) {
  const p = state.players[playerId];
  if (!p) return { ok: false, error: 'Unknown player.', code: 'err.unknownPlayer' };
  if (!p.near) return { ok: false, error: 'Link a NEAR wallet first.', code: 'err.noWallet' };
  amount = Math.floor(Number(amount) * 100) / 100;
  if (!(amount >= 1)) return { ok: false, error: 'Cash out at least 1 EMWK.', code: 'err.minWithdraw' };
  if (balance(state, 'player:' + playerId) + 1e-9 < amount) return { ok: false, error: 'You do not have that much.', code: 'err.noMoney' };
  transfer(state, 'player:' + playerId, 'withdrawn', amount);
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

function rng(state) {
  // small deterministic generator so a saved game replays the same way
  state.seed = (state.seed * 1103515245 + 12345) % 2147483648;
  return state.seed / 2147483648;
}

function addLog(state, text, kind = 'info', key = null, p = {}) {
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
  return p.cold ? Math.max(4, base - RULES.coldMaxEnergy) : base;
}
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

function targetFor(state, npcId, good) {
  const def = CRAFTSMEN.find((c) => c.id === npcId);
  let t = def.target[good] || 0;
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
  // a shop with a full store room stops buying; one low on money keeps a small reserve
  const room = Math.floor(targetFor(state, npcId, good) * 3 - (npc.stock[good] || 0));
  if (room < 1) return { ok: false, error: 'The store room is full. Try another shop or come back later.', code: 'err.storeFull' };
  qty = Math.min(qty, room);
  const unit = price(npc.buys[good] * (1 + (actor.bonus || 0)));
  const total = unit * qty;
  if (balance(state, npcAcct(npcId)) - 60 < total) return { ok: false, error: 'The shopkeeper cannot afford that right now.', code: 'err.shopBroke' };
  const tax = r2(total * taxRate(state));
  transfer(state, npcAcct(npcId), actor.acct, total);
  transfer(state, actor.acct, 'treasury', tax);
  addInv(actor.holder, good, -qty);
  npc.stock[good] = (npc.stock[good] || 0) + qty;
  return { ok: true, unit, total, tax };
}

function buyFromNpc(state, actor, npcId, good, qty) {
  const npc = state.npcs[npcId];
  if (!npc || npc.sells[good] === undefined) return { ok: false, error: 'This shop does not sell that.', code: 'err.notSelling' };
  if ((npc.stock[good] || 0) < qty) return { ok: false, error: 'Out of stock.', code: 'err.outOfStock' };
  const unit = price(npc.sells[good]);
  const total = unit * qty;
  if (balance(state, actor.acct) < total) return { ok: false, error: 'You do not have enough EMWK.', code: 'err.noMoney' };
  const tax = r2(total * taxRate(state));
  transfer(state, actor.acct, npcAcct(npcId), total);
  transfer(state, npcAcct(npcId), 'treasury', tax);
  npc.stock[good] -= qty;
  addInv(actor.holder, good, qty);
  return { ok: true, unit, total, tax };
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
  transfer(state, 'newcomerFund', 'player:' + id, coins);
  state.rev = (state.rev || 0) + 1;
  addLog(state, `${name} arrived at the gate as a ${path.name.toLowerCase()}.`, 'join', 'log.join', { name, path: pathKey });
  return { ok: true, id };
}

export function playerAction(state, playerId, action) {
  const p = state.players[playerId];
  if (!p) return { ok: false, error: 'Unknown player. Join the village first.', code: 'err.unknownPlayer' };
  const actor = { acct: 'player:' + playerId, holder: p };
  const qty = Math.max(1, Math.min(50, parseInt(action.qty, 10) || 1));

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
    const done = advanceQuest(state, p);
    if (done) res.quest = done;
  }
  return res;
}

function doAction(state, p, actor, action, qty) {
  const c = contractAction(state, p, action);
  if (c) return c;
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
  if (action.type === 'sell') {
    const res = sellToNpc(state, actor, action.npc, action.good, qty);
    if (res.ok) {
      p.stats.sells++; p.stats.sold += qty; p.stats.earned = r2(p.stats.earned + res.total - res.tax); p.stats.taxes = r2(p.stats.taxes + res.tax);
      res.levelUp = gainXp(p, 'trading');
    }
    if (res.ok) res.message = `Sold ${qty} ${GOODS[action.good].name.toLowerCase()} for ${res.total} EMWK (tax ${res.tax}).`;
    return res;
  }
  if (action.type === 'buy') {
    const res = buyFromNpc(state, actor, action.npc, action.good, qty);
    if (res.ok) p.stats.spent = r2(p.stats.spent + res.total);
    if (res.ok) res.message = `Bought ${qty} ${GOODS[action.good].name.toLowerCase()} for ${res.total} EMWK.`;
    return res;
  }
  return { ok: false, error: 'Unknown action.', code: 'err.unknownAction' };
}

export function questFor(p) {
  const q = QUESTS[Math.min(p.quest || 0, QUESTS.length - 1)];
  const route = PATH_ROUTE[p.path] || PATH_ROUTE.farmer;
  const name = (id) => (BUILDINGS.find((b) => b.id === id) || {}).name || id;
  const fill = (t) => t && t.replace('{spot}', route.spot).replace('{shop}', route.shop);
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
    : { gather: [st.gathers, 2], earn: [Math.floor(st.earned), 40], supply: [st.sold, 15] }[q.id] || null;
  const target = job || (findJob ? 'market' : fill(q.target));
  return { index: p.quest || 0, total: QUESTS.length - 1, id: q.id, title: q.title, text: fillText(q.text), target, reward: q.reward, progress, spot: route.spot, shop: route.shop, job, findJob };
}

function questDone(p, q) {
  const st = p.stats, route = PATH_ROUTE[p.path] || PATH_ROUTE.farmer;
  switch (q.id) {
    case 'meet': return !!st.visited.gate;
    case 'gather': return st.gathers + (st.shifts || 0) >= 2;
    case 'sell': return st.sells >= 1 || (st.shifts || 0) >= 3;
    case 'peak': return !!st.visited.dragonpeak;
    case 'earn': return st.earned >= 40;
    case 'supply': return st.sold >= 15 || (st.shifts || 0) >= 8;
    default: return false;
  }
}

function advanceQuest(state, p) {
  const q = QUESTS[p.quest || 0];
  if (!q || !questDone(p, q)) return null;
  const reward = Math.min(q.reward, balance(state, 'newcomerFund'));
  transfer(state, 'newcomerFund', 'player:' + p.id, reward);
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
    if (b.energy >= spot.energy && inv(b, spot.good) < 6) { // no point gathering what nobody buys
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
    const tool = TOOL_MAKER[def.id];
    if (tool && (npc.stock[tool.good] || 0) < def.target[tool.good] && rng(state) < 0.08 &&
        Object.entries(tool.in).every(([g, q]) => (npc.stock[g] || 0) >= q)) {
      for (const [g, q] of Object.entries(tool.in)) npc.stock[g] -= q;
      npc.stock[tool.good] = (npc.stock[tool.good] || 0) + 1;
    }

    // produce
    if (!def.recipe) continue;
    const outGood = Object.keys(def.recipe.out)[0];
    if ((npc.stock[outGood] || 0) >= targetFor(state, def.id, outGood) * 1.5) continue;
    const canMake = Object.entries(def.recipe.in).every(([g, q]) => (npc.stock[g] || 0) >= q);
    if (canMake && rng(state) < 0.5) {
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
    const unit = price((npc.sells[good] ?? npc.buys[good]) * (npc.sells[good] !== undefined ? 0.8 : 1));
    if (!transfer(state, 'adventurerFund', npcAcct(npcId), unit * qty)) return;
    npc.stock[good] -= qty;
  }
}

function runInn(state) {
  // travellers arrive from outside and spend money at the inn
  const inn = state.npcs.inn;
  const visitors = rng(state) < 0.5 ? 1 : 0;
  for (let v = 0; v < visitors; v++) {
    if ((inn.stock.meal || 0) < 1) break;
    const unit = price(inn.sells.meal);
    if (!transfer(state, 'adventurerFund', npcAcct('inn'), unit)) break;
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
    for (const good of Object.keys(npc.buys)) {
      const s = npc.stock[good] || 0, t = Math.max(1, targetFor(state, def.id, good));
      const level = npc.base[good] * clamp(Math.pow(t / Math.max(s, 0.5), 0.8), 0.4, 4);
      npc.buys[good] += (level - npc.buys[good]) * k;
    }
    for (const good of Object.keys(npc.sells)) {
      const s = npc.stock[good] || 0, t = Math.max(1, targetFor(state, def.id, good));
      const floor = GOODS[good] && GOODS[good].kind === 'tool' ? 0.8 : 0.5;
      const level = npc.base[good] * clamp(Math.pow(t / Math.max(s, 0.5), 0.6), floor, 4);
      npc.sells[good] += (level - npc.sells[good]) * k;
    }
  }
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
  state.day++;
  ensureContracts(state);
  settleContracts(state);
  const ev = state.events;
  if (ev.drought > 0 && --ev.drought === 0) addLog(state, 'Rain returns to the fields. The drought is over.', 'good', 'log.rain');

  // seasons: every 8 days, the last 2 are winter
  const wasWinter = ev.winter;
  ev.winter = state.day % 8 === 0 || state.day % 8 === 7;
  if (ev.winter && !wasWinter) addLog(state, 'Winter arrives. Firewood is in demand.', 'warn', 'log.winter');

  // morning: who slept in a bed, who spent the night outside; coats wear out in winter
  for (const p of Object.values(state.players)) {
    const active = p.seenAt !== undefined && state.tick - p.seenAt < RULES.ticksPerDay * 1.5;
    const slept = p.sleep && p.sleep.day === state.day - 1;
    const outside = (p.nightOut || 0) >= RULES.ticksPerDay * 0.1; // more than half the night outside
    p.cold = !!(active && !slept && outside);
    p.nightOut = 0;
    if (p.cold) p.energy = Math.min(p.energy, maxEnergy(p));
    if (ev.winter && hasCoat(p)) {
      p.wear = p.wear || {};
      p.wear.coat = (p.wear.coat || 0) + 1;
      if (p.wear.coat >= RULES.coatWinterDays) { addInv(p, 'coat', -1); p.wear.coat = 0; p.coatWorn = state.day; }
    }
  }
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
  const spare = balance(state, 'treasury') - RULES.treasuryReserve;
  if (spare >= RULES.guardSalaryPerDay && balance(state, npcAcct('tower')) < 400) {
    transfer(state, 'treasury', npcAcct('tower'), RULES.guardSalaryPerDay);
  }

  // the guard eats bread and swords wear out on patrol
  const tower = state.npcs.tower;
  if ((tower.stock.bread || 0) > 0) tower.stock.bread--;
  if (state.day % 2 === 0 && (tower.stock.sword || 0) > 0) tower.stock.sword--;

  // money keeps circulating: rich shops pay a profit tax to the treasury,
  // and the inn buys imported ale from travelling merchants
  for (const def of CRAFTSMEN) {
    const acct = npcAcct(def.id), bal = balance(state, acct);
    if (bal > RULES.profitTaxAbove) transfer(state, acct, 'treasury', (bal - RULES.profitTaxAbove) * RULES.profitTaxRate);
  }
  // shops buy supplies from outside the village (salt, nails, cloth): rich shops
  // send part of their extra money to the travellers' fund, which pays the merchants
  for (const def of CRAFTSMEN) {
    const acct = npcAcct(def.id), extra = balance(state, acct) - 500;
    if (extra > 0) transfer(state, acct, 'adventurerFund', extra * 0.15);
  }
  const innBal = balance(state, npcAcct('inn'));
  if (innBal > 500) transfer(state, npcAcct('inn'), 'adventurerFund', (innBal - 500) * 0.8);

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
  if (state.council.open.length >= COUNCIL.maxOpen) return { ok: false, error: 'The council is full. Wait for a vote to end.', code: 'err.councilFull' };
  if (state.council.open.some((x) => x.kind === kind && JSON.stringify(x.params) === JSON.stringify(params))) return { ok: false, error: 'That is already being voted on.', code: 'err.sameProposal' };
  if (by.startsWith('player:') && !transfer(state, by, 'treasury', COUNCIL.fee)) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
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
    case 'tower':
      if (voter === 'npc:carpenter' || voter === 'npc:tower') return say(true, 'self');
      if (danger) return r < 0.85 ? say(true, 'danger') : say(false, 'poor');
      return (rich ? r < 0.5 : r < 0.2) ? say(true, 'safety') : say(false, rich ? 'notNeeded' : 'poor');
    case 'festival':
      if (isNpc) return (rich ? r < 0.45 : r < 0.15) ? say(true, 'customers') : say(false, rich ? 'waste' : 'poor');
      return r < 0.85 ? say(true, 'festival') : say(false, 'waste');
    default: return say(false, 'waste');
  }
}

function enact(state, prop) {
  const p = prop.params;
  const spare = balance(state, 'treasury') - RULES.treasuryReserve;
  if (prop.kind === 'grant') {
    if (spare < p.amount) return 'poor';
    transfer(state, 'treasury', npcAcct(p.npc), p.amount);
  } else if (prop.kind === 'tax') {
    state.taxRate = p.rate;
  } else if (prop.kind === 'welcome') {
    if (spare < p.amount) return 'poor';
    transfer(state, 'treasury', 'newcomerFund', p.amount);
  } else if (prop.kind === 'tower') {
    const spot = freeTowerSpot(state);
    if (!spot) return 'poor';
    if (spare < p.cost) return 'poor';
    transfer(state, 'treasury', npcAcct('carpenter'), p.cost, { memo: `Emberwick council #${prop.id}: build a watchtower (${spot})` });
    state.watchtowers = [...(state.watchtowers || []), spot];
    addLog(state, 'A new watchtower stands. The village is better prepared.', 'good', 'log.towerBuilt', {});
  } else if (prop.kind === 'festival') {
    const people = [...Object.keys(state.players).map((id) => 'player:' + id), ...Object.keys(state.bots).map((id) => 'bot:' + id)];
    if (spare < p.amount * people.length) return 'poor';
    for (const h of people) transfer(state, 'treasury', h, p.amount);
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
    const what = { grant: `grant ${prop.params.amount} to ${prop.params.npc}`, tax: `market tax ${Math.round(prop.params.rate * 100)}%`, welcome: `${prop.params.amount} to newcomer fund`, festival: `festival ${prop.params.amount} per villager`, tower: `build a watchtower for ${prop.params.cost}` }[prop.kind];
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
    if ((state.events.attackDay !== null || state.readiness < 60) && freeTowerSpot(state) && tre > RULES.treasuryReserve + 1500) ideas.push(['npc:tower', 'tower', {}]);
    if (tre > 7000) ideas.push([bot(), 'festival', { amount: 4 }]);
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
      result: open ? null : prop.result, closedDay: prop.closedDay,
    };
  };
  return {
    open: state.council.open.map((x) => show(x, true)),
    closed: state.council.closed.slice(0, 5).map((x) => show(x, false)),
    taxRate: taxRate(state), rules: COUNCIL, reserve: RULES.treasuryReserve,
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
  if (!state.plots) state.plots = Object.fromEntries(LAND.plots.map((id) => [id, { owner: null, built: false, deed: null }]));
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
    transfer(state, payer, 'player:' + p.id, severance);
    p.stats.earned = r2(p.stats.earned + severance);
    addLog(state, `${p.name}'s job ended early. Severance paid: ${severance} EMWK.`, 'warn', 'log.severance', { name: p.name, n: severance, place: { $place: j.npc }, payer: payer === 'treasury' ? 'treasury' : 'npc' });
  } else if (reason === 'quit') {
    // quitting early: the apprentice pays the employer a notice fee, as far as they can
    const fee = r2(Math.min(j.wage * JOBS.noticeShifts, balance(state, 'player:' + p.id)));
    if (fee > 0) {
      transfer(state, 'player:' + p.id, npcAcct(j.npc), fee);
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
    if (p.home) {
      const h = HOUSES[p.home];
      if (!transfer(state, 'player:' + p.id, 'treasury', h.rent)) {
        // cannot pay: the deposit covers the debt and the home is given back
        transfer(state, 'deposits', 'treasury', h.deposit);
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
    if (!transfer(state, acct, 'treasury', LAND.price)) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
    p.stats.spent = r2(p.stats.spent + LAND.price);
    plot.owner = p.id; plot.since = state.day; plot.deed = { tokenId: `${action.plot}-${state.day}-${p.id}`, minted: false };
    p.plot = action.plot;
    addLog(state, `${p.name} bought land.`, 'good', 'log.boughtPlot', { name: p.name, place: { $place: action.plot } });
    emit('deed', { plot: action.plot, tokenId: plot.deed.tokenId, player: p.id, name: p.name, wallet: (p.nearVerified && p.near) || null, day: state.day });
    return { ok: true, plot: action.plot, price: LAND.price };
  }
  if (action.type === 'buildHouse') {
    const plot = state.plots[action.plot];
    if (!plot || plot.owner !== p.id) return { ok: false, error: 'This is not your land.', code: 'err.notYourPlot' };
    if (plot.built) return { ok: false, error: 'Your home is already built.', code: 'err.built' };
    const b = LAND.build;
    if (inv(p, 'lumber') < b.lumber) return { ok: false, error: 'You need more lumber.', code: 'err.needLumber', need: b.lumber, have: inv(p, 'lumber') };
    if (!transfer(state, acct, npcAcct(b.builder), b.fee, { memo: `Emberwick: ${p.name} builds a home on ${action.plot}` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
    addInv(p, 'lumber', -b.lumber);
    p.stats.spent = r2(p.stats.spent + b.fee);
    plot.built = true; plot.builtDay = state.day;
    addLog(state, `${p.name} built a home.`, 'good', 'log.builtHome', { name: p.name, place: { $place: action.plot } });
    return { ok: true, plot: action.plot };
  }
  if (action.type === 'propose') return propose(state, acct, action.kind, action);
  if (action.type === 'vote') return vote(state, acct, action.id, action.yes);
  if (action.type === 'takeJob' || action.type === 'apply') {
    const o = state.jobOffers[action.npc];
    if (!o) return { ok: false, error: 'That job is no longer offered.', code: 'err.noJob' };
    if (p.job) return { ok: false, error: 'You already have a job.', code: 'err.haveJob' };
    // the craftsman looks at your application and says why
    const verdict = judgeApplicant(state, p, o.npc);
    if (!verdict.ok) {
      addLog(state, `${p.name} applied for a job and was turned down.`, 'warn', 'log.turnedDown', { name: p.name, place: { $place: o.npc } });
      return { ok: false, error: 'The craftsman turned you down.', code: 'err.turnedDown', why: verdict.why, need: verdict.need };
    }
    const contractId = (state.contractSeq = (state.contractSeq || 0) + 1);
    p.job = { npc: o.npc, wage: o.wage, daysLeft: o.days, startDay: state.day, shiftDay: null, shiftsToday: 0, shifts: 0, contractId };
    delete state.jobOffers[o.npc];
    // signing: a small bonus from the employer carries the contract terms onto NEAR
    const terms = `Emberwick contract #${contractId}: ${o.npc} hires ${p.name}. ${o.wage} EMWK/shift, max ${JOBS.shiftsPerDay}/day, ${o.days} days, severance ${o.wage * JOBS.severanceDays}, notice fee ${o.wage * JOBS.noticeShifts}.`;
    p.job.terms = terms;
    transfer(state, npcAcct(o.npc), acct, JOBS.signingBonus, { memo: terms, contract: contractId });
    p.stats.earned = r2(p.stats.earned + JOBS.signingBonus);
    addLog(state, `${p.name} became an apprentice.`, 'join', 'log.hired', { name: p.name, place: { $place: o.npc }, n: o.wage });
    return { ok: true, job: p.job, why: verdict.why };
  }
  if (action.type === 'shift') {
    if (isNight(state)) return NIGHT_ERR;
    const j = p.job;
    if (!j || (action.npc && action.npc !== j.npc)) return { ok: false, error: 'You do not work here.', code: 'err.noJobHere' };
    if (j.shiftDay !== state.day) { j.shiftDay = state.day; j.shiftsToday = 0; }
    if (j.shiftsToday >= JOBS.shiftsPerDay) return { ok: false, error: 'You worked all your shifts today.', code: 'err.shiftDone' };
    if (state.npcs[j.npc].damagedUntil > state.day) return { ok: false, error: 'This shop is closed.', code: 'err.closed' };
    if (p.energy < JOBS.shiftEnergy) return { ok: false, error: 'You are too tired.', code: 'err.tired' };
    if (!transfer(state, npcAcct(j.npc), acct, j.wage)) {
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
    transfer(state, acct, 'deposits', h.deposit);
    transfer(state, acct, 'treasury', h.rent);
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
    transfer(state, 'deposits', acct, h.deposit);
    state.houses[p.home] = { tenant: null, since: null };
    p.home = null;
    return { ok: true, deposit: h.deposit };
  }
  if (action.type === 'sleep') {
    // go to bed for the night: your rented home, your own built home, or a bed at the inn
    if (!isNight(state)) return { ok: false, error: 'It is not night yet. You can sleep once it gets dark.', code: 'err.notNight' };
    if (p.sleep && p.sleep.day === state.day) return { ok: false, error: 'You are already asleep.', code: 'err.asleep' };
    const place = action.place;
    const own = p.plot && place === p.plot && state.plots[p.plot] && state.plots[p.plot].built;
    const rented = p.home && place === p.home;
    if (place === 'inn') {
      if (!transfer(state, acct, npcAcct('inn'), RULES.innBed, { memo: `Emberwick: ${p.name} sleeps at the inn` })) return { ok: false, error: 'You cannot afford that.', code: 'err.notEnough' };
      p.stats.spent = r2(p.stats.spent + RULES.innBed);
    } else if (!own && !rented) return { ok: false, error: 'You can only sleep in your own home or at the inn.', code: 'err.noBed' };
    p.sleep = { day: state.day, place };
    p.where = place;
    return { ok: true, place, paid: place === 'inn' ? RULES.innBed : 0 };
  }
  if (action.type === 'rest') {
    const own = p.plot && state.plots[p.plot] && state.plots[p.plot].built && (!p.home || action.house === p.plot);
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
      if (balance(state, 'treasury') - reward >= RULES.treasuryReserve) transfer(state, 'treasury', 'player:' + id, reward);
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
    ...p, coins: r2(balance(state, 'player:' + p.id)), questInfo: questFor(p),
    job: p.job ? (() => {
      const today = p.job.shiftDay === state.day ? p.job.shiftsToday : 0;
      return { ...p.job, shiftsToday: today, maxShifts: JOBS.shiftsPerDay, shiftToday: today >= JOBS.shiftsPerDay, energy: JOBS.shiftEnergy };
    })() : null,
    home: p.home ? { id: p.home, ...HOUSES[p.home], restedToday: p.restedDay === state.day } : null,
    restedToday: p.restedDay === state.day,
    asleep: !!(p.sleep && p.sleep.day === state.day && isNight(state)), sleepPlace: p.sleep && p.sleep.day === state.day ? p.sleep.place : null,
    cold: !!p.cold, freezing: freezing(state, p), coatLeft: hasCoat(p) ? RULES.coatWinterDays - ((p.wear && p.wear.coat) || 0) : 0,
    innBed: RULES.innBed,
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
      full: Object.keys(n.buys).filter((g) => (n.stock[g] || 0) >= targetFor(state, def.id, g) * 3),
      line: def.lines[(state.day + def.id.length) % def.lines.length],
      lineKey: `${def.id}.${(state.day + def.id.length) % def.lines.length}`,
    };
  }
  const p = playerId && state.players[playerId];
  return {
    token: TOKEN,
    rev: state.rev || 0,
    day: state.day,
    dayProgress: (state.tick % RULES.ticksPerDay) / RULES.ticksPerDay,
    night: isNight(state),
    nightStart: NIGHT_START,
    threat: threatLevel(state),
    watchtowers: state.watchtowers || [],
    events: state.events,
    readiness: state.readiness,
    treasury: Math.round(balance(state, 'treasury')),
    totalMoney: totalMoney(state),
    population: Object.keys(state.players).length + Object.keys(state.bots).length,
    npcs,
    history: state.history,
    log: state.log.slice(0, 12),
    player: p ? playerView(state, p) : null,
    bots: Object.values(state.bots).map((b) => ({ id: b.id, name: b.name, path: b.path })),
    jobOffers: Object.values(state.jobOffers || {}),
    council: councilView(state, playerId),
    land: LAND,
    plots: Object.fromEntries(Object.entries(state.plots || {}).map(([id, x]) => [id, {
      owner: x.owner ? (state.players[x.owner] || {}).name || '?' : null, mine: !!(x.owner && x.owner === playerId),
      built: x.built, since: x.since || null, deed: x.deed,
    }])),
    // other players who were active recently (about the last game day)
    others: Object.values(state.players).filter((o) => o.id !== playerId && o.seenAt !== undefined && state.tick - o.seenAt < RULES.ticksPerDay)
      .map((o) => ({ id: o.id, name: o.name, path: o.path, where: o.where || 'gate' })),
    houses: Object.fromEntries(Object.entries(HOUSES).map(([id, h]) => {
      const st = (state.houses || {})[id] || {};
      return [id, { ...h, tenant: st.tenant ? (state.players[st.tenant] || {}).name || '?' : null, mine: !!(st.tenant && st.tenant === playerId) }];
    })),
  };
}
