// Emberwick HTTP security check: a player id alone cannot act for that player.
// Starts a throwaway server (no NEAR, no AI, its own save file) and tries the attacks a reviewer would try.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emberwick-http-'));
const PORT = 30000 + Math.floor(Math.random() * 20000);
const env = { ...process.env, PORT: String(PORT), EMBERWICK_SAVE: path.join(dir, 'state.json'), EMBERWICK_KEYS: path.join(dir, 'none.json'), EMBERWICK_NEAR: 'off', EMBERWICK_AI: '0', NEARAI_API_KEY: '' };
const srv = spawn(process.execPath, [path.join(here, 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const post = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/world`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  console.log('== player keys');
  const a = await post('/api/join', { name: 'Alice', path: 'miner' });
  check(a.j.ok && typeof a.j.key === 'string' && a.j.key.length >= 32, 'joining returns a long random key');
  const b = await post('/api/join', { name: 'Mallory', path: 'miner' });
  const pid = a.j.id;
  const noKey = await post('/api/action', { player: pid, action: { type: 'gather', spot: 'mine' } });
  check(noKey.status === 403 && noKey.j.code === 'err.notYou', 'acting for a player with only their id is refused');
  const wrong = await post('/api/action', { player: pid, key: b.j.key, action: { type: 'gather', spot: 'mine' } });
  check(wrong.status === 403, "acting for a player with someone else's key is refused");
  const link = await post('/api/near/link', { player: pid, key: b.j.key, account: 'mallory.testnet' });
  check(link.status === 403, 'linking a wallet to someone else is refused');
  const out = await post('/api/near/withdraw', { player: pid, key: b.j.key, amount: 5 });
  check(out.status === 403, "cashing out someone else's coins is refused");
  const own = await post('/api/action', { player: pid, key: a.j.key, action: { type: 'gather', spot: 'mine' } });
  check(own.status !== 403, 'the player with their own key can act');
  const claim = await post('/api/claim', { player: pid });
  check(claim.status === 403 && !claim.j.key, 'a player who has a key cannot be claimed again');
  const v1 = await post('/api/near/link', { player: pid, key: a.j.key, account: 'alice.testnet' });
  check(v1.status === 200, 'a player can link a wallet with their own key');
  const sl = []; for (let i = 0; i < 8; i++) sl.push((await post('/api/join', { name: 'Spam' + i, path: 'miner' })).status);
  check(sl.includes(429), 'joining again and again from one address is slowed down (' + sl.join(',') + ')');
  const st = await (await fetch(`http://127.0.0.1:${PORT}/api/state?player=${b.j.id}`)).json();
  check(!JSON.stringify(st).includes(a.j.key) && !JSON.stringify(st).includes('playerKeys'), 'keys never appear in the shared view');
} catch (e) { console.log('  FAIL', e.message); fails++; }
srv.kill();
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} HTTP check(s) failed.` : '\nAll HTTP security checks passed.');
process.exit(fails ? 1 : 0);
