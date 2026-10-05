/**
 * Where the viewer is looking from, for the rooms' parallax: the pointer on
 * desktop, the phone's tilt on touch screens. One listener set for the whole
 * page, shared by every living room; a vector in [-1, 1]^2 (x right, y down),
 * 0 when there is nothing to follow.
 *
 * Tilt starts only after a user gesture (browsers want one), and never raises
 * a permission prompt by itself: on iOS, where reading motion needs one,
 * `requestTilt()` must be called from a control the person chose (Profile's
 * "Tilt the room" switch). Until then, and if they decline, the room simply
 * keeps still for tilt. Elsewhere tilt starts on the first touch; `stopTilt()`
 * turns it off for the visit. Nothing is stored or sent; the readings only
 * move the picture.
 */

const state = { x: 0, y: 0, source: 'none' as 'none' | 'pointer' | 'tilt' };
let users = 0;
let detach: (() => void) | null = null;
let tiltBase: { x: number; y: number; angle: number } | null = null;
/** The deviceorientation listener is attached (only while a room follows the viewer). */
let tiltListening = false;
/** Tilt may run: permission granted (iOS) or a first touch (elsewhere). Kept while no room is mounted. */
let tiltOn = false;
/** The person refused the prompt: never asked again this visit. */
let tiltDenied = false;
/** The person turned tilt off: no automatic start on touch either. */
let tiltOff = false;

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

function onPointer(event: PointerEvent) {
  if (event.pointerType === 'touch') return;
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  state.x = clamp1((event.clientX / w) * 2 - 1);
  state.y = clamp1((event.clientY / h) * 2 - 1);
  state.source = 'pointer';
}

function onLeave(event: PointerEvent | MouseEvent) {
  if ((event as MouseEvent).relatedTarget === null && state.source === 'pointer') {
    state.x = 0;
    state.y = 0;
  }
}

/**
 * The screen's rotation from the device's natural (portrait) hold, in degrees
 * 0 / 90 / 180 / 270: 90 when the device is turned a quarter to the left (its
 * top pointing left), 270 a quarter to the right. screen.orientation where
 * there is one, else iOS's window.orientation (-90 = 270), else a guess from
 * the window's shape.
 */
export function screenAngle(): number {
  const so = typeof screen !== 'undefined' ? (screen as Screen & { orientation?: { angle?: number } }).orientation : undefined;
  let a = typeof so?.angle === 'number' ? so.angle : (window as Window & { orientation?: number }).orientation;
  if (typeof a !== 'number') a = (window.innerHeight || 0) >= (window.innerWidth || 0) ? 0 : 90;
  return (((Math.round(a / 90) * 90) % 360) + 360) % 360;
}

/**
 * A device tilt (DeviceOrientationEvent beta, gamma: degrees about the
 * device's own x and y axes) in screen terms, for a screen turned `angle`:
 * x > 0 when the screen's right edge dips, y > 0 when its bottom edge dips.
 * (Held upright, x is gamma and y is beta; turned a quarter left, the screen's
 * right edge is the device's bottom, so x is beta, and so on round.)
 */
export function tiltToScreen(beta: number, gamma: number, angle: number): { x: number; y: number } {
  switch (angle) {
    case 90:
      return { x: beta, y: -gamma };
    case 180:
      return { x: -gamma, y: -beta };
    case 270:
      return { x: -beta, y: gamma };
    default:
      return { x: gamma, y: beta };
  }
}

function onOrientation(event: DeviceOrientationEvent) {
  if (event.beta === null || event.gamma === null) return;
  const angle = screenAngle();
  const { x, y } = tiltToScreen(event.beta, event.gamma, angle);
  // The way the phone is held when tilt starts is "straight on"; it drifts
  // slowly toward the current hold, so a new posture soon becomes the rest.
  // Turning the screen starts again from the new hold.
  if (!tiltBase || tiltBase.angle !== angle) tiltBase = { x, y, angle };
  tiltBase.x += (x - tiltBase.x) * 0.01;
  tiltBase.y += (y - tiltBase.y) * 0.01;
  state.x = clamp1((x - tiltBase.x) / 18);
  state.y = clamp1((y - tiltBase.y) / 18);
  state.source = 'tilt';
}

/** Tilt may run from now on; the listener is attached while any room follows the viewer. */
function enableTilt() {
  if (tiltDenied) return;
  tiltOn = true;
  tiltOff = false;
  if (users > 0) listenTilt();
}

function listenTilt() {
  if (tiltListening || !tiltOn) return;
  tiltListening = true;
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
}

function unlistenTilt() {
  if (tiltListening) window.removeEventListener('deviceorientation', onOrientation);
  tiltListening = false;
  tiltBase = null;
  if (state.source === 'tilt') {
    state.x = 0;
    state.y = 0;
    state.source = 'none';
  }
}

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied' | 'default'> };

/** Whether reading tilt needs a permission prompt here (iOS Safari). */
export function tiltNeedsPermission(): boolean {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as unknown as PermissionApi).requestPermission === 'function';
}

/** Whether this device can report tilt at all. */
export function tiltAvailable(): boolean {
  return typeof window !== 'undefined' && typeof DeviceOrientationEvent !== 'undefined';
}

/** Whether tilt is on for this visit. */
export function tiltEnabled(): boolean {
  return tiltOn;
}

/** Whether the person has refused the motion prompt this visit (it is not asked again). */
export function tiltRefused(): boolean {
  return tiltDenied;
}

/**
 * Ask for tilt (call it synchronously from a user gesture: iOS shows its
 * prompt only then). Resolves whether tilt is on. A refusal, or a prompt that
 * cannot be shown, is remembered for the page's life and never asked again.
 */
export async function requestTilt(): Promise<boolean> {
  if (!tiltAvailable() || tiltDenied) return false;
  if (tiltOn) return true;
  const api = DeviceOrientationEvent as unknown as PermissionApi;
  if (typeof api.requestPermission === 'function') {
    try {
      const answer = await api.requestPermission();
      if (answer !== 'granted') {
        tiltDenied = true;
        return false;
      }
    } catch {
      tiltDenied = true;
      return false;
    }
  }
  enableTilt();
  return true;
}

/** Turn tilt off for this visit (the room eases back to rest). */
export function stopTilt(): void {
  tiltOn = false;
  tiltOff = true;
  unlistenTilt();
}

function attach(): () => void {
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('mouseout', onLeave, { passive: true });
  // Tilt already allowed this visit: follow it again. Where it needs no prompt (Android, most
  // others) and was not turned off, start it on the first touch.
  listenTilt();
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const onFirstTouch = () => {
    window.removeEventListener('touchend', onFirstTouch);
    if (!tiltNeedsPermission() && !tiltOff) enableTilt();
  };
  if (coarse && !tiltOn && !tiltOff && !tiltNeedsPermission()) window.addEventListener('touchend', onFirstTouch, { passive: true });
  return () => {
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('mouseout', onLeave);
    window.removeEventListener('touchend', onFirstTouch);
    unlistenTilt();
    state.x = 0;
    state.y = 0;
    state.source = 'none';
  };
}

/** Start following the viewer (reference-counted across rooms); returns the release. */
export function useViewer(): () => void {
  if (typeof window === 'undefined') return () => {};
  users++;
  if (users === 1) detach = attach();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    if (users === 0) {
      detach?.();
      detach = null;
    }
  };
}

/** The current target (the renderers ease toward it). */
export function viewer(): { x: number; y: number } {
  return { x: state.x, y: state.y };
}
