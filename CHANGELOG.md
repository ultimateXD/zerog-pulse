# ZeroG Pulse — Repair Changelog

Repair of the public ZeroG Pulse build (`ultimateXD/zerog-pulse`). Visual identity, palette, copy,
crew roster, `NASA_DATA_CONFIG` and `challengeResources` are unchanged — the configuration block is
byte-for-byte identical to the original (SHA-256 `8cf9f019…a96c`).

## 1. Rendering and starfield

- Removed the `body::after` fixed star layer that used `mix-blend-mode: screen`. It painted a second,
  full-viewport star field on top of the app's own starfield and forced a full-page recomposite on
  every animation frame.
- The only star layer is now the app's own `Starfield`: `absolute inset-0`, `pointer-events-none`,
  75 stars, single instance.
- Star motion now respects `prefers-reduced-motion` (CSS) and the SVG spacecraft marker stops
  travelling along the trajectory path under the same preference.

## 2. Paint cost

- Removed the global `backdrop-filter: blur(12px)` that applied to every HUD panel through shared
  selectors, and removed the `backdrop-blur-md` utility from six repeated card surfaces. Translucency
  is carried by the existing fills (`bg-slate-950/70`, `bg-slate-900/60`, `#060b14/90`).
- Kept blur only where it is one element and intentional: the sticky header and the three modal
  backdrops (only mounted while a modal is open).
- Panel gradient alpha reduced from `.92/.96` to `.72/.82` (hover `.95/.98` → `.80/.88`); palette,
  borders, HUD corner brackets and animation timings unchanged.

## 3. React work per tick

- `MissionHeader`, `ScenarioBar`, `VitalsCard`, `TelemetryChartPanel`, `OrganTwinView`,
  `BiomedicalDigitalTwinHUD` and `ProtocolPanel` are all `React.memo` wrapped; organ-stress maths,
  the 30-minute prediction, sparkline slices and the orbital SVG path are memoized.
- Root handlers are `useCallback`; the latest telemetry sample is a stable reference instead of a
  fresh spread on every render.
- Mission Elapsed Time now advances once per real interval. It previously advanced inside a state
  updater, which React may replay, so MET could jump.
- Both modals return `null` before any packet/JSON work when closed; the downlink packet is only
  built while the modal is open.
- `fmtVal` returns an em dash for `undefined`, `NaN` or infinite values instead of rendering
  non-finite numbers.

## 4. MED-AI engine (rebuilt)
Files: `src/aiTransport.js` (browser), `src/ai/engine.js` (shared provider core),
`api/medai.js` (Vercel Function), `vite.config.js` (same function in `npm run dev` / `preview`).

| Order | Tier | Notes |
| --- | --- | --- |
| 1 | `/api/medai` with the Vercel env keys | Reads `GROQ_API_KEY`… or the existing `VITE_GROQ_API_KEY`, `VITE_GEMINI_API_KEY`, `VITE_OPENROUTER_API_KEY`, `VITE_HUGGINGFACE_API_KEY` at runtime on the server; streams NDJSON. Keys never reach the bundle. |
| 2 | Browser keys from "Configure AI Engine" | Stored only in that browser's `localStorage` (`zgp_ai_engine_v2`), called directly (all four providers allow CORS). |
| 3 | Pollinations public relay | **Off by default** (opt-in checkbox). Max 1 request / 30 s, 6 s deadline, 120 s cool-down. |
| 4 | Onboard deterministic NASA-STD-3001 engine (EN/AR) | Always available, immediate. |

- Providers are tried **sequentially** (one provider billed per answer) in the order Groq → Gemini →
  OpenRouter → Hugging Face, with a 3.5 s first-token deadline, 6 s stall deadline, 8 s chain budget
  and 25 s per-answer cap. Health memory skips a failing provider for a short cool-down and remembers
  dead model IDs for 12 h, so a retired model costs at most one wasted call.
- **No model is auto-selected.** The modal opens on AUTOMATIC; the full live catalogue is listed
  for browsing (AUTO #n / FREE / LIGHT / context tags) and a model is used only if the user pins it.
  "Fetch & Verify" auto-locking was removed. Legacy saved settings migrate to AUTOMATIC.
- Light, current models: Groq `openai/gpt-oss-20b` → `qwen/qwen3.8-27b` → `allam-2-7b` (the 120B
  model stays browsable but is never picked automatically);
  Gemini `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-lite-latest` →
  `gemini-2.5-flash-lite`; OpenRouter `meta-llama/llama-3.1-8b-instruct` →
  `google/gemini-2.5-flash-lite` → `openrouter/free` (402 → free models); Hugging Face router
  `meta-llama/Llama-3.1-8B-Instruct` → `google/gemma-3-4b-it` → `Qwen/Qwen3.5-9B`.
  `llama-3.1-8b-instant`, `gemini-1.5-flash`, `google/gemini-flash-1.5` and
  `mistralai/Mistral-7B-Instruct-v0.2` are retired or unavailable and are not used automatically.
- Calibrated requests: Groq `max_completion_tokens` + low reasoning; Gemini
  `:streamGenerateContent?alt=sse`, `x-goog-api-key`, `systemInstruction`, minimal thinking;
  OpenRouter `HTTP-Referer`, `X-OpenRouter-Title`/`X-Title`, `models` fallback array, low reasoning;
  Hugging Face `router.huggingface.co/v1`. Unsupported optional parameters are retried once plain.
- Save Engine now updates the header badge immediately from the saved engine (not from the last
  reply) and persists across reloads; a separate "↳ last responder" pill shows who actually answered.
- Streaming replies render token by token; a mid-answer drop keeps the partial text and the
  onboard engine completes the turn instead of silently stalling.
- `/api/medai` guards: same-origin check, 20 requests/min per IP (best effort, per instance),
  64 KB body cap enforced while reading (also for chunked bodies, in the function and in the
  dev/preview middleware), error text and every reported attempt scrubbed of key material.
- Hard deadlines: before the first answer word, keep-alive, reasoning and failover events can no
  longer stretch the wait past the chain budget (server and browser), and the opt-in relay only
  uses whatever budget is left, so the onboard answer arrives within about 8–10 s at worst
  (typical live answers start in under 2 s).
- Proxy status has three states: available, absent (static host / 404) and unknown (slow cold
  start, 5xx, timeout). Unknown still tries the proxy instead of reporting "no keys".
- Anything shown in the UI (failure notes, catalogue errors) passes through key redaction, so a
  provider that echoes a pasted key cannot display it.
- SSE events split across several `data:` lines are joined per the SSE spec.

## 5. Lifecycle, races and cleanup

- In-flight chat requests, alarm timers, speech recognition and speech synthesis are cancelled on
  crew change, scenario change, engine change, checklist change and unmount.
- Replies verify crew, scenario, engine, checklist and request identity before appending, so a slow
  answer cannot land in a different context.
- A synchronous busy ref blocks double-sends before React commits state.
- Settings discovery/probe/connection-test calls take abort signals and finite deadlines; closing or
  saving the settings modal cancels them, and stale results cannot overwrite a newer draft.
- Clipboard timers, the DSN uplink interval and the "copied" badge are cleaned up; clipboard and
  print failures are contained, and transient helper nodes are always removed.
- Crew changes update the roster, seeded telemetry and checklist together, and scenario changes
  reset the checklist in the same event instead of a follow-up effect.

## 6. Compatibility and accessibility

- Web Speech and Clipboard are treated as optional APIs: missing, denied, throwing or broken
  implementations no longer produce page errors.
- Arabic input produces a deterministic Arabic clinical reply (assessment, prognosis, checklist,
  telemetry labels, Earth report) with RTL rendering; speech recognition and synthesis follow the
  language of the last user message.
- Modals now expose `role="dialog"`, `aria-modal="true"` and close on `Escape`.

## 7. Responsive behaviour

- Cards gained intrinsic `min-width: 0`, long-token wrapping and bounded badges so six vitals stay
  aligned on their baselines from 375 px to 1920 px.
- The old global `svg` max-width rule that could clip icons is scoped to the metric sparkline
  surfaces only.
- Phone chat input gets its own row; orbital labels use a non-overlapping responsive grid on phones.
- Verified at 375×812, 768×1024, 1280×720, 1366×768, 1440×900 and 1920×1080 with no horizontal
  overflow and no console errors.

## 8. Deliberately not done

- Provider keys are **not** split or obfuscated to dodge secret scanning. Obfuscation does not make a
  client-side key secret; the keys now live server-side in `api/medai.js` instead.
- No claim of "zero bugs" or "100 % uptime". The measured evidence and the remaining limits are in
  `TEST_EVIDENCE.md`.
