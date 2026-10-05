/**
 * The character prototype's room (src/character3d/room.ts): the Blender
 * plate's camera and pedestal, and where each hologram region is in 3D.
 *
 * The camera numbers are copied from the room render's anchors.json; these
 * tests read the file, so a re-render that moves the camera or the pedestal
 * fails here instead of leaving her floating. The projection is checked
 * against the render's own measurement of the pedestal's top.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FACE_REGIONS } from '../shared/types.ts';
import {
  CAMERA_HEIGHT,
  FOCAL,
  HOLOGRAM_DEPTH,
  HORIZON_REF_Y,
  PEDESTAL,
  REF_FRAME,
  REGION_REF,
  hologramCentre,
  plateRectForStage,
  refToCanvas,
  regionTarget,
  rimPoint,
  screenToWorld,
  worldToScreen,
  type PlateRect,
} from '../src/character3d/room.ts';

const anchors = JSON.parse(readFileSync('public/env/consult/anchors.json', 'utf8'));
/** The desk stage at the mockup's own size: the whole plate in stage px. */
const plate: PlateRect = plateRectForStage({ x: 0, y: 0, w: 1672, h: 941 });

describe('the consult room camera', () => {
  it('matches the render: lens, sensor, height, horizon, framing and pedestal', () => {
    expect(FOCAL).toBeCloseTo(anchors.camera.lens_mm / anchors.camera.sensor_width_mm, 9);
    expect(CAMERA_HEIGHT).toBe(anchors.camera.height_m);
    expect(HORIZON_REF_Y).toBe(anchors.camera.horizon_ref_y);
    expect(REF_FRAME).toEqual({ x: anchors.refFrame.x, y: anchors.refFrame.y, w: anchors.refFrame.w, h: anchors.refFrame.h });
    expect([PEDESTAL.x, PEDESTAL.depth]).toEqual(anchors.build.params.ped_c);
    expect(PEDESTAL.radius).toBe(anchors.build.params.ped_r);
    expect(PEDESTAL.top).toBe(anchors.build.params.ped_top);
    const e = anchors.ellipses.pedestal_top;
    expect(PEDESTAL.topEllipse).toEqual({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry });
    expect(HOLOGRAM_DEPTH).toBe(anchors.layers.hologram.depthM);
  });

  it('projects the pedestal top where the render measured it', () => {
    const e = anchors.ellipses.pedestal_top;
    const back = worldToScreen([PEDESTAL.x, PEDESTAL.top, -(PEDESTAL.depth + PEDESTAL.radius)], plate);
    const front = worldToScreen([PEDESTAL.x, PEDESTAL.top, -(PEDESTAL.depth - PEDESTAL.radius)], plate);
    expect((back.y - plate.y) / plate.h).toBeCloseTo(e.yTop, 3);
    expect((front.y - plate.y) / plate.h).toBeCloseTo(e.yBottom, 3);
    // The render's own scale at the character's depth (px per metre of the 2560 plate).
    const a = worldToScreen([0, 1.2, -anchors.character.depthM], plate);
    const b = worldToScreen([1, 1.2, -anchors.character.depthM], plate);
    expect(((b.x - a.x) / plate.w) * anchors.plate.w).toBeCloseTo(anchors.character.pxPerMetre, 0);
  });

  it('goes to the world and back', () => {
    for (const [x, y, d] of [[100, 200, 4.35], [900, 700, 3.2], [1500, 60, 9]]) {
      const p = screenToWorld(x, y, d, plate);
      const q = worldToScreen(p, plate);
      expect(q.x).toBeCloseTo(x, 6);
      expect(q.y).toBeCloseTo(y, 6);
      expect(q.depth).toBeCloseTo(d, 9);
    }
  });
});

describe('region targets', () => {
  it('lies on the ray through the anchor the hologram draws, at the hologram, nudged by its depth', () => {
    const anchor = { x: 760, y: 280, visible: true, z: 60 };
    const p = regionTarget('periorbitalLeft', anchor, plate);
    const q = worldToScreen(p, plate);
    expect(q.x).toBeCloseTo(760, 6);
    expect(q.y).toBeCloseTo(280, 6);
    // 60 ref px out of the face plane is about 10 cm nearer the viewer.
    expect(q.depth).toBeGreaterThan(HOLOGRAM_DEPTH - 0.12);
    expect(q.depth).toBeLessThan(HOLOGRAM_DEPTH - 0.08);
  });

  it('falls back to the region on the sample face when the anchor is hidden', () => {
    for (const region of FACE_REGIONS) {
      const p = regionTarget(region, { x: 0, y: 0, visible: false }, plate);
      const q = worldToScreen(p, plate);
      const [ex, ey] = refToCanvas(REGION_REF[region][0], REGION_REF[region][1], plate);
      expect(q.x).toBeCloseTo(ex, 6);
      expect(q.y).toBeCloseTo(ey, 6);
      expect(q.depth).toBeCloseTo(HOLOGRAM_DEPTH, 9);
    }
  });

  it('puts every region on the hologram: over the pedestal, at head height, within the face', () => {
    const centre = hologramCentre(plate);
    for (const region of FACE_REGIONS) {
      const p = regionTarget(region, null, plate);
      expect(Math.abs(p[0] - PEDESTAL.x)).toBeLessThan(0.3);
      expect(p[1]).toBeGreaterThan(1.25);
      expect(p[1]).toBeLessThan(1.85);
      expect(Math.hypot(p[0] - centre[0], p[1] - centre[1])).toBeLessThan(0.3);
    }
    // Forehead above the chin, the image-left cheek left of the right one.
    expect(regionTarget('forehead', null, plate)[1]).toBeGreaterThan(regionTarget('chin', null, plate)[1]);
    expect(regionTarget('cheekLeft', null, plate)[0]).toBeLessThan(regionTarget('cheekRight', null, plate)[0]);
  });

  it('rests a hand on the rim on the side it comes from', () => {
    const r = rimPoint([-0.9, 1.4, -4.36]);
    expect(r[1]).toBe(PEDESTAL.top);
    expect(Math.hypot(r[0] - PEDESTAL.x, r[2] + PEDESTAL.depth)).toBeCloseTo(PEDESTAL.radius - 0.04, 9);
    expect(r[0]).toBeLessThan(PEDESTAL.x);
    // Seen from the camera, where ref4 has Evia's resting hand (x 425-520, y 665-712).
    const s = worldToScreen(r, plate);
    const [x, y] = [s.x, s.y];
    expect(x).toBeGreaterThan(400);
    expect(x).toBeLessThan(540);
    expect(y).toBeGreaterThan(650);
    expect(y).toBeLessThan(720);
  });
});
