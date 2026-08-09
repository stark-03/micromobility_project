import { describe, expect, it } from 'vitest';
import { assertConnected } from '../../src/db/seeders/graph.ts';

describe('assertConnected', () => {
  it('accepts a single connected component', () => {
    expect(() =>
      assertConnected([
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
      ]),
    ).not.toThrow();
  });

  it('accepts a component with cycles', () => {
    expect(() =>
      assertConnected([
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ]),
    ).not.toThrow();
  });

  it('rejects a split graph and names the component count', () => {
    expect(() =>
      assertConnected([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toThrow(/2 components/);
  });

  it('rejects an isolated node hanging off an otherwise connected graph', () => {
    expect(() =>
      assertConnected([
        ['a', 'b'],
        ['b', 'c'],
        ['x', 'y'],
      ]),
    ).toThrow(/2 components/);
  });

  it('rejects an empty edge list', () => {
    expect(() => assertConnected([])).toThrow(/no edges/i);
  });

  it('handles a long chain without blowing the stack', () => {
    const edges: Array<[string, string]> = [];
    for (let i = 0; i < 10_000; i++) edges.push([`n${i}`, `n${i + 1}`]);
    expect(() => assertConnected(edges)).not.toThrow();
  });
});
