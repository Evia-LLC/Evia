/**
 * The hologram engine's two hooks for the character prototype
 * (src/hologram/engine.ts): an enlarged canvas that keeps the default
 * canvas's eye, so the head is drawn exactly where it was, and a pass drawn
 * under the hologram in the same context, owned and disposed by the engine.
 */
import { describe, expect, it } from 'vitest';
import sampleFile from '../src/sample/fixtures/scan-face-mesh.json';
import { createHologram, type HologramPass, type HologramPassFrame, type HologramRenderer } from '../src/hologram/engine.ts';
import { HOLOGRAM_BOX } from '../src/hologram/layout.ts';
import { toScanMesh } from '../src/hologram/sample.ts';
import { FACE_REGIONS } from '../shared/types.ts';

const mesh = toScanMesh(sampleFile as never);
/** Consultation's canvas with her in it. */
const FIGURE_BOX = { x: 90, y: 0, w: 1020, h: 941 };
const EYE = { x: HOLOGRAM_BOX.x + HOLOGRAM_BOX.w / 2, y: HOLOGRAM_BOX.y + HOLOGRAM_BOX.h / 2 };

function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return { clientWidth: width, clientHeight: height, width, height, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
}

function fakeRenderer() {
  const calls: string[] = [];
  const renderer = {
    autoClear: true,
    setPixelRatio() {},
    setSize() {},
    setClearColor() {},
    clear() {
      calls.push('clear');
    },
    clearDepth() {
      calls.push('clearDepth');
    },
    render() {
      calls.push('render');
    },
    dispose() {
      calls.push('dispose');
    },
  } as HologramRenderer & { autoClear: boolean; clear(): void; clearDepth(): void };
  return { renderer, calls };
}

describe('hologram engine: the enlarged canvas', () => {
  it('draws the head exactly where the default canvas does when the eye is kept', () => {
    const a = createHologram(fakeCanvas(HOLOGRAM_BOX.w, HOLOGRAM_BOX.h), { renderer: fakeRenderer().renderer, reducedMotion: true });
    const b = createHologram(fakeCanvas(FIGURE_BOX.w, FIGURE_BOX.h), { renderer: fakeRenderer().renderer, reducedMotion: true, box: FIGURE_BOX, eye: EYE });
    a.setMesh(mesh);
    b.setMesh(mesh);
    const small = a.anchors();
    const big = b.anchors();
    for (const k of FACE_REGIONS) {
      expect(big[k].visible).toBe(small[k].visible);
      // Same reference px: canvas px plus each canvas's origin in the frame.
      expect(big[k].x + FIGURE_BOX.x).toBeCloseTo(small[k].x + HOLOGRAM_BOX.x, 6);
      expect(big[k].y + FIGURE_BOX.y).toBeCloseTo(small[k].y + HOLOGRAM_BOX.y, 6);
      expect(typeof big[k].z).toBe('number');
    }
    a.dispose();
    b.dispose();
  });
});

describe('hologram engine: a pass under the hologram', () => {
  it('draws the pass first, then the hologram on a fresh depth buffer, and hands it the anchors', () => {
    const { renderer, calls } = fakeRenderer();
    const frames: HologramPassFrame[] = [];
    let disposed = 0;
    const pass: HologramPass = {
      draw(f) {
        frames.push(f);
        calls.push('pass');
        return false;
      },
      dispose() {
        disposed++;
      },
    };
    const holo = createHologram(fakeCanvas(FIGURE_BOX.w, FIGURE_BOX.h), { renderer, reducedMotion: true, box: FIGURE_BOX, eye: EYE });
    holo.setMesh(mesh);
    calls.length = 0;
    holo.setPass(pass);
    expect(calls).toEqual(['clear', 'pass', 'clearDepth', 'render']);
    const f = frames.at(-1)!;
    expect(f.cssW).toBe(FIGURE_BOX.w);
    expect(f.reducedMotion).toBe(true);
    expect(f.anchors.forehead.visible).toBe(true);
    expect(renderer.autoClear).toBe(true);

    // redraw asks for a frame; replacing the pass disposes the old one; dispose takes the last.
    calls.length = 0;
    holo.redraw();
    expect(calls).toContain('pass');
    holo.setPass(null);
    expect(disposed).toBe(1);
    const second: HologramPass = { draw: () => false, dispose: () => void disposed++ };
    holo.setPass(second);
    holo.dispose();
    expect(disposed).toBe(2);
  });

  it('drops a pass that throws and keeps drawing the hologram', () => {
    const { renderer, calls } = fakeRenderer();
    let disposed = 0;
    const holo = createHologram(fakeCanvas(FIGURE_BOX.w, FIGURE_BOX.h), { renderer, reducedMotion: true });
    const warn = console.warn;
    console.warn = () => {};
    try {
      holo.setPass({
        draw() {
          throw new Error('broken');
        },
        dispose() {
          disposed++;
        },
      });
    } finally {
      console.warn = warn;
    }
    expect(disposed).toBe(1);
    calls.length = 0;
    holo.redraw();
    expect(calls).toEqual(['render']);
    holo.dispose();
  });
});
