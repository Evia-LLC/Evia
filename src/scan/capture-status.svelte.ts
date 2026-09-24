/**
 * What the capture's camera is doing right now, for the Scan page's header.
 *
 * `ScanCapture` owns the camera and writes this as its state changes; the
 * page's view model (src/view/scan.ts) reads it, so the header's eyebrow says
 * "camera blocked" when it is, rather than "live camera" over a panel asking
 * the user to try again. Nothing here is stored or sent anywhere.
 */

export type CameraState =
  /** No camera yet and none being opened (before the first attempt, or stopped). */
  | 'idle'
  /** Asking the browser for the camera. */
  | 'starting'
  /** The live preview is running. */
  | 'live'
  /** The browser refused, has no camera, or the preview would not start. */
  | 'blocked'
  /** A photo was chosen instead of the camera. */
  | 'photo';

export const captureStatus = $state<{ camera: CameraState }>({ camera: 'idle' });
