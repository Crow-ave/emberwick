// The craftsmen think with NEAR AI Cloud (OpenAI-compatible, TEE-backed private inference).
// Each morning one request plans the day for all craftsmen; players can also ask a craftsman a question.
// The AI only chooses inside safe limits (see applyAiPlan in economy.js); the village rules still guard
// every coin. Without a key, offline, or over the daily limit, the craftsmen keep their rule-based habits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const BASE = (process.env.NEARAI_BASE || 'https://cloud-api.near.ai/v1').replace(/\/$/, '');
const MODE = process.env.EMBERWICK_AI || ''; // '0' = off, 'fake' = test replies without the network
function readKey() {
  if (process.env.NEARAI_API_KEY) return process.env.NEARAI_API_KEY.trim();
  try { return fs.readFileSync(path.join(os.homedir(), '.emberwick', 'nearai-key.txt'), 'utf8').trim(); } catch { return ''; }
}
const KEY = MODE === '0' ? '' : readKey();
// small, fast instruct models first; TEE-hosted open models are preferred over proxied ones
const PREFER = ['Qwen/Qwen3-30B-A3B-Instruct-2507', 'openai/gpt-oss-120b', 'zai-org/GLM-5.1-FP8', 'deepseek-ai/DeepSeek-V3.1', 'openai/gpt-5.4-mini', 'anthropic/claude-haiku-4-5'];
const DAILY_LIMIT = Number(process.env.NEARAI_DAILY_LIMIT) || 400; // requests per real day, all together
const ASK_PER_PLAYER = 12; // questions per player per real day

export const ai = {
  status: MODE === 'fake' ? 'ready' : KEY ? 'starting' : 'off',
  provider: 'NEAR AI Cloud', model: MODE === 'fake' ? 'test-model' : process.env.NEARAI_MODEL || null,
  calls: 0, day: '', lastError: null, lastPlanAt: null, asked: {},
};

function countCall() {
  const d = new Date().toISOString().slice(0, 10);
  if (ai.day !== d) { ai.day = d; ai.calls = 0; ai.asked = {}; }
  if (ai.calls >= DAILY_LIMIT) return false;
  ai.calls++;
  return true;
}

// fetch first; if the connection itself fails (some networks drop the first tries), retry with
// node:https over IPv4 and a longer connect time
let slowNet = false; // once the slow way worked, keep using it (no 10 s wait every time)
// ms is how long to wait for the whole answer: a thinking model can take a minute or more for a plan.
// Only a failed *connection* is retried the other way; a slow answer is not asked twice (that would cost twice)
async function api(p, body, ms = 30000) {
  if (slowNet) return viaHttps(p, body, ms);
  try { return await viaFetch(p, body, ms); }
  catch (e) {
    if (!/fetch failed|ECONN|UND_ERR_CONNECT|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(String(e.message))) throw e;
    const r = await viaHttps(p, body, ms);
    if (!slowNet) { slowNet = true; console.log('[AI] slow connection to NEAR AI: using the longer-wait connection from now on.'); }
    return r;
  }
}
async function viaFetch(p, body, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(BASE + p, {
      method: body ? 'POST' : 'GET', signal: ctl.signal,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 140)}`);
    return JSON.parse(text);
  } catch (e) {
    // "fetch failed" alone says nothing; the cause says why (no internet, DNS, certificate, timeout ...)
    const c = e.cause;
    if (c) throw new Error(`${e.message} (${[c.code, c.message].filter(Boolean).join(': ').slice(0, 160)})`);
    if (e.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally { clearTimeout(timer); }
}
function viaHttps(p, body, ms) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p), data = body ? JSON.stringify(body) : null;
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: data ? 'POST' : 'GET', family: 4, timeout: ms,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 140)}`));
        try { resolve(JSON.parse(text)); } catch { reject(new Error('bad reply')); }
      });
    });
    let connected = false;
    req.on('socket', (sk) => sk.on('secureConnect', () => { connected = true; }));
    req.on('timeout', () => req.destroy(new Error(connected ? `no answer from ${u.hostname} within ${Math.round(ms / 1000)} s (the model is slow or busy)` : `no connection to ${u.hostname} after ${Math.round(ms / 1000)} s (network or firewall)`)));
    req.on('error', (e) => reject(new Error(`retry failed: ${e.code || ''} ${e.message}`.trim().slice(0, 160))));
    if (data) req.write(data);
    req.end();
  });
}

// ask a model to switch off long thinking (models ignore what they do not know; a 400 means it refused)
const THINK_OFF = { chat_template_kwargs: { enable_thinking: false, thinking: false }, reasoning_effort: 'low' };
async function testModel(m) {
  for (const params of [{}, THINK_OFF]) {
    try {
      const r = await api('/chat/completions', { model: m, messages: [{ role: 'user', content: 'Reply with exactly this JSON and nothing else: {"ok":true}' }], max_tokens: 300, temperature: 0, ...params }, 60000);
      const c = (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '';
      if (/\{\s*"ok"\s*:\s*true\s*\}/.test(c.replace(/<think>[\s\S]*?<\/think>/g, ''))) return { params };
    } catch (e) { if (!/HTTP 400/.test(e.message)) return null; }
  }
  return null;
}

// pick a model the account can use (or the one set in NEARAI_MODEL)
export async function startAi() {
  if (MODE === 'fake' || !KEY) return ai;
  if (ai.model) { ai.status = 'ready'; return ai; }
  try {
    const list = await api('/models');
    const all = list.data || [];
    const ids = all.map((m) => m.id);
    const tee = new Set(all.filter((m) => m.verifiable || m.attestationSupported || m.attestation_supported || /tee|confidential/i.test(JSON.stringify(m.metadata || m.tags || ''))).map((m) => m.id));
    const chatOk = (id) => !/embed|rerank|whisper|flux|image|tts|audio|vision-only/i.test(id);
    // a verifiable model running in NEAR's TEE comes first, then the small fast ones in PREFER
    ai.model = PREFER.find((m) => ids.includes(m) && tee.has(m)) || ids.find((id) => tee.has(id) && chatOk(id) && /qwen|glm|gpt-oss|deepseek|llama/i.test(id)) ||
      PREFER.find((m) => ids.includes(m)) || ids.find((id) => chatOk(id) && /instruct|chat|gpt|qwen|llama|glm|deepseek/i.test(id)) || ids[0] || null;
    ai.tee = tee.has(ai.model);
    console.log(`[AI] ${ids.length} models on this account${tee.size ? `, ${tee.size} verifiable (TEE)` : ''}.`);
    if (all[0]) console.log('[AI] model fields:', Object.keys(all[0]).join(', ').slice(0, 200));
    // no TEE flag in the list? Ask for an attestation report: an open model that has one runs in NEAR's TEE.
    // Then a tiny test: thinking models can spend the whole answer on reasoning and send nothing back,
    // so the first one that answers a short JSON question directly is used.
    if (!ai.tee && !process.env.NEARAI_MODEL) {
      const rank = (id) => (/instruct/i.test(id) ? 0 : /gpt-oss/i.test(id) ? 1 : /thinking|reason|r1\b|flash/i.test(id) ? 3 : 2);
      const open = [...PREFER.filter((m) => ids.includes(m) && !/^(openai\/gpt-5|anthropic|google)/.test(m)),
        ...ids.filter((id) => /qwen|glm|gpt-oss|deepseek|llama|kimi|mistral/i.test(id) && chatOk(id))].filter((v, k, a) => a.indexOf(v) === k)
        .sort((a, b) => rank(a) - rank(b)).slice(0, 8);
      console.log('[AI] trying:', open.join(', '));
      let fallback = null;
      for (const m of open) {
        let att;
        try { att = await api(`/attestation/report?model=${encodeURIComponent(m)}&signing_algo=ecdsa`, null, 30000); }
        catch (e) { console.log(`[AI] ${m}: no attestation (${String(e.message).slice(0, 60)})`); continue; }
        if (!(att.model_attestations || []).length) continue;
        fallback = fallback || { m, att };
        const extra = await testModel(m);
        if (extra) { ai.model = m; ai.extra = extra.params; ai.tee = true; ai.attestFull = att; console.log(`[AI] ${m} has a TEE attestation and answers directly: using it.`); break; }
        console.log(`[AI] ${m}: TEE ok, but it does not answer directly (a thinking model); trying the next one.`);
      }
      if (!ai.tee && fallback) { ai.model = fallback.m; ai.tee = true; ai.attestFull = fallback.att; ai.extra = THINK_OFF; console.log(`[AI] using ${fallback.m} with thinking turned down.`); }
    }
    ai.status = ai.model ? 'ready' : 'error';
    if (!ai.model) ai.lastError = 'no models';
  } catch (e) {
    ai.model = PREFER[0]; ai.status = 'ready'; // try the default model anyway
    ai.lastError = String(e.message || e).slice(0, 160);
    console.log('[AI] could not list models:', ai.lastError);
  }
  console.log(`[AI] ${ai.status === 'ready' ? `craftsmen think with ${ai.provider} (${ai.model}${ai.tee ? ', private TEE' : ''})` : 'off'}`);
  return ai;
}

// thinking models spend part of max_tokens on reasoning before the answer, so the limits are generous
// and the answer is taken from content (or, if that is empty, from the end of the reasoning)
async function chat(messages, maxTokens) {
  if (!countCall()) throw new Error('daily limit reached');
  const r = await api('/chat/completions', { model: ai.model, messages, max_tokens: maxTokens, temperature: 0.7, ...(ai.extra || {}) }, maxTokens > 2000 ? 180000 : 90000);
  const c = r.choices && r.choices[0], msg = (c && c.message) || {};
  let text = String(msg.content || '').trim();
  if (!text) {
    const why = String(msg.reasoning_content || msg.reasoning || '');
    if (/\{[\s\S]*\}/.test(why)) text = why;
    if (!text) throw new Error(`empty answer (finish: ${c && c.finish_reason}${why ? ', it only thought' : ''})`);
  }
  return text;
}

// read the first complete JSON object in a reply: walk the braces (minding strings) instead of taking
// "first { to last }", so text or a second object after it does no harm; small slips are repaired
function jsonIn(text) {
  const s = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(json)?/gi, '');
  for (let a = s.indexOf('{'); a >= 0; a = s.indexOf('{', a + 1)) {
    let depth = 0, inStr = false, esc = false, b = -1;
    for (let k = a; k < s.length; k++) {
      const ch = s[k];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { b = k; break; }
    }
    const chunk = b > a ? s.slice(a, b + 1) : s.slice(a); // an answer cut short: try to close it
    for (const t of [chunk, chunk.replace(/,\s*([}\]])/g, '$1'), closeUp(chunk)]) {
      try { const o = JSON.parse(t); if (o && typeof o === 'object') return o; } catch {}
    }
  }
  return null;
}
// close an answer that stopped in the middle: drop the unfinished last entry and add the missing brackets
function closeUp(t) {
  let s = t.replace(/,\s*"[^"]*"?\s*:?\s*[^,{}\[\]]*$/, '');
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') stack.push(ch); else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) s += '"';
  return s.replace(/,\s*$/, '') + stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
}

const SYSTEM_PLAN = 'You are the minds of the craftsmen of Emberwick, a small medieval village whose money is EMWK (a NEAR token with a fixed supply). ' +
  'Each craftsman runs a shop with its own wallet. Every morning you plan the day for each one, using the numbers you are given. ' +
  'For each good, "want" scales how much stock the craftsman aims to keep (0.7 = keep less, 1.4 = stock up); a higher target means they buy more and pay more. ' +
  '"price" nudges the price they ask for goods they sell (0.9 = discount, 1.1 = premium). Think like a sensible shopkeeper: stock up before winter or a dragon attack, ' +
  'discount what piles up, keep enough cash. Reply with JSON only, no other text: ' +
  '{"craftsmen":[{"id":"...","want":{"good":1.0},"price":{"good":1.0},"why":"one short reason, max 14 words","say":"one in-character sentence to customers, max 16 words"}]}';

// the morning plan for every craftsman, in one request
export async function planDay(brief) {
  if (MODE === 'fake') {
    return { craftsmen: brief.craftsmen.map((c) => ({ id: c.id, want: Object.fromEntries(Object.keys(c.goods).map((g) => [g, 1.2])), price: {}, why: `Test plan for ${c.id}.`, say: `Fresh goods today at the ${c.id}!` })) };
  }
  if (ai.status !== 'ready') return null;
  const msgs = [{ role: 'system', content: SYSTEM_PLAN }, { role: 'user', content: JSON.stringify(brief) }];
  let text = await chat(msgs, 3000), plan = null;
  try { plan = jsonIn(text); } catch {}
  if (!plan || !Array.isArray(plan.craftsmen)) {
    console.log('[AI] the plan came back unreadable, asking once more. It ended with:', text.replace(/\s+/g, ' ').slice(-160));
    text = await chat([...msgs, { role: 'assistant', content: text.slice(0, 1500) }, { role: 'user', content: 'Reply again with only the JSON object, nothing before or after it.' }], 3000);
    try { plan = jsonIn(text); } catch {}
  }
  if (!plan || !Array.isArray(plan.craftsmen)) throw new Error('the model did not return a plan: ' + text.replace(/\s+/g, ' ').slice(0, 100));
  ai.lastPlanAt = Date.now(); ai.lastError = null; ai.planFailed = false;
  console.log(`[AI] morning plan received for ${plan.craftsmen.length} craftsmen.`);
  return plan;
}

const LANGS = { en: 'English', tr: 'Turkish', fr: 'French', de: 'German', ru: 'Russian', zh: 'Simplified Chinese' };

// a player asks a craftsman something; the answer is words, plus (only at the bakery or inn, and only
// inside what the rules allow) a little food on credit. The last few lines are remembered, so a
// conversation can go on
const convs = new Map(); // `${player}:${npc}` -> recent messages
export async function askCraftsman(card, question, lang, playerId, credit = null) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!q) return { ok: false, error: 'empty' };
  const d = new Date().toISOString().slice(0, 10);
  if (ai.day !== d) { ai.day = d; ai.calls = 0; ai.asked = {}; convs.clear(); }
  const n = (ai.asked[playerId] || 0);
  if (n >= ASK_PER_PLAYER) return { ok: false, error: 'limit', code: 'ai.limit' };
  const key = `${playerId}:${card.id}`, past = convs.get(key) || [];
  const remember = (a) => convs.set(key, [...past, { role: 'user', content: q }, { role: 'assistant', content: a }].slice(-8));
  if (MODE === 'fake') {
    ai.asked[playerId] = n + 1;
    const lend = credit && credit.ok && /hungry|aç|credit|borç/i.test(q) ? 1 : 0;
    const answer = `(${card.name}) I heard: "${q}". Today I keep ${Object.keys(card.goods).join(', ')}.` + (lend ? ' Here, take it on credit.' : '');
    remember(answer);
    return { ok: true, answer, lend, model: ai.model };
  }
  if (ai.status !== 'ready') return { ok: false, error: 'off', code: 'ai.off' };
  const creditRule = !credit ? 'You never give goods on credit.' : credit.ok
    ? `If the customer is hungry and asks for food on credit, you may give up to ${credit.max} ${credit.good} on credit (${credit.unitPrice} EMWK each, paid back within ${credit.payBackWithinDays} days). Decide like a kind but careful shopkeeper. If you give it, end your reply with the tag [LEND n] where n is how many. Never lend unless they ask.`
    : `If they ask for food on credit, refuse kindly: ${credit.reason}.`;
  try {
    ai.asked[playerId] = n + 1;
    const raw = await chat([
      { role: 'system', content: `You are ${card.name} in the village of Emberwick, a medieval economy game whose money is EMWK. Stay in character, be warm and practical, talk like a real villager. ` +
        `Answer in ${LANGS[lang] || 'English'} in at most 2 short sentences. When you name a price, use exactly the price in priceList (sellsAt / buysAt); recipe numbers are amounts, never prices. You cannot give away money. ${creditRule} Facts: ${JSON.stringify(card)}` },
      ...past,
      { role: 'user', content: q },
    ], 900);
    let answer = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const m = /\[\s*LEND\s*(\d+)\s*\]/i.exec(answer);
    answer = answer.replace(/\[\s*LEND\s*\d*\s*\]/gi, '').trim().slice(0, 400);
    remember(answer);
    return { ok: true, answer, lend: m && credit && credit.ok ? Number(m[1]) : 0, model: ai.model };
  } catch (e) {
    ai.lastError = String(e.message || e).slice(0, 160);
    console.log('[AI] answer failed:', ai.lastError);
    return { ok: false, error: ai.lastError, code: 'ai.busy' };
  }
}

// the craftsman's answer when a player haggles. The decision and the numbers are already fixed by the
// village rules; the model only says it, in character and in the player's language
const HAGGLE_PER_PLAYER = 40;
const SAY = {
  accept: 'You agree to the deal at the final price per unit (the customer still has to say yes). Sound pleased, maybe a little grudging if it was a hard bargain. If the final price is better for the customer than what they offered, tell them honestly you keep to your own fair price.',
  counter: 'You do not accept their price, but you propose the counter price per unit. Haggle like a real market seller.',
  favor: 'Their price is too far from yours and you say so, but because they are a good customer you make them a special offer at the counter price per unit.',
  angry: 'Their offer insults you. React offended (no insults, no swearing) and refuse; make no new offer.',
  closed: 'You are done haggling with this customer for today. Refuse firmly but politely.',
  final: 'This is your final word: the counter price per unit, take it or leave it.',
};
export async function haggleLine(card, deal, lang, playerName, playerId) {
  if (MODE === 'fake') return `(${deal.outcome}) ${deal.unit ?? ''}`;
  if (ai.status !== 'ready') return null;
  const d = new Date().toISOString().slice(0, 10);
  if (ai.day !== d) { ai.day = d; ai.calls = 0; ai.asked = {}; }
  const k = 'h:' + playerId;
  if ((ai.asked[k] || 0) >= HAGGLE_PER_PLAYER) return null;
  ai.asked[k] = (ai.asked[k] || 0) + 1;
  // only the numbers the craftsman may say: their offer, the final price per unit, how many, and the total
  const hasPrice = deal.unit !== null && deal.unit !== undefined && deal.outcome !== 'angry' && deal.outcome !== 'closed';
  const total = hasPrice ? Math.round(deal.unit * deal.qty * 100) / 100 : null;
  const facts = { customer: playerName, theyWant: deal.side === 'buy' ? 'to buy from you' : 'to sell to you', good: deal.good, quantity: deal.qty,
    theirOfferPerUnit: deal.offer, ...(hasPrice ? { finalPricePerUnit: deal.unit, totalForAll: total } : {}), currency: 'EMWK' };
  try {
    const text = await chat([
      { role: 'system', content: `You are ${card.name}, a shopkeeper in the medieval village of Emberwick. ${SAY[deal.outcome] || ''} ` +
        `The only numbers you may say are the ones in the facts (${hasPrice ? 'finalPricePerUnit is the price you give' : 'make no price at all'}); never any other number. Answer in ${LANGS[lang] || 'English'} in 1 or 2 short, lively sentences. Facts: ${JSON.stringify(facts)}` },
      { role: 'user', content: `${playerName} offers ${deal.offer} EMWK per ${deal.good}.` },
    ], 800);
    const line = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<[^>]*>/g, '').trim().slice(0, 300);
    // a number that is not one of the real ones means the model made it up: use the built-in line instead
    const ok = [deal.offer, deal.unit, deal.qty, total].filter((x) => x !== null && x !== undefined).map(Number);
    const said = (line.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
    if (said.some((x) => !ok.some((y) => Math.abs(x - y) < 0.051))) { console.log('[AI] haggle line used a wrong number, using the built-in line.'); return null; }
    return line || null;
  } catch (e) { ai.lastError = String(e.message || e).slice(0, 160); return null; }
}

// proof of where the thinking runs: NEAR AI Cloud's TEE attestation report (Intel TDX quote and the
// enclave's signing key), fetched with a fresh nonce. The full report is served at /api/ai/attestation.
export async function fetchAttestation() {
  if (MODE === 'fake') { ai.attest = { at: Date.now(), signer: '0xtest0000000000', algo: 'ecdsa', quote: true, models: 1, nonce: 'test' }; return ai.attest; }
  if (ai.status !== 'ready' || !KEY) return null;
  const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  const q = (n) => `/attestation/report?model=${encodeURIComponent(ai.model)}${n ? '&nonce=' + n : ''}&signing_algo=ecdsa`;
  try {
    let r;
    try { r = await api(q(nonce), null, 30000); }
    catch (e) {
      if (/HTTP 400/.test(e.message)) r = await api(q(''), null, 30000);
      // a model proxied to another provider has no enclave of its own: the NEAR AI gateway's TEE report is still there
      else r = await api(`/attestation/report?nonce=${nonce}&signing_algo=ecdsa`, null, 30000);
    }
    const g = r.gateway_attestation || {}, m = (r.model_attestations || [])[0] || {};
    ai.attestFull = r;
    ai.attest = { at: Date.now(), signer: m.signing_address || g.signing_address || null, algo: m.signing_algo || g.signing_algo || null, quote: !!(m.intel_quote || g.intel_quote), models: (r.model_attestations || []).length, nonce: g.request_nonce || nonce, gateway: g.signing_address || null, gatewayOnly: !(r.model_attestations || []).length };
    if (ai.attest.models > 0) ai.tee = true;
    console.log(`[AI] TEE attestation received (${ai.attest.models} model report${ai.attest.models === 1 ? '' : 's'}).`);
  } catch (e) { ai.attest = { at: Date.now(), error: String(e.message || e).slice(0, 120) }; console.log('[AI] attestation not available:', ai.attest.error); }
  return ai.attest;
}

export const aiPublic = () => ({ status: ai.status, provider: ai.provider, model: ai.model, tee: !!ai.tee, attest: ai.attest || null, lastPlanAt: ai.lastPlanAt, planFailed: !!ai.planFailed, error: ai.lastError ? String(ai.lastError).slice(0, 120) : null });
