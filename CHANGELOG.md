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

## 4. Three-tier AI failover

| Tier | Transport | Deadline |
| --- | --- | --- |
| 1 | Configured providers (Groq / Gemini / OpenRouter) from `VITE_*` env or the user's own key, run concurrently, first valid answer wins | 3.5 s per request, headers **and** body |
| 2 | `POST https://text.pollinations.ai/openai`, `model: "openai"`, no auth header | 6 s |
| 3 | Onboard deterministic NASA-STD-3001 builder (English and Arabic) | immediate |

- Every request uses `AbortController` with a hard deadline; late responses cannot win.
- Tier 2 validates the OpenAI response schema and non-empty content before accepting it.
- Tier 3 also runs immediately when the browser reports offline or the user selects the onboard
  engine. The old 28-second failover timer and the artificial 450 ms local delay are gone.
- Each reply is badged with the provider that actually answered; the header metadata follows the
  completed request, not the merely selected one.
- **No credentials are embedded.** The previous build shipped hard-coded provider keys and
  obfuscated them; those are removed rather than disguised. Keys come from `VITE_*` environment
  variables (still public in a client bundle) or from the user's own browser-local settings.
  Rotate any key that was previously published.

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
  client-side key secret; use a server proxy if keys must stay private.
- No claim of "zero bugs" or "100 % uptime". The measured evidence and the remaining limits are in
  `TEST_EVIDENCE.md`.
