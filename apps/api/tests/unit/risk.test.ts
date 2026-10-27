import { describe, expect, it } from 'vitest';
import { classifyRisk, routeRisk, segmentFactors } from '../../src/modules/safety/risk.ts';
import type { SegmentRiskInput } from '../../src/modules/safety/risk.ts';

const none = { minor: 0, serious: 0, fatal: 0 };

function seg(overrides: Partial<SegmentRiskInput> = {}): SegmentRiskInput {
  return {
    lengthM: 500,
    roadClass: 'local',
    hasBikeLane: false,
    lit: true,
    surfaceQuality: 4,
    congestion: 0.2,
    incidents: none,
    ...overrides,
  };
}

describe('classifyRisk', () => {
  it('bands scores into low, medium and high', () => {
    expect(classifyRisk(0)).toBe('low');
    expect(classifyRisk(34.9)).toBe('low');
    expect(classifyRisk(35)).toBe('medium');
    expect(classifyRisk(59.9)).toBe('medium');
    expect(classifyRisk(60)).toBe('high');
    expect(classifyRisk(100)).toBe('high');
  });
});

describe('segmentFactors', () => {
  it('scores each input in the direction a rider would expect', () => {
    const safe = segmentFactors(
      seg({ roadClass: 'cycleway', lit: true, surfaceQuality: 5, congestion: 0 }),
    );
    const risky = segmentFactors(
      seg({
        roadClass: 'arterial',
        lit: false,
        surfaceQuality: 1,
        congestion: 0.9,
        incidents: { minor: 2, serious: 1, fatal: 0 },
      }),
    );
    for (const k of Object.keys(safe) as (keyof typeof safe)[]) {
      expect(risky[k]).toBeGreaterThan(safe[k]);
    }
  });

  it('weighs a fatal accident far above a minor one', () => {
    // A long segment, so neither case reaches the saturation cap.
    const minor = segmentFactors(
      seg({ lengthM: 5000, incidents: { minor: 1, serious: 0, fatal: 0 } }),
    );
    const fatal = segmentFactors(
      seg({ lengthM: 5000, incidents: { minor: 0, serious: 0, fatal: 1 } }),
    );
    expect(fatal.accidents).toBeGreaterThan(minor.accidents * 5);
  });

  it('counts a bike lane as removing most, not all, of a busy road’s exposure', () => {
    const bare = segmentFactors(seg({ roadClass: 'arterial' })).infrastructure;
    const laned = segmentFactors(seg({ roadClass: 'arterial', hasBikeLane: true })).infrastructure;
    expect(laned).toBeLessThan(bare / 2);
    expect(laned).toBeGreaterThan(0);
  });

  it('treats an unsurveyed surface as unknown, not as good', () => {
    expect(segmentFactors(seg({ surfaceQuality: null })).roadQuality).toBe(0.5);
  });
});

describe('routeRisk', () => {
  it('weights segments by length', () => {
    // 50 m of dark arterial in 2 km of lit cycleway barely moves the score;
    // 2 km of it dominates.
    const short = routeRisk([
      seg({ lengthM: 2000, roadClass: 'cycleway' }),
      seg({ lengthM: 50, roadClass: 'arterial', lit: false }),
    ]);
    const long = routeRisk([
      seg({ lengthM: 50, roadClass: 'cycleway' }),
      seg({ lengthM: 2000, roadClass: 'arterial', lit: false }),
    ]);
    expect(long.score).toBeGreaterThan(short.score + 20);
  });

  it('classifies a quiet lit cycleway as low and a dark, crash-prone arterial as high', () => {
    expect(
      routeRisk([seg({ roadClass: 'cycleway', congestion: 0, surfaceQuality: 5 })]).level,
    ).toBe('low');
    expect(
      routeRisk([
        seg({
          roadClass: 'arterial',
          lit: false,
          surfaceQuality: 1,
          congestion: 0.8,
          incidents: { minor: 3, serious: 1, fatal: 0 },
        }),
      ]).level,
    ).toBe('high');
  });

  it('reports incidents and unsurveyed share alongside the score', () => {
    const r = routeRisk([
      seg({ lengthM: 300, surfaceQuality: null, incidents: { minor: 2, serious: 1, fatal: 0 } }),
      seg({ lengthM: 700 }),
    ]);
    expect(r.incidentCount).toBe(3);
    expect(r.unsurveyedPct).toBe(30);
  });

  it('is zero for an empty route rather than NaN', () => {
    expect(routeRisk([]).score).toBe(0);
  });
});
