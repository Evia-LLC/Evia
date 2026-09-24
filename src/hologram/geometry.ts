/**
 * The arithmetic that turns a captured face mesh into things to draw.
 *
 * Everything here is plain typed arrays, no three.js and no DOM, so it can be
 * unit-tested and so the renderer stays a thin layer over it. The input is the
 * `ScanMesh` the capture hands over (478 MediaPipe landmarks and the edge lists
 * that come with them); the output is a closed-up triangle surface with
 * normals and a few per-vertex channels the shaders use, the silhouette loop,
 * and the dense dot lattice laid over that surface.
 *
 * Nothing is invented about the face: every position is a landmark or a blend
 * of landmarks. The only added vertices are the centres of the eye and mouth
 * openings, which are filled so the surface has no see-through holes. The head
 * shell (`buildCraniumShell`) is separate, smooth decoration hung off the
 * face's edge, and is drawn so it cannot be mistaken for measured skin.
 */
import { normaliseMesh, type ScanMesh } from '@/scan/mesh.ts';

/** A mesh placed in hologram world units (reference pixels, y up, z toward the viewer). */
export interface FaceSurface {
  /** Vertex count, including the hole-filling centres appended after the landmarks. */
  vertexCount: number;
  /** How many of those are landmarks (the rest are hole centres). */
  landmarkCount: number;
  positions: Float32Array;
  normals: Float32Array;
  /** Frontal texture coordinates, 0..1 over the face's bounding box (v up). */
  uvs: Float32Array;
  /** 0 on the outer silhouette, rising to 1 two rings of triangles in. */
  edge: Float32Array;
  /** 1 at the centre of an eye opening, fading to 0 on its rim. */
  eye: Float32Array;
  /** 1 at the centre of the mouth opening, fading to 0 on its rim. */
  mouth: Float32Array;
  /** How far a vertex sits below its neighbours (eye sockets, the sides of the nose), 0..1. */
  cavity: Float32Array;
  /** Triangles, counter-clockwise seen from the viewer. */
  indices: Uint32Array;
  /** The outer silhouette as an ordered vertex loop. */
  oval: number[];
  /** Face bounding box in world units, before any motion. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

/** Where the face goes: its centre and its height, in world units. */
export interface FaceSlot {
  cx: number;
  cy: number;
  height: number;
}

const key = (a: number, b: number): number => (a < b ? a * 65536 + b : b * 65536 + a);

/**
 * Triangles from the landmark tessellation.
 *
 * MediaPipe lists its tessellation as edges, three per triangle in order
 * (a-b, b-c, c-a). When the list chains like that the triangles are read off
 * directly. When it does not (a different runtime, a reordered list), every
 * triple of mutually connected vertices is taken instead, which on a surface
 * triangulation is the same set bar the odd spurious triple.
 */
export function trianglesFromEdges(edges: ArrayLike<number>, vertexCount: number): Uint32Array {
  const groups = Math.floor(edges.length / 6);
  const chained: number[] = [];
  let bad = 0;
  for (let g = 0; g < groups; g++) {
    const o = g * 6;
    const a = edges[o], b = edges[o + 1], c = edges[o + 3];
    if (edges[o + 2] === b && edges[o + 4] === c && edges[o + 5] === a && a !== b && b !== c && a !== c) {
      chained.push(a, b, c);
    } else {
      bad++;
    }
  }
  if (groups > 0 && bad / groups < 0.05) return Uint32Array.from(chained);

  // Fallback: 3-cliques of the edge graph.
  const adj: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const a = edges[i], b = edges[i + 1];
    if (a === b || a >= vertexCount || b >= vertexCount) continue;
    adj[a].add(b);
    adj[b].add(a);
  }
  const out: number[] = [];
  for (let a = 0; a < vertexCount; a++) {
    for (const b of adj[a]) {
      if (b <= a) continue;
      for (const c of adj[b]) {
        if (c <= b) continue;
        if (adj[a].has(c)) out.push(a, b, c);
      }
    }
  }
  return Uint32Array.from(out);
}

/**
 * Boundary loops of a triangle set: edges used by exactly one triangle,
 * chained into closed vertex loops, longest first.
 */
export function boundaryLoops(indices: ArrayLike<number>): number[][] {
  const count = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = key(indices[t + e], indices[t + ((e + 1) % 3)]);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const next = new Map<number, number[]>();
  for (const [k, n] of count) {
    if (n !== 1) continue;
    const a = Math.floor(k / 65536), b = k % 65536;
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    (next.get(b) ?? next.set(b, []).get(b)!).push(a);
  }
  const seen = new Set<number>();
  const loops: number[][] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [start];
    seen.add(start);
    let cur = start;
    for (;;) {
      const nx = next.get(cur)!.find((v) => !seen.has(v));
      if (nx === undefined) break;
      loop.push(nx);
      seen.add(nx);
      cur = nx;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops.sort((a, b) => b.length - a.length);
}

/**
 * Builds the drawable surface: the landmarks placed in the slot, the
 * tessellation turned into triangles, the eye and mouth openings closed with a
 * fan around their centre, and the per-vertex channels the shaders read.
 */
export function buildFaceSurface(mesh: ScanMesh, slot: FaceSlot): FaceSurface {
  const norm = normaliseMesh(mesh);
  const n = mesh.count;
  const tri = trianglesFromEdges(mesh.tessellation, n);
  const loops = boundaryLoops(tri);
  const oval = loops[0] ?? [];
  const holes = loops.slice(1);

  // Place the landmarks: face height one becomes slot.height reference px.
  const total = n + holes.length;
  const pos = new Float32Array(total * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = slot.cx + norm[i * 3] * slot.height;
    pos[i * 3 + 1] = -slot.cy + norm[i * 3 + 1] * slot.height;
    pos[i * 3 + 2] = norm[i * 3 + 2] * slot.height;
  }

  // Which vertices the tessellation actually uses (the iris points are not in it).
  const used = new Uint8Array(total);
  for (let i = 0; i < tri.length; i++) used[tri[i]] = 1;

  // Close each hole with a fan around its centroid.
  const eye = new Float32Array(total);
  const mouth = new Float32Array(total);
  const all: number[] = Array.from(tri);
  holes.forEach((loop, h) => {
    const c = n + h;
    let x = 0, y = 0, z = 0;
    for (const v of loop) {
      x += pos[v * 3];
      y += pos[v * 3 + 1];
      z += pos[v * 3 + 2];
    }
    pos[c * 3] = x / loop.length;
    pos[c * 3 + 1] = y / loop.length;
    pos[c * 3 + 2] = z / loop.length - slot.height * 0.01;
    used[c] = 1;
    for (let i = 0; i < loop.length; i++) all.push(c, loop[i], loop[(i + 1) % loop.length]);
  });
  // The mouth is the opening whose centre sits lowest; the others are the eyes.
  const holeCentres = holes.map((_, h) => n + h);
  if (holeCentres.length) {
    const lowest = holeCentres.reduce((a, b) => (pos[a * 3 + 1] < pos[b * 3 + 1] ? a : b));
    for (const c of holeCentres) (c === lowest && holeCentres.length > 1 ? mouth : eye)[c] = 1;
  }

  const indices = Uint32Array.from(all);
  orientTowardViewer(indices, pos);
  const normals = vertexNormals(indices, pos, total);

  // Bounds and frontal UVs.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < total; i++) {
    if (!used[i]) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const uvs = new Float32Array(total * 2);
  for (let i = 0; i < total; i++) {
    uvs[i * 2] = (pos[i * 3] - minX) / Math.max(1e-6, maxX - minX);
    uvs[i * 2 + 1] = (pos[i * 3 + 1] - minY) / Math.max(1e-6, maxY - minY);
  }

  // Neighbours, for the silhouette distance and the cavity term.
  const nbrs: Set<number>[] = Array.from({ length: total }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    nbrs[a].add(b).add(c);
    nbrs[b].add(a).add(c);
    nbrs[c].add(a).add(b);
  }

  // Hop distance from the silhouette, 0 on it, 1 at two hops or more.
  const hops = new Float32Array(total).fill(Infinity);
  let frontier = oval.slice();
  for (const v of frontier) hops[v] = 0;
  for (let d = 1; d <= 3 && frontier.length; d++) {
    const nextF: number[] = [];
    for (const v of frontier) {
      for (const w of nbrs[v]) {
        if (hops[w] === Infinity) {
          hops[w] = d;
          nextF.push(w);
        }
      }
    }
    frontier = nextF;
  }
  const edge = new Float32Array(total);
  for (let i = 0; i < total; i++) edge[i] = Math.min(1, hops[i] / 2);

  // Cavity: how far a vertex sits behind the mean of its ring, in face heights.
  const cavity = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    if (!nbrs[i].size) continue;
    let z = 0;
    for (const w of nbrs[i]) z += pos[w * 3 + 2];
    const d = (z / nbrs[i].size - pos[i * 3 + 2]) / slot.height;
    cavity[i] = Math.max(0, Math.min(1, d * 28));
  }

  return {
    vertexCount: total,
    landmarkCount: n,
    positions: pos,
    normals,
    uvs,
    edge,
    eye,
    mouth,
    cavity,
    indices,
    oval,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

/** Flips any triangle whose normal points away from the viewer (+z), using the frontal area as a tie-break. */
function orientTowardViewer(indices: Uint32Array, pos: Float32Array): void {
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
    if (nz < -1e-6 * len || (Math.abs(nz) <= 1e-6 * len && nz < 0)) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }
}

/** Area-weighted vertex normals. */
export function vertexNormals(indices: ArrayLike<number>, pos: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v] += nx;
      out[v + 1] += ny;
      out[v + 2] += nz;
    }
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    if (l < 1e-12) {
      // Not in any triangle (the iris points): face the viewer.
      out[i * 3 + 2] = 1;
      continue;
    }
    out[i * 3] /= l;
    out[i * 3 + 1] /= l;
    out[i * 3 + 2] /= l;
  }
  return out;
}

/** Signed frontal area of a triangle (x right, y up). */
export function frontalArea(pos: Float32Array, a: number, b: number, c: number): number {
  return (
    ((pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 1] - pos[a * 3 + 1]) -
      (pos[c * 3] - pos[a * 3]) * (pos[b * 3 + 1] - pos[a * 3 + 1])) /
    2
  );
}

/** The dot lattice laid over the surface. */
export interface Lattice {
  count: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  edge: Float32Array;
  /** 0..1 per dot, for twinkle phase and subset picks. */
  seeds: Float32Array;
}

/** Lattice pitch (reference px) per quality level: about 3,800 dots (high) or 3,000 (low) on a face of the mockup's size; the pitch is measured along the surface, so the dots sit closer than this on screen toward the silhouette. */
export const LATTICE_PITCH = { high: 5.9, medium: 5.9, low: 6.6 } as const;

/**
 * The contour-following dot lattice.
 *
 * Dots sit on a regular grid laid over the surface rather than over the
 * screen. Columns are spaced by arc length around a vertical cylinder that
 * wraps the face, so they close up toward the silhouette the way lines drawn
 * on a curved surface do. Rows are level lines of `y + bow * depth` (depth
 * measured back from the nose tip), which rise
 * over whatever comes forward (the forehead, the cheekbones, the nose, the
 * chin): seen from the front they arc over the forehead and around the
 * cheekbones like topographic lines. Rows are staggered by half a pitch, and a
 * grid point that lands on two layers of the surface (under the nose) keeps
 * the one nearer the viewer. Dots in the filled eye and mouth openings are
 * dropped: those are not skin.
 */
export function sampleLattice(surface: FaceSurface, pitch: number, bow = 0.75, jitter = 0.06): Lattice {
  const { positions: pos, indices, normals, uvs, edge, eye, mouth, bounds } = surface;
  const best = new Map<number, { z: number; t: number; w0: number; w1: number; w2: number }>();
  // The wrapping cylinder: a little wider than the face, its axis behind the nose.
  const R = (bounds.maxX - bounds.minX) * 0.55;
  const axisX = (bounds.minX + bounds.maxX) / 2;
  const axisZ = bounds.maxZ - R * 1.15;
  const colOf = (i: number): number => R * Math.atan2(pos[i * 3] - axisX, pos[i * 3 + 2] - axisZ);
  const rowOf = (i: number): number => pos[i * 3 + 1] + bow * (bounds.maxZ - pos[i * 3 + 2]);

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ax = colOf(a), bx = colOf(b), cx = colOf(c);
    const ay = rowOf(a), by = rowOf(b), cy = rowOf(c);
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    const j0 = Math.ceil(Math.min(ay, by, cy) / pitch);
    const j1 = Math.floor(Math.max(ay, by, cy) / pitch);
    for (let j = j0; j <= j1; j++) {
      const y = j * pitch;
      const off = (j & 1) * 0.5 * pitch;
      const i0 = Math.ceil((Math.min(ax, bx, cx) - off) / pitch);
      const i1 = Math.floor((Math.max(ax, bx, cx) - off) / pitch);
      for (let i = i0; i <= i1; i++) {
        const x = i * pitch + off;
        const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * pos[a * 3 + 2] + w1 * pos[b * 3 + 2] + w2 * pos[c * 3 + 2];
        const k = (j + 32768) * 65536 + (i + 32768);
        const prev = best.get(k);
        if (!prev || z > prev.z) best.set(k, { z, t, w0, w1, w2 });
      }
    }
  }

  const P: number[] = [], N: number[] = [], U: number[] = [], E: number[] = [], S: number[] = [];
  let seed = 0x9e3779b9;
  const rand = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  for (const { t, w0, w1, w2 } of best.values()) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const hole = w0 * (eye[a] + mouth[a]) + w1 * (eye[b] + mouth[b]) + w2 * (eye[c] + mouth[c]);
    if (hole > 0.35) continue;
    const blend = (arr: Float32Array, stride: number, o: number): number =>
      w0 * arr[a * stride + o] + w1 * arr[b * stride + o] + w2 * arr[c * stride + o];
    let nx = blend(normals, 3, 0), ny = blend(normals, 3, 1), nz = blend(normals, 3, 2);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const jx = (rand() - 0.5) * jitter * pitch, jy = (rand() - 0.5) * jitter * pitch;
    P.push(blend(pos, 3, 0) + jx, blend(pos, 3, 1) + jy, blend(pos, 3, 2));
    N.push(nx, ny, nz);
    U.push(blend(uvs, 2, 0), blend(uvs, 2, 1));
    E.push(w0 * edge[a] + w1 * edge[b] + w2 * edge[c]);
    S.push(rand());
  }
  return {
    count: S.length,
    positions: Float32Array.from(P),
    normals: Float32Array.from(N),
    uvs: Float32Array.from(U),
    edge: Float32Array.from(E),
    seeds: Float32Array.from(S),
  };
}

/**
 * The decorative head shell: a translucent cap from the face's upper edge
 * over to the crown.
 *
 * The capture measures the face only, so above the forehead and around the
 * temples there is nothing to draw, and a bare mask floats over the rings.
 * This shell gives the hologram a head's outline without claiming anything
 * about the person: it is a smooth ellipsoid (a little wider than the face,
 * crown about 0.3 face heights above the forehead) lofted from the face's own
 * upper edge, so it joins whatever face it is given. It carries no lattice and
 * no hair; the shaders draw it as a faint blue volume with a light rim.
 *
 * Grid layout: `cols` columns along the face edge (left temple, over the top,
 * right temple) by `rows + 1` rings from the edge (s = 0) to the crown (s = 1).
 */
export interface CraniumShell {
  cols: number;
  rows: number;
  positions: Float32Array;
  normals: Float32Array;
  /** 0 on the face's edge, 1 at the crown. */
  s: Float32Array;
  /** 0 at the two lower ends of the shell (beside the eyes), 1 elsewhere. */
  side: Float32Array;
  indices: Uint32Array;
  centre: [number, number, number];
  radii: [number, number, number];
}

export function buildCraniumShell(surface: FaceSurface, rows = 16): CraniumShell {
  const { positions: pos, oval, bounds } = surface;
  const faceW = bounds.maxX - bounds.minX, faceH = bounds.maxY - bounds.minY;
  const ex = (bounds.minX + bounds.maxX) / 2;
  const ey = bounds.maxY - faceH * 0.29;
  const ax = faceW * 0.53;
  const ay = bounds.maxY + faceH * 0.3 - ey;
  const az = ax * 1.15;

  // The face's upper edge, from one side at about eye level over the top to the other.
  const cut = ey - faceH * 0.1;
  const n = oval.length;
  let top = 0;
  for (let k = 1; k < n; k++) if (pos[oval[k] * 3 + 1] > pos[oval[top] * 3 + 1]) top = k;
  const arc: number[] = [oval[top]];
  for (let k = 1; k < n && pos[oval[(top + k) % n] * 3 + 1] > cut; k++) arc.push(oval[(top + k) % n]);
  for (let k = 1; k < n && pos[oval[(top - k + n) % n] * 3 + 1] > cut; k++) arc.unshift(oval[(top - k + n) % n]);
  if (pos[arc[0] * 3] > pos[arc[arc.length - 1] * 3]) arc.reverse();
  const edgePts = smoothOpen3(arc.map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]] as V3), 3);

  // Sit the ellipsoid so the edge lies on it on average.
  let ez = 0;
  for (const [x, y, z] of edgePts) {
    const dx = (x - ex) / ax, dy = (y - ey) / ay;
    ez += z - az * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  }
  ez /= edgePts.length || 1;

  const cols = edgePts.length;
  const vCount = cols * (rows + 1);
  const P = new Float32Array(vCount * 3);
  const S = new Float32Array(vCount);
  const side = new Float32Array(vCount);
  for (let c = 0; c < cols; c++) {
    const [bx, by, bz] = edgePts[c];
    // Direction of the edge point from the centre, on the unit sphere.
    let dx = (bx - ex) / ax, dy = (by - ey) / ay, dz = (bz - ez) / az;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const off: V3 = [bx - (ex + ax * dx), by - (ey + ay * dy), bz - (ez + az * dz)];
    const omega = Math.acos(Math.max(-1, Math.min(1, dy)));
    const sinO = Math.sin(omega) || 1;
    const endFade = Math.min(c, cols - 1 - c) / Math.max(1, (cols - 1) * 0.14);
    for (let r = 0; r <= rows; r++) {
      const w = r / rows;
      // Slerp from the edge direction to straight up (the crown).
      const f0 = Math.sin((1 - w) * omega) / sinO, f1 = Math.sin(w * omega) / sinO;
      const ux = f0 * dx, uy = f0 * dy + f1, uz = f0 * dz;
      const keep = (1 - w) * (1 - w);
      const v = c * (rows + 1) + r;
      P[v * 3] = ex + ax * ux + off[0] * keep;
      P[v * 3 + 1] = ey + ay * uy + off[1] * keep;
      P[v * 3 + 2] = ez + az * uz + off[2] * keep;
      S[v] = w;
      side[v] = Math.min(1, endFade);
    }
  }
  const idx: number[] = [];
  for (let c = 0; c + 1 < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = c * (rows + 1) + r, b = a + 1, d = a + rows + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const indices = Uint32Array.from(idx);
  // Wind every triangle outward (away from the ellipsoid's centre).
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (P[a] + P[b] + P[c]) / 3 - ex, my = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - ey, mz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - ez;
    if (nx * mx + ny * my + nz * mz < 0) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }
  return {
    cols,
    rows,
    positions: P,
    normals: vertexNormals(indices, P, vCount),
    s: S,
    side,
    indices,
    centre: [ex, ey, ez],
    radii: [ax, ay, az],
  };
}

/** A point on the shell at column fraction `u` (0..1 along the face edge) and ring fraction `w` (0 edge .. 1 crown). */
export function shellPoint(shell: CraniumShell, u: number, w: number, out: Float32Array | number[] = [0, 0, 0, 0, 0, 0]): typeof out {
  const fc = Math.max(0, Math.min(1, u)) * (shell.cols - 1);
  const fr = Math.max(0, Math.min(1, w)) * shell.rows;
  const c0 = Math.min(shell.cols - 2, Math.floor(fc)), r0 = Math.min(shell.rows - 1, Math.floor(fr));
  const tc = fc - c0, tr = fr - r0;
  const i00 = c0 * (shell.rows + 1) + r0, i01 = i00 + 1, i10 = i00 + shell.rows + 1, i11 = i10 + 1;
  for (let k = 0; k < 3; k++) {
    const p = shell.positions, q = shell.normals;
    out[k] = (p[i00 * 3 + k] * (1 - tr) + p[i01 * 3 + k] * tr) * (1 - tc) + (p[i10 * 3 + k] * (1 - tr) + p[i11 * 3 + k] * tr) * tc;
    out[k + 3] = (q[i00 * 3 + k] * (1 - tr) + q[i01 * 3 + k] * tr) * (1 - tc) + (q[i10 * 3 + k] * (1 - tr) + q[i11 * 3 + k] * tr) * tc;
  }
  return out;
}

type V3 = [number, number, number];

/** An open Catmull-Rom curve through 3D points (ends kept), `steps` samples per span. */
function smoothOpen3(pts: V3[], steps: number): V3[] {
  if (pts.length < 3) return pts.slice();
  const ext = [pts[0], ...pts, pts[pts.length - 1]];
  const out: V3[] = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (k: number): number =>
        0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A closed Catmull-Rom curve through 2D points, `steps` samples per span.
 * Used to smooth landmark polygons (the silhouette, zone outlines) into curves.
 */
export function smoothLoop(pts: [number, number][], steps: number): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
