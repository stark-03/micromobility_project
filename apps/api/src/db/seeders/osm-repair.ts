import { haversineM } from '../../lib/geo.ts';
import type { OsmSegmentSeed } from './osm.ts';

/** The longest piece the first importer could have dropped. */
const DROPPED_UNDER_M = 5;

/**
 * Restores the links the first importer dropped, without re-downloading.
 *
 * Two kinds of gap, found from the segments themselves:
 *
 * - **Inside a road.** A way's pieces are numbered by where they start
 *   (`OSM-<way>-<start>`). When one piece ends at a node the next does not
 *   start at, the piece between them was dropped. Its two ends are known
 *   exactly, so the link is rebuilt exactly.
 * - **At a road's end.** A dropped first or last piece leaves a dead end a few
 *   metres from the junction it used to reach. A dead end within 5 m of
 *   another road's node, with no road between them, is reconnected.
 *
 * Bridges take the attributes, and the direction if it is one-way, of the
 * road they belong to, and carry `BRIDGE` in their ref so they can be told
 * apart and removed by a clean re-import.
 */
export function repairDroppedLinks(segments: OsmSegmentSeed[]): OsmSegmentSeed[] {
  const bridges: OsmSegmentSeed[] = [];
  const kept = segments.filter((s) => !s.externalRef.includes('BRIDGE'));

  const byWay = new Map<string, Array<{ start: number; seg: OsmSegmentSeed }>>();
  for (const seg of kept) {
    const [, way, start] = seg.externalRef.split('-');
    const list = byWay.get(way!) ?? [];
    list.push({ start: Number(start), seg });
    byWay.set(way!, list);
  }

  const pos = new Map<string, [number, number]>();
  const degree = new Map<string, number>();
  const linked = new Set<string>();
  const link = (a: string, b: string) => linked.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const seg of kept) {
    pos.set(seg.fromNode, seg.geometry[0]!);
    pos.set(seg.toNode, seg.geometry[seg.geometry.length - 1]!);
    degree.set(seg.fromNode, (degree.get(seg.fromNode) ?? 0) + 1);
    degree.set(seg.toNode, (degree.get(seg.toNode) ?? 0) + 1);
    link(seg.fromNode, seg.toNode);
  }

  const bridge = (like: OsmSegmentSeed, from: string, to: string, ref: string) => {
    const a = pos.get(from)!;
    const b = pos.get(to)!;
    link(from, to);
    bridges.push({
      ...like,
      externalRef: ref,
      fromNode: from,
      toNode: to,
      geometry: [a, b],
      lengthM: Number(Math.max(haversineM(a, b), 0.5).toFixed(2)),
    });
  };

  // Inside a road: exact.
  for (const [way, pieces] of byWay) {
    pieces.sort((x, y) => x.start - y.start);
    for (let k = 1; k < pieces.length; k++) {
      const prev = pieces[k - 1]!.seg;
      const next = pieces[k]!.seg;
      if (prev.toNode !== next.fromNode) {
        bridge(prev, prev.toNode, next.fromNode, `OSM-${way}-${pieces[k - 1]!.start}-BRIDGE`);
      }
    }
  }

  // At a road's end: a dead end a few metres from a node it is not linked to.
  const nodes = [...pos.keys()];
  for (const seg of kept) {
    for (const [end, isStart] of [
      [seg.fromNode, true],
      [seg.toNode, false],
    ] as const) {
      if ((degree.get(end) ?? 0) !== 1) continue;
      const here = pos.get(end)!;
      let best: string | null = null;
      let bestD = DROPPED_UNDER_M;
      for (const other of nodes) {
        if (other === end) continue;
        const d = haversineM(here, pos.get(other)!);
        const key = end < other ? `${end}|${other}` : `${other}|${end}`;
        if (d <= bestD && !linked.has(key)) {
          best = other;
          bestD = d;
        }
      }
      if (!best) continue;
      // A one-way road keeps its direction: its dropped start led into it,
      // its dropped end led out of it.
      const [from, to] = isStart ? [best, end] : [end, best];
      bridge(seg, from, to, `BRIDGE-${from}-${to}`);
    }
  }

  return [...kept, ...bridges];
}
