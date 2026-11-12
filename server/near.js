// Emberwick <-> NEAR testnet bridge.
//
// The game keeps its own fast ledger. This bridge mirrors every money move onto a
// real NEP-141 token (EMWK) on NEAR testnet:
//   * each AI craftsman has its own NEAR account and wallet key,
//   * the village treasury has its own account,
//   * players and bot villagers are held by the village bank (the root account),
//   * a player who links a NEAR wallet can cash out EMWK to it.
// If NEAR is unreachable the game keeps running; the bridge catches up later
// by comparing balances (reconcile).

import fs from 'node:fs';
import path from 'node:path';

export const NET = {
  networkId: 'testnet',
  rpcs: ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'],
  helper: 'https://helper.testnet.near.org/account',
  explorer: 'https://testnet.nearblocks.io',
  wallet: 'https://wallet.meteorwallet.app',
};

export const DECIMALS = 2;
const UNIT = 10 ** DECIMALS;
export const toUnits = (x) => BigInt(Math.round(Number(x) * UNIT));
export const fromUnits = (u) => Number(u) / UNIT;
const YOCTO = 10n ** 24n;
export const nearToYocto = (n) => (BigInt(Math.round(n * 1e6)) * YOCTO) / 1000000n;
export const yoctoToNear = (y) => Number((BigInt(y) * 1000n) / YOCTO) / 1000;

const ROOT_NAMES = ['emberwick-village', 'emberwick-village-2', 'emberwick-village-3', 'emberwick-hamlet', 'emberwick-town'];
const SUB_NEAR = 0.2;      // NEAR given to each craftsman / treasury account for gas
const TOKEN_NEAR = 2.5;    // NEAR for the token contract storage (~220 KB)
const ROOT_MIN_SETUP = 4.5; // root needs at least this before it creates everything
const LOW_GAS = 0.25;      // a craftsman/treasury account below this gets TOPUP_NEAR more from the bank for gas
const TOPUP_NEAR = 0.5;    // a batch of 15 transfers needs about 0.13 NEAR of prepaid gas up front (most of it comes back)
const ROOT_MIN = 0.5;        // below this the bank pauses sending and asks for testnet NEAR       // top an account up below this
const MAX_ACTIONS = 15;     // ft_transfer actions per transaction
const FT_GAS = 15n * 10n ** 12n;
const FEED_MAX = 40;
const DEEDS_NEAR = 2.9;   // storage for the deeds (NFT) contract, ~250 KB
const MINT_NEAR = 0.05;   // storage for one deed; what is not used comes back
const DEED_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#3a2a1e"/><path d="M8 18 16 10l8 8v7H8z" fill="#e8642c"/><rect x="14" y="20" width="4" height="5" fill="#f6c34a"/></svg>');

const ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#3a2a1e"/>' +
  '<path d="M16 5c3 5 7 7 7 13a7 7 0 0 1-14 0c0-4 2-6 3-9 1 3 2 4 4 4-1-3-1-5 0-8z" fill="#e8642c"/>' +
  '<path d="M16 15c2 3 3 4 3 6a3 3 0 0 1-6 0c0-2 1-3 3-6z" fill="#f6c34a"/></svg>');

export function tokenMetadata() {
  return { spec: 'ft-1.0.0', name: 'Emberwick', symbol: 'EMWK', icon: ICON, reference: null, reference_hash: null, decimals: DECIMALS };
}

// ---------- the bridge (pure logic; talks to NEAR through an adapter) ----------

export class Bridge {
  /**
   * @param {object} o
   * @param {object} o.adapter   chain operations (see makeNearAdapter)
   * @param {string[]} o.npcIds  craftsman ids
   * @param {number} o.totalSupply total EMWK supply
   * @param {function} o.balances returns the game's balances object { holder: amount }
   * @param {function} o.names   holder -> readable name for the activity feed
   * @param {object} o.store     { load(): object|null, save(obj) }
   * @param {function} [o.say]   logger
   * @param {object} [o.wasm]    token contract bytes
   */
  constructor(o) {
    Object.assign(this, { adapter: o.adapter, npcIds: o.npcIds, totalSupply: o.totalSupply, balances: o.balances, names: o.names || ((h) => h), store: o.store, say: ((f) => { let last = '', at = 0; return (m) => { const now = Date.now(); if (m === last && now - at < 10 * 60000) return; last = m; at = now; f(m); }; })(o.say || (() => {})), wasm: o.wasm });
    this.status = 'starting';
    this.detail = null;
    this.queue = [];
    this.feed = [];
    this.chainBalances = {};
    this.needReconcile = true;
    this.busy = false;
    this.txCount = 0;
    this.keys = this.store.load();
    this.nftWasm = o.nftWasm || null;
    this.deeds = { status: 'off', detail: null };
    this.deedQueue = [];
    this.onDeed = o.onDeed || (() => {});
  }

  // ---- land deeds: an NFT contract next to the token ----
  get deedsId() { return this.root && 'deeds.' + this.root; }
  mintDeed(d) { this.deedQueue.push({ kind: 'mint', ...d }); }
  // who holds a deed NFT on chain right now (used to check a deed is in the bank's escrow before it is sold)
  async deedOwner(tokenId) { return this.adapter.nftOwner && this.root ? this.adapter.nftOwner(this.deedsId, tokenId) : null; }
  moveDeed(d) { this.deedQueue.push({ kind: 'move', ...d }); }

  async setupDeeds() {
    const A = this.adapter;
    if (!this.nftWasm || !A.isNftReady) return;
    if (await A.isNftReady(this.deedsId)) { this.deeds = { status: 'ready', detail: null }; return; }
    if (!(await A.exists(this.deedsId))) {
      const bal = await A.nearBalance(this.root);
      if (bal < DEEDS_NEAR + 0.3) {
        this.deeds = { status: 'need-funds', detail: { address: this.root, amount: Math.ceil(DEEDS_NEAR + 0.5 - bal) } };
        return;
      }
      await A.createSub(this.root, this.deedsId, A.publicKeyOf(this.keys.secretKey), DEEDS_NEAR);
      await this.waitFor(this.deedsId);
    }
    if (!(await A.hasCode(this.deedsId))) await A.deploy(this.deedsId, this.nftWasm);
    await A.call(this.deedsId, this.deedsId, 'new', {
      owner_id: this.root,
      metadata: { spec: 'nft-1.0.0', name: 'Emberwick Land Deeds', symbol: 'EMWKDEED', icon: DEED_ICON, base_uri: null, reference: null, reference_hash: null },
    }, 0);
    this.say(`Land deeds contract deployed: ${this.deedsId}`);
    this.deeds = { status: 'ready', detail: null };
  }

  async sendDeeds() {
    const A = this.adapter;
    while (this.deedQueue.length) {
      const d = this.deedQueue[0];
      const entry = { at: Date.now(), from: this.root, items: [{ to: d.owner, amount: 0, label: d.kind === 'mint' ? 'deed' : 'deed move', deed: d.tokenId, plot: d.plot }], hash: null, ok: false };
      try {
        if (d.kind === 'mint') {
          entry.hash = await A.callTx(this.root, this.deedsId, 'nft_mint', {
            token_id: d.tokenId, token_owner_id: d.owner,
            token_metadata: { title: d.title, description: d.description, media: DEED_ICON, copies: 1, issued_at: String(Date.now()) },
          }, nearToYocto(MINT_NEAR));
        } else {
          entry.hash = await A.callTx(this.root, this.deedsId, 'nft_transfer', { receiver_id: d.owner, token_id: d.tokenId, memo: 'Emberwick: deed to its owner' }, 1n);
        }
        entry.ok = true;
        this.txCount++;
        this.onDeed(d.plot, { minted: true, owner: d.owner, contract: this.deedsId, hash: entry.hash });
        this.say(`Deed ${d.tokenId} ${d.kind === 'mint' ? 'minted for' : 'moved to'} ${d.owner}`);
      } catch (e) {
        entry.error = String(e.message || e).slice(0, 160);
        this.say('Deed failed: ' + entry.error);
        this.feed.unshift(entry);
        return; // try again on the next pass
      }
      this.deedQueue.shift();
      this.feed.unshift(entry);
      this.feed.length = Math.min(this.feed.length, FEED_MAX);
    }
  }

  // --- names on chain ---
  get root() { return this.keys && this.keys.root; }
  get tokenId() { return this.root && (this.keys.token || 'emwk.' + this.root); }
  subId(name) { return `${name}.${this.root}`; }
  chainOf(holder) {
    if (holder === 'withdrawn') return null;
    if (holder.startsWith('npc:')) return this.subId(holder.slice(4));
    if (holder === 'treasury') return this.subId('treasury');
    if (holder === 'deposits') return this.subId('deposits'); // rent deposits are held apart, so they show on chain
    return this.root; // players, bots and the village funds live in the village bank
  }
  subAccounts() { return ['treasury', 'deposits', ...this.npcIds].map((n) => this.subId(n)); }

  // --- game hooks ---
  onTransfer(from, to, amount, note = null) {
    if (this.status !== 'ready') { if (note && note.ref) this.noteRef(note.ref, 'sync'); return; } // reconcile catches up once the bridge is live
    const a = this.chainOf(from), b = this.chainOf(to);
    if (!a || !b || a === b || amount <= 0) { if (note && note.ref) this.noteRef(note.ref, 'internal'); return; }
    const player = from.startsWith('player:') ? from.slice(7) : to.startsWith('player:') ? to.slice(7) : null;
    this.queue.push({ from: a, to: b, amount: toUnits(amount), label: `${this.names(from)} → ${this.names(to)}`, player, who: { from, to, fromName: this.names(from), toName: this.names(to) }, memo: note && note.memo, contract: note && note.contract, council: note && note.council, aiPlan: note && note.aiPlan, refs: note && note.ref ? [note.ref] : [] });
  }

  // which NEAR transaction carried a game transfer (by its ledger number); 'netted' when it cancelled out
  noteRef(ref, hash) {
    this.refHash = this.refHash || new Map();
    this.refHash.set(ref, hash);
    if (this.refHash.size > 8000) this.refHash.delete(this.refHash.keys().next().value);
  }
  txOf(ref) { return this.refHash ? this.refHash.get(ref) || null : null; }

  canWithdraw() { return this.status === 'ready'; }

  // a player sent EMWK from their own wallet to the village bank: check it on chain
  async checkDeposit(hash, wallet, expectMemo = null) {
    const t = await this.adapter.readFtTransfer(hash, wallet);
    if (t.signer !== wallet) throw new Error('signed by another account');
    if (t.contract !== this.tokenId) throw new Error('not the EMWK token');
    if (t.receiver !== this.root) throw new Error('not sent to the village bank');
    const memo = String(t.memo || '');
    if (expectMemo && memo && !memo.includes(expectMemo)) throw new Error('memo names another player');
    return { amount: fromUnits(t.amount), memoOk: !expectMemo || memo.includes(expectMemo) };
  }
  withdraw(wallet, amount, who, player = null) {
    this.queue.push({ from: this.root, to: wallet, amount: toUnits(amount), label: `${who} → ${wallet}`, withdraw: true, player, who: { from: player ? 'player:' + player : 'bank', to: 'wallet', fromName: who, toName: wallet } });
  }

  // EMWK on its way into (+) or out of (-) an account: queued, or being sent and not yet confirmed
  inFlight(id) {
    let n = 0n;
    for (const it of [...this.queue, ...(this.sending || [])]) {
      if (it.done) continue;
      if (it.to === id) n += it.amount;
      if (it.from === id) n -= it.amount;
    }
    return fromUnits(n);
  }

  view() {
    const accounts = this.root ? {
      bank: this.root, token: this.tokenId, treasury: this.subId('treasury'), deposits: this.subId('deposits'),
      npcs: Object.fromEntries(this.npcIds.map((id) => [id, this.subId(id)])),
    } : null;
    return {
      network: NET.networkId, explorer: NET.explorer, wallet: NET.wallet,
      status: this.status, detail: this.detail, accounts,
      balances: this.chainBalances, feed: this.feed.slice(0, FEED_MAX), pending: this.queue.length, txCount: this.txCount,
      deeds: { ...this.deeds, contract: this.root ? this.deedsId : null, pending: this.deedQueue.length },
      lowGas: this.lowGas ? { address: this.lowGas.address } : null,
    };
  }

  // --- setup: creates every account and the token, safe to run again ---
  async setup() {
    const A = this.adapter;
    if (!this.keys) {
      this.keys = { secretKey: A.newSecretKey(), root: null, created: Date.now() };
      this.store.save(this.keys);
    }
    const pk = A.publicKeyOf(this.keys.secretKey);
    const implicitId = A.implicitOf(pk);
    this.status = 'setup';

    // 1. the village bank (root account)
    if (!this.root || !(await A.exists(this.root))) {
      const name = this.root || (await this.freeName());
      this.detail = { step: 'root', account: name };
      let made = false;
      if (!this.faucetTried) {
        this.faucetTried = true; // the faucet is rate limited, ask it once per run
        try {
          await A.faucet(name, pk);
          made = await this.waitFor(name);
        } catch (e) {
          this.say('Testnet faucet did not create the account: ' + e.message);
        }
      }
      if (!made) {
        const bal = await A.nearBalance(implicitId);
        if (bal < ROOT_MIN_SETUP + 0.5) {
          this.status = 'need-funds';
          this.detail = { address: implicitId, amount: Math.ceil(ROOT_MIN_SETUP + 1 - bal), have: bal };
          return false;
        }
        await A.createTopLevel(implicitId, name, pk, bal - 0.2);
        made = await this.waitFor(name);
        if (!made) throw new Error('could not create ' + name);
      }
      this.keys.root = name;
      this.store.save(this.keys);
      this.say(`Village bank on NEAR: ${name}`);
    }

    // The first EMWK contract (near-sdk 3) did not emit NEP-297 events, so explorers
    // and wallets could not see transfers. Version 2 (near-contract-standards 4) does.
    // An older village moves to a fresh token account; balances follow by reconcile.
    if (this.keys.tokenVersion !== 2) {
      const legacy = await A.exists('emwk.' + this.root) && !this.keys.token;
      this.keys.token = legacy ? 'token.' + this.root : 'emwk.' + this.root;
      this.keys.tokenVersion = 2;
      this.store.save(this.keys);
      if (legacy) this.say(`Moving EMWK to a new token contract with events: ${this.keys.token}`);
    }

    // 2. enough NEAR for the rest?
    const tokenExists = await A.exists(this.tokenId);
    if (!tokenExists) {
      // NEAR needed: token storage, plus gas money for any account not created yet
      let missing = 0;
      for (const id of this.subAccounts()) if (!(await A.exists(id))) missing++;
      const need = TOKEN_NEAR + 0.3 + missing * SUB_NEAR;
      const bal = await A.nearBalance(this.root);
      if (bal < need) {
        this.status = 'need-funds';
        this.detail = { address: this.root, amount: Math.ceil(need + 0.2 - bal), have: bal };
        return false;
      }
      this.status = 'setup';
      this.detail = { step: 'token', account: this.tokenId };
      await A.createSub(this.root, this.tokenId, pk, TOKEN_NEAR);
      await this.waitFor(this.tokenId);
    }

    // 3. token contract code + init
    this.detail = { step: 'contract', account: this.tokenId };
    if (!(await A.hasCode(this.tokenId))) await A.deploy(this.tokenId, this.wasm);
    if (!(await A.isTokenReady(this.tokenId))) {
      await A.call(this.tokenId, this.tokenId, 'new', { owner_id: this.root, total_supply: toUnits(this.totalSupply).toString(), metadata: tokenMetadata() }, 0);
      this.say(`EMWK token deployed: ${this.tokenId}`);
    }

    // 4. craftsman and treasury accounts
    for (const id of this.subAccounts()) {
      if (await A.exists(id)) continue;
      this.detail = { step: 'accounts', account: id };
      await A.createSub(this.root, id, pk, SUB_NEAR);
      this.say(`Created ${id}`);
    }

    // 5. register them with the token
    this.detail = { step: 'register' };
    const missing = [];
    for (const id of this.subAccounts()) if (!(await A.isRegistered(this.tokenId, id))) missing.push(id);
    if (missing.length) await A.register(this.root, this.tokenId, missing);

    this.status = 'ready';
    this.detail = null;
    this.needReconcile = true;
    this.say('NEAR bridge is live.');
    return true;
  }

  async freeName() {
    for (const n of ROOT_NAMES) {
      const id = `${n}.${NET.networkId}`;
      if (!(await this.adapter.exists(id))) return id;
    }
    return `emberwick-${Date.now().toString(36)}.${NET.networkId}`;
  }

  async waitFor(id, tries = 15) {
    for (let i = 0; i < tries; i++) {
      if (await this.adapter.exists(id)) return true;
      await sleep(this.adapter.pollMs ?? 2000);
    }
    return false;
  }

  // what each chain account should hold, from the game ledger
  expected() {
    const exp = {};
    for (const id of this.subAccounts()) exp[id] = 0n;
    let out = 0n;
    for (const [holder, amt] of Object.entries(this.balances())) {
      const c = this.chainOf(holder);
      if (!c) { out += toUnits(amt); continue; }
      if (c !== this.root) exp[c] = (exp[c] || 0n) + toUnits(amt);
    }
    let rest = toUnits(this.totalSupply) - out;
    for (const id of this.subAccounts()) rest -= exp[id];
    exp[this.root] = rest; // the bank holds everything else
    return exp;
  }

  // compare chain to game, then send corrections from/to the bank
  async reconcile() {
    const A = this.adapter;
    const exp = this.expected();
    this.queue = []; // everything queued so far is already inside `exp`
    const fixes = [];
    for (const id of this.subAccounts()) {
      const have = await A.ftBalance(this.tokenId, id);
      this.chainBalances[id] = fromUnits(have);
      const diff = exp[id] - have;
      if (diff > 0n) fixes.push({ from: this.root, to: id, amount: diff, label: 'balance sync' });
      if (diff < 0n) fixes.push({ from: id, to: this.root, amount: -diff, label: 'balance sync' });
    }
    // gas top-ups for accounts that are running low
    for (const id of this.subAccounts()) {
      if ((await A.nearBalance(id)) < LOW_GAS && (await A.nearBalance(this.root)) >= ROOT_MIN + TOPUP_NEAR) await A.sendNear(this.root, id, TOPUP_NEAR);
    }
    await this.sendGroups(fixes);
    for (const id of [this.root, ...this.subAccounts()]) this.chainBalances[id] = fromUnits(await A.ftBalance(this.tokenId, id));
    this.needReconcile = false;
  }

  // net the queue (A->B 5 and B->A 3 becomes A->B 2) and send one tx per sender
  netQueue(items) {
    const pair = new Map();
    const withdrawals = [];
    for (const it of items) {
      if (it.withdraw || it.memo) { withdrawals.push(it); continue; } // never merge transfers that carry a record
      // a player's own transfers are kept apart, so they can find them on chain
      const [x, y, s] = it.from < it.to ? [it.from, it.to, 1n] : [it.to, it.from, -1n];
      const k = x + '|' + y + '|' + (it.player || '');
      const p = pair.get(k) || { x, y, amt: 0n, n: 0, labels: new Set(), player: it.player || null, who: it.who, refs: [] };
      p.amt += s * it.amount; p.n++; p.labels.add(it.label); p.who = it.who; p.refs.push(...(it.refs || []));
      pair.set(k, p);
    }
    const out = [];
    for (const p of pair.values()) {
      if (p.amt === 0n) { for (const r of p.refs) this.noteRef(r, 'netted'); continue; }
      const fwd = p.amt > 0n;
      const label = p.labels.size === 1 ? [...p.labels][0] : `${p.n} trades`;
      out.push({ from: fwd ? p.x : p.y, to: fwd ? p.y : p.x, amount: fwd ? p.amt : -p.amt, label, n: p.n, player: p.player, who: p.labels.size === 1 ? p.who : null, refs: p.refs });
    }
    return [...out, ...withdrawals];
  }

  async sendGroups(list) {
    const bySender = new Map();
    for (const it of list) {
      if (!bySender.has(it.from)) bySender.set(it.from, []);
      bySender.get(it.from).push(it);
    }
    for (const [from, items] of bySender) {
      for (let i = 0; i < items.length; i += MAX_ACTIONS) {
        const chunk = items.slice(i, i + MAX_ACTIONS);
        const entry = { at: Date.now(), from, items: chunk.map((c) => ({ to: c.to, amount: fromUnits(c.amount), label: c.label, withdraw: !!c.withdraw, player: c.player || null, n: c.n || 1, who: c.who || null, contract: c.contract || null, council: c.council || null, aiPlan: c.aiPlan || null, memo: c.memo || null })), hash: null, ok: false };
        try {
          const wallets = chunk.filter((c) => c.withdraw).map((c) => c.to);
          entry.hash = await this.adapter.ftTransfers(from, this.tokenId, chunk.map((c) => ({ to: c.to, amount: c.amount, memo: c.memo || c.label })), wallets);
          entry.ok = true;
          this.txCount++;
          for (const c of chunk) for (const r of c.refs || []) this.noteRef(r, entry.hash);
          for (const c of chunk) { // keep the shown on-chain balances fresh between syncs
            c.done = true;
            const v = fromUnits(c.amount);
            if (from in this.chainBalances) this.chainBalances[from] = Math.round((this.chainBalances[from] - v) * 100) / 100;
            if (c.to in this.chainBalances) this.chainBalances[c.to] = Math.round((this.chainBalances[c.to] + v) * 100) / 100;
          }
        } catch (e) {
          entry.error = String(e.message || e).slice(0, 160);
          this.needReconcile = true;
          // the village bank has no NEAR left for gas: stop and wait for a top-up instead of failing over and over
          // "Sender X does not have enough balance ... for operation costing ..." means no NEAR for gas. The token
          // contract's "The account doesn't have enough balance" is about EMWK, not gas: a sync fixes that, no pause.
          if (/does not have enough balance|for operation costing|Not enough balance for|NotEnoughBalance|LackBalanceForState/i.test(String(e.message || e))) {
            // which account ran short? a craftsman's own account gets a gas top-up from the bank right away;
            // only the bank itself running short pauses sending until someone sends it testnet NEAR
            const msg = String(e.message || e), poor = (msg.match(/[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.testnet/g) || []).find((a) => a !== this.root && this.subAccounts().includes(a));
            if (poor && from === poor) {
              try {
                if ((await this.adapter.nearBalance(this.root)) >= ROOT_MIN + TOPUP_NEAR) {
                  await this.adapter.sendNear(this.root, poor, TOPUP_NEAR);
                  this.say(`NEAR: ${poor} was low on gas; the bank sent it ${TOPUP_NEAR} testnet NEAR.`);
                  this.feed.unshift(entry);
                  return;
                }
              } catch { /* fall through to the pause below */ }
            }
            if (!this.lowGas) this.say(`NEAR: ${this.root} is out of testnet NEAR for gas. Send it a few testnet NEAR; sending is paused until then.`);
            this.lowGas = { address: this.root, at: Date.now() };
            this.feed.unshift(entry);
            return;
          }
          this.say('NEAR transfer failed: ' + entry.error);
        }
        this.feed.unshift(entry);
        this.feed.length = Math.min(this.feed.length, FEED_MAX);
      }
    }
  }

  // one pass of the loop: setup, then reconcile or flush
  async step() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.status !== 'ready') {
        await this.setup();
        if (this.status !== 'ready') return;
      }
      if (this.lowGas) { // paused: look again every two minutes whether someone sent NEAR
        if (Date.now() - this.lowGas.at < 120000) return;
        const bal = await this.adapter.nearBalance(this.root);
        if (bal < ROOT_MIN) { this.lowGas = { address: this.root, at: Date.now(), balance: bal }; return; }
        this.lowGas = null; this.needReconcile = true;
        this.say('NEAR: gas money arrived, sending again.');
      }
      if (this.deeds.status !== 'ready') { try { await this.setupDeeds(); } catch (e) { this.deeds = { status: 'error', detail: { message: String(e.message || e).slice(0, 160) } }; } }
      if (this.deeds.status === 'ready' && this.deedQueue.length) await this.sendDeeds();
      if (this.needReconcile) { await this.reconcile(); return; }
      if (!this.queue.length) return;
      const items = this.queue.splice(0);
      this.sending = this.netQueue(items);
      try { await this.sendGroups(this.sending); } finally { this.sending = null; }
    } catch (e) {
      this.say('NEAR: ' + (e.message || e));
      if (this.status === 'ready') this.needReconcile = true;
      else { this.status = 'error'; this.detail = { message: String(e.message || e).slice(0, 200) }; }
    } finally {
      this.busy = false;
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the real NEAR adapter (near-api-js) ----------

export async function makeNearAdapter(secretKeyRef) {
  const near = await import('near-api-js');
  const { RpcError } = await import('near-api-js/rpc-errors');
  const { Account, JsonRpcProvider, FailoverRpcProvider, KeyPair, KeyPairSigner, actions, keyToImplicitAddress } = near;
  // Try the next RPC server only when one is unreachable; real answers
  // (like "this account does not exist") come straight back, without noise.
  class QuietFailover extends FailoverRpcProvider {
    async withBackoff(getResult) {
      let last;
      for (let i = 0; i < this.providers.length; i++) {
        try { return await getResult(this.currentProvider); } catch (e) {
          if (e instanceof RpcError) throw e;
          last = e;
          this.switchToNextProvider();
        }
      }
      throw new Error('NEAR testnet is not reachable (' + String(last && (last.cause?.code || last.message)) + ')');
    }
  }
  const provider = new QuietFailover(NET.rpcs.map((url) => new JsonRpcProvider({ url })));
  const accounts = new Map();
  const acct = (id) => {
    if (!accounts.has(id)) accounts.set(id, new Account(id, provider, new KeyPairSigner(KeyPair.fromString(secretKeyRef()))));
    return accounts.get(id);
  };
  const missing = (e) => (e && e.name === 'AccountDoesNotExistError') || /account .* does(n't| not) exist/i.test(String(e && e.message));
  const view = (contractId, method, args) => provider.callFunction({ contractId, method, args });

  return {
    newSecretKey: () => KeyPair.fromRandom('ed25519').toString(),
    publicKeyOf: (sk) => KeyPair.fromString(sk).getPublicKey().toString(),
    implicitOf: (pk) => keyToImplicitAddress(pk),

    async exists(id) {
      try { await provider.viewAccount({ accountId: id }); return true; } catch (e) { if (missing(e)) return false; throw e; }
    },
    async nearBalance(id) {
      try { const v = await provider.viewAccount({ accountId: id }); return yoctoToNear(BigInt(v.amount)); } catch (e) { if (missing(e)) return 0; throw e; }
    },
    async hasCode(id) {
      const v = await provider.viewAccount({ accountId: id });
      return v.code_hash && v.code_hash !== '11111111111111111111111111111111';
    },
    async isTokenReady(id) {
      // a contract that is deployed but not initialised answers with an error
      try { const m = await view(id, 'ft_metadata', {}); return !!(m && m.symbol); } catch (e) { if (e instanceof RpcError) return false; throw e; }
    },
    async nftOwner(contractId, tokenId) {
      try { const t = await view(contractId, 'nft_token', { token_id: tokenId }); return t ? t.owner_id : null; } catch (e) { if (e instanceof RpcError) return null; throw e; }
    },
    async isNftReady(id) {
      try { const m = await view(id, 'nft_metadata', {}); return !!(m && m.symbol); } catch (e) { if (e instanceof RpcError) return false; throw e; }
    },
    async callTx(signerId, contractId, methodName, args, depositYocto) {
      const r = await acct(signerId).signAndSendTransaction({ receiverId: contractId, actions: [actions.functionCall(methodName, args, 100n * 10n ** 12n, BigInt(depositYocto))] });
      return (r && r.transaction && r.transaction.hash) || (r && r.transaction_outcome && r.transaction_outcome.id) || null;
    },
    async isRegistered(tokenId, id) {
      return !!(await view(tokenId, 'storage_balance_of', { account_id: id }));
    },
    async ftBalance(tokenId, id) {
      return BigInt(await view(tokenId, 'ft_balance_of', { account_id: id }) || 0);
    },

    async faucet(name, pk) {
      const r = await fetch(NET.helper, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newAccountId: name, newAccountPublicKey: pk }) });
      if (!r.ok) throw new Error(`faucet ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`);
    },
    async createTopLevel(fromId, name, pk, nearAmount) {
      await acct(fromId).createAccount({ newAccountId: name, publicKey: pk, nearToTransfer: nearToYocto(nearAmount) });
    },
    async createSub(parentId, id, pk, nearAmount) {
      await acct(parentId).createSubAccount({ accountOrPrefix: id, publicKey: pk, nearToTransfer: nearToYocto(nearAmount) });
    },
    async deploy(id, wasm) { await acct(id).deployContract(new Uint8Array(wasm)); },
    async call(signerId, contractId, methodName, args, depositNear) {
      await acct(signerId).callFunction({ contractId, methodName, args, gas: 100n * 10n ** 12n, deposit: nearToYocto(depositNear) });
    },
    async register(signerId, tokenId, ids) {
      let bound = nearToYocto(0.0125);
      try { const b = await view(tokenId, 'storage_balance_bounds', {}); if (b && b.min) bound = BigInt(b.min); } catch { /* keep default */ }
      await acct(signerId).signAndSendTransaction({
        receiverId: tokenId,
        actions: ids.map((id) => actions.functionCall('storage_deposit', { account_id: id, registration_only: true }, 10n * 10n ** 12n, bound)),
      });
    },
    async sendNear(fromId, toId, nearAmount) {
      await acct(fromId).signAndSendTransaction({ receiverId: toId, actions: [actions.transfer(nearToYocto(nearAmount))] });
    },
    // NEP-413: did this account really sign our message? (wallet sign-in proof)
    // Wallets differ in small details (base64 or base58 signature, a callback URL
    // inside the signed payload), so every honest variant is tried. Any match is a
    // real signature by a full-access key of that account.
    async verifySigned({ accountId, publicKey, signature, message, recipient, nonce, callbackUrls = [] }) {
      const { verifyMessage } = await import('near-api-js/nep413');
      const sigs = [];
      try { sigs.push(new Uint8Array(Buffer.from(signature, 'base64'))); } catch { /* not base64 */ }
      try { sigs.push(near.baseDecode(signature)); } catch { /* not base58 */ }
      const nonceBytes = new Uint8Array(Buffer.from(nonce, 'base64'));
      let last = null;
      for (const sig of sigs.filter((x) => x.length === 64)) {
        for (const cb of [undefined, ...callbackUrls]) {
          try {
            await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, provider, payload: { message, recipient, nonce: nonceBytes, callbackUrl: cb }, signature: sig });
            return true;
          } catch (e) {
            last = e;
            if (!/verification failed/i.test(e.message)) throw e; // key missing or not full access
          }
        }
      }
      throw last || new Error('bad signature');
    },
    // read a player's own ft_transfer from the chain: who sent how much to whom
    async readFtTransfer(hash, senderId) {
      const r = await provider.viewTransactionStatus({ txHash: hash, accountId: senderId, waitUntil: 'FINAL' });
      const tx = r.transaction || {};
      const failed = (st) => st && typeof st === 'object' && 'Failure' in st;
      if (failed(r.status) || (r.receipts_outcome || []).some((o) => failed(o.outcome && o.outcome.status))) throw new Error('transaction failed');
      const fc = (tx.actions || []).map((a) => a.FunctionCall || a.functionCall).find((f) => f && (f.method_name || f.methodName) === 'ft_transfer');
      if (!fc) throw new Error('not an ft_transfer');
      const args = JSON.parse(Buffer.from(fc.args, 'base64').toString('utf8'));
      return { signer: tx.signer_id, contract: tx.receiver_id, receiver: args.receiver_id, amount: BigInt(args.amount), memo: args.memo || '' };
    },
    // several ft_transfer calls in one transaction; wallets get registered first
    async ftTransfers(fromId, tokenId, items, wallets = []) {
      let bound = nearToYocto(0.0125);
      if (wallets.length) {
        try { const b = await view(tokenId, 'storage_balance_bounds', {}); if (b && b.min) bound = BigInt(b.min); } catch { /* keep default */ }
      }
      const acts = [
        ...[...new Set(wallets)].map((w) => actions.functionCall('storage_deposit', { account_id: w, registration_only: true }, 10n * 10n ** 12n, bound)),
        ...items.map((it) => actions.functionCall('ft_transfer', { receiver_id: it.to, amount: it.amount.toString(), memo: String(it.memo || '').slice(0, 240) }, FT_GAS, 1n)),
      ];
      const r = await acct(fromId).signAndSendTransaction({ receiverId: tokenId, actions: acts });
      return (r && r.transaction && r.transaction.hash) || (r && r.transaction_outcome && r.transaction_outcome.id) || null;
    },
  };
}

// ---------- wiring for the server ----------

export function fileStore(file) {
  return {
    load() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    save(obj) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    },
  };
}
