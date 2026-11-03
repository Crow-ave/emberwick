// Emberwick game server. Run `npm install` once, then `npm start`.
// The NEAR bridge is optional: without it (or offline) the game still runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createState, tick, joinPlayer, playerAction, publicView, onTransfer, linkWallet, withdraw, depositIn } from './economy.js';
import crypto from 'node:crypto';
import { BUILDINGS, GOODS, START_PATHS, RULES, TOKEN, PATH_ROUTE, CRAFTSMEN } from './world.js';
import { Bridge, makeNearAdapter, fileStore } from './near.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(root, 'public');
const SAVE = path.join(root, 'data', 'state.json');
const PORT = Number(process.env.PORT) || 3000;

let state;
try {
  state = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
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
    say: (m) => console.log('[NEAR] ' + m),
  });
  onTransfer((from, to, amount, note) => bridge.onTransfer(from, to, amount, note));
  let lastStatus = '';
  const loop = async () => {
    await bridge.step();
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
}
const challenges = new Map(); // playerId -> one-time wallet sign-in message
const chainView = () => (bridge ? bridge.view() : { status: 'off' });
const view = (pid) => ({ ...publicView(state, pid), chain: chainView() });

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

setInterval(() => {
  tick(state);
  broadcast();
  if (state.tick % 10 === 0) save();
}, RULES.tickMs);

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
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/join') {
    const body = await readBody(req);
    const r = joinPlayer(state, body.name, body.path);
    if (r.ok) { save(); broadcast(); }
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    const body = await readBody(req);
    const r = playerAction(state, body.player, body);
    if (r.ok) broadcast();
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: view(body.player) });
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Emberwick is running${RULES.demo ? ' in DEMO speed' : ''}: open http://localhost:${PORT} in your browser.`);
  startNear();
});
process.on('SIGINT', () => { save(); process.exit(0); });
