/* ============================================================================
 * ZeroG Pulse — browser AI transport.
 *
 * Answer path for every MED-AI query (first success wins, one provider billed):
 *   1. /api/medai    Vercel Function using the keys stored in Vercel env vars
 *                    (VITE_GROQ_API_KEY … or GROQ_API_KEY …), read server-side.
 *   2. Browser keys  keys a judge pastes into "Configure AI Engine"
 *                    (saved only in this browser's localStorage).
 *   3. Public relay  Pollinations, OFF by default (1 request / 30 s per IP).
 *   4. Onboard       deterministic clinical engine in App.jsx (0 ms, offline).
 *
 * This file deliberately never reads build-time env variables, so no key can
 * be inlined into the public JavaScript bundle.
 * ==========================================================================*/
import {
  PROVIDERS, PROVIDER_ORDER, LIMITS, APP_TITLE,
  AttemptError, abortError, isAbortError, throwIfAborted,
  detectProviderFromKey, cleanModelId, toChatMessages,
  runChain, fetchModels, createHealth,
} from './ai/engine.js';

export { PROVIDERS, PROVIDER_ORDER, AttemptError, isAbortError, detectProviderFromKey, cleanModelId };

const ENGINE_KEY = 'zgp_ai_engine_v2';
const LEGACY_ENGINE_KEY = 'zgp_ai_engine';
const HEALTH_KEY = 'zgp_ai_health_v1';
const RELAY_KEY = 'zgp_ai_relay_v1';
const API_PATH = '/api/medai';

export const ENGINE_MODES = Object.freeze(['auto', ...PROVIDER_ORDER, 'onboard']);
const EMPTY_KEYS = Object.freeze(Object.fromEntries(PROVIDER_ORDER.map((id) => [id, ''])));

/* provider: 'auto' | provider id | 'onboard'.  model: '' means automatic. */
export const ENGINE_DEFAULT = Object.freeze({ provider: 'auto', model: '', keys: EMPTY_KEYS, publicRelay: false });

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* Private mode. */ }
  },
};

/* ------------------------------------------------------- key redaction */

// Provider error bodies can echo the key that was sent. Anything shown in the UI
// passes through redactSecrets(): known browser keys first, then key-shaped tokens.
const KEY_PATTERN = /(?:gsk_|sk-or-v1-|sk-or-|sk-|hf_|AIza)[A-Za-z0-9_-]{8,}/g;
let knownKeys = [];
function rememberKeys(eng) {
  knownKeys = PROVIDER_ORDER.map((id) => eng.keys[id]).filter((k) => k && k.length >= 8);
}
export function redactSecrets(text, extra = []) {
  let out = String(text ?? '');
  for (const k of [...knownKeys, ...extra]) if (k && k.length >= 8) out = out.split(k).join('‹key›');
  return out.replace(KEY_PATTERN, '‹key›');
}

/* ----------------------------------------------------- engine settings */

export function normalizeEngine(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const provider = ENGINE_MODES.includes(src.provider) ? src.provider : 'auto';
  const keys = {};
  for (const id of PROVIDER_ORDER) {
    const v = src.keys && typeof src.keys[id] === 'string' ? src.keys[id].trim() : '';
    keys[id] = v.length <= 400 ? v : '';
  }
  return {
    provider,
    model: PROVIDERS[provider] ? cleanModelId(src.model) : '',
    keys,
    publicRelay: Boolean(src.publicRelay),
  };
}

/* Loads v2 settings, migrating the legacy single-key format once. Legacy
 * hard-coded model IDs (e.g. llama-3.3-70b-versatile) are dropped on purpose:
 * the failover chain now picks a live model automatically. */
export function loadEngine() {
  const saved = storage.get(ENGINE_KEY);
  if (saved) return normalizeEngine(saved);
  const legacy = storage.get(LEGACY_ENGINE_KEY);
  if (!legacy || typeof legacy !== 'object') return normalizeEngine(ENGINE_DEFAULT);
  const keys = { ...EMPTY_KEYS };
  const key = typeof legacy.key === 'string' ? legacy.key.trim() : '';
  const target = detectProviderFromKey(key) || (PROVIDERS[legacy.provider] ? legacy.provider : null);
  if (key && target) keys[target] = key;
  const migrated = normalizeEngine({ provider: legacy.provider === 'onboard' ? 'onboard' : 'auto', model: '', keys });
  storage.set(ENGINE_KEY, migrated);
  storage.remove(LEGACY_ENGINE_KEY);
  return migrated;
}

export function saveEngine(engine) {
  const clean = normalizeEngine(engine);
  storage.set(ENGINE_KEY, clean);
  return clean;
}

export const hasBrowserKeys = (engine) => PROVIDER_ORDER.some((id) => Boolean(normalizeEngine(engine).keys[id]));

/* ------------------------------------------------------- health memory */

const health = createHealth({
  load: () => storage.get(HEALTH_KEY),
  save: (state) => storage.set(HEALTH_KEY, state),
});

export function resetHealth() {
  health.reset();
  storage.remove(RELAY_KEY);
  statusCache = null;
}

/* ------------------------------------------------- server tier (Vercel) */

// available: true  -> /api/medai answered (providers = which env keys exist)
// available: false -> definitely no function here (static host / SPA fallback)
// available: null  -> unknown (slow cold start, transient network): a bounded
//                     POST is still attempted instead of assuming "no keys".
const OFFLINE_STATUS = Object.freeze({ available: false, providers: Object.freeze({}), any: false });
const UNKNOWN_STATUS = Object.freeze({ available: null, providers: Object.freeze({}), any: false });
const STATUS_TTL_MS = { up: 120000, down: 120000, unknown: 10000 };
let statusCache = null;
let statusPromise = null;
let serverCoolUntil = 0;

export const peekServerStatus = () => (statusCache ? statusCache.value : null);

export function getServerStatus({ force = false } = {}) {
  if (statusPromise) return statusPromise;   // a check already in flight is the freshest answer
  if (!force && statusCache) {
    const v = statusCache.value;
    const ttl = v.available ? STATUS_TTL_MS.up : v.available === false ? STATUS_TTL_MS.down : STATUS_TTL_MS.unknown;
    if (Date.now() - statusCache.at < ttl) return Promise.resolve(v);
  }
  statusPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let value = UNKNOWN_STATUS;
    try {
      const res = await fetch(API_PATH, { headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('json')) {
        const data = await res.json();
        if (data && data.service === 'zerog-medai') {
          const providers = Object.fromEntries(PROVIDER_ORDER.map((id) => [id, Boolean(data.providers && data.providers[id])]));
          value = { available: true, providers, any: Object.values(providers).some(Boolean) };
        } else {
          value = OFFLINE_STATUS;
        }
      } else if (res.ok || res.status === 404 || res.status === 405 || type.includes('html')) {
        // A static host without the function answers with index.html or 404.
        value = OFFLINE_STATUS;
      }
      // Other statuses (5xx, 429 …) stay "unknown".
    } catch { /* Timeout or network error: unknown, not "absent". */ }
    clearTimeout(timer);
    statusCache = { at: Date.now(), value };
    statusPromise = null;
    return value;
  })();
  return statusPromise;
}

function markServerDown() {
  statusCache = { at: Date.now(), value: OFFLINE_STATUS };
}

function coolServer(ms) {
  serverCoolUntil = Date.now() + ms;
}

function markServerUp() {
  serverCoolUntil = 0;
  if (!statusCache || statusCache.value.available !== true) getServerStatus({ force: true });
}

async function askServer({ system, messages, maxTokens, budgetMs, preferred, model, only, strict, signal, onEvent, onDelta }) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  // Client-side guards on top of the function's own deadlines. Until visible text
  // arrives the deadline is absolute (attempt/failover events do not extend it);
  // afterwards a stall timer and a total cap apply.
  let timer = setTimeout(() => controller.abort(), budgetMs + 1500);
  const totalTimer = setTimeout(() => controller.abort(), LIMITS.totalMs + 3000);
  const rearm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), LIMITS.stallMs + 2000); };
  let text = '';
  try {
    let res;
    try {
      res = await fetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
        body: JSON.stringify({ system, messages, maxTokens, budgetMs, preferred: { provider: preferred || '', model: model || '' }, only, strict }),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      coolServer(controller.signal.aborted ? 20000 : 10000);   // transient: retry soon, do not assume "no keys"
      throw new AttemptError(controller.signal.aborted ? 'timeout' : 'network', 'MED-AI proxy unreachable');
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('ndjson') || !res.body) {
      let message = 'HTTP ' + res.status;
      let kind = res.status === 429 ? 'rate' : res.status === 403 ? 'blocked' : res.status === 503 ? 'unconfigured' : 'server';
      try {
        const data = await res.json();
        if (data && data.error) message += ' — ' + String(data.error).slice(0, 160);
        if (data && data.kind) kind = data.kind;
      } catch {
        // Not our JSON: SPA HTML / 404 means no function; anything else is transient.
        if (res.ok || res.status === 404 || res.status === 405) markServerDown();
        else coolServer(15000);
      }
      throw new AttemptError(kind, 'MED-AI proxy: ' + message, { status: res.status });
    }
    const reader = res.body.getReader();
    // A client deadline must settle a pending read() even if the body ignores the signal.
    controller.signal.addEventListener('abort', () => { reader.cancel().catch(() => { }); }, { once: true });
    const decoder = new TextDecoder();
    let buf = '';
    let done = null;
    const handle = (line) => {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch { return; }
      if (evt.type === 'delta' && typeof evt.text === 'string') {
        text += evt.text;
        onDelta?.(evt.text, { provider: evt.provider, model: evt.model, via: 'server' });
      } else if (evt.type === 'done') {
        done = evt;
      } else if (evt.type === 'error') {
        throw new AttemptError(evt.kind || 'server', evt.message || 'MED-AI proxy error', {
          emitted: Boolean(text) || Boolean(evt.emitted), partial: text, provider: evt.provider || '', attempts: evt.attempts || [],
        });
      } else {
        onEvent?.({ ...evt, source: 'server' });
      }
    };
    for (; ;) {
      const { value, done: finished } = await reader.read();
      if (controller.signal.aborted) throw abortError();
      if (finished) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        handle(line);
      }
      if (text) rearm();
    }
    handle(buf);
    if (!done || !text.trim()) {
      throw new AttemptError(text ? 'network' : 'empty', 'MED-AI proxy stream ended early', { emitted: Boolean(text), partial: text });
    }
    markServerUp();
    return { text: text.trim(), provider: done.provider, model: done.model, via: 'server', attempts: (done.attempts || []).map((a) => ({ ...a, source: 'server' })) };
  } catch (err) {
    if (signal && signal.aborted) throw err;
    if (err instanceof AttemptError) {
      if (text && !err.emitted) { err.emitted = true; err.partial = text; }
      throw err;
    }
    throw new AttemptError(isAbortError(err) ? 'timeout' : 'network', isAbortError(err) ? 'MED-AI proxy stream timed out' : 'MED-AI proxy stream dropped', { emitted: Boolean(text), partial: text });
  } finally {
    clearTimeout(timer);
    clearTimeout(totalTimer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/* ------------------------------------------- public relay (opt-in only) */

const RELAY_SPACING_MS = 30000;   // Pollinations Classic: one request per IP every ~30 s
const RELAY_COOLDOWN_MS = 120000;

export function relayCoolingFor() {
  const s = storage.get(RELAY_KEY) || {};
  const now = Date.now();
  return Math.max(0, (s.lastAt || 0) + RELAY_SPACING_MS - now, (s.coolUntil || 0) - now);
}

async function askRelay({ system, messages, signal, onDelta, timeoutMs = 6000 }) {
  const wait = relayCoolingFor();
  if (wait > 0) throw new AttemptError('rate', 'Public relay cooling down (' + Math.ceil(wait / 1000) + ' s)');
  storage.set(RELAY_KEY, { ...(storage.get(RELAY_KEY) || {}), lastAt: Date.now() });
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.min(6000, timeoutMs));
  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages: [{ role: 'system', content: system }, ...messages] }),
      signal: controller.signal,
    });
    if (!res.ok) throw new AttemptError(res.status === 402 || res.status === 429 ? 'rate' : 'server', 'Public relay HTTP ' + res.status, { status: res.status });
    const data = await res.json();
    const text = typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content.trim() : '';
    if (!text) throw new AttemptError('empty', 'Public relay returned no text');
    onDelta?.(text, { provider: 'pollinations', model: data.model || 'openai', via: 'relay' });
    return { text, provider: 'pollinations', model: data.model || 'openai', via: 'relay', attempts: [{ provider: 'pollinations', source: 'relay', kind: 'ok' }] };
  } catch (err) {
    if (signal && signal.aborted) throw err;
    storage.set(RELAY_KEY, { lastAt: Date.now(), coolUntil: Date.now() + RELAY_COOLDOWN_MS });
    if (err instanceof AttemptError) throw err;
    throw new AttemptError(isAbortError(err) ? 'timeout' : 'network', isAbortError(err) ? 'Public relay timed out (6 s)' : 'Public relay unreachable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* --------------------------------------------------------- main entry */

function providerOrder(preferred, only) {
  if (!PROVIDERS[preferred]) return [...PROVIDER_ORDER];
  return only ? [preferred] : [preferred, ...PROVIDER_ORDER.filter((id) => id !== preferred)];
}

/**
 * Ask MED-AI. Resolves { text, provider, model, via: 'server'|'browser'|'relay', attempts }.
 * Rejects with AttemptError: kind 'onboard' (onboard selected), 'exhausted' (no live
 * tier answered — attempts attached), or any kind with `emitted:true` + `partial`
 * when a link dropped after text was already streamed.
 */
export async function askMedAI({ engine, system, history = [], prompt, maxTokens = 1800, signal, onEvent, onDelta, budgetMs = LIMITS.budgetMs, only = false, strict = false, preferBrowser = false }) {
  throwIfAborted(signal);
  const eng = normalizeEngine(engine);
  if (eng.provider === 'onboard') throw new AttemptError('onboard', 'Onboard engine selected', { attempts: [] });
  const preferred = PROVIDERS[eng.provider] ? eng.provider : '';
  const model = preferred ? eng.model : '';
  const isOnly = Boolean(only && preferred);
  const messages = toChatMessages(history, prompt);
  if (!messages.length) throw new AttemptError('exhausted', 'Empty prompt', { attempts: [] });
  const deadlineAt = Date.now() + budgetMs;
  const remaining = () => deadlineAt - Date.now();
  const attempts = [];

  rememberKeys(eng);
  const status = await getServerStatus();
  throwIfAborted(signal);
  const statusUnknown = status.available === null;
  // Unknown status: let the function decide (it answers 503 at once if it has no keys).
  const serverIds = providerOrder(preferred, isOnly).filter((id) => statusUnknown || status.providers[id]);
  const browserCandidates = providerOrder(preferred, isOnly)
    .filter((id) => eng.keys[id])
    .map((id) => ({ provider: id, key: eng.keys[id], model: id === preferred ? model : '', source: 'browser', strict: Boolean(strict && id === preferred) }));

  const serverTier = async () => {
    if (status.available === false || !serverIds.length || remaining() < 800) return null;
    if (Date.now() < serverCoolUntil) {
      attempts.push({ provider: 'medai-proxy', source: 'server', kind: 'cooldown', message: 'retrying the proxy in ' + Math.ceil((serverCoolUntil - Date.now()) / 1000) + ' s' });
      return null;
    }
    // askServer adds a 1.5 s network grace; keep that inside the chain budget and,
    // when browser keys exist, leave them ~2 s in case the proxy hangs.
    const share = Math.max(800, remaining() - 1500 - (browserCandidates.length ? 2000 : 0));
    try {
      return await askServer({ system, messages, maxTokens, budgetMs: share, preferred, model, only: isOnly, strict, signal, onEvent, onDelta });
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) throw err;
      if (err.emitted) throw err;
      if (err.attempts && err.attempts.length) attempts.push(...err.attempts.map((a) => ({ ...a, source: 'server' })));
      else attempts.push({ provider: 'medai-proxy', source: 'server', kind: err.kind, message: err.message });
      onEvent?.({ type: 'failover', provider: 'server', kind: err.kind, message: err.message });
      return null;
    }
  };

  const browserTier = async () => {
    if (!browserCandidates.length || remaining() < 800) return null;
    try {
      const r = await runChain({
        candidates: browserCandidates, system, messages, maxTokens, signal, health,
        budgetMs: remaining(), appUrl: typeof location !== 'undefined' ? location.origin : '', appTitle: APP_TITLE,
        onEvent: (e) => onEvent?.({ ...e, source: 'browser' }),
        onDelta: (text, meta) => onDelta?.(text, { ...meta, via: 'browser' }),
      });
      attempts.push(...r.attempts);
      return { text: r.text, provider: r.provider, model: r.model, via: 'browser', attempts: [...attempts] };
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) throw err;
      if (err.attempts) attempts.push(...err.attempts);
      if (err.emitted) { err.attempts = [...attempts]; throw err; }
      return null;
    }
  };

  // Auto mode: Vercel env keys -> browser keys -> (opt-in relay) -> onboard.
  // A provider the user explicitly selected is tried with its own env key first;
  // only when this deployment is known to lack that provider's env key (or for a
  // connection test of a freshly pasted key) is its browser key tried first.
  const serverLacksPreferred = status.available === false || (status.available === true && !status.providers[preferred]);
  const browserFirst = Boolean(preferred && eng.keys[preferred] && (preferBrowser || serverLacksPreferred));
  const tiers = browserFirst ? [browserTier, serverTier] : [serverTier, browserTier];
  for (const tier of tiers) {
    const result = await tier();
    if (result) return { ...result, attempts: result.attempts && result.attempts.length ? result.attempts : [...attempts] };
  }

  // The relay shares the same absolute budget: it never extends the wait for the onboard answer.
  if (eng.publicRelay && !isOnly && remaining() > 1500) {
    try {
      return await askRelay({ system, messages, signal, onDelta, timeoutMs: remaining() });
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) throw err;
      attempts.push({ provider: 'pollinations', source: 'relay', kind: err.kind, message: err.message });
    }
  }

  const configured = (status.available === true && serverIds.length) || browserCandidates.length || (eng.publicRelay && !isOnly);
  for (const a of attempts) if (a.message) a.message = redactSecrets(a.message);
  throw new AttemptError('exhausted', configured ? 'No live provider answered in time' : 'No live provider configured', { attempts, configured: Boolean(configured) });
}

/* ------------------------------------------------------- model catalogs */

/**
 * Lists models for the modal. Never selects one. Source order: pasted browser
 * key → server key via /api/medai → public catalog (OpenRouter, Hugging Face)
 * → curated auto list (so the list is never blank).
 */
export async function listModels({ provider, key = '', signal } = {}) {
  const p = PROVIDERS[provider];
  if (!p) return { models: [], source: 'none', note: '' };
  const curated = () => p.autoModels.map((id, i) => ({ id, name: '', ctx: 0, free: (p.freeModels || []).includes(id), light: true, recommended: i + 1 }));
  let note = '';
  if (key) {
    try {
      return { models: await fetchModels(provider, key, { signal }), source: 'browser key', note: '' };
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) throw err;
      if (err.kind === 'auth') return { models: curated(), source: 'curated', note: 'Key rejected (' + redactSecrets(err.message, [key]) + ')', error: err.kind };
      note = 'Browser-key model list failed: ' + redactSecrets(err.message, [key]);
    }
  }
  const status = await getServerStatus();
  throwIfAborted(signal);
  if (status.providers[provider]) {
    try {
      const res = await fetch(API_PATH + '?models=' + encodeURIComponent(provider), { signal, headers: { accept: 'application/json' } });
      const data = await res.json();
      if (res.ok && Array.isArray(data.models)) return { models: data.models, source: 'Vercel env key', note };
      note = 'Server model list failed: ' + redactSecrets(String(data.error || res.status).slice(0, 120), [key]);
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) throw err;
      note = 'Server model list unreachable';
    }
  }
  if (p.publicModels) {
    try {
      return { models: await fetchModels(provider, '', { signal }), source: 'public catalog', note };
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) throw err;
      note = note || 'Public catalog unreachable';
    }
  }
  return { models: curated(), source: 'curated', note: note || 'Add a ' + p.label + ' key (Vercel env or below) to load its live catalog' };
}

/* -------------------------------------------------- connection testing */

export async function testConnection({ engine, signal } = {}) {
  const eng = normalizeEngine(engine);
  if (eng.provider === 'onboard') return { ok: true, provider: 'onboard', model: 'deterministic', via: 'local', ms: 0, text: 'Onboard engine ready' };
  const started = performance.now();
  const events = [];
  const result = await askMedAI({
    engine: eng,
    system: 'You are a connectivity check for a medical dashboard. Reply with the exact words: MED-AI LINK OK',
    history: [],
    prompt: 'Reply with exactly: MED-AI LINK OK',
    maxTokens: 120,
    signal,
    budgetMs: 9000,
    only: eng.provider !== 'auto',
    strict: Boolean(eng.model),
    preferBrowser: true,
    onEvent: (e) => events.push(e),
  });
  return { ok: true, ...result, ms: Math.round(performance.now() - started), events };
}

/* ------------------------------------------------------ human messages */

const KIND_TEXT = {
  auth: 'key rejected',
  credits: 'no credits',
  model: 'model unavailable',
  param: 'parameter rejected',
  rate: 'rate-limited',
  server: 'provider error',
  network: 'network error',
  timeout: 'timed out',
  empty: 'empty answer',
  blocked: 'blocked by provider firewall',
  cooldown: 'cooling down',
  unconfigured: 'no key configured',
  bad_request: 'request rejected',
};

export function providerLabel(id) {
  if (id === 'pollinations') return 'Pollinations relay';
  if (id === 'medai-proxy' || id === 'server') return 'MED-AI proxy';
  return PROVIDERS[id] ? PROVIDERS[id].label : 'Onboard';
}

export function describeFailure(err) {
  return redactSecrets(describeFailureRaw(err));
}

function describeFailureRaw(err) {
  if (!err) return 'Unknown error';
  if (err.kind === 'onboard') return 'Onboard engine selected';
  const list = (err.attempts || []).filter((a) => a.kind !== 'ok');
  if (!list.length) return err.message || 'No live provider answered';
  return list.slice(-4).map((a) => {
    const where = providerLabel(a.provider) + (a.source === 'server' ? ' (Vercel key)' : a.source === 'browser' ? ' (browser key)' : '');
    const detail = a.message ? ': ' + String(a.message).replace(/^HTTP \d+ — /, '').slice(0, 90) : '';
    return where + ' — ' + (KIND_TEXT[a.kind] || a.kind) + (a.status ? ' (' + a.status + ')' : '') + detail;
  }).join(' · ');
}
