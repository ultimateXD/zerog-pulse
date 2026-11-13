# ZeroG Pulse — Autonomous Deep-Space Telemedicine & Multi-Organ Digital Twin

**NASA Space Apps Cairo 2026 Submission**  
**Team Members:**
* **CDR Ahmed Taha** — Commander & Systems Lead
* **PLT Ahmed Tamer** — Pilot & Telemetry Systems
* **MS Mohamed** — Mission Specialist · Flight Surgeon Adjunct
* **MS Lojain Tamer** — Mission Specialist · Bioastronautics Officer

---

## 1. Problem & Impact (Deep Space + Earth Dual-Use)
During deep-space Artemis and Mars transit missions, one-way light-speed communication delays reach **14 minutes 28 seconds** (up to 44 minutes round-trip). When acute medical emergencies strike—such as a **Solar Particle Event (SPE) radiation storm**, **cabin $CO_2$ scrubber failure**, or **microgravity intracranial fluid shift (SANS)**—astronauts cannot wait for real-time flight surgeon intervention from Earth.

**ZeroG Pulse** provides an autonomous, zero-latency onboard medical officer (**MED-AI**) coupled with a real-time **5-Organ Holographic Digital Twin** and **30-Minute Clinical Deterioration Predictor**.
* **Space Impact:** Protects astronaut health and mission continuity during communication blackouts and deep-space transit.
* **Earth Dual-Use Impact:** Directly translates space telemedicine to rural ICUs, disaster zones, submarines, and homebound elderly care on Earth.

---

## 2. Official NASA & Space Agency Partner Resources Used
1. **[NASA HRP — 5 Hazards of Human Spaceflight](https://www.nasa.gov/hrp/hazards/):** Models Space Radiation, Isolation & Confinement, Distance from Earth (14m 28s comm latency), Gravity Fields, and Hostile/Closed Environments.
2. **[NASA HRP — Risks of Human Spaceflight](https://www.nasa.gov/hrp/risks/):** Drives multi-organ stress thresholds for Spaceflight Associated Neuro-ocular Syndrome (SANS), acute hypoxia, cardiovascular deconditioning, and circadian desynchrony.
3. **[NASA HRP — Ongoing HRP Research in Space](https://www.nasa.gov/hrp/ongoing-hrp-research/):** Aligns crew biomarker streams with NASA Standard Measures, ARCHeR (sleep & autonomic HRV), and CIPHER multi-organ protocols.
4. **[CSA (Canadian Space Agency) — Monitoring Radiation for Astronaut Health](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp):** Integrates Canadian Active Neutron Spectrometer (CANS) and Bubble Detector dosimetry principles into real-time `mSv/day` radiation alerts and storm-shelter protocols.
5. **[CSA — Why Do We Conduct Science Experiments in Space?](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp):** Models wearable telemetry after CSA's Bio-Monitor Smart Shirt + AI platform and CARDIOBREATH experiments for Earth Dual-Use healthcare.
6. **NASA-STD-3001 & NASA OSDR (`OSD-51`, `OSD-194`):** Establishes quantitative flight-rule physiological thresholds and baseline crew calibration.

---

## 3. Core Architecture & Key Features
* **Live Biometric Telemetry HUD:** Tracks Heart Rate (`bpm`), Blood Oxygen (`SpO₂ %`), Heart Rate Variability (`RMSSD ms`), Radiation Dose (`mSv/day`), Cabin `ppCO₂` (`mmHg`), and Sleep Efficiency across 4 distinct crew physiological baselines.
* **5-Organ Holographic Digital Twin:** Real-time physiological stress mapping across the **Brain / CNS**, **Cardiovascular System**, **Pulmonary System**, **Hematopoietic / Blood Marrow**, and **Circadian Autonomic System**.
* **Autonomous MED-AI Officer (Bilingual English/Arabic + Hands-Free Voice):** Automatically detects telemetry threshold breaches when an emergency scenario is triggered and issues immediate step-by-step clinical countermeasures with Web Speech API voice input/output.
* **Multi-Layer Cloud AI + Offline Failover:** Combines zero-key cloud LLM reasoning with an onboard deterministic `NASA-STD-3001` clinical rule engine for 100% uptime even during complete network blackouts.

---

## 4. Run Locally
```bash
npm install
npm run dev

---
## Run, configure and deploy this repaired build

This repository is the repaired version of the ZeroG Pulse submission. It is delivered as source;
nothing was pushed to the original GitHub repository or to the existing Vercel deployment.

### Local run

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview    # serve the production build
npm run lint       # oxlint
```

### Optional AI provider keys

Copy `.env.example` to `.env` and fill only the providers you actually use:

```
VITE_GROQ_API_KEY=
VITE_GEMINI_API_KEY=
VITE_OPENROUTER_API_KEY=
```

`VITE_*` values are compiled into the public JavaScript bundle. They are configuration, not secret
storage: anyone can read them in DevTools. If a key must stay private, put it behind your own
server-side proxy and call that proxy from the browser instead. The app works with no keys at all —
it answers from the onboard deterministic engine, and the no-key Pollinations tier is attempted
first as a best-effort online path. Keys can also be entered per user in the app's
"Configure AI Engine" dialog; those stay in that browser's `localStorage`.

### Deploy to Vercel

1. Create a new empty repository and push this folder (`git init`, commit, push) — do not push over
   the existing `ultimateXD/zerog-pulse` history unless you intend to replace it.
2. In Vercel: **Add New → Project → Import** the repository.
3. Framework preset: **Vite**. Build command `npm run build`. Output directory `dist`.
4. Add the `VITE_*` environment variables (optional) under **Settings → Environment Variables**.
5. Deploy. No server runtime, database or API route is required — this is a static SPA.
6. After deploying, rotate any provider key that was previously committed in the old build.

### Evidence

`TEST_EVIDENCE.md` records the measured build, lint, layout, frame-timing, interaction and AI-failover
results, including what was *not* verified. `CHANGELOG.md` lists every change and the two things this
repair deliberately refuses to do (hide public keys, promise a bug-free or 100 %-uptime system).
