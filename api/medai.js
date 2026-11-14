/* ============================================================================
 * /api/medai — Vercel Function (Web-standard handler).
 *
 * Holds the provider keys server-side. It reads the SAME names you already set
 * in Vercel (VITE_GROQ_API_KEY, VITE_GEMINI_API_KEY, VITE_OPENROUTER_API_KEY,
 * VITE_HUGGINGFACE_API_KEY) at runtime, or the recommended un-prefixed names
 * (GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, HUGGINGFACE_API_KEY).
 * The client bundle never references these variables, so they are not
 * inlined into public JavaScript.
 *
 *   GET  /api/medai              -> { service, providers: { groq: true, ... } }  (booleans only)
 *   GET  /api/medai?models=groq  -> { provider, models: [...] }                  (server-key catalog)
 *   POST /api/medai              -> NDJSON stream of attempt / delta / done / error events
 * ==========================================================================*/
import {
  PROVIDERS, PROVIDER_ORDER, LIMITS, APP_TITLE,
  runChain, fetchModels, createHealth, sanitizeMessages, cleanModelId, isAbortError,
} from '../src/ai/engine.js';

const ENV_NAMES = {
  groq: ['GROQ_API_KEY', 'VITE_GROQ_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'VITE_GEMINI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY', 'VITE_OPENROUTER_API_KEY'],
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN', 'VITE_HUGGINGFACE_API_KEY', 'VITE_HF_API_KEY'],
};

export function serverKeys(env = process.env) {
  const keys = {};
  for (const id of PROVIDER_ORDER) {
    const name = ENV_NAMES[id].find((n) => String(env[n] || '').trim());
    keys[id] = name ? String(env[name]).trim() : '';
  }
  return keys;
}

const health = createHealth();              // per warm instance
const buckets = new Map();                  // per-IP token bucket (best effort)
// 20 answers/min per IP: room for several judges behind one venue NAT, still
// below Groq's per-model free-tier RPM so provider quotas stay the real cap.
const RATE = { capacity: 20, refillPerMs: 20 / 60000 };

function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: RATE.capacity, at: now };
  b.tokens = Math.min(RATE.capacity, b.tokens + (now - b.at) * RATE.refillPerMs);
  b.at = now;
  const limited = b.tokens < 1;
  if (!limited) b.tokens -= 1;
  buckets.set(ip, b);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
  return limited;
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

function requestHost(request) {
  return request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
}

/* Only the app's own origin may spend the server keys. */
function originAllowed(request) {
  if (process.env.MEDAI_DEV === '1') return true;
  const origin = request.headers.get('origin');
  const extra = String(process.env.MEDAI_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin) return request.headers.get('sec-fetch-site') === 'same-origin';
  try {
    const o = new URL(origin);
    return o.host === requestHost(request) || extra.includes(o.origin);
  } catch {
    return false;
  }
}

function scrub(text, keys) {
  let out = String(text || '');
  for (const v of Object.values(keys)) if (v) out = out.split(v).join('<redacted>');
  return out.slice(0, 300);
}

const scrubAttempts = (list, keys) => (list || []).map((a) => ({ ...a, message: a.message ? scrub(a.message, keys) : undefined }));

export const MAX_BODY_BYTES = 64 * 1024;

/* Reads at most `limit` bytes; returns null as soon as the body exceeds it. */
async function readBodyLimited(request, limit) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      try { await reader.cancel(); } catch { /* Already closed. */ }
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
  return new TextDecoder().decode(bytes);
}

function orderFor(preferred, only, keys) {
  const ids = preferred && PROVIDERS[preferred]
    ? [preferred, ...PROVIDER_ORDER.filter((id) => id !== preferred)]
    : [...PROVIDER_ORDER];
  return (only && preferred ? [preferred] : ids).filter((id) => keys[id]);
}

async function handleGet(request, keys) {
  const url = new URL(request.url);
  const provider = url.searchParams.get('models');
  if (!provider) {
    return json(200, {
      service: 'zerog-medai',
      version: 2,
      order: PROVIDER_ORDER,
      providers: Object.fromEntries(PROVIDER_ORDER.map((id) => [id, Boolean(keys[id])])),
    });
  }
  if (!PROVIDERS[provider]) return json(400, { error: 'Unknown provider' });
  if (!keys[provider]) return json(404, { error: PROVIDERS[provider].label + ' has no server key' });
  try {
    const models = await fetchModels(provider, keys[provider], { timeoutMs: 8000 });
    return json(200, { provider, models }, { 'cache-control': 'private, max-age=300' });
  } catch (err) {
    return json(502, { error: scrub(err.message, keys), kind: err.kind || 'network' });
  }
}

async function handlePost(request, keys) {
  if (!originAllowed(request)) return json(403, { error: 'Origin not allowed' });
  if (rateLimited(clientIp(request))) return json(429, { error: 'Too many MED-AI requests — slow down' }, { 'retry-after': '15' });
  const raw = await readBodyLimited(request, MAX_BODY_BYTES);
  if (raw === null) return json(413, { error: 'Payload too large' });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'Invalid JSON' }); }

  const messages = sanitizeMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json(400, { error: 'A user message is required' });
  const system = typeof body.system === 'string' ? body.system.slice(0, LIMITS.systemChars) : '';
  const maxTokens = Math.max(16, Math.min(LIMITS.maxTokens, Number(body.maxTokens) || 600));
  const budgetMs = Math.max(1500, Math.min(LIMITS.budgetMs + 1000, Number(body.budgetMs) || LIMITS.budgetMs));
  const preferred = PROVIDERS[body.preferred?.provider] ? body.preferred.provider : '';
  const model = cleanModelId(body.preferred?.model);
  const only = Boolean(body.only);
  const strict = Boolean(body.strict);

  const ids = orderFor(preferred, only, keys);
  if (!ids.length) return json(503, { error: 'No server-side provider key is configured', kind: 'unconfigured' });
  const candidates = ids.map((id) => ({ provider: id, key: keys[id], model: id === preferred ? model : '', source: 'server', strict: strict && id === preferred }));

  const origin = request.headers.get('origin') || 'https://' + requestHost(request);
  const abort = new AbortController();
  request.signal?.addEventListener?.('abort', () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { open = false; }
      };
      try {
        const result = await runChain({
          candidates, system, messages, maxTokens, budgetMs, health,
          signal: abort.signal, appUrl: origin, appTitle: APP_TITLE,
          onEvent: (e) => send({ ...e, message: e.message ? scrub(e.message, keys) : undefined }),
          onDelta: (text, meta) => send({ type: 'delta', text, provider: meta?.provider, model: meta?.model }),
        });
        send({ type: 'done', provider: result.provider, model: result.model, ms: Date.now() - started, attempts: scrubAttempts(result.attempts, keys) });
      } catch (err) {
        if (!isAbortError(err)) {
          send({
            type: 'error',
            kind: err.kind || 'server',
            message: scrub(err.message, keys),
            emitted: Boolean(err.emitted),
            provider: err.provider || '',
            attempts: scrubAttempts(err.attempts, keys),
          });
        }
      } finally {
        open = false;
        try { controller.close(); } catch { /* Client already gone. */ }
      }
    },
    cancel() { abort.abort(); },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  async fetch(request) {
    const keys = serverKeys();
    try {
      if (request.method === 'GET' || request.method === 'HEAD') return await handleGet(request, keys);
      if (request.method === 'POST') return await handlePost(request, keys);
      return json(405, { error: 'Method not allowed' }, { allow: 'GET, POST' });
    } catch (err) {
      return json(500, { error: 'MED-AI function error', detail: scrub(err && err.message, keys) });
    }
  },
};
