import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import type { SegmentTrafficDto, ZoneDto } from '@mm/shared-types';
import { createAppTheme } from '../src/app/theme.ts';
import { SvgCityMap } from '../src/modules/live/SvgCityMap.tsx';

const theme = createAppTheme();

/** Real Belagavi coordinates, same shape the API returns. */
const zone = (id: string, name: string, lng: number, lat: number): ZoneDto => ({
  id,
  code: name.slice(0, 3).toUpperCase(),
  name,
  centroid: { type: 'Point', coordinates: [lng, lat] },
  boundary: {
    type: 'Polygon',
    coordinates: [
      [
        [lng - 0.008, lat - 0.008],
        [lng + 0.008, lat - 0.008],
        [lng + 0.008, lat + 0.008],
        [lng - 0.008, lat + 0.008],
        [lng - 0.008, lat - 0.008],
      ],
    ],
  },
  populationIx: 7,
});

const segment = (
  id: string,
  a: [number, number],
  b: [number, number],
  flowBand: 0 | 1 | 2 | 3 | 4,
  measured = true,
): SegmentTrafficDto => ({
  segmentId: id,
  name: `Road ${id}`,
  zoneId: '1',
  roadClass: 'arterial',
  geometry: { type: 'LineString', coordinates: [a, b] },
  lengthM: 900,
  speedFreeKph: 50,
  meanSpeedKph: 20,
  vehicleCount: 30,
  occupancy: 0.5,
  congestionIndex: flowBand / 4,
  flowBand,
  computedAt: measured ? '2026-08-10T12:00:00.000Z' : null,
});

const ZONES = [
  zone('1', 'Tilakwadi', 74.506, 15.8395),
  zone('2', 'Camp', 74.51, 15.86),
];

const SEGMENTS = [
  segment('1', [74.5, 15.83], [74.51, 15.84], 0),
  segment('2', [74.51, 15.84], [74.52, 15.85], 2),
  segment('3', [74.52, 15.85], [74.53, 15.86], 4),
  segment('4', [74.5, 15.85], [74.51, 15.86], 1, false),
];

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);
}

/**
 * These assertions are the whole point of choosing SVG over WebGL: a canvas
 * map can only be verified by looking at it, which is exactly what went wrong
 * for two rounds. Every one of these would have caught a blank map.
 */
describe('SvgCityMap', () => {
  it('renders one path per segment and per zone', () => {
    const { container } = wrap(<SvgCityMap zones={ZONES} segments={SEGMENTS} />);

    expect(container.querySelectorAll('[data-testid="segments"] path')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="zones"] path')).toHaveLength(2);
  });

  it('gives every segment a non-empty geometry', () => {
    // A path with an empty `d` renders nothing — a blank map that passes a
    // naive "the element exists" check.
    const { container } = wrap(<SvgCityMap zones={ZONES} segments={SEGMENTS} />);
    for (const p of container.querySelectorAll('[data-testid="segments"] path')) {
      expect(p.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+/);
    }
  });

  it('projects coordinates inside the viewBox', () => {
    // Off-canvas geometry is the other way to draw nothing at all.
    const { container } = wrap(<SvgCityMap zones={ZONES} segments={SEGMENTS} />);
    const d = container.querySelector('[data-testid="segments"] path')!.getAttribute('d')!;
    for (const [, x, y] of d.matchAll(/([\d.]+),([\d.]+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(1000);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(700);
    }
  });

  it('colours segments by flow band, and unmeasured ones grey', () => {
    const { container } = wrap(<SvgCityMap zones={ZONES} segments={SEGMENTS} />);
    const paths = [...container.querySelectorAll('[data-testid="segments"] path')];
    const strokes = paths.map((p) => p.getAttribute('stroke'));

    // Free flow and jammed must not be the same colour.
    expect(strokes[0]).not.toBe(strokes[2]);
    // The unmeasured segment is grey, never green — "no data" must not read
    // as "clear".
    expect(strokes[3]).toBe('#223052');
    expect(new Set(strokes).size).toBeGreaterThanOrEqual(3);
  });

  it('labels each zone', () => {
    wrap(<SvgCityMap zones={ZONES} segments={SEGMENTS} />);
    expect(screen.getByText('TILAKWADI')).toBeDefined();
    expect(screen.getByText('CAMP')).toBeDefined();
  });

  it('selects a segment on click', () => {
    const onSelect = vi.fn();
    const { container } = wrap(
      <SvgCityMap zones={ZONES} segments={SEGMENTS} onSelectSegment={onSelect} />,
    );
    fireEvent.click(container.querySelector('[data-segment-id="2"]')!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ segmentId: '2' }));
  });

  it('thickens the selected segment so the choice is visible', () => {
    const { container } = wrap(
      <SvgCityMap zones={ZONES} segments={SEGMENTS} selectedId="2" />,
    );
    const selected = container.querySelector('[data-segment-id="2"]')!;
    const other = container.querySelector('[data-segment-id="1"]')!;
    expect(Number(selected.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(other.getAttribute('stroke-width')),
    );
  });

  it('renders without crashing when there is nothing to draw', () => {
    const { container } = wrap(<SvgCityMap zones={[]} segments={[]} />);
    expect(container.querySelector('[data-testid="svg-city-map"]')).toBeDefined();
  });

  it('describes itself for screen readers', () => {
    wrap(<SvgCityMap zones={ZONES} segments={SEGMENTS} />);
    expect(screen.getByLabelText(/4 road segments across 2 zones/)).toBeDefined();
  });
});
