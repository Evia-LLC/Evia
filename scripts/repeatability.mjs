/**
 * The calibration study, as a command.
 *
 * The noise floors in `shared/types.ts` claim to be "derived from repeat-capture
 * variance of the same face under varied lighting". That is the right way to
 * set them and it is the one measurement in this project that cannot be done
 * without a real face and a real camera — so this is the harness, ready to run
 * the moment both exist.
 *
 * What it does: takes a folder of captures **of the same person, unchanged**,
 * shot under whatever lighting you can find — window, overhead, lamp, evening,
 * bathroom — runs each through the real pipeline, and reports how far each
 * metric wandered. Nothing about the skin changed between those photos, so
 * every point of spread is measurement error. The floor for a metric should be
 * at or above its observed spread; anything lower licenses the app to report
 * lighting as progress.
 *
 * Usage:
 *   node scripts/repeatability.mjs <folder-of-jpegs>
 *
 * Shoot at least 10, across at least three different lighting conditions, in
 * one sitting. Same face, same day, no makeup change. If you cannot manage
 * three conditions, the result is a floor under the real number rather than the
 * real number, and should be treated as a minimum.
 */
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const folder = process.argv[2];
if (!folder || !existsSync(folder)) {
  console.error('usage: node scripts/repeatability.mjs <folder-of-jpegs>');
  process.exit(2);
}

/*
 * The pipeline is browser code: it wants canvas, ImageData and a DOM. Rather
 * than stub those badly, this drives a real headless browser page that imports
 * the *actual* modules the app ships, so what is measured is what runs.
 */
const files = readdirSync(folder).filter((f) => /\.(jpe?g|png)$/i.test(f));
if (files.length < 5) {
  console.error(`Only ${files.length} images found. Use at least 10 for a usable number.`);
  process.exit(2);
}

console.log(`
This harness needs a browser to run the real pipeline.

  1. Start the app:              npm run dev
  2. Open it, sign in, and open the browser console.
  3. Paste the block below, with your folder served somewhere fetchable
     (dropping the images into public/ is easiest).

The console block prints a table of per-metric spread. Compare each number with
METRIC_NOISE_FLOOR in shared/types.ts: any metric whose spread exceeds its floor
is a metric the app is currently over-claiming on.
`);

const list = JSON.stringify(files.map((f) => `/${path.basename(folder)}/${f}`), null, 2);

console.log(`
// ---- paste from here ----------------------------------------------------
const files = ${list};

const { analyseFace } = await import('/src/skin-analysis/pipeline.ts');
const { SKIN_METRIC_KEYS, METRIC_NOISE_FLOOR } = await import('/shared/types.ts');

const runs = [];
for (const src of files) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const { analysis } = await analyseFace(img, () => {});
  runs.push(analysis.metrics);
  console.log('measured', src);
}

console.table(SKIN_METRIC_KEYS.map((key) => {
  const values = runs.map((m) => m[key]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const spread = Math.max(...values) - Math.min(...values);
  return {
    metric: key,
    mean: +mean.toFixed(1),
    // Two standard deviations covers ~95% of captures; that is the honest floor.
    'suggested floor': +Math.max(2 * sd, 1).toFixed(1),
    'current floor': METRIC_NOISE_FLOOR[key],
    'full spread': +spread.toFixed(1),
    verdict: 2 * sd > METRIC_NOISE_FLOOR[key] ? 'FLOOR TOO LOW' : 'ok',
  };
}));
// ---- to here ------------------------------------------------------------
`);

void pathToFileURL;
