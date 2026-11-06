// The craftsmen think with NEAR AI Cloud (OpenAI-compatible, TEE-backed private inference).
// Each morning one request plans the day for all craftsmen; players can also ask a craftsman a question.
// The AI only chooses inside safe limits (see applyAiPlan in economy.js); the village rules still guard
// every coin. Without a key, offline, or over the daily limit, the craftsmen keep their rule-based habits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

async function api(p, body, ms = 25000) {
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
    if (c) throw new Error(`${e.message} (${[c.code, c.message].filter(Boolean).join(': ').slice(0, 140)})`);
    if (e.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally { clearTimeout(timer); }
}

// pick a model the account can use (or the one set in NEARAI_MODEL)
export async function startAi() {
  if (MODE === 'fake' || !KEY) return ai;
  if (ai.model) { ai.status = 'ready'; return ai; }
  try {
    const list = await api('/models');
    const ids = (list.data || []).map((m) => m.id);
    ai.model = PREFER.find((m) => ids.includes(m)) || ids.find((id) => /instruct|chat|gpt|qwen|llama|glm|deepseek/i.test(id) && !/embed|rerank|whisper|flux|image/i.test(id)) || ids[0] || null;
    ai.status = ai.model ? 'ready' : 'error';
    if (!ai.model) ai.lastError = 'no models';
  } catch (e) {
    ai.model = PREFER[0]; ai.status = 'ready'; // try the default model anyway
    ai.lastError = String(e.message || e).slice(0, 160);
    console.log('[AI] could not list models:', ai.lastError);
  }
  console.log(`[AI] ${ai.status === 'ready' ? `craftsmen think with ${ai.provider} (${ai.model})` : 'off'}`);
  return ai;
}

async function chat(messages, maxTokens) {
  if (!countCall()) throw new Error('daily limit reached');
  const r = await api('/chat/completions', { model: ai.model, messages, max_tokens: maxTokens, temperature: 0.7 });
  const msg = r.choices && r.choices[0] && r.choices[0].message;
  return String((msg && msg.content) || '').trim();
}

const jsonIn = (text) => {
  const s = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  return a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null;
};

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
  const text = await chat([{ role: 'system', content: SYSTEM_PLAN }, { role: 'user', content: JSON.stringify(brief) }], 900);
  const plan = jsonIn(text);
  if (!plan || !Array.isArray(plan.craftsmen)) throw new Error('the model did not return a plan');
  ai.lastPlanAt = Date.now(); ai.lastError = null;
  return plan;
}

const LANGS = { en: 'English', tr: 'Turkish', fr: 'French', de: 'German', ru: 'Russian', zh: 'Simplified Chinese' };

// a player asks a craftsman something; the answer is only words (it never moves money)
export async function askCraftsman(card, question, lang, playerId) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!q) return { ok: false, error: 'empty' };
  const d = new Date().toISOString().slice(0, 10);
  if (ai.day !== d) { ai.day = d; ai.calls = 0; ai.asked = {}; }
  const n = (ai.asked[playerId] || 0);
  if (n >= ASK_PER_PLAYER) return { ok: false, error: 'limit', code: 'ai.limit' };
  if (MODE === 'fake') { ai.asked[playerId] = n + 1; return { ok: true, answer: `(${card.name}) I heard: "${q}". Today I keep ${Object.keys(card.goods).join(', ')}.`, model: ai.model }; }
  if (ai.status !== 'ready') return { ok: false, error: 'off', code: 'ai.off' };
  try {
    ai.asked[playerId] = n + 1;
    const answer = await chat([
      { role: 'system', content: `You are ${card.name} in the village of Emberwick, a medieval economy game whose money is EMWK. Stay in character, be warm and practical. ` +
        `Answer in ${LANGS[lang] || 'English'} in at most 2 short sentences. Use only the shop facts given; never invent prices. You cannot give away goods or money. Facts: ${JSON.stringify(card)}` },
      { role: 'user', content: q },
    ], 160);
    return { ok: true, answer: answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 400), model: ai.model };
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
  accept: 'You agree to the deal at the agreed price per unit. Sound pleased, maybe a little grudging if it was a hard bargain.',
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
  const facts = { customer: playerName, theyWant: deal.side === 'buy' ? 'to buy from you' : 'to sell to you', good: deal.good, quantity: deal.qty,
    yourPricePerUnit: deal.ask, theirOfferPerUnit: deal.offer, ...(deal.unit !== null && deal.outcome !== 'angry' && deal.outcome !== 'closed' ? { finalPricePerUnit: deal.unit } : {}), currency: 'EMWK' };
  try {
    const text = await chat([
      { role: 'system', content: `You are ${card.name}, a shopkeeper in the medieval village of Emberwick. ${SAY[deal.outcome] || ''} ` +
        `Say the exact numbers given, never other prices. Answer in ${LANGS[lang] || 'English'} in 1 or 2 short, lively sentences. Facts: ${JSON.stringify(facts)}` },
      { role: 'user', content: `${playerName} offers ${deal.offer} EMWK per ${deal.good}.` },
    ], 120);
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<[^>]*>/g, '').trim().slice(0, 300) || null;
  } catch (e) { ai.lastError = String(e.message || e).slice(0, 160); return null; }
}

export const aiPublic = () => ({ status: ai.status, provider: ai.provider, model: ai.model, lastPlanAt: ai.lastPlanAt, error: ai.status === 'ready' ? null : ai.lastError });
