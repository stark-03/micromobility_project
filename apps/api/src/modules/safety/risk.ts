import type { RiskLevel, RouteRiskDto } from '@mm/shared-types';

/**
 * Route risk. Pure: segment attributes in, a score and a band out.
 *
 * Five factors, each scaled 0 (safe) to 1 (risky) per segment, then averaged
 * over the route weighted by segment length — a dangerous 40 m junction should
 * not count as much as a dangerous 2 km arterial.
 *
 * The weights are a stated judgement, not a fitted model: accident history
 * leads because it is the only factor that measures harm rather than
 * predicting it. Recalibrate them here when real incident data arrives.
 */
export const RISK_WEIGHTS = Object.freeze({
  accidents: 0.3,
  traffic: 0.2,
  infrastructure: 0.2,
  lighting: 0.15,
  roadQuality: 0.15,
});

/** Bands the rider sees. Scores are 0–100. */
export const RISK_BANDS = Object.freeze({ mediumFrom: 35, highFrom: 60 });

/**
 * Severity-weighted incidents per km that count as maximum accident risk.
 * Six minor falls per km, or two serious collisions, is as bad as it gets.
 */
const SATURATING_INCIDENTS_PER_KM = 6;

const SEVERITY_WEIGHT = { minor: 1, serious: 3, fatal: 10 } as const;

/** Exposure to motor traffic by road type, before any bike lane. */
const INFRASTRUCTURE_RISK: Record<string, number> = {
  cycleway: 0,
  path: 0.2,
  local: 0.4,
  collector: 0.7,
  arterial: 1,
};

export interface SegmentRiskInput {
  lengthM: number;
  roadClass: string;
  hasBikeLane: boolean;
  lit: boolean;
  /** 1 (broken) to 5 (good); null when the road has not been surveyed. */
  surfaceQuality: number | null;
  /** 0–1. */
  congestion: number;
  incidents: { minor: number; serious: number; fatal: number };
}

export interface SegmentFactors {
  accidents: number;
  roadQuality: number;
  traffic: number;
  lighting: number;
  infrastructure: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function segmentFactors(s: SegmentRiskInput): SegmentFactors {
  const weighted =
    s.incidents.minor * SEVERITY_WEIGHT.minor +
    s.incidents.serious * SEVERITY_WEIGHT.serious +
    s.incidents.fatal * SEVERITY_WEIGHT.fatal;
  const perKm = s.lengthM > 0 ? weighted / (s.lengthM / 1000) : 0;

  const base = INFRASTRUCTURE_RISK[s.roadClass] ?? 0.5;
  // A painted lane takes most of the exposure off a busy road, not all of it.
  const infrastructure = s.hasBikeLane ? base * 0.35 : base;

  return {
    accidents: clamp01(perKm / SATURATING_INCIDENTS_PER_KM),
    // Unknown surface is scored as middling rather than as good: assuming an
    // unsurveyed road is fine is exactly the optimism a risk score must avoid.
    roadQuality: s.surfaceQuality === null ? 0.5 : clamp01((5 - s.surfaceQuality) / 4),
    traffic: clamp01(s.congestion),
    lighting: s.lit ? 0 : 1,
    infrastructure: clamp01(infrastructure),
  };
}

export function classifyRisk(score: number): RiskLevel {
  if (score >= RISK_BANDS.highFrom) return 'high';
  if (score >= RISK_BANDS.mediumFrom) return 'medium';
  return 'low';
}

export function routeRisk(segments: SegmentRiskInput[]): RouteRiskDto {
  const total = segments.reduce((n, s) => n + Math.max(0, s.lengthM), 0);
  const sums: SegmentFactors = {
    accidents: 0,
    roadQuality: 0,
    traffic: 0,
    lighting: 0,
    infrastructure: 0,
  };
  let incidentCount = 0;
  let unsurveyedM = 0;

  for (const s of segments) {
    const f = segmentFactors(s);
    const w = total > 0 ? Math.max(0, s.lengthM) / total : 0;
    for (const k of Object.keys(sums) as (keyof SegmentFactors)[]) sums[k] += f[k] * w;
    incidentCount += s.incidents.minor + s.incidents.serious + s.incidents.fatal;
    if (s.surfaceQuality === null) unsurveyedM += Math.max(0, s.lengthM);
  }

  const score =
    total === 0
      ? 0
      : 100 *
        (RISK_WEIGHTS.accidents * sums.accidents +
          RISK_WEIGHTS.traffic * sums.traffic +
          RISK_WEIGHTS.infrastructure * sums.infrastructure +
          RISK_WEIGHTS.lighting * sums.lighting +
          RISK_WEIGHTS.roadQuality * sums.roadQuality);

  const pct = (v: number) => Math.round(v * 1000) / 10;
  const rounded = Math.round(score * 10) / 10;

  return {
    score: rounded,
    level: classifyRisk(rounded),
    factors: {
      accidents: pct(sums.accidents),
      roadQuality: pct(sums.roadQuality),
      traffic: pct(sums.traffic),
      lighting: pct(sums.lighting),
      infrastructure: pct(sums.infrastructure),
    },
    incidentCount,
    unsurveyedPct: total === 0 ? 0 : Math.round((unsurveyedM / total) * 1000) / 10,
  };
}
