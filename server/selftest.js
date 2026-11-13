// Runs the economy for 100 game days and checks that it stays healthy.
import { createState, tick, joinPlayer, playerAction, totalMoney, publicView, checkAiActions, withdraw, linkWallet, withdrawable, applyAiPlan, deedFollowsChain } from './economy.js';
import { TOKEN, RULES } from './world.js';

const state = createState(42);
const me = joinPlayer(state, 'Tester', 'miner').id;
let problems = 0;
const stats = { jobs: 0, shifts: 0, rents: 0, rests: 0, proposals: 0, votes: 0 };
const fail = (m) => { problems++; console.log('PROBLEM:', m); };

for (let t = 0; t < RULES.ticksPerDay * 100; t++) {
  tick(state);
  if (t % 3 === 0) playerAction(state, me, { type: 'gather', spot: 'mine' });
  if (t % 7 === 0) playerAction(state, me, { type: 'sell', npc: 'smithy', good: 'ore', qty: 3 });
  // jobs and homes: take any job offered, work a shift, rent the room, sleep, sometimes move out
  if (t % 11 === 0) {
    const p = state.players[me];
    if (!p.job) for (const o of Object.values(state.jobOffers)) { const r = playerAction(state, me, { type: 'apply', npc: o.npc }); if (r.ok) { stats.jobs++; break; } }
    if (p.job && playerAction(state, me, { type: 'shift' }).ok) stats.shifts++;
    if (!p.home && playerAction(state, me, { type: 'rentHouse', house: 'house-1' }).ok) stats.rents++;
    if (playerAction(state, me, { type: 'rest' }).ok) stats.rests++;
    if (p.home && t % 997 === 0) playerAction(state, me, { type: 'leaveHouse' });
  }
  // council: propose now and then and vote on whatever is open
  if (t % 53 === 0) {
    const kinds = [{ kind: 'festival', amount: 3 }, { kind: 'tax', rate: 0.04 }, { kind: 'grant', npc: 'tower', amount: 100 }, { kind: 'welcome', amount: 150 }];
    if (playerAction(state, me, { type: 'propose', ...kinds[(t / 53) % 4 | 0] }).ok) stats.proposals++;
    for (const prop of state.council.open) if (playerAction(state, me, { type: 'vote', id: prop.id, yes: t % 2 === 0 }).ok) stats.votes++;
  }
  const total = totalMoney(state);
  if (Math.abs(total - TOKEN.totalSupply) > 0.05) { fail(`money total ${total} at tick ${t}`); break; }
  for (const [k, v] of Object.entries(state.balances)) if (v < -0.001) fail(`${k} negative: ${v}`);
}

// land: buy a plot, build a home with lumber, sleep in it
{
  const p = state.players[me];
  if (p.job) playerAction(state, me, { type: 'quitJob' });
  const bought = playerAction(state, me, { type: 'buyPlot', plot: 'plot-1' });
  p.inv.lumber = (p.inv.lumber || 0) + 6;
  const built = playerAction(state, me, { type: 'buildHouse', plot: 'plot-1' });
  console.log('Land: bought', bought.ok, '| built', built.ok, '| total money', totalMoney(state));
  if (!bought.ok || !built.ok) fail('could not buy land or build a home');
  if (Math.abs(totalMoney(state) - TOKEN.totalSupply) > 0.05) fail('money total changed with land');
}

// night: shops close (the inn stays open), nobody gathers
{
  const per = RULES.ticksPerDay;
  while ((state.tick % per) / per < 0.85) tick(state);
  const g = playerAction(state, me, { type: 'gather', spot: 'mine' });
  const b = playerAction(state, me, { type: 'buy', npc: 'bakery', good: 'bread', qty: 1 });
  console.log('Night: gather', g.code, '| bakery', b.code, '| view.night', publicView(state, me).night);
  if (g.code !== 'err.night' || b.code !== 'err.night') fail('shops or gathering stayed open at night');
  // a bed at the inn costs money and fills energy fast; sleeping outside leaves you cold in the morning
  const p = state.players[me], inn = state.balances['npc:inn'];
  p.energy = 2;
  const bed = playerAction(state, me, { type: 'sleep', place: 'inn' });
  const e0 = p.energy; tick(state); tick(state);
  console.log('Sleep: inn bed', bed.ok, '| paid', Math.round((state.balances['npc:inn'] - inn) * 100) / 100, '| energy', e0, '->', p.energy);
  if (!bed.ok || p.energy - e0 < RULES.energyPerTick * 2 * RULES.sleepRegen - 0.01) fail('sleeping at the inn did not work');
  while ((state.tick % per) !== 0) tick(state);
  if (p.cold) fail('a player who slept at the inn woke up cold');
  while ((state.tick % per) / per < 0.85) tick(state);
  p.seenAt = state.tick; while ((state.tick % per) !== 0) tick(state);
  console.log('Night outside: cold in the morning', p.cold);
  if (!p.cold) fail('sleeping outside had no effect');
}

// winter: a coat from the tailor keeps you warm
{
  const p = state.players[me];
  state.events.winter = true;
  const cold = playerView0().costs.mine;
  const r = playerAction(state, me, { type: 'buy', npc: 'tailor', good: 'coat', qty: 1 });
  const warm = playerView0().costs.mine;
  console.log('Winter: coat bought', r.ok, '| mine energy without/with coat', cold, warm);
  if (!r.ok || warm >= cold) fail('a coat did not help in winter');
  state.events.winter = false;
  if (Math.abs(totalMoney(state) - TOKEN.totalSupply) > 0.05) fail('money total changed with nights and coats');
}
// a bed for the home, renting it out to another player, and a new neighbourhood
{
  const owner = state.players[me];
  const t1 = joinPlayer(state, 'Tenant', 'farmer').id;
  state.balances['player:' + t1] = (state.balances['player:' + t1] || 0) + 60; state.balances.newcomerFund -= 60;
  while ((state.tick % RULES.ticksPerDay) / RULES.ticksPerDay < 0.85) tick(state);
  const noBed = playerAction(state, me, { type: 'sleep', place: owner.plot });
  while ((state.tick % RULES.ticksPerDay) !== 0) tick(state);
  state.npcs.carpenter.stock.bed = Math.max(1, state.npcs.carpenter.stock.bed || 0);
  const bed = playerAction(state, me, { type: 'buy', npc: 'carpenter', good: 'bed', qty: 1 });
  const list = playerAction(state, me, { type: 'listHome', plot: owner.plot, rent: 8 });
  if (owner.home) playerAction(state, me, { type: 'leaveHouse' });
  const ob = state.balances['player:' + me];
  const tax0 = state.players[me].stats.taxes || 0;
  const lease = playerAction(state, t1, { type: 'leaseHome', plot: owner.plot });
  for (let i = 0; i < RULES.ticksPerDay; i++) tick(state);
  // the morning village tax is taken from the owner too; add it back to see the rent itself,
  // and the day's food the owner ate (bought at the bakery)
  const food = (state.players[me].food && state.players[me].food.paid) || 0;
  const got = Math.round((state.balances['player:' + me] - ob + (state.players[me].stats.taxes || 0) - tax0 + food) * 100) / 100;
  console.log('Home: sleep without bed', noBed.code, '| bed bought', bed.ok, 'installed', bed.installed, '| listed', list.ok, '| leased', lease.ok, '| owner got', got);
  if (noBed.code !== 'err.noBedYet' || !bed.installed || !list.ok || !lease.ok || got < 16) fail('beds or renting out a home did not work');
  const before = state.districts.length;
  const pr = playerAction(state, me, { type: 'propose', kind: 'district' });
  const prop = state.council.open.find((x) => x.kind === 'district');
  if (prop) for (const k of Object.keys(prop.aiPlan)) prop.votes[k] = { yes: true, w: 1 }, delete prop.aiPlan[k];
  if (state.balances.treasury < 3000) { state.balances.treasury += 1000; state.balances.newcomerFund -= 1000; }
  for (let i = 0; i < RULES.ticksPerDay + 2; i++) tick(state);
  const d1 = publicView(state, me).plots['d1-12'];
  console.log('District: proposed', pr.ok, '| open', before, '->', state.districts.length, '| far plot price', d1.price, 'vs centre', publicView(state, me).plots['plot-4'].price);
  if (!pr.ok || state.districts.length !== before + 1 || !d1.open || d1.price >= 120) fail('a new neighbourhood did not open');
  const villa = playerAction(state, t1, { type: 'buyPlot', plot: 'd2-1' });
  if (villa.ok) fail('a closed villa plot could be bought');
  if (Math.abs(totalMoney(state) - TOKEN.totalSupply) > 0.05) fail('money total changed with homes and districts');
}
// the exchange: a sell order filled by another player, and a deed sold player to player
{
  const a = joinPlayer(state, 'Seller', 'woodcutter').id, b2 = joinPlayer(state, 'Buyer', 'farmer').id;
  state.balances['player:' + b2] += 400; state.balances.newcomerFund -= 400;
  while ((state.tick % RULES.ticksPerDay) / RULES.ticksPerDay > 0.5) tick(state);
  state.players[a].inv.lumber = 5;
  const post = playerAction(state, a, { type: 'postOrder', good: 'lumber', qty: 5, price: 7 });
  const sb = state.balances['player:' + a];
  const fill = playerAction(state, b2, { type: 'fillOrder', id: post.id, qty: 2 });
  const got = Math.round((state.balances['player:' + a] - sb) * 100) / 100;
  const cancel = playerAction(state, a, { type: 'cancelOrder', id: post.id });
  console.log('Exchange: posted', post.ok, '| filled', fill.ok, fill.qty, '| seller got', got, '| cancelled back', cancel.qty, '| buyer lumber', state.players[b2].inv.lumber);
  if (!post.ok || !fill.ok || got !== 13.72 || cancel.qty !== 3 || state.players[b2].inv.lumber !== 2) fail('the exchange did not work');
  const owner = state.players[me], plotId = owner.plot;
  const list = playerAction(state, me, { type: 'listDeed', plot: plotId, price: 200 });
  const buy = playerAction(state, b2, { type: 'buyDeed', plot: plotId });
  console.log('Deed market: listed', list.ok, '| bought', buy.ok, '| new owner', state.plots[plotId].owner === b2, '| seller plot', owner.plot);
  if (!list.ok || !buy.ok || state.plots[plotId].owner !== b2 || owner.plot) fail('the deed market did not work');
  if (Math.abs(totalMoney(state) - TOKEN.totalSupply) > 0.05) fail('money total changed on the exchange');
}
// job interviews: two applicants at night, nobody is hired before morning, the more skilled one wins with a higher wage
{
  const per = RULES.ticksPerDay;
  const x = joinPlayer(state, 'Novice', 'farmer').id, y = joinPlayer(state, 'Expert', 'farmer').id;
  state.players[y].xp.farming = 70; // level 5
  while ((state.tick % per) / per < 0.85) tick(state);
  state.jobOffers.bakery = { npc: 'bakery', wage: 8, days: 3, day: state.day, require: null };
  const a1 = playerAction(state, x, { type: 'apply', npc: 'bakery' }), a2 = playerAction(state, y, { type: 'apply', npc: 'bakery' });
  for (let i = 0; i < 3; i++) tick(state);
  const hiredAtNight = !!(state.players[x].job || state.players[y].job);
  while ((state.tick % per) !== 1) tick(state);
  for (let i = 0; i < 14; i++) tick(state);
  const X = state.players[x], Y = state.players[y];
  console.log('Interviews: applied', a1.ok, a2.ok, '| hired at night', hiredAtNight, '| expert hired', !!Y.job, 'wage', Y.job && Y.job.wage, '| novice', X.appResult && X.appResult.why);
  if (!a1.ok || !a2.ok || hiredAtNight || !Y.job || X.job || Y.job.wage <= 8 || X.appResult.why !== 'otherBetter') fail('job interviews did not work');
}
function playerView0() { return publicView(state, me).player; }

// a watchtower: the council orders one, the carpenter is paid, readiness goes up
{
  const before = (state.watchtowers || []).length, carp = state.balances['npc:carpenter'];
  const r = playerAction(state, me, { type: 'propose', kind: 'tower' });
  const prop = state.council.open.find((x) => x.kind === 'tower');
  if (prop) for (const k of Object.keys(prop.aiPlan)) prop.votes[k] = { yes: true, w: 1 }, delete prop.aiPlan[k];
  for (let i = 0; i < RULES.ticksPerDay + 2; i++) tick(state);
  const after = (state.watchtowers || []).length;
  console.log('Watchtower: proposed', r.ok, r.code, '| towers', before, '->', after, '| carpenter +', Math.round(state.balances['npc:carpenter'] - carp));
  if (r.code === 'err.noTowerSpot') console.log('  (all watchtower spots already built by the village)');
  else if (r.code === 'err.sameProposal' && after === before + 1) console.log('  (a villager had already proposed one; it was built)');
  else if (!r.ok || after !== before + 1) fail('the council could not build a watchtower');
  if (Math.abs(totalMoney(state) - TOKEN.totalSupply) > 0.05) fail('money total changed with the watchtower');
}

const v = publicView(state, me);
console.log('Day', v.day, '| total money', v.totalMoney, '| treasury', v.treasury, '| readiness', v.readiness);
console.log('Player:', v.player.name, 'coins', v.player.coins, 'inv', JSON.stringify(v.player.inv));
for (const n of Object.values(v.npcs)) console.log(n.id.padEnd(10), 'wallet', String(n.wallet).padStart(5), 'buys', JSON.stringify(n.buys), 'sells', JSON.stringify(n.sells));
console.log('Funds: newcomer', state.balances.newcomerFund, 'adventurer', state.balances.adventurerFund);
console.log('Contracts:', JSON.stringify(stats), '| deposits held', state.balances.deposits);
if (!stats.jobs || !stats.shifts || !stats.rents || !stats.rests) fail('jobs or homes never happened');
const decided = state.council.closed.length;
console.log('Council: proposals', stats.proposals, 'votes', stats.votes, '| recent results', state.council.closed.map((x) => x.kind + ':' + x.result).join(', '), '| tax', state.taxRate ?? 'default');
if (!stats.proposals || !stats.votes || !decided) fail('the council never decided anything');
console.log('Recent log:'); v.log.slice(0, 8).forEach((l) => console.log('  day', l.day, l.text));
// a price named in conversation becomes an offer at the counter, decided by the haggling rules (the AI never bargains in words)
{
  const hp = joinPlayer(state, 'Haggler', 'farmer').id;
  const g = Object.keys(state.npcs.carpenter.sells).find((x) => (state.npcs.carpenter.stock[x] || 0) >= 1);
  const acts = checkAiActions(state, hp, 'carpenter', [{ type: 'haggle', side: 'buy', good: g, qty: 1, price: 0.48 }, { type: 'haggle', side: 'buy', good: 'dragon', qty: 1, price: 1 }, { type: 'haggle', side: 'sell', good: 'wood', qty: 1, price: 2 }]);
  console.log('Haggle from conversation:', JSON.stringify(acts));
  if (acts.length !== 1 || acts[0].type !== 'haggle' || acts[0].offer !== 0.5 || acts[0].good !== g) fail('a haggle action from conversation was not checked correctly');
}
// cash-out: the starting money stays in the village, and one NEAR wallet links to one character only
{
  const a = joinPlayer(state, 'Saver', 'miner').id, b = joinPlayer(state, 'Twin', 'miner').id;
  const l1 = linkWallet(state, a, 'saver.testnet', true), l2 = linkWallet(state, b, 'saver.testnet', true);
  const start = state.players[a].startCoins;
  const early = withdraw(state, a, 1);
  state.balances['player:' + a] += 30; state.balances.newcomerFund -= 30; // as if earned
  const can = withdrawable(state, a), over = withdraw(state, a, can + 1), ok = withdraw(state, a, can);
  const lock = linkWallet(state, a, 'thief.testnet');
  if (lock.ok || lock.code !== 'err.walletLocked' || state.players[a].near !== 'saver.testnet') fail('a verified wallet was replaced without a signature');
  console.log('Cash-out rules: start', start, '| right away', early.code, '| after earning 30 can', can, over.code, ok.ok, '| same wallet twice', l1.ok, l2.code);
  if (early.ok || early.code !== 'err.startLocked' || can !== 30 || over.ok || !ok.ok || !l1.ok || l2.ok || l2.code !== 'err.walletUsed') fail('the cash-out rules did not hold');
  if (Math.abs(totalMoney(state) - TOKEN.totalSupply) > 0.05) fail('money total changed with cash-out');
}
// daily food: an active player eats 2 bread each morning (bag first, then the bakery); without money they wake up hungry
{
  const fed = joinPlayer(state, 'Eater', 'farmer').id, broke = joinPlayer(state, 'Broke', 'farmer').id;
  state.players[fed].inv.bread = 1;
  const bb = state.balances['player:' + broke]; state.balances['player:' + broke] = 0; state.balances.newcomerFund += bb;
  state.npcs.bakery.stock.bread = Math.max(5, state.npcs.bakery.stock.bread || 0);
  for (const id of [fed, broke]) state.players[id].seenAt = state.tick;
  while ((state.tick % RULES.ticksPerDay) !== RULES.ticksPerDay - 1) tick(state);
  tick(state);
  const f1 = state.players[fed].food, f2 = state.players[broke].food;
  console.log('Daily food: fed', JSON.stringify(f1), '| no money', JSON.stringify(f2));
  // a player with no money gets the bread on credit from the baker (the usual credit rules); with bad credit they go hungry
  if (!f1 || f1.fromBag !== 1 || f1.bought !== 1 || f1.missing !== 0 || !f2 || f2.credit !== 2 || state.players[broke].hungry) fail('the daily food rule did not work');
  const bp = state.players[broke]; bp.badCredit = { bakery: true }; delete (bp.debts || {}).bakery; bp.seenAt = state.tick;
  for (let i = 0; i < RULES.ticksPerDay; i++) tick(state);
  console.log('Daily food, no money and no credit: hungry', bp.hungry, JSON.stringify(bp.food));
  if (!bp.hungry || bp.food.missing !== 2) fail('a player with no money and no credit was not hungry');
  if (Math.abs(totalMoney(state) - TOKEN.totalSupply) > 0.05) fail('money total changed with daily food');
}
// NEAR AI answer signatures: a correct one passes; a changed answer, a wrong key, or a key outside the attestation report fail
{
  const crypto = await import('node:crypto');
  const { secp256k1 } = await import('@noble/curves/secp256k1.js');
  const { keccak_256 } = await import('@noble/hashes/sha3.js');
  const { checkSignature } = await import('./ai.js');
  const enc = new TextEncoder(), sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const addr = (sk) => '0x' + Buffer.from(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(-20)).toString('hex');
  const sign = (t, sk) => { const m = enc.encode(t); const r = secp256k1.sign(keccak_256(new Uint8Array([...enc.encode(`\x19Ethereum Signed Message:\n${m.length}`), ...m])), sk, { prehash: false, format: 'recovered' }); return '0x' + Buffer.from([...r.slice(1), r[0] + 27]).toString('hex'); };
  const k1 = secp256k1.utils.randomSecretKey(), k2 = secp256k1.utils.randomSecretKey();
  const call = { id: 'c1', model: 'm', sent: '{"q":1}', received: '{"a":2}' }, text = sha(call.sent) + ':' + sha(call.received);
  const keys = new Map([[addr(k1), 'model']]);
  const good = checkSignature(call, { text, signature: sign(text, k1), signing_address: addr(k1) }, keys);
  const changed = checkSignature({ ...call, received: '{"a":3}' }, { text, signature: sign(text, k1), signing_address: addr(k1) }, keys);
  const wrongKey = checkSignature(call, { text, signature: sign(text, k2), signing_address: addr(k1) }, keys);
  const notAttested = checkSignature(call, { text, signature: sign(text, k2), signing_address: addr(k2) }, keys);
  console.log('AI answer signatures: good', good.ok, '| changed answer', changed.ok, '| wrong key', wrongKey.ok, '| key not attested', notAttested.ok);
  if (!good.ok || changed.ok || wrongKey.ok || notAttested.ok) fail('the NEAR AI answer signature check is wrong');
}
// the land follows its deed NFT: only a move to another player's verified wallet changes the owner in the game
{
  const g = createState(9); g.nearBank = 'bank.testnet';
  const a = joinPlayer(g, 'Ayla', 'farmer').id, b = joinPlayer(g, 'Baran', 'farmer').id, c = joinPlayer(g, 'Cem', 'farmer').id;
  g.players[a].near = 'ayla.testnet'; g.players[a].nearVerified = true;
  g.players[b].near = 'baran.testnet'; g.players[b].nearVerified = true;
  g.players[c].near = 'cem.testnet'; g.players[c].nearVerified = false; // linked, but never signed
  g.balances['player:' + a] += 500; g.balances.treasury -= 500;
  const bought = playerAction(g, a, { type: 'buyPlot', plot: 'plot-1' });
  const plot = g.plots['plot-1']; Object.assign(plot.deed, { minted: true, owner: 'ayla.testnet' });
  g.players[a].sleep = { place: 'plot-1' };
  const r1 = deedFollowsChain(g, 'plot-1', 'bank.testnet'), r2 = deedFollowsChain(g, 'plot-1', 'ayla.testnet');
  const r3 = deedFollowsChain(g, 'plot-1', 'cem.testnet'), r4 = deedFollowsChain(g, 'plot-1', 'stranger.testnet');
  const still = plot.owner === a;
  const r5 = deedFollowsChain(g, 'plot-1', 'baran.testnet');
  console.log('Deed follows NFT: bank', r1.changed, '| own wallet', r2.changed, '| unverified', r3.changed, '| unknown', r4.changed, '| other player', r5.changed, '->', plot.owner === b ? 'Baran' : plot.owner);
  if (!bought.ok || r1.changed || r2.changed || r3.changed || r4.changed || !still || !r5.changed || plot.owner !== b || g.players[b].plot !== 'plot-1' || g.players[a].plot || g.players[a].sleep) fail('the land did not follow its deed NFT correctly');
  // one plot per villager: someone who already has land does not get a second one
  g.balances['player:' + b] += 500; g.balances.treasury -= 500;
  g.players[a].near = 'ayla.testnet';
  g.balances['player:' + a] += 500; g.balances.treasury -= 500;
  playerAction(g, a, { type: 'buyPlot', plot: 'plot-2' });
  Object.assign(g.plots['plot-2'].deed, { minted: true, owner: 'ayla.testnet' });
  const r6 = deedFollowsChain(g, 'plot-2', 'baran.testnet');
  if (r6.changed || g.plots['plot-2'].owner !== a) fail('a villager with land got a second plot from a deed NFT');
  if (Math.abs(totalMoney(g) - TOKEN.totalSupply) > 0.05) fail('money total changed when land followed its deed');
}
// Village Ledger: every recorded day waits for the ledger contract with the same full hash the game serves
{
  const out = state.ledgerOut || [], last = (state.dayLog || [])[0];
  const s2 = createState(7); s2.day = 3;
  applyAiPlan(s2, { craftsmen: [{ id: 'bakery', want: { wheat: 1.3 }, price: { bread: 1.1 }, why: 'test' }] }, 'deepseek/deepseek-v3.2', { tee: true, signer: '0xab', proof: { ok: true, signer: '0x12ab', chatId: 'c' } });
  const plan = (s2.ledgerOut || []).find((x) => x.kind === 'ai_plan');
  console.log('Village Ledger AI plan record:', JSON.stringify(plan && { day: plan.day, model: plan.model, tee: plan.tee, signed: plan.signed, signer: plan.signer }));
  if (!plan || plan.sha256 !== s2.aiLog[0].hash || plan.signed !== true || plan.tee !== true || plan.signer !== '0x12ab') fail('the AI plan does not go to the Village Ledger with its signature check');
  const mine = last && out.find((x) => x.kind === 'state' && x.day === last.day);
  console.log('Village Ledger queue:', out.length, 'records waiting (no NEAR in this test); newest state day', last && last.day, mine ? 'queued with its full hash' : 'MISSING');
  if (!mine || mine.sha256 !== last.hash || out.length > 40 || out.some((x) => !/^[0-9a-f]{64}$/.test(x.sha256))) fail('the Village Ledger queue does not match the day records');
}
console.log(problems ? `${problems} problem(s)` : 'All checks passed.');
process.exit(problems ? 1 : 0);
