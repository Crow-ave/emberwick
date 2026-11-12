// Tests the NEAR bridge logic against a fake in-memory chain (no network needed).
// Run: node server/neartest.js
import { Bridge, toUnits, fromUnits } from './near.js';
import { createState, tick, joinPlayer, playerAction, onTransfer, linkWallet, withdraw, depositIn, totalMoney } from './economy.js';
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

  check(linkWallet(state, j.id, 'emberwick.testnet', true).ok, 'player links emberwick.testnet (signed)');
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

  // the player sends 3 EMWK back from their own wallet to the village bank
  chain.ft.set('emberwick.testnet', chain.ft.get('emberwick.testnet') - toUnits(3));
  chain.ft.set(bridge.root, chain.ft.get(bridge.root) + toUnits(3));
  chain.userTx.set('tx-dep-1', { signer: 'emberwick.testnet', contract: bridge.tokenId, receiver: bridge.root, amount: toUnits(3), memo: 'deposit' });
  chain.userTx.set('tx-bad', { signer: 'someone.testnet', contract: bridge.tokenId, receiver: bridge.root, amount: toUnits(3) });
  const amt = (await bridge.checkDeposit('tx-dep-1', 'emberwick.testnet')).amount;
  check(amt === 3, 'deposit is read from the chain (3 EMWK)');
  let refused = false; try { await bridge.checkDeposit('tx-bad', 'emberwick.testnet'); } catch { refused = true; }
  check(refused, 'a transfer signed by someone else is refused');
  const coins = state.balances['player:' + j.id];
  check(depositIn(state, j.id, amt, 'tx-dep-1').ok, 'deposit is credited in the game');
  check(!depositIn(state, j.id, amt, 'tx-dep-1').ok, 'the same transaction cannot be counted twice');
  check(Math.abs(state.balances['player:' + j.id] - coins - 3) < 1e-6, 'player has 3 more EMWK');
  check(Math.abs(totalMoney(state) - TOKEN.totalSupply) < 1e-6, 'game total is still exactly the supply');
  await bridge.step();
  compare('after the deposit, chain balances match');

  // the player wipes the save and starts a fresh village: reconcile fixes the chain
  state = createState(7);
  bridge.needReconcile = true;
  await bridge.step();
  compare('after a fresh village, reconcile resets craftsman and treasury balances', true);
  check(chain.ft.get('emberwick.testnet') === toUnits(2), 'cashed-out EMWK stays in the wallet');
}

// land deeds: the NFT contract is set up and a deed is minted to the buyer's wallet
async function deeds() {
  console.log('\n== land deeds');
  const chain = fakeChain({ faucetWorks: true });
  const state = createState(3);
  let saved = null, got = null;
  const bridge = new Bridge({ adapter: chain, npcIds: CRAFTSMEN.map((c) => c.id), totalSupply: TOKEN.totalSupply, balances: () => state.balances,
    store: { load: () => saved, save: (o) => { saved = o; } }, wasm: new Uint8Array(1), nftWasm: new Uint8Array(1), onDeed: (plot, info) => { got = { plot, ...info }; } });
  await bridge.step(); await bridge.step();
  check(bridge.deeds.status === 'ready', 'deeds contract is ready (' + bridge.deeds.status + ')');
  bridge.mintDeed({ plot: 'plot-1', tokenId: 'plot-1-1-p1', owner: 'emberwick.testnet', title: 't', description: 'd' });
  await bridge.step();
  check(chain.nft.tokens.get('plot-1-1-p1') === 'emberwick.testnet', 'deed NFT belongs to the buyer');
  check(got && got.minted && got.plot === 'plot-1', 'the game hears that the deed was minted');
}
await deeds();

// a craftsman account out of NEAR for gas gets a top-up from the bank; the bank does not pause
async function gas() {
  console.log('\n== gas');
  const chain = fakeChain({ faucetWorks: true });
  const state = createState(4);
  let saved = null; const said = [];
  const bridge = new Bridge({ adapter: chain, npcIds: CRAFTSMEN.map((c) => c.id), totalSupply: TOKEN.totalSupply, balances: () => state.balances,
    store: { load: () => saved, save: (o) => { saved = o; } }, wasm: new Uint8Array(1), nftWasm: new Uint8Array(1), say: (m) => said.push(m) });
  await bridge.step(); await bridge.step(); await bridge.step();
  const smith = bridge.subAccounts().find((a) => a.startsWith('smithy.'));
  chain.acc.get(smith).near = 0; chain.acc.get(bridge.root).near = 5;
  const before = await chain.nearBalance(smith);
  state.balances['npc:smithy'] -= 1; state.balances['npc:bakery'] += 1;
  bridge.onTransfer('npc:smithy', 'npc:bakery', 1);
  for (let i = 0; i < 4; i++) await bridge.step();
  const after = await chain.nearBalance(smith);
  check(before < 0.001, 'the smith account was out of gas (' + before + ')');
  check(after > 0.3, 'the bank topped the smith account up (' + after + ')');
  check(!bridge.lowGas, 'sending is not paused');
  check(said.some((m) => /low on gas/.test(m)), 'the log says which account was topped up');
}
await gas();

await run(true);
await run(false);
console.log(fails ? `\n${fails} check(s) failed.` : '\nAll NEAR bridge checks passed.');
process.exit(fails ? 1 : 0);
