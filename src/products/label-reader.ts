/**
 * Reading a product label (brief §10).
 *
 * Two providers behind one interface, same pattern as the face ROI detectors:
 *
 * - `OcrLabelReader` runs Tesseract entirely in the browser. No key, no upload,
 *   works offline. This is the default because label photos are personal data
 *   too and there is no reason to ship them anywhere.
 * - `VisionLabelReader` posts the crop to the server, which asks Claude. Better
 *   on curved bottles and bad lighting, but it requires a key and it means the
 *   image leaves the device — so it is opt-in behind the same cloud-reasoning
 *   consent as the face scan.
 *
 * Both return the same `LabelRead`, and both are honest about confidence.
 */
import { parseIngredients, type ParsedLabel } from './inci.ts';
import { api } from '@/lib/api.ts';

export interface LabelRead extends ParsedLabel {
  /** 0..1 — how much of the text the reader was sure about. */
  confidence: number;
  provider: string;
  rawText: string;
}

export interface LabelReader {
  readonly name: string;
  read(source: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<LabelRead>;
  dispose(): Promise<void>;
}

/**
 * Ingredient panels are small, dense and low contrast. Binarising and
 * upscaling before OCR is worth far more than any tuning of the recogniser.
 */
export function preprocessForOcr(source: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;

  // Upscale small crops: Tesseract wants roughly 30px of x-height.
  const scale = Math.min(3, Math.max(1, 1600 / Math.max(width, height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  // Greyscale, then local contrast stretch against the image's own histogram —
  // a global threshold loses text wherever the bottle curves into shadow.
  const grey = new Float32Array(canvas.width * canvas.height);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grey[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const stretched = ((grey[p] - min) / range) * 255;
    // Gentle S-curve: darkens ink, lifts the substrate, without clipping either.
    const v = stretched < 128 ? stretched * 0.72 : 255 - (255 - stretched) * 0.72;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Browser-local OCR. Loads its worker lazily — it is a few MB of wasm. */
export class OcrLabelReader implements LabelReader {
  readonly name = 'tesseract-local';
  private worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;

  private async ensureWorker(onProgress?: (p: number) => void) {
    if (this.worker) return this.worker;
    const { createWorker } = await import('tesseract.js');
    this.worker = await createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        // Model download and recognition both report here; only the recognition
        // phase is meaningful to the user.
        if (m.status === 'recognizing text') onProgress?.(m.progress);
      },
    });
    return this.worker;
  }

  async read(source: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<LabelRead> {
    const worker = await this.ensureWorker(onProgress);
    const prepared = preprocessForOcr(source);
    const { data } = await worker.recognize(prepared);

    const parsed = parseIngredients(data.text ?? '');
    return {
      ...parsed,
      // Tesseract reports 0-100; treat a missing confidence as unknown, not perfect.
      confidence: Math.min(1, Math.max(0, (data.confidence ?? 0) / 100)),
      provider: this.name,
      rawText: data.text ?? '',
    };
  }

  async dispose(): Promise<void> {
    await this.worker?.terminate();
    this.worker = null;
  }
}

/** Server-side vision read. Requires a key and explicit cloud consent. */
export class VisionLabelReader implements LabelReader {
  readonly name = 'claude-vision';

  async read(source: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<LabelRead> {
    onProgress?.(0.2);
    const base64 = source.toDataURL('image/jpeg', 0.9).split(',')[1];
    const { ingredients, rawText, confidence } = await api.readLabel(base64);
    onProgress?.(1);

    // Still run the parser: the model returns a list, but normalising through
    // the same path keeps naming consistent with hand-entered products.
    const parsed = parseIngredients(ingredients.join(', '));
    return {
      ...parsed,
      ingredients: parsed.ingredients.length ? parsed.ingredients : ingredients,
      confidence,
      provider: this.name,
      rawText,
    };
  }

  async dispose(): Promise<void> {}
}

/**
 * Picks a reader. Local OCR unless the user has opted into cloud reasoning and
 * a key is configured — privacy is the default, not the fallback.
 */
export function pickLabelReader(opts: {
  cloudConsent: boolean;
  modelAvailable: boolean;
}): LabelReader {
  return opts.cloudConsent && opts.modelAvailable ? new VisionLabelReader() : new OcrLabelReader();
}
