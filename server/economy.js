// The Emberwick economy engine.
// All money lives in one ledger (state.balances). Money only ever moves between
// accounts, so the total always equals TOKEN.totalSupply. This mirrors how the
// EMWK token will behave on NEAR.

import { TOKEN, GENESIS, GOODS, GATHER_SPOTS, CRAFTSMEN, START_PATHS, RULES, QUESTS, PATH_ROUTE, BUILDINGS, SKILL_OF, SKILLS, JOBS, HOUSES } from './world.js';

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

function transfer(state, from, to, amount) {
  amount = r2(amount);
  if (amount <= 0) return true;
  if (balance(state, from) + 1e-9 < amount) return false;
  state.balances[from] = r2(balance(state, from) - amount);
  state.balances[to] = r2(balance(state, to) + amount);
  for (const w of watchers) w(from, to, amount);
  return true;
}

// ---------- NEAR wallet link and cash-out ----------

const NEAR_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function validNearId(id) { return NEAR_ID.test(String(id || '')); }

export function linkWallet(state, playerId, accountId) {
  const p = state.players[playerId];
  if (!p) return { ok: false, error: 'Unknown player.', code: 'err.unknownPlayer' };
  accountId = String(accountId || '').trim().toLowerCase();
  if (!validNearId(accountId) || !accountId.endsWith('.testnet') && !/^[0-9a-f]{64}$/.test(accountId)) {
    return { ok: false, error: 'That is not a NEAR testnet account.', code: 'err.badWallet' };
  }
  p.near = accountId;
  state.rev = (state.rev || 0) + 1;
  addLog(state, `${p.name} linked a NEAR wallet.`, 'info', 'log.linked', { name: p.name });
  return { ok: true, near: accountId };
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
  return Math.min(RULES.energyCap, RULES.energyMax + total - SKILLS.length);
}
function energyCost(p, spotKey) {
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
  return t;
}

// ---------- trading (shared by players, bots and npcs) ----------

// `actor` is { acct, holder } where holder has .inv
function sellToNpc(state, actor, npcId, good, qty) {
  const npc = state.npcs[npcId];
  if (!npc || npc.buys[good] === undefined) return { ok: false, error: 'This shop does not buy that.', code: 'err.notBuying' };
  if (inv(actor.holder, good) < qty) return { ok: false, error: 'You do not have enough.', code: 'err.notEnough' };
  const unit = price(npc.buys[good] * (1 + (actor.bonus || 0)));
  const total = unit * qty;
  if (balance(state, npcAcct(npcId)) < total) return { ok: false, error: 'The shopkeeper cannot afford that right now.', code: 'err.shopBroke' };
  const tax = r2(total * RULES.taxRate);
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
  const tax = r2(total * RULES.taxRate);
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

function gatherYield(state, spot, holder) {
  const s = GATHER_SPOTS[spot];
  let amount = s.base + Math.floor(rng(state) * 2);
  if (holder.xp) amount += skillLevel(holder, SKILL_OF[s.good]) - 1;
  const tool = Object.entries(GOODS).find(([k, g]) => g.boosts === s.good && inv(holder, k) > 0);
  if (tool) amount += 2;
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
  if (action.type === 'gather') {
    if (p.job) return { ok: false, error: 'You are an apprentice. You can only work at your shop until you quit.', code: 'err.employed' };
    const spot = GATHER_SPOTS[action.spot];
    if (!spot) return { ok: false, error: 'You cannot gather there.', code: 'err.cannotGather' };
    const cost = energyCost(p, action.spot);
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
  const progress = job
    ? { gather: [st.gathers + sh, 2], sell: [Math.max(st.sells ? 3 : 0, sh), 3], supply: [Math.max(Math.round(st.sold * 8 / 15), sh), 8] }[q.id]
    : { gather: [st.gathers, 2], earn: [Math.floor(st.earned), 40], supply: [st.sold, 15] }[q.id] || null;
  const target = job || fill(q.target);
  return { index: p.quest || 0, total: QUESTS.length - 1, id: q.id, title: q.title, text: fillText(q.text), target, reward: q.reward, progress, spot: route.spot, shop: route.shop, job };
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
  for (const p of Object.values(state.players)) p.energy = Math.min(maxEnergy(p), r2(p.energy + RULES.energyPerTick));
  for (const b of Object.values(state.bots)) b.energy = Math.min(RULES.energyMax, r2(b.energy + RULES.energyPerTick));

  runBots(state);
  runCraftsmen(state);
  runInn(state);
  adjustPrices(state);
  updateReadiness(state);

  if (state.tick % 5 === 0) recordHistory(state);
  if (newDay) startNewDay(state);
}

function runBots(state) {
  for (const b of Object.values(state.bots)) {
    if (rng(state) > 0.35) continue;
    const spotKey = { farmer: 'fields', miner: 'mine', woodcutter: 'forest' }[b.path];
    const spot = GATHER_SPOTS[spotKey];
    if (b.energy >= spot.energy) {
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

    // produce
    if (!def.recipe) continue;
    const outGood = Object.keys(def.recipe.out)[0];
    if ((npc.stock[outGood] || 0) >= targetFor(state, def.id, outGood) * 1.5) continue;
    const canMake = Object.entries(def.recipe.in).every(([g, q]) => (npc.stock[g] || 0) >= q);
    if (canMake && rng(state) < 0.5) {
      for (const [g, q] of Object.entries(def.recipe.in)) npc.stock[g] -= q;
      for (const [g, q] of Object.entries(def.recipe.out)) npc.stock[g] = (npc.stock[g] || 0) + q;
      // the woodcutter, miller and smith also make tools now and then
      if (def.id === 'woodcutter' && rng(state) < 0.15) npc.stock.axe = (npc.stock.axe || 0) + 1;
      if (def.id === 'mill' && rng(state) < 0.1) npc.stock.plow = (npc.stock.plow || 0) + 1;
    }
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

function adjustPrices(state) {
  const step = RULES.priceStep;
  for (const def of CRAFTSMEN) {
    const npc = state.npcs[def.id];
    for (const good of Object.keys(npc.buys)) {
      const s = npc.stock[good] || 0, t = targetFor(state, def.id, good);
      if (s < t) npc.buys[good] *= 1 + step * (s < t / 2 ? 1.5 : 1);
      else if (s > t * 1.5) npc.buys[good] *= 1 - step;
      npc.buys[good] = clamp(npc.buys[good], npc.base[good] * 0.4, npc.base[good] * 4);
    }
    for (const good of Object.keys(npc.sells)) {
      const s = npc.stock[good] || 0, t = Math.max(1, targetFor(state, def.id, good));
      if (s < t * 0.5) npc.sells[good] *= 1 + step;
      else if (s > t) npc.sells[good] *= 1 - step * 0.7;
      npc.sells[good] = clamp(npc.sells[good], npc.base[good] * 0.5, npc.base[good] * 4);
    }
  }
}

function updateReadiness(state) {
  const tower = state.npcs.tower;
  const swords = tower.stock.sword || 0, bread = tower.stock.bread || 0;
  state.readiness = Math.round(Math.min(100, (swords / 8) * 70 + (bread / 6) * 30));
}

function recordHistory(state) {
  for (const g of Object.keys(GOODS)) {
    const producers = Object.values(state.npcs).filter((n) => n.sells[g] !== undefined);
    const buyers = Object.values(state.npcs).filter((n) => n.buys[g] !== undefined);
    const src = producers.length ? producers.map((n) => n.sells[g]) : buyers.map((n) => n.buys[g]);
    if (!src.length) continue;
    const avg = src.reduce((a, b) => a + b, 0) / src.length;
    state.history[g].push(r2(avg));
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
  const innBal = balance(state, npcAcct('inn'));
  if (innBal > 600) transfer(state, npcAcct('inn'), 'adventurerFund', (innBal - 600) * 0.5);

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
  postJobOffers(state);
}

// ---------- jobs and homes ----------

export function ensureContracts(state) {
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
    state.jobOffers[def.id] = { npc: def.id, wage, days: JOBS.days, day: state.day };
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

function contractAction(state, p, action) {
  const acct = 'player:' + p.id;
  if (action.type === 'takeJob') {
    const o = state.jobOffers[action.npc];
    if (!o) return { ok: false, error: 'That job is no longer offered.', code: 'err.noJob' };
    if (p.job) return { ok: false, error: 'You already have a job.', code: 'err.haveJob' };
    p.job = { npc: o.npc, wage: o.wage, daysLeft: o.days, startDay: state.day, shiftDay: null, shiftsToday: 0, shifts: 0 };
    delete state.jobOffers[o.npc];
    addLog(state, `${p.name} became an apprentice.`, 'join', 'log.hired', { name: p.name, place: { $place: o.npc }, n: o.wage });
    return { ok: true, job: p.job };
  }
  if (action.type === 'shift') {
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
  if (action.type === 'rest') {
    if (!p.home) return { ok: false, error: 'You do not rent a home.', code: 'err.noHome' };
    if (p.restedDay === state.day) return { ok: false, error: 'You already slept here today.', code: 'err.rested' };
    const before = p.energy;
    p.energy = Math.min(maxEnergy(p), r2(p.energy + HOUSES[p.home].rest));
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
  const costs = Object.fromEntries(Object.keys(GATHER_SPOTS).map((k) => [k, energyCost(p, k)]));
  return {
    ...p, coins: r2(balance(state, 'player:' + p.id)), questInfo: questFor(p),
    job: p.job ? (() => {
      const today = p.job.shiftDay === state.day ? p.job.shiftsToday : 0;
      return { ...p.job, shiftsToday: today, maxShifts: JOBS.shiftsPerDay, shiftToday: today >= JOBS.shiftsPerDay, energy: JOBS.shiftEnergy };
    })() : null,
    home: p.home ? { id: p.home, ...HOUSES[p.home], restedToday: p.restedDay === state.day } : null,
    skills, maxEnergy: maxEnergy(p), costs, tradeBonus: r2((skills.trading.level - 1) * RULES.tradeBonus), toolUses: RULES.toolUses,
  };
}

export function publicView(state, playerId) {
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
    houses: Object.fromEntries(Object.entries(HOUSES).map(([id, h]) => {
      const st = (state.houses || {})[id] || {};
      return [id, { ...h, tenant: st.tenant ? (state.players[st.tenant] || {}).name || '?' : null, mine: !!(st.tenant && st.tenant === playerId) }];
    })),
  };
}
