/**
 * jsdom does not load the app's real stylesheet, so `getComputedStyle` would
 * return empty strings for every design token and createAppTheme() would throw.
 *
 * Injecting tokens.css verbatim keeps these tests honest: the theme is built
 * from the SAME values the browser uses, so a token that MUI cannot parse fails
 * here exactly as it would fail on screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, '../src/styles/tokens.css'), 'utf8');

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

/**
 * testing-library only auto-cleans when a global afterEach exists. Without
 * this, `screen` queries see every previous test's DOM still mounted, and
 * getByRole starts failing with "found multiple elements" — a confusing
 * symptom with nothing to do with the component under test.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * jsdom implements neither ResizeObserver nor matchMedia. Both are baseline in
 * every browser this app targets, so stubbing them keeps the tests
 * representative rather than papering over a real gap.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

globalThis.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof globalThis.matchMedia;

/**
 * jsdom implements no canvas 2D context, and Leaflet's canvas renderer calls
 * into one the moment a map is created. Real browsers all have it; this stub
 * keeps the tests representative rather than forcing the component to avoid
 * `preferCanvas`, which is what makes it fast with ~1,700 polylines.
 */
const noop = () => undefined;
const context2d = {
  canvas: null as unknown,
  save: noop, restore: noop, scale: noop, rotate: noop, translate: noop,
  transform: noop, setTransform: noop, resetTransform: noop,
  clearRect: noop, fillRect: noop, strokeRect: noop,
  beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
  bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop, arcTo: noop, rect: noop,
  fill: noop, stroke: noop, clip: noop, isPointInPath: () => false,
  isPointInStroke: () => false,
  measureText: () => ({ width: 0 }),
  fillText: noop, strokeText: noop,
  drawImage: noop,
  createLinearGradient: () => ({ addColorStop: noop }),
  createPattern: () => null,
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop,
  setLineDash: noop, getLineDash: () => [],
  globalAlpha: 1, globalCompositeOperation: 'source-over',
  lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
  strokeStyle: '#000', fillStyle: '#000', font: '10px sans-serif',
};

HTMLCanvasElement.prototype.getContext = function getContext(kind: string) {
  return kind === '2d' ? (context2d as unknown as CanvasRenderingContext2D) : null;
} as HTMLCanvasElement['getContext'];
