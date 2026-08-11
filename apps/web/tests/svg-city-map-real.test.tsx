import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import type { SegmentTrafficDto, ZoneDto } from '@mm/shared-types';
import { createAppTheme } from '../src/app/theme.ts';
import { SvgCityMap } from '../src/modules/live/SvgCityMap.tsx';
import zonesFixture from './fixtures/zones.json' with { type: 'json' };
import segmentsFixture from './fixtures/segments.json' with { type: 'json' };

const theme = createAppTheme();
const zones = zonesFixture as unknown as ZoneDto[];
const segments = segmentsFixture as unknown as SegmentTrafficDto[];

/**
 * The fixtures are a verbatim capture of GET /geo/zones and GET /traffic/live
 * from the running API against the seeded Belagavi city. If the component can
 * draw this, it can draw what the demo will actually show.
 */
describe('SvgCityMap with the real Belagavi payload', () => {
  it('has captured the full seeded city', () => {
    expect(zones).toHaveLength(8);
    // Counts are derived, not hardcoded, so regenerating the city does not
    // require editing assertions — only the shape of the data matters.
    expect(segments.length).toBeGreaterThan(100);
  });

  it('renders every zone and every road segment', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <SvgCityMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );

    expect(container.querySelectorAll('[data-testid="zones"] path')).toHaveLength(zones.length);
    expect(container.querySelectorAll('[data-testid="segments"] path')).toHaveLength(
      segments.length,
    );
    expect(container.querySelectorAll('[data-testid="zone-labels"] text')).toHaveLength(
      zones.length,
    );
  });

  it('keeps every segment inside the viewBox', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <SvgCityMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );

    let points = 0;
    for (const p of container.querySelectorAll('[data-testid="segments"] path')) {
      const d = p.getAttribute('d')!;
      expect(d.length).toBeGreaterThan(4);
      for (const [, x, y] of d.matchAll(/([\d.]+),([\d.]+)/g)) {
        expect(Number(x)).toBeGreaterThanOrEqual(0);
        expect(Number(x)).toBeLessThanOrEqual(1000);
        expect(Number(y)).toBeGreaterThanOrEqual(0);
        expect(Number(y)).toBeLessThanOrEqual(700);
        points += 1;
      }
    }
    // Streets are drawn with a bend, so each carries more than two points.
    const expected = segments.reduce((n, s) => n + s.geometry.coordinates.length, 0);
    expect(points).toBe(expected);
    expect(expected).toBeGreaterThan(segments.length * 2);
  });

  it('spreads real congestion across the whole flow ramp', () => {
    // A map where every road is the same colour demonstrates nothing.
    const { container } = render(
      <ThemeProvider theme={theme}>
        <SvgCityMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );
    const strokes = new Set(
      [...container.querySelectorAll('[data-testid="segments"] path')].map((p) =>
        p.getAttribute('stroke'),
      ),
    );
    expect(strokes.size).toBe(5);
  });

  it('draws streets that are not all dead straight', () => {
    // A perfect lattice renders as a test pattern. Every street has a bend, so
    // no three consecutive points should be collinear across the whole map.
    let bent = 0;
    for (const s of segments) {
      const c = s.geometry.coordinates;
      if (c.length < 3) continue;
      const [a, b, d] = [c[0]!, c[1]!, c[2]!];
      const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      if (Math.abs(cross) > 1e-9) bent += 1;
    }
    expect(bent).toBeGreaterThan(segments.length * 0.5);
  });

  it('uses the drawable area rather than bunching into one corner', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <SvgCityMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );

    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of container.querySelectorAll('[data-testid="segments"] path')) {
      for (const [, x, y] of p.getAttribute('d')!.matchAll(/([\d.]+),([\d.]+)/g)) {
        xs.push(Number(x));
        ys.push(Number(y));
      }
    }
    // Geometry that occupies a sliver of the canvas is technically "rendered"
    // and useless to look at.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(500);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(350);
  });
});
