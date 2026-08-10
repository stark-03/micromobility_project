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
