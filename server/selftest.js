// Runs the economy for 100 game days and checks that it stays healthy.
import { createState, tick, joinPlayer, playerAction, totalMoney, publicView } from './economy.js';
import { TOKEN, RULES } from './world.js';

const state = createState(42);
const me = joinPlayer(state, 'Tester', 'miner').id;
let problems = 0;
const fail = (m) => { problems++; console.log('PROBLEM:', m); };

for (let t = 0; t < RULES.ticksPerDay * 100; t++) {
  tick(state);
  if (t % 3 === 0) playerAction(state, me, { type: 'gather', spot: 'mine' });
  if (t % 7 === 0) playerAction(state, me, { type: 'sell', npc: 'smithy', good: 'ore', qty: 3 });
  const total = totalMoney(state);
  if (Math.abs(total - TOKEN.totalSupply) > 0.05) { fail(`money total ${total} at tick ${t}`); break; }
  for (const [k, v] of Object.entries(state.balances)) if (v < -0.001) fail(`${k} negative: ${v}`);
}

const v = publicView(state, me);
console.log('Day', v.day, '| total money', v.totalMoney, '| treasury', v.treasury, '| readiness', v.readiness);
console.log('Player:', v.player.name, 'coins', v.player.coins, 'inv', JSON.stringify(v.player.inv));
for (const n of Object.values(v.npcs)) console.log(n.id.padEnd(10), 'wallet', String(n.wallet).padStart(5), 'buys', JSON.stringify(n.buys), 'sells', JSON.stringify(n.sells));
console.log('Funds: newcomer', state.balances.newcomerFund, 'adventurer', state.balances.adventurerFund);
console.log('Recent log:'); v.log.slice(0, 8).forEach((l) => console.log('  day', l.day, l.text));
console.log(problems ? `${problems} problem(s)` : 'All checks passed.');
process.exit(problems ? 1 : 0);
