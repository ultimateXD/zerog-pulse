/* Reproducible demonstration helpers, not validated physiological models. */
export const SIMULATION_DISCLOSURE = 'Super Intelligence (SI) AI assistance enabled. Telemetry channels are driven by deterministic simulation models (NASA-STD-3001 compliance framework).';
export const SIMULATION_QUALIFICATION = 'Educational prototype: NASA-STD-3001 is a reference framework, not a compliance certification. Illustrative thresholds and predictions are not clinically validated. SI labels AI assistance, not demonstrated superintelligence. Not medical guidance.';

/** Query-string choice overrides the optional, public VITE_DEMO_MODE flag. */
export function isDemoMode(search = typeof window === 'undefined' ? '' : window.location.search, configured = import.meta.env?.VITE_DEMO_MODE) {
  const enabled = (value) => ['true', '1', 'on'].includes(String(value || '').toLowerCase());
  try {
    const params = new URLSearchParams(search);
    if (params.has('demo')) return enabled(params.get('demo'));
  } catch { /* Malformed or unavailable URL state falls back to configuration. */ }
  return enabled(configured);
}

/** Same crew, scenario, channel and simulated timestamp always produce the same noise. */
export function deterministicJitter({ crewId, scenarioId, metricKey, met, amplitude }) {
  const key = [crewId, scenarioId, metricKey, met].join('|');
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) {
    seed ^= key.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  const size = Number(amplitude);
  if (!Number.isFinite(size) || size <= 0) return 0;
  return (((seed >>> 0) / 4294967295) * 2 - 1) * size;
}
