/**
 * Reads a design token at runtime.
 *
 * MapLibre's style spec takes concrete colour strings — it cannot resolve a
 * `var(--flow-2)`. Rather than hardcoding hex in the map layer (which would
 * break the "tokens.css is the single source of truth" rule), we read the
 * computed value out of the stylesheet. Change tokens.css and the map follows.
 */
export function token(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`Design token "${name}" is not defined in tokens.css`);
  return value;
}

/** The congestion ramp, free → jammed. RESERVED for congestion (design.md §6.2). */
export function flowRamp(): [string, string, string, string, string] {
  return [
    token('--flow-0'),
    token('--flow-1'),
    token('--flow-2'),
    token('--flow-3'),
    token('--flow-4'),
  ];
}

export const FLOW_LABELS = ['Free', 'Light', 'Moderate', 'Heavy', 'Jammed'] as const;

/**
 * Chart series colours.
 *
 * Deliberately NOT the --line-* mode colours or the --flow-* ramp. The mode
 * accents sit outside the lightness band a chart surface needs, and the flow
 * ramp is reserved for congestion — it also fails a categorical check outright:
 * flow-1 and flow-2 differ by only dE 0.8 under deuteranopia.
 *
 * This pair is validated: CVD dE 29.3, normal-vision 30.3, contrast >= 3:1.
 * A third series must be validated, not guessed.
 */
export function seriesColours(): [string, string] {
  return [token('--series-1'), token('--series-2')];
}
