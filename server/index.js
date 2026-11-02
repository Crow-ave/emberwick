// Emberwick game server. No external packages needed: run `npm start`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, tick, joinPlayer, playerAction, publicView } from './economy.js';
import { BUILDINGS, GOODS, START_PATHS, RULES, TOKEN, PATH_ROUTE } from './world.js';

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

function save() {
  fs.mkdirSync(path.dirname(SAVE), { recursive: true });
  fs.writeFileSync(SAVE + '.tmp', JSON.stringify(state));
  fs.renameSync(SAVE + '.tmp', SAVE); // never leaves a half-written save
}

// live updates to every open browser
const clients = new Map(); // res -> playerId
function broadcast() {
  for (const [res, pid] of clients) res.write(`data: ${JSON.stringify(publicView(state, pid))}\n\n`);
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
  if (url.pathname === '/api/state') return sendJson(res, 200, publicView(state, url.searchParams.get('player')));

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.set(res, url.searchParams.get('player'));
    res.write(`data: ${JSON.stringify(publicView(state, url.searchParams.get('player')))}\n\n`);
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
    return sendJson(res, r.ok ? 200 : 400, { ...r, state: publicView(state, body.player) });
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

server.listen(PORT, () => console.log(`Emberwick is running: open http://localhost:${PORT} in your browser.`));
process.on('SIGINT', () => { save(); process.exit(0); });
