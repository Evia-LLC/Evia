/**
 * Screen-space → world-space registration.
 *
 * The interface is laid out in CSS, and the 3D room registers against it. This
 * is the conversion that makes that possible: give it a rectangle in CSS pixels
 * and it returns the same rectangle in world space, so geometry can be placed to
 * land exactly inside a DOM element at any aspect ratio, DPI or camera framing.
 *
 * The plane is perpendicular to the view direction, which makes the unprojected
 * rectangle a true rectangle rather than a trapezoid — the face model sits
 * square inside its window instead of subtly keystoning against the border drawn
 * around it.
 */
import * as THREE from 'three';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldRect {
  centre: THREE.Vector3;
  /** Unit vector along the rectangle's width, in world space. */
  right: THREE.Vector3;
  /** Unit vector along the rectangle's height, in world space. */
  up: THREE.Vector3;
  width: number;
  height: number;
}

const camPos = new THREE.Vector3();
const viewDir = new THREE.Vector3();
const planePoint = new THREE.Vector3();
const plane = new THREE.Plane();
const ray = new THREE.Ray();
const scratch = new THREE.Vector3();

/** One screen point (CSS px, viewport-relative) onto the plane at `distance`. */
function castTo(
  camera: THREE.PerspectiveCamera,
  viewport: ScreenRect,
  px: number,
  py: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const ndcX = ((px - viewport.x) / viewport.width) * 2 - 1;
  const ndcY = -(((py - viewport.y) / viewport.height) * 2 - 1);
  scratch.set(ndcX, ndcY, 0.5).unproject(camera);
  ray.origin.copy(camPos);
  ray.direction.copy(scratch).sub(camPos).normalize();
  // A ray parallel to the plane cannot land anywhere sensible; leaving `out`
  // untouched keeps the last good value rather than teleporting to the origin.
  ray.intersectPlane(plane, out);
  return out;
}

/**
 * Converts a CSS-pixel rectangle into a world rectangle sitting `distance` in
 * front of the camera.
 *
 * `viewport` is the canvas's own bounding rect, so the maths stays correct when
 * the canvas is inset rather than full-bleed.
 */
export function unprojectRect(
  camera: THREE.PerspectiveCamera,
  viewport: ScreenRect,
  rect: ScreenRect,
  distance: number,
  out?: WorldRect,
): WorldRect {
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(viewDir);
  planePoint.copy(camPos).addScaledVector(viewDir, Math.max(0.05, distance));
  plane.setFromNormalAndCoplanarPoint(viewDir.clone().negate(), planePoint);

  const result: WorldRect = out ?? {
    centre: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    width: 0,
    height: 0,
  };

  const topLeft = castTo(camera, viewport, rect.x, rect.y, new THREE.Vector3());
  const topRight = castTo(camera, viewport, rect.x + rect.width, rect.y, new THREE.Vector3());
  const bottomLeft = castTo(camera, viewport, rect.x, rect.y + rect.height, new THREE.Vector3());

  result.width = topLeft.distanceTo(topRight);
  result.height = topLeft.distanceTo(bottomLeft);
  result.right.copy(topRight).sub(topLeft).normalize();
  result.up.copy(topLeft).sub(bottomLeft).normalize();
  result.centre
    .copy(topLeft)
    .addScaledVector(result.right, result.width * 0.5)
    .addScaledVector(result.up, -result.height * 0.5);

  return result;
}

/** A point inside a world rect, in -0.5..0.5 rectangle-local coordinates. */
export function onRect(rect: WorldRect, u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out
    .copy(rect.centre)
    .addScaledVector(rect.right, u * rect.width)
    .addScaledVector(rect.up, v * rect.height);
}

/**
 * Where a screen point lands on a chosen world Z plane.
 *
 * Used to put Evia on her mark. A camera-relative plane would move her
 * forwards and backwards every time the shot changed; the floor of the room
 * does not move, so neither should she.
 */
export function unprojectOnZ(
  camera: THREE.PerspectiveCamera,
  viewport: ScreenRect,
  px: number,
  py: number,
  worldZ: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  camera.getWorldPosition(camPos);
  plane.setFromNormalAndCoplanarPoint(
    new THREE.Vector3(0, 0, 1),
    scratch.set(0, 0, worldZ),
  );
  return castTo(camera, viewport, px, py, out);
}
