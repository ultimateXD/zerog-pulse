# Test evidence — repaired build

All runs used the production bundle (`npm run build`, served by `vite preview`) unless noted.
Browser: Chrome 156 in the sandbox, **software rasteriser (SwiftShader, 6 vCPU, no GPU)**, so absolute
frame rates are pessimistic compared with real hardware. Raw JSON is in `evidence/`.

## Build and lint

| Check | Before | After |
| --- | --- | --- |
| `npm run lint` (oxlint) | 7 warnings, 0 errors | **0 warnings, 0 errors** |
| `npm run build` | pass, 724 kB JS (215 kB gzip) | pass, 770 kB JS (232 kB gzip), 30.1 kB CSS |
| Vite chunk-size notice | present (>500 kB) | still present — non-fatal, no code-splitting pass was requested |
| Embedded provider keys in source/bundle | present (obfuscated) | **none** — also verified by building with all four `VITE_*_API_KEY` set to fake values and grepping `dist/` (0 hits) |

## Layout, overflow and console at six viewports

| Viewport | scrollWidth / innerWidth | Console errors | `NaN` text | Star layers | `body::after` |
| --- | --- | --- | --- | --- | --- |
| 375×812 | 360 / 375 | 0 | no | 1 (75 stars) | none |
| 768×1024 | 753 / 768 | 0 | no | 1 | none |
| 1280×720 | 1265 / 1280 | 0 | no | 1 | none |
| 1366×768 | 1351 / 1366 | 0 | no | 1 | none |
| 1440×900 | 1425 / 1440 | 0 | no | 1 | none |
| 1920×1080 | 1905 / 1920 | 0 | no | 1 | none |

`scrollWidth` is 15 px below `innerWidth` at every size because the vertical scrollbar occupies that
width — no horizontal overflow at any viewport.

## Frame timing — before vs after (same browser, same machine)

| Viewport / mode | Original build | Repaired build |
| --- | --- | --- |
| 1366×768 idle | 10.4 fps, median 100.8 ms | 37.7 fps, median 33.5 ms |
| 1366×768 scroll | 10.6 fps, median 84.1 ms | 52.3 fps, median 16.8 ms |
| 1440×900 idle | 8.4 fps, median 117.5 ms | 36.0 fps, median 33.6 ms |
| 1440×900 scroll | 9.2 fps, median 100.9 ms | 51.3 fps, median 16.8 ms |

- Production build, all six viewports: **0 long tasks over 50 ms**. The original dev run produced long
  tasks up to 515 ms.
- Median frame interval during scripted full-page scrolling is 16.8 ms (60 fps) at 375–1280 px and
  33.6 ms at 1366–1920 px under software rendering.
- Honest limits: idle is ~30–38 fps here because the starfield twinkle and the blend-mode hologram
  repaint continuously and this sandbox has no GPU. A/B runs (star animation off, blend off) reached
  56–59 fps, so the remaining gap is paint-bound, not script-bound. On GPU hardware these costs are
  far lower; 60 fps everywhere is not guaranteed by measurement.

## Interaction stress (1280×720)

- 12 scenario switches (4 scenarios × 3 rounds), 8 crew switches, 9 telemetry-tab switches,
  3 open/close cycles of the NASA datasets modal, 3 of the downlink modal, 12 checklist toggles.
- Result: no crash, no leftover open dialog, no horizontal overflow, no `NaN`, no `undefined` text.
- One console entry: an HTTP 402 from a provider endpoint during tier-1 probing, which the app
  handles by falling back (no user-visible error).

## AI engine (rebuilt MED-AI transport)

Unit tests: `node --test` — 25/25 pass (SSE parsing incl. Gemini and multi-line events, real
provider error bodies, request shapes per provider, 404 → next model, first-token timeout → next
provider, reasoning-only stream stopped at the chain budget, mid-stream drop not replayed, stall,
total budget, Groq 429 → next Groq model, Groq auto list without the 120B model, OpenRouter 402 →
`openrouter/free`, plain retry on unsupported parameter, `/api/medai` status/origin/NDJSON/no key
leakage incl. scrubbed `done`/`error` attempts and 413 for a streamed oversized body, browser tier
order, unknown proxy status still POSTs, proxy events cannot extend the pre-answer deadline,
pasted keys redacted in failure notes and model-list notes, a hanging proxy still leaves time
for browser keys within the same budget, onboard fallback). All upstreams mocked.

An independent read-only code review found 7 defects (key echo in reported attempts, key echo in
browser-side notes, a slow cold start treated as "no keys", events extending the pre-answer wait,
the 120B Groq model in the auto list, multi-line SSE events, unbounded body reads). All 7 were
fixed and are covered by the tests above.

Live, through the local `/api/medai` with the real Groq and OpenRouter keys under the exact
`VITE_GROQ_API_KEY` / `VITE_OPENROUTER_API_KEY` names (Gemini and Hugging Face: no key available):

| Case | Result |
| --- | --- |
| Auto chain | Groq `openai/gpt-oss-20b`, first token 1.6 s, done 1.9 s |
| OpenRouter only | `meta-llama/llama-3.1-8b-instruct`, first token 1.6 s, done 1.9 s |
| Pinned retired `google/gemini-flash-1.5` | no 404 — served by `meta-llama/llama-3.1-8b-instruct` in one call |
| Model catalogues via env key | Groq 4 chat models, OpenRouter 417 models |
| Modal default (browser) | AUTOMATIC selected, nothing pinned, full list shown for Groq and OpenRouter |
| OpenRouter "Test API Connection" | ✅ Connected, 871 ms (previously HTTP 404) |
| Save Engine | modal closes, header badge updates immediately, survives reload |
| 4 consecutive English questions + 1 Arabic | all answered by Groq via Vercel key, 1.1–3.3 s each; Arabic reply in Arabic |
| `/api/medai` blocked | complete onboard reply in 0.19 s |
| Console | 0 errors except the deliberately blocked request (`net::ERR_FAILED`) |
| After the review fixes (re-run) | auto chain: Groq `openai/gpt-oss-20b`, first token 1.5 s, done 1.8 s; 70 KB body → 413 (with and without content-length) |
| Simulated cold start (GET `/api/medai` → 502) | badge stays "Auto Failover · auto model", modal says "slow to answer", question still answered by Groq through the proxy |

## Not verified here

- Gemini and Hugging Face live calls (no keys were available); behaviour is covered by unit tests
  against their documented request/stream formats only.
- The deployed Vercel Function itself: verified through the identical handler in `vite dev`, not on
  vercel.app.
- Real sensors, real DSN transmission, clinical validity, or accessibility conformance certification.
- Browsers other than Chrome 156; Web Speech and Arabic voice availability vary by platform.
