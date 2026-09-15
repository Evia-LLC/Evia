/**
 * Two scans, one face.
 *
 * Every scan now carries the face mesh it was measured with - 478 points in
 * the crop's own frame - which makes a later capture warpable onto an earlier
 * one: each triangle of the later mesh is drawn into the place the same
 * triangle occupies in the earlier mesh. The result is two photographs of the
 * same face in the same pose at the same size, so a wipe between them shows
 * the skin changing and not the camera moving.
 *
 * The triangulation is computed here rather than shipped: a Delaunay
 * triangulation of the reference mesh (Bowyer-Watson, a few hundred points,
 * a few milliseconds) gives a mesh with no long thin triangles, which is what
 * keeps the warp from smearing.
 */

export interface Point {
  x: number;
  y: number;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
  cx: number;
  cy: number;
  r2: number;
}

function circumcircle(p: Point[], a: number, b: number, c: number): Triangle | null {
  const ax = p[a].x, ay = p[a].y;
  const bx = p[b].x, by = p[b].y;
  const cx = p[c].x, cy = p[c].y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const dx = ax - ux, dy = ay - uy;
  return { a, b, c, cx: ux, cy: uy, r2: dx * dx + dy * dy };
}

/** Delaunay triangulation of `points`, as index triples. */
export function triangulate(points: Point[]): number[] {
  const n = points.length;
  if (n < 3) return [];
  // A super triangle far outside the data.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const all: Point[] = [
    ...points,
    { x: mx - 20 * span, y: my - span },
    { x: mx, y: my + 20 * span },
    { x: mx + 20 * span, y: my - span },
  ];
  const s0 = n, s1 = n + 1, s2 = n + 2;
  let triangles: Triangle[] = [];
  const first = circumcircle(all, s0, s1, s2);
  if (first) triangles.push(first);

  for (let i = 0; i < n; i++) {
    const px = all[i].x, py = all[i].y;
    const bad: Triangle[] = [];
    const keep: Triangle[] = [];
    for (const t of triangles) {
      const dx = px - t.cx, dy = py - t.cy;
      if (dx * dx + dy * dy < t.r2) bad.push(t);
      else keep.push(t);
    }
    // The boundary of the hole: edges of bad triangles not shared by two of them.
    const edges = new Map<string, [number, number]>();
    const seen = new Map<string, number>();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as Array<[number, number]>) {
        const key = u < v ? `${u}-${v}` : `${v}-${u}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        edges.set(key, [u, v]);
      }
    }
    triangles = keep;
    for (const [key, [u, v]] of edges) {
      if (seen.get(key) !== 1) continue;
      const t = circumcircle(all, u, v, i);
      if (t) triangles.push(t);
    }
  }

  const out: number[] = [];
  for (const t of triangles) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    out.push(t.a, t.b, t.c);
  }
  return out;
}

/** Flattened (x, y) pairs to points, scaled to a pixel size. */
export function toPoints(flat: number[], width: number, height: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ x: flat[i] * width, y: flat[i + 1] * height });
  }
  return out;
}

/**
 * Draws `source` onto `ctx` with each triangle of `from` moved to `to`.
 *
 * Per triangle: clip to the destination triangle, set the affine transform
 * that carries the source triangle onto it, draw the whole image. A few
 * hundred small draws, which a 2D canvas does in a frame or two.
 */
export function warp(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  from: Point[],
  to: Point[],
  triangles: number[],
): void {
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
    const s0 = from[a], s1 = from[b], s2 = from[c];
    const d0 = to[a], d1 = to[b], d2 = to[c];
    if (!s0 || !s1 || !s2 || !d0 || !d1 || !d2) continue;

    // Solve the affine map M with M(s_k) = d_k.
    const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(det) < 1e-6) continue;
    const m11 = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det;
    const m12 = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
    const m21 = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det;
    const m22 = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
    const tx = d0.x - m11 * s0.x - m12 * s0.y;
    const ty = d0.y - m21 * s0.x - m22 * s0.y;

    ctx.save();
    ctx.beginPath();
    // A hair of overlap so the seams between triangles do not show as a grid.
    const gx = (d0.x + d1.x + d2.x) / 3, gy = (d0.y + d1.y + d2.y) / 3;
    const grow = (p: Point): Point => ({ x: p.x + Math.sign(p.x - gx) * 0.6, y: p.y + Math.sign(p.y - gy) * 0.6 });
    const e0 = grow(d0), e1 = grow(d1), e2 = grow(d2);
    ctx.moveTo(e0.x, e0.y);
    ctx.lineTo(e1.x, e1.y);
    ctx.lineTo(e2.x, e2.y);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m11, m21, m12, m22, tx, ty);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
}

/**
 * The later scan, drawn in the earlier scan's frame.
 *
 * Both meshes are in their own crop's normalised frame; the output is the
 * size of the reference image. Points outside the face are left to the
 * super-triangulation's outer triangles, which cover the background well
 * enough for a wipe.
 */
export function alignTo(
  reference: HTMLImageElement,
  referenceMesh: number[],
  other: HTMLImageElement,
  otherMesh: number[],
): HTMLCanvasElement {
  const width = reference.naturalWidth;
  const height = reference.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const to = toPoints(referenceMesh, width, height);
  const from = toPoints(otherMesh, other.naturalWidth, other.naturalHeight);
  const count = Math.min(to.length, from.length);
  const toPts = to.slice(0, count);
  const fromPts = from.slice(0, count);

  // The frame corners, so the background warps gently rather than tearing.
  const corners = (w: number, h: number): Point[] => [
    { x: 0, y: 0 }, { x: w / 2, y: 0 }, { x: w, y: 0 },
    { x: 0, y: h / 2 }, { x: w, y: h / 2 },
    { x: 0, y: h }, { x: w / 2, y: h }, { x: w, y: h },
  ];
  toPts.push(...corners(width, height));
  fromPts.push(...corners(other.naturalWidth, other.naturalHeight));

  const triangles = triangulate(toPts);
  // The unwarped image underneath, so any triangle the mesh misses still has pixels.
  ctx.drawImage(other, 0, 0, width, height);
  warp(ctx, other, fromPts, toPts, triangles);
  return canvas;
}
