// Emberwick game server. Run `npm install` once, then `npm start`.
// The NEAR bridge is optional: without it (or offline) the game still runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createState, ensureContracts, aiBrief, applyAiPlan, shopCard, creditPolicy, giveCredit, commissionPolicy, orderFromChat, weekSnapshot, weekSummary, tick, setOracle, lockedFunds, balance, joinPlayer, playerAction, publicView, onTransfer, onGameEvent, linkWallet, withdraw, depositIn, setDeed } from './economy.js';
import crypto from 'node:crypto';
import { BUILDINGS, GOODS, START_PATHS, RULES, TOKEN, PATH_ROUTE, CRAFTSMEN } from './world.js';
import { Bridge, makeNearAdapter, fileStore } from './near.js';
import { ai, startAi, planDay, askCraftsman, haggleLine, aiPublic, fetchAttestation } from './ai.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(root, 'public');
const SAVE = path.join(root, 'data', 'state.json');
const PORT = Number(process.env.PORT) || 3000;

let state;
try {
  state = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
  ensureContracts(state); // bring older saves up to date (new shops, plots, council)
  if (state.ff) state.ff.running = false; // a fast-forward cut off by a restart just stops
  console.log(`Loaded saved village (day ${state.day}).`);
} catch {
  state = createState();
  console.log('Started a new village.');
}

// ---------- NEAR bridge ----------
let bridge = null;
// Secret keys live outside the project folder, so they can never end up on GitHub.
const KEYS = process.env.EMBERWICK_KEYS || path.join(os.homedir(), '.emberwick', 'near-keys.json');
async function startNear() {
  if (process.env.EMBERWICK_NEAR === '0') return console.log('NEAR bridge is off (EMBERWICK_NEAR=0).');
  const store = process.env.EMBERWICK_NEAR === 'fake' ? { load: () => null, save: () => {} } : fileStore(KEYS);
  let adapter;
  try {
    if (process.env.EMBERWICK_NEAR === 'fake') { adapter = (await import('./fakechain.js')).fakeChain({ faucetWorks: true }); adapter.pollMs = 0; adapter.acc.set('emberwick.testnet', { near: 5 }); }
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
const view = (pid) => ({ ...publicView(state, pid), chain: chainView(), boot: BOOT, ai: aiPublic() });

// ---------- NEAR Intents (1Click API) for the change desk ----------
const ONECLICK = 'https://1click.chaindefuser.com/v0';
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
async function aiMorning() {
  if (aiBusy || ai.status !== 'ready' || !clients.size || (state.ff && state.ff.running) || state.aiPlannedDay === state.day) return;
  if (aiTry.day === state.day && (aiTry.n >= 3 || Date.now() - aiTry.at < 90000)) return; // up to 3 tries a village day
  aiBusy = true;
  const day = state.day;
  aiTry = { day, n: aiTry.day === day ? aiTry.n + 1 : 1, at: Date.now() };
  try {
    const plan = await planDay(aiBrief(state));
    if (plan && applyAiPlan(state, plan, ai.model, { tee: !!ai.tee, signer: ai.attest && ai.attest.signer })) { state.aiPlannedDay = day; broadcast(); }
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

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/world') return sendJson(res, 200, { buildings: BUILDINGS, goods: GOODS, paths: START_PATHS, routes: PATH_ROUTE, token: TOKEN, rules: { ticksPerDay: RULES.ticksPerDay, tickMs: RULES.tickMs } });
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
    if (r.ok) { save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  // ask a craftsman a question; NEAR AI answers in character (words only, it never moves money)
  if (req.method === 'POST' && url.pathname === '/api/ai/ask') {
    const body = await readBody(req);
    if (!body.player || !state.players[body.player]) return sendJson(res, 400, { ok: false, error: 'join first' });
    const card = shopCard(state, String(body.npc || ''));
    if (!card) return sendJson(res, 400, { ok: false, error: 'unknown craftsman' });
    const n = state.npcs[card.id];
    if (n.ai) card.todaysPlan = n.ai.why;
    const credit = creditPolicy(state, body.player, card.id);
    const order = commissionPolicy(state, body.player, card.id);
    const r = await askCraftsman(card, body.q, String(body.lang || 'en').slice(0, 5), body.player, credit, order);
    if (r.ok && r.lend > 0) { r.credit = giveCredit(state, body.player, card.id, r.lend); if (r.credit) { save(); broadcast(); } }
    if (r.ok && r.make > 0) { const o = orderFromChat(state, body.player, card.id, r.make); if (o && o.ok) { r.order = o; save(); broadcast(); } }
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
  }

  // the exact JSON of a morning plan (its SHA-256 is in the memo on NEAR), and the TEE proof
  if (url.pathname === '/api/ai/plan') {
    const d = Number(url.searchParams.get('day')), rec = (state.aiLog || []).find((x) => x.day === d) || (state.aiLog || [])[0];
    if (!rec) return sendJson(res, 404, { ok: false, error: 'no plan yet' });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Plan-Sha256': rec.hash });
    return res.end(rec.json);
  }
  if (url.pathname === '/api/ai/attestation') return sendJson(res, ai.attestFull ? 200 : 404, ai.attestFull || { ok: false, error: 'no attestation yet' });

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
    if (r.ok) broadcast();
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
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
