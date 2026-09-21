/**
 * Owns one camera preview from permission request through playback.
 * getUserMedia cannot be aborted: cancelling retires the request and stops any
 * tracks that arrive later, without attaching them to an abandoned screen.
 */
export type CameraStartResult =
  | { kind: 'ready'; stream: MediaStream }
  | { kind: 'cancelled' }
  | { kind: 'timeout' }
  | { kind: 'error'; phase: 'acquire' | 'preview'; error: unknown };

export const CAMERA_START_TIMEOUT_MS = 15_000;

export class CameraSession {
  private generation = 0;
  private cancelPending: (() => void) | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  start(
    acquire: () => Promise<MediaStream>,
    getVideo: () => HTMLVideoElement | null,
    timeoutMs = CAMERA_START_TIMEOUT_MS,
  ): Promise<CameraStartResult> {
    this.stop();
    const generation = this.generation;

    return new Promise((resolve) => {
      let settled = false;
      const current = () => !settled && generation === this.generation;
      const finish = (result: CameraStartResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (generation === this.generation) this.cancelPending = null;
        resolve(result);
      };
      const timer = setTimeout(() => {
        if (!current()) return;
        this.release();
        finish({ kind: 'timeout' });
      }, timeoutMs);
      this.cancelPending = () => finish({ kind: 'cancelled' });

      const fail = (error: unknown, phase: 'acquire' | 'preview') => {
        if (!current()) return;
        this.release();
        finish({ kind: 'error', phase, error });
      };

      try {
        // Called synchronously so the browser retains the initiating tap.
        void acquire().then((stream) => {
          if (!current()) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          this.stream = stream;
          try {
            const video = getVideo();
            if (!video) throw new Error('The camera preview is no longer available.');
            this.video = video;
            video.srcObject = stream;
            void Promise.resolve(video.play()).then(() => {
              if (current()) finish({ kind: 'ready', stream });
            }, (error: unknown) => fail(error, 'preview'));
          } catch (error) {
            fail(error, 'preview');
          }
        }, (error: unknown) => fail(error, 'acquire'));
      } catch (error) {
        fail(error, 'acquire');
      }
    });
  }

  /** Safe on retry, file upload, navigation, and component destruction. */
  stop(): void {
    this.generation++;
    this.cancelPending?.();
    this.cancelPending = null;
    this.release();
  }

  private release(): void {
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (this.video && this.video.srcObject === stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
  }
}
