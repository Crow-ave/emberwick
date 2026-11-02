// An in-memory stand-in for NEAR testnet, used by the tests
// (and by EMBERWICK_NEAR=fake to preview the NEAR screens offline).
export function fakeChain({ faucetWorks }) {
  const acc = new Map(); // id -> { near, code, ft: Map|null }
  let token = null;
  const ft = new Map(); // id -> bigint (registered accounts only)
  let txs = 0;
  const need = (id) => { if (!acc.has(id)) throw new Error(`account ${id} does not exist`); return acc.get(id); };
  return {
    pollMs: 0, acc, ft, get txs() { return txs; },
    newSecretKey: () => 'ed25519:secret',
    publicKeyOf: () => 'ed25519:PUB',
    implicitOf: () => 'a'.repeat(64),
    async exists(id) { return acc.has(id); },
    async nearBalance(id) { return acc.has(id) ? acc.get(id).near : 0; },
    async hasCode(id) { return !!need(id).code; },
    async isTokenReady(id) { return token === id; },
    async isRegistered(_t, id) { return ft.has(id); },
    async ftBalance(_t, id) { return ft.get(id) || 0n; },
    async faucet(name) {
      if (this.slow) await new Promise((r) => setTimeout(r, this.slow)); if (!faucetWorks) throw new Error('faucet 429'); acc.set(name, { near: 10 }); },
    async createTopLevel(from, name, _pk, n) { const a = need(from); if (a.near < n) throw new Error('not enough'); a.near -= n; acc.set(name, { near: n }); },
    async createSub(parent, id, _pk, n) { const a = need(parent); if (a.near < n) throw new Error('not enough'); a.near -= n; acc.set(id, { near: n }); txs++; },
    async deploy(id) { need(id).code = true; txs++; },
    async call(_s, contract, method, args) {
      if (method !== 'new') throw new Error('unknown');
      token = contract; ft.set(args.owner_id, BigInt(args.total_supply)); txs++;
    },
    async register(_s, _t, ids) { for (const id of ids) if (!ft.has(id)) ft.set(id, 0n); txs++; },
    async sendNear(from, to, n) { need(from).near -= n; need(to).near += n; txs++; },
    async ftTransfers(from, _t, items, wallets) {
      for (const w of wallets) if (!ft.has(w)) ft.set(w, 0n);
      // all-or-nothing, like one NEAR transaction failing on its first bad action
      const next = new Map(ft);
      for (const it of items) {
        if (!next.has(it.to)) throw new Error('not registered ' + it.to);
        const have = next.get(from) || 0n;
        if (have < it.amount) throw new Error('not enough balance');
        next.set(from, have - it.amount);
        next.set(it.to, next.get(it.to) + it.amount);
      }
      for (const [k, v] of next) ft.set(k, v);
      need(from).near -= 0.001;
      txs++;
      return 'hash' + txs;
    },
  };
}

