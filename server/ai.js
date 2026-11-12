// The craftsmen think with NEAR AI Cloud (OpenAI-compatible, TEE-backed private inference).
// Each morning one request plans the day for all craftsmen; players can also ask a craftsman a question.
// The AI only chooses inside safe limits (see applyAiPlan in economy.js); the village rules still guard
// every coin. Without a key, offline, or over the daily limit, the craftsmen keep their rule-based habits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { LAND, DISTRICTS, HOUSES, RULES } from './world.js';

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
async function api(p, body, ms = 30000) { return (await apiRaw(p, body, ms)).json; }
// the exact bytes sent and received are kept: a chat answer's signature covers their SHA-256
async function apiRaw(p, body, ms = 30000) {
  const data = body ? JSON.stringify(body) : null;
  let text;
  if (slowNet) text = await viaHttps(p, data, ms);
  else {
    try { text = await viaFetch(p, data, ms); }
    catch (e) {
      if (!/fetch failed|ECONN|UND_ERR_CONNECT|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(String(e.message))) throw e;
      text = await viaHttps(p, data, ms);
      if (!slowNet) { slowNet = true; console.log('[AI] slow connection to NEAR AI: using the longer-wait connection from now on.'); }
    }
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('bad reply'); }
  return { json, text, sent: data };
}
async function viaFetch(p, data, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(BASE + p, {
      method: data ? 'POST' : 'GET', signal: ctl.signal,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: data || undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 140)}`);
    return text;
  } catch (e) {
    // "fetch failed" alone says nothing; the cause says why (no internet, DNS, certificate, timeout ...)
    const c = e.cause;
    if (c) throw new Error(`${e.message} (${[c.code, c.message].filter(Boolean).join(': ').slice(0, 160)})`);
    if (e.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally { clearTimeout(timer); }
}
// one connection kept open and reused: on a slow network setting up a new one can take 15-60 s
const keepAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 4, family: 4 });
function viaHttps(p, data, ms) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: data ? 'POST' : 'GET', agent: keepAgent, timeout: ms,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 140)}`));
        resolve(text);
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
    // no embedding/audio/image models, and never models with their safety training removed
    const chatOk = (id) => !/embed|rerank|whisper|flux|image|tts|audio|vision-only|abliterat|uncensor|jailbreak/i.test(id);
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
      // strong multilingual chat models first (good Turkish matters), then instruct models; vision (VL) and
      // thinking models last
      const rank = (id) => (/thinking|reason|r1\b|flash/i.test(id) ? 6 : /-vl-|vision/i.test(id) ? 5 : /deepseek-v3/i.test(id) ? 0 : /kimi-k2/i.test(id) ? 1 : /qwen3\.[5-9]|glm-[45]/i.test(id) ? 2 : /instruct/i.test(id) ? 3 : 4);
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
  const raw = await apiRaw('/chat/completions', { model: ai.model, messages, max_tokens: maxTokens, temperature: 0.7, ...(ai.extra || {}) }, maxTokens > 2000 ? 180000 : 90000);
  const r = raw.json;
  ai.lastCall = { id: r.id || null, model: ai.model, at: Date.now(), sent: raw.sent, received: raw.text };
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
  '"price" nudges the price they ask for goods they sell (0.9 = discount, 1.1 = premium). ' +
  'Your goal for every shop: make a profit over the coming days without letting its shelves run empty. ' +
  'Use the numbers: "profitYesterday" is how the wallet changed yesterday, "margin" is what one batch costs to make at today\'s buying prices and what it sells for, ' +
  '"stock" and "target" show what is on the shelf, and "soldRecently" shows demand. ' +
  'Rules of thumb: leave a value at 1.0 unless the numbers give a reason, and change only a few goods a day. ' +
  'Stocking up costs money: raise "want" above 1.0 only for a good that sold out recently or that winter or the dragon will make scarce, and keep it at 1.2 or less. ' +
  'If a shop lost money yesterday or its margin is thin, lower "want" for its raw materials (0.8 to 0.9) and do not discount. ' +
  'Discount only what piles up well above target and is not selling; ask a premium only for what is scarce and still selling. ' +
  'Reply with JSON only, no other text: ' +
  '{"craftsmen":[{"id":"...","want":{"good":1.0},"price":{"good":1.0},"why":"one short reason, max 14 words","say":"one in-character sentence to customers, max 16 words"}]}';

// the morning plan for every craftsman, in one request
export async function planDay(brief) {
  if (MODE === 'fake') {
    return { craftsmen: brief.craftsmen.map((c) => ({ id: c.id, want: Object.fromEntries(Object.keys(c.goods).map((g) => [g, 1.2])), price: {}, why: `Test plan for ${c.id}.`, say: `Fresh goods today at the ${c.id}!` })), _proof: { ok: true, test: true, chatId: null, signer: '0xtest0000000000' } };
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
  plan._proof = await verifyAnswer(ai.lastCall);
  return plan;
}

const LANGS = { en: 'English', tr: 'Turkish', fr: 'French', de: 'German', ru: 'Russian', zh: 'Simplified Chinese' };

// each craftsman's character, so they do not all sound the same
const PERSONA = {
  woodcutter: 'gruff and of few words, smells of pine, proud of the forest; short sentences',
  mill: 'slow and cheerful, always talks about the weather and the harvest',
  bakery: 'warm and motherly, worries that people eat enough',
  smithy: 'loud and blunt, loves good steel, hates haggling over swords',
  carpenter: 'careful and precise, measures twice, proud of beds and carts',
  inn: 'chatty and kind, knows all the village gossip',
  tailor: 'elegant and a little vain, cares about warm, beautiful clothes',
  tower: 'a stern soldier who buys swords and bread to guard against the dragon',
};
// a player talks to a craftsman. The model answers in character AND may suggest actions (buy, sell, order,
// credit, go to another place). The suggestions are checked by the village rules and shown as buttons:
// nothing happens unless the player presses one. The last few lines are remembered.
const convs = new Map(); // `${player}:${npc}` -> recent messages
// How the village works, from the game's own rules, so every craftsman can answer common questions itself
// instead of sending the customer around the village
const VILLAGE_FACTS = () => [
  `Building a home: buy a plot of land at the exchange or from its For sale sign (village plots about ${Math.round(LAND.price * 1.2)}-${Math.round(LAND.price * 1.4)} EMWK; Ember Lane plots are cheaper once the council opens that neighbourhood; Villa hill needs level 5), then on your own plot press Build: it takes ${LAND.build.lumber} lumber and a ${LAND.build.fee} EMWK work fee to the carpenter (Villa hill: ${DISTRICTS[2].build.lumber} lumber and ${DISTRICTS[2].build.fee} EMWK). Lumber is sold by the woodcutter, and the carpenter buys it.`,
  `A bed (bought from the carpenter) lets you sleep in your own home. A home can also be rented out for daily rent (${LAND.lease.min}-${LAND.lease.max} EMWK a day).`,
  `Sleeping: own home, a rented village house (rent ${HOUSES['house-1'].rent}-${HOUSES['house-3'].rent} EMWK a day), or an inn bed for ${RULES.innBed} EMWK a night. A night outside costs energy.`,
  `Food: every morning a player who played the day before eats ${RULES.dailyBread} bread (from the bag, or bought at the bakery).`,
  'Tools: pickaxe from the smith, axe from the woodcutter, plow from the miller, shears from the tailor, fishing rod from the carpenter. Tools wear out. A winter coat comes from the tailor.',
].join(' ');

export async function askCraftsman(card, question, lang, playerId, ctx = {}) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!q) return { ok: false, error: 'empty' };
  const d = new Date().toISOString().slice(0, 10);
  if (ai.day !== d) { ai.day = d; ai.calls = 0; ai.asked = {}; convs.clear(); }
  const n = (ai.asked[playerId] || 0);
  if (n >= ASK_PER_PLAYER) return { ok: false, error: 'limit', code: 'ai.limit' };
  const key = `${playerId}:${card.id}`, past = convs.get(key) || [];
  const remember = (a) => convs.set(key, [...past, { role: 'user', content: q }, { role: 'assistant', content: a }].slice(-8));
  const { credit, order, village, customer } = ctx;
  if (MODE === 'fake') {
    ai.asked[playerId] = n + 1;
    const acts = [];
    if (credit && credit.ok && /hungry|aç|credit|borç|veresiye/i.test(q)) acts.push({ type: 'credit', qty: 1 });
    if (order && /\b(order|make|dik|yap|sipariş)\b/i.test(q)) acts.push({ type: 'order', n: 1 });
    const firstSold = Object.entries(card.goods).find(([, x]) => x.sellsAt !== undefined);
    if (firstSold && /\b(buy|al|satın)\b/i.test(q)) acts.push({ type: 'buy', good: firstSold[0], qty: 1 });
    if (/kanepe|sofa/i.test(q)) acts.push({ type: 'goto', place: 'carpenter' });
    const num = q.match(/(\d+(?:[.,]\d+)?)\s*emwk/i);
    if (firstSold && num) acts.push({ type: 'haggle', side: 'buy', good: firstSold[0], qty: 1, price: Number(num[1].replace(',', '.')) });
    const answer = `(${card.name}) I heard: "${q}".`;
    remember(answer);
    return { ok: true, answer, actions: acts, model: ai.model };
  }
  if (ai.status !== 'ready') return { ok: false, error: 'off', code: 'ai.off' };
  const orderTxt = !order ? 'This shop takes no orders.' : `Order service: from the customer's own ${Object.entries(order.inputs).map(([g, q2]) => q2 + ' ' + g).join(' + ')} you make ${order.outQty} ${order.output} for a ${order.fee} EMWK work fee` + (order.ok ? ' (possible now).' : ` (not possible now: ${order.reason}).`);
  const creditTxt = !credit ? 'You never give credit.' : credit.ok ? `Credit: if the customer is hungry and asks, you may give up to ${credit.max} ${credit.good} on credit (${credit.unitPrice} EMWK each, pay back in ${credit.payBackWithinDays} days).` : `Credit: not possible (${credit.reason}).`;
  const system = `You are ${card.name} in the medieval village of Emberwick, a game whose money is EMWK. Your character: ${PERSONA[card.id] || 'a friendly villager'}. ` +
    `Answer in ${LANGS[lang] || 'English'}, in character, in at most 2 short sentences. Talk like a real villager, and react to what the customer actually said.\n` +
    `RULES: Only goods in the village directory exist. You can only: sell what your shop sells, buy what your shop buys, take an order (below), give credit (below), or send the customer to the right place. ` +
    `If they ask for something that does not exist (for example a sofa), say so kindly and suggest the closest real thing and who has it. If they need materials they do not have, tell them where to get them. Never promise anything else, never invent prices (use priceList), never pretend something happened: the customer confirms with a button. PRICES: never bargain in words. If the customer names a price different from your list price (or asks for a discount), do not accept, refuse or name a counter price yourself: say you will hear their offer at the counter, and add a haggle action with their price PER UNIT (if they named a total for several, divide it). The village rules then decide, and you answer the offer there.\n` +
    `VILLAGE FACTS (true for everyone; use them to answer how-to questions yourself, with the numbers, instead of sending the customer to someone else): ${VILLAGE_FACTS()}\n` +
    `Send the customer to another place only when that place sells or buys what they need, and then name it once, with what they should get there.\n` +
    `${orderTxt}\n${creditTxt}\n` +
    `Answer exactly what the customer just said, like a person would. Example (in English): customer "Hello baker, how are you?" -> {"say":"Hello, dear! Tired but happy, the oven has been busy since dawn. Fancy some warm bread?","actions":[{"type":"buy","good":"bread","qty":1}]}. ` +
    `Customer "I need a sofa" at the woodcutter -> {"say":"A sofa? Nobody makes those here, friend. Wren the carpenter makes beds; I can sell you lumber.","actions":[{"type":"goto","place":"carpenter"},{"type":"buy","good":"lumber","qty":1}]}.\n` +
    `Reply with JSON only: {"say":"your words","actions":[...]} where actions (0 to 3) are buttons to offer, chosen from: ` +
    `{"type":"buy","good":"<good you sell>","qty":n}, {"type":"sell","good":"<good you buy>","qty":n}, {"type":"haggle","side":"buy" (they buy from you) or "sell" (they sell to you),"good":"<good>","qty":n,"price":<their price per unit>}, {"type":"order"}, {"type":"credit","qty":n}, {"type":"goto","place":"<shop id or forest/fields/mine/pasture/pond>"}.\n` +
    `Your shop: ${card.priceList}${card.recipe ? '; ' + card.recipe : ''}; in stock: ${Object.entries(card.goods).filter(([, x]) => x.sellsAt !== undefined).map(([g, x]) => g + ' ' + x.stock).join(', ')}.\n` +
    `The customer: ${customer ? `${customer.name}, ${customer.coins} EMWK, energy ${customer.energy}, carries ${Object.entries(customer.bag).map(([g, v]) => v + ' ' + g).join(', ') || 'nothing'}` : '?'}.\n` +
    `Village (shop id: sells / buys / makes): ${(village && village.shops || []).map((x) => `${x.id}: ${x.sells.join(',')} / ${x.buys.join(',')}${x.makesFromCustomerMaterials ? ' / ' + x.makesFromCustomerMaterials : ''}`).join('; ')}. Raw goods: ${(village && village.rawGoods || []).join('; ')}. Nothing else exists.`;
  try {
    ai.asked[playerId] = n + 1;
    const raw = await chat([{ role: 'system', content: system }, ...past.slice(-4), { role: 'user', content: q }], 400);
    let o = null;
    try { o = jsonIn(raw); } catch {}
    let answer = o && typeof o.say === 'string' ? o.say : raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\{[\s\S]*\}/g, '');
    answer = String(answer).replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim().slice(0, 400) || '…';
    remember(answer);
    return { ok: true, answer, actions: o && Array.isArray(o.actions) ? o.actions : [], model: ai.model };
  } catch (e) {
    ai.lastError = String(e.message || e).slice(0, 160);
    console.log('[AI] answer failed:', ai.lastError);
    return { ok: false, error: ai.lastError, code: 'ai.busy' };
  }
}

// the craftsman's answer when a player haggles. The decision and the numbers are already fixed by the
// village rules; the model only says it, in character and in the player's language
const HAGGLE_PER_PLAYER = 40;
// what the craftsman does, from their own side of the counter. When the customer BUYS, a higher price is
// better for the craftsman; when the customer SELLS to them, a lower price is better for the craftsman.
const SAY = {
  buy: {
    accept: 'The customer wants to BUY from you. You agree to sell at finalPricePerUnit. Sound pleased.',
    fair: 'The customer wants to BUY from you and offered MORE than your price. Honestly tell them your price is lower: finalPricePerUnit.',
    counter: 'The customer wants to BUY from you, but their offer is too LOW for you. Propose finalPricePerUnit instead, like a market seller meeting halfway.',
    favor: 'The customer wants to BUY from you, but their offer is far too LOW. Say you cannot sell that cheap, but as a favour you sell to them at finalPricePerUnit.',
    angry: 'The customer wants to BUY from you and their offer is insultingly LOW. React offended (no insults, no swearing) and refuse; name no price.',
    closed: 'You are done haggling with this customer for today. Refuse firmly but politely; name no price.',
    final: 'The customer wants to BUY from you. Your final word: finalPricePerUnit, take it or leave it.',
  },
  sell: {
    accept: 'The customer wants to SELL to you. You agree to buy at finalPricePerUnit. Sound pleased.',
    fair: 'The customer wants to SELL to you and asked LESS than you would pay. Honestly tell them you pay your fair price: finalPricePerUnit.',
    counter: 'The customer wants to SELL to you, but their price is too HIGH (too expensive) for you. Offer finalPricePerUnit instead, meeting halfway.',
    favor: 'The customer wants to SELL to you, but their price is far too HIGH. Say you cannot pay that much, but as a favour you pay finalPricePerUnit.',
    angry: 'The customer wants to SELL to you at an outrageously HIGH price. React offended (no insults, no swearing) and refuse; name no price.',
    closed: 'You are done haggling with this customer for today. Refuse firmly but politely; name no price.',
    final: 'The customer wants to SELL to you. Your final word: you pay finalPricePerUnit, take it or leave it.',
  },
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
  const facts = { customer: playerName, customerIs: deal.side === 'buy' ? 'BUYING from you' : 'SELLING to you', good: deal.good, quantity: deal.qty,
    theirOfferPerUnit: deal.offer, ...(hasPrice ? { finalPricePerUnit: deal.unit, totalForAll: total } : {}), currency: 'EMWK' };
  try {
    const text = await chat([
      { role: 'system', content: `You are ${card.name}, a shopkeeper in the medieval village of Emberwick. ${(SAY[deal.side] || SAY.buy)[deal.fair ? 'fair' : deal.outcome] || ''} ` +
        `The only numbers you may say are the ones in the facts (${hasPrice ? 'finalPricePerUnit is the price you give' : 'make no price at all'}); never any other number. Answer in ${LANGS[lang] || 'English'} in 1 or 2 short, lively sentences. Facts: ${JSON.stringify(facts)}` },
      { role: 'user', content: deal.side === 'buy' ? `I want to buy ${deal.qty} ${deal.good}. I offer ${deal.offer} EMWK each.` : `I want to sell you ${deal.qty} ${deal.good}. I ask ${deal.offer} EMWK each.` },
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
    ai.tee = ai.attest.models > 0; // a model without its own report (a forced NEARAI_MODEL, a proxied model) is shown as not TEE
    console.log(`[AI] TEE attestation received (${ai.attest.models} model report${ai.attest.models === 1 ? '' : 's'}).`);
  } catch (e) { ai.attest = { at: Date.now(), error: String(e.message || e).slice(0, 120) }; console.log('[AI] attestation not available:', ai.attest.error); }
  return ai.attest;
}

// ---------- proof that one answer came from the attested enclave ----------
// The attestation report says "an enclave with signing key X runs this model". NEAR AI Cloud also signs every
// chat answer: GET /signature/{chat_id} gives the text "sha256(request body):sha256(response body)" and an
// Ethereum-style (EIP-191) ECDSA signature over it. We check three things: both hashes match the exact bytes
// we sent and received, the signature recovers to the signing address it names, and that address is one of
// the keys in the model's attestation report. Only then is the answer counted as signed by the TEE.
const sha256hex = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const enc = new TextEncoder();
function recoverEip191(text, sigHex) {
  const m = enc.encode(text), pre = enc.encode(`\x19Ethereum Signed Message:\n${m.length}`);
  const h = keccak_256(new Uint8Array([...pre, ...m]));
  const b = Buffer.from(String(sigHex).replace(/^0x/, ''), 'hex');
  if (b.length !== 65) throw new Error('signature is not 65 bytes');
  const v = b[64] >= 27 ? b[64] - 27 : b[64];
  const pub = secp256k1.Signature.fromBytes(new Uint8Array([v, ...b.subarray(0, 64)]), 'recovered').recoverPublicKey(h).toBytes(false);
  return '0x' + Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString('hex');
}
// every signing key in an attestation report, with where it stands: a model enclave (one per node that
// serves the model) or the NEAR AI gateway, which also runs in a TEE and has its own report
function attestedKeys(r, into = new Map()) {
  const walk = (o, kind) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, kind));
    if (typeof o.signing_address === 'string' && o.signing_address) { const k = o.signing_address.toLowerCase(); if (!into.has(k) || kind === 'model') into.set(k, kind); }
    for (const [name, v] of Object.entries(o)) if (v && typeof v === 'object') walk(v, /gateway/i.test(name) ? 'gateway' : kind);
  };
  walk(r, 'model');
  return into;
}
export function checkSignature(call, sig, keys) {
  const reqHash = sha256hex(call.sent), respHash = sha256hex(call.received);
  const parts = String(sig.text || '').split(':');
  const signer = String(sig.signing_address || '').toLowerCase();
  let recovered = null, sigErr = null;
  try { recovered = recoverEip191(sig.text, sig.signature); } catch (e) { sigErr = String(e.message).slice(0, 80); }
  const out = {
    chatId: call.id, model: call.model, at: call.at, text: sig.text, signature: sig.signature, signer, algo: sig.signing_algo || 'ecdsa',
    requestSha256: reqHash, responseSha256: respHash,
    requestHashOk: parts.includes(reqHash), responseHashOk: parts.includes(respHash),
    signatureOk: !!recovered && recovered === signer, recovered, attested: keys.has(signer), signedBy: keys.get ? keys.get(signer) || null : keys.has(signer) ? 'model' : null, error: sigErr,
  };
  out.ok = out.requestHashOk && out.responseHashOk && out.signatureOk && out.attested;
  if (!out.ok && !out.error) out.error = !out.signatureOk ? 'the signature does not match its key' : !out.attested ? 'the key is not in the attestation report' : !out.requestHashOk ? 'the request hash differs' : 'the answer hash differs';
  return out;
}
export async function verifyAnswer(call) {
  if (MODE === 'fake') return { ok: true, test: true, chatId: 'test', signer: '0xtest0000000000' };
  if (!call || !call.id) return { ok: false, error: 'the answer had no chat id' };
  let sig = null, err = null;
  for (let k = 0; k < 3 && !sig; k++) { // the signature can take a moment to appear
    try { sig = await api(`/signature/${encodeURIComponent(call.id)}?model=${encodeURIComponent(call.model)}&signing_algo=ecdsa`, null, 30000); }
    catch (e) { err = String(e.message || e).slice(0, 120); await new Promise((r) => setTimeout(r, 2000)); }
  }
  if (!sig) { const out = { ok: false, chatId: call.id, error: 'no signature: ' + err }; console.log('[AI] answer signature not available:', err); return keep(out, call); }
  let out = checkSignature(call, sig, attestedKeys(ai.attestFull));
  if (!out.attested && out.signatureOk) {
    // a model can run on several enclaves, each with its own key: ask for the report of the one that signed
    // (with a fresh nonce), and count only a report that really names that key
    const keys = attestedKeys(ai.attestFull);
    const nonce = crypto.randomBytes(32).toString('hex');
    for (const q of [`model=${encodeURIComponent(call.model)}&signing_address=${out.signer}&nonce=${nonce}`, `model=${encodeURIComponent(call.model)}&nonce=${nonce}`]) {
      try { const r = await api(`/attestation/report?${q}&signing_algo=ecdsa`, null, 30000); attestedKeys(r, keys); if (attestedKeys(r).has(out.signer)) { ai.signerReport = r; break; } } catch (e) { err = String(e.message || e).slice(0, 100); }
    }
    out = checkSignature(call, sig, keys);
    if (!out.attested) console.log(`[AI] signer ${out.signer.slice(0, 12)}… is not among the ${keys.size} attested key(s): ${[...keys].map(([k, v]) => k.slice(0, 12) + '… (' + v + ')').join(', ') || 'none'}${err ? '; last error: ' + err : ''}`);
  }
  const where = out.signedBy === 'gateway' ? 'the attested NEAR AI gateway TEE' : 'the attested model TEE';
  console.log(`[AI] answer signature ${out.ok ? 'verified: signed inside ' + where : 'NOT verified'} (request hash ${out.requestHashOk ? 'ok' : 'differs'}, response hash ${out.responseHashOk ? 'ok' : 'differs'}, signature ${out.signatureOk ? 'ok' : 'bad'}, key ${out.attested ? 'in the attestation report' : 'not in the report'}).`);
  return keep(out, call);
}
// the last few proofs with the exact request and response bytes, so anyone can re-hash them
function keep(out, call) {
  ai.proofs = [{ ...out, request: call.sent, response: call.received }, ...(ai.proofs || [])].slice(0, 5);
  ai.lastProof = out;
  return out;
}
export const aiProof = (chatId) => (ai.proofs || []).find((x) => !chatId || x.chatId === chatId) || null;

export const aiPublic = () => ({ status: ai.status, provider: ai.provider, model: ai.model, tee: !!ai.tee, attest: ai.attest || null, lastPlanAt: ai.lastPlanAt, planFailed: !!ai.planFailed, proof: ai.lastProof ? { ok: !!ai.lastProof.ok, chatId: ai.lastProof.chatId || null, at: ai.lastProof.at || null, error: ai.lastProof.error || null } : null, forced: !!process.env.NEARAI_MODEL, error: ai.lastError ? String(ai.lastError).slice(0, 120) : null });

// ---------- a swap said in words: "send 0.3 NEAR to my Solana wallet as USDC" ----------
// NEAR AI only reads the sentence into a form (direction, tokens, amount, addresses); the server checks every
// value against the swap menu and the limits, and the player still sends the money from their own wallet.
const SWAP_OUT = ['USDC', 'USDC-SOL', 'SOL', 'USDC-BASE']; // wNEAR on NEAR -> these
const SWAP_IN = ['USDC-SOL', 'SOL', 'USDC-BASE'];          // these -> wNEAR on NEAR
const ADDR = { near: /\b(?:(?:[a-z\d]+[-_])*[a-z\d]+\.)+near\b|\b[0-9a-f]{64}\b/gi, base: /\b0x[0-9a-fA-F]{40}\b/g, sol: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g };
export function addressesIn(text) {
  const s = String(text || '');
  const near = s.match(ADDR.near) || [], base = s.match(ADDR.base) || [];
  const sol = (s.match(ADDR.sol) || []).filter((a) => !/^[0-9a-f]{64}$/i.test(a) && !near.includes(a));
  return { near: near.map((a) => a.toLowerCase()), base, sol };
}
// a plain reader that needs no network: the number, the token right after it, and where it should go
export function readSwapRule(text) {
  const s = ' ' + String(text || '').toLowerCase().replace(/[’']/g, ' ') + ' ';
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(w?near|usdc|sol)\b/);
  const amount = m ? Number(m[1].replace(',', '.')) : null;
  const src = m ? m[2] : null;
  const has = (re) => re.test(s);
  const onBase = has(/\bbase\b/), onSol = has(/\bsolana\b|\bphantom\b/);
  let dir = null, from = null, to = null;
  if (src === 'near' || src === 'wnear') {
    dir = 'out';
    const rest = s.slice(s.indexOf(m[0]) + m[0].length);
    const wantSol = /\bsol\b/.test(rest), wantUsdc = /\busdc\b/.test(rest) || /\b(dolar|dollar|stable)/.test(rest);
    if (wantUsdc) to = onBase ? 'USDC-BASE' : onSol ? 'USDC-SOL' : 'USDC';
    else if (wantSol) to = 'SOL';
    else if (onSol) to = 'SOL';
  } else if (src === 'usdc') { dir = 'in'; from = onBase ? 'USDC-BASE' : 'USDC-SOL'; }
  else if (src === 'sol') { dir = 'in'; from = 'SOL'; }
  else if (has(/\bnear\b/) && has(/\b(al|get|buy|almak|istiyorum|want)\b/)) dir = 'in';
  return { dir, from, to, amount };
}
export async function readSwapCommand(text, lang, playerId) {
  const q = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!q) return { ok: false, code: 'aiswap.empty' };
  const rule = readSwapRule(q);
  const d = new Date().toISOString().slice(0, 10);
  if (ai.day !== d) { ai.day = d; ai.calls = 0; ai.asked = {}; }
  if (MODE === 'fake' || ai.status !== 'ready') return { ok: true, form: rule, say: null, by: 'rules' };
  const n = ai.asked[playerId] || 0;
  if (n >= ASK_PER_PLAYER) return { ok: true, form: rule, say: null, by: 'rules' };
  ai.asked[playerId] = n + 1;
  const sys = `You turn a player's sentence into a token swap form for NEAR Intents. Reply with ONE JSON object only:
{"dir":"out"|"in"|null,"from":KEY|null,"to":KEY|null,"amount":number|null,"say":"one short sentence in language '${lang}'"}
Menu (nothing else exists):
- dir "out": the player sends wNEAR from NEAR. "to" is one of: "USDC" (USDC on NEAR), "USDC-SOL" (USDC on Solana), "SOL" (SOL on Solana), "USDC-BASE" (USDC on Base). "from" is null. amount is in NEAR, 0.1 to 5.
- dir "in": the player pays from another chain and gets wNEAR on NEAR. "from" is one of: "USDC-SOL", "SOL", "USDC-BASE". "to" is null. amount is in the token paid: USDC 0.5 to 15, SOL 0.003 to 0.1.
Rules: "SOL" as a token means SOL; "Solana" alone means the chain. If the player names an amount of the token they receive instead of the one they send, set amount null.
If something is missing or not on the menu, set it null and say in "say" what is missing or not possible. Never invent numbers or addresses. "say" must not promise that money was sent.`;
  try {
    const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: q }], 400);
    const o = jsonIn(raw) || {};
    const form = {
      dir: o.dir === 'out' || o.dir === 'in' ? o.dir : rule.dir,
      from: SWAP_IN.includes(o.from) ? o.from : null,
      to: SWAP_OUT.includes(o.to) ? o.to : null,
      amount: Number(o.amount) > 0 ? Number(o.amount) : null,
    };
    if (form.dir === 'out') form.from = null; else form.to = null;
    if (form.dir === 'out' && !form.to) form.to = rule.to;
    if (form.dir === 'in' && !form.from) form.from = rule.from;
    if (!form.amount && rule.dir === form.dir) form.amount = rule.amount;
    const say = typeof o.say === 'string' ? o.say.replace(/\s+/g, ' ').trim().slice(0, 220) : null;
    return { ok: true, form, say, by: 'ai', model: ai.model, tee: !!ai.tee };
  } catch (e) {
    ai.lastError = e.message;
    return { ok: true, form: rule, say: null, by: 'rules' };
  }
}
