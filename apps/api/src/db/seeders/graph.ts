/**
 * Union-find over segment endpoints.
 *
 * A disconnected road graph would silently break A* in Sprint 3, and the
 * failure would surface as a routing bug rather than a data bug. The seed
 * refuses to insert one.
 */
export function assertConnected(edges: Array<[string, string]>): void {
  if (edges.length === 0) throw new Error('Road graph has no edges');

  const parent = new Map<string, string>();

  // Iterative find with path compression — a recursive version would overflow
  // the stack on a long chain, and this runs over the whole seeded graph.
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const add = (n: string): void => {
    if (!parent.has(n)) parent.set(n, n);
  };

  for (const [a, b] of edges) {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const roots = new Set<string>();
  for (const node of parent.keys()) roots.add(find(node));

  if (roots.size !== 1) {
    throw new Error(
      `Road graph is not connected: ${roots.size} components across ${parent.size} nodes`,
    );
  }
}
