import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { CityMap } from '../src/modules/live/CityMap.tsx';

const theme = createAppTheme();

/**
 * jsdom gives the container no measurable size and no WebGL — the same
 * conditions that produced a permanently blank map in the browser.
 *
 * This test caught the real bug: MapLibre constructed fine, then ScaleControl
 * threw while being added, and because the controls were added BEFORE
 * `m.on('load')` was registered, the exception aborted the effect. No sources,
 * no layers, no error visible to the user — just a void behind one console
 * message. Controls are now added inside the load handler and wrapped, so
 * nothing can cost us the layers.
 *
 * A blank map with a silent console error is the most confusing failure this
 * screen can have: it looks exactly like "no data".
 */
describe('CityMap', () => {
  it('mounts without throwing even when the map cannot be measured', () => {
    expect(() =>
      render(
        <ThemeProvider theme={theme}>
          <CityMap zones={[]} segments={[]} basemap={false} />
        </ThemeProvider>,
      ),
    ).not.toThrow();
  });

  it('renders a container that fills its positioned parent', () => {
    // `height: 100%` inside a flex item silently collapses to zero; filling a
    // positioned parent is what guarantees the canvas has somewhere to draw.
    const { container } = render(
      <ThemeProvider theme={theme}>
        <CityMap zones={[]} segments={[]} basemap={false} />
      </ThemeProvider>,
    );
    const el = container.querySelector('div > div');
    expect(el?.className).toContain('absolute');
    expect(el?.className).toContain('inset-0');
  });
});
