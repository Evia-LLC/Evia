/** MediaPipe supplies undirected tessellation edges, not triangle indices. */
export function surfaceTriangles(edges: Uint16Array, count: number): Uint16Array {
  const neighbours = Array.from({ length: count }, () => new Set<number>());
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const a = edges[i], b = edges[i + 1];
    if (a >= count || b >= count || a === b) continue;
    neighbours[a].add(b);
    neighbours[b].add(a);
  }
  const triangles: number[] = [];
  for (let a = 0; a < count; a++) {
    for (const b of neighbours[a]) {
      if (b <= a) continue;
      for (const c of neighbours[b]) {
        if (c > b && neighbours[a].has(c)) triangles.push(a, b, c);
      }
    }
  }
  return new Uint16Array(triangles);
}

/** Consistent normals are needed even though the source graph is undirected. */
export function faceForwardTriangles(indices: Uint16Array, positions: Float32Array): Uint16Array {
  const oriented = indices.slice();
  for (let i = 0; i < oriented.length; i += 3) {
    const a = oriented[i] * 3, b = oriented[i + 1] * 3, c = oriented[i + 2] * 3;
    const cross = (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1])
      - (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]);
    if (cross < 0) [oriented[i + 1], oriented[i + 2]] = [oriented[i + 2], oriented[i + 1]];
  }
  return oriented;
}
