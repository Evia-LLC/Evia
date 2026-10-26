# Performance audit

**Scope:** repository inspection on 30 September 2026. This document keeps only
claims verified against the current source tree or a locally generated build.
Speculative ideas are labelled as such; unsupported claims from earlier notes
have been removed.

## Executive conclusion

The highest-confidence opportunities are route-level code splitting, suspending
the WebGL loop when it is not visible, moving pixel-heavy scan calculations off
the main thread, removing base64 image transport, and eliminating duplicate API
and database work. The project already has several effective controls: adaptive
device-pixel-ratio limits, frame pacing, quality probing, dynamic imports for
clinical/OCR/vision features, parallel data loading, and explicit Three.js
resource disposal.

## Verified baseline

### Production bundle

`npx vite build` (bypassing the network-dependent `prebuild`) produced:

| Output | Raw bytes | Gzip |
| --- | ---: | ---: |
| Main application chunk | 410.41 kB | 143.28 kB |
| Three.js chunk | 483.06 kB | 120.92 kB |
| MediaPipe vision bundle | 154.06 kB | 46.00 kB |
| CSS | 84.11 kB | 15.77 kB |

The build also emitted two MediaPipe WASM binaries of approximately 11.8 MB and
11.0 MB. These are static files, not part of the initial JavaScript transfer,
but remain important for scan-time download and storage cost.

### Current architecture that is already sound

- `src/scene/stage.ts` caps DPR using device tier and a pixel budget, probes
  actual frame time, and paces low-tier rendering at the configured target FPS.
- `src/scene/director.ts` dynamically imports clinical and hologram modules.
- MediaPipe, Tesseract, and OCR-related code use dynamic imports.
- `src/state/controller.ts` uses `Promise.all` for several independent data
  loads; `server/ai/context.ts` also parallelizes independent reads.
- Scene, avatar, hologram, and texture classes expose disposal paths.
- Deployment configuration gives immutable caching to `/mediapipe/*`, `/models/*`,
  and `/assets/*`.

## Ordered recommendations

### 1. Split route/page code and scan-only code (high confidence)

`src/App.svelte` statically imports every product and legal page. Vite only has
an explicit manual chunk for Three.js. Convert non-critical pages to dynamic
imports and keep scan/MediaPipe/OCR modules out of the initial route graph.

Prioritize legal pages, history/progress, routine/catalogue, and scan tooling.
Measure initial transfer, parse/evaluation time, and interaction readiness before
and after.

### 2. Do not run the full stage on routes that do not show it (high confidence)

`<ElohimStage />` is mounted before boot/auth/legal route selection. That is a
deliberate UX decision, but legal, privacy, data-rights, and auth routes do not
need a continuously animated clinical/lounging scene. Use a lightweight shell
on those routes, or keep the stage instance but stop its renderer and expensive
updates.

### 3. Suspend rendering while hidden or covered (high confidence)

`Stage.start()` schedules a new `requestAnimationFrame` while `running` is true.
Add `visibilitychange` handling and an `IntersectionObserver` for the canvas.
Stop or reduce the loop when the document is hidden, the canvas is fully covered,
or a non-visual route is active. This should reduce background battery/CPU cost
without changing foreground output.

### 4. Workerize local image analysis (high confidence)

`src/skin-analysis/pipeline.ts` performs canvas copies, multiple `getImageData`
reads, normalization, channel construction, region statistics, metric
calculation, and JPEG encoding in one browser task. Move deterministic pixel
processing to a Web Worker using `ImageBitmap` or transferred buffers. Keep
camera/UI orchestration on the main thread and return compact metrics/results.

Apply the same review to body-analysis code after profiling it; do not assume
both pipelines have identical costs.

### 5. Replace `toDataURL`/base64 image transport (high confidence)

The face pipeline uses `toDataURL(...).split(',')[1]` for provider and canonical
images. Base64 adds roughly one-third representation overhead and creates large
temporary strings. Prefer `toBlob()` and a binary or multipart request. If the
API must remain base64 temporarily, perform conversion only at the final
boundary and cap dimensions/quality explicitly.

### 6. Remove duplicate bootstrap and post-scan work (high confidence)

Bootstrap can issue `/health`, then `/me`, and after a health timeout starts a
second health request while also starting `/me`. Deduplicate these promises or
return capability fields in one authenticated bootstrap response.

The scan persistence endpoint inserts a scan, then separately reloads scan
history and product usage to compute the response summary. Combine this into a
single server operation or transaction where correctness permits.

### 7. Add cache headers for all immutable public binary assets (high confidence)

Netlify and Vercel rules explicitly cover MediaPipe/models/assets, but the
repository also ships content-addressed voice files and other public binaries.
Give immutable voice/character/backdrop/demo files equivalent long-lived cache
headers; revalidate manifests separately. Confirm that the deployed CDN, not
just local Vite, sends the expected cache and content-encoding headers.

### 8. Eliminate transcript-export N+1 queries (medium confidence)

`server/db/chat.ts` loads conversations and then issues one message query per
conversation. Replace this with one ordered join or bounded batched query and
group rows in application code. This matters most for long-lived accounts and
large exports.

### 9. Validate indexes with production-shaped data (medium confidence)

The schema already includes several user/time indexes. Do not add indexes by
guesswork. Run `EXPLAIN (ANALYZE, BUFFERS)` for consent-history, progress-photo,
session-cleanup, message-history, and catalogue-search queries. Add an index
only when the plan and workload demonstrate a gain; account for write/storage
cost.

### 10. Stage image/texture decoding and loading (medium confidence)

Use `decode()`/`createImageBitmap()` where supported, load only the first visible
character/backdrop textures, and defer alternate expressions, demos, history
images, and unused voice lines. Verify actual display dimensions before creating
additional responsive variants.

### 11. Add cancellation and stale-response protection (medium confidence)

Page-level fetches should use `AbortController` and dispose/cancel on route
change. A request sequence guard prevents late responses from updating a page
that has already been replaced. This saves work during rapid navigation and
avoids unnecessary image decoding/state updates.

### 12. Profile before optimizing Three.js internals (conditional)

The stage already exposes draw-call/triangle counters and adapts quality. Use
these plus browser profiling to identify overdraw, transparent effects, material
duplication, or unnecessary updates. Only then consider instancing, geometry
merging, shared materials, or lower-frequency decorative updates.

## Ideas explicitly downgraded or rejected

- Rewriting Svelte, Three.js, or the renderer without evidence of a framework
  bottleneck.
- SSR of the interactive 3D/camera experience.
- Sending/storing larger raw facial captures as a performance tactic; this would
  increase bandwidth, memory, storage, and privacy exposure.
- Adding a service worker before route splitting and CDN caching; stale-content
  invalidation would add complexity.
- Adding replicas/distributed caches before measuring database latency and
  connection saturation.
- Hand-micro-optimizing ordinary TypeScript/Svelte expressions before reducing
  pixel copies, main-thread work, requests, and payload size.

## Measurement plan

Record before/after data for each change:

1. Initial HTML-to-interactive, LCP, INP, and total JS transfer/evaluation.
2. WebGL frame time, draw calls, triangles, DPR, and GPU memory on representative
   low/medium/high devices.
3. Face/body analysis wall time and main-thread blocking duration.
4. API p50/p95 latency and database query timings for bootstrap, scans, routine,
   and exports.
5. Cache hit rate and effective content encoding for static assets.

No optimization should be accepted solely because a bundle-size or benchmark
number moved; verify user-visible latency, battery, correctness, and scan quality.

