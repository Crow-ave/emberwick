// Tests the NEAR bridge logic against a fake in-memory chain (no network needed).
// Run: node server/neartest.js
import { Bridge, toUnits, fromUnits } from './near.js';
import { createState, tick, joinPlayer, playerAction, onTransfer, linkWallet, withdraw, totalMoney } from './economy.js';
import { CRAFTSMEN, TOKEN } from './world.js';
import { fakeChain } from './fakechain.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };

async function run(faucetWorks) {
  console.log(`\n== faucet ${faucetWorks ? 'works' : 'is down'}`);
  const chain = fakeChain({ faucetWorks });
  let state = createState(42);
  let saved = null;
  const bridge = new Bridge({
    adapter: chain, npcIds: CRAFTSMEN.map((c) => c.id), totalSupply: TOKEN.totalSupply,
    balances: () => state.balances, store: { load: () => saved, save: (o) => { saved = o; } }, wasm: new Uint8Array(1),
  });
  onTransfer((f, t, a) => bridge.onTransfer(f, t, a));

  await bridge.step();
  if (!faucetWorks) {
    check(bridge.status === 'need-funds' && bridge.detail.address === 'a'.repeat(64), 'asks for testnet NEAR at the implicit address');
    chain.acc.set('a'.repeat(64), { near: 8 }); // the player sends NEAR from their wallet
    await bridge.step();
  }
  check(bridge.status === 'ready', 'setup finishes (status ' + bridge.status + ')');
  check(bridge.root === 'emberwick-village.testnet', 'village bank is ' + bridge.root);

  const compare = (label, skipBank) => {
    const exp = bridge.expected();
    let same = true;
    for (const [id, v] of Object.entries(exp)) if (!(skipBank && id === bridge.root)) if ((chain.ft.get(id) || 0n) !== v) { same = false; console.log('    differs', id, fromUnits(chain.ft.get(id) || 0n), fromUnits(v)); }
    check(same, label);
  };

  await bridge.step(); // first reconcile moves genesis balances out of the bank
  compare('after reconcile, chain balances match the game');

  const j = joinPlayer(state, 'Rüstem', 'miner');
  for (let d = 0; d < 400; d++) {
    tick(state);
    if (d % 7 === 0) playerAction(state, j.id, { type: 'gather', spot: 'mine' });
    if (d % 11 === 0) playerAction(state, j.id, { type: 'sell', npc: 'smithy', good: 'ore', qty: 3 });
    if (d % 25 === 0) await bridge.step();
  }
  await bridge.step(); await bridge.step();
  compare('after 400 ticks of trading, chain balances still match');
  check(chain.txs < 400, `transfers are batched (${chain.txs} transactions)`);

  check(linkWallet(state, j.id, 'emberwick.testnet').ok, 'player links emberwick.testnet');
  check(!linkWallet(state, j.id, 'not a wallet!').ok, 'rejects a bad account name');
  const before = state.balances['player:' + j.id];
  const w = withdraw(state, j.id, 5);
  check(w.ok, 'cash out 5 EMWK');
  bridge.withdraw(w.wallet, w.amount, 'Rüstem');
  await bridge.step();
  check(chain.ft.get('emberwick.testnet') === toUnits(5), 'wallet holds 5 EMWK on chain');
  check(Math.abs(state.balances['player:' + j.id] - (before - 5)) < 1e-6, 'game balance went down by 5');
  check(Math.abs(totalMoney(state) - TOKEN.totalSupply) < 1e-6, 'game total is still exactly the supply');
  compare('after cash-out, chain balances match');

  // the player wipes the save and starts a fresh village: reconcile fixes the chain
  state = createState(7);
  bridge.needReconcile = true;
  await bridge.step();
  compare('after a fresh village, reconcile resets craftsman and treasury balances', true);
  check(chain.ft.get('emberwick.testnet') === toUnits(5), 'cashed-out EMWK stays in the wallet');
}

await run(true);
await run(false);
console.log(fails ? `\n${fails} check(s) failed.` : '\nAll NEAR bridge checks passed.');
process.exit(fails ? 1 : 0);
