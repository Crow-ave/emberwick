// Runs the economy for 100 game days and checks that it stays healthy.
import { createState, tick, joinPlayer, playerAction, totalMoney, publicView } from './economy.js';
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
}

// a watchtower: the council orders one, the carpenter is paid, readiness goes up
{
  const before = (state.watchtowers || []).length, carp = state.balances['npc:carpenter'];
  const r = playerAction(state, me, { type: 'propose', kind: 'tower' });
  const prop = state.council.open.find((x) => x.kind === 'tower');
  if (prop) for (const k of Object.keys(prop.aiPlan)) prop.votes[k] = { yes: true, w: 1 }, delete prop.aiPlan[k];
  for (let i = 0; i < RULES.ticksPerDay + 2; i++) tick(state);
  const after = (state.watchtowers || []).length;
  console.log('Watchtower: proposed', r.ok, '| towers', before, '->', after, '| carpenter +', Math.round(state.balances['npc:carpenter'] - carp));
  if (!r.ok || after !== before + 1) fail('the council could not build a watchtower');
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
console.log(problems ? `${problems} problem(s)` : 'All checks passed.');
process.exit(problems ? 1 : 0);
