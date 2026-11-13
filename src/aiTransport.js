// VITE_* values are public in browser bundles. Prefer a server-side proxy for secrets.
export const DEFAULT_KEYS = Object.freeze({
  groq: String(import.meta.env.VITE_GROQ_API_KEY || '').trim(),
  gemini: String(import.meta.env.VITE_GEMINI_API_KEY || '').trim(),
  openrouter: String(import.meta.env.VITE_OPENROUTER_API_KEY || '').trim(),
  huggingface: '',
});

export function abortError() {
  return new DOMException('Request cancelled', 'AbortError');
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

// The deadline covers response headers AND body decoding. The race also bounds
// misbehaving fetch implementations; the controller cancels native network work.
export async function requestJSON(url, init = {}, signal, timeoutMs = 3500) {
  throwIfAborted(signal);
  const controller = new AbortController();
  let rejectAbort;
  const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    controller.abort();
    rejectAbort(abortError());
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        throwIfAborted(controller.signal);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        throwIfAborted(controller.signal);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Invalid response schema');
        }
        return data;
      })(),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

export function completionText(data, style = 'openai') {
  const raw = style === 'gemini'
    ? data?.candidates?.[0]?.content?.parts?.filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('\n')
    : data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Empty or invalid AI response');
  return raw.trim();
}

export async function callPollinations(systemPrompt, history, userText, signal) {
  const messages = history.filter((m) => m.role === 'user' || m.role === 'ai')
    .slice(-6).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
  const data = await requestJSON('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages: [{ role: 'system', content: systemPrompt }, ...messages, { role: 'user', content: userText }],
    }),
  }, signal, 6000);
  return completionText(data);
}

// Configured providers race within a single tier-one window, never serially.
export async function firstSuccessful(candidates, run, signal) {
  throwIfAborted(signal);
  if (!candidates.length) throw new Error('No configured providers');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await Promise.any(candidates.map((candidate) => run(candidate, controller.signal)));
    throwIfAborted(signal);
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
