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
    expect(segments).toHaveLength(121);
  });

  it('renders every zone and every road segment', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <SvgCityMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );

    expect(container.querySelectorAll('[data-testid="zones"] path')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid="segments"] path')).toHaveLength(121);
    expect(container.querySelectorAll('[data-testid="zone-labels"] text')).toHaveLength(8);
  });

  it('keeps all 121 segments inside the viewBox', () => {
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
    expect(points).toBe(242); // 121 segments x 2 endpoints
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
