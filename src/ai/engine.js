/* ============================================================================
 * MED-AI transport core — shared, dependency-free.
 *
 * Runs unchanged in two places:
 *   1. the Vercel Function at /api/medai (server-held keys from Vercel env vars)
 *   2. the browser (keys a judge pastes into "Configure AI Engine")
 *
 * This module never reads build-time or process environment variables. Keys
 * are always passed in by the caller, so nothing here can inline a secret
 * into the client bundle.
 * ==========================================================================*/

export const APP_TITLE = 'ZeroG Pulse';

/* Default failover order: fastest/most generous free tier first. */
export const PROVIDER_ORDER = Object.freeze(['groq', 'gemini', 'openrouter', 'huggingface']);

/* Auto-model lists were verified against each provider's live catalog on
 * 14 Nov 2026. They are preference orders, not locks: a model that returns
 * "not found / decommissioned" is skipped automatically and remembered. */
export const PROVIDERS = Object.freeze({
  groq: Object.freeze({
    id: 'groq', label: 'Groq Cloud', badge: '⚡ Groq Live', style: 'openai', keyPrefix: 'gsk_',
    keyHint: 'console.groq.com → API Keys',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    // Qwen runs with reasoning_effort: 'none'; GPT-OSS is a low-reasoning fallback.
    autoModels: Object.freeze(['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'allam-2-7b']),
    publicModels: false,
  }),
  gemini: Object.freeze({
    id: 'gemini', label: 'Google Gemini', badge: '✨ Gemini Live', style: 'gemini', keyPrefix: 'AIza',
    keyHint: 'aistudio.google.com → Get API key',
    chatUrl: 'https://generativelanguage.googleapis.com/v1beta/models/',
    modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    autoModels: Object.freeze(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite']),
    publicModels: false,
  }),
  openrouter: Object.freeze({
    id: 'openrouter', label: 'OpenRouter', badge: '🌐 OpenRouter Live', style: 'openai', keyPrefix: 'sk-or-',
    keyHint: 'openrouter.ai → Keys',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    autoModels: Object.freeze(['meta-llama/llama-3.1-8b-instruct', 'google/gemini-2.5-flash-lite', 'openrouter/free']),
    freeModels: Object.freeze(['openrouter/free']),
    publicModels: true,
  }),
  huggingface: Object.freeze({
    id: 'huggingface', label: 'Hugging Face Router', badge: '🤗 Hugging Face Live', style: 'openai', keyPrefix: 'hf_',
    keyHint: 'huggingface.co → Settings → Access Tokens (Inference Providers)',
    chatUrl: 'https://router.huggingface.co/v1/chat/completions',
    modelsUrl: 'https://router.huggingface.co/v1/models',
    autoModels: Object.freeze(['meta-llama/Llama-3.1-8B-Instruct', 'google/gemma-3-4b-it', 'Qwen/Qwen3.5-9B']),
    publicModels: true,
  }),
});

export const LIMITS = Object.freeze({
  historyItems: 4,        // last N turns sent upstream (quota-safe)
  historyChars: 900,      // per turn
  promptChars: 2000,
  systemChars: 9000,
  maxTokens: 4096,        // hard ceiling per answer
  firstTokenMs: 3500,     // every keyed request must start streaming within 3.5 s
  stallMs: 15000,         // max silence between streamed chunks
  totalMs: 120000,        // max length of one streamed answer
  budgetMs: 20000,        // time allowed to find a working provider before onboard takes over
});

const MODEL_ID_RE = /^[A-Za-z0-9][\w.:/@+-]{0,159}$/;
const LIGHT_RE = /(?:^|[-_/.:])(?:\d{1,2}(?:\.\d)?b|e\d+b|mini|nano|small|lite|flash|instant|tiny|haiku|lightning)(?:$|[-_/.:])/i;

/* ---------------------------------------------------------------- errors */

export class AttemptError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'AttemptError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export function abortError() {
  const err = new Error('Request cancelled');
  err.name = 'AbortError';
  return err;
}

export const isAbortError = (err) => Boolean(err) && err.name === 'AbortError';

export function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- utilities */

export function detectProviderFromKey(key) {
  const k = String(key || '').trim();
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-or-')) return 'openrouter';
  if (k.startsWith('AIza')) return 'gemini';
  if (k.startsWith('hf_')) return 'huggingface';
  return null;
}

/* Short non-reversible fingerprint so health records are scoped per key. */
export function keyFingerprint(key) {
  let h = 0x811c9dc5;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export function cleanModelId(model) {
  const m = String(model || '').trim().replace(/^models\//, '');
  return MODEL_ID_RE.test(m) ? m : '';
}

export const isLightModel = (id) => LIGHT_RE.test(String(id || ''));

/* Normalise chat history into strictly alternating user/assistant turns that
 * start with a user turn (Gemini requires alternation; all providers accept it). */
export function toChatMessages(history, prompt, { items = LIMITS.historyItems, chars = LIMITS.historyChars } = {}) {
  const turns = [];
  for (const m of Array.isArray(history) ? history : []) {
    if (!m || m.streaming || typeof (m.text ?? m.content) !== 'string') continue;
    const role = m.role === 'ai' || m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
    if (!role) continue;
    const content = String(m.text ?? m.content).trim().slice(0, chars);
    if (content) turns.push({ role, content });
  }
  const finalPrompt = String(prompt || '').trim().slice(0, LIMITS.promptChars);
  let recent = turns.slice(-items);
  const merged = [];
  for (const t of recent) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content += '\n\n' + t.content;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0].role === 'assistant') merged.shift();
  recent = merged;
  if (finalPrompt) {
    const last = recent[recent.length - 1];
    if (last && last.role === 'user') last.content += '\n\n' + finalPrompt;
    else recent.push({ role: 'user', content: finalPrompt });
  }
  return recent;
}

/* Server-side validation of messages coming from the browser. */
export function sanitizeMessages(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages.slice(-(LIMITS.historyItems + 1)) : []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim().slice(0, LIMITS.promptChars + LIMITS.historyChars);
    if (content) out.push({ role: m.role, content });
  }
  return toChatMessages(out.map((m) => ({ role: m.role, text: m.content })), '', { items: LIMITS.historyItems + 1, chars: LIMITS.promptChars + LIMITS.historyChars });
}

/* ---------------------------------------------------------- request shape */

function groqExtras(model) {
  if (/gpt-oss/i.test(model)) return { reasoning_effort: 'low', include_reasoning: false };
  if (/qwen3/i.test(model)) return { reasoning_effort: 'none' };
  return {};
}

function geminiThinking(model) {
  const m = model.toLowerCase();
  if (/^gemini-2\.5-flash/.test(m)) return { thinkingBudget: 0 };
  if (/^gemini-3[\d.]*-flash-lite/.test(m)) return { thinkingLevel: 'minimal' };
  if (/^gemini-3[\d.]*-flash/.test(m)) return { thinkingLevel: 'low' };
  return null;
}

export function buildRequest(providerId, { key, model, fallbacks = [], system, messages, maxTokens = LIMITS.maxTokens, stream = true, plain = false, appUrl = '', appTitle = APP_TITLE }) {
  const p = PROVIDERS[providerId];
  if (!p) throw new AttemptError('config', 'Unknown provider ' + providerId);
  const budget = Math.max(16, Math.min(LIMITS.maxTokens, Math.round(maxTokens || LIMITS.maxTokens)));
  const sys = String(system || '').slice(0, LIMITS.systemChars);

  if (p.style === 'gemini') {
    const generationConfig = { temperature: 0.4, maxOutputTokens: budget };
    const thinking = plain ? null : geminiThinking(model);
    if (thinking) generationConfig.thinkingConfig = thinking;
    return {
      url: p.chatUrl + encodeURIComponent(model) + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'),
      init: {
        method: 'POST',
        // Only these two headers: Gemini's CORS preflight rejects anything else.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig,
        }),
      },
    };
  }

  const body = {
    model,
    messages: [{ role: 'system', content: sys }, ...messages],
    temperature: 0.4,
    stream,
  };
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
  if (providerId === 'groq') {
    body.max_completion_tokens = budget;
    if (!plain) Object.assign(body, groqExtras(model));
  } else {
    body.max_tokens = budget;
  }
  if (providerId === 'openrouter') {
    const extra = fallbacks.filter((m) => m && m !== model).slice(0, 2);
    if (extra.length) body.models = [model, ...extra];
    if (!plain) {
      // Verified live 14 Nov 2026: accepted by llama-3.1-8b-instruct and openrouter/free.
      body.reasoning = { effort: 'low' };
      body.provider = { sort: 'latency' };
    }
    if (appUrl) headers['HTTP-Referer'] = appUrl;
    headers['X-OpenRouter-Title'] = appTitle;
    headers['X-Title'] = appTitle;
  }
  return { url: p.chatUrl, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

/* ------------------------------------------------------- error handling */

function parseErrorBody(text) {
  let message = String(text || '').replace(/\s+/g, ' ').trim();
  let code = '';
  let retryAfterMs = 0;
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : (j.error ?? j);
    if (typeof e === 'string') message = e;
    else if (e && typeof e === 'object') {
      message = String(e.message || e.error || message);
      code = String(e.code || e.status || e.type || '');
      const raw = e.metadata?.raw;
      if (typeof raw === 'string' && raw.length < 300 && /rate|limit|quota/i.test(raw)) message += ' — ' + raw;
      const retry = (e.details || []).find((d) => d && d.retryDelay);
      if (retry) retryAfterMs = (parseFloat(retry.retryDelay) || 0) * 1000;
    }
  } catch { /* Not JSON — keep the raw text. */ }
  const m = /try again in ([\d.]+)\s*(ms|s)/i.exec(message);
  if (!retryAfterMs && m) retryAfterMs = parseFloat(m[1]) * (m[2].toLowerCase() === 'ms' ? 1 : 1000);
  return { message: message.slice(0, 300), code, retryAfterMs };
}

const MODEL_GONE_RE = /model[_ ]not[_ ]found|decommission|does not exist|no longer (available|supported)|unavailable for free|not (a )?valid model|invalid model|unknown model|is not found|not supported for generatecontent|no endpoints found/i;
const PARAM_RE = /thinking|reasoning_effort|include_reasoning|reasoning_format|unsupported (parameter|value)|unrecognized|unknown (parameter|field)|not supported with this model|invalid argument.*(config|budget|level)/i;

export function classifyFailure(status, message = '', code = '', retryAfterHeader = '') {
  const text = message + ' ' + code;
  let kind;
  if (status === 401 || /invalid api key|api[_ ]key[_ ]invalid|api key not valid|invalid credentials|unauthori[sz]ed/i.test(text)) kind = 'auth';
  else if (status === 403) kind = /error code: 10\d\d/.test(text) ? 'blocked' : 'auth';
  else if (status === 402 || /insufficient (credits|balance)|payment required|requires more credits/i.test(text)) kind = 'credits';
  else if (status === 429 || /resource_exhausted|rate[_ ]limit|tokens per minute|requests per (minute|day)/i.test(text)) kind = 'rate';
  else if (status === 404 || ((status === 400 || status === 422) && MODEL_GONE_RE.test(text))) kind = 'model';
  else if ((status === 400 || status === 422) && PARAM_RE.test(text)) kind = 'param';
  else if (status === 413 || /context length|too many tokens|maximum context/i.test(text)) kind = 'model';
  else if (status === 408 || status === 504) kind = 'timeout';
  else if (status >= 500) kind = 'server';
  else if (status >= 400) kind = 'bad_request';
  else kind = 'network';
  const header = parseFloat(retryAfterHeader);
  return { kind, retryAfterMs: Number.isFinite(header) && header > 0 ? header * 1000 : 0 };
}

async function failureFromResponse(res) {
  let text = '';
  try { text = (await res.text()).slice(0, 4000); } catch { /* Body unreadable. */ }
  const parsed = parseErrorBody(text);
  const { kind, retryAfterMs } = classifyFailure(res.status, parsed.message, parsed.code, res.headers.get('retry-after') || '');
  return new AttemptError(kind, 'HTTP ' + res.status + (parsed.message ? ' — ' + parsed.message : ''), {
    status: res.status,
    retryAfterMs: retryAfterMs || parsed.retryAfterMs,
  });
}

/* ---------------------------------------------------- health / cooldowns */

const PENALTY_MS = { auth: 600000, credits: 600000, blocked: 120000, rate: 20000, server: 15000, timeout: 15000, network: 10000, bad_request: 30000 };

export function createHealth({ load, save } = {}) {
  const state = { cool: {}, dead: {} };
  try {
    const saved = load ? load() : null;
    if (saved && typeof saved === 'object') {
      if (saved.dead && typeof saved.dead === 'object') state.dead = { ...saved.dead };
    }
  } catch { /* Corrupt or unavailable storage. */ }
  const persist = () => { try { if (save) save({ dead: state.dead }); } catch { /* Optional. */ } };
  const prune = () => {
    const now = Date.now();
    for (const k of Object.keys(state.dead)) if (state.dead[k] <= now) delete state.dead[k];
    for (const k of Object.keys(state.cool)) if (state.cool[k] <= now) delete state.cool[k];
  };
  return {
    coolingFor(id) { const t = state.cool[id] || 0; return Math.max(0, t - Date.now()); },
    penalize(id, err) {
      const base = PENALTY_MS[err && err.kind];
      if (!base) return;
      const ms = err.kind === 'rate' && err.retryAfterMs ? Math.min(Math.max(err.retryAfterMs, 3000), 120000) : base;
      state.cool[id] = Date.now() + ms;
      prune();
    },
    clear(id) { delete state.cool[id]; },
    isDead(provider, model) { return (state.dead[provider + '|' + model] || 0) > Date.now(); },
    kill(provider, model, ms = 12 * 3600 * 1000) { state.dead[provider + '|' + model] = Date.now() + ms; prune(); persist(); },
    reset() { state.cool = {}; state.dead = {}; persist(); },
    snapshot() { prune(); return { cool: { ...state.cool }, dead: { ...state.dead } }; },
  };
}

/* ------------------------------------------------------- SSE streaming */

export async function* readSSE(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let data = [];   // data: lines of the event being assembled
  const tryParse = (txt) => { try { return JSON.parse(txt); } catch { return undefined; } };
  // Deadlines abort `signal`; cancelling the reader guarantees a pending read()
  // settles even if the underlying body ignores the fetch signal.
  const onAbort = () => { reader.cancel().catch(() => {}); };
  if (signal) {
    if (signal.aborted) throw abortError();
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal && signal.aborted) throw abortError();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line === '') {                          // blank line = end of event
          if (data.length) {
            const evt = tryParse(data.join('\n'));
            data = [];
            if (evt !== undefined) yield evt;
          }
          continue;
        }
        if (!line.startsWith('data:')) continue;   // comments (": OPENROUTER PROCESSING"), event:, id:, retry:
        let chunk = line.slice(5);
        if (chunk.startsWith(' ')) chunk = chunk.slice(1);
        if (!data.length && chunk.trim() === '[DONE]') return;
        data.push(chunk);
        // Providers normally send one JSON object per data: line; emit it as soon as
        // the assembled data parses, so streams without blank separators also work,
        // while an object split over several data: lines is joined per the SSE spec.
        const evt = tryParse(data.join('\n'));
        if (evt !== undefined) { data = []; yield evt; }
      }
    }
    const tail = buf.replace(/\r$/, '');
    if (tail.startsWith('data:')) {
      let chunk = tail.slice(5);
      if (chunk.startsWith(' ')) chunk = chunk.slice(1);
      if (!(data.length === 0 && chunk.trim() === '[DONE]')) data.push(chunk);
    }
    if (data.length) {
      const evt = tryParse(data.join('\n'));
      if (evt !== undefined) yield evt;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { await reader.cancel(); } catch { /* Already closed. */ }
  }
}

function readEvent(style, evt) {
  if (!evt || typeof evt !== 'object') return {};
  if (evt.error) {
    const e = typeof evt.error === 'object' ? evt.error : { message: String(evt.error) };
    return { error: { status: Number(e.code) || 500, message: String(e.message || 'Provider error'), code: String(e.code || e.status || '') } };
  }
  if (style === 'gemini') {
    const parts = evt.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const thought = parts.some((p) => p && p.thought);
    return { text, alive: Boolean(text) || thought, model: evt.modelVersion || '', finish: evt.candidates?.[0]?.finishReason || '' };
  }
  const choice = evt.choices?.[0] || {};
  const delta = choice.delta || choice.message || {};
  const text = typeof delta.content === 'string' ? delta.content : '';
  const reasoning = delta.reasoning || delta.reasoning_content;
  return { text, alive: Boolean(text) || Boolean(reasoning), model: evt.model || '', finish: choice.finish_reason || '' };
}

function completionFromJSON(style, data) {
  const raw = style === 'gemini'
    ? (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
    : data?.choices?.[0]?.message?.content;
  return typeof raw === 'string' ? raw.trim() : '';
}

/* One streamed request to one provider/model, with first-token, stall and
 * total deadlines. Throws AttemptError; `emitted` marks a mid-answer drop. */
export async function streamOnce({ provider, key, model, fallbacks, plain, system, messages, maxTokens = LIMITS.maxTokens, signal, answerBy, firstTokenMs = LIMITS.firstTokenMs, stallMs = LIMITS.stallMs, totalMs = LIMITS.totalMs, onDelta, fetchImpl, appUrl, appTitle }) {
  throwIfAborted(signal);
  const p = PROVIDERS[provider];
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  let reason = '';
  const stop = (why) => { if (!reason) reason = why; controller.abort(); };
  const onOuterAbort = () => stop('cancelled');
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  // Until visible answer text arrives, keep-alive / reasoning events may extend the
  // wait but never past `answerBy` (the chain's absolute budget). After the first
  // text, the stall and total limits apply.
  const answerAt = Number.isFinite(answerBy) ? answerBy : Date.now() + totalMs;
  const untilAnswer = (ms) => Math.max(0, Math.min(ms, answerAt - Date.now()));
  let text = '';
  let watchdog = setTimeout(() => stop('first-token'), untilAnswer(firstTokenMs));
  const hardStop = setTimeout(() => stop('total'), totalMs);
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = text ? setTimeout(() => stop('stall'), stallMs) : setTimeout(() => stop('first-token'), untilAnswer(stallMs));
  };
  let served = model;
  let finishReason = '';
  const fail = (err) => {
    if (reason === 'cancelled' || (signal && signal.aborted)) return abortError();
    if (err instanceof AttemptError) { err.emitted = Boolean(text); err.partial = text; return err; }
    if (reason) {
      const label = reason === 'first-token' ? 'no answer text in time (first-token limit ' + (firstTokenMs / 1000).toFixed(1) + ' s)'
        : reason === 'stall' ? 'stream stalled for ' + (stallMs / 1000) + ' s' : 'answer exceeded ' + (totalMs / 1000) + ' s';
      return new AttemptError('timeout', label, { emitted: Boolean(text), partial: text });
    }
    return new AttemptError('network', 'Network error — ' + String((err && err.message) || err).slice(0, 120), { emitted: Boolean(text), partial: text });
  };
  try {
    const { url, init } = buildRequest(provider, { key, model, fallbacks, system, messages, maxTokens, stream: true, plain, appUrl, appTitle });
    const res = await doFetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw await failureFromResponse(res);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('event-stream') || !res.body) {
      const data = await res.json();
      const whole = completionFromJSON(p.style, data);
      if (!whole) throw new AttemptError('empty', 'Empty response from ' + model);
      text = whole;
      onDelta?.(whole, { provider, model: data?.model || model });
      const finish = p.style === 'gemini' ? data?.candidates?.[0]?.finishReason : data?.choices?.[0]?.finish_reason;
      if (finish === 'length' || finish === 'MAX_TOKENS') throw new AttemptError('truncated', 'Provider reached the output token limit before finishing');
      return { text: whole, model: data?.model || model };
    }
    for await (const evt of readSSE(res.body, controller.signal)) {
      const d = readEvent(p.style, evt);
      if (d.error) {
        const c = classifyFailure(d.error.status, d.error.message, d.error.code);
        throw new AttemptError(c.kind, 'Stream error — ' + d.error.message.slice(0, 200), { status: d.error.status, retryAfterMs: c.retryAfterMs });
      }
      if (d.model) served = d.model;
      if (d.finish) finishReason = d.finish;
      if (d.text) {
        text += d.text;
        onDelta?.(d.text, { provider, model: served });
      }
      if (d.alive) arm();
    }
    if (!text.trim()) throw new AttemptError('empty', 'Empty answer from ' + model + ' (reasoning used the whole token budget)');
    if (finishReason === 'length' || finishReason === 'MAX_TOKENS') throw new AttemptError('truncated', 'Provider reached the output token limit before finishing');
    return { text: text.trim(), model: served };
  } catch (err) {
    throw fail(err);
  } finally {
    clearTimeout(watchdog);
    clearTimeout(hardStop);
    signal?.removeEventListener('abort', onOuterAbort);
    controller.abort();
  }
}

/* --------------------------------------------------------- model lists */

const GROQ_NON_CHAT = /whisper|orpheus|guard|tts|embed|playai|distil|safeguard/i;
const GEMINI_NON_TEXT = /embedding|imagen|veo|tts|image|live|aqa|lyria|robotics|computer-use|native-audio|learnlm/i;

export async function fetchModels(providerId, key, { signal, timeoutMs = 8000, fetchImpl } = {}) {
  const p = PROVIDERS[providerId];
  if (!p) throw new AttemptError('config', 'Unknown provider');
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  if (key) {
    if (p.style === 'gemini') headers['x-goog-api-key'] = key;
    else headers.Authorization = 'Bearer ' + key;
  }
  try {
    const res = await doFetch(p.modelsUrl, { headers, signal: controller.signal });
    if (!res.ok) throw await failureFromResponse(res);
    const data = await res.json();
    let rows = [];
    if (providerId === 'gemini') {
      rows = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), name: m.displayName || '', ctx: m.inputTokenLimit || 0 }))
        .filter((m) => m.id && !GEMINI_NON_TEXT.test(m.id));
    } else if (providerId === 'openrouter') {
      rows = (data.data || [])
        .filter((m) => {
          const out = m.architecture?.output_modalities;
          const inp = m.architecture?.input_modalities;
          return (!out || out.includes('text')) && (!inp || inp.includes('text'));
        })
        .map((m) => {
          const free = String(m.id).endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
          return { id: m.id, name: m.name || '', ctx: m.context_length || 0, free };
        });
    } else if (providerId === 'huggingface') {
      rows = (data.data || [])
        .filter((m) => (m.providers || []).some((x) => !x.status || x.status === 'live'))
        .map((m) => ({ id: m.id, name: '', ctx: Math.max(0, ...(m.providers || []).map((x) => x.context_length || 0)) }));
    } else {
      rows = (data.data || [])
        .filter((m) => m.active !== false && !GROQ_NON_CHAT.test(m.id))
        .map((m) => ({ id: m.id, name: '', ctx: m.context_window || 0 }));
    }
    const rank = (id) => { const i = p.autoModels.indexOf(id); return i < 0 ? 99 : i; };
    return rows
      .filter((m) => cleanModelId(m.id))
      .map((m) => ({ ...m, free: Boolean(m.free), light: isLightModel(m.id), recommended: rank(m.id) < 99 ? rank(m.id) + 1 : 0 }))
      .sort((a, b) => (rank(a.id) - rank(b.id)) || a.id.localeCompare(b.id));
  } catch (err) {
    if (signal && signal.aborted) throw abortError();
    if (err instanceof AttemptError) throw err;
    throw new AttemptError(isAbortError(err) ? 'timeout' : 'network', isAbortError(err) ? 'Model list timed out' : 'Model list unreachable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* --------------------------------------------------------- failover chain */

const healthId = (cand) => (cand.source || 'browser') + ':' + cand.provider + ':' + keyFingerprint(cand.key);
const PER_MODEL_QUOTA = new Set(['groq', 'gemini']);

/* Try one provider: pinned model (if any) first, then its auto list. Model
 * level failures move to the next model; provider level failures throw. */
async function attemptProvider(cand, opts) {
  const p = PROVIDERS[cand.provider];
  const pinned = cleanModelId(cand.model);
  const auto = p.autoModels.filter((m) => !opts.health.isDead(p.id, m));
  // A pinned model that recently returned "not found" is skipped (except in a
  // strict connection test) so a stale choice costs at most one wasted call.
  const pinnedLive = pinned && (cand.strict || !opts.health.isDead(p.id, pinned)) ? pinned : '';
  let queue = cand.strict && pinned ? [pinned] : [...new Set([pinnedLive, ...auto].filter(Boolean))];
  if (!queue.length) {
    try {
      const listed = await fetchModels(p.id, cand.key, { signal: opts.signal, timeoutMs: 2500, fetchImpl: opts.fetchImpl });
      queue = listed.filter((m) => m.light && !opts.health.isDead(p.id, m.id)).slice(0, 3).map((m) => m.id);
    } catch (err) { if (isAbortError(err)) throw err; }
  }
  if (!queue.length) throw new AttemptError('model', 'No available ' + p.label + ' model');
  let lastErr = null;
  let triedFree = false;
  while (queue.length) {
    const model = queue.shift();
    const fallbacks = p.id === 'openrouter' && !cand.strict ? queue.slice(0, 2) : [];
    let err = null;
    for (const plain of [false, true]) {
      const left = opts.deadlineAt - Date.now();
      if (left < 400) throw lastErr || new AttemptError('timeout', 'Provider budget exhausted');
      try {
        opts.onEvent?.({ type: 'attempt', provider: p.id, source: cand.source, model });
        const result = await streamOnce({ ...opts, provider: p.id, key: cand.key, model, fallbacks, plain, answerBy: opts.deadlineAt, firstTokenMs: Math.min(opts.firstTokenMs, left) });
        return { ...result, requested: model };
      } catch (e) {
        if (isAbortError(e) || e.emitted) throw e;
        err = e;
        if (e.kind === 'param' && !plain) continue;
        break;
      }
    }
    lastErr = err;
    if (p.id === 'openrouter' && fallbacks.length) queue = queue.slice(fallbacks.length);
    if (err.kind === 'model' || err.kind === 'empty' || err.kind === 'param') {
      opts.health.kill(p.id, model, err.kind === 'model' ? 12 * 3600 * 1000 : 10 * 60 * 1000);
      opts.onEvent?.({ type: 'model-skip', provider: p.id, model, kind: err.kind, message: err.message });
      continue;
    }
    // Groq and Gemini meter quotas per model: a 429 on one light model does not
    // mean the next one is exhausted, so rest only that model and move on.
    if (err.kind === 'rate' && PER_MODEL_QUOTA.has(p.id) && queue.length && !cand.strict) {
      opts.health.kill(p.id, model, Math.min(Math.max(err.retryAfterMs || 30000, 10000), 600000));
      opts.onEvent?.({ type: 'model-skip', provider: p.id, model, kind: err.kind, message: err.message });
      continue;
    }
    if (err.kind === 'credits' && p.freeModels && !triedFree && !cand.strict) {
      triedFree = true;
      queue = p.freeModels.filter((m) => m !== model);
      continue;
    }
    throw err;
  }
  throw lastErr || new AttemptError('model', 'No available ' + p.label + ' model');
}

/* Sequential, quota-safe failover across candidates ({provider, key, model,
 * source, strict}). Only one provider is billed per answer in the normal case. */
export async function runChain({ candidates, system, messages, maxTokens = LIMITS.maxTokens, signal, health, onEvent, onDelta, fetchImpl, appUrl, appTitle, budgetMs = LIMITS.budgetMs, firstTokenMs = LIMITS.firstTokenMs, stallMs = LIMITS.stallMs, totalMs = LIMITS.totalMs }) {
  const started = Date.now();
  const deadlineAt = started + budgetMs;
  const hp = health || createHealth();
  const attempts = [];
  for (const cand of candidates || []) {
    throwIfAborted(signal);
    if (!cand || !PROVIDERS[cand.provider] || !cand.key) continue;
    if (deadlineAt - Date.now() < 600) break;
    const id = healthId(cand);
    const cooling = hp.coolingFor(id);
    if (cooling > 0) {
      attempts.push({ provider: cand.provider, source: cand.source, kind: 'cooldown', message: 'skipped, retry in ' + Math.ceil(cooling / 1000) + ' s' });
      continue;
    }
    const t0 = Date.now();
    try {
      const result = await attemptProvider(cand, { system, messages, maxTokens, signal, health: hp, onEvent, onDelta, fetchImpl, appUrl, appTitle, deadlineAt, firstTokenMs, stallMs, totalMs });
      hp.clear(id);
      attempts.push({ provider: cand.provider, source: cand.source, kind: 'ok', model: result.model, ms: Date.now() - t0 });
      return { ...result, provider: cand.provider, source: cand.source, attempts, ms: Date.now() - started };
    } catch (err) {
      if (isAbortError(err)) throw err;
      attempts.push({ provider: cand.provider, source: cand.source, kind: err.kind, status: err.status || 0, message: String(err.message || '').slice(0, 200), ms: Date.now() - t0 });
      hp.penalize(id, err);
      if (err.emitted) { err.provider = cand.provider; err.attempts = attempts; throw err; }
      onEvent?.({ type: 'failover', provider: cand.provider, kind: err.kind, message: String(err.message || '').slice(0, 160) });
    }
  }
  throw new AttemptError('exhausted', attempts.length ? 'No live provider answered' : 'No live provider configured', { attempts });
}

export { sleep };
