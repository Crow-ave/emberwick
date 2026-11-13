// Emberwick game server. Run `npm install` once, then `npm start`.
// The NEAR bridge is optional: without it (or offline) the game still runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { markSeen, ledgerWritten, deedFollowsChain, awaySummary, giveSeal, createState, ensureContracts, moneyHistory, transfer, addLog, aiBrief, applyAiPlan, shopCard, creditPolicy, giveCredit, commissionPolicy, villageDirectory, customerBrief, checkAiActions, weekSnapshot, weekSummary, tick, setOracle, lockedFunds, balance, joinPlayer, playerAction, publicView, onTransfer, onGameEvent, linkWallet, withdraw, depositIn, setDeed } from './economy.js';
import crypto from 'node:crypto';
import { BUILDINGS, GOODS, START_PATHS, RULES, TOKEN, PATH_ROUTE, CRAFTSMEN } from './world.js';
import { Bridge, makeNearAdapter, fileStore } from './near.js';
import { ai, startAi, planDay, askCraftsman, haggleLine, aiPublic, aiProof, PROOFS_KEPT, fetchAttestation, readSwapCommand, addressesIn } from './ai.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------- system log: the last [NEAR] and [AI] lines, so players can see them in the game ----------
const sysLog = [];
const SYS_MAX = 80;
{
  const orig = console.log.bind(console);
  console.log = (...args) => {
    orig(...args);
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      const m = /^\[(NEAR|AI)\]\s*/.exec(text);
      if (!m) return;
      const clean = text.slice(m[0].length).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{20,}/g, 'ed25519:…').replace(/\n\[(NEAR|AI)\]\s*/g, ' ').slice(0, 300);
      sysLog.unshift({ at: Date.now(), src: m[1], text: clean });
      if (sysLog.length > SYS_MAX) sysLog.length = SYS_MAX;
    } catch { /* never break logging */ }
  };
}
let bankNear = { at: 0, value: null };
async function bankBalance() {
  if (!bridge || !bridge.root || !bridge.adapter) return null;
  if (Date.now() - bankNear.at < 30000) return bankNear.value;
  try { bankNear = { at: Date.now(), value: await bridge.adapter.nearBalance(bridge.root) }; } catch { bankNear.at = Date.now(); }
  return bankNear.value;
}
const PUBLIC = path.join(root, 'public');
const SAVE = process.env.EMBERWICK_SAVE || path.join(root, 'data', 'state.json'); // a second village (e.g. for the online demo) can keep its own save
// the last signed NEAR AI answers are kept next to the save, so a server restart does not empty /api/ai/proof
const deedHolders = new Map(); // tokenId -> { at, owner } read from the deed contract
const PROOFS_FILE = path.join(path.dirname(SAVE), 'ai-proofs.json');
try { const kept = JSON.parse(fs.readFileSync(PROOFS_FILE, 'utf8')); if (Array.isArray(kept)) ai.proofs = kept.slice(0, PROOFS_KEPT); } catch {}
ai.onProof = (list) => { try { fs.mkdirSync(path.dirname(PROOFS_FILE), { recursive: true }); fs.writeFileSync(PROOFS_FILE + '.tmp', JSON.stringify(list)); fs.renameSync(PROOFS_FILE + '.tmp', PROOFS_FILE); } catch (e) { console.log('[AI] could not keep the proofs:', e.message); } };
const PORT = Number(process.env.PORT) || 3000;

let state;
try {
  state = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
  ensureContracts(state); // bring older saves up to date (new shops, plots, council)
  for (const x of state.realSwaps || []) if (x.status === 'SUCCESS' && giveSeal(state, x.player, x.batch || x.depositAddress)) x.sealGiven = true; // real swaps made before seals existed
  if (state.ff) state.ff.running = false; // a fast-forward cut off by a restart just stops
  console.log(`Loaded saved village (day ${state.day}).`);
} catch {
  state = createState();
  console.log('Started a new village.');
}
// villagers who joined before player keys can claim theirs during three days after the first start with keys
if (!state.claimUntil) state.claimUntil = Date.now() + 3 * 24 * 3600 * 1000;

// ---------- NEAR bridge ----------
let bridge = null;
// Secret keys live outside the project folder, so they can never end up on GitHub.
const KEYS = process.env.EMBERWICK_KEYS || path.join(os.homedir(), '.emberwick', 'near-keys.json');
async function startNear() {
  if (process.env.EMBERWICK_NEAR === '0') return console.log('NEAR bridge is off (EMBERWICK_NEAR=0).');
  // keys come from a file outside the project, or (on a host like Render) from the secret environment
  // variable EMBERWICK_KEYS_JSON; they are never printed
  let envKeys = null;
  if (process.env.EMBERWICK_KEYS_JSON) { try { envKeys = JSON.parse(process.env.EMBERWICK_KEYS_JSON); } catch { console.log('[NEAR] EMBERWICK_KEYS_JSON is not valid JSON: check that the whole file was pasted.'); } }
  const store = process.env.EMBERWICK_NEAR === 'fake' ? { load: () => null, save: () => {} }
    : envKeys ? { load: () => envKeys, save: (o) => { if (o.secretKey !== envKeys.secretKey) console.log('[NEAR] warning: the bank key changed; the key in EMBERWICK_KEYS_JSON is no longer used.'); envKeys = o; } }
    : fileStore(KEYS);
  let adapter;
  try {
    if (process.env.EMBERWICK_NEAR === 'fake') { adapter = (await import('./fakechain.js')).fakeChain({ faucetWorks: true, faucetNear: 20 }); adapter.pollMs = 0; adapter.acc.set('emberwick.testnet', { near: 5 }); }
    else adapter = await makeNearAdapter(() => bridge.keys.secretKey);
  } catch {
    return console.log('NEAR bridge is off: run `npm install` once to turn it on.');
  }
  const names = (h) => {
    if (h.startsWith('npc:')) return CRAFTSMEN.find((c) => c.id === h.slice(4))?.name || h;
    if (h.startsWith('player:')) return state.players[h.slice(7)]?.name || 'player';
    if (h.startsWith('bot:')) return state.bots[h.slice(4)]?.name || 'villager';
    return { treasury: 'Treasury', newcomerFund: 'Newcomer fund', adventurerFund: 'Adventurer fund', botFund: 'Villagers', deposits: 'Rent deposits', withdrawn: 'NEAR wallet' }[h] || h;
  };
  bridge = new Bridge({
    adapter, store, names,
    npcIds: CRAFTSMEN.map((c) => c.id),
    totalSupply: TOKEN.totalSupply,
    balances: () => state.balances,
    wasm: fs.readFileSync(path.join(root, 'contracts', 'emwk_token.wasm')),
    nftWasm: fs.readFileSync(path.join(root, 'contracts', 'emwk_deeds.wasm')),
    onDeed: (plot, info) => { setDeed(state, plot, info); save(); broadcast(); },
    ledgerWasm: fs.existsSync(path.join(root, 'contracts', 'emwk_ledger.wasm')) ? fs.readFileSync(path.join(root, 'contracts', 'emwk_ledger.wasm')) : null,
    onLedger: (e, tx) => { ledgerWritten(state, e, tx); save(); },
    say: (m) => console.log('[NEAR] ' + m),
  });
  onTransfer((from, to, amount, note) => bridge.onTransfer(from, to, amount, note));
  // a land deed goes to the buyer's wallet, or is held by the village bank until they link one
  onGameEvent((type, d) => {
    if (type === 'deedMove') { // a deed sold on the exchange: from the bank's escrow to the buyer's wallet
      if (bridge.root && (d.wallet || d.toBank)) bridge.moveDeed({ plot: d.plot, tokenId: d.tokenId, owner: d.toBank ? bridge.root : d.wallet });
      return;
    }
    if (type !== 'deed' || !bridge.root) return;
    bridge.mintDeed({ plot: d.plot, tokenId: d.tokenId, owner: d.wallet || bridge.root, title: `Emberwick land deed: ${d.plot}`, description: `Plot ${d.plot} in the village of Emberwick, bought by ${d.name} on game day ${d.day}. Held for player ${d.player}.` });
  });
  let lastStatus = '';
  const loop = async () => {
    await bridge.step();
    // count every transaction this village has sent to NEAR, across restarts
    state.onchain = state.onchain || { tx: 0 };
    if (bridge.txCount > (bridge.counted || 0)) { state.onchain.tx += bridge.txCount - (bridge.counted || 0); bridge.counted = bridge.txCount; }
    state.nearBank = bridge.root || null; // the exchange checks that a deed for sale sits with the bank
    if (bridge.status !== lastStatus) {
      lastStatus = bridge.status;
      if (bridge.status === 'need-funds') {
        const d = bridge.detail;
        console.log(`[NEAR] Needs ${d.amount} testnet NEAR to set up. Send it from your wallet to:\n[NEAR]   ${d.address}`);
      }
      broadcast();
    }
  };
  loop();
  setInterval(loop, RULES.demo ? 8000 : 12000);
  setInterval(() => { if (bridge.status === 'ready') bridge.needReconcile = true; }, 5 * 60 * 1000);
  // each day's records go to the Village Ledger contract (also the ones from before a restart)
  setInterval(() => { if (bridge.ledger.status === 'ready') for (const e of state.ledgerOut || []) bridge.recordLedger(e); }, 10000);
  // the land follows its deed NFT: deeds in players' wallets are looked up on NEAR every two minutes
  // (a deed with the bank only moves when the game moves it, so those are not asked about)
  setInterval(async () => {
    if (bridge.deeds.status !== 'ready' || !bridge.root) return;
    for (const [id, plot] of Object.entries(state.plots || {})) {
      const d = plot.deed;
      if (!plot.owner || !d || !d.minted || !d.owner || d.owner === bridge.root || bridge.deedQueue.some((q) => q.tokenId === d.tokenId)) continue;
      let holder = null;
      try { holder = await bridge.deedOwner(d.tokenId); } catch { continue; }
      if (!holder) continue;
      const r = deedFollowsChain(state, id, holder);
      if (r.changed) { console.log(`[NEAR] ${id}: the deed NFT is now in ${holder}; the land follows it in the game.`); save(); broadcast(); }
    }
  }, 120000);
  // deeds for land bought while NEAR was offline (or before a restart) are minted later
  setInterval(() => {
    if (bridge.deeds.status !== 'ready') return;
    for (const [id, plot] of Object.entries(state.plots || {})) {
      if (!plot.owner || !plot.deed || plot.deed.minted || bridge.deedQueue.some((d) => d.tokenId === plot.deed.tokenId)) continue;
      const p = state.players[plot.owner] || {};
      bridge.mintDeed({ plot: id, tokenId: plot.deed.tokenId, owner: (p.nearVerified && p.near) || bridge.root, title: `Emberwick land deed: ${id}`, description: `Plot ${id} in the village of Emberwick, owned by ${p.name || 'a villager'}. Held for player ${plot.owner}.` });
    }
  }, 10000);
}
const challenges = new Map(); // playerId -> one-time wallet sign-in message
function moveHeldDeeds(pid) {
  const p = state.players[pid];
  if (!bridge || !p || !p.near) return;
  for (const [id, plot] of Object.entries(state.plots || {})) {
    if (plot.owner === pid && plot.deed && plot.deed.minted && plot.deed.owner === bridge.root) bridge.moveDeed({ plot: id, tokenId: plot.deed.tokenId, owner: p.near });
  }
}
const chainView = () => (bridge ? bridge.view() : { status: 'off' });
// a new id every time the server starts: pages that were open before a restart know to start over
const BOOT = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// is every coin the game owes covered by EMWK the village bank really holds on NEAR?
// owed = every game account kept in the bank's NEAR account (players, villagers, newcomer fund ...);
// the treasury, the rent deposits and the craftsmen have NEAR accounts of their own and are not owed by the bank
function solvency() {
  const c = bridge ? bridge.view() : null;
  const b = state.balances, sum = (f) => Math.round(Object.entries(b).filter(([k]) => f(k)).reduce((a, [, v]) => a + v, 0) * 100) / 100;
  // 'withdrawn' is EMWK players cashed out to their own wallets: already paid, not owed by the bank
  const owed = sum((k) => !(k === 'treasury' || k === 'deposits' || k === 'withdrawn' || k.startsWith('npc:'))), players = sum((k) => k.startsWith('player:'));
  const chain = c && c.balances && c.accounts && c.accounts.bank in c.balances ? c.balances[c.accounts.bank] : null;
  // transfers still queued for NEAR: once they land the bank's balance changes by this much
  const onWay = chain === null || !bridge.inFlight ? 0 : Math.round(bridge.inFlight(c.accounts.bank) * 100) / 100;
  const after = chain === null ? null : Math.round((chain + onWay) * 100) / 100;
  return { chain, onWay, after, owed, players, others: Math.round((owed - players) * 100) / 100, ratio: after === null || owed <= 0 ? null : Math.round((after / owed) * 10000) / 10000, pending: c ? c.pending : 0, bank: c && c.accounts ? c.accounts.bank : null, token: c && c.accounts ? c.accounts.token : null };
}
const view = (pid) => ({ ...publicView(state, pid), chain: chainView(), boot: BOOT, ai: aiPublic(), solvency: solvency() });

// ---------- NEAR Intents (1Click API) for the change desk ----------
const ONECLICK = process.env.EMBERWICK_ONECLICK || 'https://1click.chaindefuser.com/v0'; // overridable only for offline tests
const SHOW = [['NEAR', 'near'], ['USDC', 'near'], ['BTC', 'btc'], ['ETH', 'eth'], ['SOL', 'sol']];
let tokenCache = { at: 0, list: null, all: null }, quoteCache = new Map();
// what a player could pay with from another chain (universal checkout preview)
const PAY_FROM = [['USDC-SOL', 'USDC', 'sol'], ['USDC-ETH', 'USDC', 'eth'], ['ETH', 'ETH', 'eth'], ['BTC', 'BTC', 'btc'], ['SOL', 'SOL', 'sol']];
async function getJson(url, opts = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) } });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    if (!r.ok) throw new Error((j && (j.message || j.error)) || `HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(timer); }
}
async function intentsTokens() {
  if (tokenCache.list && Date.now() - tokenCache.at < 60000) return tokenCache.list;
  const all = await getJson(`${ONECLICK}/tokens`);
  const pick = (sym, chain) => all.find((t) => t.symbol === sym && t.blockchain === chain) || (sym === 'NEAR' ? all.find((t) => t.assetId === 'nep141:wrap.near') : null);
  tokenCache = { at: Date.now(), all, list: SHOW.map(([sym, chain]) => [sym, pick(sym, chain)]).filter(([, t]) => t).map(([key, t]) => ({ key, symbol: t.symbol, chain: t.blockchain, assetId: t.assetId, decimals: t.decimals, price: t.price, updated: t.priceUpdatedAt })) };
  return tokenCache.list;
}
async function intentsPrices() {
  try { return { ok: true, source: 'NEAR Intents 1Click API', tokens: await intentsTokens() }; } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120) }; }
}
async function intentsQuote(toSym, amount) {
  try {
    amount = Math.min(1000, Math.max(0.1, amount));
    const key = `${toSym}|${amount}`, hit = quoteCache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.res;
    const list = await intentsTokens();
    const from = list.find((t) => t.key === 'NEAR'), to = list.find((t) => t.key === toSym); // NEAR is listed as wNEAR (wrap.near)
    if (!from || !to || to === from) return { ok: false, error: 'unknown asset' };
    const units = (BigInt(Math.round(amount * 1000)) * 10n ** BigInt(from.decimals)) / 1000n;
    const q = await getJson(`${ONECLICK}/quote`, { method: 'POST', body: JSON.stringify({
      dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100,
      originAsset: from.assetId, depositType: 'INTENTS', destinationAsset: to.assetId, amount: units.toString(),
      refundTo: 'intents.near', refundType: 'INTENTS', recipient: 'intents.near', recipientType: 'INTENTS',
      deadline: new Date(Date.now() + 10 * 60000).toISOString(),
    }) });
    const res = { ok: true, dry: true, from: 'NEAR', to: toSym, chain: to.chain, amountIn: amount, amountOut: q.quote && (q.quote.amountOutFormatted || q.quote.amountOut), usdOut: q.quote && q.quote.amountOutUsd, timeEstimate: q.quote && q.quote.timeEstimate, source: 'NEAR Intents 1Click API (dry run)' };
    quoteCache.set(key, { at: Date.now(), res });
    return res;
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 160) }; }
}

// the live NEAR price from NEAR Intents feeds the village (travellers pay with NEAR), checked every 10 minutes
async function pollOracle() {
  try {
    const list = await intentsTokens();
    const n = list.find((t) => t.key === 'NEAR');
    if (n && n.price) { setOracle(state, Number(n.price)); }
  } catch { /* offline: the village keeps the last price */ }
}
// council proposals to set money aside in USDC or BTC carry a live NEAR Intents quote, refreshed every 10 minutes
async function quoteReserves() {
  for (const prop of (state.council && state.council.open) || []) {
    if (prop.kind !== 'reserve' || (prop.quote && Date.now() - prop.quote.at < 10 * 60000)) continue;
    const emwk = Math.max(0, Math.round((balance(state, 'treasury') - lockedFunds(state)) * prop.params.pct / 100));
    const near = Math.round((emwk / RULES.emwkPerNear) * 100) / 100;
    if (near < 0.1) continue;
    const q = await intentsQuote(prop.params.asset, near);
    prop.quote = { at: Date.now(), ok: !!q.ok, emwk, near, out: q.ok ? q.amountOut : null, usd: q.ok ? q.usdOut : null, error: q.ok ? null : q.error };
    broadcast();
  }
}
setTimeout(pollOracle, 3000); setInterval(pollOracle, 10 * 60000);
setInterval(quoteReserves, 20000);

// universal checkout preview: how much of another chain's asset pays an EMWK price, through NEAR Intents.
// The price is turned into NEAR at the village rate, then 1Click quotes EXACT_OUTPUT into NEAR (dry run, nothing is sent).
async function intentsPayQuote(fromKey, emwk) {
  try {
    const near = Math.round((Math.min(100000, Math.max(1, emwk)) / RULES.emwkPerNear) * 100) / 100;
    const key = `pay|${fromKey}|${near}`, hit = quoteCache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.res;
    await intentsTokens();
    const all = tokenCache.all || [];
    const def = PAY_FROM.find((x) => x[0] === fromKey);
    const to = all.find((t) => t.assetId === 'nep141:wrap.near');
    const from = def && all.find((t) => t.symbol === def[1] && t.blockchain === def[2]);
    if (!from || !to) return { ok: false, error: 'unknown asset' };
    const units = (BigInt(Math.round(near * 1000)) * 10n ** BigInt(to.decimals)) / 1000n;
    const q = await getJson(`${ONECLICK}/quote`, { method: 'POST', body: JSON.stringify({
      dry: true, swapType: 'EXACT_OUTPUT', slippageTolerance: 100,
      originAsset: from.assetId, depositType: 'ORIGIN_CHAIN', destinationAsset: to.assetId, amount: units.toString(),
      refundTo: 'intents.near', refundType: 'INTENTS', recipient: 'intents.near', recipientType: 'INTENTS',
      deadline: new Date(Date.now() + 10 * 60000).toISOString(),
    }) });
    const qq = q.quote || {};
    const res = { ok: true, dry: true, from: def[1], chain: def[2], emwk, near, amountIn: qq.amountInFormatted || qq.amountIn, usdIn: qq.amountInUsd, timeEstimate: qq.timeEstimate, source: 'NEAR Intents 1Click API (dry run)' };
    quoteCache.set(key, { at: Date.now(), res });
    return res;
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 160) }; }
}

// ---------- a REAL NEAR Intents swap on mainnet (small amounts) ----------
// NEAR Intents has no testnet, so this one runs on NEAR mainnet with the player's own wallet: the game asks
// 1Click for a real quote (dry: false), shows the deposit address, and follows the swap to the end. The game
// never holds a key or sends funds; the player sends wNEAR from their own wallet. If anything goes wrong,
// 1Click refunds to the player's refund account.
const REAL_TO = { USDC: ['USDC', 'near'], 'USDC-SOL': ['USDC', 'sol'], SOL: ['SOL', 'sol'], 'USDC-BASE': ['USDC', 'base'] };
// the other way: pay from another chain and get wNEAR on NEAR (limits in that token)
const REAL_FROM = { 'USDC-SOL': ['USDC', 'sol', 0.5, 15], SOL: ['SOL', 'sol', 0.003, 0.1], 'USDC-BASE': ['USDC', 'base', 0.5, 15] };
const REAL_MAX_NEAR = 5, REAL_MIN_NEAR = 0.1;
const SOL_RPC = process.env.EMBERWICK_SOLRPC || 'https://api.mainnet-beta.solana.com';
// 1Click gives amounts with up to 24 decimals; keep a readable number (6 decimals under 1, 4 above)
const shortAmt = (v) => { const n = Number(v); return Number.isFinite(n) ? Number(n.toFixed(n >= 100 ? 2 : n >= 1 ? 4 : 6)) : v; };
const shortUsd = (v) => { const n = Number(v); return Number.isFinite(n) ? Number(n.toFixed(2)) : v; };
const nearAcct = (a) => /^(([a-z\d]+[-_])*[a-z\d]+\.)+near$/.test(a) || /^[0-9a-f]{64}$/.test(a);
const recipientOk = (chain, a) => chain === 'near' ? nearAcct(a) : chain === 'sol' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : chain === 'base' ? /^0x[0-9a-fA-F]{40}$/.test(a) : false;
const realAsk = new Map(); // player -> times of recent real quotes
// an independent price check: what you send and what arrives, both at market price (CoinGecko), so the
// player sees the full cost of the swap (fees and spread together), not only what the bridge says
const MARKET = process.env.EMBERWICK_PRICES || 'https://api.coingecko.com/api/v3/simple/price?ids=near,solana,usd-coin,ethereum,bitcoin,tether&vs_currencies=usd';
const GECKO_ID = { NEAR: 'near', wNEAR: 'near', SOL: 'solana', USDC: 'usd-coin', ETH: 'ethereum', WETH: 'ethereum', BTC: 'bitcoin', WBTC: 'bitcoin', USDT: 'tether' };
let marketCache = { at: 0, p: null };
async function marketPrices() {
  if (marketCache.p && Date.now() - marketCache.at < 60000) return marketCache.p;
  try {
    const j = await getJson(MARKET);
    const p = {}; for (const [sym, id] of Object.entries(GECKO_ID)) if (j && j[id] && j[id].usd) p[sym] = j[id].usd;
    if (Object.keys(p).length) marketCache = { at: Date.now(), p };
  } catch { /* the check is extra: the swap works without it */ }
  return marketCache.p;
}
async function marketCheck(symIn, amountIn, symOut, amountOut) {
  const p = await marketPrices();
  if (!p || !p[symIn] || !p[symOut]) return null;
  const vin = Number(amountIn) * p[symIn], vout = Number(amountOut) * p[symOut];
  if (!(vin > 0) || !(vout >= 0)) return null;
  return { in: Math.round(vin * 100) / 100, out: Math.round(vout * 100) / 100, cost: Math.round((vin - vout) * 100) / 100, pct: Math.round(((vin - vout) / vin) * 1000) / 10, source: 'CoinGecko' };
}
// ---------- other routes, for comparison only (the swap itself always goes through NEAR Intents) ----------
// Omni Bridge is NEAR's own bridge: it moves the same token to the other chain (no swap), so its fee is shown
// with that note. LI.FI is the largest bridge aggregator: we check live whether it lists NEAR at all.
const OMNI = process.env.EMBERWICK_OMNI || 'https://mainnet.api.bridge.nearone.org';
const LIFI = process.env.EMBERWICK_LIFI || 'https://li.quest';
const OMNI_TOKEN = { NEAR: 'near:wrap.near', 'USDC-SOL': 'sol:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC-BASE': 'base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
let lifiCache = { at: 0, v: null };
async function lifiHasNear() {
  if (lifiCache.v && Date.now() - lifiCache.at < 3600000) return lifiCache.v;
  try {
    const j = await getJson(`${LIFI}/v1/chains?chainTypes=EVM,SVM,UTXO,MVM`);
    const chains = (j && j.chains) || [];
    const near = chains.some((c) => /^near$/i.test(String(c.key || '')) || /^near( protocol)?$/i.test(String(c.name || '')));
    lifiCache = { at: Date.now(), v: { checked: true, chains: chains.length, near } };
  } catch { lifiCache = { at: Date.now() - 3300000, v: { checked: false } }; }
  return lifiCache.v;
}
async function omniFee(tokenKey, units, senderOmni, recipientOmni) {
  const token = OMNI_TOKEN[tokenKey];
  if (!token) return { ok: false, why: 'token' };
  try {
    const q = new URLSearchParams({ sender: senderOmni, recipient: recipientOmni, token, amount: units });
    const j = await getJson(`${OMNI}/api/v3/transfer-fee?${q}`);
    if (!j || typeof j.usd_fee !== 'number') return { ok: false, why: 'answer' };
    return { ok: true, usd: Math.round(j.usd_fee * 100) / 100 };
  } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 80) }; }
}
// what the other ways would look like for this swap
async function otherRoutes(dir, srcKey, dstChain, amount, decimals, refundTo, recipient) {
  const omniChain = { near: 'near', sol: 'sol', base: 'base' };
  const units = (BigInt(Math.round(Number(amount) * 1e6)) * 10n ** BigInt(decimals)) / 1000000n;
  const [lifi, omni] = await Promise.all([
    lifiHasNear(),
    dir === 'out' && dstChain === 'near' ? Promise.resolve({ ok: false, why: 'same-chain' })
      : dir === 'out' ? omniFee('NEAR', units.toString(), `near:${refundTo}`, `${omniChain[dstChain]}:${recipient}`)
        : omniFee(srcKey, units.toString(), `${omniChain[REAL_FROM[srcKey][1]]}:${refundTo}`, `near:${recipient}`),
  ]);
  return { at: Date.now(), lifi, omni };
}
// ---------- any token on any chain -> any token on any chain (NEAR Intents settles it on NEAR) ----------
// The list of what can be swapped comes live from 1Click; limits are in dollars so they fit every token.
const ANY_MIN_USD = 0.4, ANY_MAX_USD = 20;
const CHAIN_NAME = { near: 'NEAR', sol: 'Solana', eth: 'Ethereum', base: 'Base', arb: 'Arbitrum', op: 'Optimism', pol: 'Polygon', bsc: 'BNB Chain', avax: 'Avalanche', gnosis: 'Gnosis', bera: 'Berachain', btc: 'Bitcoin', tron: 'Tron', sui: 'Sui', ton: 'TON', doge: 'Dogecoin', xrp: 'XRP', zec: 'Zcash', ltc: 'Litecoin', aptos: 'Aptos', cardano: 'Cardano', stellar: 'Stellar', bch: 'Bitcoin Cash' };
const EVM_CHAINS = { eth: 1, base: 8453, arb: 42161, op: 10, pol: 137, bsc: 56, avax: 43114, gnosis: 100, bera: 80094 };
const addrOk = (chain, a) => {
  a = String(a || '');
  if (chain === 'near') return nearAcct(a.toLowerCase());
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (EVM_CHAINS[chain]) return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (chain === 'btc') return /^(bc1[a-z0-9]{20,80}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
  if (chain === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (chain === 'sui' || chain === 'aptos') return /^0x[0-9a-fA-F]{64}$/.test(a);
  return /^[A-Za-z0-9:._-]{20,120}$/.test(a); // other chains: 1Click checks the exact format
};
// the token contract a wallet needs (null = the chain's own coin)
function contractOf(tk) {
  if (tk.contractAddress) return tk.contractAddress;
  if (tk.blockchain === 'near' && /^nep141:/.test(tk.assetId)) return tk.assetId.slice(7);
  return null;
}
async function anyAssets() {
  await intentsTokens();
  return (tokenCache.all || []).filter((x) => x && x.assetId && x.symbol && Number(x.price) > 0 && Number.isInteger(x.decimals))
    .map((x) => ({ id: x.assetId, sym: x.symbol, chain: x.blockchain, decimals: x.decimals, price: Number(x.price), contract: contractOf(x) }));
}
// ---------- the balance of the player's own connected wallet, for the token they are about to send ----------
// read-only public RPC calls; the address is the one the wallet itself reported
const NEAR_RPC = process.env.EMBERWICK_NEARRPC || 'https://free.rpc.fastnear.com';
const EVM_RPC = { eth: 'https://eth.llamarpc.com', base: 'https://mainnet.base.org', arb: 'https://arb1.arbitrum.io/rpc', op: 'https://mainnet.optimism.io', pol: 'https://polygon-rpc.com', bsc: 'https://bsc-dataseed.binance.org', avax: 'https://api.avax.network/ext/bc/C/rpc', gnosis: 'https://rpc.gnosischain.com', bera: 'https://rpc.berachain.com' };
const evmRpc = (c) => process.env.EMBERWICK_EVMRPC || EVM_RPC[c];
const NEAR_GAS_KEEP = 0.05; // left in the wallet for gas and storage
const balCache = new Map();
const rpc = (url, method, params) => getJson(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((j) => { if (j && j.error) throw new Error(j.error.message || JSON.stringify(j.error).slice(0, 80)); return j.result; });
const fromInt = (v, dec) => { const b = BigInt(v || 0), d = 10n ** BigInt(dec); return Number(b / d) + Number(b % d) / Number(d); };
async function walletBalance(assetId, address) {
  const list = await anyAssets();
  const x = list.find((a) => a.id === assetId);
  if (!x) return { ok: false, error: 'unknown token' };
  const key = assetId + '|' + address, hit = balCache.get(key);
  if (hit && Date.now() - hit.at < 20000) return hit.v;
  let amount = null, note = null;
  if (x.chain === 'near') {
    if (!nearAcct(address)) return { ok: false, error: 'not a NEAR account' };
    if (x.id === 'nep141:wrap.near' || !x.contract) {
      // the swap sends native NEAR (wrapped on the way); what can be spent is the balance minus the storage it pays for
      const v = await rpc(NEAR_RPC, 'query', { request_type: 'view_account', finality: 'final', account_id: address }).catch((e) => { if (/does not exist|UNKNOWN_ACCOUNT/i.test(e.message)) return { amount: '0', storage_usage: 0 }; throw e; });
      const free = fromInt(v.amount, 24) - (Number(v.storage_usage || 0) * 1e19) / 1e24;
      amount = Math.max(0, free - NEAR_GAS_KEEP); note = 'nearKeep';
    } else {
      const r = await rpc(NEAR_RPC, 'query', { request_type: 'call_function', finality: 'final', account_id: x.contract, method_name: 'ft_balance_of', args_base64: Buffer.from(JSON.stringify({ account_id: address })).toString('base64') });
      amount = fromInt(JSON.parse(Buffer.from(r.result).toString()) || '0', x.decimals);
    }
  } else if (x.chain === 'sol') {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return { ok: false, error: 'not a Solana address' };
    if (!x.contract) { const r = await rpc(SOL_RPC, 'getBalance', [address, { commitment: 'confirmed' }]); amount = Math.max(0, (r.value || 0) / 1e9 - 0.002); note = 'solKeep'; }
    else {
      const r = await rpc(SOL_RPC, 'getTokenAccountsByOwner', [address, { mint: x.contract }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      amount = (r.value || []).reduce((s2, a) => s2 + Number(((a.account.data.parsed || {}).info || {}).tokenAmount ? a.account.data.parsed.info.tokenAmount.uiAmountString : 0), 0);
    }
  } else if (EVM_CHAINS[x.chain]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, error: 'not an EVM address' };
    const url = evmRpc(x.chain);
    if (!x.contract) { const r = await rpc(url, 'eth_getBalance', [address, 'latest']); amount = Math.max(0, fromInt(BigInt(r), x.decimals) - (x.chain === 'eth' ? 0.0005 : 0.00005)); note = 'evmKeep'; }
    else { const r = await rpc(url, 'eth_call', [{ to: x.contract, data: '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0') }, 'latest']); amount = fromInt(BigInt(r && r !== '0x' ? r : '0x0'), x.decimals); }
  } else return { ok: false, error: 'no balance check for this network', code: 'bal.none' };
  const v = { ok: true, amount: Math.floor(amount * 1e6) / 1e6, sym: x.sym, chain: x.chain, usd: Math.round(amount * x.price * 100) / 100, note, at: Date.now() };
  balCache.set(key, { at: Date.now(), v });
  if (balCache.size > 500) balCache.delete(balCache.keys().next().value);
  return v;
}
async function quoteAny(pid, fromId, toId, amount, refundTo, recipient, opts = {}) {
  let list;
  try { list = await anyAssets(); } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120), code: 'real.noQuote' }; }
  const from = list.find((x) => x.id === fromId), to = list.find((x) => x.id === toId);
  if (!from || !to || fromId === toId) return { ok: false, error: 'Choose two different tokens.', code: 'any.badPair' };
  amount = Number(amount);
  const usd = amount * from.price;
  // NEAR keeps its own limits (0.1-5 NEAR); every other token is limited by its dollar value
  if (from.id === 'nep141:wrap.near') { if (!(amount >= REAL_MIN_NEAR && amount <= REAL_MAX_NEAR)) return { ok: false, error: `Between ${REAL_MIN_NEAR} and ${REAL_MAX_NEAR} NEAR.`, code: 'real.badAmount' }; }
  else if (!(usd >= ANY_MIN_USD - 1e-9 && usd <= ANY_MAX_USD + 1e-9)) return { ok: false, error: `Between $${ANY_MIN_USD} and $${ANY_MAX_USD} worth.`, code: 'any.badUsd', min: ANY_MIN_USD, max: ANY_MAX_USD };
  refundTo = String(refundTo || '').trim(); recipient = String(recipient || '').trim();
  if (from.chain === 'near') refundTo = refundTo.toLowerCase();
  if (to.chain === 'near') recipient = recipient.toLowerCase();
  if (!addrOk(from.chain, refundTo)) return { ok: false, error: 'The refund address must be on the chain you send from.', code: 'any.badRefund' };
  if (!addrOk(to.chain, recipient)) return { ok: false, error: 'That address does not fit the destination chain.', code: 'real.badRecipient' };
  if (!opts.noLimit) {
    const times = (realAsk.get(pid) || []).filter((x) => Date.now() - x < 3600000);
    if (times.length >= 5) return { ok: false, error: 'Too many real quotes this hour.', code: 'real.limit' };
    realAsk.set(pid, [...times, Date.now()]);
  }
  try {
    const units = (BigInt(Math.round(amount * 1e9)) * 10n ** BigInt(from.decimals)) / 1000000000n;
    if (units <= 0n) return { ok: false, error: 'Amount too small.', code: 'any.badUsd' };
    const q = await getJson(`${ONECLICK}/quote`, { method: 'POST', body: JSON.stringify({
      dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100,
      originAsset: from.id, depositType: 'ORIGIN_CHAIN', destinationAsset: to.id, amount: units.toString(),
      refundTo, refundType: 'ORIGIN_CHAIN', recipient, recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 30 * 60000).toISOString(),
    }) });
    const qq = q.quote || {};
    if (!qq.depositAddress) return { ok: false, error: 'No deposit address in the quote.', code: 'real.noQuote' };
    const swap = { id: qq.depositAddress, player: pid, dir: 'any', fromId: from.id, toId: to.id, from: from.id, to: to.id,
      fromSym: from.sym, fromChain: from.chain, fromDecimals: from.decimals, fromContract: from.contract, toSym: to.sym, chain: to.chain,
      amountIn: amount, amountOut: shortAmt(qq.amountOutFormatted || qq.amountOut), usdOut: shortUsd(qq.amountOutUsd), usdIn: shortUsd(qq.amountInUsd),
      depositAddress: qq.depositAddress, depositMemo: qq.depositMemo || null, deadline: qq.deadline || null, timeEstimate: qq.timeEstimate || null, recipient, refundTo, status: 'PENDING_DEPOSIT', at: Date.now() };
    [swap.mkt, swap.alt] = await Promise.all([marketCheck(from.sym, amount, to.sym, swap.amountOut), opts.noLimit ? null : otherRoutesAny(from, to, units, refundTo, recipient)]);
    state.realSwaps = [swap, ...(state.realSwaps || [])].slice(0, 40);
    save();
    return { ok: true, swap };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 160), code: 'real.noQuote' }; }
}
// for routes that do not touch NEAR (e.g. Base -> Solana), LI.FI can quote the same swap: a real side-by-side number
const LIFI_CHAIN = { ...EVM_CHAINS, sol: 1151111081099710 };
const NATIVE = { sol: '11111111111111111111111111111111' };
async function lifiQuote(from, to, units, fromAddress, toAddress) {
  if (!LIFI_CHAIN[from.chain] || !LIFI_CHAIN[to.chain]) return { ok: false, why: 'chains' };
  const tok = (x) => x.contract || NATIVE[x.chain] || '0x0000000000000000000000000000000000000000';
  try {
    const q = new URLSearchParams({ fromChain: LIFI_CHAIN[from.chain], toChain: LIFI_CHAIN[to.chain], fromToken: tok(from), toToken: tok(to), fromAmount: units.toString(), fromAddress, toAddress });
    const j = await getJson(`${LIFI}/v1/quote?${q}`);
    const e = (j && j.estimate) || {};
    const dec = (j && j.action && j.action.toToken && j.action.toToken.decimals) ?? to.decimals;
    if (!e.toAmount) return { ok: false, why: 'answer' };
    const sum = (list) => Math.round((list || []).reduce((a, c) => a + (Number(c.amountUSD) || 0), 0) * 100) / 100;
    return { ok: true, toAmount: shortAmt(Number(e.toAmount) / 10 ** dec), usdOut: e.toAmountUSD ? shortUsd(e.toAmountUSD) : null, feeUsd: sum(e.feeCosts), gasUsd: sum(e.gasCosts), tool: (j.toolDetails && j.toolDetails.name) || j.tool || 'LI.FI' };
  } catch (err) { return { ok: false, why: String(err.message || err).slice(0, 80) }; }
}
async function otherRoutesAny(from, to, units, refundTo, recipient) {
  const touchesNear = from.chain === 'near' || to.chain === 'near';
  const omniChain = { sol: 'sol', base: 'base', eth: 'eth', arb: 'arb' };
  const [lifi, omni, lq] = await Promise.all([
    lifiHasNear(),
    from.id === 'nep141:wrap.near' && omniChain[to.chain] ? omniFee('NEAR', units.toString(), `near:${refundTo}`, `${omniChain[to.chain]}:${recipient}`)
      : touchesNear ? Promise.resolve({ ok: false, why: to.chain === from.chain ? 'same-chain' : 'token' }) : Promise.resolve({ ok: false, why: 'no-near' }),
    touchesNear ? Promise.resolve(null) : lifiQuote(from, to, units, refundTo, recipient),
  ]);
  return { at: Date.now(), lifi, omni, lifiQuote: lq };
}
async function realQuote(pid, toKey, amount, refundTo, recipient, fromKey = null, opts = {}) {
  if (fromKey) return realQuoteIn(pid, fromKey, amount, refundTo, recipient);
  const def = REAL_TO[toKey];
  if (!def) return { ok: false, error: 'Unknown destination.', code: 'real.badTo' };
  amount = Number(amount);
  if (!(amount >= REAL_MIN_NEAR && amount <= REAL_MAX_NEAR)) return { ok: false, error: `Between ${REAL_MIN_NEAR} and ${REAL_MAX_NEAR} NEAR.`, code: 'real.badAmount' };
  refundTo = String(refundTo || '').trim().toLowerCase(); recipient = String(recipient || '').trim();
  if (def[1] === 'near') recipient = recipient.toLowerCase();
  if (!nearAcct(refundTo)) return { ok: false, error: 'Refund account must be a NEAR mainnet account (name.near).', code: 'real.badRefund' };
  if (!recipientOk(def[1], recipient)) return { ok: false, error: 'That address does not fit the destination chain.', code: 'real.badRecipient' };
  if (!opts.noLimit) {
    const times = (realAsk.get(pid) || []).filter((x) => Date.now() - x < 3600000);
    if (times.length >= 5) return { ok: false, error: 'Too many real quotes this hour.', code: 'real.limit' };
    realAsk.set(pid, [...times, Date.now()]);
  }
  try {
    await intentsTokens();
    const all = tokenCache.all || [];
    const from = all.find((t) => t.assetId === 'nep141:wrap.near'), to = all.find((t) => t.symbol === def[0] && t.blockchain === def[1]);
    if (!from || !to) return { ok: false, error: 'NEAR Intents does not list that asset right now.', code: 'real.badTo' };
    const units = (BigInt(Math.round(amount * 1000)) * 10n ** BigInt(from.decimals)) / 1000n;
    const q = await getJson(`${ONECLICK}/quote`, { method: 'POST', body: JSON.stringify({
      dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100,
      originAsset: from.assetId, depositType: 'ORIGIN_CHAIN', destinationAsset: to.assetId, amount: units.toString(),
      refundTo, refundType: 'ORIGIN_CHAIN', recipient, recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 30 * 60000).toISOString(),
    }) });
    const qq = q.quote || {};
    if (!qq.depositAddress) return { ok: false, error: 'No deposit address in the quote.', code: 'real.noQuote' };
    const swap = { id: qq.depositAddress, player: pid, to: toKey, chain: def[1], amountIn: amount, amountOut: shortAmt(qq.amountOutFormatted || qq.amountOut), usdOut: shortUsd(qq.amountOutUsd), usdIn: shortUsd(qq.amountInUsd),
      depositAddress: qq.depositAddress, depositMemo: qq.depositMemo || null, deadline: qq.deadline || null, timeEstimate: qq.timeEstimate || null, recipient, refundTo, status: 'PENDING_DEPOSIT', at: Date.now() };
    [swap.mkt, swap.alt] = await Promise.all([marketCheck('NEAR', amount, def[0], swap.amountOut), opts.noLimit ? null : otherRoutes('out', 'NEAR', def[1], amount, 24, refundTo, recipient)]);
    state.realSwaps = [swap, ...(state.realSwaps || [])].slice(0, 40);
    save();
    return { ok: true, swap };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 160), code: 'real.noQuote' }; }
}
async function realQuoteIn(pid, fromKey, amount, refundTo, recipient) {
  const def = REAL_FROM[fromKey];
  if (!def) return { ok: false, error: 'Unknown source.', code: 'real.badTo' };
  amount = Number(amount);
  if (!(amount >= def[2] && amount <= def[3])) return { ok: false, error: `Between ${def[2]} and ${def[3]} ${def[0]}.`, code: 'real.badAmountIn', min: def[2], max: def[3], sym: def[0] };
  refundTo = String(refundTo || '').trim(); recipient = String(recipient || '').trim().toLowerCase();
  if (!recipientOk(def[1], refundTo)) return { ok: false, error: 'The refund address must be on the chain you pay from.', code: 'real.badRefundIn' };
  if (!nearAcct(recipient)) return { ok: false, error: 'wNEAR goes to a NEAR mainnet account (name.near).', code: 'real.badRecipient' };
  const times = (realAsk.get(pid) || []).filter((x) => Date.now() - x < 3600000);
  if (times.length >= 5) return { ok: false, error: 'Too many real quotes this hour.', code: 'real.limit' };
  realAsk.set(pid, [...times, Date.now()]);
  try {
    await intentsTokens();
    const all = tokenCache.all || [];
    const from = all.find((t) => t.symbol === def[0] && t.blockchain === def[1]), to = all.find((t) => t.assetId === 'nep141:wrap.near');
    if (!from || !to) return { ok: false, error: 'NEAR Intents does not list that asset right now.', code: 'real.badTo' };
    const units = (BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(from.decimals)) / 1000000n;
    const q = await getJson(`${ONECLICK}/quote`, { method: 'POST', body: JSON.stringify({
      dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100,
      originAsset: from.assetId, depositType: 'ORIGIN_CHAIN', destinationAsset: to.assetId, amount: units.toString(),
      refundTo, refundType: 'ORIGIN_CHAIN', recipient, recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 30 * 60000).toISOString(),
    }) });
    const qq = q.quote || {};
    if (!qq.depositAddress) return { ok: false, error: 'No deposit address in the quote.', code: 'real.noQuote' };
    const swap = { id: qq.depositAddress, player: pid, dir: 'in', from: fromKey, fromSym: def[0], fromChain: def[1], to: 'NEAR', chain: 'near', amountIn: amount, amountOut: shortAmt(qq.amountOutFormatted || qq.amountOut), usdOut: shortUsd(qq.amountOutUsd), usdIn: shortUsd(qq.amountInUsd),
      depositAddress: qq.depositAddress, depositMemo: qq.depositMemo || null, deadline: qq.deadline || null, timeEstimate: qq.timeEstimate || null, recipient, refundTo, status: 'PENDING_DEPOSIT', at: Date.now() };
    [swap.mkt, swap.alt] = await Promise.all([marketCheck(def[0], amount, 'NEAR', swap.amountOut), otherRoutes('in', fromKey, 'near', amount, from.decimals, refundTo, recipient)]);
    state.realSwaps = [swap, ...(state.realSwaps || [])].slice(0, 40);
    save();
    return { ok: true, swap };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 160), code: 'real.noQuote' }; }
}
async function realStatus(addr) {
  const swap = (state.realSwaps || []).find((x) => x.depositAddress === addr);
  if (!swap) return { ok: false, error: 'unknown swap' };
  if (swap.status === 'CANCELLED') return { ok: true, swap };
  try {
    const st = await getJson(`${ONECLICK}/status?depositAddress=${encodeURIComponent(addr)}`);
    const d = st.swapDetails || {};
    const links = (list) => (list || []).map((x) => typeof x === 'string' ? { hash: x } : { hash: x.hash, url: x.explorerUrl }).filter((x) => x.hash);
    swap.status = st.status || swap.status;
    const o = links(d.originChainTxHashes), dd = links(d.destinationChainTxHashes);
    if (o.length) swap.origin = o; if (dd.length) swap.dest = dd; // never lose links an earlier answer gave
    if (d.amountOutFormatted) swap.amountOut = shortAmt(d.amountOutFormatted);
    if (swap.status === 'SUCCESS' && !swap.logged) {
      swap.logged = true;
      swap.doneAt = Date.now();
      const p = state.players[swap.player], who = p ? p.name : 'A villager';
      const tx = (swap.dest[0] || swap.origin[0] || {}).hash || '';
      const cn = (c) => CHAIN_NAME[c] || String(c || '').toUpperCase();
      const dsym = (x) => (x === 'wNEAR' ? 'NEAR' : x);
      const fromTxt = swap.dir === 'any' ? `${swap.amountIn} ${dsym(swap.fromSym)} (${cn(swap.fromChain)})` : swap.dir === 'in' ? `${swap.amountIn} ${swap.fromSym} (${swap.fromChain === 'base' ? 'Base' : 'Solana'})` : `${swap.amountIn} NEAR`;
      const toTxt = swap.dir === 'any' ? `${swap.amountOut} ${dsym(swap.toSym)} (${cn(swap.chain)})` : swap.dir === 'in' ? `${swap.amountOut} NEAR` : `${swap.amountOut} ${({ USDC: 'USDC (NEAR)', 'USDC-SOL': 'USDC (Solana)', 'USDC-BASE': 'USDC (Base)', SOL: 'SOL (Solana)' })[swap.to] || (String(swap.to).includes(':') ? `${dsym(swap.toSym || swap.to)} (${cn(swap.chain)})` : swap.to)}`;
      addLog(state, `${who} made a real cross-chain swap with NEAR Intents: ${fromTxt} -> ${toTxt}.`, 'good', 'log.realSwap2', { name: who, a: fromTxt, b: toTxt });
      // a record of the mainnet swap in the village's books on testnet (0.01 EMWK memo)
      transfer(state, 'treasury', 'newcomerFund', 0.01, { memo: `Emberwick: real NEAR Intents swap on mainnet, ${fromTxt} -> ${toTxt}, tx ${tx.slice(0, 64)}` });
      swap.bookRef = state.ledgerSeq;
      if (giveSeal(state, swap.player, swap.batch || swap.depositAddress)) swap.sealGiven = true; // the village book entry: its testnet transaction shows up in bridge.txOf
      // the first real swap of a player earns the Bridge Master badge
      if (p && !p.bridgeMaster) { p.bridgeMaster = Date.now(); swap.firstBadge = true; addLog(state, `${who} is now a Bridge Master: a first real cross-chain swap.`, 'good', 'log.bridgeMaster', { name: who }); }
      broadcast();
    }
    save();
    return { ok: true, swap };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 160), swap }; }
}

function save() {
  fs.mkdirSync(path.dirname(SAVE), { recursive: true });
  fs.writeFileSync(SAVE + '.tmp', JSON.stringify(state));
  fs.renameSync(SAVE + '.tmp', SAVE); // never leaves a half-written save
}

// live updates to every open browser
const clients = new Map(); // res -> playerId
function broadcast() {
  for (const [res, pid] of clients) res.write(`data: ${JSON.stringify(view(pid))}\n\n`);
}

// NEAR AI: each village morning one request plans the day for every craftsman, only while someone is playing
let aiBusy = false, aiTry = { day: 0, n: 0, at: 0 };
// NEAR AI costs money per request: the morning plan is only made while someone is really playing
// (a click, a key or a scroll in the last 30 minutes), not for a tab left open in the background
let lastHere = Date.now(), idleSaid = false;
const IDLE_MS = (Number(process.env.EMBERWICK_IDLE_MIN) || 30) * 60000;
async function aiMorning() {
  if (aiBusy || ai.status !== 'ready' || !clients.size || (state.ff && state.ff.running) || state.aiPlannedDay === state.day) return;
  if (Date.now() - lastHere > IDLE_MS) { if (!idleSaid) { idleSaid = true; console.log(`[AI] nobody has played for ${IDLE_MS / 60000} minutes: morning plans paused until someone does`); } return; }
  if (idleSaid) { idleSaid = false; console.log('[AI] a player is back: morning plans on again'); }
  if (aiTry.day === state.day && (aiTry.n >= 3 || Date.now() - aiTry.at < 90000)) return; // up to 3 tries a village day
  aiBusy = true;
  const day = state.day;
  aiTry = { day, n: aiTry.day === day ? aiTry.n + 1 : 1, at: Date.now() };
  try {
    const plan = await planDay(aiBrief(state));
    if (plan && applyAiPlan(state, plan, ai.model, { tee: !!ai.tee, signer: ai.attest && ai.attest.signer, proof: plan._proof || null })) { state.aiPlannedDay = day; broadcast(); }
  } catch (e) {
    ai.lastError = String(e.message || e).slice(0, 160);
    ai.planFailed = true; // the craftsmen keep their rule-based habits until a plan comes through
    console.log(`[AI] plan skipped (try ${aiTry.n}/3):`, ai.lastError);
    broadcast();
  } finally { aiBusy = false; }
}
startAi().then(async () => { await fetchAttestation(); setTimeout(aiMorning, 2000); });
setInterval(fetchAttestation, 6 * 3600 * 1000); // a fresh proof a few times a day
setInterval(aiMorning, 15000);

setInterval(() => {
  if (state.ff && state.ff.running) return; // the fast-forward drives the clock for now
  tick(state);
  broadcast();
  if (state.tick % 10 === 0) save();
}, RULES.tickMs);

// fast-forward: one week of village life in about a minute. The economy runs exactly as usual,
// only faster; every transfer still goes to NEAR (batched by the bridge).
let lastCast = 0;
function startFastForward(byName, days = 7) {
  if (state.ff && state.ff.running) return false;
  const total = days * RULES.ticksPerDay, every = Math.max(20, Math.floor(60000 / total));
  const before = weekSnapshot(state);
  state.ff = { running: true, done: 0, total, startDay: state.day, by: byName };
  state.ffResult = null;
  broadcast();
  const timer = setInterval(() => {
    tick(state);
    state.ff.done++;
    if (Date.now() - lastCast > 300) { lastCast = Date.now(); broadcast(); }
    if (state.ff.done >= total) {
      clearInterval(timer);
      state.ff.running = false;
      state.ffResult = weekSummary(state, before);
      save(); broadcast();
    }
  }, every);
  return true;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------- who is this player? ----------
// A player id (p1, p2 ...) is not a secret, so it cannot prove who is asking. On joining, the server gives the
// browser a random key; every request that acts for a player must carry it. Keys are kept apart from the
// game state that is shown to anyone (state.playerKeys holds only their SHA-256).
const keyHash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
function newPlayerKey(pid) {
  const k = crypto.randomBytes(24).toString('hex');
  state.playerKeys = state.playerKeys || {};
  state.playerKeys[pid] = keyHash(k);
  return k;
}
function keyOk(pid, k) {
  const h = state.playerKeys && state.playerKeys[pid];
  if (!h || typeof k !== 'string' || !k) return false;
  const a = Buffer.from(h, 'hex'), b = Buffer.from(keyHash(k), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  if (req._body) return Promise.resolve(req._body);
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

// ---------- a simple rate limit per address ----------
// every POST counts; joining and claiming a villager are much stricter. Behind a host's proxy the client
// address is the first entry of X-Forwarded-For.
const hits = new Map();
const LIMITS = { post: [120, 10000], '/api/join': [5, 60000], '/api/claim': [5, 60000] };
function limited(req, what) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const [max, ms] = LIMITS[what], k = what + '|' + ip, now = Date.now();
  const h = (hits.get(k) || []).filter((t) => now - t < ms);
  h.push(now); hits.set(k, h);
  if (hits.size > 20000) hits.clear();
  return h.length > max;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    const p0 = new URL(req.url, 'http://x').pathname;
    if (limited(req, 'post') || (LIMITS[p0] && limited(req, p0))) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '10' });
      return res.end(JSON.stringify({ ok: false, code: 'err.slowDown', error: 'Too many requests; wait a few seconds.' }));
    }
  }
  // every POST that names a player must carry that player's key (see keyOk above)
  if (req.method === 'POST') {
    const body = req._body = await new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 10000) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    });
    const path0 = new URL(req.url, 'http://x').pathname;
    const pid = body && typeof body.player === 'string' ? body.player : null;
    if (pid && path0 !== '/api/claim' && state.players[pid] && !keyOk(pid, body.key)) {
      // a player from before keys existed gets one the first time their browser asks (/api/claim)
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, code: 'err.notYou', error: 'This browser is not signed in as that villager.' }));
    }
  }
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST') lastHere = Date.now(); // someone is really playing
  if (req.method === 'POST' && url.pathname === '/api/here') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/api/world') return sendJson(res, 200, { buildings: BUILDINGS, goods: GOODS, paths: START_PATHS, routes: PATH_ROUTE, token: TOKEN, rules: { ticksPerDay: RULES.ticksPerDay, tickMs: RULES.tickMs } });
  // what changed for a player while they were away (once, then the mark moves to now)
  if (url.pathname === '/api/away') {
    const pid = String(url.searchParams.get('player') || '');
    const away = state.players[pid] ? awaySummary(state, pid, (Number(process.env.EMBERWICK_AWAY_MIN) || 10) * 60000) : null;
    return sendJson(res, 200, { ok: true, away });
  }
  if (url.pathname === '/api/system') {
    const c = bridge ? bridge.view() : null;
    const bal = await bankBalance();
    const a = aiPublic();
    return sendJson(res, 200, {
      network: c ? c.network : null, explorer: c ? c.explorer : null, status: c ? c.status : 'off',
      bank: c && c.accounts ? c.accounts.bank : null, bankNear: bal, gasMin: 0.5,
      lowGas: !!(c && c.lowGas), pending: c ? c.pending : 0, txCount: c ? c.txCount : 0,
      ai: { status: a.status, provider: a.provider, model: a.model, tee: a.tee, attestAt: a.attest && a.attest.at || null, error: a.error, proof: a.proof, forced: a.forced },
      // what the village bank holds for others, next to what NEAR says the bank holds
      held: (() => { const b = state.balances, sum = (f) => Math.round(Object.entries(b).filter(([k]) => f(k)).reduce((a, [, v]) => a + v, 0) * 100) / 100;
        const players = sum((k) => k.startsWith('player:')), inBank = sum((k) => !(k === 'treasury' || k === 'deposits' || k === 'withdrawn' || k.startsWith('npc:')));
        const chain = c && c.balances && c.accounts && c.accounts.bank in c.balances ? c.balances[c.accounts.bank] : null;
        return { players, playerCount: Object.keys(state.players).length, inBank, chain, token: c && c.accounts ? c.accounts.token : null }; })(),
      record: (state.dayLog || [])[0] ? { day: state.dayLog[0].day, hash: state.dayLog[0].hash } : null,
      uptime: Math.round(process.uptime()), log: sysLog.slice(0, 50),
    });
  }
  if (url.pathname === '/api/state') return sendJson(res, 200, view(url.searchParams.get('player')));

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.set(res, url.searchParams.get('player'));
    res.write(`data: ${JSON.stringify(view(url.searchParams.get('player')))}\n\n`);
    req.on('close', () => clients.delete(res));
    setTimeout(aiMorning, 1500); // someone is here: the craftsmen plan the day if they have not yet
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/join') {
    const body = await readBody(req);
    const r = joinPlayer(state, body.name, body.path);
    if (r.ok) { r.key = newPlayerKey(r.id); save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  // a villager who joined before player keys existed: the first browser to ask gets the key, once
  if (req.method === 'POST' && url.pathname === '/api/claim') {
    const body = await readBody(req), pid = String(body.player || '');
    if (!state.players[pid]) return sendJson(res, 404, { ok: false, code: 'err.unknownPlayer' });
    if (state.playerKeys && state.playerKeys[pid]) return sendJson(res, keyOk(pid, body.key) ? 200 : 403, keyOk(pid, body.key) ? { ok: true } : { ok: false, code: 'err.notYou' });
    // claiming is only for the move to player keys: it closes three days after the village first ran with keys
    if (Date.now() > (state.claimUntil || 0)) return sendJson(res, 403, { ok: false, code: 'err.claimClosed', error: 'Villagers from before player keys could be claimed only in the first days.' });
    const key = newPlayerKey(pid); save();
    return sendJson(res, 200, { ok: true, key });
  }

  // ask a craftsman a question; NEAR AI answers in character (words only, it never moves money)
  if (req.method === 'POST' && url.pathname === '/api/ai/ask') {
    const body = await readBody(req);
    if (!body.player || !state.players[body.player]) return sendJson(res, 400, { ok: false, error: 'join first' });
    const card = shopCard(state, String(body.npc || ''));
    if (!card) return sendJson(res, 400, { ok: false, error: 'unknown craftsman' });
    const n = state.npcs[card.id];
    if (n.ai) card.todaysPlan = n.ai.why;
    const ctx = { credit: creditPolicy(state, body.player, card.id), order: commissionPolicy(state, body.player, card.id), village: villageDirectory(state), customer: customerBrief(state, body.player) };
    const r = await askCraftsman(card, body.q, String(body.lang || 'en').slice(0, 5), body.player, ctx);
    if (r.ok) r.actions = checkAiActions(state, body.player, card.id, r.actions); // only what the rules allow, as buttons
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  // money history of an account: a player sees their own; craftsmen, the treasury and funds are public
  if (url.pathname === '/api/money') {
    const pid = url.searchParams.get('player'), acct = String(url.searchParams.get('acct') || '');
    const publicAcct = /^(npc:[a-z]+|treasury|newcomerFund|adventurerFund|deposits|botFund)$/.test(acct);
    const own = pid && state.players[pid] && acct === 'player:' + pid;
    if (!publicAcct && !own) return sendJson(res, 403, { ok: false, error: 'not allowed' });
    const nameOf = (h) => h.startsWith('npc:') ? (CRAFTSMEN.find((c) => c.id === h.slice(4)) || {}).name || h : h.startsWith('player:') ? (state.players[h.slice(7)] || {}).name || 'player'
      : h.startsWith('bot:') ? ((state.bots || {})[h.slice(4)] || {}).name || 'villager' : h;
    const rows = moneyHistory(state, acct, 80).map((e) => ({ ...e, otherName: nameOf(e.other), tx: bridge && bridge.txOf ? bridge.txOf(e.id) : null }));
    return sendJson(res, 200, { ok: true, acct, balance: Math.round((state.balances[acct] || 0) * 100) / 100, rows, chain: !!(bridge && bridge.status === 'ready') });
  }

  // a real NEAR Intents swap (mainnet): quote with a deposit address, status, and telling 1Click about the deposit
  if (req.method === 'POST' && url.pathname === '/api/intents/real') {
    const body = await readBody(req);
    if (!body.player || !state.players[body.player]) return sendJson(res, 400, { ok: false, error: 'join first' });
    const r = await realQuote(body.player, body.to, body.amount, body.refundTo, body.recipient, body.dir === 'in' ? body.from : null);
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  // a swap said in words: NEAR AI fills the form, the server checks it, and if nothing is missing the real
  // quote is taken right away (the player still sends the money from their own wallet)
  if (req.method === 'POST' && url.pathname === '/api/ai/swap') {
    const body = await readBody(req);
    if (!body.player || !state.players[body.player]) return sendJson(res, 400, { ok: false, error: 'join first' });
    const r = await readSwapCommand(body.text, String(body.lang || 'en').slice(0, 5), body.player);
    if (!r.ok) return sendJson(res, 400, r);
    const f = r.form, said = addressesIn(body.text), w = body.wallets && typeof body.wallets === 'object' ? body.wallets : {};
    const wallet = (chain, k = 0) => (said[chain] || [])[k] || (k === 0 && recipientOk(chain, String(w[chain] || '')) ? String(w[chain]) : '');
    const out = { dir: f.dir || 'out', from: f.from || 'USDC-SOL', to: f.to || 'USDC', amount: f.amount, refundTo: '', recipient: '' };
    const missing = [];
    if (!f.dir) missing.push('dir');
    let srcChain = 'near', dstChain = 'near', min = REAL_MIN_NEAR, max = REAL_MAX_NEAR, sym = 'NEAR';
    if (out.dir === 'out') {
      if (!f.to) missing.push('to');
      dstChain = REAL_TO[out.to][1];
      out.refundTo = wallet('near');
      out.recipient = dstChain === 'near' ? wallet('near', 1) || wallet('near') : wallet(dstChain);
    } else {
      if (!f.from) missing.push('from');
      const d = REAL_FROM[out.from]; srcChain = d[1]; min = d[2]; max = d[3]; sym = d[0];
      out.refundTo = wallet(srcChain); out.recipient = wallet('near');
    }
    if (!(out.amount > 0)) missing.push('amount');
    else if (out.amount < min || out.amount > max) missing.push('range');
    if (!recipientOk(srcChain, out.refundTo)) missing.push('wallet:' + srcChain);
    if (!recipientOk(dstChain, out.recipient) && !(srcChain === dstChain && missing.includes('wallet:' + srcChain))) missing.push('wallet:' + dstChain);
    if (!out.amount) out.amount = out.dir === 'out' ? 0.3 : REAL_FROM[out.from][0] === 'SOL' ? 0.005 : 0.5;
    const reply = { ok: true, form: out, say: r.say, by: r.by, model: r.model || null, tee: !!r.tee, missing, limits: { min, max, sym } };
    if (!missing.length) {
      const q = await realQuote(body.player, out.to, out.amount, out.refundTo, out.recipient, out.dir === 'in' ? out.from : null);
      if (q.ok) reply.swap = q.swap; else reply.quoteError = q.code || 'real.noQuote';
    }
    return sendJson(res, 200, reply);
  }
  if (url.pathname === '/api/intents/real/status') {
    const r = await realStatus(String(url.searchParams.get('depositAddress') || ''));
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  // everything NEAR Intents can swap right now, for the token pickers
  if (url.pathname === '/api/intents/assets') {
    try { return sendJson(res, 200, { ok: true, assets: await anyAssets(), min: ANY_MIN_USD, max: ANY_MAX_USD, evm: EVM_CHAINS }); }
    catch (e) { return sendJson(res, 502, { ok: false, error: String(e.message || e).slice(0, 120) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/intents/real/any') {
    const body = await readBody(req);
    if (!body.player || !state.players[body.player]) return sendJson(res, 400, { ok: false, error: 'join first' });
    const r = await quoteAny(body.player, String(body.from || ''), String(body.to || ''), body.amount, body.refundTo, body.recipient);
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  // split one NEAR send into 2-5 parts, each to its own token, chain and receiver; all quotes or none
  if (req.method === 'POST' && url.pathname === '/api/intents/real/multi') {
    const body = await readBody(req);
    if (!body.player || !state.players[body.player]) return sendJson(res, 400, { ok: false, error: 'join first' });
    const legs = Array.isArray(body.legs) ? body.legs.slice(0, 6) : [];
    if (legs.length < 2 || legs.length > 5) return sendJson(res, 400, { ok: false, error: '2 to 5 receivers', code: 'split.count' });
    const total = legs.reduce((a, l) => a + Number(l.amount || 0), 0);
    if (!(total <= REAL_MAX_NEAR + 1e-9)) return sendJson(res, 400, { ok: false, error: `At most ${REAL_MAX_NEAR} NEAR in all.`, code: 'split.tooMuch' });
    const times = (realAsk.get(body.player) || []).filter((x) => Date.now() - x < 3600000);
    if (times.length >= 5) return sendJson(res, 400, { ok: false, error: 'Too many real quotes this hour.', code: 'real.limit' });
    realAsk.set(body.player, [...times, Date.now()]); // the whole split counts as one quote
    const batch = 'b' + Date.now().toString(36), made = [];
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      const q = String(l.to || '').includes(':') ? await quoteAny(body.player, 'nep141:wrap.near', String(l.to), l.amount, body.refundTo, l.recipient, { noLimit: true })
        : await realQuote(body.player, l.to, l.amount, body.refundTo, l.recipient, null, { noLimit: true });
      if (!q.ok) {
        for (const m of made) { m.status = 'CANCELLED'; m.cancelledAt = Date.now(); }
        save();
        return sendJson(res, 400, { ...q, leg: i + 1 });
      }
      q.swap.batch = batch; q.swap.leg = i + 1; made.push(q.swap);
    }
    save();
    return sendJson(res, 200, { ok: true, batch, swaps: made });
  }
  // give up a swap before any money was sent (a wrong address, a change of mind); the deposit address just expires
  if (req.method === 'POST' && url.pathname === '/api/intents/real/cancel') {
    const body = await readBody(req);
    const swap = (state.realSwaps || []).find((x) => x.depositAddress === body.depositAddress && x.player === body.player);
    if (!swap) return sendJson(res, 400, { ok: false, error: 'unknown swap' });
    const group = swap.batch ? state.realSwaps.filter((x) => x.batch === swap.batch) : [swap];
    if (group.some((x) => x.status !== 'PENDING_DEPOSIT' || x.sentTx)) return sendJson(res, 400, { ok: false, error: 'money is already on the way', code: 'real.cantCancel' });
    for (const x of group) { x.status = 'CANCELLED'; x.cancelledAt = Date.now(); }
    save();
    return sendJson(res, 200, { ok: true });
  }
  // a fresh Solana blockhash for the player's wallet to sign the deposit with (public Solana RPCs often refuse browsers)
  // the testnet transaction that wrote a real swap into the village book (it may take a minute)
  if (url.pathname === '/api/intents/real/book') {
    const swap = (state.realSwaps || []).find((x) => x.depositAddress === url.searchParams.get('depositAddress'));
    const h = swap && swap.bookRef && bridge && bridge.txOf ? bridge.txOf(swap.bookRef) : null;
    const real = h && !['sync', 'internal', 'netted'].includes(h);
    return sendJson(res, 200, { ok: !!swap, tx: real ? h : null, state: !swap ? 'none' : !swap.bookRef ? 'none' : real ? 'done' : h || 'waiting', url: real && bridge ? `${bridge.view().explorer}/txns/${h}` : null });
  }
  if (url.pathname === '/api/wallet/balance') {
    try { return sendJson(res, 200, await walletBalance(String(url.searchParams.get('asset') || ''), String(url.searchParams.get('address') || '').trim())); }
    catch (e) { return sendJson(res, 200, { ok: false, error: String(e.message || e).slice(0, 120) }); }
  }
  if (url.pathname === '/api/sol/blockhash') {
    try {
      const r = await getJson(SOL_RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: 'finalized' }] }) });
      const bh = r && r.result && r.result.value && r.result.value.blockhash;
      if (!bh) throw new Error('no blockhash');
      return sendJson(res, 200, { ok: true, blockhash: bh });
    } catch (e) { return sendJson(res, 502, { ok: false, error: String(e.message || e).slice(0, 120) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/intents/real/submit') {
    const body = await readBody(req);
    const swap = (state.realSwaps || []).find((x) => x.depositAddress === body.depositAddress);
    if (!swap || !/^[A-Za-z0-9]{20,100}$/.test(String(body.txHash || ''))) return sendJson(res, 400, { ok: false, error: 'check the transaction hash' });
    swap.sentTx = String(body.txHash); swap.sentAt = swap.sentAt || Date.now(); save(); // the player sent it: no cancelling from here on
    try { await getJson(`${ONECLICK}/deposit/submit`, { method: 'POST', body: JSON.stringify({ depositAddress: swap.depositAddress, txHash: String(body.txHash) }) }); return sendJson(res, 200, { ok: true }); }
    catch (e) { return sendJson(res, 400, { ok: false, error: String(e.message || e).slice(0, 160) }); }
  }

  // the exact JSON of a morning plan (its SHA-256 is in the memo on NEAR), and the TEE proof
  if (url.pathname === '/api/ai/plan') {
    const d = Number(url.searchParams.get('day')), rec = (state.aiLog || []).find((x) => x.day === d) || (state.aiLog || [])[0];
    if (!rec) return sendJson(res, 404, { ok: false, error: 'no plan yet' });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Plan-Sha256': rec.hash });
    return res.end(rec.json);
  }
  // every kept village record at once (each with its hash), so anyone can keep an independent archive
  if (url.pathname === '/api/ledger') return sendJson(res, 200, { ok: true, contract: bridge && bridge.ledgerWasm && bridge.root ? bridge.ledgerId : null, status: bridge ? bridge.ledger.status : 'off', locked: !!(bridge && bridge.ledger.locked), written: state.ledgerDone || [], waiting: (state.ledgerOut || []).map(({ kind, day, sha256 }) => ({ kind, day, sha256 })) });
  if (url.pathname === '/api/state-records') return sendJson(res, 200, { ok: true, days: (state.dayLog || []).map((x) => ({ day: x.day, sha256: x.hash, json: x.json })) });
  if (url.pathname === '/api/solvency') return sendJson(res, 200, solvency());
  if (url.pathname === '/api/state-record') {
    const d = Number(url.searchParams.get('day')), rec = (state.dayLog || []).find((x) => x.day === d) || (state.dayLog || [])[0];
    if (!rec) return sendJson(res, 404, { ok: false, error: 'no village record yet (the first is written at the end of a village day)' });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Record-Sha256': rec.hash, 'X-Record-Day': String(rec.day) });
    return res.end(rec.json);
  }
  // one answer's signature check, with the exact request and response bytes so anyone can re-hash them
  if (url.pathname === '/api/ai/proof') {
    const d = Number(url.searchParams.get('day')), rec = d ? (state.aiLog || []).find((x) => x.day === d) : null;
    const p = aiProof(url.searchParams.get('chat') || (rec && rec.proof && rec.proof.chatId) || null);
    if (!p) return sendJson(res, 404, { ok: false, error: rec ? `the proof for that day is no longer kept (the server keeps the last ${PROOFS_KEPT} signed answers); the plan's hash for that day is still on NEAR (/api/ai/plan?day=N)` : 'no signed answer yet: the first one comes with the next village morning while someone is playing (open the game and click around, then reload)' });
    return sendJson(res, 200, p);
  }
  if (url.pathname === '/api/ai/attestation') {
    // ?signer=1: the report of the enclave that signed the last plan, when that was a different node of the same model
    const r = url.searchParams.get('signer') && ai.signerReport ? ai.signerReport : ai.attestFull;
    return sendJson(res, r ? 200 : 404, r || { ok: false, error: 'no attestation yet' });
  }

  // haggling: the village rules decide, NEAR AI says it in the craftsman's voice
  if (req.method === 'POST' && url.pathname === '/api/ai/haggle') {
    const body = await readBody(req);
    const r = playerAction(state, body.player, { type: 'haggle', npc: body.npc, good: body.good, side: body.side, qty: body.qty, offer: body.offer });
    if (r.ok) {
      const card = shopCard(state, r.npc), p = state.players[body.player];
      r.line = card ? await haggleLine(card, r, String(body.lang || 'en').slice(0, 5), p.name, body.player) : null;
      save(); broadcast();
    }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    const body = await readBody(req);
    const r = playerAction(state, body.player, body);
    if (r.ok) { markSeen(state, body.player); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  // read-only: who holds a deed NFT on NEAR right now (a view call to the deed contract, cached for a minute)
  if (url.pathname === '/api/deed/holder') {
    const plot = state.plots && state.plots[url.searchParams.get('plot')];
    if (!bridge || !plot || !plot.deed || !plot.deed.minted) return sendJson(res, 200, { ok: false });
    const id = plot.deed.tokenId, hit = deedHolders.get(id);
    let owner = hit && Date.now() - hit.at < 60000 ? hit.owner : undefined;
    if (owner === null && hit && Date.now() - hit.at > 15000) owner = undefined; // a failed read is retried after 15 s, not on every request
    if (owner === undefined) { try { owner = await bridge.deedOwner(id); } catch { owner = null; } deedHolders.set(id, { at: Date.now(), owner }); }
    if (!owner) return sendJson(res, 200, { ok: false });
    return sendJson(res, 200, { ok: true, tokenId: id, owner, record: plot.deed.owner || null, match: owner === plot.deed.owner });
  }
  // the seller sent their deed NFT to the village bank; check it on chain, then put it up for sale
  if (req.method === 'POST' && url.pathname === '/api/market/escrow') {
    const body = await readBody(req);
    const plot = state.plots && state.plots[body.plot];
    if (!bridge || !plot || !plot.deed || plot.owner !== body.player) return sendJson(res, 400, { ok: false, code: 'err.notYourPlot' });
    let owner = null;
    for (let i = 0; i < 6 && owner !== bridge.root; i++) { // the transfer may take a few seconds to land
      try { owner = await bridge.deedOwner(plot.deed.tokenId); } catch { owner = null; }
      if (owner !== bridge.root) await new Promise((r) => setTimeout(r, 2500));
    }
    if (owner !== bridge.root) return sendJson(res, 400, { ok: false, code: 'err.escrowMissing', state: view(body.player) });
    setDeed(state, body.plot, { owner: bridge.root });
    const r = playerAction(state, body.player, { type: 'listDeed', plot: body.plot, price: body.price });
    if (r.ok) { save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }
  // the change desk: live prices and cross-chain quotes from NEAR Intents (1Click API, dry run: nothing is swapped)
  if (url.pathname === '/api/exchange/prices') return sendJson(res, 200, await intentsPrices());
  if (url.pathname === '/api/exchange/payquote') return sendJson(res, 200, await intentsPayQuote(url.searchParams.get('from'), Number(url.searchParams.get('emwk')) || 0));
  if (url.pathname === '/api/exchange/quote') return sendJson(res, 200, await intentsQuote(url.searchParams.get('to'), Number(url.searchParams.get('amount')) || 1));
  if (req.method === 'POST' && url.pathname === '/api/fastforward') {
    const body = await readBody(req);
    const p = state.players[body.player];
    if (!p) return sendJson(res, 400, { ok: false, code: 'err.unknownPlayer' });
    const ok = startFastForward(p.name, 7);
    return sendJson(res, ok ? 200 : 409, ok ? { ok: true } : { ok: false, code: 'err.ffRunning' });
  }
  if (req.method === 'POST' && url.pathname === '/api/near/link') {
    const body = await readBody(req);
    if (bridge && bridge.status === 'ready') {
      const exists = await bridge.adapter.exists(String(body.account || '').trim().toLowerCase()).catch(() => null);
      if (exists === false) return sendJson(res, 400, { ok: false, code: 'err.walletMissing', error: 'No such NEAR testnet account.' });
    }
    const r = linkWallet(state, body.player, body.account);
    if (r.ok) { save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  // the browser reports wallet problems here, so they show up in the terminal
  if (req.method === 'POST' && url.pathname === '/api/near/clientlog') {
    const body = await readBody(req);
    console.log('[NEAR] browser: ' + String(body.msg || '').slice(0, 400));
    return sendJson(res, 200, { ok: true });
  }

  // wallet sign-in: the server gives a one-time message, the wallet signs it (NEP-413)
  if (url.pathname === '/api/near/challenge') {
    const pid = url.searchParams.get('player'), p = state.players[pid];
    if (!p) return sendJson(res, 400, { ok: false, code: 'err.unknownPlayer' });
    const c = { message: `Link this NEAR wallet to ${p.name} in Emberwick (${pid}).`, recipient: 'emberwick', nonce: crypto.randomBytes(32).toString('base64'), at: Date.now() };
    challenges.set(pid, c);
    return sendJson(res, 200, { ok: true, ...c });
  }

  if (req.method === 'POST' && url.pathname === '/api/near/verify') {
    const body = await readBody(req);
    const c = challenges.get(body.player);
    if (!c || Date.now() - c.at > 10 * 60 * 1000) return sendJson(res, 400, { ok: false, code: 'err.challenge', error: 'Try signing in again.' });
    if (!bridge || bridge.status !== 'ready') return sendJson(res, 400, { ok: false, code: 'err.chainOff' });
    let verified = false;
    try {
      await bridge.adapter.verifySigned({ accountId: body.accountId, publicKey: body.publicKey, signature: String(body.signature || ''), message: c.message, recipient: c.recipient, nonce: c.nonce, callbackUrls: [body.page, body.origin].filter(Boolean) });
      verified = true;
    } catch (e) {
      // keep the wallet connected so the player can go on; it is shown as not verified
      console.log(`[NEAR] wallet proof failed (${e.message}). Got: account ${body.accountId}, key ${body.publicKey}, signature ${String(body.signature).slice(0, 16)}… (${String(body.signature).length} chars)`);
    }
    challenges.delete(body.player);
    const r = linkWallet(state, body.player, body.accountId, verified);
    if (r.ok) r.verified = verified;
    if (r.ok && verified) moveHeldDeeds(body.player);
    if (r.ok) { save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  // the player sent EMWK from their wallet to the village bank: verify it, then credit it
  if (req.method === 'POST' && url.pathname === '/api/near/deposit') {
    const body = await readBody(req);
    const p = state.players[body.player];
    if (!p || !p.near) return sendJson(res, 400, { ok: false, code: 'err.noWallet' });
    if (!bridge || bridge.status !== 'ready') return sendJson(res, 400, { ok: false, code: 'err.chainOff' });
    const hash = String(body.hash || '');
    bridge.keys.seen = bridge.keys.seen || [];
    if (!hash || bridge.keys.seen.includes(hash)) return sendJson(res, 400, { ok: false, code: 'err.depositSeen' });
    let amount;
    try {
      const d = await bridge.checkDeposit(hash, p.near, `for ${body.player}`);
      // a transfer without our memo counts only for a player whose wallet link is signature-verified
      if (!d.memoOk && !p.nearVerified) throw new Error('no memo, and this wallet link is not verified');
      amount = d.amount;
    } catch (e) {
      console.log(`[NEAR] deposit check failed for ${hash}: ${e.message}`);
      return sendJson(res, 400, { ok: false, code: 'err.depositBad', error: e.message });
    }
    const r = depositIn(state, body.player, amount, hash);
    if (r.ok) { bridge.keys.seen.push(hash); bridge.store.save(bridge.keys); save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  if (req.method === 'POST' && url.pathname === '/api/near/withdraw') {
    const body = await readBody(req);
    if (!bridge || !bridge.canWithdraw()) return sendJson(res, 400, { ok: false, code: 'err.chainOff', error: 'NEAR is not connected yet.' });
    const r = withdraw(state, body.player, body.amount);
    if (r.ok) { bridge.withdraw(r.wallet, r.amount, state.players[body.player].name, body.player); save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  // static files
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Emberwick is running${RULES.demo ? ' in DEMO speed' : ''}: open http://localhost:${PORT} in your browser.`);
  startNear();
});
process.on('SIGINT', () => { save(); process.exit(0); });
