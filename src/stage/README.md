# src/stage: the 2D stage director

`director.ts` is the contract (the `Director` interface and its types). `director.svelte.ts` is the
implementation and the one singleton, `director`. `App.svelte` registers it with the controller at
boot (`registerDirector(director)`), which installs the controller's hooks and hands it to the voice
pipeline. It replaces the three.js `SessionDirector` method for method. Nothing in it draws.

```ts
import { director } from '@/stage/director.ts';
```

Components only **read** `director.character` and `director.hologram` (every field is reactive, so
reading one in markup or `$derived` subscribes to it). The controller and the voice pipeline are the
only writers. Components talk back through the few input methods listed at the end.

## `director.character`: for the character (none is drawn yet; the state is kept for when one is)

| field | type | meaning |
|---|---|---|
| `state` | `CharacterState` | The state from `shared/character-fsm.ts`, after its transition rules: IDLE, LISTENING, THINKING, SPEAKING, HAPPY, CONCERNED, EXCITED, CONFUSED, CLINICAL_ANALYSIS, ANALYSIS_COMPLETE, EXPLAINING, GOODBYE. Pick the pose from this. |
| `expression` | `Expression` | neutral, warm, smile, grin, concerned, curious, reassuring, focused, surprised. Drives brows, eyes and the resting mouth. |
| `gesture` | `ActiveGesture \| null` | nod, slow_nod, head_tilt, small_wave, open_palms, point_to_hologram, hand_to_chin, lean_in, or `null` at rest. `open_palms`, `point_to_hologram` and `small_wave` are held arm poses; the others are head/body impulses that play once. |
| `gestureSeq` | `number` | Bumped whenever a gesture (re)starts, including the same gesture again. Key the impulse animation on it (`{#key director.character.gestureSeq}`), so a second nod plays. |
| `intensity` | `number` 0..1 | How strongly to play the expression. |
| `speaking` | `boolean` | A voice is audibly speaking through her mouth right now. |
| `viseme` | `Viseme` | `sil AA EE IH OH OU MBP FV L S`. Updated every animation frame while a line plays. |
| `mouthOpen` | `number` 0..1 | How far into that shape. Always 0 when nothing audible plays (voice off still runs the line's timing, with lips shut). Use `mouthShapeFor(viseme, mouthOpen, expression)` from `src/character-svg/mouth-chart.ts`; it covers every viseme and closes the mouth below `MOUTH_SILENT_BELOW`. |
| `gazeX`, `gazeY` | `number` -1..1 | Where she looks, from straight at the viewer (0, 0): x toward the viewer's right, y down. Set as jumps; ease them in CSS (a transition of about 250 ms reads as eyes, not a slide). |
| `attention` | `'viewer' \| 'hologram'` | What has her eye when nothing more specific does. The gaze already reflects it. |

Motion is the figure's job: honour `prefers-reduced-motion` and
`session.user?.preferences.reducedMotion` when animating gestures, blinks and breathing. The director
publishes the same values either way (it only shortens the room walk under reduced motion).

## `director.hologram`: for the scan page (`src/pages/scan/`, `src/hologram/`)

Nothing here is persisted, and all of it is cleared when she leaves the consult room
(`exitClinical`), on sign-out and on account deletion (`reset`).

| field | type | meaning |
|---|---|---|
| `mesh` | `ScanMesh \| null` (`src/scan/mesh.ts`) | The live face mesh from this capture. Set as the analysis lands; **cleared by the controller when the presentation ends** (after her `scan_complete` reply), which is the facial-geometry lifetime the privacy test enforces. `MESH_REGION_ANCHORS` and `normaliseMesh` in `mesh.ts` are the three-free helpers from the old rig. |
| `analysis` | `SkinAnalysis \| null` | The skin reading being presented (`presentAnalysis`). |
| `previous` | `SkinAnalysis \| null` | The reading it is compared against, or null on a first scan. |
| `sentiment` | `'improving' \| 'declining' \| 'steady' \| null` | How it moved, as her delivery reads it. |
| `body` | `{ analysis, previous } \| null` | A body reading instead (`presentBody`); `analysis`, `revealQueue`, `revealed` and `activeRegion` are empty then. |
| `revealQueue` | `SkinMetricKey[]` | The metrics her narration names, in order (`narrationFor` in `src/scan/choreography.ts`). Empty for an all-clear. |
| `revealed` | `SkinMetricKey[]` | Lit so far. With her voice on, each lights as she reaches its clause; with it off, a timer lights one every 1.1 s after a 1.4 s grace. |
| `activeRegion` | `SkinMetricKey \| null` | The metric she is talking about right now. It is a **metric key** (hydration, redness, ...), not a face region; map it to regions with `METRIC_REGIONS` (`src/skin-analysis/metrics.ts`) or your own table. |
| `capture` | `string \| null` | The measured frame as a `data:image/jpeg` URL, in memory only. |
| `demo` | `unknown \| null` | A demonstration clip. Nothing supplies one today (`demoForBody` returns null). |

Related session fields the director writes: `session.sceneMode` (`'lounge'` → `'transitioning'` →
`'clinical'` on `enterClinical`, about 0.9 s; back via `'transitioning'` on `exitClinical`, about
0.45 s; both instant under reduced motion), `session.panelMode` (`'scan'`/`'routine'`) and
`session.scanProgress`/`session.scanStage` (the real pipeline's progress, 0..1).

## Input from components

- `director.pokeAt('face' | 'body')`: a tap landed on her (the figure decides the zone from which
  part was hit). She reacts for 2.2 s and the controller may say a line.
- `director.acknowledgeTouch()`: a tap near her but not on her.
- `director.glanceAtScreen(x, y, seconds?)`: look at a point for a moment, in the gaze units above
  (for a tap: `x = (clientX - figureCentreX) / (figureWidth / 2)`, likewise y).
- `director.setHologramDirection(x, y)`: where the hologram sits from her point of view, so her
  reading glances land on it. Defaults to (0.55, 0.1): a little to the viewer's right, slightly down.
- `director.pickMetric(key)`: a metric callout on the hologram was picked; she explains it.

In development the director is also on `window.__evia.director`, next to `session`, `sample` and
`router`. `director.step(dt)` advances a line by hand when the pane throttles animation frames.
