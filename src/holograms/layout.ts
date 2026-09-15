/**
 * The holographic layout solver (ARCHITECTURE §8).
 *
 * The brief's rule for small screens is "recompose, don't shrink". That is only
 * true if positions are *solved* rather than authored, so this takes the element
 * count and the actual camera framing and returns placements: an arc that wraps
 * around her in landscape, a vertical stack beside her in portrait.
 *
 * Crucially it solves against the real frustum rather than hardcoded world
 * offsets. A column at x = ±0.29 fits comfortably on a laptop and falls off the
 * side of a 375 px phone, and no amount of CSS rescues a panel the camera cannot
 * see.
 *
 * Everything the rig draws is placed from here — not just the metric slots but
 * the connector origin, the body scan band and the room architecture. Anything
 * hardcoded in the rig would be correct on exactly one aspect ratio.
 */
import * as THREE from 'three';

export type LayoutMode = 'arc' | 'stack';

/**
 * The display panel — the surface she presents from.
 *
 * The room is composed around this rather than around her: she is the
 * consultant standing beside a screen, not the subject being scanned. That is
 * what stops readouts landing on her face, which no amount of tuning fixed
 * while she was the centre of the composition.
 */
export interface PanelPlacement {
  centre: THREE.Vector3;
  width: number;
  height: number;
  /** Radians about Y — angled slightly towards the viewer. */
  yaw: number;
}

export interface HoloSlot {
  position: THREE.Vector3;
  /** Radians about Y — panels face the camera, not the origin. */
  yaw: number;
  scale: number;
}

/** The vertical band the scan beam travels, and how wide the band is. */
export interface ScanBand {
  x: number;
  z: number;
  width: number;
  top: number;
  bottom: number;
}

/**
 * Room architecture that has to stay inside the frame. Solved rather than
 * authored for the same reason the slots are: flanking posts placed for a 16:9
 * laptop sit entirely outside a portrait phone's frustum.
 */
export interface RoomArchitecture {
  postX: number;
  postZ: number;
  postHeight: number;
  ringRadius: number;
}

export interface LayoutResult {
  mode: LayoutMode;
  slots: HoloSlot[];
  /** The display surface everything else is arranged inside. */
  panel: PanelPlacement;
  /**
   * Where the presenter should stand, so the director can place her relative to
   * the panel instead of both guessing independently.
   */
  presenterPosition: THREE.Vector3;
  presenterYaw: number;
  /** Rows the routine view lays its cards on, in world space. */
  cardRows: THREE.Vector3[];
  /** Where the face visualisation sits. */
  facePosition: THREE.Vector3;
  faceScale: number;
  /**
   * False in portrait. The contour model needs horizontal room beside her, and
   * a phone has none — centring it lands it on her chest. Dropping it is a
   * recomposition, not a shrink: the rings and their labels still carry every
   * number, and the model is a supporting visual.
   */
  faceVisible: boolean;
  /** Where the connector threads emanate from — just in front of her sternum. */
  projectorOrigin: THREE.Vector3;
  /** The scan band that crosses the face model. */
  faceScan: ScanBand;
  /** The wide scan band that crosses *her*. */
  bodyScan: ScanBand;
  architecture: RoomArchitecture;
}

/** What the camera can actually see, which is what the layout must fit inside. */
export interface ViewFrustum {
  fovDeg: number;
  aspect: number;
  cameraY: number;
  cameraZ: number;
}

const DEFAULT_VIEW: ViewFrustum = { fovDeg: 42, aspect: 1.6, cameraY: 1.5, cameraZ: 1.42 };

/** Half-extents of the visible rectangle on a plane `distance` from the camera. */
export function extentsAt(view: ViewFrustum, distance: number): { halfW: number; halfH: number } {
  const halfH = Math.max(0.05, distance) * Math.tan((view.fovDeg * Math.PI) / 360);
  return { halfH, halfW: halfH * view.aspect };
}

/**
 * Flanking posts and the far floor ring.
 *
 * The clinical shot is framed chest-up, which means the floor nearer than about
 * 2.5 m is below the bottom of frame entirely — floor detail at her feet is not
 * visible however nicely it is drawn. So the architecture is solved at *room*
 * scale: posts set back behind her that rise out of the bottom of frame, and a
 * floor ring far enough away to cross the visible horizon band.
 */
function solveArchitecture(view: ViewFrustum, postZ: number, ringRadius: number): RoomArchitecture {
  const depth = Math.max(0.6, view.cameraZ - postZ);
  const { halfW } = extentsAt(view, depth);
  return {
    // Pushed right out to the edge and kept low. Full-height flanking rails
    // framed her like bars on a cell — the room is supposed to feel spatial and
    // premium, and two verticals either side of a person read as a cage no
    // matter how nicely they are drawn.
    postX: halfW * 0.92,
    postZ,
    // Waist height at most: enough to give the floor scale and a horizon, not
    // enough to enclose her.
    postHeight: Math.min(0.62, Math.max(0.35, view.cameraY * 0.4)),
    ringRadius,
  };
}

export function solveLayout(count: number, view: ViewFrustum = DEFAULT_VIEW): LayoutResult {
  return view.aspect < 0.85 ? stackLayout(count, view) : arcLayout(count, view);
}

/**
 * Landscape: elements sweep around her on an arc, biased to her left so she can
 * turn and gesture at them without occluding her own face.
 */
function arcLayout(count: number, view: ViewFrustum): LayoutResult {
  const slots: HoloSlot[] = [];
  const { halfW, halfH } = extentsAt(view, view.cameraZ);

  // --- the panel ------------------------------------------------------------
  // A tall display filling the right of frame. She stands to its left and
  // presents from it. Everything else is positioned *inside* this rectangle,
  // which is why nothing can land on her any more: the readouts and the panel
  // occupy different halves of the composition by construction.
  const panelWidth = Math.min(1.55, halfW * 1.02);
  const panelHeight = Math.min(1.62, halfH * 1.62);
  const panelX = halfW * 0.36;
  const panelY = view.cameraY + halfH * 0.1;
  const panelZ = -0.12;
  const panelYaw = -0.13; // angled a few degrees towards the viewer

  const panel: PanelPlacement = {
    centre: new THREE.Vector3(panelX, panelY, panelZ),
    width: panelWidth,
    height: panelHeight,
    yaw: panelYaw,
  };

  /** Panel-local (u, v) in -0.5..0.5 to world, honouring the panel's yaw. */
  const onPanel = (u: number, v: number, out = 0.012): THREE.Vector3 => {
    const lx = u * panelWidth;
    const ly = v * panelHeight;
    const cos = Math.cos(panelYaw);
    const sin = Math.sin(panelYaw);
    return new THREE.Vector3(
      panelX + lx * cos + out * sin,
      panelY + ly,
      panelZ - lx * sin + out * cos,
    );
  };

  // --- the scan view --------------------------------------------------------
  // Face model on the panel's left, metric rings in a column down its right.
  const facePosition = onPanel(-0.24, -0.02, 0.02);
  const faceScale = Math.min(0.94, (panelHeight / 0.4) * 0.24);

  const ringTop = 0.3;
  const ringBottom = -0.34;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    // Two columns inside the panel's right half, so six readouts fit without
    // shrinking them below legibility.
    const col = i % 2;
    const row = Math.floor(i / 2);
    const rows = Math.max(1, Math.ceil(count / 2));
    const v = ringTop - (ringTop - ringBottom) * (rows === 1 ? 0.5 : row / (rows - 1));
    void t;
    slots.push({
      position: onPanel(col === 0 ? 0.14 : 0.36, v, 0.02),
      yaw: panelYaw,
      scale: 0.86,
    });
  }

  // Rows the routine cards sit on when the panel swaps content.
  const cardRows: THREE.Vector3[] = [];
  const cardCount = 4;
  for (let i = 0; i < cardCount; i++) {
    const v = 0.28 - (i / (cardCount - 1)) * 0.58;
    cardRows.push(onPanel(0, v, 0.02));
  }

  return {
    mode: 'arc',
    slots,
    panel,
    // Left of the panel, turned a little towards it. She is presenting, so she
    // stands off-centre and angled rather than facing the lens square on.
    presenterPosition: new THREE.Vector3(-halfW * 0.52, 0, 0.24),
    presenterYaw: 0.34,
    cardRows,
    facePosition,
    faceScale,
    faceVisible: true,
    // Threads leave the panel edge nearest her, so they read as her feeding the
    // display rather than the display impaling her.
    projectorOrigin: onPanel(-0.46, -0.1, 0.02),
    faceScan: {
      x: facePosition.x,
      z: facePosition.z + 0.01,
      width: 0.36 * faceScale,
      top: facePosition.y + 0.24 * faceScale,
      bottom: facePosition.y - 0.24 * faceScale,
    },
    bodyScan: {
      // Crosses *her*, where she actually stands.
      x: -halfW * 0.52,
      z: 0.26,
      width: 0.95,
      top: view.cameraY + halfH * 0.85,
      bottom: view.cameraY - halfH * 1.05,
    },
    architecture: solveArchitecture(view, -1.9, 3.6),
  };
}

/**
 * Portrait: the same idea recomposed vertically. The panel takes the upper part
 * of the frame and she stands below-left of it, still angled towards it.
 *
 * Not the landscape composition squeezed — on a phone there is no room for a
 * panel *beside* a person, so the panel goes above her and the readouts move to
 * a grid inside it.
 */
function stackLayout(count: number, view: ViewFrustum): LayoutResult {
  const slots: HoloSlot[] = [];
  const { halfW, halfH } = extentsAt(view, view.cameraZ);

  const panelWidth = Math.min(1.5, halfW * 1.86);
  const panelHeight = Math.min(1.5, halfH * 0.92);
  const panelX = 0;
  const panelY = view.cameraY + halfH * 0.44;
  const panelZ = -0.1;

  const panel: PanelPlacement = {
    centre: new THREE.Vector3(panelX, panelY, panelZ),
    width: panelWidth,
    height: panelHeight,
    yaw: 0,
  };

  const onPanel = (u: number, v: number, out = 0.012): THREE.Vector3 =>
    new THREE.Vector3(panelX + u * panelWidth, panelY + v * panelHeight, panelZ + out);

  // Face model across the top of the panel, readouts in a grid beneath it.
  const facePosition = onPanel(0, 0.23, 0.02);
  const faceScale = Math.min(0.62, (panelHeight / 0.4) * 0.15);

  const columns = 3;
  const rows = Math.max(1, Math.ceil(count / columns));
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    slots.push({
      position: onPanel(
        (col - (columns - 1) / 2) * 0.3,
        -0.14 - (rows === 1 ? 0 : (row / (rows - 1)) * 0.26),
        0.02,
      ),
      yaw: 0,
      scale: 0.7,
    });
  }

  const cardRows: THREE.Vector3[] = [];
  const cardCount = 4;
  for (let i = 0; i < cardCount; i++) {
    cardRows.push(onPanel(0, 0.3 - (i / (cardCount - 1)) * 0.62, 0.02));
  }

  return {
    mode: 'stack',
    slots,
    panel,
    presenterPosition: new THREE.Vector3(-halfW * 0.32, 0, 0.42),
    presenterYaw: 0.28,
    cardRows,
    facePosition,
    faceScale,
    faceVisible: true,
    // Out of the panel's lower-left corner, towards her.
    projectorOrigin: onPanel(-0.42, -0.44, 0.02),
    faceScan: {
      x: facePosition.x,
      z: facePosition.z + 0.01,
      width: 0.36 * faceScale,
      top: facePosition.y + 0.24 * faceScale,
      bottom: facePosition.y - 0.24 * faceScale,
    },
    bodyScan: {
      x: -halfW * 0.32,
      z: 0.44,
      width: 0.85,
      top: view.cameraY + halfH * 0.28,
      bottom: view.cameraY - halfH * 1.1,
    },
    architecture: solveArchitecture(view, -1.4, 2.8),
  };
}
