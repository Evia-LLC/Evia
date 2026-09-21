import { describe, expect, it } from 'vitest';
import { surfaceTriangles, faceForwardTriangles } from '../src/holograms/face-surface.ts';

describe('captured face surface', () => {
  it('reconstructs each triangle once from repeated and reversed edges', () => {
    const indices = surfaceTriangles(new Uint16Array([0,1,1,2,2,0,1,0,2,1,1,3,3,2]), 4);
    expect([...indices]).toEqual([0,1,2,1,2,3]);
  });
  it('ignores incomplete and out-of-range topology without fabricating a face', () => {
    expect([...surfaceTriangles(new Uint16Array([0,1,1,8,2,2,0]), 3)]).toEqual([]);
  });
  it('orients triangles toward the camera without changing input arrays', () => {
    const indices = new Uint16Array([0,1,2]);
    const result = faceForwardTriangles(indices, new Float32Array([0,0,0,0,1,0,1,0,0]));
    expect([...result]).toEqual([0,2,1]);
    expect([...indices]).toEqual([0,1,2]);
  });
});
