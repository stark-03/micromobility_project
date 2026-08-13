import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import type { SegmentTrafficDto, ZoneDto } from '@mm/shared-types';
import { createAppTheme } from '../src/app/theme.ts';
import { StreetMap } from '../src/modules/live/StreetMap.tsx';

const theme = createAppTheme();

const zones: ZoneDto[] = [
  {
    id: '1',
    code: 'TLK',
    name: 'Tilakwadi',
    centroid: { type: 'Point', coordinates: [74.506, 15.8395] },
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [74.5, 15.83],
          [74.51, 15.83],
          [74.51, 15.85],
          [74.5, 15.85],
          [74.5, 15.83],
        ],
      ],
    },
    populationIx: 8.4,
  },
];

const segments: SegmentTrafficDto[] = [
  {
    segmentId: '1',
    name: 'Mahatma Phule Road',
    zoneId: '1',
    roadClass: 'arterial',
    geometry: {
      type: 'LineString',
      coordinates: [
        [74.5, 15.84],
        [74.505, 15.845],
      ],
    },
    lengthM: 700,
    speedFreeKph: 50,
    meanSpeedKph: 18,
    vehicleCount: 40,
    occupancy: 0.6,
    congestionIndex: 0.64,
    flowBand: 3,
    computedAt: '2026-08-13T12:00:00.000Z',
  },
];

/**
 * jsdom has no layout and no network, so Leaflet renders no tiles here. What
 * these assert is that the component MOUNTS and wires up without throwing —
 * the failure mode that cost three rounds with the WebGL map was a silent
 * exception during setup, not a bad pixel.
 */
describe('StreetMap', () => {
  it('mounts without throwing', () => {
    expect(() =>
      render(
        <ThemeProvider theme={theme}>
          <StreetMap zones={zones} segments={segments} />
        </ThemeProvider>,
      ),
    ).not.toThrow();
  });

  it('creates a map container for Leaflet to attach to', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <StreetMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );
    const el = container.querySelector('[data-testid="street-map"]');
    expect(el).not.toBeNull();
    // Leaflet stamps this class on a container it has initialised.
    expect(el?.className).toContain('leaflet-container');
  });

  it('keeps the OpenStreetMap attribution the ODbL licence requires', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <StreetMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );
    expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain(
      'OpenStreetMap',
    );
  });

  it('unmounts cleanly', () => {
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <StreetMap zones={zones} segments={segments} />
      </ThemeProvider>,
    );
    expect(() => unmount()).not.toThrow();
  });

  it('survives an empty city', () => {
    expect(() =>
      render(
        <ThemeProvider theme={theme}>
          <StreetMap zones={[]} segments={[]} />
        </ThemeProvider>,
      ),
    ).not.toThrow();
  });
});
