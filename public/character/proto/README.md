# Character prototype: stand-in mannequin (`mannequin.glb`)

**This is a placeholder.** It is a neutral, faceless adult mannequin (an art figure or store mannequin), not a
likeness of anyone. It exists so the character prototype, which is **off by default behind a switch**, can test
reaching, pointing, presenting and head gestures next to the Scan hologram before a real character exists. When the
real character arrives, it should keep these bone names and axis conventions so the animation code carries over.

- File: `public/character/proto/mannequin.glb`, served as `/character/proto/mannequin.glb`.
- Generator: `scripts/blender/character_mannequin.py` (Blender 4.5 LTS). It is deterministic, builds everything from
  geometric primitives (no downloads, textures or add-ons), and validates its own export (see the end of this file).

## What is in the file

| | |
|---|---|
| Format | glTF 2.0 binary, 354416 bytes (346 KB). No textures, no UVs, no animations, no morph targets, no extensions |
| Mesh | one `SkinnedMesh` named `Mannequin`: 6,001 vertices, 11,998 triangles, smooth normals. Attributes: `POSITION`, `NORMAL`, `JOINTS_0`, `WEIGHTS_0` (at most 4 influences per vertex, weights sum to 1) |
| Material | `MannequinRoseCream`: base colour `#EBD2C8` (sRGB), roughness 0.62, metallic 0. It is a matte rose-cream. You can replace it at runtime, for example with a `MeshPhysicalMaterial` that adds a little sheen |
| Skeleton | one skin with 55 joints under the node `Armature`. Root joint: `Hips` |

## Space, scale and rest pose

- The file uses **metres, +Y up**. The character **faces +Z**, and its **left side is +X** (the character's own
  left). These are three.js defaults and match Mixamo and Ready Player Me exports.
- The soles rest on **y = 0**. The body is centred on x = 0, and the origin lies on the floor between the feet.
- Height is **1.680 m** to the top of the head. Other rest measurements: shoulder joints at y 1.362, hip joints at
  0.880, knees at 0.480, ankles at 0.080. Fingertip to fingertip in the rest pose is 1.39 m.
- **The rest pose is an A-pose.** The arms hang 40° below horizontal in the frontal plane with straight elbows. The
  palms face down and in: the palm normal is (-0.643, -0.766, 0) on the left hand and (+0.643, -0.766, 0) on the
  right. The fingers are straight and slightly spread. The thumbs are relaxed forward and toward the palm side. The
  legs are straight and the feet are parallel, pointing +Z.

## Skeleton (Mixamo-style names without a prefix)

```
Hips
├─ Spine ─ Spine1 ─ Spine2
│                    ├─ Neck ─ Head ─ Jaw
│                    ├─ LeftShoulder ─ LeftArm ─ LeftForeArm ─ LeftHand
│                    │     LeftHand ─ LeftThumb1 ─ LeftThumb2 ─ LeftThumb3
│                    │     LeftHand ─ LeftIndex1 ─ LeftIndex2 ─ LeftIndex3 ─ LeftIndexTip
│                    │     LeftHand ─ LeftMiddle1..3, LeftRing1..3, LeftPinky1..3
│                    └─ RightShoulder … (mirror of the left side, including RightIndexTip)
├─ LeftUpLeg ─ LeftLeg ─ LeftFoot ─ LeftToeBase
└─ RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase
```

- **`LeftIndexTip` and `RightIndexTip` are pointing markers.** Each is a non-deforming bone whose joint origin sits
  exactly on the fingertip surface of the index finger, and whose local +Y is the direction the finger points.
  `tip.getWorldPosition(v)` gives the fingertip, and `+Y` rotated by `tip.getWorldQuaternion(q)` gives the pointing
  ray. In the rest pose the right tip is at (-0.685, 0.921, 0.024).
- **`Jaw` handles speech.** It is a child of `Head` with its joint near the jaw hinge (y 1.540) and its bone pointing
  to the chin. It carries the lower-front part of the head (141 vertices). A rotation of **+X from 0 to about
  12°** opens it by drooping the chin. The head is faceless, so the movement is subtle. Pair it with small head
  nods for visible speech. The file has no `jawOpen` morph target.
- There are no twist bones, no eye bones, no end bones other than the two index tips, and no IK bones. The file
  carries no bone tails; the table at the end lists them.

## Bone local axes (identical in Blender and in the .glb)

- **Local +Y runs along the bone**, from its joint toward the next joint. The exporter keeps Blender's bone frames:
  every connected child's translation is exactly `(0, length, 0)`.
- **Local +Z** depends on the bone:
  - trunk, neck, head, shoulder, arm, forearm and leg bones: points **forward** (+Z at rest)
  - hand, finger and thumb bones: points along the **palm normal** (out of the palm)
  - foot and toe bones: points **up**
  - `Jaw`: points **down and back**
- **Local +X = Y × Z.**

Pose bones by post-multiplying their rest rotation: `bone.quaternion.copy(rest).multiply(q)`. Here `rest` is
`bone.quaternion` captured right after load, and `q` is a rotation about a local axis. All signs below were checked
numerically in three.js r171 on this file. Each rotation follows the right-hand rule and is applied on its own from
the rest pose.

| bones | +X | +Y (twist) | +Z |
|---|---|---|---|
| `Spine`, `Spine1`, `Spine2`, `Neck`, `Head` | bend or nod **forward** | turn toward **her left** | tilt toward **her right** shoulder (her left ear rises) |
| `Jaw` | **open** (chin down) | – | – |
| `Left/RightShoulder`, `Arm`, `ForeArm` | swing **forward** (shoulder flexion, elbow flexion) | roll: **supination is -Y on the left, +Y on the right** | raise the arm or shrug the shoulder in the A-pose plane: **+Z on the left, -Z on the right** |
| `Left/RightHand` | flex toward the **palm** (-X extends the wrist) | roll (as for ForeArm) | bend toward the thumb side: **+Z on the left, -Z on the right** |
| fingers `…1..3`, thumb `…1..3` | **curl into the palm**. The rest pose is straight | – | spread: the left side moves toward the thumb for +Z, the right side for -Z |
| `Left/RightUpLeg` | thigh **forward** (hip flexion) | – | – |
| `Left/RightLeg` | **-X bends the knee** | – | – |
| `Left/RightFoot`, `ToeBase` | toes **up** | – | – |

The following values were tested for deformation (see Validation):

- shoulder forward and up to horizontal, arms overhead
- elbow up to 125°
- wrist ±50°
- a full finger curl (index 85/100/60°)
- head yaw 40°, tilt 12°
- hip 75° with the knee at 95°

## Recipes that work on this rig (three.js)

The prototype's reach, point and present poses were built with three helpers: aim a bone in world space, solve a
two-bone IK, then roll the palm. This is the code the validation viewer ran against this file:

```js
const Y = new THREE.Vector3(0, 1, 0);
// turn a bone so its +Y (the bone direction) points along a world direction, with minimal rotation
function aim(bone, dirWorld) {
  const q = bone.getWorldQuaternion(new THREE.Quaternion());
  const y = Y.clone().applyQuaternion(q);
  const w = new THREE.Quaternion().setFromUnitVectors(y, dirWorld.clone().normalize()).multiply(q);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(w));
  bone.updateMatrixWorld(true);
}
// analytic two-bone IK: put the wrist (the lower bone's end) at `target`; `pole` = where the elbow should point
function twoBoneIK(upper, lower, hand, target, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3()), E0 = lower.getWorldPosition(new THREE.Vector3());
  const W0 = hand.getWorldPosition(new THREE.Vector3());
  const L1 = S.distanceTo(E0), L2 = E0.distanceTo(W0);
  const D = target.clone().sub(S), d = Math.min(D.length(), (L1 + L2) * 0.995), Dn = D.clone().normalize();
  const a = (L1 * L1 + d * d - L2 * L2) / (2 * d), h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  const p = pole.clone().sub(Dn.clone().multiplyScalar(pole.dot(Dn))).normalize();
  const E = S.clone().addScaledVector(Dn, a).addScaledVector(p, h);
  aim(upper, E.clone().sub(S));
  aim(lower, S.clone().addScaledVector(Dn, d).sub(E));
}
// roll forearm + hand about their own axis so the hand's +Z (palm normal) faces `want` (e.g. up = palm-up present)
function palmTo(foreArm, hand, want, foreArmShare = 0.7) {
  const ax = Y.clone().applyQuaternion(foreArm.getWorldQuaternion(new THREE.Quaternion()));
  const cur = new THREE.Vector3(0, 0, 1).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
  const flat = v => v.sub(ax.clone().multiplyScalar(v.dot(ax))).normalize();
  const c = flat(cur), t = flat(want.clone());
  const ang = Math.atan2(ax.dot(new THREE.Vector3().crossVectors(c, t)), c.dot(t));
  foreArm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y, ang * foreArmShare));
  foreArm.updateMatrixWorld(true);
  hand.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y, ang * (1 - foreArmShare)));
  hand.updateMatrixWorld(true);
}
// turn the hand about the wrist so the index-tip ray passes exactly through `target` (3 passes converge < 0.1 deg)
function pointAt(hand, indexTip, target) {
  for (let i = 0; i < 3; i++) {
    const tip = indexTip.getWorldPosition(new THREE.Vector3());
    const dir = Y.clone().applyQuaternion(indexTip.getWorldQuaternion(new THREE.Quaternion()));
    const w = new THREE.Quaternion().setFromUnitVectors(dir, target.clone().sub(tip).normalize())
      .multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
    hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(w));
    hand.updateMatrixWorld(true);
  }
}
```

- **Palm-up present** (the Scan mockup's gesture): `twoBoneIK(LeftArm, LeftForeArm, LeftHand, wrist in front-left
  at about chest-to-waist height, pole = out/back/down)`, then `palmTo(LeftForeArm, LeftHand, up)`, then the hand
  +X at about -8° and a relaxed curl on the fingers (about 6-15° per joint).
- **Point**: IK the wrist toward the target, then `palmTo(..., down-and-in)`, then `aim(RightHand, target -
  wrist)`, and after the finger curls use `pointAt(RightHand, RightIndexTip, target)`. Set Middle, Ring and Pinky to curls of about 80-95°, 95° and 55°. Leave the index straight, curl
  `RightThumb1` +X 20°, then `aim(RightThumb2, Middle2 - Thumb2)` and `aim(RightThumb3, ~Middle3 - Thumb3)` to tuck
  the thumb onto the curled middle finger. The `RightIndexTip` ray then passes through the target (within 0.1°).
- **Split the forearm roll** about 70% ForeArm and 30% Hand. There are no twist bones, so putting all of the roll on
  `Hand` collapses the wrist.
- **Lean in**: Spine, Spine1 and Spine2 at +X 4-5° and +Y 5-6° each. Head turn and tilt: Neck +Y 10-14°, Head +Y
  20-26°, and Head -Z 8-12° to tilt toward her left, where the hologram sits in the Scan mockup.

## Rest joints (glTF coordinates, metres)

The tail is where the bone ends. glTF does not store tails; they come from the generator. "local +Y" and "local +Z"
are the bone's axes at rest in model space.

| bone | parent | head x, y, z (m) | tail x, y, z (m) | length (m) | local +Y (along bone) | local +Z |
|---|---|---|---|---|---|---|
| Hips | Armature | 0.000, 0.905, -0.012 | 0.000, 0.995, -0.012 | 0.090 | 0.00, 1.00, 0.00 | 0.00, 0.00, 1.00 |
| Spine | Hips | 0.000, 0.995, -0.012 | 0.000, 1.095, -0.010 | 0.100 | 0.00, 1.00, 0.02 | 0.00, -0.02, 1.00 |
| Spine1 | Spine | 0.000, 1.095, -0.010 | 0.000, 1.205, -0.008 | 0.110 | 0.00, 1.00, 0.02 | 0.00, -0.02, 1.00 |
| Spine2 | Spine1 | 0.000, 1.205, -0.008 | 0.000, 1.398, -0.020 | 0.193 | 0.00, 1.00, -0.06 | 0.00, 0.06, 1.00 |
| Neck | Spine2 | 0.000, 1.398, -0.020 | 0.000, 1.505, -0.012 | 0.107 | 0.00, 1.00, 0.07 | 0.00, -0.07, 1.00 |
| Head | Neck | 0.000, 1.505, -0.012 | 0.000, 1.680, -0.008 | 0.175 | 0.00, 1.00, 0.02 | 0.00, -0.02, 1.00 |
| Jaw | Head | 0.000, 1.540, -0.002 | 0.000, 1.470, 0.068 | 0.099 | 0.00, -0.71, 0.71 | 0.00, -0.71, -0.71 |
| LeftShoulder | Spine2 | 0.024, 1.392, -0.014 | 0.160, 1.362, -0.010 | 0.139 | 0.98, -0.22, 0.03 | -0.03, 0.01, 1.00 |
| LeftArm | LeftShoulder | 0.160, 1.362, -0.010 | 0.376, 1.181, -0.010 | 0.282 | 0.77, -0.64, 0.00 | 0.00, 0.00, 1.00 |
| LeftForeArm | LeftArm | 0.376, 1.181, -0.010 | 0.555, 1.030, -0.010 | 0.234 | 0.77, -0.64, 0.00 | 0.00, 0.00, 1.00 |
| LeftHand | LeftForeArm | 0.555, 1.030, -0.010 | 0.622, 0.974, -0.004 | 0.087 | 0.76, -0.64, 0.06 | -0.64, -0.77, 0.00 |
| LeftThumb1 | LeftHand | 0.562, 1.017, 0.006 | 0.577, 0.988, 0.030 | 0.040 | 0.37, -0.71, 0.60 | -0.80, -0.57, -0.19 |
| LeftThumb2 | LeftThumb1 | 0.577, 0.988, 0.030 | 0.591, 0.966, 0.044 | 0.030 | 0.47, -0.75, 0.46 | -0.80, -0.58, -0.13 |
| LeftThumb3 | LeftThumb2 | 0.591, 0.966, 0.044 | 0.602, 0.949, 0.053 | 0.022 | 0.51, -0.75, 0.42 | -0.80, -0.60, -0.11 |
| LeftIndex1 | LeftHand | 0.620, 0.976, 0.013 | 0.649, 0.951, 0.018 | 0.039 | 0.76, -0.64, 0.12 | -0.64, -0.77, 0.00 |
| LeftIndex2 | LeftIndex1 | 0.649, 0.951, 0.018 | 0.667, 0.937, 0.021 | 0.023 | 0.76, -0.64, 0.12 | -0.64, -0.77, 0.00 |
| LeftIndex3 | LeftIndex2 | 0.667, 0.937, 0.021 | 0.680, 0.925, 0.023 | 0.018 | 0.76, -0.64, 0.12 | -0.64, -0.77, 0.00 |
| LeftIndexTip | LeftIndex3 | 0.685, 0.921, 0.024 | 0.694, 0.914, 0.025 | 0.012 | 0.76, -0.64, 0.12 | -0.64, -0.77, 0.00 |
| LeftMiddle1 | LeftHand | 0.622, 0.974, -0.005 | 0.655, 0.947, -0.004 | 0.043 | 0.77, -0.64, 0.00 | -0.64, -0.77, 0.00 |
| LeftMiddle2 | LeftMiddle1 | 0.655, 0.947, -0.005 | 0.675, 0.930, -0.004 | 0.026 | 0.77, -0.64, 0.00 | -0.64, -0.77, 0.00 |
| LeftMiddle3 | LeftMiddle2 | 0.675, 0.930, -0.005 | 0.689, 0.918, -0.004 | 0.019 | 0.77, -0.64, 0.00 | -0.64, -0.77, 0.00 |
| LeftRing1 | LeftHand | 0.619, 0.977, -0.023 | 0.649, 0.951, -0.027 | 0.040 | 0.76, -0.64, -0.12 | -0.64, -0.77, 0.00 |
| LeftRing2 | LeftRing1 | 0.649, 0.951, -0.027 | 0.668, 0.936, -0.030 | 0.025 | 0.76, -0.64, -0.12 | -0.64, -0.77, 0.00 |
| LeftRing3 | LeftRing2 | 0.668, 0.936, -0.030 | 0.682, 0.924, -0.033 | 0.018 | 0.76, -0.64, -0.12 | -0.64, -0.77, 0.00 |
| LeftPinky1 | LeftHand | 0.613, 0.981, -0.039 | 0.636, 0.962, -0.047 | 0.031 | 0.74, -0.62, -0.26 | -0.64, -0.77, 0.00 |
| LeftPinky2 | LeftPinky1 | 0.636, 0.962, -0.047 | 0.650, 0.950, -0.052 | 0.019 | 0.74, -0.62, -0.26 | -0.64, -0.77, 0.00 |
| LeftPinky3 | LeftPinky2 | 0.650, 0.950, -0.052 | 0.662, 0.940, -0.056 | 0.016 | 0.74, -0.62, -0.26 | -0.64, -0.77, 0.00 |
| RightShoulder | Spine2 | -0.024, 1.392, -0.014 | -0.160, 1.362, -0.010 | 0.139 | -0.98, -0.22, 0.03 | 0.03, 0.01, 1.00 |
| RightArm | RightShoulder | -0.160, 1.362, -0.010 | -0.376, 1.181, -0.010 | 0.282 | -0.77, -0.64, 0.00 | 0.00, 0.00, 1.00 |
| RightForeArm | RightArm | -0.376, 1.181, -0.010 | -0.555, 1.030, -0.010 | 0.234 | -0.77, -0.64, 0.00 | 0.00, 0.00, 1.00 |
| RightHand | RightForeArm | -0.555, 1.030, -0.010 | -0.622, 0.974, -0.004 | 0.087 | -0.76, -0.64, 0.06 | 0.64, -0.77, 0.00 |
| RightThumb1 | RightHand | -0.562, 1.017, 0.006 | -0.577, 0.988, 0.030 | 0.040 | -0.37, -0.71, 0.60 | 0.80, -0.57, -0.19 |
| RightThumb2 | RightThumb1 | -0.577, 0.988, 0.030 | -0.591, 0.966, 0.044 | 0.030 | -0.47, -0.75, 0.46 | 0.80, -0.58, -0.13 |
| RightThumb3 | RightThumb2 | -0.591, 0.966, 0.044 | -0.602, 0.949, 0.053 | 0.022 | -0.51, -0.75, 0.42 | 0.80, -0.60, -0.11 |
| RightIndex1 | RightHand | -0.620, 0.976, 0.013 | -0.649, 0.951, 0.018 | 0.039 | -0.76, -0.64, 0.12 | 0.64, -0.77, 0.00 |
| RightIndex2 | RightIndex1 | -0.649, 0.951, 0.018 | -0.667, 0.937, 0.021 | 0.023 | -0.76, -0.64, 0.12 | 0.64, -0.77, 0.00 |
| RightIndex3 | RightIndex2 | -0.667, 0.937, 0.021 | -0.680, 0.925, 0.023 | 0.018 | -0.76, -0.64, 0.12 | 0.64, -0.77, 0.00 |
| RightIndexTip | RightIndex3 | -0.685, 0.921, 0.024 | -0.694, 0.914, 0.025 | 0.012 | -0.76, -0.64, 0.12 | 0.64, -0.77, 0.00 |
| RightMiddle1 | RightHand | -0.622, 0.974, -0.005 | -0.655, 0.947, -0.004 | 0.043 | -0.77, -0.64, 0.00 | 0.64, -0.77, 0.00 |
| RightMiddle2 | RightMiddle1 | -0.655, 0.947, -0.005 | -0.675, 0.930, -0.004 | 0.026 | -0.77, -0.64, 0.00 | 0.64, -0.77, 0.00 |
| RightMiddle3 | RightMiddle2 | -0.675, 0.930, -0.005 | -0.689, 0.918, -0.004 | 0.019 | -0.77, -0.64, 0.00 | 0.64, -0.77, 0.00 |
| RightRing1 | RightHand | -0.619, 0.977, -0.023 | -0.649, 0.951, -0.027 | 0.040 | -0.76, -0.64, -0.12 | 0.64, -0.77, 0.00 |
| RightRing2 | RightRing1 | -0.649, 0.951, -0.027 | -0.668, 0.936, -0.030 | 0.025 | -0.76, -0.64, -0.12 | 0.64, -0.77, 0.00 |
| RightRing3 | RightRing2 | -0.668, 0.936, -0.030 | -0.682, 0.924, -0.033 | 0.018 | -0.76, -0.64, -0.12 | 0.64, -0.77, 0.00 |
| RightPinky1 | RightHand | -0.613, 0.981, -0.039 | -0.636, 0.962, -0.047 | 0.031 | -0.74, -0.62, -0.26 | 0.64, -0.77, 0.00 |
| RightPinky2 | RightPinky1 | -0.636, 0.962, -0.047 | -0.650, 0.950, -0.052 | 0.019 | -0.74, -0.62, -0.26 | 0.64, -0.77, 0.00 |
| RightPinky3 | RightPinky2 | -0.650, 0.950, -0.052 | -0.662, 0.940, -0.056 | 0.016 | -0.74, -0.62, -0.26 | 0.64, -0.77, 0.00 |
| LeftUpLeg | Hips | 0.086, 0.880, -0.006 | 0.097, 0.480, 0.004 | 0.400 | 0.03, -1.00, 0.02 | 0.00, 0.02, 1.00 |
| LeftLeg | LeftUpLeg | 0.097, 0.480, 0.004 | 0.104, 0.080, -0.022 | 0.401 | 0.02, -1.00, -0.06 | 0.00, -0.06, 1.00 |
| LeftFoot | LeftLeg | 0.104, 0.080, -0.022 | 0.108, 0.024, 0.098 | 0.132 | 0.03, -0.42, 0.91 | 0.01, 0.91, 0.42 |
| LeftToeBase | LeftFoot | 0.108, 0.024, 0.098 | 0.110, 0.020, 0.168 | 0.070 | 0.03, -0.06, 1.00 | 0.00, 1.00, 0.06 |
| RightUpLeg | Hips | -0.086, 0.880, -0.006 | -0.097, 0.480, 0.004 | 0.400 | -0.03, -1.00, 0.02 | 0.00, 0.02, 1.00 |
| RightLeg | RightUpLeg | -0.097, 0.480, 0.004 | -0.104, 0.080, -0.022 | 0.401 | -0.02, -1.00, -0.06 | 0.00, -0.06, 1.00 |
| RightFoot | RightLeg | -0.104, 0.080, -0.022 | -0.108, 0.024, 0.098 | 0.132 | -0.03, -0.42, 0.91 | -0.01, 0.91, 0.42 |
| RightToeBase | RightFoot | -0.108, 0.024, 0.098 | -0.110, 0.020, 0.168 | 0.070 | -0.03, -0.06, 1.00 | 0.00, 1.00, 0.06 |

## How it is built

The script evaluates a signed-distance field made of round cones, ellipsoids, an elliptical torso loft and a flat
trapezoid palm. The pieces are joined with smooth-min, which stands in for sculpting. The field is sampled at 2.5 mm
only near the surface. Blender's bundled OpenVDB turns it into a 333k-quad surface. Quadric decimation reduces that
to 12k triangles, then two passes clean up the result: tangential relaxation snapped back onto the full-resolution
surface, and a fold repair guided by the SDF gradient. The armature comes from the same joint table as the body, so
every bone runs through the middle of its limb. Weights come from Blender's bone-heat automatic weighting. The jaw
weights are painted procedurally, and every vertex is limited to 4 influences and normalised.

Rebuild (always through the render lock; the machine is slow):

```sh
tools/blender-render.sh scripts/blender/character_mannequin.py -- --out <workdir>
# --glb PATH (default public/character/proto/mannequin.glb)  --tris 12000  --no-sheet  --save-blend f.blend
```

## Validation (run by the script on every build)

- **Re-import check.** The script loads the exported .glb into an empty Blender scene and confirms:
  - all 55 bone names are present, with none missing and none extra
  - 11,998 faces and height 1.680 m
  - every vertex's weights sum to 1, with at most 4 influences and no unweighted vertices
  - joint positions match the source rig to within 1e-6 m
  - the child translations run along the parent's +Y
- **Contact sheet.** The script poses the re-imported rig and renders a Workbench contact sheet in the work folder
  (`work/char-asset/final/mannequin_sheet.png`, not in the repo). The sheet shows:
  - a 4-view turntable of the rest pose
  - reach forward-right, point, palm-up present, and head turn with tilt and jaw
  - close-ups of the shoulder and elbow, the pointing hand and the palm-up hand
  - the Scan mockup pose (leaning in, presenting palm-up, the other hand on the rim)
  - stress poses: fist, elbow at 125° with wrist at 50°, arms overhead, hip 75° with knee at 95°
- **three.js check.** The same poses were run in three.js r171 (GLTFLoader) with the recipes above.

Known limits:

- The file has no twist bones.
- Arms overhead compress the deltoid.
- The jaw is subtle because the head has no face.
- Finger webs and the crotch are simple creases.
- The back of the seat is slightly soft-lumpy. The Scan camera never sees it.
