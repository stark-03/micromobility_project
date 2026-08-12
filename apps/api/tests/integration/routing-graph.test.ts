import { describe, expect, it } from 'vitest';
import { loadGraph } from '../../src/modules/routes/service.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { runSeed } from '../../src/db/seeders/index.ts';

useCleanDatabase();

/**
 * The graph Express hands the ML service. Tested here rather than through the
 * router because it needs no Python process running — the search itself is
 * covered by apps/ml/tests.
 */
describe('routing graph', () => {
  it('exposes every seeded segment with the fields A* needs', async () => {
    await runSeed({ quiet: true });
    const edges = await loadGraph();

    expect(edges.length).toBeGreaterThan(100);
    for (const e of edges.slice(0, 20)) {
      expect(e.fromNode).toBeTruthy();
      expect(e.toNode).toBeTruthy();
      expect(e.lengthM).toBeGreaterThan(0);
      expect(e.speedFreeKph).toBeGreaterThan(0);
      expect(e.geometry.length).toBeGreaterThanOrEqual(2);
    }
  }, 120_000);

  it('derives a safety score that actually varies between roads', async () => {
    await runSeed({ quiet: true });
    const edges = await loadGraph();
    const scores = edges.map((e) => e.safetyScore);

    // A constant score makes the `safest` profile mathematically identical to
    // `fastest` — the safety term just scales distance and cannot change which
    // route wins. That was a real bug; this is the regression test.
    expect(new Set(scores).size).toBeGreaterThan(3);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...scores)).toBeLessThanOrEqual(100);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(15);
  }, 120_000);

  it('rates a lit cycleway safer than a fast unlit arterial', async () => {
    await runSeed({ quiet: true });
    const edges = await loadGraph();
    const cycleways = edges.filter((e) => e.roadClass === 'cycleway');
    const arterials = edges.filter((e) => e.roadClass === 'arterial');

    if (cycleways.length > 0 && arterials.length > 0) {
      const meanCycleway = cycleways.reduce((n, e) => n + e.safetyScore, 0) / cycleways.length;
      const meanArterial = arterials.reduce((n, e) => n + e.safetyScore, 0) / arterials.length;
      expect(meanCycleway).toBeGreaterThan(meanArterial);
    }
  }, 120_000);
});
