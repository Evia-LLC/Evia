/**
 * The consult room as the character prototype stands in it: the Blender
 * plate's own camera and pedestal, in metres.
 *
 * The room plate (`public/env/consult/`) is a render from a real camera, so a
 * figure drawn through that same camera lines up with it: she stands on its
 * floor at its depth, the pedestal in front of her hides her lower body where
 * the render's pedestal is, and her hand can rest on its rim. The numbers
 * below are the Blender job's (anchors.json `camera`, `build.params`,
 * `ellipses.pedestal_top`, `character`); `test/character3d-room.test.ts`
 * checks they still match the file, so a re-render that moves the camera
 * fails loudly instead of leaving her floating.
 *
 * World axes are three.js's: x to the viewer's right, y up from the consult
 * floor, z toward the viewer. The camera stands at (0, CAMERA_HEIGHT, 0)
 * looking down -z, level; a point `d` metres in front of it has z = -d.
 *
 * Screen positions are CSS px of whatever canvas draws her, given where the
 * whole plate is drawn in that canvas's px (`PlateRect`). No three.js here.
 */
import type { FaceRegionKey } from '@shared/types.ts';

export type Vec3 = [number, number, number];

/** Where the whole plate (not only its ref4 framing) is drawn, in the drawing canvas's CSS px. */
export interface PlateRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The mockup frame (ref4) and where it sits inside the over-scanned plate (normalised). */
export const REF = { w: 1672, h: 941 } as const;
export const REF_FRAME = { x: 0.08333, y: 0.08333, w: 0.83333, h: 0.83333 } as const;
/** Plate height over width (2560 x 1440). */
export const PLATE_ASPECT = 1440 / 2560;

/** Blender camera C1: 50 mm lens on a 43.2 mm sensor (36 mm widened 1.2x for the plate's margin), horizontal fit. */
export const LENS_MM = 50;
export const SENSOR_MM = 43.2;
/** Focal length in units of the plate's width. */
export const FOCAL = LENS_MM / SENSOR_MM;
/** Camera height above the consult floor, metres; the camera is level. */
export const CAMERA_HEIGHT = 1.37;
/** The horizon (the level camera's optical axis) in ref4 px. */
export const HORIZON_REF_Y = 438.9;
/** The principal point in plate-normalised coordinates (the lens shift puts the horizon above centre). */
export const PRINCIPAL = { u: 0.5, v: REF_FRAME.y + (HORIZON_REF_Y / REF.h) * REF_FRAME.h } as const;

/** The pedestal: a copper drum with a glass top (build.params ped_c, ped_r, ped_top). */
export const PEDESTAL = {
  x: 0.05,
  depth: 3.694,
  radius: 0.9,
  top: 0.9,
  /** Its top in the plate (ellipses.pedestal_top), for the foreground mask's hole. */
  topEllipse: { cx: 0.51665, cy: 0.75032, rx: 0.29075, ry: 0.06781 },
} as const;

/** The hologram's plane: over the pedestal's centre (anchors.json layers.hologram). */
export const HOLOGRAM_DEPTH = PEDESTAL.depth;

/** Where the reading's face sits in ref4 px (hologram FACE_SLOT): what she presents when no region is named. */
export const FACE_CENTRE_REF: [number, number] = [868.6, 319.7];

/**
 * Each region's callout anchor on the sample face, in ref4 px (measured on the hologram's
 * sample mesh). Used only when the hologram cannot say where a region is right now (no face
 * yet, or the point has turned away): she still looks and points the right way.
 */
export const REGION_REF: Record<FaceRegionKey, [number, number]> = {
  forehead: [838, 189],
  glabella: [866, 254],
  nose: [868, 332],
  cheekLeft: [757, 353],
  cheekRight: [982, 352],
  periorbitalLeft: [758, 283],
  periorbitalRight: [959, 295],
  perioral: [868, 398],
  chin: [882, 451],
};

/** Hologram world units (ref px) per metre at the hologram's plane. */
export function refPxPerMetre(depth: number): number {
  return (FOCAL * REF.w) / REF_FRAME.w / depth;
}

/** A ref4 point in the plate's normalised coordinates. */
export function refToPlate(x: number, y: number): [number, number] {
  return [REF_FRAME.x + (x / REF.w) * REF_FRAME.w, REF_FRAME.y + (y / REF.h) * REF_FRAME.h];
}

/** A ref4 point in the canvas's px. */
export function refToCanvas(x: number, y: number, rect: PlateRect): [number, number] {
  const [u, v] = refToPlate(x, y);
  return [rect.x + u * rect.w, rect.y + v * rect.h];
}

/** The plate rect for a ref4 stage (the desk composition) when the plate lines its ref framing up with it exactly. */
export function plateRectForStage(stage: { x: number; y: number; w: number; h: number }): PlateRect {
  const w = stage.w / REF_FRAME.w;
  const h = stage.h / REF_FRAME.h;
  return { x: stage.x - REF_FRAME.x * w, y: stage.y - REF_FRAME.y * h, w, h };
}

/** Focal length and principal point in canvas px. */
export function intrinsics(rect: PlateRect): { f: number; cx: number; cy: number } {
  return { f: FOCAL * rect.w, cx: rect.x + PRINCIPAL.u * rect.w, cy: rect.y + PRINCIPAL.v * rect.h };
}

/** The world point on the camera ray through canvas px (px, py), `depth` metres in front of the camera. */
export function screenToWorld(px: number, py: number, depth: number, rect: PlateRect): Vec3 {
  const { f, cx, cy } = intrinsics(rect);
  return [((px - cx) / f) * depth, CAMERA_HEIGHT - ((py - cy) / f) * depth, -depth];
}

/** Where a world point lands on the canvas, in px (and its depth in front of the camera). */
export function worldToScreen(p: Vec3, rect: PlateRect): { x: number; y: number; depth: number } {
  const { f, cx, cy } = intrinsics(rect);
  const depth = -p[2];
  return { x: cx + (p[0] / depth) * f, y: cy - ((p[1] - CAMERA_HEIGHT) / depth) * f, depth };
}

/**
 * The perspective camera for a canvas: a symmetric frustum around the principal point, large
 * enough to hold the canvas, and the canvas's window in it (three.js `setViewOffset` terms).
 */
export function cameraView(rect: PlateRect, cssW: number, cssH: number): {
  fovDeg: number;
  aspect: number;
  fullW: number;
  fullH: number;
  offsetX: number;
  offsetY: number;
} {
  const { f, cx, cy } = intrinsics(rect);
  const halfW = Math.max(cx, cssW - cx, 1);
  const halfH = Math.max(cy, cssH - cy, 1);
  return {
    fovDeg: (2 * Math.atan(halfH / f) * 180) / Math.PI,
    aspect: halfW / halfH,
    fullW: halfW * 2,
    fullH: halfH * 2,
    offsetX: halfW - cx,
    offsetY: halfH - cy,
  };
}

/** An anchor the hologram reports (canvas px, and depth out of the face plane in ref px). */
export interface AnchorLike {
  x: number;
  y: number;
  visible: boolean;
  z?: number;
}

/**
 * The 3D point she looks and points at for a region: on the camera ray through the anchor the
 * hologram draws (so on screen her finger's line passes through the leader line's end), at the
 * hologram's depth brought forward by how far the point stands out of the face. Without a
 * visible anchor, the region's place on the sample face (`REGION_REF`).
 */
export function regionTarget(region: FaceRegionKey, anchor: AnchorLike | null | undefined, rect: PlateRect): Vec3 {
  if (anchor && anchor.visible && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
    const lift = (anchor.z ?? 0) / refPxPerMetre(HOLOGRAM_DEPTH);
    const depth = Math.min(HOLOGRAM_DEPTH + 0.4, Math.max(HOLOGRAM_DEPTH - 0.4, HOLOGRAM_DEPTH - lift));
    return screenToWorld(anchor.x, anchor.y, depth, rect);
  }
  const [x, y] = refToCanvas(REGION_REF[region][0], REGION_REF[region][1], rect);
  return screenToWorld(x, y, HOLOGRAM_DEPTH, rect);
}

/** The middle of the hologram's face, in the world. */
export function hologramCentre(rect: PlateRect): Vec3 {
  const [x, y] = refToCanvas(FACE_CENTRE_REF[0], FACE_CENTRE_REF[1], rect);
  return screenToWorld(x, y, HOLOGRAM_DEPTH, rect);
}

/** The camera itself: where she looks to meet the viewer's eye. */
export const VIEWER: Vec3 = [0, CAMERA_HEIGHT, 0];

/**
 * The point of the pedestal's rim nearest `from` (world, on its top), pulled `inset` metres in
 * over the glass: where a hand rests.
 */
export function rimPoint(from: Vec3, inset = 0.04): Vec3 {
  const cz = -PEDESTAL.depth;
  const dx = from[0] - PEDESTAL.x;
  const dz = from[2] - cz;
  const l = Math.hypot(dx, dz) || 1;
  const r = PEDESTAL.radius - inset;
  return [PEDESTAL.x + (dx / l) * r, PEDESTAL.top, cz + (dz / l) * r];
}

/**
 * The point she reaches for to touch a spot the hologram draws at canvas px (px, py): on the
 * camera ray through that spot (so on screen her fingertip lands on it), at the depth where the
 * ray passes nearest her shoulder - behind the translucent head, where an arm from her place
 * can get to it - never nearer the viewer than the hologram's own plane.
 */
export function reachTarget(px: number, py: number, shoulder: Vec3, rect: PlateRect): Vec3 {
  const { f, cx, cy } = intrinsics(rect);
  // The ray: (a d, CAMERA_HEIGHT + b d, -d) for depth d.
  const a = (px - cx) / f;
  const b = -(py - cy) / f;
  const d = (a * shoulder[0] + b * (shoulder[1] - CAMERA_HEIGHT) - shoulder[2]) / (a * a + b * b + 1);
  const depth = Math.min(-shoulder[2] + 0.1, Math.max(HOLOGRAM_DEPTH, d));
  return [a * depth, CAMERA_HEIGHT + b * depth, -depth];
}

/** A box in the drawing canvas's px. */
export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Her silhouette on screen for the consult tour's card placement (specs/consult-tour.md 6.3): her head
 * (with the lean-in), her body down to the floor UI, her near shoulder and the arm's thickness, in ref4
 * px for the left stance, measured from the prototype's frames with an 8 px margin. The right stance is
 * the mirror about the pedestal's axis on screen (x 864.5). Mapped through `plate` into canvas px
 * (the stage's px when `plate` is relative to the stage) and kept inside `stage`.
 *
 * These are the mannequin's measurements; the character stage may later project the rig's own head,
 * torso and shoulder instead, keeping this signature.
 */
export const FIGURE_KEEP_OUT_REF = {
  head: { x: 388, y: 192, w: 128, h: 134 },
  body: { x: 285, y: 320, w: 231, h: 400 },
  shoulder: { x: 490, y: 345 },
  armRadius: 34,
  mirrorX: 864.5,
} as const;

export function figureKeepOut(
  side: 'left' | 'right',
  plate: PlateRect,
  stage: ScreenBox,
): { head: ScreenBox; body: ScreenBox; shoulder: { x: number; y: number }; armRadius: number } {
  const K = FIGURE_KEEP_OUT_REF;
  const mx = (x: number) => (side === 'left' ? x : 2 * K.mirrorX - x);
  const box = (b: { x: number; y: number; w: number; h: number }): ScreenBox => {
    const xa = mx(b.x), xb = mx(b.x + b.w);
    const [x0, y0] = refToCanvas(Math.min(xa, xb), b.y, plate);
    const [x1, y1] = refToCanvas(Math.max(xa, xb), b.y + b.h, plate);
    const left = Math.max(stage.x, x0), top = Math.max(stage.y, y0);
    const right = Math.min(stage.x + stage.w, x1), bottom = Math.min(stage.y + stage.h, y1);
    return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  };
  const [sx, sy] = refToCanvas(mx(K.shoulder.x), K.shoulder.y, plate);
  const scale = (plate.w * REF_FRAME.w) / REF.w;
  return { head: box(K.head), body: box(K.body), shoulder: { x: sx, y: sy }, armRadius: K.armRadius * scale };
}
