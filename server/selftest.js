// Runs the economy for 100 game days and checks that it stays healthy.
import { createState, tick, joinPlayer, playerAction, totalMoney, publicView } from './economy.js';
import { TOKEN, RULES } from './world.js';

const state = createState(42);
const me = joinPlayer(state, 'Tester', 'miner').id;
let problems = 0;
const stats = { jobs: 0, shifts: 0, rents: 0, rests: 0 };
const fail = (m) => { problems++; console.log('PROBLEM:', m); };

for (let t = 0; t < RULES.ticksPerDay * 100; t++) {
  tick(state);
  if (t % 3 === 0) playerAction(state, me, { type: 'gather', spot: 'mine' });
  if (t % 7 === 0) playerAction(state, me, { type: 'sell', npc: 'smithy', good: 'ore', qty: 3 });
  // jobs and homes: take any job offered, work a shift, rent the room, sleep, sometimes move out
  if (t % 11 === 0) {
    const p = state.players[me];
    if (!p.job) { const o = Object.values(state.jobOffers)[0]; if (o) { const r = playerAction(state, me, { type: 'takeJob', npc: o.npc }); if (r.ok) stats.jobs++; } }
    if (p.job && playerAction(state, me, { type: 'shift' }).ok) stats.shifts++;
    if (!p.home && playerAction(state, me, { type: 'rentHouse', house: 'house-1' }).ok) stats.rents++;
    if (playerAction(state, me, { type: 'rest' }).ok) stats.rests++;
    if (p.home && t % 997 === 0) playerAction(state, me, { type: 'leaveHouse' });
  }
  const total = totalMoney(state);
  if (Math.abs(total - TOKEN.totalSupply) > 0.05) { fail(`money total ${total} at tick ${t}`); break; }
  for (const [k, v] of Object.entries(state.balances)) if (v < -0.001) fail(`${k} negative: ${v}`);
}

const v = publicView(state, me);
console.log('Day', v.day, '| total money', v.totalMoney, '| treasury', v.treasury, '| readiness', v.readiness);
console.log('Player:', v.player.name, 'coins', v.player.coins, 'inv', JSON.stringify(v.player.inv));
for (const n of Object.values(v.npcs)) console.log(n.id.padEnd(10), 'wallet', String(n.wallet).padStart(5), 'buys', JSON.stringify(n.buys), 'sells', JSON.stringify(n.sells));
console.log('Funds: newcomer', state.balances.newcomerFund, 'adventurer', state.balances.adventurerFund);
console.log('Contracts:', JSON.stringify(stats), '| deposits held', state.balances.deposits);
if (!stats.jobs || !stats.shifts || !stats.rents || !stats.rests) fail('jobs or homes never happened');
console.log('Recent log:'); v.log.slice(0, 8).forEach((l) => console.log('  day', l.day, l.text));
console.log(problems ? `${problems} problem(s)` : 'All checks passed.');
process.exit(problems ? 1 : 0);
