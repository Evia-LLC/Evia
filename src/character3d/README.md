# src/character3d: the character prototype (a stand-in mannequin, off by default)

A **prototype stand-in** for Evia on the Scan page: the plain mannequin in
`public/character/proto/mannequin.glb` (see its README; not a likeness of anyone) standing where ref4 draws
Evia, left of the pedestal. She moves her head, reaches for and points at the region of the hologram being
talked about, gestures while she talks and holds her chin while she thinks. It is a switch, not the product:
BUILD-PLAN decision 3 (no character) still holds for everything else, and with the switch off nothing here
loads and the Scan page is exactly what it was.

## Turning it on

- **Settings, "Character prototype"** (`switch.svelte.ts`): device-local. Stored as `evia.character.proto`
  only with the Functional cookie category allowed (the key is in `FUNCTIONAL_KEYS`, so refusing that
  category clears it); otherwise it lasts as long as the tab, and the Settings description says so. Every
  storage access is in try/catch.
- **`?character=1`** in the address turns it on for the visit (`?character=0` off). Read once at boot and
  stripped from the address like `?sample=`; never stored.

Off: `ScanPage` renders no walkthrough control and no prep canvas, `Consultation` hands `HoloCanvas` no
`character`, the hologram canvas keeps its size, and neither `index.ts` (three.js, the model) nor the model
file is requested. The only code in the entry bundle is the switch, the walkthrough control, the prep host
component and `room.ts` (all three-free).

## Where she is drawn

- **Consultation (desk layout only).** One WebGL context: she is a `HologramPass` (engine.ts) drawn into the
  hologram's own canvas and frame loop, under the hologram. `Consultation` grows that canvas over her place
  (`FIGURE_BOX`, ref x 90..1110, y 0..941) and pins the engine's `eye` on `HOLOGRAM_BOX`'s centre, so the head,
  its anchors and the leader lines are exactly as without her. She shares the engine's DPR cap, quality steps,
  30/60 fps cap, pause when hidden or off-screen, context-loss handling and disposal.
- **Scan prep (capture, desk only).** No hologram exists then, so `CharacterStage.svelte` gives her a canvas
  and renderer of its own (`mountStandalone`: same DPR caps, 30 fps cap, paused when hidden or off-screen,
  disposed on unmount). She gestures at the frame's near edge as it is in view (the consent column runs far
  below the window), the frame's visible part a hard box for her arm.
- **Tablet and phone: omitted.** The tablet composition puts the left callouts where she would stand, and the
  phone's sequential layout gives the hologram the top half and the sheet the rest: there is no room for a
  figure that would not cover the reading. The region-by-region sheet already carries the walkthrough there.

## Placement: the room plate's own camera

`room.ts` holds the consult render's camera and pedestal (anchors.json `camera`, `build.params`,
`ellipses.pedestal_top`; `test/character3d-room.test.ts` fails if a re-render moves them): a level camera
1.37 m up, 50 mm on the over-scanned 43.2 mm sensor, horizon at ref y 438.9. Her camera is that camera laid
over wherever the page draws the plate (`plate`, canvas px, from `ConsultBackdrop`'s `onrect`; the default
ref4 framing when no render is loaded), so she shares its perspective at any window shape: she stands on its
floor 4.36 m out, at x -0.9 m, turned 26 degrees toward the hologram, scaled to the mockup's figure (about
1.82 m; ref4 draws Evia that tall at that depth).

Two **depth-only occluders** put the room back in front of her, with nothing of the room redrawn (what they
hide shows the plate underneath): the pedestal drum (radius 0.9 m, top 0.9 m) and the foreground render's
alpha (`fg-1280.webp`: books, ledge, the pedestal's band) except over the pedestal's glass top, where her hand
rests on the rim above it.

A region's **point** is the spot the hologram draws for it (the leader line's end). She reaches for the point on
that spot's camera ray nearest her shoulder (`reachTarget`): on screen her fingertip lands on the spot and her
index runs along the ray through it, while in the room the hand stays where an arm from her place can get
(behind the translucent head, which is drawn over it). Her eyes go to the spot on the face itself
(`regionTarget`). Without a visible anchor the region's place on the sample face (`REGION_REF`) stands in.

## Motion

```
director.character + lit region + anchors  ->  behaviour.ts (decide)  ->  intent
intent  ->  world targets (character.ts)  ->  critically damped springs (spring.ts)  ->  rig.ts / ik.ts
                                              + beat strokes, idle drift, talking head (after the springs)
```

| director says | she does |
|---|---|
| a region lit (`hologram.activeRegion`, via the page's active callout) | turns head and eyes to its spot and reaches her left (nearer) hand onto it, her weight onto the pedestal-side foot; keeps reaching while she talks about it (and 1.6 s after, so the pause before the next region is not a drop and a re-point), at most 12 s unless a voice is still on it |
| `open_palms` / `small_wave` while reaching | an open-palm beat of the other hand (off the rim for 1.9 s): the point never breaks |
| nothing lit | the ref4 pose: leaning in, left palm up toward the head (drifting a little), right hand on the rim |
| `open_palms` / `small_wave`, nothing lit | the palm-up hand opens toward the head for 1.9 s |
| speaking (`speaking`, `mouthOpen`) | jaw 0..20 degrees from the audible mouth only (zero when nothing is heard); on each stressed onset of that mouth (the mouth opening past 0.42, at most one per 0.6 s) a beat stroke: the pointing hand jabs 4 cm along its line, the palm-up hand strokes down 5 cm, the head nods 6 degrees and tilts 4 to alternate sides; the head also follows the mouth (up a little as it opens) and turns slowly over the line |
| `nod`, `slow_nod`, `head_tilt`, `lean_in` | head / body impulses played once over the held arm pose |
| THINKING / `hand_to_chin` | the pensive hand: right index up along the chin (the finger's last knuckle on it), the other fingers curled, elbow at most about 124 degrees; looks away to her right |
| LISTENING | a head tilt toward you, arms relaxed |
| idle | breathing (4.2 s: chest, clavicles), a weight shift from foot to foot (8.5 s, the pelvis moving over the planted feet, the free knee softening), the head drifting, the resting hand drifting, a glance at you every 3-6.5 s |
| scan prep (capture) | steps in toward the pedestal when the frame leaves room, or steps aside when its panel stands right beside her (the consent column), and presents it with an open palm, the whole arm off the panel |
| arriving | fades in where she stands (0.8 s) while her arms come up from her sides (no glide) |

- **Reaching** (`reach.ts`): the whole arm is planned against the page's boxes (the left callouts, the card
  tray; in scan prep the frame's panel): upper arm, elbow, forearm, hand and fingertip, at their thickness.
  The callout being read and the tray are **hard**: no part of the arm passes under them. A callout not
  being read is **soft**: the arm may pass in front of it, and the page fades it (and its leader) to 12%
  while it does (`onyield`, `.slot.is-yielding`), the way a presenter steps in front of a slide she is not
  talking about. Among the reaches that keep the hard boxes clear, the nearest fingertip wins, with a cost
  per card faded and a little for turning off the straight line or bending the elbow; the wrist is never
  asked to bend more than 58 degrees. Candidates: the straight line, raised and lowered (the presenter's
  point from below, or from above over a card), the elbow hanging, held out or raised. The plan is made
  once per region from the canonical pointing pose (no breath, sway or shrug), so a region always gets the
  same reach whatever she did before, and kept as an offset from the shoulder.
- **IK** (`ik.ts`): analytic two-bone solve with a hinge elbow (the upper arm rolled so the elbow flexes
  only about its own X, 4-130 degrees: the mannequin's skin creases past that), a pole for where the elbow
  points, the shoulder kept to its natural range measured in the upper chest's frame (not behind the body,
  across the chest or straight up; a hand brought to the chin may cross further), pronation split 70/30
  forearm/hand (no twist bones), the wrist held to 70 degrees swing and 50 twist, and an exact index point
  (the `...IndexTip` ray turned through the target, then corrective passes).
- **Springs**: every target (wrist, pole, hand direction, palm, finger curls, point weight, look, lean, step,
  weight shift) eases with a critically damped spring: continuous, never overshooting. A hand travelling
  far relaxes its point and points again as it arrives, and a hand turns at most 6 rad/s, so a reach from
  below becoming one from above turns the hand over instead of flipping it. A reach takes about 0.6 s.
- **Reduced motion** (system setting or the account's): springs snap (reaches are instant), no breathing,
  sway, drift, beats, idle glances or stride, the page's card fades are instant, and frames are drawn only
  when something changes (the engine's rule; the host asks for a frame on every director change).

Nothing about her is stored, and she reads nothing of the user: from the reading she only learns which region
is lit and where the hologram draws it.

## Sample walkthrough

`WalkthroughControl.svelte` (sample mode, desk, switch on) runs `sampleWalk` (walkthrough.ts) over
`SAMPLE_WALKTHROUGH` (src/sample/fixtures/scan.ts): forehead, pores / T-zone, cheeks, under-eyes, chin. Each
step is the director's own calls - `elohimSpoke` (then the voice, if Evia's voice is on in Settings) and
`revealRegion` - and the page's sample view lights the matching callout, its leader and the hologram zone
from `hologram.activeRegion` (`sampleView`), **only while the walkthrough runs** (`walkthrough.running` in
switch.svelte.ts): a stop, the end, or leaving the page lights nothing (the next visit starts unlit). A stop
also silences her and releases every held pose (IDLE, no gesture); the end is an open-palm beat to you.
Each step lasts as long as its line takes to say, plus a pause. The line is shown beside the button
(aria-live); only a heard line moves her jaw.

## Files

| file | what |
|---|---|
| `switch.svelte.ts` | the switch (three-free, entry bundle) |
| `room.ts` | the plate's camera, pedestal and hologram in metres; region targets (three-free) |
| `spring.ts` | critically damped springs |
| `ik.ts` | two-bone hinge IK, shoulder and wrist limits, palm roll, exact point |
| `reach.ts` | the whole-arm reach plan against the page's boxes (hard / soft, which cards fade) |
| `behaviour.ts` | director snapshot -> intent (three-free) |
| `rig.ts` | the mannequin's bones posed from world targets |
| `character.ts` | the figure: model, lights, occluders, camera, springs; `createCharacter`, `mountStandalone` |
| `walkthrough.ts`, `WalkthroughControl.svelte` | "Walk me through it" (`sampleWalk`: the director's calls and the view's gate) |
| `CharacterStage.svelte` | the scan-prep host |
| `index.ts` | lazy barrel (three.js) |

Tests: `test/character3d-{ik,room,rig,behaviour,switch,walkthrough,engine}.test.ts` (the rig test drives the
real `mannequin.glb` in Node).

In development the figure is on `window.__evia.character` while it is on the page (`pass.report`: the reach
mode, fingertip / ray / target / elbow / wrist / chin / head on screen, pointing and gaze error, jaw, beat,
the cards it is fading, the chin gap; `stage`: the placement numbers, live); the handle goes with the figure.
