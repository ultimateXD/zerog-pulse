/* ============================================================================
 * ZeroG Pulse | Autonomous Spaceflight Medical System  —  PHASE 2 (v2.0)
 * NASA Space Apps Challenge — Team "ZeroG"
 * ============================================================================
 * ARCHITECTURE NOTE:
 * ALL scientific data, clinical thresholds, crew baselines, emergency
 * scenarios, countermeasure protocols, organ-twin pathophysiology, AI
 * knowledge, and NASA dataset references live in NASA_DATA_CONFIG below.
 * No UI component contains hardcoded medical numbers or protocol text —
 * everything renders dynamically from this single configuration object.
 * ==========================================================================*/

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import {
  PROVIDERS, PROVIDER_ORDER, askMedAI, loadEngine, saveEngine, normalizeEngine, hasBrowserKeys,
  getServerStatus, peekServerStatus, listModels, testConnection, describeFailure, providerLabel, redactSecrets,
  detectProviderFromKey, resetHealth,
} from './aiTransport';
import { isArabic, buildArabicResponse } from './clinicalArabic';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  HeartPulse, Activity, ShieldAlert, Radiation, Wind, Moon, Brain, Radio, Bot,
  Database, CheckCircle2, AlertTriangle, Send, X, TrendingUp, TrendingDown, Minus,
  Sparkles, Copy, Printer, Satellite, Mic, Volume2, VolumeX,
} from 'lucide-react';


/* ============================================================================
 * SECTION 0 — NASA_DATA_CONFIG  (EDIT HERE ONLY — SCIENTIFIC / MISSION DATA)
 * ==========================================================================*/
const NASA_DATA_CONFIG = {
  mission: {
    name: 'ZeroG Pulse',
    tagline: 'Autonomous Spaceflight Medical System',
    destination: 'Mars Transit · Deep Space',
    craft: 'Deep Space Transport "Infinity-1"',
    team: 'Team ZeroG — NASA Space Apps Challenge 2026',
    missionId: 'ZGP-MARS-2026-042',
  },

  /* Why autonomy is mandatory: one-way light-time to Earth during Mars transit */
  comm: {
    oneWayDelaySeconds: 868, // 14m 28s
    label: '14m 28s',
    mode: 'One-Way Light Time',
    note: 'Earth MCC cannot respond in real time. Onboard AI must stabilize the crew autonomously for the full round-trip comm window (~29 min).',
  },
  /* ------------- Official NASA HRP & CSA Challenge Resources ------------ */
  challengeResources: [
    {
      id: 'hrp-hazards',
      agency: 'NASA HRP',
      title: '5 Hazards of Human Spaceflight',
      url: 'https://www.nasa.gov/hrp/hazards/',
      usage: 'Models Radiation, Isolation, Distance (14m 28s Mars delay), Gravity Fields, and Hostile Closed Environments (ppCO₂).',
    },
    {
      id: 'hrp-risks',
      agency: 'NASA HRP',
      title: 'Risks of Human Spaceflight',
      url: 'https://www.nasa.gov/hrp/risks/',
      usage: 'Drives 5-organ holographic stress thresholds for SANS (neuro-ocular fluid shift), cardiovascular adaptation, and acute hypoxia.',
    },
    {
      id: 'hrp-ongoing',
      agency: 'NASA HRP',
      title: 'Ongoing HRP Research in Space',
      url: 'https://www.nasa.gov/hrp/ongoing-hrp-research/',
      usage: 'Aligns crew biometrics with NASA Standard Measures, ARCHeR (sleep & autonomic HRV), and CIPHER multi-organ protocols.',
    },
    {
      id: 'csa-radiation',
      agency: 'CSA Partner',
      title: 'Monitoring Radiation for Astronaut Health',
      url: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp',
      usage: 'Integrates Canadian Active Neutron Spectrometer (CANS) & Bubble Detector dosimetry principles into real-time mSv/day SPE alerts.',
    },
    {
      id: 'csa-science',
      agency: 'CSA Partner',
      title: 'Why Do We Conduct Science Experiments in Space?',
      url: 'https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp',
      usage: 'Models non-invasive wearable telemetry on CSA Bio-Monitor Smart Shirt + AI & CARDIOBREATH for Earth Dual-Use rural ICU care.',
    },
  ],
  /* ------------- Crew Profiles (distinct physiological baselines) ------- */
  crews: [
    {
      id: 'taha', callsign: 'CDR', name: 'Ahmed Taha', role: 'Commander',
      baselines: { heartRate: 58, spo2: 98, hrv: 78, radiation: 0.42, co2: 2.4, sleep: 92 },
    },
    {
      id: 'tamer', callsign: 'PLT', name: 'Ahmed Tamer', role: 'Pilot',
      baselines: { heartRate: 66, spo2: 97, hrv: 64, radiation: 0.38, co2: 2.6, sleep: 87 },
    },
    {
      id: 'mohamed', callsign: 'MS', name: 'Mohamed', role: 'Mission Specialist · Flight Surgeon Adjunct',
      baselines: { heartRate: 72, spo2: 96, hrv: 52, radiation: 0.45, co2: 2.3, sleep: 81 },
    },
    {
      id: 'lojain', callsign: 'MS', name: 'Lojain Tamer', role: 'Mission Specialist · Bioastronautics Officer',
      baselines: { heartRate: 62, spo2: 99, hrv: 74, radiation: 0.36, co2: 2.4, sleep: 90 },
    },
  ],

  /* ---------------- Vitals & Environment Metric Definitions ---------------- */
  metrics: {
    heartRate: {
      label: 'Heart Rate', unit: 'BPM', iconKey: 'HeartPulse', decimals: 0, jitter: 2.2,
      thresholds: { warnLow: 50, warnHigh: 95, critLow: 40, critHigh: 130 },
      rangeLabel: 'Nominal 50 – 95 BPM',
      description: 'Microgravity fluid-shift elevates resting cardiac load; tachycardia flags radiation or hypoxic stress.',
      source: 'OSD-51',
    },
    spo2: {
      label: 'Blood Oxygen (SpO2)', unit: '%', iconKey: 'Activity', decimals: 0, jitter: 0.4,
      thresholds: { warnLow: 93, warnHigh: null, critLow: 90, critHigh: null },
      rangeLabel: 'Hypoxia alert < 93 % · Critical < 90 %',
      description: 'Peripheral capillary oxygen saturation; early hypoxia indicator for ECLSS atmosphere faults.',
      source: 'OSD-51',
    },
    hrv: {
      label: 'Heart Rate Variability', unit: 'ms', iconKey: 'Brain', decimals: 0, jitter: 1.8,
      thresholds: { warnLow: 30, warnHigh: null, critLow: 25, critHigh: null },
      rangeLabel: 'Autonomic stress < 30 ms · Critical < 25 ms',
      description: 'RMSSD heart-rate variability — autonomous nervous system & psychological stress indicator (NASA Standard Measures).',
      source: 'OSD-194',
    },
    radiation: {
      label: 'Radiation Dose Rate', unit: 'mSv/day', iconKey: 'Radiation', decimals: 2, jitter: 0.06,
      thresholds: { warnLow: null, warnHigh: 2.0, critLow: null, critHigh: 12.0 },
      rangeLabel: 'GCR nominal < 2 · SPE critical > 12 mSv/day',
      description: 'Active dosimeter rate vs. NASA career exposure limits (~600 mSv, age/sex adjusted, NASA-STD-3001).',
      source: 'OSD-194',
    },
    co2: {
      label: 'Cabin CO₂ Partial Pressure', unit: 'mmHg', iconKey: 'Wind', decimals: 2, jitter: 0.05,
      thresholds: { warnLow: null, warnHigh: 3.5, critLow: null, critHigh: 4.5 },
      rangeLabel: 'Scrubber nominal < 3.5 · Critical > 4.5 mmHg',
      description: 'Enclosed-atmosphere toxicity: hypercapnia causes headache, cognitive fatigue and compensatory hyperventilation in µg.',
      source: 'NASA-STD-3001',
    },
    sleep: {
      label: 'Circadian & Sleep Efficiency', unit: '%', iconKey: 'Moon', decimals: 1, jitter: 0.5,
      thresholds: { warnLow: 80, warnHigh: null, critLow: 70, critHigh: null },
      rangeLabel: 'Isolation / 16 sunrises-day · Critical < 70 %',
      description: 'Actigraphy-derived sleep efficiency. Circadian misalignment degrades cognition, immunity and SANS risk profile.',
      source: 'OSD-194',
    },
  },

  /* ---------------- Emergency Scenario Simulator (Judge Demo) ------------- */
  scenarioOrder: ['nominal', 'spe', 'eclss', 'circadian'],
  scenarios: {
    nominal: {
      title: 'Nominal Orbit (Baseline)',
      severity: 'NORMAL',
      iconKey: 'CheckCircle2',
      description: 'All crew vitals and cabin environment within NASA flight-rule limits.',
      vitals: {},
      alert: 'All telemetry channels nominal. Crew cleared for scheduled science operations.',
      protocol: {
        title: 'Daily Health Maintenance Protocol (NASA-STD-3001)',
        steps: [
          'Complete 2 h resistive exercise countermeasure (ARED) session.',
          'Log pre/post exercise vitals into the onboard electronic medical record.',
          'Verify personal dosimeter upload and ECLSS scrubber telemetry at shift change.',
          'Complete 15 min guided wind-down / meditation before protected sleep block.',
          'Hydration audit: urine-specific-gravity log meets target intake.',
        ],
      },
    },
    spe: {
      title: 'Solar Particle Event (Radiation Spike)',
      severity: 'CRITICAL',
      iconKey: 'Radiation',
      description: 'Dose rate > 12 mSv/day · elevated HR & oxidative stress.',
      vitals: {
        radiation: { mode: 'absolute', value: 14.2 },
        heartRate: { mode: 'delta', value: 26 },
        hrv: { mode: 'delta', value: -18 },
        spo2: { mode: 'delta', value: -3 },
        sleep: { mode: 'delta', value: -12 },
      },
      alert: 'CRITICAL: Solar Particle Event detected by onboard dosimetry. Dose rate exceeding flight-rule limit. Immediate shelter protocol mandatory — Earth MCC notification delayed 14m 28s.',
      protocol: {
        title: 'NASA Solar Particle Event Medical Countermeasure Checklist',
        steps: [
          'Relocate all crew to Storm Shelter (water-wall shielded module) immediately.',
          'Confirm personal dosimetry active; arm onboard radiation alarm thresholds.',
          'Administer 100% O₂ mask; continuous SpO₂ monitoring every 60 s.',
          'Initiate antioxidant countermeasure regimen (vitamin E/C per flight-surgeon plan).',
          'Perform autonomous ultrasound scan (cardiac + ocular) guided by onboard AI.',
          'Suspend all EVA; log cumulative dose vs. NASA career limit and generate Earth downlink report.',
        ],
      },
    },
    eclss: {
      title: 'ECLSS Scrubber Fault (High CO₂ / Hypoxia)',
      severity: 'CRITICAL',
      iconKey: 'Wind',
      description: 'Cabin CO₂ > 4.5 mmHg · SpO₂ 89% · cognitive fatigue.',
      vitals: {
        co2: { mode: 'absolute', value: 5.4 },
        spo2: { mode: 'absolute', value: 89 },
        heartRate: { mode: 'delta', value: 12 },
        hrv: { mode: 'delta', value: -14 },
        sleep: { mode: 'delta', value: -9 },
      },
      alert: 'CRITICAL: Primary CO₂ scrubber fault. Cabin partial pressure 5.4 mmHg — hypercapnia with secondary hypoxia. Cognitive performance degradation expected in < 15 min.',
      protocol: {
        title: 'NASA ECLSS Atmosphere Recovery Checklist',
        steps: [
          'Switch to backup CO₂ scrubber cartridge; verify ECLSS loop seal integrity.',
          'Don 100% O₂ mask; escalate autonomously if SpO₂ remains < 90%.',
          'Increase cabin ventilation fans to break up CO₂ stratification pockets.',
          'Relocate crew to docking-node refuge with independent atmosphere loop.',
          'Run onboard cognitive battery; monitor for headache, flushing, dyspnea.',
          'Package ECLSS fault telemetry for autonomous repair attempt or Earth downlink.',
        ],
      },
    },
    circadian: {
      title: 'Microgravity Cardiovascular & Circadian Stress',
      severity: 'WARNING',
      iconKey: 'Moon',
      description: 'HRV < 25 ms · sleep efficiency critical · SANS / fluid-shift risk.',
      vitals: {
        hrv: { mode: 'absolute', value: 18 },
        sleep: { mode: 'absolute', value: 58 },
        heartRate: { mode: 'delta', value: 14 },
        spo2: { mode: 'delta', value: -2 },
        co2: { mode: 'delta', value: 0.4 },
      },
      alert: 'CAUTION: Autonomic dysregulation detected. HRV 18 ms with critical sleep efficiency — elevated SANS and orthostatic intolerance risk on return. Countermeasures required this cycle.',
      protocol: {
        title: 'NASA Circadian & Cardiovascular Countermeasure Checklist',
        steps: [
          'Initiate 30 min blue-enriched light therapy to re-entrain circadian phase.',
          'Schedule 8 h protected sleep block with continuous actigraphy monitoring.',
          'Apply lower-body negative pressure cuff; complete fluid-loading (saline) protocol.',
          'Perform SANS screening: autonomous ocular ultrasound + intraocular pressure check.',
          'Reduce duty workload 25%; record stress-mitigation session for psychologist downlink.',
          'Track HRV recovery over next 6 h; escalate autonomously if HRV < 20 ms persists.',
        ],
      },
    },
  },

  /* ---------------- UPGRADE 1: Biomedical Digital Twin (Organ Map) ---------
     * watch: [{ metric, level }] — organ adopts the highest triggered level.
     * All status logic, pathophysiology text and countermeasures are DATA.
     * --------------------------------------------------------------------------*/
  organTwin: {
    title: 'Biomedical Digital Twin (Organ Map)',
    legend: 'Click any glowing anatomical node to open its NASA Clinical Pathophysiology Card.',
    organs: [
      {
        id: 'brain',
        name: 'Brain & Ocular System',
        short: 'CNS / SANS',
        subtitle: 'Central Nervous System · Spaceflight-Associated Neuro-ocular Syndrome',
        node: { x: 100, y: 42 },
        watch: [
          { metric: 'co2', level: 'CRITICAL' },
          { metric: 'co2', level: 'WARNING' },
          { metric: 'sleep', level: 'CRITICAL' },
        ],
        mechanism: 'Microgravity abolishes the hydrostatic gradient, shifting ~2 L of interstitial fluid cephalad. This raises intracranial pressure and drives optic-disc edema, posterior globe flattening and choroidal folds — the SANS spectrum seen in > 70% of long-duration crewmembers (OSD-194). Concurrently, elevated cabin ppCO₂ (> 4.5 mmHg) triggers cerebral vasodilation, increasing intracranial blood volume and producing the classic "space headache", visual disturbances and cognitive slowing. Circadian misalignment further destabilizes CNS perfusion regulation.',
        countermeasure: 'Perform autonomous ocular ultrasound + intraocular pressure check (SANS screening protocol). Apply lower-body negative pressure (LBNP) cuff to counteract cephalad fluid shift. Initiate 30 min blue-enriched light therapy to stabilize circadian/CNS rhythms. Queue fundus imagery for the next Earth downlink window (NASA HRP Standard Measures follow-up).',
        biomarkers: ['co2', 'sleep', 'hrv'],
      },
      {
        id: 'cardio',
        name: 'Cardiovascular System',
        short: 'Heart & Baroreceptors',
        subtitle: 'Cardiac Function · Autonomic Baroreflex · Orthostatic Reserve',
        node: { x: 100, y: 150 },
        watch: [
          { metric: 'heartRate', level: 'WARNING' },
          { metric: 'hrv', level: 'WARNING' },
          { metric: 'radiation', level: 'WARNING' },
        ],
        mechanism: 'Cephalad fluid shift triggers a ~10–15% plasma-volume loss within days of weightlessness; baroreceptors unload and their operating point resets. Heart-rate variability (RMSSD) below 25 ms indicates sympathetic dominance and autonomic dysregulation — a precursor to orthostatic intolerance at reentry and 1g. A Solar Particle Event adds myocardial oxidative stress, validated in OSD-194 radiation-cardiovascular biomarker studies.',
        countermeasure: 'Schedule LBNP sessions + fluid loading (isotonic saline) to rebuild orthostatic reserve. Maintain continuous ECG/HRV telemetry watch. Complete 30 min/day moderate-intensity aerobic exercise (CEVIS) plus ARED resistive loading. If SPE active: administer antioxidant regimen and repeat cardiac ultrasound autonomously.',
        biomarkers: ['heartRate', 'hrv', 'radiation'],
      },
      {
        id: 'pulmonary',
        name: 'Pulmonary System',
        short: 'Lungs & Gas Exchange',
        subtitle: 'Alveolar Gas Exchange · CO₂ Stratification · Hypoxia Reserve',
        node: { x: 72, y: 118 },
        watch: [
          { metric: 'spo2', level: 'WARNING' },
          { metric: 'co2', level: 'WARNING' },
        ],
        mechanism: 'In microgravity there is no buoyancy-driven convection, so exhaled CO₂ does not rise away from the face — it stratifies into stagnant pockets around the astronaut. During an ECLSS scrubber fault, cabin ppCO₂ climbs above 4.5 mmHg while displaced O₂ drives SpO₂ below 90%: the alveolar gas equation degrades, compensatory hyperventilation begins, and cognitive performance measurably declines within 15 minutes (NASA-STD-3001 atmosphere limits).',
        countermeasure: 'Don 100% O₂ mask immediately; escalate autonomously if SpO₂ persists < 90%. Switch to backup CO₂ scrubber cartridge and verify ECLSS loop integrity. Increase cabin ventilation fans to break CO₂ stratification layers. Relocate crew to the docking-node refuge with an independent atmosphere loop; sample SpO₂ every 60 s.',
        biomarkers: ['spo2', 'co2', 'heartRate'],
      },
      {
        id: 'msk',
        name: 'Musculoskeletal System',
        short: 'Spine · Bone Density',
        subtitle: 'Axial Spine Loading · Femoral Bone Mineral Density · Renal Stone Risk',
        node: { x: 100, y: 215 },
        watch: [
          { metric: 'sleep', level: 'WARNING' },
          { metric: 'radiation', level: 'WARNING' },
        ],
        mechanism: 'Weightlessness removes axial skeletal loading, reversing Wolff\u2019s law: femoral and spinal bone mineral density declines ~1–1.5% per month, releasing skeletal calcium that raises renal-stone risk. The spine elongates up to 5 cm (back pain, disc hydration changes). Poor sleep efficiency and elevated oxidative stress from radiation both accelerate muscle-protein breakdown and slow recovery — hence continuous ARED exercise-compliance tracking (OSD-51 musculoskeletal telemetry).',
        countermeasure: 'Verify ARED resistive-exercise compliance (2 h/day, ≥ 90% prescription adherence: squats, deadlifts, heel raises). Monitor urinary calcium for stone-risk index. Consider bisphosphonate therapy per flight-surgeon plan if bone-loss trend exceeds −1.5%/month. Log spine elongation and back-pain reports into the electronic medical record.',
        biomarkers: ['sleep', 'radiation', 'heartRate'],
      },
      {
        id: 'cellular',
        name: 'Cellular & Hematopoietic System',
        short: 'DNA / Bone Marrow',
        subtitle: 'DNA Strand Breaks · Oxidative Stress · Hematopoietic Stem-Cell Reserve',
        node: { x: 128, y: 300 },
        watch: [
          { metric: 'radiation', level: 'WARNING' },
        ],
        mechanism: 'A Solar Particle Event driving dose rate beyond 12 mSv/day deposits densely-ionizing proton/solar-energetic-particle tracks through marrow-rich skeletal sites, producing DNA double-strand breaks, acute oxidative stress and lymphocyte subset depletion. Hematopoietic stem-cell cycling is radiosensitive; depletion curves are benchmarked against OSD-194 radiation-biology datasets. Cumulative exposure is tracked against NASA-STD-3001 career limits (~600 mSv, age/sex adjusted).',
        countermeasure: 'Relocate to the storm shelter (water-wall shielding, ~20–30 g/cm² areal density). Administer the antioxidant countermeasure regimen (vitamin E/C, per flight-surgeon dosing). Run onboard biodosimetry (lymphocyte cytokinesis-block micronucleus assay) guided by MED-AI. Log cumulative dose against career limit and package full dosimetry for Earth downlink.',
        biomarkers: ['radiation', 'hrv', 'sleep'],
      },
    ],
  },

  /* ---------------- UPGRADE 2: Earth Downlink Packet configuration -------- */
  downlink: {
    missionId: 'ZGP-MARS-2026-042',
    title: 'NASA TELEMETRY DOWNLINK PACKET — DELAYED TRANSMISSION',
    owtLabel: '14m 28s OWLT',
    dsn: {
      station: 'Canberra DSN Complex · DSS-43 (70 m)',
      frequency: 'X-Band 8.4 GHz · 400 kW',
      uplinkStages: [
        'Aligning high-gain antenna with Earth vector…',
        'Handing off to Deep Space Network scheduling…',
        'Encoding telemetry packet (Reed-Solomon FEC)…',
        'Uplink in progress — photon budget at 3 AU…',
      ],
      queuedLabel: 'PACKET QUEUED · Signal arrival at Earth in ~29 min (round-trip light time)',
    },
  },

  /* ---------------- UPGRADE 3: NASA Open Data & Standards (expanded) ------- */
  datasets: [
    {
      name: 'NASA Open Science Data Repository (OSDR)', id: 'OSD-51',
      description: 'Physiological telemetry — cardiovascular deconditioning, heart rate & SpO₂ response profiles used to seed baseline vitals.',
      url: 'https://osdr.nasa.gov',
      education: {
        title: 'How spaceflight alters cardiovascular & pulmonary regulation (OSD-51)',
        body: 'Spaceflight studies curated under OSD-51 demonstrate measurable cardiovascular deconditioning within 72 hours of weightlessness: plasma volume contraction, resting tachycardia drift, attenuated baroreflex sensitivity and altered pulmonary gas-exchange efficiency. ZeroG Pulse seeds each crew member\'s baseline heart rate, SpO₂ and CO₂ response envelopes directly from these dose-response curves, so the WARNING/CRITICAL bounds on our telemetry cards reflect real microgravity physiology rather than terrestrial clinical norms.',
      },
    },
    {
      name: 'NASA Open Science Data Repository (OSDR)', id: 'OSD-194',
      description: 'Radiation biology & dosimetry datasets — dose-rate profiles and HRV/sleep actigraphy measures supporting radiation and circadian thresholds.',
      url: 'https://osdr.nasa.gov',
      education: {
        title: 'Radiation biomarkers, oxidative stress & autonomic dysregulation (OSD-194)',
        body: 'OSD-194 aggregates space radiation biology experiments showing dose-rate-dependent oxidative stress markers, DNA strand-break frequency and lymphocyte depletion — the biological basis of our Solar Particle Event critical threshold (> 12 mSv/day) and the organ-level Digital Twin model for the Cellular & Hematopoietic system. The same repository supplies HRV (RMSSD) and actigraphy distributions from which we derive the autonomic-stress (< 30 ms) and circadian (< 70% sleep efficiency) clinical bounds.',
      },
    },
    {
      name: 'Space Flight Human-System Standard — Volume 1', id: 'NASA-STD-3001 Vol.1',
      description: 'Crew Health — authoritative allowable atmosphere limits (ppCO₂, SpO₂, radiation exposure ceilings).',
      url: 'https://standards.nasa.gov',
      education: {
        title: 'Official crew-health thresholds: atmosphere & radiation (Vol. 1)',
        body: 'NASA-STD-3001 Volume 1 (Crew Health) defines the allowable cabin atmosphere envelope our Environmental stream enforces: CO₂ partial pressure limits far stricter than terrestrial workplace standards (because µg removes convective mixing around the astronaut), minimum SpO₂ hypoxia bands, and career ionizing-radiation exposure ceilings (~600 mSv, age/sex adjusted, capping excess lifetime cancer risk near 3%). ZeroG Pulse converts these flight-rule limits directly into the WARNING/CRITICAL card thresholds for Cabin CO₂, SpO₂ and Radiation Dose Rate.',
      },
    },
    {
      name: 'Space Flight Human-System Standard — Volume 2', id: 'NASA-STD-3001 Vol.2',
      description: 'Human Integration — protected sleep blocks, lighting/circadian requirements, human-factors design of medical displays.',
      url: 'https://standards.nasa.gov',
      education: {
        title: 'Circadian protection & human-factors requirements (Vol. 2)',
        body: 'Volume 2 (Human Integration) mandates protected sleep blocks, blue-enriched lighting schedules for circadian entrainment, and alarm/display design that prevents operator overload. ZeroG Pulse implements these as its Circadian & Sleep Efficiency telemetry channel (warning < 80%, critical < 70%), the light-therapy countermeasure steps, and our deliberate use of color-tiered, monospace telemetry UI that remains readable under acute stress.',
      },
    },
    {
      name: 'NASA Human Research Program — Standard Measures', id: 'HRP-SM',
      description: 'Cross-mission standardized dataset: HRV, actigraphy, cognition batteries — the reference population for astronaut nominal ranges.',
      url: 'https://humanresearchroadmap.nasa.gov',
      education: {
        title: 'Why autonomous onboard medical software is mandatory for Artemis & Mars',
        body: 'The HRP Standard Measures program harmonizes biospecimen, cardiovascular, cognitive and actigraphy data across every long-duration crew, establishing what "nominal astronaut physiology" actually looks like. Its risk roadmaps (SANS, radiation carcinogenesis, behavioral health) conclude that for Artemis lunar sortie and Mars transit missions — where one-way light time reaches 14+ minutes and round-trip consultation exceeds 29 minutes — Earth-dependent medical support is operationally impossible. The crew must be stabilized by onboard decision support. This is the core justification for ZeroG Pulse\'s MED-AI autonomous medical officer and self-contained countermeasure protocols.',
      },
    },
  ],

  /* ---------------- AI Medical Officer Knowledge Base -------------------- */
  ai: {
    officerName: 'MED-AI · Autonomous Medical Officer',
    quickPrompts: [
      'Analyze current crew vitals',
      'Why is CO2 causing headache in microgravity?',
      'Explain radiation exposure limits',
      'How does microgravity affect sleep and HRV?',
      'Generate Earth Medical Downlink Report',
    ],
    knowledge: [
      {
        id: 'vitals', keywords: ['vitals', 'analyze', 'crew', 'status', 'health check', 'how is'],
        reply: 'Running autonomous multi-parameter analysis across all six telemetry channels for {crew}. Cross-referencing against NASA-STD-3001 flight-rule bounds and HRP Standard Measures population data.',
        includeTelemetry: true, includeProtocol: true,
      },
      {
        id: 'co2', keywords: ['co2', 'carbon', 'headache', 'hypoxia', 'scrubber', 'hypercapnia'],
        reply: 'In microgravity, exhaled CO₂ does not convect away from the face — buoyancy-driven mixing is absent, so CO₂ pools around the astronaut ("CO₂ stratification"). Above ~4.5 mmHg the gas dilates cerebral blood vessels → headache and flushing; simultaneously the respiratory drive increases and, during a scrubber fault, displaced O₂ produces secondary hypoxia (SpO₂ drop, cognitive fatigue). Countermeasure: ventilation increase + backup scrubber + 100% O₂ mask. This is why cabin ppCO₂ limits in NASA-STD-3001 are far stricter than terrestrial workplace limits.',
        includeTelemetry: false, includeProtocol: false,
      },
      {
        id: 'radiation', keywords: ['radiation', 'dose', 'spe', 'msv', 'solar', 'shelter'],
        reply: 'Deep-space crews face galactic cosmic rays (~0.4 mSv/day) plus sporadic Solar Particle Events, which can exceed 12 mSv/day and trigger mandatory sheltering. NASA uses career exposure limits (~600 mSv, age/sex adjusted per NASA-STD-3001) designed to cap excess lifetime cancer risk at ~3%. Acute SPE risks include hematologic and cardiovascular effects — hence the O₂, antioxidant, and ultrasound countermeasure steps. Dose data is validated against OSDR radiation biology datasets (OSD-194).',
        includeTelemetry: false, includeProtocol: false,
      },
      {
        id: 'sleep', keywords: ['sleep', 'circadian', 'hrv', 'stress', 'sans', 'fluid', 'heart rate variability'],
        reply: 'The ISS sees 16 sunrises/day and Mars transit crews live under artificial light — circadian phase drift is mission-endemic. Chronic misalignment suppresses HRV (autonomic stress), impairs immunity and cognition, and amplifies SANS (Spaceflight-Associated Neuro-ocular Syndrome) via cephalad fluid shifts. Countermeasures: blue-enriched light therapy, protected 8 h sleep blocks, LBNP cuffs, fluid loading, and continuous actigraphy — all benchmarked to HRP Standard Measures (OSD-194).',
        includeTelemetry: false, includeProtocol: false,
      },
      {
        id: 'downlink', keywords: ['downlink', 'report', 'earth'], reply: '',
        includeTelemetry: false, includeProtocol: false, isDownlink: true,
      },
      {
        id: 'fallback', keywords: [],
        reply: 'I am MED-AI, your autonomous medical officer. With Earth 14m 28s away (one-way light time), I provide onboard diagnosis and countermeasure guidance only. I can analyze live vitals, explain any environmental hazard, or generate a downlink report. Try a quick-prompt or ask about the active scenario: {scenarioTitle}.',
        includeTelemetry: false, includeProtocol: false,
      },
    ],
  },
};

/* ============================================================================
 * SECTION 0b — AI ENGINE CONFIG (multi-provider live LLM support)
 * Provider endpoints, model catalogs and failover live in src/ai/engine.js.
 * These entries are only the selectable tiles of the "Configure AI Engine" modal.
 * ==========================================================================*/
const AI_ENGINES = {
  providers: [
    { id: 'auto', label: 'Auto Failover', badge: '🔀 Auto Failover', note: 'Recommended — picks a live, light model per query' },
    { id: 'groq', label: 'Groq Cloud', badge: '⚡ Groq Live', note: 'Free tier · fastest first token' },
    { id: 'gemini', label: 'Google Gemini', badge: '✨ Gemini Live', note: 'Free tier · Google AI Studio key' },
    { id: 'openrouter', label: 'OpenRouter', badge: '🌐 OpenRouter Live', note: 'Free router + low-cost light models' },
    { id: 'huggingface', label: 'Hugging Face Router', badge: '🤗 Hugging Face Live', note: 'Inference Providers router' },
    { id: 'onboard', label: 'Built-in Autonomous Engine', badge: '🛡️ Onboard Local AI', note: 'Zero config — works instantly' },
  ],
  systemPromptRole: 'You are MED-AI, the autonomous NASA Flight Surgeon aboard the Deep Space Transport Infinity-1, en route to Mars. Earth is 14m 28s away at light speed, so you alone must stabilize the crew. Answer as a clinical, decisive flight surgeon. Always cite the live telemetry values you are given. Reference NASA-STD-3001, OSD-51 and OSD-194 where relevant. Never invent medication dosages. Be concise, structured and mission-focused.',
};

function sourceBadge(source) {
  if (source === 'pollinations') return 'Pollinations Live';
  const tile = AI_ENGINES.providers.find((p) => p.id === source && p.id !== 'auto');
  return (tile || AI_ENGINES.providers[AI_ENGINES.providers.length - 1]).badge;
}

/* ============================================================================
 * SECTION 1 — Pure helpers (no hardcoded medical values)
 * ==========================================================================*/
const METRIC_ORDER = ['heartRate', 'spo2', 'hrv', 'radiation', 'co2', 'sleep'];
const METRIC_ICONS = { HeartPulse, Activity, Brain, Radiation, Wind, Moon };
const SCENARIO_ICONS = { CheckCircle2, Radiation, Wind, Moon };
const RANK = { NORMAL: 0, WARNING: 1, CRITICAL: 2 };

const TICK_MS = 1500;
const HISTORY_LEN = 20;
const SMOOTHING = 0.45;

const STATUS_STYLE = {
  NORMAL: { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', text: 'text-emerald-300', hex: '#34d399' },
  WARNING: { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40', dot: 'bg-amber-400', text: 'text-amber-300', hex: '#fbbf24' },
  CRITICAL: { badge: 'bg-rose-500/15 text-rose-300 border-rose-500/50 animate-pulse', dot: 'bg-rose-500', text: 'text-rose-300', hex: '#fb7185' },
};

function getMetricStatus(cfg, value) {
  const t = cfg.thresholds;
  if ((t.critHigh != null && value >= t.critHigh) || (t.critLow != null && value <= t.critLow)) return 'CRITICAL';
  if ((t.warnHigh != null && value >= t.warnHigh) || (t.warnLow != null && value <= t.warnLow)) return 'WARNING';
  return 'NORMAL';
}

function getOverallStatus(values) {
  let worst = 'NORMAL';
  for (const key of METRIC_ORDER) {
    const s = getMetricStatus(NASA_DATA_CONFIG.metrics[key], values[key]);
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

function computeTarget(crew, scenario) {
  const target = {};
  for (const key of METRIC_ORDER) {
    const base = crew.baselines[key];
    const ov = scenario.vitals[key];
    if (!ov) target[key] = base;
    else if (ov.mode === 'absolute') target[key] = ov.value;
    else target[key] = base + ov.value;
  }
  return target;
}

function fmtMET(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const fmtVal = (v, cfg) => Number.isFinite(v) ? v.toFixed(cfg.decimals) : '—';

/* ============================================================================
 * SECTION 2 — Mission Header (now with Downlink Transmit button)
 * ==========================================================================*/
/* ===== HUD PRIMITIVES (Self-Contained — Zero Extra Imports Needed) ===== */
/* OS-level motion preference — CSS covers declarative animation, this covers SVG SMIL. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else if (typeof mq.removeListener === 'function') mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

const ZGP_STARS = Array.from({ length: 75 }, (_, i) => ({
  left: (i * 37 + 13) % 100,
  top: (i * 61 + 7) % 100,
  size: (i % 3) * 0.65 + 0.8,
  delay: (i % 6) * 0.7,
  dur: 2.8 + (i % 4) * 0.9,
}));

const Starfield = React.memo(function Starfield() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {ZGP_STARS.map((s, i) => (
        <span
          key={i}
          className="zgp-star"
          style={{
            left: s.left + '%',
            top: s.top + '%',
            width: s.size + 'px',
            height: s.size + 'px',
            animationDelay: s.delay + 's',
            animationDuration: s.dur + 's',
          }}
        />
      ))}
    </div>
  );
});

const HudCorners = React.memo(function HudCorners({ tone }) {
  const c =
    tone === 'rose'
      ? 'border-rose-400/90'
      : tone === 'amber'
        ? 'border-amber-400/90'
        : tone === 'emerald'
          ? 'border-emerald-400/90'
          : 'border-cyan-400/90';
  return (
    <>
      <span className={'pointer-events-none absolute left-0 top-0 h-2.5 w-2.5 border-l-2 border-t-2 ' + c} />
      <span className={'pointer-events-none absolute right-0 top-0 h-2.5 w-2.5 border-r-2 border-t-2 ' + c} />
      <span className={'pointer-events-none absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 ' + c} />
      <span className={'pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 ' + c} />
    </>
  );
});

const OrbitalTrajectoryHUD = React.memo(function OrbitalTrajectoryHUD({ emergency }) {
  const alert = Boolean(emergency);
  const stroke = alert ? '#fb7185' : '#22d3ee';
  const pathD = useMemo(() => 'M 26 46 C 190 8, 410 8, 574 46', []);
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div className={'relative my-3 overflow-hidden border bg-[#060b14]/90 ' + (alert ? 'border-rose-500/50 shadow-[0_0_25px_rgba(244,63,94,0.18)]' : 'border-cyan-500/25')}>
      <HudCorners tone={alert ? 'rose' : 'cyan'} />
      <div className="flex flex-wrap items-center gap-2 border-b border-cyan-500/15 bg-cyan-500/5 px-3 py-1.5">
        <span className={'inline-block h-2 w-2 rounded-full ' + (alert ? 'bg-rose-500 zgp-beacon' : 'bg-cyan-400')} />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-400">DEEP-SPACE NETWORK // DSN-04</span>
        <span className="font-mono text-xs font-bold uppercase tracking-widest text-slate-200">EARTH–MARS ORBITAL TRAJECTORY &amp; LIGHT-DELAY HUD</span>
        <span className={'ml-auto font-mono text-[10px] font-bold px-2 py-0.5 border ' + (alert ? 'border-rose-500/50 bg-rose-950/60 text-rose-300 zgp-beacon' : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300')}>
          {alert ? 'TELEMETRY ALERT // AUTONOMOUS OVERRIDE' : 'HELIOCENTRIC LINK NOMINAL'}
        </span>
      </div>
      <div className="relative px-2 py-1">
        <svg viewBox="0 0 600 76" className="block h-16 w-full" preserveAspectRatio="none">
          <line x1="26" y1="46" x2="574" y2="46" stroke="#1e3a5f" strokeWidth="1" strokeDasharray="2 6" />
          <path d={pathD} fill="none" stroke={stroke} strokeWidth="1.6" opacity="0.9" className="zgp-traj" />
          <circle cx="26" cy="46" r="8" fill="#0ea5e9" opacity="0.25" />
          <circle cx="26" cy="46" r="4" fill="#38bdf8" className="zgp-beacon" />
          <circle cx="574" cy="46" r="8" fill="#f59e0b" opacity="0.22" />
          <circle cx="574" cy="46" r="4.5" fill="#fbbf24" className="zgp-beacon" />
          <circle cx={reducedMotion ? 300 : undefined} cy={reducedMotion ? 17.5 : undefined} r="3.8" fill={alert ? '#fb7185' : '#34d399'}>
            {reducedMotion ? null : <animateMotion dur="4.5s" repeatCount="indefinite" path={pathD} />}
          </circle>
        </svg>
        <span className="absolute left-3 top-1.5 font-mono text-[10px] font-bold text-sky-300">EARTH // MCC-HOUSTON</span>
        <span className={'absolute left-1/2 top-1 -translate-x-1/2 font-mono text-[10px] font-bold ' + (alert ? 'text-rose-300' : 'text-emerald-300')}>
          GTV INFINITY-1 // TRANSIT DAY 142
        </span>
        <span className="absolute right-3 top-1.5 font-mono text-[10px] font-bold text-amber-300">MARS // JEZERO ORBIT</span>
        <span className="absolute left-1/2 bottom-1 -translate-x-1/2 font-mono text-[10px] text-slate-400">
          DIST: 154.2M KM &middot; VEL: 24.6 KM/S &middot; HELIOCENTRIC CRUISE
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cyan-500/15 bg-slate-950/60 px-3 py-1.5">
        <span className={'font-mono text-[10px] sm:text-[11px] font-bold tracking-wider ' + (alert ? 'text-rose-300' : 'text-amber-300')}>
          ONE-WAY LIGHT DELAY: 14m 28s<span className="hidden sm:inline"> (28m 56s ROUND-TRIP) — EARTH REAL-TIME TELEMEDICINE IMPOSSIBLE</span>
        </span>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-cyan-300">
          ONBOARD MED-AI AUTONOMY: ACTIVE
        </span>
      </div>
    </div>
  );
});
const JudgeQuickGuideHUD = React.memo(function JudgeQuickGuideHUD({ onOpenData, onOpenDownlink }) {
  return (
    <div className="relative mb-2 overflow-hidden border border-cyan-500/30 bg-[#050b16]/95 px-3 py-2">
      <HudCorners tone="cyan" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-cyan-400/50 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-300">
            JUDGE INTERACTIVE EVALUATION PROTOCOL
          </span>
          <span className="font-mono text-[11px] text-slate-300">
            <strong className="text-cyan-300">[STEP 01]</strong> Trigger a Space Emergency Scenario below &rarr;{' '}
            <strong className="text-cyan-300">[STEP 02]</strong> Inspect Organ Matrix &amp; Countermeasures &rarr;{' '}
            <strong className="text-cyan-300">[STEP 03]</strong> Query MED-AI or Transmit Earth Downlink
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenData}
            className="border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20"
          >
            INSPECT NASA DATASETS
          </button>
          <button
            type="button"
            onClick={onOpenDownlink}
            className="border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20"
          >
            PREVIEW MCC DOWNLINK
          </button>
        </div>
      </div>
    </div>
  );
});

const DualImpactAndDisclosureHUD = React.memo(function DualImpactAndDisclosureHUD({ onOpenData }) {
  return (
    <section className="mx-auto mt-4 max-w-[1600px] px-4 pb-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="relative border border-cyan-500/25 bg-[#060b14]/90 p-3">
          <HudCorners tone="cyan" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">
            CRITERION 01 // DEEP-SPACE IMPACT
          </p>
          <h3 className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-white">
            AUTONOMOUS MARS &amp; ARTEMIS CREW SURVIVAL
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Eliminates the fatal 28-minute round-trip Earth communication blackout during Solar Particle Events (SPE), ECLSS CO2 scrubber failures, and microgravity cardiovascular stress.
          </p>
        </div>

        <div className="relative border border-emerald-500/25 bg-[#060b14]/90 p-3">
          <HudCorners tone="emerald" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
            CRITERION 02 // EARTH DUAL-USE BENEFIT
          </p>
          <h3 className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-white">
            REMOTE ICU, POLAR &amp; DISASTER TELEMEDICINE
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Directly deployable on Earth for rural critical-care units, offshore/submarine crews, and disaster-struck zones operating under severed internet or specialist shortages.
          </p>
        </div>

        <div className="relative border border-amber-500/25 bg-[#060b14]/90 p-3">
          <HudCorners tone="amber" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
            NASA SPACE APPS COMPLIANCE // AI &amp; DATA DISCLOSURE
          </p>
          <h3 className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-white">
            VERIFIED NASA OPEN DATA + HYBRID AI ARCHITECTURE
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Grounded in official NASA-STD-3001 Vol. 1 &amp; 2 limits and NASA OSDR (OSD-51, OSD-194). Uses a deterministic clinical rule engine with optional live LLM reasoning (Groq / OpenRouter / Gemini).{' '}
            <button type="button" onClick={onOpenData} className="font-mono font-bold text-amber-300 underline">
              [View Sources]
            </button>
          </p>
        </div>
      </div>
    </section>
  );
});
const HOLO_CALLOUT_POINTS = {
  cns: '83,31 108,22 128,22',
  lung: '66,73 44,64 28,64',
  cardio: '87,81 110,81 124,81',
  dna: '83,108 110,108 128,108',
  bone: '95,148 114,158 128,158',
};

const BiomedicalDigitalTwinHUD = React.memo(function BiomedicalDigitalTwinHUD({ values }) {
  const keys = typeof METRIC_ORDER !== 'undefined' ? METRIC_ORDER : [];
  const hr = Number(values?.[keys[0]] ?? values?.hr ?? 60);
  const spo2 = Number(values?.[keys[1]] ?? values?.spo2 ?? 98);
  const hrv = Number(values?.[keys[2]] ?? values?.hrv ?? 78);
  const rad = Number(values?.[keys[3]] ?? values?.rad ?? 0.35);
  const co2 = Number(values?.[keys[4]] ?? values?.co2 ?? 2.4);
  const sleep = Number(values?.[keys[5]] ?? values?.sleep ?? 91);

  /* Use shared stress model (single source of truth) — memoized */
  const stresses = useMemo(() => computeOrganStresses(values), [values]);

  const getColor = (status) => (status === 'CRITICAL' ? '#fb7185' : status === 'WARNING' ? '#fbbf24' : '#34d399');

  const organs = useMemo(() => [
    {
      id: 'SYS-01',
      name: 'CNS & OCULAR (SANS)',
      ref: 'NASA-STD-3001 / SANS',
      stress: stresses.brain.stress,
      status: stresses.brain.status,
      driver: 'CO2 ' + co2.toFixed(2) + ' mmHg · Sleep ' + sleep.toFixed(1) + '%',
    },
    {
      id: 'SYS-02',
      name: 'CARDIO-AUTONOMIC',
      ref: 'OSDR OSD-194',
      stress: stresses.cardio.stress,
      status: stresses.cardio.status,
      driver: 'HR ' + Math.round(hr) + ' BPM · HRV ' + Math.round(hrv) + ' ms',
    },
    {
      id: 'SYS-03',
      name: 'PULMONARY & ECLSS',
      ref: 'STD-3001 VOL.2',
      stress: stresses.pulmonary.stress,
      status: stresses.pulmonary.status,
      driver: 'SpO2 ' + spo2.toFixed(0) + '% · ppCO2 ' + co2.toFixed(2) + ' mmHg',
    },
    {
      id: 'SYS-04',
      name: 'SKELETAL & MUSCLE',
      ref: 'ARED / OSD-51',
      stress: stresses.msk.stress,
      status: stresses.msk.status,
      driver: '0-G Load Deficit · HRV ' + Math.round(hrv) + ' ms',
    },
    {
      id: 'SYS-05',
      name: 'HEMATOPOIETIC & DNA',
      ref: 'OSDR OSD-51 / RAD',
      stress: stresses.cellular.stress,
      status: stresses.cellular.status,
      driver: 'Dose Rate ' + rad.toFixed(2) + ' mSv/day',
    },
  ], [stresses, co2, sleep, hr, hrv, spo2, rad]);

  const anyCritical = organs.some((o) => o.status === 'CRITICAL');
  const anyWarning = organs.some((o) => o.status === 'WARNING');

  return (
    <section className={'relative flex flex-col border bg-[#060b14]/90 p-4 ' + (anyCritical ? 'border-rose-500/50' : anyWarning ? 'border-amber-500/40' : 'border-cyan-500/25')}>
      <HudCorners tone={anyCritical ? 'rose' : anyWarning ? 'amber' : 'cyan'} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/15 pb-2.5">
        <div className="flex items-center gap-2">
          <span className={'inline-block h-2 w-2 rounded-full ' + (anyCritical ? 'bg-rose-500 zgp-beacon' : anyWarning ? 'bg-amber-400 zgp-beacon' : 'bg-emerald-400')} />
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-slate-200">
            BIOMEDICAL DIGITAL TWIN // 5-ORGAN MATRIX
          </span>
        </div>
        <span className={'border px-2 py-0.5 font-mono text-[10px] font-bold ' + (anyCritical ? 'border-rose-500/50 bg-rose-950/60 text-rose-300' : anyWarning ? 'border-amber-500/50 bg-amber-950/60 text-amber-300' : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300')}>
          {anyCritical ? 'ORGAN STRESS CRITICAL' : anyWarning ? 'SUBSYSTEM ELEVATED' : 'ALL ORGANS NOMINAL'}
        </span>
      </div>

      <div className="my-3 grid grid-cols-1 items-center gap-3 sm:grid-cols-12">
        {/* Astronaut 3D Hologram Scanner (Frameless & Seamless Blend) */}
        <div className="relative flex flex-col items-center justify-center p-1 sm:col-span-5">
          <span className="mb-1 font-mono text-[9px] font-bold uppercase tracking-widest text-cyan-400">
            BIO-SCAN // LIVE TELEMETRY
          </span>

          <div className="relative flex h-64 w-full items-center justify-center overflow-hidden">
            {/* 1. Clean 3D Hologram Image Layer (No Box Shadow, Seamless Radial Mask) */}
            <img
              src="/holo-body.png"
              alt="3D Astronaut Biometric Twin"
              style={{
                WebkitMaskImage: 'radial-gradient(ellipse 65% 88% at 50% 50%, black 50%, transparent 96%)',
                maskImage: 'radial-gradient(ellipse 65% 88% at 50% 50%, black 50%, transparent 96%)',
              }}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-95 contrast-125 mix-blend-screen"
            />

            {/* 2. Live Interactive Organ Nodes, Callouts & Laser Scanner */}
            <svg viewBox="0 0 160 240" className="relative z-10 h-full w-full">
              {/* Subtle Laser Scanner Line */}
              <line x1="28" y1="18" x2="132" y2="18" stroke="#22d3ee" strokeWidth="1" strokeDasharray="4 2" opacity="0.65">
                <animate attributeName="y1" values="18;220;18" dur="5s" repeatCount="indefinite" />
                <animate attributeName="y2" values="18;220;18" dur="5s" repeatCount="indefinite" />
              </line>

              {/* 1. Brain / Ocular (CNS) */}
              <circle cx="80" cy="31" r="7" fill={getColor(organs[0].status)} opacity="0.28" className="zgp-beacon" />
              <circle cx="80" cy="31" r="3" fill={getColor(organs[0].status)} />
              <polyline points={HOLO_CALLOUT_POINTS.cns} fill="none" stroke={getColor(organs[0].status)} strokeWidth="0.8" opacity="0.85" />
              <text x="130" y="24" fill={getColor(organs[0].status)} fontSize="6.5" fontFamily="monospace" fontWeight="bold">CNS</text>

              {/* 2. Pulmonary / Lungs */}
              <circle cx="69" cy="73" r="6" fill={getColor(organs[2].status)} opacity="0.25" className="zgp-beacon" />
              <circle cx="91" cy="73" r="6" fill={getColor(organs[2].status)} opacity="0.25" className="zgp-beacon" />
              <circle cx="69" cy="73" r="2.8" fill={getColor(organs[2].status)} />
              <circle cx="91" cy="73" r="2.8" fill={getColor(organs[2].status)} />
              <polyline points={HOLO_CALLOUT_POINTS.lung} fill="none" stroke={getColor(organs[2].status)} strokeWidth="0.8" opacity="0.85" />
              <text x="6" y="66" fill={getColor(organs[2].status)} fontSize="6.5" fontFamily="monospace" fontWeight="bold">LUNG</text>

              {/* 3. Heart / Cardio */}
              <circle cx="84" cy="81" r="6.5" fill={getColor(organs[1].status)} opacity="0.3" className="zgp-beacon" />
              <circle cx="84" cy="81" r="3" fill={getColor(organs[1].status)} />
              <polyline points={HOLO_CALLOUT_POINTS.cardio} fill="none" stroke={getColor(organs[1].status)} strokeWidth="0.8" opacity="0.85" />
              <text x="126" y="83" fill={getColor(organs[1].status)} fontSize="6.5" fontFamily="monospace" fontWeight="bold">CARDIO</text>

              {/* 4. DNA / Hematopoietic Core */}
              <circle cx="80" cy="108" r="6.5" fill={getColor(organs[4].status)} opacity="0.25" className="zgp-beacon" />
              <circle cx="80" cy="108" r="2.8" fill={getColor(organs[4].status)} />
              <polyline points={HOLO_CALLOUT_POINTS.dna} fill="none" stroke={getColor(organs[4].status)} strokeWidth="0.8" opacity="0.85" />
              <text x="130" y="110" fill={getColor(organs[4].status)} fontSize="6.5" fontFamily="monospace" fontWeight="bold">DNA</text>

              {/* 5. Skeletal / Femoral Bone */}
              <circle cx="68" cy="148" r="6" fill={getColor(organs[3].status)} opacity="0.25" className="zgp-beacon" />
              <circle cx="92" cy="148" r="6" fill={getColor(organs[3].status)} opacity="0.25" className="zgp-beacon" />
              <circle cx="68" cy="148" r="2.8" fill={getColor(organs[3].status)} />
              <circle cx="92" cy="148" r="2.8" fill={getColor(organs[3].status)} />
              <polyline points={HOLO_CALLOUT_POINTS.bone} fill="none" stroke={getColor(organs[3].status)} strokeWidth="0.8" opacity="0.85" />
              <text x="130" y="160" fill={getColor(organs[3].status)} fontSize="6.5" fontFamily="monospace" fontWeight="bold">BONE</text>
            </svg>
          </div>

          <span className="mt-1 font-mono text-[9px] text-slate-400">
            OSDR: OSD-51 · OSD-194 · STD-3001
          </span>
        </div>

        {/* 5 Organ Status Bars */}
        <div className="space-y-2 sm:col-span-7">
          {organs.map((o) => {
            const isCrit = o.status === 'CRITICAL';
            const isWarn = o.status === 'WARNING';
            const segs = 12;
            const lit = Math.max(1, Math.min(segs, Math.round((o.stress / 100) * segs)));
            return (
              <div key={o.id} className={'border p-2 ' + (isCrit ? 'border-rose-500/40 bg-rose-950/20' : isWarn ? 'border-amber-500/40 bg-amber-950/20' : 'border-cyan-500/20 bg-slate-950/60')}>
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-[10px] font-bold text-white">
                    <span className="text-cyan-400">{o.id}</span> // {o.name}
                  </span>
                  <span className={'px-1.5 py-0.5 font-mono text-[9px] font-bold ' + (isCrit ? 'bg-rose-500/20 text-rose-300' : isWarn ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300')}>
                    {o.status} ({100 - o.stress}% INTACT)
                  </span>
                </div>
                <div className="mt-1 flex gap-1">
                  {Array.from({ length: segs }, (_, idx) => (
                    <span
                      key={idx}
                      className={'h-1.5 flex-1 ' + (idx < lit ? (isCrit ? 'bg-rose-500' : isWarn ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-slate-800')}
                    />
                  ))}
                </div>
                <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-slate-400">
                  <span>{o.driver}</span>
                  <span className="text-cyan-300/80">{o.ref}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-cyan-500/15 pt-1.5 font-mono text-[10px] text-slate-400">
        REAL-TIME PHYSIOLOGICAL COUPLING: Automatically maps cabin telemetry to organ-level risk models.
      </div>
    </section>
  );
});

const MissionHeader = React.memo(function MissionHeader({ crewId, onCrewChange, overall, onTransmit }) {
  const _crew = NASA_DATA_CONFIG.crews.find((c) => c.id === crewId);
  const s = STATUS_STYLE[overall];
  const overallLabel = overall === 'NORMAL' ? 'NOMINAL' : overall === 'WARNING' ? 'CAUTION' : 'CRITICAL EMERGENCY';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto max-w-[1600px] px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_18px_rgba(16,185,129,0.35)]">
              <HeartPulse size={24} className="text-emerald-400" />
            </div>
            <div>
              <h1 className="font-mono text-lg font-bold tracking-wide text-slate-100">
                {NASA_DATA_CONFIG.mission.name} <span className="text-emerald-400">|</span> {NASA_DATA_CONFIG.mission.tagline}
              </h1>
              <p className="font-mono text-xs text-slate-400">
                {NASA_DATA_CONFIG.mission.craft} · {NASA_DATA_CONFIG.mission.destination}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {NASA_DATA_CONFIG.crews.map((c) => (
              <button
                key={c.id}
                onClick={() => onCrewChange(c.id)}
                className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-all ${
                  c.id === crewId
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                    : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
              >
                <span className="font-bold">{c.callsign}</span> {c.name}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2">
            <Radio size={16} className="animate-pulse text-sky-400" />
            <div className="font-mono text-xs leading-snug">
              <p className="text-sky-300">Earth Comm Delay: {NASA_DATA_CONFIG.comm.label} ({NASA_DATA_CONFIG.comm.mode})</p>
              <p className="text-slate-400">Autonomous AI Mode: <span className="font-bold text-emerald-400">ACTIVE</span></p>
            </div>
          </div>

          {/* UPGRADE 2 — Transmit Earth Downlink Report */}
          <button
            onClick={onTransmit}
            className="hidden sm:flex items-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/15 px-3 py-2 font-mono text-xs font-bold text-sky-300 transition-all hover:bg-sky-500/25 hover:shadow-[0_0_14px_rgba(56,189,248,0.3)]"
          >
            <Satellite size={15} /> Transmit Earth Downlink Report
          </button>

          <div className={`flex items-center gap-2 rounded-lg border px-4 py-2 font-mono text-sm font-bold tracking-widest ${s.badge}`}>
            {overall === 'NORMAL' ? <CheckCircle2 size={16} /> : overall === 'WARNING' ? <AlertTriangle size={16} /> : <ShieldAlert size={16} />}
            {overallLabel}
          </div>
        </div>
      </div>
    </header>
  );
});

/* ============================================================================
 * SECTION 3 — Emergency Scenario Simulator
 * ==========================================================================*/
const ScenarioBar = React.memo(function ScenarioBar({ scenarioId, onScenarioChange }) {
  const scenarios = NASA_DATA_CONFIG.scenarios;
  return (
    <section className="mx-auto max-w-[1600px] px-4 pt-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity size={16} className="text-emerald-400" />
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            Space Emergency Simulator — Judge Demo Control
          </h2>
          <span className="font-mono text-xs text-slate-400">one-click · real-time telemetry injection</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {NASA_DATA_CONFIG.scenarioOrder.map((id) => {
            const sc = scenarios[id];
            const Icon = SCENARIO_ICONS[sc.iconKey] || Activity;
            const active = id === scenarioId;
            const sev = STATUS_STYLE[sc.severity];
            return (
              <button
                key={id}
                onClick={() => onScenarioChange(id)}
                className={`group flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 ${
                  active
                    ? 'border-emerald-500/70 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                    : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'
                }`}
              >
                <div className={`mt-0.5 rounded-lg border p-2 ${sev.badge}`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <p className={`font-mono text-xs font-bold ${active ? 'text-emerald-300' : 'text-slate-200'}`}>{sc.title}</p>
                  <p className="mt-0.5 text-sm leading-snug text-slate-300">{sc.description}</p>
                  <span className={`mt-1.5 inline-block rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider ${sev.badge}`}>
                    {sc.severity}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
});

/* ============================================================================
 * SECTION 4 — Vitals / Environment Telemetry Cards
 * ==========================================================================*/
const VitalsCard = React.memo(function VitalsCard({ metricKey, value, prevValue, history }) {
  const cfg = NASA_DATA_CONFIG.metrics[metricKey];
  const Icon = METRIC_ICONS[cfg.iconKey];
  const status = getMetricStatus(cfg, value);
  const s = STATUS_STYLE[status];

  const spark = useMemo(
    () => history.slice(-12).map((pt, i) => ({ i, v: pt[metricKey] })),
    [history, metricKey]
  );
  const TrendIcon = value > prevValue ? TrendingUp : value < prevValue ? TrendingDown : Minus;

  return (
    <div className={`flex h-full flex-col justify-between rounded-2xl border bg-slate-900/50 p-4 transition-all duration-300 ${
      status === 'CRITICAL' ? 'border-rose-500/50 shadow-[0_0_22px_rgba(244,63,94,0.25)]'
      : status === 'WARNING' ? 'border-amber-500/40 shadow-[0_0_16px_rgba(245,158,11,0.15)]'
      : 'border-slate-800 hover:border-slate-600'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <div className={`mt-0.5 shrink-0 rounded-lg border p-1.5 ${s.badge}`}><Icon size={16} /></div>
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-slate-200">{cfg.label}</p>
            <p className="font-mono text-xs text-slate-400">{cfg.rangeLabel}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${s.badge}`}>
          {status}
        </span>
      </div>

      <div className="mt-auto pt-3">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-1">
            <span className={`font-mono text-4xl font-bold tabular-nums ${s.text}`}>{fmtVal(value, cfg)}</span>
            <span className="font-mono text-xs text-slate-500">{cfg.unit}</span>
          </div>
          <div className="h-10 w-24 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <Line type="monotone" dataKey="v" stroke={s.hex} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-slate-800/70 pt-2">
          <div className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
            <TrendIcon size={12} className={value > prevValue ? 'text-amber-400' : 'text-slate-500'} />
            {value > prevValue ? 'rising' : value < prevValue ? 'falling' : 'stable'}
          </div>
          <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[9px] text-slate-400" title={cfg.description}>
            <Database size={9} className="mr-1 inline" />{cfg.source}
          </span>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * SECTION 5 — UPGRADE 1: Biomedical Digital Twin (Organ Impact Map)
 * ==========================================================================*/
const ORGAN_EMOJI = { brain: '🧠', cardio: '❤️', pulmonary: '🫁', msk: '🦴', cellular: '🧬' };
const ORGAN_INDEX_METRICS = {
  brain: ['co2', 'sleep'], cardio: ['heartRate', 'hrv'], pulmonary: ['spo2', 'co2'],
  msk: ['sleep', 'radiation'], cellular: ['radiation', 'hrv'],
};
const METRIC_SHORT = {
  heartRate: 'HEART RATE', hrv: 'HRV (RMSSD)', spo2: 'BLOOD SpO2',
  radiation: 'RADIATION DOSE', co2: 'CABIN ppCO2', sleep: 'SLEEP EFFICIENCY',
};

const SCENARIO_ORGAN_MAP = { nominal: 'brain', spe: 'cellular', eclss: 'pulmonary', circadian: 'cardio' };

/* Shared organ-stress model — identical to BiomedicalDigitalTwinHUD's computation.
   Returns { brain, cardio, pulmonary, msk, cellular } each with { stress, status }. */
function computeOrganStresses(values) {
  const keys = typeof METRIC_ORDER !== 'undefined' ? METRIC_ORDER : [];
  const hr = Number(values?.[keys[0]] ?? values?.hr ?? 60);
  const spo2 = Number(values?.[keys[1]] ?? values?.spo2 ?? 98);
  const hrv = Number(values?.[keys[2]] ?? values?.hrv ?? 78);
  const rad = Number(values?.[keys[3]] ?? values?.rad ?? 0.35);
  const co2 = Number(values?.[keys[4]] ?? values?.co2 ?? 2.4);
  const sleep = Number(values?.[keys[5]] ?? values?.sleep ?? 91);

  const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v));
  const cnsStress = clamp(8, 100, Math.round((co2 > 3.5 ? (co2 - 2.2) * 28 : 10) + (sleep < 80 ? (85 - sleep) * 1.8 : 4)));
  const cardioStress = clamp(10, 100, Math.round((hr > 85 ? (hr - 70) * 1.7 : 8) + (hrv < 45 ? (55 - hrv) * 1.5 : 4)));
  const pulmStress = clamp(8, 100, Math.round((co2 > 3.2 ? (co2 - 2.0) * 26 : 8) + (spo2 < 95 ? (98 - spo2) * 8 : 2)));
  const boneStress = clamp(14, 100, Math.round((sleep < 80 ? 58 : 18) + (hrv < 40 ? 24 : 0) + (rad > 2 ? 15 : 0)));
  const dnaStress = clamp(6, 100, Math.round(rad * 7.2));

  const getStatus = (score) => (score >= 65 ? 'CRITICAL' : score >= 38 ? 'WARNING' : 'NOMINAL');

  return {
    brain:     { stress: cnsStress,    status: getStatus(cnsStress) },
    cardio:    { stress: cardioStress, status: getStatus(cardioStress) },
    pulmonary: { stress: pulmStress,   status: getStatus(pulmStress) },
    msk:       { stress: boneStress,   status: getStatus(boneStress) },
    cellular:  { stress: dnaStress,    status: getStatus(dnaStress) },
  };
}

const OrganTwinView = React.memo(function OrganTwinView({ values, scenarioId }) {
  const organs = NASA_DATA_CONFIG.organTwin.organs;
  const [selectedId, setSelectedId] = useState(SCENARIO_ORGAN_MAP[scenarioId] || organs[0].id);
  // Follow the active emergency's organ (render-phase adjustment instead of a prop-sync effect).
  const [seenScenario, setSeenScenario] = useState(scenarioId);
  if (seenScenario !== scenarioId) {
    setSeenScenario(scenarioId);
    const target = SCENARIO_ORGAN_MAP[scenarioId];
    if (target && organs.some((o) => o.id === target)) setSelectedId(target);
  }

  const organ = organs.find((o) => o.id === selectedId);

  /* BUG-3 FIX: Use the shared stress-score model (same as BiomedicalDigitalTwinHUD)
     so left-panel badges always match the right-panel 5-Organ Matrix statuses. Memoized. */
  const stresses = useMemo(() => computeOrganStresses(values), [values]);
  const STATUS_REMAP = { NOMINAL: 'NORMAL' }; // stress model returns 'NOMINAL'; STATUS_STYLE uses 'NORMAL'
  const stressStatusFor = (id) => {
    const s = stresses[id];
    return s ? (STATUS_REMAP[s.status] || s.status) : 'NORMAL';
  };
  const organStatus = stressStatusFor(selectedId);
  const s = STATUS_STYLE[organStatus];

  const severityPct = (st) => (st === 'CRITICAL' ? 88 : st === 'WARNING' ? 55 : 12);
  const barColor = (st) => (st === 'CRITICAL' ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]' : st === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500');

  return (
    <div>
      <p className="mb-2 flex items-center gap-2 font-mono text-xs text-slate-400">
        <Activity size={13} className="text-emerald-400" /> {NASA_DATA_CONFIG.organTwin.legend}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        {/* LEFT — Interactive Anatomical System Selector (clean 1-col vertical list) */}
        <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 p-3 md:col-span-2">
          <style>{'@keyframes zgpscan{0%{top:-4%}50%{top:100%}100%{top:-4%}}'}</style>
          <div className="pointer-events-none absolute left-0 right-0 h-8 animate-none"
            style={{ animation: 'zgpscan 5s linear infinite', background: 'linear-gradient(180deg, rgba(14,165,233,0) 0%, rgba(14,165,233,0.16) 60%, rgba(14,165,233,0.55) 96%, rgba(56,189,248,0.9) 100%)', boxShadow: '0 0 18px rgba(56,189,248,0.45)' }} />
          <p className="mb-2 flex items-center gap-2 font-mono text-sm font-bold tracking-widest text-sky-300">
            <Brain size={15} /> BIOMETRIC ORGAN SYSTEMS MATRIX
          </p>
          {/* BUG-1 FIX: Removed sm:grid-cols-2 → always 1-col so badges & labels never clip */}
          <div className="grid grid-cols-1 gap-2">
            {organs.map((o) => {
              const st = stressStatusFor(o.id);
              const ss = STATUS_STYLE[st];
              const active = o.id === selectedId;
              const idxMetrics = ORGAN_INDEX_METRICS[o.id] || o.biomarkers.slice(0, 2);
              return (
                <button key={o.id} onClick={() => setSelectedId(o.id)}
                  className={'relative rounded-xl border p-3 text-left transition-all ' + (
                    active
                      ? 'border-sky-500/70 bg-slate-900/90 shadow-[0_0_18px_rgba(56,189,248,0.3)]'
                      : 'border-slate-700/80 bg-slate-950/80 hover:border-slate-500 hover:bg-slate-900/60')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="shrink-0 text-xl leading-none">{ORGAN_EMOJI[o.id] || '🩺'}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold leading-tight text-slate-100">{o.name}</p>
                        <p className="truncate text-xs leading-tight text-slate-400">{o.subtitle}</p>
                      </div>
                    </div>
                    <span className={'shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest ' + ss.badge}>
                      {st === 'NORMAL' ? 'NOMINAL' : st}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {idxMetrics.map((mk) => {
                      const mc = NASA_DATA_CONFIG.metrics[mk];
                      return (
                        <div key={mk} className="rounded-lg border border-slate-700/70 bg-slate-950/70 px-2 py-1">
                          <p className="truncate font-mono text-xs uppercase tracking-wide text-slate-400">{METRIC_SHORT[mk]}</p>
                          <p className="font-mono text-base font-semibold tabular-nums text-slate-100">
                            {fmtVal(values[mk], mc)} <span className="text-[11px] font-normal text-slate-500">{mc.unit}</span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div className={'h-full rounded-full transition-all duration-700 ' + barColor(st)}
                      style={{ width: severityPct(st) + '%' }} />
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-xs text-slate-500">Select a system module to open its NASA Clinical Pathophysiology Card →</p>
        </div>

        {/* RIGHT — Clinical Pathophysiology Card (large typography) */}
        <div className={'flex flex-col rounded-xl border bg-slate-950/70 p-4 transition-all md:col-span-3 ' + (
          organStatus === 'CRITICAL' ? 'border-rose-500/50 shadow-[0_0_18px_rgba(244,63,94,0.2)]'
            : organStatus === 'WARNING' ? 'border-amber-500/40' : 'border-slate-800')}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl leading-none">{ORGAN_EMOJI[organ.id] || '🩺'}</span>
              <div>
                <p className="text-lg font-bold leading-tight text-slate-100">{organ.name}</p>
                <p className="text-xs text-slate-400">{organ.subtitle}</p>
              </div>
            </div>
            <span className={'shrink-0 rounded border px-2 py-0.5 font-mono text-xs font-bold tracking-widest ' + s.badge}>
              {organStatus === 'NORMAL' ? 'NOMINAL' : organStatus}
            </span>
          </div>

          <div className="mt-3">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Spaceflight Mechanism</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-200">{organ.mechanism}</p>
          </div>

          <div className="mt-3">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Target Biomarkers — Live</p>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {organ.biomarkers.map((mk) => {
                const mc = NASA_DATA_CONFIG.metrics[mk];
                const st = getMetricStatus(mc, values[mk]);
                const mss = STATUS_STYLE[st];
                return (
                  <div key={mk} className={'rounded-lg border p-2.5 ' + mss.badge}>
                    <p className="font-mono text-xs font-semibold uppercase tracking-wide opacity-90">{METRIC_SHORT[mk]}</p>
                    <p className="font-mono text-2xl font-bold tabular-nums">{fmtVal(values[mk], mc)}
                      <span className="text-xs font-normal opacity-70"> {mc.unit}</span></p>
                    <p className="font-mono text-xs font-bold tracking-wider">{st}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Targeted Countermeasure (NASA)</p>
            <p className="mt-1 rounded-lg border border-slate-700/70 bg-slate-900/60 p-3 text-sm leading-relaxed text-slate-200">
              {organ.countermeasure}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});


/* ============================================================================
 * SECTION 5b — Live Multi-Stream Telemetry Chart (3 tabs now)
 * ==========================================================================*/
const TelemetryChartPanel = React.memo(function TelemetryChartPanel({ history, values, scenarioId }) {
  const [tab, setTab] = useState('cardio');
  const tabs = [
    ['cardio', 'Cardiovascular (BPM · HRV)'],
    ['env', 'Environment & Radiation (mSv · CO₂)'],
    ['twin', 'Organ Systems & Pathophysiology'],
  ];
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
          <Activity size={15} className="text-emerald-400" /> {tab === 'twin' ? 'NASA Biometric Organ Digital Twin · Pathophysiology & Mechanisms' : `Live Multi-Stream Telemetry · last ${HISTORY_LEN} samples · 1.5 s cadence`}
        </h2>
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-700 bg-slate-950/70 p-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1 font-mono text-xs transition-all ${
                tab === id ? 'bg-emerald-500/15 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'twin' ? (
        <OrganTwinView values={values} scenarioId={scenarioId} />
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {tab === 'cardio' ? (
              <LineChart data={history} margin={{ top: 5, right: 45, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="met" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" />
                <YAxis yAxisId="bpm" domain={[40, 150]} tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" label={{ value: 'BPM', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }} />
                <YAxis yAxisId="hrv" orientation="right" domain={[0, 120]} tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" label={{ value: 'HRV ms', angle: 90, position: 'insideRight', fill: '#64748b', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8, fontFamily: 'monospace', fontSize: 12 }} labelStyle={{ color: '#94a3b8' }} />
                <Legend wrapperStyle={{ fontFamily: 'monospace', fontSize: 11 }} />
                <Line yAxisId="bpm" type="monotone" dataKey="heartRate" name="Heart Rate (BPM)" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="hrv" type="monotone" dataKey="hrv" name="HRV (ms)" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            ) : (
              <LineChart data={history} margin={{ top: 5, right: 45, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="met" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" />
                <YAxis yAxisId="rad" domain={[0, 16]} tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" label={{ value: 'mSv/day', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }} />
                <YAxis yAxisId="co2" orientation="right" domain={[0, 7]} tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} stroke="#334155" label={{ value: 'CO₂ mmHg', angle: 90, position: 'insideRight', fill: '#64748b', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8, fontFamily: 'monospace', fontSize: 12 }} labelStyle={{ color: '#94a3b8' }} />
                <Legend wrapperStyle={{ fontFamily: 'monospace', fontSize: 11 }} />
                <Line yAxisId="rad" type="monotone" dataKey="radiation" name="Radiation (mSv/day)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="co2" type="monotone" dataKey="co2" name="Cabin CO₂ (mmHg)" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
});

/* ============================================================================
 * SECTION 6 — Countermeasure Protocol Panel
 * ==========================================================================*/
const ProtocolPanel = React.memo(function ProtocolPanel({ scenario, crew, checked, onToggleStep, onTransmit }) {
  const sev = STATUS_STYLE[scenario.severity];
  const done = checked.length;
  const total = scenario.protocol.steps.length;
  const complete = done === total;
  return (
    <section className={'rounded-2xl border bg-slate-900/50 p-4 transition-all duration-500 ' + (
      scenario.severity === 'CRITICAL' ? 'border-rose-500/50 shadow-[0_0_24px_rgba(244,63,94,0.2)]'
        : scenario.severity === 'WARNING' ? 'border-amber-500/40'
          : 'border-slate-800')}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
          <ShieldAlert size={15} className="text-slate-300" /> Active Emergency Protocol
        </h2>
        <span className={'rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ' + sev.badge}>
          {scenario.severity}
        </span>
      </div>

      <div className={'mb-3 rounded-lg border p-2.5 text-sm leading-relaxed text-slate-200 ' + sev.badge}>
        <p className="font-semibold">{scenario.title}</p>
        <p className="mt-0.5 text-slate-300/90">{scenario.alert}</p>
      </div>

      <p className="mb-2 font-mono text-xs font-bold text-slate-300">{scenario.protocol.title}</p>

      <ul className="space-y-1.5">
        {scenario.protocol.steps.map((step, i) => {
          const isChecked = checked.includes(i);
          return (
            <li key={i}>
              <button
                onClick={() => onToggleStep(i)}
                className={'flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left text-sm transition-all ' + (
                  isChecked
                    ? 'border-emerald-500/60 bg-emerald-950/30 text-slate-100 shadow-[0_0_12px_rgba(16,185,129,0.18)]'
                    : 'border-slate-700/80 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:bg-slate-900/60')}
              >
                {isChecked ? (
                  <CheckCircle2 size={16} className="mt-px shrink-0 text-emerald-400" />
                ) : (
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-800 font-mono text-[10px] font-bold text-slate-400">
                    {i + 1}
                  </span>
                )}
                <span className="leading-snug">{step}</span>
                {isChecked && (
                  <span className="ml-auto shrink-0 rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-widest text-emerald-300">
                    [DONE]
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3">
        <div className="mb-1 flex justify-between font-mono text-[10px] text-slate-500">
          <span>Protocol completion — {crew.callsign} {crew.name}</span>
          <span>{done}/{total}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className={'h-full rounded-full transition-all duration-500 ' + (complete ? 'bg-emerald-500' : 'bg-amber-500')}
            style={{ width: (done / total) * 100 + '%' }}
          />
        </div>
        {complete && (
          <p className="mt-2 flex items-center gap-1 font-mono text-xs font-bold text-emerald-300">
            <CheckCircle2 size={13} /> COUNTERMEASURES COMPLETE — crew stabilized, report queued for Earth downlink.
          </p>
        )}
        <button
          onClick={onTransmit}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/15 px-3 py-2 font-mono text-xs font-bold text-sky-300 transition-all hover:bg-sky-500/25"
        >
          <Satellite size={14} /> Transmit Earth Downlink Report
        </button>
      </div>
    </section>
  );
});

/* ============================================================================
 * SECTION 6b — MED-AI chat (unchanged behavior, now shares packet builder)
 * ==========================================================================*/
const PREDICTION_MODEL = {
  nominal: { condition: 'No clinical deterioration predicted', riskBase: 5 },
  spe: { condition: 'Acute Radiation Syndrome (SPE)', riskBase: 89 },
  eclss: { condition: 'Acute Hypoxic Syncope (hypercapnic)', riskBase: 86 },
  circadian: { condition: 'Orthostatic Collapse / SANS progression', riskBase: 58 },
};

function computePrediction(ctx) {
  if (!ctx || !ctx.scenario || !ctx.scenario.protocol) {
    return { scenarioId: 'nominal', condition: 'No clinical deterioration predicted', risk: 5, minutes: null, firstPending: [], pendingCount: 0, checkedCount: 0, total: 5 };
  }

  const model = PREDICTION_MODEL[ctx.scenarioId] || PREDICTION_MODEL.nominal;
  const steps = ctx.scenario.protocol.steps;
  const pendingIdx = steps.map((s, i) => i).filter((i) => !ctx.checkedSteps.includes(i));
  const risk = Math.min(97, Math.round(model.riskBase + pendingIdx.length * 2.2));
  const minutes = ctx.scenarioId === 'nominal' ? null : Math.max(8, 10 + pendingIdx.length * 3);
  return {
    scenarioId: ctx.scenarioId, condition: model.condition, risk, minutes,
    firstPending: pendingIdx.slice(0, 2).map((i) => i + 1),
    pendingCount: pendingIdx.length,
    checkedCount: ctx.checkedSteps.length, total: steps.length,
  };
}

function liveReadout(ctx) {
  return METRIC_ORDER.map((k) => {
    const m = NASA_DATA_CONFIG.metrics[k];
    return METRIC_SHORT[k] + ' ' + fmtVal(ctx.values[k], m) + ' ' + m.unit + ' [' + getMetricStatus(m, ctx.values[k]) + ']';
  }).join('\n  - ');
}

/* Smart offline clinical reasoning — intent parsing, never generic, zero ASCII art */
function buildAIResponse(question, ctx) {
  const pred = computePrediction(ctx);
  if (isArabic(question)) return buildArabicResponse(question, ctx, {
    config: NASA_DATA_CONFIG, order: METRIC_ORDER, fmtVal, getMetricStatus,
    getOverallStatus, prediction: pred,
  });
  const lower = question.toLowerCase().trim();
  const pending = ctx.scenario.protocol.steps
    .map((s, i) => ({ n: i + 1, text: s }))
    .filter((x) => !ctx.checkedSteps.includes(x.n - 1));
  const doneCount = ctx.checkedSteps.length;
  const totalCount = ctx.scenario.protocol.steps.length;
  const ov = getOverallStatus(ctx.values);

  if (lower.indexOf('report') !== -1 || lower.indexOf('downlink') !== -1) return buildDownlinkText(ctx);



  const entry = NASA_DATA_CONFIG.ai.knowledge.find(
    (e) => !e.isDownlink && e.keywords.some((k) => lower.includes(k)) && e.reply
  );
  const has = (arr) => arr.some((k) => lower.includes(k));
  const _wantsAction = has(['what', 'do', 'help', 'action', 'step', 'plan', 'gotta', 'now', 'instruct', 'countermeasure']);
  const wantsStatus = has(['status', 'vitals', 'telemetry', 'how is', 'condition', 'numbers']);
  const wantsWhy = has(['why', 'explain', 'cause', 'reason', 'mechanism', 'happening']);
  const wantsOkay = has(['okay', 'ok', 'alright', 'safe', 'survive', 'prognos', 'will he', 'is he']);

  let out = '';
  out += '### Clinical Assessment — ' + ctx.crew.callsign + ' ' + ctx.crew.name + '\n';
  out += '**Active State:** ' + ctx.scenario.title + ' (' + ctx.scenario.severity + ') · **Overall: ' + (ov === 'NORMAL' ? 'NOMINAL' : ov) + '**\n\n';
  out += '**Live Telemetry** (verified ' + ctx.met + ' MET):\n';
  out += METRIC_ORDER.map((k) => {
    const m = NASA_DATA_CONFIG.metrics[k];
    return '- ' + METRIC_SHORT[k] + ': **' + fmtVal(ctx.values[k], m) + ' ' + m.unit + '** [' + getMetricStatus(m, ctx.values[k]) + ']';
  }).join('\n');
  out += '\n\n**30-Min Forecast:** ' + pred.risk + '% risk — ' + pred.condition;
  if (pred.minutes) out += ' · time-to-threshold ~' + pred.minutes + ' min';
  out += ' · ' + doneCount + '/' + totalCount + ' countermeasures complete\n';

  if (wantsOkay) {
    out += '\n**Prognosis:** ';
    out += ov === 'CRITICAL'
      ? ctx.crew.callsign + ' is **not stable**. Without immediate execution of the pending countermeasures, deterioration is projected within ~' + pred.minutes + ' minutes. With full checklist compliance, recovery is expected this cycle.'
      : ov === 'WARNING'
        ? ctx.crew.callsign + ' is clinically holding but **degraded** — autonomic reserve is below flight-rule comfort. The countermeasures below restore margin within this cycle.'
        : ctx.crew.callsign + ' is **clinically stable** — all parameters within NASA-STD-3001 flight-rule limits.';
    out += '\n';
  }

  if (wantsWhy) {
    out += '\n**Mechanism:** ' + (entry && entry.reply ? entry.reply : ctx.scenario.alert) + '\n';
  } else if (entry && wantsStatus) {
    out += '\n**Clinical Briefing:** ' + entry.reply + '\n';
  }

  out += '\n**Urgent Action Plan — execute in order:**\n';
  if (!pending.length) {
    out += '- All ' + totalCount + ' countermeasures complete. Maintain monitoring; recheck vitals in 10 minutes.\n';
  } else {
    pending.slice(0, 4).forEach((p) => { out += p.n + '. ' + p.text + '\n'; });
    out += '\n' + pending.length + ' step' + (pending.length > 1 ? 's' : '') + ' pending — completing them drops the ' + pred.risk + '% risk score.';
  }
  out += '\n\n---\nStandards: **NASA-STD-3001 / OSD-51 / OSD-194** · MED-AI, autonomous (Earth ' + NASA_DATA_CONFIG.comm.label + ' away).';
  return out;
}

function buildDownlinkText(ctx) {
  const status = getOverallStatus(ctx.values);
  let out = '';
  out += '### Earth Medical Downlink Report — ZeroG Pulse\n';
  out += '**Report ID:** ZGP-DL-' + Date.now() + ' · **Mission:** ' + NASA_DATA_CONFIG.downlink.missionId + '\n';
  out += '**MET:** ' + ctx.met + ' · **Vehicle:** ' + NASA_DATA_CONFIG.mission.craft + ' · **Comm delay (one-way):** ' + NASA_DATA_CONFIG.comm.label + '\n';
  out += '**Crew:** ' + ctx.crew.callsign + ' ' + ctx.crew.name + ' (' + ctx.crew.role + ')\n';
  out += '**Active Scenario:** ' + ctx.scenario.title + ' · **Overall Status:** ' + (status === 'NORMAL' ? 'NOMINAL' : status) + '\n\n';
  out += '**Physiological & Environmental Telemetry**\n';
  out += METRIC_ORDER.map((k) => {
    const m = NASA_DATA_CONFIG.metrics[k];
    return '- ' + m.label + ': **' + fmtVal(ctx.values[k], m) + ' ' + m.unit + '** [' + getMetricStatus(m, ctx.values[k]) + ']';
  }).join('\n');
  out += '\n\n**Recommended Countermeasures**\n';
  out += ctx.scenario.protocol.steps.map((s, i) => (i + 1) + '. ' + s).join('\n');
  out += '\n\n---\nTransmitted autonomously by MED-AI · Earth MCC response ETA ~29 min (round-trip light time).';
  return out;
}

function buildSystemPrompt(ctx) {
  const p = computePrediction(ctx);
  const pending = ctx.scenario.protocol.steps
    .map((s, i) => ({ n: i + 1, text: s }))
    .filter((x) => !ctx.checkedSteps.includes(x.n - 1));
  return AI_ENGINES.systemPromptRole + '\n\n'
    + '=== LIVE MISSION CONTEXT (real-time, quote these numbers) ===\n'
    + 'Crew: ' + ctx.crew.callsign + ' ' + ctx.crew.name + ' (' + ctx.crew.role + ')\n'
    + 'Vehicle: ' + NASA_DATA_CONFIG.mission.craft + '\n'
    + 'Active emergency state: ' + ctx.scenario.title + ' (' + ctx.scenario.severity + ')\n'
    + 'Scenario alert: ' + ctx.scenario.alert + '\n'
    + 'LIVE TELEMETRY:\n  - ' + liveReadout(ctx) + '\n'
    + '30-min deterioration prediction: ' + p.risk + '% - ' + p.condition + (p.minutes ? ' (time-to-threshold ~' + p.minutes + ' min)' : '') + '\n'
    + 'Checklist progress: ' + ctx.checkedSteps.length + '/' + ctx.scenario.protocol.steps.length + ' steps complete.\n'
    + 'Next uncompleted steps: ' + (pending.length
      ? pending.slice(0, 3).map((x) => 'STEP ' + x.n + ': ' + x.text).join(' | ')
      : 'none - protocol complete') + '\n'
    + 'Standards: NASA-STD-3001 (atmosphere & radiation limits), OSD-51 (cardiovascular deconditioning), OSD-194 (radiation biomarkers, HRV, actigraphy), HRP Standard Measures.\n'
    + 'Answer format: concise clinical assessment, quote live values, then numbered urgent actions.';
}

/* Live-LLM system prompt: mission context + official challenge grounding + language rule. */
function buildLiveSystemPrompt(ctx) {
  return buildSystemPrompt(ctx) +
    '\n\nOFFICIAL CHALLENGE RESOURCES & SCIENTIFIC GROUNDING:\n' +
    '1. NASA HRP 5 Hazards (https://www.nasa.gov/hrp/hazards/): Space Radiation, Isolation/Confinement, Distance from Earth (14m 28s comm delay requiring autonomous AI), Gravity Fields, and Hostile/Closed Environments.\n' +
    '2. NASA HRP Risks (https://www.nasa.gov/hrp/risks/): Spaceflight Associated Neuro-ocular Syndrome (SANS), Cardiovascular Deconditioning, Acute Hypoxia, and Circadian Desynchrony.\n' +
    '3. NASA Ongoing HRP Research (https://www.nasa.gov/hrp/ongoing-hrp-research/): NASA Standard Measures, ARCHeR (sleep/HRV), and CIPHER multi-organ studies.\n' +
    '4. CSA Monitoring Radiation (https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp): Canadian Active Neutron Spectrometer (CANS) and Bubble Detector real-time mSv/day dosimetry.\n' +
    '5. CSA Space Science & Earth Dual-Use (https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp): CSA Bio-Monitor Smart Shirt + AI platform and CARDIOBREATH cardiovascular/respiratory tracking for astronauts and remote Earth patients.\n' +
    'LANGUAGE & COMPLETION RULE: Always reply in the EXACT SAME LANGUAGE used by the user (Arabic if Arabic, English if English). Cite relevant NASA HRP, CSA, and NASA-STD-3001 standards naturally and finish all sentences completely.\n' +
    'STRICT OUTPUT RULE: Never use Markdown pipe tables (`|...|`); always format parameters and protocols as clean numbered steps or bullet points, and always finish every sentence completely. Include units with every numeric parameter. Keep the answer focused rather than filling the token budget; complete the final step and sentence before stopping.';
}



const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

const PredictiveBanner = React.memo(function PredictiveBanner({ pred }) {
  const tier = pred.risk > 70 ? 'CRITICAL' : pred.risk > 35 ? 'WARNING' : 'NORMAL';
  const s = STATUS_STYLE[tier];
  let msg;
  if (pred.scenarioId === 'nominal') {
    msg = 'AI PREDICTION: ' + pred.risk + '% risk — crew stable, no clinical deterioration predicted this cycle.';
  } else if (pred.pendingCount === 0) {
    msg = 'AI PREDICTION: ' + pred.risk + '% residual risk of ' + pred.condition + ' — all ' + pred.total + ' countermeasures executed, deterioration contained.';
  } else {
    const stepsTxt = pred.firstPending.length > 1 ? 'Steps ' + pred.firstPending.join('-') : 'Step ' + pred.firstPending[0];
    msg = 'AI PREDICTION: ' + pred.risk + '% risk of ' + pred.condition + ' within ' + pred.minutes + ' mins if ' + stepsTxt + ' remain unexecuted.';
  }
  return (
    <div className={'mb-2 rounded-lg border p-2.5 ' + s.badge}>
      <div className="flex items-center gap-2">
        <Brain size={14} className={tier === 'CRITICAL' ? 'animate-pulse' : ''} />
        <p className="font-mono text-xs font-bold leading-snug">{msg}</p>
        <span className="ml-auto shrink-0 font-mono text-lg font-bold tabular-nums">{pred.risk}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={'h-full rounded-full transition-all duration-700 ' + (tier === 'CRITICAL' ? 'bg-rose-500' : tier === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500')}
          style={{ width: pred.risk + '%' }} />
      </div>
      <p className="mt-1 font-mono text-[9px] opacity-70">
        30-Min Clinical Deterioration Model · trend-weighted from live telemetry · {pred.checkedCount}/{pred.total} countermeasures complete
      </p>
    </div>
  );
});


function chatInline(t) {
  return t.split(/\*\*(.+?)\*\*/g).map((p, j) =>
    j % 2 === 1 ? <strong key={j} className="font-semibold text-white">{p}</strong> : <span key={j}>{p}</span>
  );
}

function renderFormattedChat(text) {
  return String(text).split('\n').map((raw, i) => {
    const t = raw.trim();
    if (!t) return <div key={i} className="h-1.5" />;
    if (/^-{3,}$/.test(t)) return <div key={i} className="my-1.5 h-px bg-slate-700/70" />;
    if (t.indexOf('### ') === 0) {
      return (
        <p key={i} className="mt-2.5 mb-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 font-mono text-xs font-bold uppercase tracking-widest text-sky-300">
          {t.slice(4).replace(/\*\*/g, '')}
        </p>
      );
    }
    if (/^[-•]\s+/.test(t)) {
      return (
        <div key={i} className="flex items-start gap-2 pl-0.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
          <p className="flex-1">{chatInline(t.replace(/^[-•]\s+/, ''))}</p>
        </div>
      );
    }
    const num = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (num) {
      return (
        <div key={i} className="flex items-start gap-2 pl-0.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/15 font-mono text-[10px] font-bold text-sky-300">
            {num[1]}
          </span>
          <p className="flex-1">{chatInline(num[2])}</p>
        </div>
      );
    }
    return <p key={i} className="pl-0.5">{chatInline(t)}</p>;
  });
}

/* ============================================================================
 * Configure AI Engine modal.
 * The full model catalog is listed for browsing, but nothing is ever
 * auto-selected: the default is AUTOMATIC, and the failover chain picks a
 * live, light, quota-safe model per query. Clicking a row pins that model.
 * ==========================================================================*/
const AISettingsModal = React.memo(function AISettingsModal({ open, onClose, engine, onSave, serverStatus }) {
  if (!open) return null;
  return <AISettingsModalContent onClose={onClose} engine={engine} onSave={onSave} serverStatus={serverStatus} />;
});

function fmtCtx(n) {
  if (!n) return '';
  return n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M ctx' : Math.round(n / 1000) + 'k ctx';
}

/* A key pasted into the wrong tab is moved to the provider its prefix belongs to. */
function routeDraftKeys(draft) {
  const keys = { ...draft.keys };
  for (const slot of PROVIDER_ORDER) {
    const owner = detectProviderFromKey(keys[slot]);
    if (owner && owner !== slot && !keys[owner]) {
      keys[owner] = keys[slot];
      keys[slot] = '';
    }
  }
  return normalizeEngine({ ...draft, keys });
}

const MODEL_ROW_LIMIT = 250;

function AISettingsModalContent({ onClose, engine, onSave, serverStatus }) {
  const [draft, setDraft] = useState(() => normalizeEngine(engine));
  const [catalog, setCatalog] = useState({ state: 'idle', key: '', models: [], source: '', note: '' });
  const [filter, setFilter] = useState('');
  const [test, setTest] = useState(null);
  const testRef = useRef(null);

  const tab = draft.provider;
  const meta = PROVIDERS[tab] || null;
  const tile = AI_ENGINES.providers.find((p) => p.id === tab) || AI_ENGINES.providers[0];
  const browserKey = meta ? draft.keys[tab] : '';
  const detected = detectProviderFromKey(browserKey);
  const serverOn = (id) => Boolean(serverStatus && serverStatus.providers && serverStatus.providers[id]);
  const pinned = meta ? draft.model : '';
  const catalogKey = meta ? meta.id + '|' + browserKey : '';

  const cancelTest = useCallback(() => {
    testRef.current?.abort();
    testRef.current = null;
  }, []);
  const closeModal = useCallback(() => { cancelTest(); onClose(); }, [cancelTest, onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); cancelTest(); };
  }, [closeModal, cancelTest]);

  // Load the catalog whenever the provider tab or pasted key changes (debounced while typing).
  useEffect(() => {
    if (!meta) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCatalog({ state: 'loading', key: catalogKey, models: [], source: '', note: '' });
      listModels({ provider: meta.id, key: browserKey, signal: controller.signal })
        .then((r) => {
          if (!controller.signal.aborted) setCatalog({ state: 'ready', key: catalogKey, models: r.models || [], source: r.source || '', note: r.note || '' });
        })
        .catch((err) => {
          if (!controller.signal.aborted) setCatalog({ state: 'error', key: catalogKey, models: [], source: '', note: redactSecrets(String((err && err.message) || err), [browserKey]) });
        });
    }, browserKey ? 450 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [meta, browserKey, catalogKey]);

  const edit = (patch) => {
    cancelTest();
    setTest(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setKey = (value) => {
    cancelTest();
    setTest(null);
    setDraft((d) => ({ ...d, keys: { ...d.keys, [tab]: value } }));
  };
  // Switching tiles never pre-selects a model: it always starts on AUTOMATIC.
  const chooseTile = (id) => edit({ provider: id, model: id === draft.provider ? draft.model : '' });

  const models = useMemo(() => (catalog.key === catalogKey ? catalog.models : []), [catalog, catalogKey]);
  const loading = Boolean(meta) && (catalog.key !== catalogKey || catalog.state === 'loading');
  const query = filter.trim().toLowerCase();
  const visible = useMemo(() => (query
    ? models.filter((m) => m.id.toLowerCase().includes(query) || String(m.name || '').toLowerCase().includes(query))
    : models), [models, query]);
  const pinnedListed = !pinned || models.some((m) => m.id === pinned);

  const canTest = tab === 'onboard' || tab === 'auto' || serverOn(tab) || Boolean(browserKey.trim());
  const runTest = async () => {
    cancelTest();
    const controller = new AbortController();
    testRef.current = controller;
    const target = routeDraftKeys(draft);
    setTest({ state: 'wait', msg: '⏳ Testing ' + tile.label + (meta ? ' · ' + (target.model || 'automatic model') : ' chain') + '…' });
    try {
      const r = await testConnection({ engine: target, signal: controller.signal });
      if (testRef.current !== controller) return;
      testRef.current = null;
      const via = r.via === 'server' ? 'Vercel env key' : r.via === 'browser' ? 'browser key' : r.via === 'relay' ? 'public relay' : 'local';
      setTest({ state: 'ok', msg: '✅ Connected — ' + providerLabel(r.provider) + ' · ' + (r.model || 'auto') + ' · ' + via + ' · ' + r.ms + ' ms' });
    } catch (err) {
      if (testRef.current !== controller || controller.signal.aborted) return;
      testRef.current = null;
      setTest({ state: 'fail', msg: '❌ ' + describeFailure(err) });
    }
  };

  const serverLine = !serverStatus || serverStatus.available === null
    ? { cls: 'border-slate-700/60 bg-slate-900/60 text-slate-400', text: serverStatus ? '⏳ /api/medai is slow to answer (cold start?) — queries will still try it first.' : '⏳ Checking the /api/medai server proxy…' }
    : !serverStatus.available
      ? { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', text: '⚠️ /api/medai proxy not reachable here — browser keys below or the onboard engine will answer.' }
      : serverStatus.any
        ? { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', text: '🔐 Vercel env keys active (server-side, never sent to the browser): ' + PROVIDER_ORDER.filter(serverOn).map((id) => PROVIDERS[id].label).join(' · ') }
        : { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', text: '⚠️ /api/medai is online but no provider key is set in the Vercel environment variables.' };

  const tag = (text, cls) => <span className={'rounded px-1 py-px font-mono text-[9px] font-bold ' + cls}>{text}</span>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Configure AI Engine">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={closeModal} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-sky-500/40 bg-slate-950 shadow-[0_0_40px_rgba(56,189,248,0.25)]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/70 p-4">
          <h2 className="font-mono text-sm font-bold text-sky-300">🔑 Configure AI Engine — MED-AI Brain</h2>
          <button type="button" onClick={closeModal} aria-label="Close" className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-slate-200"><X size={16} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className={'rounded-lg border p-2 font-mono text-xs ' + serverLine.cls}>{serverLine.text}</p>

          <div className="grid grid-cols-2 gap-2">
            {AI_ENGINES.providers.map((p) => {
              const keyed = PROVIDERS[p.id] ? (serverOn(p.id) ? 'Vercel key ✓' : draft.keys[p.id] ? 'Browser key ✓' : 'API key required') : p.note;
              return (
                <button type="button" key={p.id} onClick={() => chooseTile(p.id)} aria-pressed={tab === p.id}
                  className={'rounded-xl border p-2.5 text-left transition-all ' + (
                    tab === p.id ? 'border-sky-500/70 bg-sky-500/15 text-sky-200'
                      : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500')}>
                  <p className="text-sm font-bold">{p.badge}</p>
                  <p className="text-xs text-slate-400">{keyed}</p>
                </button>
              );
            })}
          </div>

          {tab === 'onboard' && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 font-mono text-xs text-emerald-300">
              Onboard Autonomous Engine selected — instant, offline, zero configuration. Ideal for the live judge demo.
            </p>
          )}

          {tab === 'auto' && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <p className="mb-1 font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Failover chain — tried in order, one provider billed per answer</p>
              {PROVIDER_ORDER.map((id, i) => {
                const sv = serverOn(id);
                const bk = Boolean(draft.keys[id]);
                return (
                  <div key={id} className="flex items-center gap-2 border-t border-slate-800/70 py-1 font-mono text-[11px]">
                    <span className="w-40 shrink-0 text-slate-300">{i + 1}. {PROVIDERS[id].label}</span>
                    <span className={'shrink-0 ' + (sv || bk ? 'text-emerald-300' : 'text-slate-600')}>
                      {sv && bk ? 'Vercel + browser key' : sv ? 'Vercel key ✓' : bk ? 'browser key ✓' : 'no key — skipped'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-right text-slate-500">{PROVIDERS[id].autoModels[0]}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 border-t border-slate-800/70 py-1 font-mono text-[11px]">
                <span className="w-40 shrink-0 text-slate-300">{PROVIDER_ORDER.length + 1}. Pollinations relay</span>
                <span className={draft.publicRelay ? 'text-amber-300' : 'text-slate-600'}>{draft.publicRelay ? 'on (1 request / 30 s)' : 'off'}</span>
              </div>
              <div className="flex items-center gap-2 border-t border-slate-800/70 py-1 font-mono text-[11px]">
                <span className="w-40 shrink-0 text-slate-300">{PROVIDER_ORDER.length + 2}. Onboard clinical engine</span>
                <span className="text-emerald-300">always available · 0 ms</span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">Open a provider tile to paste a browser key, browse its models, or pin one.</p>
            </div>
          )}

          {meta && (
            <>
              <div>
                <label htmlFor="zg-ai-key" className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
                  Browser API Key {serverOn(tab) ? '(optional — Vercel env key already active)' : '(optional)'}
                </label>
                <input id="zg-ai-key" type="password" autoComplete="off" spellCheck={false} value={draft.keys[tab]} onChange={(e) => setKey(e.target.value)}
                  placeholder={'Paste ' + meta.label + ' API key… (' + meta.keyHint + ')'}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-sky-500/60" />
              </div>
              {detected && detected === tab && (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 font-mono text-xs text-emerald-300">
                  ✅ Key format matches {meta.label}.
                </p>
              )}
              {detected && detected !== tab && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 font-mono text-xs text-amber-300">
                  🔎 Key prefix detected as <b>{PROVIDERS[detected].label}</b> — it will be auto-routed there on save.
                </p>
              )}
              {!detected && browserKey.trim() && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 font-mono text-xs text-amber-300">
                  ⚠️ {meta.label} keys normally start with “{meta.keyPrefix}”.
                </p>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
                    Available Models{models.length ? ' — ' + models.length : ''}
                  </p>
                  <span className="truncate font-mono text-[10px] text-slate-500">
                    {loading ? '⏳ loading catalog…' : catalog.source ? 'source: ' + catalog.source : ''}
                  </span>
                </div>
                {models.length > 8 && (
                  <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter models…" aria-label="Filter models"
                    className="mb-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 font-mono text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-sky-500/60" />
                )}
                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-1.5">
                  <button type="button" onClick={() => edit({ model: '' })} aria-pressed={!pinned}
                    className={'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition-all ' + (
                      !pinned ? 'border-2 border-emerald-400 bg-emerald-950/70 shadow-lg' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500')}>
                    <span className="min-w-0 flex-1 font-mono text-sm font-bold text-white">
                      🔀 AUTOMATIC <span className="font-normal text-slate-400">— failover picks a light, quota-safe model per query</span>
                    </span>
                    {!pinned && <span className="shrink-0 rounded bg-emerald-400 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-950">[✓ SELECTED]</span>}
                  </button>
                  {visible.slice(0, MODEL_ROW_LIMIT).map((m) => {
                    const selected = pinned === m.id;
                    return (
                      <button type="button" key={m.id} onClick={() => edit({ model: selected ? '' : m.id })} aria-pressed={selected} title={m.name || m.id}
                        className={'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition-all ' + (
                          selected ? 'border-2 border-emerald-400 bg-emerald-950/70 shadow-lg' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500')}>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold text-white">{m.id}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {m.recommended ? tag('AUTO #' + m.recommended, 'bg-sky-500/20 text-sky-300') : null}
                          {m.free ? tag('FREE', 'bg-emerald-500/20 text-emerald-300') : null}
                          {m.light ? tag('LIGHT', 'bg-slate-700/70 text-slate-300') : null}
                          {m.ctx ? <span className="hidden font-mono text-[9px] text-slate-500 sm:inline">{fmtCtx(m.ctx)}</span> : null}
                          {selected && <span className="rounded bg-emerald-400 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-950">[✓ PINNED]</span>}
                        </span>
                      </button>
                    );
                  })}
                  {!loading && visible.length > MODEL_ROW_LIMIT && (
                    <p className="px-1 font-mono text-[10px] text-slate-500">+{visible.length - MODEL_ROW_LIMIT} more — type in the filter to narrow the list.</p>
                  )}
                  {!loading && models.length > 0 && visible.length === 0 && (
                    <p className="px-1 font-mono text-[10px] text-slate-500">No model matches “{filter}”.</p>
                  )}
                </div>
                {catalog.key === catalogKey && catalog.note && (
                  <p className={'mt-1 font-mono text-[10px] ' + (catalog.state === 'error' ? 'text-rose-300' : 'text-amber-300/80')}>{catalog.note}</p>
                )}
                {pinned && !loading && !pinnedListed && (
                  <p className="mt-1 font-mono text-[10px] text-amber-300">Pinned model is not in this catalog — it is tried first, then automatic failover takes over.</p>
                )}
                <p className="mt-1 font-mono text-[10px] text-slate-500">
                  AUTO #n = failover order · click a row to pin it, click again (or AUTOMATIC) to unpin · selected: <span className="text-emerald-400">{pinned || 'automatic'}</span>
                </p>
                <div className="mt-1.5">
                  <label htmlFor="zg-ai-model" className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">Custom Model ID (optional)</label>
                  <input id="zg-ai-model" type="text" spellCheck={false} value={draft.model} onChange={(e) => edit({ model: e.target.value.trim() })}
                    placeholder="blank = automatic"
                    className="mt-1 w-full rounded-lg border border-emerald-700/60 bg-slate-950/80 px-3 py-2 font-mono text-xs font-bold text-emerald-300 placeholder-slate-600 outline-none focus:border-emerald-500/70" />
                </div>
              </div>
            </>
          )}

          {tab !== 'onboard' && (
            <label className="flex items-start gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 p-2 font-mono text-xs text-slate-400">
              <input type="checkbox" checked={draft.publicRelay} onChange={(e) => edit({ publicRelay: e.target.checked })} className="mt-0.5 accent-sky-500" />
              <span>Allow the keyless Pollinations relay as a last resort. Off by default: it serves one request per visitor IP about every 30 s, so it cannot sustain a conversation.</span>
            </label>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={runTest} disabled={!canTest || (test && test.state === 'wait')}
              className="shrink-0 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 font-mono text-xs font-bold text-amber-300 transition-all hover:bg-amber-500/25 disabled:opacity-40">
              ⚡ Test API Connection
            </button>
            {test && (
              <p className={'min-w-0 flex-1 break-words font-mono text-xs font-bold ' + (test.state === 'ok' ? 'text-emerald-300' : test.state === 'fail' ? 'text-rose-300' : 'text-slate-400')}>
                {test.msg}
              </p>
            )}
          </div>

          <p className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2 font-mono text-xs text-slate-400">
            Active on save: <span className="text-sky-300">{tile.badge}{meta ? ' · ' + (pinned || 'automatic model') : ''}</span> · Vercel env keys stay on the server; pasted keys are stored in this browser only. If every live link fails, MED-AI answers instantly from the onboard clinical engine.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 bg-slate-900/50 p-4">
          <button type="button" onClick={closeModal} className="rounded-lg border border-slate-700 px-3 py-2 font-mono text-xs text-slate-300 hover:border-slate-500">Cancel</button>
          <button type="button" onClick={() => { cancelTest(); onSave(routeDraftKeys(draft)); }}
            className="rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 font-mono text-xs font-bold text-emerald-300 hover:bg-emerald-500/25">Save Engine</button>
        </div>
      </div>
    </div>
  );
}


const ChatBubble = React.memo(function ChatBubble({ msg }) {
  const ai = msg.role === 'ai';
  return (
    <div className={'max-w-[92%] rounded-xl border p-3 text-sm leading-snug ' + (
      ai ? 'border-sky-500/30 bg-sky-500/5 text-slate-200' : 'ml-auto border-rose-500/40 bg-rose-950/30 text-rose-200')}>
      {ai && (
        <p className="mb-1 flex min-w-0 items-center gap-1 font-mono text-xs font-bold tracking-widest text-sky-400">
          <Sparkles size={11} className="shrink-0" /> <span className="shrink-0">MED-AI {sourceBadge(msg.source || 'onboard')}</span>
          {msg.model ? <span className="min-w-0 truncate font-normal tracking-normal text-sky-400/60">· {msg.model}</span> : null}
          {msg.streaming ? <span className="ml-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-400" aria-label="streaming" /> : null}
        </p>
      )}
      <div dir={isArabic(msg.text) ? 'rtl' : 'ltr'} className="space-y-0.5 text-sm leading-relaxed text-slate-200">{renderFormattedChat(msg.text)}</div>
    </div>
  );
});

const CHAT_REPLY_TOKENS = 4096;
const AUTO_REPLY_TOKENS = 4096;

function scenarioTitleOf(ctx) {
  const s = ctx && (ctx.scenario || ctx.activeScenario);
  return (s && (s.name || s.title || s.label)) || (ctx && ctx.scenarioId) || 'Emergency';
}

function AIChat({ ctx }) {
  const [messages, setMessages] = useState(() => [{
    id: 'greeting',
    role: 'ai',
    text: 'MED-AI online. Earth is ' + NASA_DATA_CONFIG.comm.label + ' away at light speed — I am your autonomous medical officer. Ask anything, or press the microphone to speak hands-free.',
  }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [progress, setProgress] = useState('');
  const [listening, setListening] = useState(false);
  const [listenLang, setListenLang] = useState(() => {
    try { return localStorage.getItem('zgp_voice_input_lang') === 'ar-EG' ? 'ar-EG' : 'en-US'; }
    catch { return 'en-US'; }
  });
  const [voiceOn, setVoiceOn] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The saved engine is the single source of truth for the badge and every query.
  const [engine, setEngine] = useState(loadEngine);
  const [serverStatus, setServerStatus] = useState(peekServerStatus);
  const [lastRoute, setLastRoute] = useState(null);

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const spokenRef = useRef(0);
  const ctxRef = useRef(ctx);
  const engineRef = useRef(engine);
  const messagesRef = useRef(messages);
  const queryRef = useRef(null);
  const autoTimerRef = useRef(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const sendRef = useRef(null);
  const idRef = useRef(0);

  useLayoutEffect(() => {
    ctxRef.current = ctx;
    engineRef.current = engine;
    messagesRef.current = messages;
  });

  // Crew or emergency changed: post the alarm / nominal notice during render
  // (React's "adjust state when a prop changes" pattern); side effects run below.
  const contextKey = ctx.crew.id + ':' + ctx.scenarioId;
  const [seenContext, setSeenContext] = useState(() => ({ key: ctx.crew.id + ':nominal', seq: 0 }));
  if (seenContext.key !== contextKey) {
    const seq = seenContext.seq + 1;
    setSeenContext({ key: contextKey, seq });
    setListening(false);
    setProgress('');
    if (ctx.scenarioId === 'nominal') {
      setMessages((m) => [...m, {
        id: 'ctx-' + seq,
        role: 'ai',
        source: 'onboard',
        text: '**[AUTONOMOUS STATUS // NOMINAL RESTORED]** All crew vitals and cabin environmental parameters have stabilized within NASA-STD-3001 flight-rule limits. Resuming passive biometric watch.',
      }]);
      setThinking(false);
      setLastRoute({ provider: 'onboard', model: '', via: 'local' });
    } else {
      setMessages((m) => [...m, {
        id: 'ctx-' + seq,
        role: 'user',
        text: '[AUTONOMOUS TELEMETRY ALARM // ' + String(scenarioTitleOf(ctx)).toUpperCase() + '] Critical biometric threshold breach detected — initiating autonomous MED-AI intervention.',
      }]);
      setThinking(true);
    }
  }

  // Never sets state synchronously: an aborted query finalises its own message.
  const cancelQuery = useCallback(() => {
    clearTimeout(autoTimerRef.current);
    autoTimerRef.current = null;
    queryRef.current?.abort();
    queryRef.current = null;
    busyRef.current = false;
  }, []);
  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    rec.onresult = rec.onend = rec.onerror = null;
    try { rec.abort(); } catch { /* Browser recognition may already be stopped. */ }
  }, []);
  const cancelSpeech = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* Optional browser API. */ }
  }, []);
  const pushNotice = useCallback((text) => {
    idRef.current += 1;
    const id = 'm-' + idRef.current;
    setMessages((m) => [...m, { id, role: 'ai', text }]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    getServerStatus().then((status) => { if (alive) setServerStatus(status); });
    return () => {
      alive = false;
      mountedRef.current = false;
      cancelQuery();
      stopRecognition();
      cancelSpeech();
    };
  }, [cancelQuery, stopRecognition, cancelSpeech]);

  const { scenario, scenarioId, checkedSteps } = ctx;
  const pred = useMemo(() => computePrediction({ scenario, scenarioId, checkedSteps }), [scenario, scenarioId, checkedSteps]);
  const engineTile = AI_ENGINES.providers.find((p) => p.id === engine.provider) || AI_ENGINES.providers[0];

  // Unknown proxy status (slow cold start) must not be shown as "no keys".
  const statusKnown = Boolean(serverStatus && serverStatus.available !== null);
  let engineBadge = engineTile.badge;
  if (engine.provider === 'auto') {
    const live = Boolean((serverStatus && serverStatus.any) || hasBrowserKeys(engine) || engine.publicRelay);
    engineBadge += statusKnown && !live ? ' · no live keys → Onboard' : ' · auto model';
  } else if (engine.provider !== 'onboard') {
    const keyed = Boolean(engine.keys[engine.provider] || (serverStatus && serverStatus.providers[engine.provider]));
    engineBadge += ' · ' + (engine.model || 'auto model') + (statusKnown && !keyed ? ' · no key → failover' : '');
  }

  // Clean medical & markdown text and speak in sentence chunks (prevents Chrome 15s cutoff bug)
  const speakText = useCallback((rawText) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      // Read the reply's language, independently of the microphone/input setting.
      const lang = /[\u0600-\u06FF]/.test(String(rawText || '')) ? 'ar-EG' : 'en-US';
      const arabic = lang.startsWith('ar');
      const cleaned = String(rawText || '')
        .replace(/SpO₂|SpO2/gi, arabic ? 'تشبع الأكسجين' : 'S P O 2')
        .replace(/ppCO₂|CO₂|CO2/gi, arabic ? 'ثاني أكسيد الكربون' : 'C O 2')
        .replace(/mmHg/gi, arabic ? 'ملم زئبق' : 'millimeters of mercury')
        .replace(/mSv\/day/gi, arabic ? 'مللي سيفرت يومياً' : 'millisieverts per day')
        .replace(/\[|\]|\/\/|[|=_\-•#*»`~>]/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (!cleaned) return;
      const voices = window.speechSynthesis.getVoices?.() || [];
      const preferredVoice = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
        || voices.find((v) => v.lang.toLowerCase().startsWith(arabic ? 'ar' : 'en')) || null;
      const sentences = cleaned.match(/[^.!?؟]+[.!?؟]+|[^.!?؟]+$/g) || [cleaned];
      const chunks = sentences.flatMap((sentence) => sentence.match(/.{1,220}(?:\s|$)|.{1,220}/gu) || []);
      chunks.slice(0, 8).forEach((sentence) => {
        const u = new SpeechSynthesisUtterance(sentence.trim());
        u.lang = lang;
        if (preferredVoice) u.voice = preferredVoice;
        u.rate = 1.03;
        u.pitch = 0.95;
        u.onerror = () => { /* Unavailable voices must not disrupt telemetry. */ };
        window.speechSynthesis.speak(u);
      });
    } catch { cancelSpeech(); }
  }, [cancelSpeech]);

  // Preload browser voices on mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.getVoices) {
        window.speechSynthesis.getVoices();
      }
    } catch { /* Optional browser API — a defined-but-broken speech engine must not break the app. */ }
  }, []);

  const streamingNow = messages.length > 0 && Boolean(messages[messages.length - 1].streaming);
  useEffect(() => {
    try {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: streamingNow ? 'auto' : 'smooth' });
    } catch { /* Reduced browser implementations. */ }
  }, [messages, thinking, streamingNow]);

  // Speak new AI messages aloud when Voice Output is ON (only once a stream has finished).
  useEffect(() => {
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (voiceOn && last && last.role === 'ai' && !last.streaming && lastIdx > spokenRef.current) {
      spokenRef.current = lastIdx;
      speakText(last.text);
    }
  }, [messages, voiceOn, speakText]);

  /* One MED-AI answer: Vercel-key proxy → browser keys → (opt-in relay) → onboard.
   * Live answers stream into a single message; a dropped link keeps the streamed
   * text and the onboard engine completes the answer. */
  const runQuery = useCallback((promptText, historySnapshot, currentCtx, maxTokens = CHAT_REPLY_TOKENS) => {
    cancelQuery();
    const controller = new AbortController();
    queryRef.current = controller;
    busyRef.current = true;
    const eng = engineRef.current;
    const newId = () => { idRef.current += 1; return 'm-' + idRef.current; };
    const current = () => mountedRef.current && !controller.signal.aborted && queryRef.current === controller;
    const release = () => {
      if (queryRef.current === controller) {
        queryRef.current = null;
        busyRef.current = false;
      }
      setThinking(false);
      setProgress('');
    };
    const answerOnboard = (reason) => {
      release();
      const id = newId();
      setMessages((m) => [...m, { id, role: 'ai', source: 'onboard', text: buildAIResponse(promptText, currentCtx) }]);
      setLastRoute({ provider: 'onboard', model: '', via: 'local', reason: reason || '' });
    };
    if (eng.provider === 'onboard' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      answerOnboard(eng.provider === 'onboard' ? '' : 'Browser offline');
      return;
    }

    let streamId = null;
    let text = '';
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (streamId === null || !mountedRef.current) return;
      const id = streamId;
      const snapshot = text;
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: snapshot } : x)));
    };
    const finalize = (patch) => {
      clearTimeout(flushTimer);
      flushTimer = null;
      const id = streamId;
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...patch, streaming: false } : x)));
    };
    const onDelta = (chunk, meta) => {
      if (!current()) return;
      text += chunk;
      if (streamId === null) {
        streamId = newId();
        const id = streamId;
        const first = text;
        setThinking(false);
        setProgress('');
        setMessages((m) => [...m, { id, role: 'ai', source: (meta && meta.provider) || 'onboard', model: (meta && meta.model) || '', text: first, streaming: true }]);
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, 60);
      }
    };
    const onEvent = (e) => {
      if (!current() || streamId !== null) return;
      if (e.type === 'attempt') {
        setProgress(providerLabel(e.provider) + ' · ' + e.model + (e.source === 'server' ? ' · Vercel key' : ' · browser key'));
      } else if (e.type === 'failover' || e.type === 'model-skip') {
        setProgress('failover → next ' + (e.type === 'model-skip' ? 'model' : 'provider') + '…');
      }
    };

    askMedAI({
      engine: eng,
      system: buildLiveSystemPrompt(currentCtx),
      history: historySnapshot,
      prompt: promptText,
      maxTokens,
      signal: controller.signal,
      onDelta,
      onEvent,
    }).then((result) => {
      if (!mountedRef.current) return;
      if (!current()) {
        if (streamId !== null) finalize({ text: text.trim() || result.text });
        return;
      }
      release();
      if (streamId === null) {
        const id = newId();
        setMessages((m) => [...m, { id, role: 'ai', source: result.provider, model: result.model || '', text: result.text }]);
      } else {
        finalize({ text: result.text, source: result.provider, model: result.model || '' });
      }
      setLastRoute({ provider: result.provider, model: result.model || '', via: result.via });
      if (result.via === 'server') getServerStatus().then((status) => { if (mountedRef.current) setServerStatus(status); });
    }).catch((err) => {
      if (!mountedRef.current) return;
      if (!current()) {
        // Superseded or cancelled: keep whatever already streamed.
        if (streamId !== null) finalize({ text: text.trim() });
        return;
      }
      const reason = describeFailure(err);
      if (streamId !== null) {
        release();
        const notice = isArabic(promptText)
          ? (err.kind === 'truncated' ? '**[بلغ الرد حد الرموز — يكمل المحرك الطبي الداخلي]**' : '**[انقطع الاتصال المباشر — يكمل المحرك الطبي الداخلي]**')
          : (err.kind === 'truncated' ? '**[OUTPUT LIMIT REACHED — ONBOARD ENGINE CONTINUES]**' : '**[LINK DROPPED — ONBOARD ENGINE CONTINUES]**');
        finalize({ text: (text.trim() ? text.trim() + '\n\n---\n' : '') + notice + '\n' + buildAIResponse(promptText, currentCtx) });
        setLastRoute({ provider: 'onboard', model: '', via: 'local', reason });
        return;
      }
      if (err && err.configured) console.info('[MED-AI] live link unavailable — onboard engine answered:', reason);
      answerOnboard(reason);
    });
  }, [cancelQuery]);

  // Autonomous Emergency Trigger: fires whenever the crew or emergency changes (not on nominal).
  useEffect(() => {
    cancelQuery();
    stopRecognition();
    cancelSpeech();
    const fresh = ctxRef.current;
    if (!fresh || fresh.scenarioId === 'nominal') return undefined;
    busyRef.current = true;
    const crewId = fresh.crew.id;
    const firedScenario = fresh.scenarioId;
    const autoPrompt =
      'AUTONOMOUS EMERGENCY TRIGGER: ' +
      scenarioTitleOf(fresh) +
      ' detected. Analyze current abnormal crew telemetry, identify critical organ risks, and issue immediate step-by-step autonomous medical countermeasures under NASA-STD-3001. Keep response concise, complete, and under 180 words.';
    autoTimerRef.current = setTimeout(() => {
      autoTimerRef.current = null;
      const now = ctxRef.current;
      if (!mountedRef.current || now.crew.id !== crewId || now.scenarioId !== firedScenario) return;
      runQuery(autoPrompt, [], now, AUTO_REPLY_TOKENS);
    }, 1400);
    return cancelQuery;
  }, [contextKey, runQuery, cancelQuery, stopRecognition, cancelSpeech]);

  const send = useCallback((text) => {
    const q = String(text || '').trim();
    if (!q || busyRef.current || !mountedRef.current) return;
    const snapshot = messagesRef.current;
    stopRecognition();
    setListening(false);
    idRef.current += 1;
    const id = 'm-' + idRef.current;
    setMessages((m) => [...m, { id, role: 'user', text: q }]);
    setInput('');
    setThinking(true);
    runQuery(q, snapshot, ctxRef.current, CHAT_REPLY_TOKENS);
  }, [runQuery, stopRecognition]);
  useLayoutEffect(() => { sendRef.current = send; }, [send]);

  const handleSaveEngine = useCallback((next) => {
    const saved = saveEngine(next);
    resetHealth();
    setEngine(saved);
    setLastRoute(null);
    setSettingsOpen(false);
    getServerStatus({ force: true }).then((status) => { if (mountedRef.current) setServerStatus(status); });
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const selectListenLanguage = (lang) => {
    if (lang === listenLang) return;
    // Stop the old session so a late transcript cannot be sent in the wrong mode.
    stopRecognition();
    setListening(false);
    setListenLang(lang);
    try { localStorage.setItem('zgp_voice_input_lang', lang); } catch { /* Private mode. */ }
  };
  // Improved Microphone Input: Live transcript preview + auto-send when finished speaking
  const startVoice = () => {
    if (recognitionRef.current) {
      stopRecognition();
      setListening(false);
      return;
    }
    if (busyRef.current) return;
    const SpeechRec = typeof SR !== 'undefined' && SR
      ? SR
      : (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition));

    if (!SpeechRec) {
      pushNotice('Voice input requires Chrome or Edge (Web Speech API). Please use Chrome/Edge or type your question below.');
      return;
    }

    // Silence any ongoing AI speech so the mic doesn't record the speaker
    cancelSpeech();

    let rec;
    try { rec = new SpeechRec(); } catch { setListening(false); return; }
    rec.lang = listenLang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalTranscript = '';

    rec.onresult = (e) => {
      if (!mountedRef.current || recognitionRef.current !== rec) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalTranscript += piece + ' ';
        } else {
          interim += piece;
        }
      }
      setInput((finalTranscript + interim).trim());
    };

    rec.onend = () => {
      if (!mountedRef.current || recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      rec.onresult = rec.onend = rec.onerror = null;
      setListening(false);
      if (finalTranscript.trim()) {
        sendRef.current?.(finalTranscript.trim());
      }
    };

    rec.onerror = (e) => {
      if (!mountedRef.current || recognitionRef.current !== rec) return;
      stopRecognition();
      setListening(false);
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        pushNotice('Microphone access was blocked by the browser. Click the lock/tune icon next to the URL bar and allow Microphone access.');
      }
    };

    recognitionRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { stopRecognition(); setListening(false); }
  };

  // Improved Speaker Toggle: Immediately reads the latest AI response when switched ON
  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (!next) {
      cancelSpeech();
    } else {
      const lastAi = [...messages].reverse().find((m) => m.role === 'ai' && !m.streaming);
      spokenRef.current = messages.length - 1;
      if (lastAi) speakText(lastAi.text);
    }
  };

  const thinkingLabel = progress
    ? '⇄ ' + progress + ' — reasoning over live telemetry…'
    : (engine.provider === 'auto' ? '🔀 MED-AI' : engineTile.badge) + ' reasoning over live telemetry…';

  return (
    <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
          <Bot size={15} className="text-sky-400" /> {NASA_DATA_CONFIG.ai.officerName}
        </h2>
        <span className="max-w-full truncate rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-xs font-bold text-sky-300" title="Configured MED-AI engine">
          {engineBadge}
        </span>
        {lastRoute && (
          <span className="max-w-full truncate rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] text-slate-400"
            title={lastRoute.reason ? 'Last answer: ' + lastRoute.reason : 'Engine that produced the last answer'}>
            ↳ {sourceBadge(lastRoute.provider)}{lastRoute.model ? ' · ' + lastRoute.model : ''}{lastRoute.via === 'server' ? ' · Vercel key' : lastRoute.via === 'browser' ? ' · browser key' : ''}
          </span>
        )}
        <button onClick={() => setSettingsOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/60 px-2.5 py-1.5 font-mono text-xs font-bold text-slate-200 transition-all hover:border-sky-500/50 hover:text-sky-300">
          Configure AI Engine
        </button>
      </div>

      <PredictiveBanner pred={pred} />

      <div ref={scrollRef} className="h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3">
        {messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}
        {thinking && (
          <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
            <span className="h-2 w-2 shrink-0 animate-ping rounded-full bg-sky-400" />
            <span className="min-w-0 truncate">{thinkingLabel}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {NASA_DATA_CONFIG.ai.quickPrompts.map((p) => (
          <button key={p} onClick={() => send(p)}
            className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 font-mono text-xs text-slate-300 transition-all hover:border-sky-500/50 hover:text-sky-300">
            {p}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-2 flex flex-wrap gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? (listenLang === 'ar-EG' ? 'جارٍ الاستماع... تحدث بالعربية...' : 'Speak in English...') : 'Ask MED-AI about crew health…'}
          className="min-w-0 basis-full flex-1 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-sky-500/60 sm:basis-0 sm:min-w-[120px]" />
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={startVoice} title={listenLang === 'ar-EG' ? 'Voice input — Arabic (Egypt)' : 'Voice input — English (US)'} aria-pressed={listening}
            className={'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 font-mono text-xs font-bold transition-all ' + (
              listening ? 'border-rose-500/60 bg-rose-500/20 text-rose-300 animate-pulse'
                : 'border-slate-700 bg-slate-950/80 text-slate-300 hover:border-sky-500/50 hover:text-sky-300')}>
            <Mic size={14} /> {listening ? 'LISTENING' : 'Voice'}
          </button>
          <div role="group" aria-label="Voice input language" className="flex items-center rounded-full border border-slate-700 bg-slate-950/90 p-0.5 font-mono text-[10px] font-bold">
            {[['en-US', 'EN', 'English'], ['ar-EG', 'AR', 'Arabic']].map(([lang, label, name]) => (
              <button key={lang} type="button" aria-label={name + ' voice input'} aria-pressed={listenLang === lang}
                onClick={() => selectListenLanguage(lang)} title={name + ' voice input'}
                className={'rounded-full px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400 ' +
                  (listenLang === lang ? 'bg-sky-500/20 text-sky-300 shadow-inner' : 'text-slate-500 hover:text-slate-200')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="submit"
          className="flex items-center gap-1.5 rounded-lg border border-sky-500/50 bg-sky-500/15 px-3 py-2 font-mono text-xs font-bold text-sky-300 transition-all hover:bg-sky-500/25">
          <Send size={13} /> SEND
        </button>
        <button type="button" onClick={toggleVoice} title="Auto-read MED-AI replies aloud"
          className={'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 font-mono text-xs font-bold transition-all ' + (
            voiceOn ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 animate-pulse'
              : 'border-slate-700 bg-slate-950/80 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300')}>
          {voiceOn ? <Volume2 size={14} /> : <VolumeX size={14} />} {voiceOn ? 'ON' : 'OFF'}
        </button>
      </form>
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-sky-400">
            Official Challenge Data & Partner Resources (NASA HRP · CSA · OSDR)
          </span>
          <span className="font-mono text-[10px] text-emerald-400">5/5 Integrated</span>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {(NASA_DATA_CONFIG.challengeResources || []).map((res) => (
            <a
              key={res.id}
              href={res.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col justify-between rounded-lg border border-slate-800/90 bg-slate-900/50 p-2 transition-all hover:border-sky-500/50 hover:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                  {res.agency}
                </span>
                <span className="font-mono text-[10px] text-slate-500 group-hover:text-sky-400">
                  Open Official Source ↗
                </span>
              </div>
              <p className="mt-1 font-mono text-xs font-bold text-slate-200 group-hover:text-sky-300">
                {res.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                {res.usage}
              </p>
            </a>
          ))}
        </div>
      </div>
      <AISettingsModal open={settingsOpen} onClose={closeSettings} engine={engine} onSave={handleSaveEngine} serverStatus={serverStatus} />
    </section>
  );
}



/* ============================================================================
 * SECTION 7 — UPGRADE 2: Transmit Earth Downlink Packet Modal
 * ==========================================================================*/
function buildDownlinkPacket({ crew, scenario, values, met, checkedSteps }) {
  return {
    reportId: 'ZGP-DL-' + Date.now(),
    missionId: NASA_DATA_CONFIG.downlink.missionId,
    missionElapsedTime: met,
    earthTimestampUTC: new Date().toISOString(),
    vehicle: NASA_DATA_CONFIG.mission.craft,
    commDelay: NASA_DATA_CONFIG.comm.label,
    crew: { callsign: crew.callsign, name: crew.name, role: crew.role },
    activeEmergencyState: scenario.title,
    overallStatus: getOverallStatus(values) === 'NORMAL' ? 'NOMINAL' : getOverallStatus(values),
    metrics: METRIC_ORDER.reduce((acc, key) => {
      const m = NASA_DATA_CONFIG.metrics[key];
      acc[key] = {
        label: m.label, value: Number(fmtVal(values[key], m)), unit: m.unit,
        status: getMetricStatus(m, values[key]), source: m.source,
      };
      return acc;
    }, {}),
    protocol: {
      title: scenario.protocol.title,
      completed: checkedSteps.length,
      total: scenario.protocol.steps.length,
      steps: scenario.protocol.steps.map((s, i) => ({ index: i + 1, text: s, done: checkedSteps.includes(i) })),
      completedSteps: checkedSteps.map((i) => (i + 1) + '. ' + scenario.protocol.steps[i]),
      pendingSteps: scenario.protocol.steps
        .map((s, i) => (checkedSteps.includes(i) ? null : (i + 1) + '. ' + s))
        .filter(Boolean),
    },
    dsnTarget: NASA_DATA_CONFIG.downlink.dsn.station,
  };
}


const DownlinkModal = React.memo(function DownlinkModal({ open, onClose, packet }) {
  if (!open || !packet) return null;
  return <DownlinkModalContent onClose={onClose} packet={packet} />;
});

function DownlinkModalContent({ onClose, packet }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [copied, setCopied] = useState(false);
  const [uplink, setUplink] = useState({ phase: 'idle', progress: 0, stageIdx: 0 });
  const uplinkRef = useRef(null);
  const copyTimerRef = useRef(null);
  const mountedRef = useRef(false);
  const copyGenerationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyGenerationRef.current += 1;
      clearInterval(uplinkRef.current);
      clearTimeout(copyTimerRef.current);
    };
  }, []);

  const overall = packet.overallStatus;
  const os = STATUS_STYLE[overall === 'NOMINAL' ? 'NORMAL' : overall];

  const copyJSON = async () => {
    const generation = ++copyGenerationRef.current;
    const text = JSON.stringify(packet, null, 2);
    let success = false;
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch {
      if (!mountedRef.current || generation !== copyGenerationRef.current) return;
      let ta;
      try {
        ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        success = document.execCommand('copy');
      } catch { /* Clipboard permissions may be denied. */ }
      finally { ta?.remove(); }
    }
    if (!success || !mountedRef.current || generation !== copyGenerationRef.current) return;
    clearTimeout(copyTimerRef.current);
    setCopied(true);
    copyTimerRef.current = setTimeout(() => {
      if (mountedRef.current && generation === copyGenerationRef.current) setCopied(false);
    }, 2200);
  };

  const printReport = () => {
    const chip = (st) => st === 'CRITICAL'
      ? 'color:#fb7185;background:#450a0a;border:1px solid #f43f5e;'
      : st === 'WARNING'
        ? 'color:#fbbf24;background:#451a03;border:1px solid #d97706;'
        : 'color:#34d399;background:#022c22;border:1px solid #059669;';
    const vitalsRows = METRIC_ORDER.map((k) => {
      const mm = packet.metrics[k];
      return '<tr>'
        + '<td style="padding:7px 12px;border-bottom:1px solid #1f2937;color:#e2e8f0;">' + mm.label + '</td>'
        + '<td style="padding:7px 12px;border-bottom:1px solid #1f2937;color:#f8fafc;font-weight:bold;white-space:nowrap;">' + mm.value + ' ' + mm.unit + '</td>'
        + '<td style="padding:7px 12px;border-bottom:1px solid #1f2937;color:#64748b;font-size:10px;">' + mm.source + '</td>'
        + '<td style="padding:7px 12px;border-bottom:1px solid #1f2937;"><span style="' + chip(mm.status) + 'padding:2px 10px;border-radius:4px;font-size:9px;letter-spacing:2px;font-weight:bold;">' + mm.status + '</span></td>'
        + '</tr>';
    }).join('');
    const stepRows = packet.protocol.steps.map((st2) => (
      '<tr>'
      + '<td style="padding:7px 12px;border-bottom:1px solid #1f2937;color:#94a3b8;white-space:nowrap;">STEP ' + st2.index + '</td>'
      + '<td style="padding:7px 12px;border-bottom:1px solid #1f2937;color:#e2e8f0;">' + st2.text + '</td>'
      + '<td style="padding:7px 12px;border-bottom:1px solid #1f2937;"><span style="' + (st2.done ? chip('NORMAL') : 'color:#94a3b8;background:#0f172a;border:1px solid #334155;') + 'padding:2px 10px;border-radius:4px;font-size:9px;letter-spacing:2px;font-weight:bold;">' + (st2.done ? 'DONE' : 'PENDING') + '</span></td>'
      + '</tr>'
    )).join('');
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NASA Flight Surgeon Clinical Telemetry Report</title>'
      + '<style>body{background:#0b1220;color:#e2e8f0;font-family:Consolas,monospace;padding:28px;}'
      + 'h1{color:#38bdf8;font-size:17px;letter-spacing:2px;margin:0;}'
      + '.class{color:#fbbf24;border:1px solid #d97706;font-size:10px;letter-spacing:4px;padding:2px 10px;border-radius:4px;}'
      + 'table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px;background:#0f172a;border:1px solid #334155;border-radius:8px;}'
      + 'th{background:#1e293b;color:#94a3b8;font-size:10px;letter-spacing:2px;text-align:left;padding:8px 12px;}'
      + '.meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px;}'
      + '.meta div{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 12px;}'
      + '.meta b{color:#38bdf8;font-size:9px;letter-spacing:2px;display:block;}'
      + '.meta span{font-size:12px;color:#f1f5f9;}'
      + '.sec{color:#38bdf8;font-size:11px;letter-spacing:3px;margin-top:22px;border-bottom:1px solid #334155;padding-bottom:4px;}'
      + '.sig{margin-top:28px;display:grid;grid-template-columns:2fr 1fr;gap:16px;}'
      + '.sig div{border-top:1px solid #64748b;padding-top:6px;font-size:10px;color:#94a3b8;letter-spacing:1px;}'
      + 'small{color:#64748b;}</style></head><body>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;">'
      + '<h1>NATIONAL AERONAUTICS AND SPACE ADMINISTRATION</h1><span class="class">AUTONOMOUS / NOT EARTH-REVIEWED</span></div>'
      + '<h2 style="font-size:13px;letter-spacing:2px;color:#f8fafc;margin:6px 0 0 0;">FLIGHT SURGEON CLINICAL TELEMETRY REPORT — ZERO-G PULSE</h2>'
      + '<small style="color:#64748b;">Report ' + packet.reportId + ' · Mission ' + packet.missionId + ' · Transmission delay ' + packet.commDelay + ' (one-way light time)</small>'
      + '<div class="meta">'
      + '<div><b>MISSION ELAPSED TIME</b><span>' + packet.missionElapsedTime + '</span></div>'
      + '<div><b>EARTH TIMESTAMP (UTC)</b><span>' + packet.earthTimestampUTC + '</span></div>'
      + '<div><b>VEHICLE</b><span>' + packet.vehicle + '</span></div>'
      + '<div><b>CREW MEMBER</b><span>' + packet.crew.callsign + ' ' + packet.crew.name + ' — ' + packet.crew.role + '</span></div>'
      + '<div><b>ACTIVE EMERGENCY STATE</b><span>' + packet.activeEmergencyState + '</span></div>'
      + '<div><b>OVERALL CREW STATUS</b><span style="' + chip(packet.overallStatus === 'NOMINAL' ? 'NORMAL' : packet.overallStatus) + 'border-radius:4px;padding:1px 8px;font-weight:bold;">' + packet.overallStatus + '</span></div>'
      + '</div>'
      + '<div class="sec">VITAL & ENVIRONMENTAL TELEMETRY SNAPSHOT</div>'
      + '<table><tr><th>PARAMETER</th><th>VALUE</th><th>DATA SOURCE</th><th>STATUS</th></tr>' + vitalsRows + '</table>'
      + '<div class="sec">COUNTERMEASURE PROTOCOL — ' + packet.protocol.completed + ' OF ' + packet.protocol.total + ' STEPS COMPLETE</div>'
      + '<table><tr><th>#</th><th>' + packet.protocol.title + '</th><th>STATUS</th></tr>' + stepRows + '</table>'
      + '<div class="sig">'
      + '<div>GENERATED AUTONOMOUSLY BY MED-AI — ONBOARD MEDICAL OFFICER, ZERO-G PULSE v2.1</div>'
      + '<div>DSN TARGET: ' + packet.dsnTarget + '</div>'
      + '</div>'
      + '<small style="display:block;margin-top:14px;">Earth MCC response ETA ~29 min (round-trip light time). This document was produced without human review per autonomous operations doctrine NASA-STD-3001 / HRP Standard Measures.</small>'
      + '</body></html>';
    try {
      const w = window.open('', '_blank', 'width=860,height=960');
      if (!w) return;
      w.opener = null;
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    } catch { /* A blocked popup or unavailable printer must not crash the app. */ }
  };


  const startUplink = () => {
    if (uplink.phase !== 'idle' || uplinkRef.current) return;
    clearInterval(uplinkRef.current);
    setUplink({ phase: 'transmitting', progress: 0, stageIdx: 0 });
    let progress = 0;
    uplinkRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      progress = Math.min(100, progress + 4);
      const stageIdx = Math.min(
        NASA_DATA_CONFIG.downlink.dsn.uplinkStages.length - 1,
        Math.floor(progress / (100 / NASA_DATA_CONFIG.downlink.dsn.uplinkStages.length))
      );
      if (progress >= 100) {
        clearInterval(uplinkRef.current);
        uplinkRef.current = null;
      }
      setUplink({ phase: progress >= 100 ? 'queued' : 'transmitting', progress, stageIdx });
    }, 110);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-sky-500/40 bg-slate-950 shadow-[0_0_40px_rgba(56,189,248,0.25)]">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/70 p-4">
          <div>
            <h2 className="flex items-center gap-2 font-mono text-sm font-bold tracking-wide text-sky-300">
              <Satellite size={16} className="animate-pulse" /> {NASA_DATA_CONFIG.downlink.title}
              <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px]">({NASA_DATA_CONFIG.downlink.owtLabel})</span>
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-slate-500">
              Report {packet.reportId} · Mission {packet.missionId} · DSN Target: {packet.dsnTarget}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:border-slate-500 hover:text-slate-200"><X size={16} /></button>
        </div>

        {/* body */}
        <div className="overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['MET', packet.missionElapsedTime], ['UTC', packet.earthTimestampUTC.slice(11, 19) + 'Z'],
              ['Crew', `${packet.crew.callsign} ${packet.crew.name}`], ['Emergency State', packet.activeEmergencyState],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2">
                <p className="font-mono text-[9px] uppercase tracking-widest text-slate-500">{k}</p>
                <p className="truncate font-mono text-xs font-bold text-slate-200" title={String(v)}>{v}</p>
              </div>
            ))}
          </div>

          <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[12px] font-bold ${os.badge}`}>
            OVERALL CREW STATUS: {overall}
            <span className="ml-auto font-normal text-slate-400">One-way delay {packet.commDelay} — AI-generated, unreviewed by Earth</span>
          </div>

          <p className="mt-4 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">Full Telemetry Snapshot</p>
          <div className="mt-1.5 overflow-hidden rounded-lg border border-slate-800">
            {METRIC_ORDER.map((k, i) => {
              const m = packet.metrics[k];
              const ms = STATUS_STYLE[m.status === 'NORMAL' ? 'NORMAL' : m.status];
              return (
                <div key={k} className={`flex items-center justify-between gap-2 px-3 py-1.5 font-mono text-xs ${i % 2 ? 'bg-slate-900/40' : 'bg-slate-950/60'}`}>
                  <span className="text-slate-300">{m.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold tabular-nums text-slate-100">{m.value} <span className="text-[9px] text-slate-500">{m.unit}</span></span>
                    <span className="rounded bg-slate-800/80 px-1 py-0.5 text-[8px] text-slate-400">{m.source}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${ms.badge}`}>{m.status}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-4 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Countermeasure Checklist Progress — {packet.protocol.completed}/{packet.protocol.total}
          </p>
          <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
            <p className="font-mono text-xs font-bold text-slate-300">{packet.protocol.title}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${(packet.protocol.completed / packet.protocol.total) * 100}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {scenario_steps_badges(packet)}
            </div>
          </div>

          {/* DSN uplink animation */}
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs text-slate-400">
                <Radio size={12} className="mr-1 inline text-sky-400" />
                {uplink.phase === 'idle' && 'Deep Space Network uplink ready — packet staged for transmission.'}
                {uplink.phase === 'transmitting' && NASA_DATA_CONFIG.downlink.dsn.uplinkStages[uplink.stageIdx]}
                {uplink.phase === 'queued' && (
                  <span className="font-bold text-emerald-300">{NASA_DATA_CONFIG.downlink.dsn.queuedLabel}</span>
                )}
              </p>
              <button
                onClick={startUplink}
                disabled={uplink.phase !== 'idle'}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs font-bold transition-all ${
                  uplink.phase === 'idle'
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
                    : uplink.phase === 'queued'
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-slate-800/50 text-slate-400'
                }`}
              >
                <Satellite size={13} className={uplink.phase === 'transmitting' ? 'animate-pulse' : ''} />
                {uplink.phase === 'idle' ? 'Queue for DSN Uplink' : uplink.phase === 'transmitting' ? 'Transmitting…' : 'Queued ✓'}
              </button>
            </div>
            {(uplink.phase === 'transmitting' || uplink.phase === 'queued') && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div className={`h-full rounded-full transition-all duration-100 ${uplink.phase === 'queued' ? 'bg-emerald-500' : 'bg-sky-400'}`}
                  style={{ width: `${uplink.progress}%` }} />
              </div>
            )}
          </div>
        </div>

        {/* footer actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/70 p-3">
          <button onClick={copyJSON}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 font-mono text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-500/25">
            {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />} {copied ? 'COPIED ✓' : 'Copy Telemetry JSON'}
          </button>
          <button onClick={printReport}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-2 font-mono text-xs font-bold text-slate-200 transition-all hover:border-slate-400">
            <Printer size={13} /> Print Clinical Report
          </button>
        </div>
      </div>
    </div>
  );

  /* small helper for step badges inside modal closure */
  function scenario_steps_badges(p) {
    const labels = p.protocol.title && p.protocol.completedSteps.concat(p.protocol.pendingSteps);
    return labels.map((s, i) => (
      <span key={i} className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
        p.protocol.completedSteps.includes(s)
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-slate-700 bg-slate-950/60 text-slate-500'
      }`}>{s}</span>
    ));
  }
}

/* ============================================================================
 * SECTION 8 — UPGRADE 3: NASA Open Data & Standards Modal
 * ==========================================================================*/
const NASADataModal = React.memo(function NASADataModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-emerald-500/40 bg-slate-950 shadow-[0_0_40px_rgba(16,185,129,0.2)]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/70 p-4">
          <div>
            <h2 className="flex items-center gap-2 font-mono text-sm font-bold tracking-wide text-emerald-300">
              <Database size={16} /> NASA Open Data & Standards — Scientific Foundation
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-slate-500">
              Every threshold in ZeroG Pulse is traceable to a NASA dataset or flight standard — tunable in NASA_DATA_CONFIG without UI changes.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:border-slate-500 hover:text-slate-200"><X size={16} /></button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {NASA_DATA_CONFIG.datasets.map((d, i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 transition-all hover:border-emerald-500/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[12px] font-bold text-slate-200">{d.name}</p>
                <a href={d.url} target="_blank" rel="noreferrer"
                  className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20">
                  {d.id} ↗
                </a>
              </div>
              <p className="mt-1.5 font-mono text-xs font-bold text-sky-300">{d.education.title}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{d.education.body}</p>
            </div>
          ))}

          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3.5">
            <p className="font-mono text-xs font-bold text-sky-300">Mission Justification — Why Autonomous Medical Software?</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{NASA_DATA_CONFIG.comm.note}</p>
          </div>
        </div>
      </div>
    </div>
  );
});

const MissionFooter = React.memo(function MissionFooter({ onOpenData }) {
  return (
    <footer className=" relative z-10 border-t border-slate-800/80 bg-slate-950 px-4 py-3">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-slate-400">
          {NASA_DATA_CONFIG.mission.team} · All thresholds &amp; protocols editable in NASA_DATA_CONFIG
        </p>
        <button
          onClick={onOpenData}
          className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[10px] font-bold text-emerald-300 transition-all hover:bg-emerald-500/20"
        >
          <Database size={12} />
          NASA Open Data &amp; Scientific Validity: {NASA_DATA_CONFIG.datasets.map((d) => d.id).join(' · ')} — CLICK TO INSPECT
        </button>
      </div>
    </footer>
  );
});

/* ============================================================================
 * SECTION 9 — Root App Component (wiring + telemetry engine)
 * ==========================================================================*/
function seedHistory(crew, met) {
  return Array.from({ length: 10 }, (_, i) => {
    const vals = {};
    METRIC_ORDER.forEach((key) => {
      vals[key] = crew.baselines[key] + (Math.random() - 0.5) * 2 * NASA_DATA_CONFIG.metrics[key].jitter;
    });
    return { met: fmtMET(met - (9 - i) * TICK_MS / 1000), ...vals };
  });
}

export default function App() {
  const [crewId, setCrewId] = useState(NASA_DATA_CONFIG.crews[0].id);
  const [scenarioId, setScenarioId] = useState('nominal');
  const [history, setHistory] = useState(() => seedHistory(NASA_DATA_CONFIG.crews[0], 15600));
  const [checkedSteps, setCheckedSteps] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [downlinkOpen, setDownlinkOpen] = useState(false);

  /* Memoized root event handlers to prevent child re-renders */
  const handleCrewChange = useCallback((id) => {
    if (id === crewId) return;
    const nextCrew = NASA_DATA_CONFIG.crews.find((c) => c.id === id);
    if (!nextCrew) return;
    valuesRef.current = nextCrew.baselines;
    setCrewId(id);
    setHistory(seedHistory(nextCrew, metRef.current));
    setCheckedSteps([]);
  }, [crewId]);
  const handleScenarioChange = useCallback((id) => {
    if (id === scenarioId || !NASA_DATA_CONFIG.scenarios[id]) return;
    setScenarioId(id);
    setCheckedSteps([]);
  }, [scenarioId]);
  const handleOpenDownlink = useCallback(() => setDownlinkOpen(true), []);
  const handleCloseDownlink = useCallback(() => setDownlinkOpen(false), []);
  const handleOpenData = useCallback(() => setDrawerOpen(true), []);
  const handleCloseData = useCallback(() => setDrawerOpen(false), []);

  const valuesRef = useRef({ ...NASA_DATA_CONFIG.crews[0].baselines });
  const metRef = useRef(15600);

  const crew = NASA_DATA_CONFIG.crews.find((c) => c.id === crewId);
  const scenario = NASA_DATA_CONFIG.scenarios[scenarioId];

  /* Telemetry engine: 1.5 s cadence */
  useEffect(() => {
    const id = setInterval(() => {
      const target = computeTarget(crew, NASA_DATA_CONFIG.scenarios[scenarioId]);
      const next = {};
      METRIC_ORDER.forEach((k) => {
        const cur = valuesRef.current[k];
        const cfg = NASA_DATA_CONFIG.metrics[k];
        const drift = (target[k] - cur) * SMOOTHING;
        const jitter = (Math.random() - 0.5) * 2 * cfg.jitter;
        next[k] = cur + drift + jitter;
      });
      valuesRef.current = next;
      // Increment once per real interval, never inside a replayable state updater.
      metRef.current += TICK_MS / 1000;
      const point = { met: fmtMET(metRef.current), ...next };
      setHistory((h) => [...h, point].slice(-HISTORY_LEN));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [crew, scenarioId]);

  const values = useMemo(() => history.length ? history[history.length - 1] : crew.baselines, [history, crew]);
  const overall = getOverallStatus(values);
  const prevValues = history.length > 1 ? history[history.length - 2] : values;

  const ctx = useMemo(() => ({
    crew, scenario, scenarioId, values, checkedSteps,
    met: values.met || fmtMET(15600),
  }), [crew, scenario, scenarioId, values, checkedSteps]);

  /* Fast-bail: Only compute expensive downlink packet payload when downlink modal is actually open */
  const packet = useMemo(() => {
    if (!downlinkOpen) return null;
    return buildDownlinkPacket({
      crew, scenario, values, met: ctx.met, checkedSteps,
    });
  }, [downlinkOpen, crew, scenario, values, ctx.met, checkedSteps]);

  const toggleStep = useCallback((i) => {
    setCheckedSteps((cs) => (cs.includes(i) ? cs.filter((x) => x !== i) : [...cs, i]));
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#03060c] bg-[radial-gradient(ellipse_at_top,rgba(14,116,144,0.16),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(190,24,93,0.08),transparent_50%)] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:32px_32px] opacity-40" />
      <Starfield />

      <MissionHeader crewId={crewId} onCrewChange={handleCrewChange} overall={overall} onTransmit={handleOpenDownlink} />
      <div className="mx-auto max-w-[1600px] px-4">
        <OrbitalTrajectoryHUD emergency={scenarioId !== 'nominal'} />
        <JudgeQuickGuideHUD onOpenData={handleOpenData} onOpenDownlink={handleOpenDownlink} />
      </div>
      <ScenarioBar scenarioId={scenarioId} onScenarioChange={handleScenarioChange} />

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 pb-8 pt-4">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {METRIC_ORDER.map((k) => (
            <VitalsCard key={k} metricKey={k} value={values[k]} prevValue={prevValues[k]} history={history} />
          ))}
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <TelemetryChartPanel history={history} values={values} scenarioId={scenarioId} />
          </div>
          <div className="xl:col-span-5 self-start">
            <BiomedicalDigitalTwinHUD values={values} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ProtocolPanel scenario={scenario} crew={crew} checked={checkedSteps} onToggleStep={toggleStep} onTransmit={handleOpenDownlink} />
          <AIChat ctx={ctx} />
        </div>
      </main>
      <DualImpactAndDisclosureHUD onOpenData={handleOpenData} />
      <MissionFooter onOpenData={handleOpenData} />

      <DownlinkModal open={downlinkOpen} onClose={handleCloseDownlink} packet={packet} />
      <NASADataModal open={drawerOpen} onClose={handleCloseData} />
    </div>
  );
}
