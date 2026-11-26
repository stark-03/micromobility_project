import { beforeEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import type L from 'leaflet';
import { createAppTheme } from '../src/app/theme.ts';
import {
  googleDirectionsLink,
  googleEmbedUrl,
  googleMapsLink,
  MapSourceFrame,
  useMapSource,
} from '../src/components/MapSource.tsx';

const theme = createAppTheme();

/** A stand-in for the Leaflet map: only the view is read. */
function fakeMap(lng: number, lat: number, zoom: number) {
  const ref = createRef<L.Map | null>() as { current: L.Map | null };
  ref.current = { getCenter: () => ({ lng, lat }), getZoom: () => zoom } as unknown as L.Map;
  return ref;
}

function frame(props: Partial<React.ComponentProps<typeof MapSourceFrame>> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MapSourceFrame map={fakeMap(74.5077, 15.8497, 14)} {...props}>
        <div>free map contents</div>
      </MapSourceFrame>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useMapSource.getState().setSource('osm');
});

describe('switching between the free map and Google', () => {
  it('starts on the free map, with the switch visible', () => {
    frame();
    expect(screen.getByText('free map contents')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Free map' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTitle('Google Maps')).toBeNull();
  });

  it('shows Google’s map of the same view, and says what it can and cannot show', () => {
    frame();
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    const iframe = screen.getByTitle('Google Maps') as HTMLIFrameElement;
    expect(iframe.src).toContain('ll=15.849700,74.507700');
    expect(iframe.src).toContain('z=14');
    expect(screen.getByText(/Routes, stations and vehicles appear on the free map/)).toBeDefined();
  });

  it('centres and pins Google on the point the screen is about', () => {
    frame({ focus: [74.52024, 15.86159], focusLabel: 'Central Bus Stand' });
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    const iframe = screen.getByTitle('Google Maps') as HTMLIFrameElement;
    expect(iframe.src).toContain('q=15.861590,74.520240');
    expect(screen.getByText(/pinned at Central Bus Stand/)).toBeDefined();
    const link = screen.getByRole('link', { name: 'Open in Google Maps' });
    expect(link.getAttribute('href')).toBe(googleMapsLink([74.52024, 15.86159]));
  });

  it('keeps the free map mounted underneath, so switching back loses nothing', () => {
    frame();
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(screen.getByText('free map contents')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Free map' }));
    expect(screen.queryByTitle('Google Maps')).toBeNull();
  });

  it('draws Google’s own route for a trip, beside our distance', () => {
    const from: [number, number] = [74.4988, 15.8451];
    const to: [number, number] = [74.5241, 15.8265];
    frame({ focus: from, trip: { from, to, ourDistanceM: 2300 } });
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    const iframe = screen.getByTitle('Google Maps') as HTMLIFrameElement;
    expect(iframe.src).toContain('saddr=15.845100,74.498800');
    expect(iframe.src).toContain('daddr=15.826500,74.524100');
    expect(screen.getByText(/Ours is 2\.30 km on the free map/)).toBeDefined();
    const link = screen.getByRole('link', { name: 'Open in Google Maps' });
    expect(link.getAttribute('href')).toBe(googleDirectionsLink(from, to));
  });

  it('remembers the choice across screens', () => {
    frame();
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(localStorage.getItem('mm.mapSource')).toBe('google');
  });
});

describe('Google URLs', () => {
  it('put latitude first, as Google expects, and keep the zoom in range', () => {
    expect(googleEmbedUrl([74.5, 15.85], 25, false)).toContain('ll=15.850000,74.500000&z=20');
    expect(googleMapsLink([74.5, 15.85])).toBe(
      'https://www.google.com/maps/search/?api=1&query=15.850000,74.500000',
    );
  });
});
