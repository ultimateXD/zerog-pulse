# Test evidence — repaired build

All runs used the production bundle (`npm run build`, served by `vite preview`) unless noted.
Browser: Chrome 156 in the sandbox, **software rasteriser (SwiftShader, 6 vCPU, no GPU)**, so absolute
frame rates are pessimistic compared with real hardware. Raw JSON is in `evidence/`.

## Build and lint

| Check | Before | After |
| --- | --- | --- |
| `npm run lint` (oxlint) | 7 warnings, 0 errors | **0 warnings, 0 errors** |
| `npm run build` | pass, 724 kB JS (215 kB gzip) | pass, 742 kB JS (222 kB gzip), 29.6 kB CSS |
| Vite chunk-size notice | present (>500 kB) | still present — non-fatal, no code-splitting pass was requested |
| Embedded provider keys in source/bundle | present (obfuscated) | **none** |

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

## AI failover

| Case | Result |
| --- | --- |
| All provider and Pollinations requests blocked | Deterministic answer in **170–236 ms**, no error banner |
| Arabic question with all endpoints blocked | Arabic clinical reply present (assessment, telemetry, checklist), no error |
| Four rapid sends interleaved with scenario switches | No crash, no stale reply appended to the wrong scenario |
| `speechSynthesis` throwing, no `clipboard`, no `SpeechRecognition` | **0 page errors** (before the guard: 2 page errors) |

External probe of the requested anonymous endpoint (`POST text.pollinations.ai/openai`,
`model: "openai"`, no auth): returned a valid OpenAI-format answer, but took **7.6 s** — beyond the
6 s budget — and the app also saw intermittent 402/403 responses during the session. Tier 2 is
therefore best-effort, and tier 3 is what guarantees an immediate answer.

## Not verified here

- Real provider keys, paid quotas or authenticated provider latency: no key was used.
- Real sensors, real DSN transmission, clinical validity, or accessibility conformance certification.
- Browsers other than Chrome 156; Web Speech and Arabic voice availability vary by platform.
