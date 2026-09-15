/**
 * Elohim, built from primitives (ARCHITECTURE §5).
 *
 * MVP art direction: intentionally faceted low-poly, no textures, no imported
 * assets. The rig is hierarchical Object3D parts rather than a skinned mesh —
 * for this stylisation it looks the same, costs a fraction as much on an
 * integrated GPU, and needs no asset pipeline at all.
 *
 * The seam that matters is `ElohimAvatar`: a `SpriteAvatar` implementing the same
 * interface can replace this file wholesale without anything else changing.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarContext, ElohimAvatar, Outfit } from './types.ts';
import { PALETTE } from './palette.ts';
import {
  EXPRESSION_POSES,
  GESTURE_CLIPS,
  STATE_POSES,
  VISEME_SHAPES,
  type BodyPose,
  type FacePose,
  type GestureOffsets,
} from './expressions.ts';
import { CharacterStateMachine } from './state-machine.ts';
import { clamp, damp, lerp, nextBlinkDelay, smoothstep, Spring, valueNoise } from '@/lib/math.ts';
import type { CharacterDirective, Viseme } from '@shared/types.ts';

// Anatomy, in metres. One place to retune proportions.
const EYE_Y = 1.580;
const EYE_X = 0.040;
const EYE_Z = 0.079;
const HEAD_Y = 1.565;
const NECK_Y = 1.44;
const CHEST_Y = 1.30;
const HIPS_Y = 0.94;
const MOUTH_Y = 1.518;
const MOUTH_Z = 0.096;
const MOUTH_SEGMENTS = 9;

function flatMaterial(color: number, opts: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
}

/**
 * Smooth shading, for skin only.
 *
 * The art direction is faceted low-poly and it stays that way for everything
 * she is wearing and everything around her. Skin is the exception, and it is
 * not a compromise: at conversation framing her cheek was a single flat plane
 * the size of an eye, and one facet that large stops reading as form and starts
 * reading as a blotch. Smooth skin against faceted cloth is a deliberate
 * contrast — it is what separates a stylised character from an untextured
 * placeholder.
 *
 * This only works because the skull's normals are averaged while the geometry
 * is still indexed, before the merge splits its vertices apart.
 */
function skinMaterial(color: number, opts: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: false, ...opts });
}

/**
 * Segments around a garment lathe.
 *
 * Twelve made a prism, and flat shading turned every one of its facets into a
 * hard highlight — which is what read as white shards across her chest under
 * the clinical key light.
 */
const GARMENT_SEGMENTS = 22;

/** Lathe profile helper: array of [radius, y] pairs. */
function lathe(points: Array<[number, number]>, segments = 10): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

export class ProceduralAvatar implements ElohimAvatar {
  readonly root = new THREE.Group();

  private readonly fsm = new CharacterStateMachine();

  // Hierarchy
  private hips!: THREE.Object3D;
  private chest!: THREE.Object3D;
  private neck!: THREE.Object3D;
  private headPivot!: THREE.Object3D;
  private shoulderL!: THREE.Object3D;
  private shoulderR!: THREE.Object3D;
  private elbowL!: THREE.Object3D;
  private elbowR!: THREE.Object3D;

  // Face parts
  private lidPivot!: THREE.Object3D;
  /**
   * The Duchenne channel. A smile is read from the lower lid rising, not from
   * the mouth — which is why `lidSquint` and `cheekRaise` used to be quietly
   * folded into the upper lid: there was no lower lid for them to drive.
   */
  private lowerLidPivot!: THREE.Object3D;
  private irises!: THREE.Mesh;
  private browL!: THREE.Mesh;
  private browR!: THREE.Mesh;
  private mouth!: THREE.Mesh;
  private mouthPositions!: THREE.BufferAttribute;

  // Garments
  private casualTop!: THREE.Mesh;
  private clinicalCoat!: THREE.Mesh;
  private outfit: Outfit = 'casual';
  private outfitBlend = 0; // 0 = casual, 1 = clinical
  private outfitTarget = 0;
  private outfitRate = 1 / 0.8;

  // Animated scalars
  private readonly leanSpring = new Spring(0, 70);
  private readonly headYawSpring = new Spring(0, 90);
  private readonly headPitchSpring = new Spring(0, 90);
  private readonly headTiltSpring = new Spring(0, 80);
  private face: FacePose = { ...EXPRESSION_POSES.warm };
  private blinkTimer = nextBlinkDelay();
  private blinkPhase = -1;
  private gazeTarget: THREE.Vector3 | null = null;
  private gazeX = 0;
  private gazeY = 0;
  private saccadeTimer = 1.5;
  private saccadeOffset = new THREE.Vector2();

  // Gesture playback
  private gestureClipName: string | null = null;
  private gestureTime = 0;

  // Viseme
  private viseme: Viseme = 'sil';
  private visemeWeight = 0;
  private visemeShape = new THREE.Vector3(1, 0.02, 0);

  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private meshCount = 0;
  private triangleCount = 0;

  /** Surfaced so the app can log rejected directives rather than swallow them. */
  onDirectiveRejected: ((info: { reason: string; detail: string }) => void) | null = null;

  constructor() {
    this.build();
    this.fsm.onRejected = (info) => this.onDirectiveRejected?.(info);
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private track<T extends THREE.Mesh>(mesh: T): T {
    this.disposables.push(mesh.geometry, mesh.material as THREE.Material);
    this.meshCount++;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : mesh.geometry.getAttribute('position').count;
    this.triangleCount += count / 3;
    return mesh;
  }

  private build(): void {
    this.hips = new THREE.Object3D();
    this.hips.position.y = HIPS_Y;
    this.root.add(this.hips);

    this.chest = new THREE.Object3D();
    this.chest.position.y = CHEST_Y - HIPS_Y;
    this.hips.add(this.chest);

    this.buildBody();
    this.buildArms();

    this.neck = new THREE.Object3D();
    this.neck.position.y = NECK_Y - CHEST_Y;
    this.chest.add(this.neck);

    this.headPivot = new THREE.Object3D();
    this.headPivot.position.y = HEAD_Y - NECK_Y;
    this.neck.add(this.headPivot);

    this.buildHead();
    this.buildFace();
  }

  private buildBody(): void {
    // Neck column, skin.
    const neckMesh = this.track(
      new THREE.Mesh(
        lathe(
          [
            [0.042, 0],
            [0.038, 0.05],
            [0.04, 0.1],
          ],
          8,
        ),
        flatMaterial(PALETTE.skinShadow),
      ),
    );
    neckMesh.position.y = NECK_Y - CHEST_Y - 0.02;
    this.chest.add(neckMesh);

    // Torso profile, shared by both garments so the cross-fade lines up exactly.
    const torsoProfile: Array<[number, number]> = [
      [0.0, -0.36],
      [0.115, -0.35],
      [0.122, -0.24],
      [0.108, -0.12],
      [0.115, -0.02],
      [0.128, 0.06],
      [0.112, 0.13],
      [0.055, 0.16],
      [0.0, 0.165],
    ];

    this.casualTop = this.track(
      new THREE.Mesh(
        lathe(torsoProfile, GARMENT_SEGMENTS),
        flatMaterial(PALETTE.casualTop, { transparent: true, opacity: 1 }),
      ),
    );
    this.chest.add(this.casualTop);

    // The coat is its own profile rather than the torso scaled up.
    //
    // Scaling the torso kept its waist pinch, and a pinched waist at radius
    // 0.119 cannot contain hips at radius 0.135 — the lower body's facets
    // punched straight through the coat and read as dark diamonds down her
    // chest. A coat flares over the hips, so this one does, with enough margin
    // that a coarser lathe inside a finer one can never surface through it.
    const coatProfile: Array<[number, number]> = [
      [0.0, -0.54],
      [0.172, -0.53],
      [0.17, -0.4],
      [0.158, -0.28],
      [0.144, -0.14],
      [0.134, -0.02],
      [0.14, 0.06],
      [0.118, 0.13],
      [0.058, 0.16],
      [0.0, 0.165],
    ];

    this.clinicalCoat = this.track(
      new THREE.Mesh(
        lathe(coatProfile, GARMENT_SEGMENTS),
        flatMaterial(PALETTE.clinicalCoat, { transparent: true, opacity: 0 }),
      ),
    );
    this.clinicalCoat.visible = false;
    this.chest.add(this.clinicalCoat);

    // Lower body — one mesh, only visible in wider framings.
    const lower = this.track(
      new THREE.Mesh(
        lathe(
          [
            [0.0, -0.62],
            [0.13, -0.6],
            [0.135, -0.3],
            [0.12, -0.02],
            [0.0, 0.0],
          ],
          // Matched to the garments. A 10-sided silhouette next to a 22-sided
          // one reads as two different characters wearing each other's legs.
          GARMENT_SEGMENTS,
        ),
        flatMaterial(0x1b2231),
      ),
    );
    lower.position.y = -0.02;
    this.chest.add(lower);
  }

  private buildArms(): void {
    const build = (side: 1 | -1) => {
      const shoulder = new THREE.Object3D();
      shoulder.position.set(side * 0.128, 0.1, 0);
      this.chest.add(shoulder);

      const upper = this.track(
        new THREE.Mesh(
          lathe(
            [
              [0.036, 0],
              [0.033, -0.09],
              [0.029, -0.19],
              [0.0, -0.2],
            ],
            7,
          ),
          flatMaterial(PALETTE.casualTop),
        ),
      );
      shoulder.add(upper);

      const elbow = new THREE.Object3D();
      elbow.position.y = -0.19;
      shoulder.add(elbow);

      // Forearm and hand merged — they never move relative to each other.
      const forearmGeo = lathe(
        [
          [0.029, 0],
          [0.026, -0.1],
          [0.023, -0.18],
          [0.0, -0.185],
        ],
        7,
      );
      const handGeo = new THREE.BoxGeometry(0.046, 0.075, 0.022);
      handGeo.translate(0, -0.222, 0);
      const forearm = this.track(
        new THREE.Mesh(
          mergeGeometries([forearmGeo.toNonIndexed(), handGeo.toNonIndexed()])!,
          flatMaterial(PALETTE.skin),
        ),
      );
      elbow.add(forearm);

      return { shoulder, elbow };
    };

    const left = build(1);
    const right = build(-1);
    this.shoulderL = left.shoulder;
    this.elbowL = left.elbow;
    this.shoulderR = right.shoulder;
    this.elbowR = right.elbow;
  }

  /**
   * The skull.
   *
   * A sphere is where this starts and it is what has to be got rid of. The
   * previous version tapered the jaw and stopped, which is most of why she read
   * as a doll: a face is legible because of its *ridges* — brow, cheekbone,
   * chin, temple — and a smooth ovoid has none of them.
   *
   * Every deformation here is a continuous function of the vertex's own
   * position. Nothing branches. An earlier version switched behaviour on
   * `y < 0` and left a facet seam straight across her jaw that read as stubble;
   * under flat shading a discontinuity in the deformation becomes a visible
   * line, every time.
   */
  private buildHead(): void {
    const R = 0.108;
    // 18x14 rather than 16x12. Flat shading is the art direction, but at
    // conversation framing her cheek was a single facet the size of an eye, and
    // one flat plane that big stops reading as form and starts reading as a
    // blotch.
    const skull = new THREE.SphereGeometry(R, 18, 14);
    const pos = skull.getAttribute('position');
    const v = new THREE.Vector3();

    /** A smooth lump: 1 at `centre`, falling away over `width`. */
    const bump = (x: number, centre: number, width: number) => {
      const d = (x - centre) / width;
      return Math.exp(-d * d);
    };

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const nx = v.x / R;
      const ny = v.y / R;
      const nz = v.z / R;

      const below = clamp(-ny); // 0 at the eye line, 1 at the chin
      const front = clamp(nz); // 0 at the ear, 1 at the nose
      const side = Math.abs(nx);

      // Jaw narrowing to a rounded chin, and a face plane flatter than the
      // back of the skull.
      // Most of the narrowing is linear, so the taper starts at the cheekbone
      // instead of staying full width halfway down the face — which is what
      // made her jaw square.
      const jaw = 1 - 0.3 * below - 0.28 * below * below * below;
      const depth = 0.94 + 0.08 * below;
      // Temples pull in a little above the brow — but only a little. At 0.07,
      // with nothing carrying width above it, the whole cranium tapered to a
      // point and she read as an egg with a face drawn on it.
      const temple = 1 - 0.025 * clamp((ny - 0.34) / 0.5);

      // 0.86, not 0.94. A head is roughly three-quarters as wide as it is
      // tall; at 0.94 she was 0.83 and read as a wide moon face.
      // The skull's widest point is the parietal, above and behind the eye —
      // not the cheek. Without this the widest part of her head was her jaw,
      // which is the single strongest "this is a doll" signal a face can send.
      const cranium = 1 + 0.075 * bump(ny, 0.46, 0.34);

      let x = v.x * jaw * 0.86 * temple * cranium;
      let z = v.z * jaw * depth;

      // Brow ridge — a shelf across the front, strongest at the centre.
      z += R * 0.07 * front * bump(ny, 0.39, 0.19) * (1 - 0.3 * side);

      // Cheekbones — mass carried out to the sides, below the eye.
      const cheek = bump(ny, -0.16, 0.24) * bump(side, 0.6, 0.34) * front;
      x += Math.sign(nx || 1) * R * 0.06 * cheek;
      z += R * 0.04 * cheek;

      // Chin — a point at the front, not a rounded underside.
      const chin = Math.max(0, 1 - side * 1.7);
      z += R * 0.13 * front * bump(ny, -0.78, 0.26) * chin;

      // Eye sockets. Without these the eyeballs sit flush with the surface and
      // read as dots painted on an egg — which is exactly what they did.
      z -= R * 0.06 * bump(ny, 0.1, 0.16) * bump(side, 0.37, 0.2) * front;

      // Taller than wide: a spherical head is the clearest "not a person" tell.
      // Less stretch above than below: the face is long, the cranium is not.
      pos.setXYZ(i, x, v.y * (ny < 0 ? 1.19 : 1.05), z);
    }
    skull.computeVertexNormals();

    // Nose: a bridge that widens into a tip, so it has a profile from the side
    // instead of being a stud pressed onto a flat face.
    // A soft form embedded in the face rather than a wedge stuck onto it.
    //
    // Built from a sphere so its normals average smoothly and it belongs to the
    // same surface as the skin around it — a box read as a beak the moment the
    // skull stopped being faceted, because its hard edges were then the only
    // ones on the face.
    const NOSE_R = 0.03;
    const nose = new THREE.SphereGeometry(NOSE_R, 10, 8);
    {
      const np = nose.getAttribute('position');
      for (let i = 0; i < np.count; i++) {
        const t = clamp((np.getY(i) + NOSE_R) / (NOSE_R * 2)); // 0 base, 1 bridge
        // Narrow at the bridge, wider at the nostrils.
        np.setXYZ(
          i,
          np.getX(i) * (0.3 + 0.28 * (1 - t)),
          np.getY(i) * 1.05,
          np.getZ(i) * (0.34 + 0.34 * (1 - t)),
        );
      }
      nose.computeVertexNormals();
    }
    // Its base has to clear the lip line. At 1.2 tall and sitting 14mm low the
    // nostrils met the top of the mouth, and the two merged into one shape the
    // moment she pulled a face.
    nose.translate(0, -0.008, 0.084);

    // An ear runs from about the brow to the base of the nose. These were
    // half that, and sat low enough to read as a jaw defect.
    const ear = new THREE.SphereGeometry(0.024, 6, 5);
    ear.scale(0.34, 1.15, 0.62);
    const earL = ear.clone().translate(0.094, 0.0, -0.004);
    const earR = ear.clone().translate(-0.094, 0.0, -0.004);

    const head = this.track(
      new THREE.Mesh(
        mergeGeometries([skull, nose, earL, earR].map((g) => g.toNonIndexed()))!,
        skinMaterial(PALETTE.skin),
      ),
    );
    this.headPivot.add(head);
    ear.dispose();

    this.headPivot.add(this.buildHair());
  }

  /**
   * Hair.
   *
   * The previous version was a sphere with a wedge cut out of it for the face,
   * and an angular gap has hard edges — from the front those two cut edges read
   * as a pair of dark slabs stuck to the sides of her head.
   *
   * This is one continuous shell instead. Every azimuth gets hair; what varies
   * is *how far down it reaches* — stopping at the hairline across the front,
   * falling past the jaw at the sides, longest at the back. Because that reach
   * varies smoothly there is no cut edge anywhere, only a silhouette.
   */
  private buildHair(): THREE.Mesh {
    // Only about a third of the azimuths cross the face, so a coarse ring
    // turns the hairline into a staircase.
    const AZ = 30; // segments around the head
    const DOWN = 9; // segments from crown to hem
    const RX = 0.118;
    const RY = 0.139;
    const RZ = 0.131;

    /** How far down the hair reaches at this azimuth, as a polar angle. */
    const reach = (phi: number) => {
      // phi = 0 faces +Z, which is her face.
      const a = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))); // 0..π
      const face = 1 - smoothstep(clamp((a - 0.5) / 0.85));
      const back = smoothstep(clamp((a - 1.5) / 1.3));
      return lerp(2.34, 0.86, face) + back * 0.4;
    };

    /**
     * Crown-to-hem profile. A scalp that becomes a curtain: past the equator
     * the surface stops following the skull and hangs.
     *
     * The ramp from hairline to full length has to be *gradual*. Compressed
     * into 26 degrees of azimuth the surface turned almost edge-on to the
     * camera, and a double-sided shell seen edge-on shows its unlit interior —
     * which appeared as two black notches at her temples.
     */
    const shape = (t: number): [number, number] => {
      if (t <= Math.PI / 2) return [Math.sin(t), Math.cos(t)];
      const d = t - Math.PI / 2;
      return [1 + d * 0.05, -d * 0.94];
    };

    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= AZ; i++) {
      const phi = (i / AZ) * Math.PI * 2;
      const tMax = reach(phi);
      // A little low-frequency variation, so it is hair and not a helmet.
      const wob = 1 + Math.cos(phi * 3) * 0.03;
      for (let j = 0; j <= DOWN; j++) {
        // The top ring is a small constant angle rather than the pole: the
        // reach varies per azimuth, so a shared pole would tear.
        const [r, y] = shape(lerp(0.02, tMax, j / DOWN));
        positions.push(
          Math.sin(phi) * r * RX * wob,
          y * RY + 0.007,
          Math.cos(phi) * r * RZ * wob - 0.004,
        );
      }
    }

    for (let i = 0; i < AZ; i++) {
      for (let j = 0; j < DOWN; j++) {
        const a = i * (DOWN + 1) + j;
        const b = a + DOWN + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    shell.setIndex(indices);
    shell.computeVertexNormals();

    const bun = new THREE.SphereGeometry(0.056, 9, 7);
    bun.scale(1, 0.92, 0.86);
    bun.translate(0, -0.03, -0.118);
    // The shell is generated by hand and carries no UVs, and a merge needs the
    // same attribute set on every input. Nothing here is textured, so the
    // cheaper reconciliation is to drop them.
    bun.deleteAttribute('uv');

    return this.track(
      new THREE.Mesh(
        mergeGeometries([shell.toNonIndexed(), bun.toNonIndexed()])!,
        // Double-sided because a shell has an inside, and the hem is open.
        flatMaterial(PALETTE.hair, { side: THREE.DoubleSide }),
      ),
    );
  }

  private buildFace(): void {
    // The eyeball. Flattened in Z so it beds into the socket rather than
    // bulging out of it; everything laid onto it is flattened to match.
    const EYE_R = 0.0208;
    const EYE_FLAT = 0.7;

    const whiteGeo = new THREE.SphereGeometry(EYE_R, 10, 7);
    whiteGeo.scale(1, 0.94, EYE_FLAT);
    const whites = this.track(
      new THREE.Mesh(
        mergeGeometries([
          whiteGeo.clone().translate(EYE_X, EYE_Y - HEAD_Y, EYE_Z).toNonIndexed(),
          whiteGeo.clone().translate(-EYE_X, EYE_Y - HEAD_Y, EYE_Z).toNonIndexed(),
        ])!,
        flatMaterial(PALETTE.eyeWhite),
      ),
    );
    this.headPivot.add(whites);
    whiteGeo.dispose();

    /**
     * A disc lying on the eyeball's surface.
     *
     * Built as a spherical cap and then flattened by the same factor as the
     * eyeball, so it curves with the eye. The old irises were flat circles at a
     * fixed Z — which is why they read as dots painted on, and why they clipped
     * into diamonds whenever she looked to the side.
     */
    const cap = (radius: number, angle: number) => {
      const g = new THREE.SphereGeometry(radius, 12, 4, 0, Math.PI * 2, 0, angle);
      g.rotateX(Math.PI / 2); // the pole now faces +Z
      g.scale(1, 1, EYE_FLAT);
      return g;
    };

    /** Tags a piece with a flat colour so several can share one draw call. */
    const tint = (g: THREE.BufferGeometry, hex: number) => {
      const c = new THREE.Color(hex);
      const n = g.getAttribute('position').count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return g;
    };

    /**
     * Iris, pupil and catchlight for one eye, stacked outwards so that none of
     * them z-fight.
     *
     * Built per side rather than built once and translated twice: the
     * catchlight sits off-centre, and a shared geometry puts it on the same
     * side of both eyes, which is the difference between a person looking at
     * you and a doll.
     */
    const eyeAssembly = (side: 1 | -1) => {
      const glint = cap(0.0215, 0.09);
      glint.rotateX(-0.4);
      glint.rotateY(side * 0.34);
      return [
        tint(cap(0.0209, 0.78), PALETTE.iris),
        tint(cap(0.0211, 0.3), PALETTE.pupil),
        tint(glint, 0xffffff),
      ].map((g) => g.translate(side * EYE_X, EYE_Y - HEAD_Y, EYE_Z).toNonIndexed());
    };

    const eyePieces = [...eyeAssembly(1), ...eyeAssembly(-1)];
    this.irises = this.track(
      new THREE.Mesh(
        mergeGeometries(eyePieces)!,
        // Unlit on purpose: eyes have to stay readable in the clinical room,
        // which is dark enough to swallow a shaded surface.
        new THREE.MeshBasicMaterial({ vertexColors: true }),
      ),
    );
    this.headPivot.add(this.irises);
    for (const g of eyePieces) g.dispose();

    // Upper lids: hemispheres over each eye sharing one X-axis pivot at eye
    // height. Both eyes blink together, so one pivot covers both.
    this.lidPivot = new THREE.Object3D();
    this.lidPivot.position.set(0, EYE_Y - HEAD_Y, EYE_Z);
    this.headPivot.add(this.lidPivot);

    const lidGeo = new THREE.SphereGeometry(0.0228, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.44);
    lidGeo.scale(1, 1, EYE_FLAT + 0.06);
    const lids = this.track(
      new THREE.Mesh(
        mergeGeometries([
          lidGeo.clone().translate(EYE_X, 0, 0).toNonIndexed(),
          lidGeo.clone().translate(-EYE_X, 0, 0).toNonIndexed(),
        ])!,
        flatMaterial(PALETTE.skin),
      ),
    );
    this.lidPivot.add(lids);
    lidGeo.dispose();

    // Lower lids. At rest they cover only the bottom of the eye; raising them
    // is what a genuine smile actually looks like.
    this.lowerLidPivot = new THREE.Object3D();
    this.lowerLidPivot.position.set(0, EYE_Y - HEAD_Y, EYE_Z);
    this.headPivot.add(this.lowerLidPivot);

    const lowGeo = new THREE.SphereGeometry(
      0.0226, 9, 4,
      0, Math.PI * 2,
      Math.PI * 0.72, Math.PI * 0.28,
    );
    lowGeo.scale(1, 1, EYE_FLAT + 0.06);
    const lowerLids = this.track(
      new THREE.Mesh(
        mergeGeometries([
          lowGeo.clone().translate(EYE_X, 0, 0).toNonIndexed(),
          lowGeo.clone().translate(-EYE_X, 0, 0).toNonIndexed(),
        ])!,
        flatMaterial(PALETTE.skin),
      ),
    );
    this.lowerLidPivot.add(lowerLids);
    lowGeo.dispose();

    // Brows stay separate — a single raised brow is worth one extra draw call.
    // Arched and wrapped around the temple rather than a flat slab.
    const browGeo = new THREE.BoxGeometry(0.038, 0.0064, 0.009, 5, 1, 1);
    {
      const bp = browGeo.getAttribute('position');
      for (let i = 0; i < bp.count; i++) {
        const u = clamp(bp.getX(i) / 0.019, -1, 1);
        bp.setY(i, bp.getY(i) * (1 - 0.4 * Math.abs(u)) + 0.0038 * (1 - u * u));
        bp.setZ(i, bp.getZ(i) - 0.011 * u * u);
      }
      browGeo.computeVertexNormals();
    }
    this.browL = this.track(new THREE.Mesh(browGeo, flatMaterial(PALETTE.brow)));
    this.browR = this.track(new THREE.Mesh(browGeo.clone(), flatMaterial(PALETTE.brow)));
    this.browL.position.set(EYE_X, EYE_Y - HEAD_Y + 0.031, EYE_Z + 0.017);
    this.browR.position.set(-EYE_X, EYE_Y - HEAD_Y + 0.031, EYE_Z + 0.017);
    this.headPivot.add(this.browL, this.browR);

    // Mouth: a parametric ribbon whose vertices are rewritten each frame. One
    // mesh gives real smiles, frowns and vowel shapes — a fixed primitive can
    // only ever scale.
    const verts = new Float32Array(MOUTH_SEGMENTS * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i < MOUTH_SEGMENTS - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const mouthGeo = new THREE.BufferGeometry();
    this.mouthPositions = new THREE.BufferAttribute(verts, 3);
    this.mouthPositions.setUsage(THREE.DynamicDrawUsage);
    mouthGeo.setAttribute('position', this.mouthPositions);
    mouthGeo.setIndex(indices);
    this.mouth = this.track(
      new THREE.Mesh(
        mouthGeo,
        new THREE.MeshBasicMaterial({ color: PALETTE.lips, side: THREE.DoubleSide }),
      ),
    );
    this.headPivot.add(this.mouth);
    this.writeMouth(1, 0.02, 0, 0);
  }

  // -------------------------------------------------------------------------
  // ElohimAvatar
  // -------------------------------------------------------------------------

  mount(parent: THREE.Object3D): void {
    parent.add(this.root);
  }

  applyDirective(directive: CharacterDirective | unknown): void {
    const before = this.fsm.state;
    this.fsm.apply(directive);
    const d = this.fsm.directive;

    if (d.gesture !== 'none' && GESTURE_CLIPS[d.gesture]) {
      this.gestureClipName = d.gesture;
      this.gestureTime = 0;
    }
    if (before !== this.fsm.state) {
      // A state change resets the blink schedule so she does not blink on the
      // exact frame she changes posture, which reads as a glitch.
      this.blinkTimer = Math.max(this.blinkTimer, 0.4);
    }
  }

  setOutfit(outfit: Outfit, opts: { transitionSeconds?: number } = {}): void {
    this.outfit = outfit;
    this.outfitTarget = outfit === 'clinical' ? 1 : 0;
    this.outfitRate = 1 / Math.max(0.05, opts.transitionSeconds ?? 0.8);
    this.clinicalCoat.visible = true;
  }

  setViseme(viseme: Viseme, weight: number): void {
    this.viseme = viseme;
    this.visemeWeight = clamp(weight);
  }

  lookAt(target: THREE.Vector3 | null): void {
    this.gazeTarget = target;
  }

  stats(): { meshes: number; triangles: number } {
    return { meshes: this.meshCount, triangles: Math.round(this.triangleCount) };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.removeFromParent();
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  update(dt: number, ctx: AvatarContext): void {
    const pose = this.fsm.update(dt);
    const body = STATE_POSES[pose.state];
    const targetFace = EXPRESSION_POSES[pose.directive.expression];
    const intensity = 0.45 + 0.55 * pose.directive.intensity;

    this.updateFace(dt, targetFace, intensity);
    this.updateGesture(dt);

    const idleScale = ctx.reducedMotion ? 0.15 : body.idleScale;
    this.updateBody(dt, body, ctx, idleScale);
    this.updateGaze(dt, ctx, idleScale);
    this.updateBlink(dt, ctx);
    this.updateMouth(dt, ctx);
    this.updateOutfit(dt);
  }

  private gestureOffsets(): GestureOffsets {
    if (!this.gestureClipName) return {};
    const clip = GESTURE_CLIPS[this.gestureClipName as keyof typeof GESTURE_CLIPS];
    if (!clip) return {};
    const t = clamp(this.gestureTime / clip.duration);
    return clip.sample(t);
  }

  private updateGesture(dt: number): void {
    if (!this.gestureClipName) return;
    const clip = GESTURE_CLIPS[this.gestureClipName as keyof typeof GESTURE_CLIPS];
    if (!clip) {
      this.gestureClipName = null;
      return;
    }
    this.gestureTime += dt;
    if (this.gestureTime >= clip.duration) this.gestureClipName = null;
  }

  /**
   * Applies the expression pose to the rig.
   *
   * `expressions.ts` describes a richer face than this rig has parts for — it
   * names a lower-lid squint, a cheek raise, lip compression and mouth
   * asymmetry, and there is no lower-lid or cheek mesh to move. Rather than
   * drop those channels, they are folded onto the parts that do exist, so the
   * *intent* survives:
   *
   *   - squint and cheek raise close the aperture from the existing upper lid,
   *     which is what makes a smile reach the eyes,
   *   - lip press narrows the resting mouth aperture,
   *   - asymmetry is a real parameter of the mouth ribbon (below).
   *
   * When the rig grows a lower lid and cheeks, these fold-ins are what to
   * replace — the pose vocabulary is already correct.
   */
  private updateFace(dt: number, target: FacePose, intensity: number): void {
    const k = 9;
    const f = this.face;
    const at = (value: number) => value * intensity;

    f.browInner = damp(f.browInner, at(target.browInner), k, dt);
    f.browOuter = damp(f.browOuter, at(target.browOuter), k, dt);
    f.browAsymmetry = damp(f.browAsymmetry, at(target.browAsymmetry), k, dt);
    f.lidOpen = damp(f.lidOpen, lerp(1, target.lidOpen, intensity), k, dt);
    f.lidSquint = damp(f.lidSquint, at(target.lidSquint), k, dt);
    f.cheekRaise = damp(f.cheekRaise, at(target.cheekRaise), k, dt);
    f.mouthCurve = damp(f.mouthCurve, at(target.mouthCurve), k, dt);
    f.mouthWidth = damp(f.mouthWidth, lerp(1, target.mouthWidth, intensity), k, dt);
    f.mouthOpen = damp(f.mouthOpen, at(target.mouthOpen), k, dt);
    f.mouthPress = damp(f.mouthPress, at(target.mouthPress), k, dt);
    f.mouthAsymmetry = damp(f.mouthAsymmetry, at(target.mouthAsymmetry), k, dt);
    f.headTilt = damp(f.headTilt, at(target.headTilt), k, dt);

    // A brow is a line, not a point: its height is the average of the two ends
    // and its angle is the difference between them. Driving inner and outer
    // separately is what allows the concerned shape — inner up, outer down —
    // which cannot be expressed by raising a whole brow.
    const browBase = EYE_Y - HEAD_Y + 0.031;
    const height = (f.browInner + f.browOuter) * 0.5;
    // Positive tilt lifts the inner end. browL sits at +X, which is her left.
    const tilt = (f.browInner - f.browOuter) * 6.5;

    this.browL.position.y = browBase + height + f.browAsymmetry;
    this.browR.position.y = browBase + height;
    this.browL.rotation.z = -tilt;
    this.browR.rotation.z = tilt;

    // The Duchenne channel has geometry now. The lower lid rises into the eye
    // instead of the upper lid being quietly closed to imitate it.
    this.lowerLidPivot.position.y =
      EYE_Y - HEAD_Y + f.lidSquint * 0.0064 + f.cheekRaise * 0.0044;
  }

  /** Upper-lid aperture. */
  private get effectiveLidOpen(): number {
    // Barely folded any more. Squinting used to be faked here because there was
    // no lower lid to do it; now that there is, closing the upper lid as well
    // would shut her eyes rather than narrow them.
    return clamp(this.face.lidOpen - this.face.lidSquint * 0.06);
  }

  private updateBody(dt: number, body: BodyPose, ctx: AvatarContext, idleScale: number): void {
    const g = this.gestureOffsets();
    const t = ctx.elapsed;

    // Always-on idle layers. Small on purpose — see ARCHITECTURE §5.3.
    const breath = Math.sin(t * Math.PI * 2 * 0.22) * 0.006 * idleScale;
    const sway = valueNoise(t * 0.19, 3) * 0.012 * idleScale;
    const driftYaw = valueNoise(t * 0.13, 1) * 0.05 * idleScale;
    const driftPitch = valueNoise(t * 0.11, 2) * 0.028 * idleScale;

    this.chest.position.y = CHEST_Y - HIPS_Y + breath;
    this.chest.scale.setScalar(1 + breath * 0.25);
    this.hips.position.x = sway;
    this.hips.rotation.z = sway * 0.35;

    const lean = this.leanSpring.step(body.lean + (g.lean ?? 0), dt);
    this.chest.rotation.x = lean;

    this.headPivot.rotation.y = this.headYawSpring.step(
      body.headYaw + driftYaw + this.gazeX * 0.55 + (g.headYaw ?? 0),
      dt,
    );
    this.headPivot.rotation.x = this.headPitchSpring.step(
      body.headPitch + driftPitch - this.gazeY * 0.35 + (g.headPitch ?? 0) - lean * 0.5,
      dt,
    );
    this.headPivot.rotation.z = this.headTiltSpring.step(
      this.face.headTilt + (g.headTilt ?? 0) + sway * 0.5,
      dt,
    );

    const applyArm = (
      shoulder: THREE.Object3D,
      elbow: THREE.Object3D,
      base: [number, number, number],
      baseElbow: number,
      offset: [number, number, number] | undefined,
      elbowOffset: number | undefined,
      phase: number,
    ) => {
      const idle = valueNoise(t * 0.17 + phase, 5) * 0.02 * idleScale;
      shoulder.rotation.x = damp(shoulder.rotation.x, base[0] + (offset?.[0] ?? 0) + idle, 8, dt);
      shoulder.rotation.y = damp(shoulder.rotation.y, base[1] + (offset?.[1] ?? 0), 8, dt);
      shoulder.rotation.z = damp(shoulder.rotation.z, base[2] + (offset?.[2] ?? 0), 8, dt);
      elbow.rotation.x = damp(elbow.rotation.x, -(baseElbow + (elbowOffset ?? 0)), 8, dt);
    };

    applyArm(this.shoulderL, this.elbowL, body.armLeft, body.elbowLeft, g.armLeft, g.elbowLeft, 0);
    applyArm(this.shoulderR, this.elbowR, body.armRight, body.elbowRight, g.armRight, g.elbowRight, 11);
  }

  private updateGaze(dt: number, ctx: AvatarContext, idleScale: number): void {
    // Saccades: eyes flick, they do not glide. A smoothly gliding eye is one of
    // the clearest tells that something is not alive.
    this.saccadeTimer -= dt;
    if (this.saccadeTimer <= 0) {
      this.saccadeTimer = 0.7 + Math.random() * 2.4;
      this.saccadeOffset.set(
        (Math.random() - 0.5) * 0.5 * idleScale,
        (Math.random() - 0.5) * 0.3 * idleScale,
      );
    }

    let tx = this.saccadeOffset.x;
    let ty = this.saccadeOffset.y;

    const target = ctx.gazeTarget ?? this.gazeTarget;
    if (target) {
      const local = this.headPivot.worldToLocal(target.clone());
      tx = clamp(Math.atan2(local.x, Math.max(0.1, local.z)) / 0.6, -1, 1) + this.saccadeOffset.x * 0.3;
      ty = clamp(Math.atan2(local.y, Math.max(0.1, local.z)) / 0.6, -1, 1) + this.saccadeOffset.y * 0.3;
    }

    this.gazeX = damp(this.gazeX, tx, 22, dt);
    this.gazeY = damp(this.gazeY, ty, 22, dt);

    // Bounded by the sclera it has to stay inside. The iris is now a disc of
    // radius ~13mm on an eye of half-width 21mm, so it has 8mm of travel — at
    // the previous amplitude it slid off the eyeball at full gaze and clipped
    // against the edge.
    this.irises.position.x = this.gazeX * 0.0055;
    this.irises.position.y = this.gazeY * 0.0038;
  }

  private updateBlink(dt: number, ctx: AvatarContext): void {
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.13;
      if (this.blinkPhase >= 1) {
        this.blinkPhase = -1;
        this.blinkTimer = nextBlinkDelay();
      }
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0 && !ctx.reducedMotion) this.blinkPhase = 0;
      else if (this.blinkTimer <= 0) this.blinkTimer = nextBlinkDelay();
    }

    // Triangular close/open — a blink is not a sine wave.
    const blink = this.blinkPhase < 0 ? 0 : 1 - Math.abs(this.blinkPhase * 2 - 1);
    const openness = clamp(this.effectiveLidOpen * (1 - blink));

    // Open: the cap rotates far enough back to sit behind the brow rather than
    // parking as a visible skin-coloured wedge above the eye. Closed: forward
    // and down over the eyeball.
    this.lidPivot.rotation.x = lerp(0.34, -1.15, openness);
  }

  private updateMouth(dt: number, ctx: AvatarContext): void {
    const [vw, vo, vr] = VISEME_SHAPES[this.viseme];
    const w = this.visemeWeight * clamp(ctx.speechLevel * 1.4 + 0.25 * this.visemeWeight);
    this.visemeShape.x = damp(this.visemeShape.x, lerp(1, vw, w), 26, dt);
    this.visemeShape.y = damp(this.visemeShape.y, lerp(this.face.mouthOpen, vo, w), 26, dt);
    this.visemeShape.z = damp(this.visemeShape.z, vr * w, 20, dt);

    this.writeMouth(
      this.face.mouthWidth * this.visemeShape.x,
      // Pressed lips thin the resting aperture, but must not fight a viseme:
      // she still has to open her mouth to speak while looking determined.
      this.visemeShape.y * (1 - this.face.mouthPress * 0.55 * (1 - w)),
      this.face.mouthCurve,
      this.visemeShape.z,
      this.face.mouthAsymmetry,
    );
  }

  /**
   * Rewrites the mouth ribbon. `curve` lifts the corners (smile) or drops them
   * (frown); `round` pinches the width towards an O; `asymmetry` lifts her left
   * corner only. Perfect bilateral symmetry is one of the loudest "this is a 3D
   * model" tells, and a parametric ribbon gets the fix for almost nothing.
   */
  private writeMouth(
    width: number,
    open: number,
    curve: number,
    round: number,
    asymmetry = 0,
  ): void {
    // A mouth is about a third of the width of a face. At 0.026 half-width it
    // was a fifth, which is why it read as a dot rather than a feature.
    const halfWidth = 0.036 * width * (1 - 0.32 * round);
    const openness = 0.0075 + open * 0.021;
    const array = this.mouthPositions.array as Float32Array;

    for (let i = 0; i < MOUTH_SEGMENTS; i++) {
      const u = i / (MOUTH_SEGMENTS - 1);
      const s = u * 2 - 1;
      const x = s * halfWidth;

      // Corners taper to a point; the centre carries the full aperture.
      const taper = 1 - s * s;
      // s is -1..1 across the mouth; +1 is her left, so ramping on max(0, s)
      // lifts that corner alone.
      const skew = asymmetry * Math.max(0, s) * 9;
      // 5.5, not 8. The corner travel is in metres and the mouth is 72mm
      // wide, so at 8 a full frown dropped the corners 33mm — further than the
      // mouth is wide, which is a cartoon, not an expression.
      const centre = curve * s * s * 5.5 + skew;
      const upper = centre + openness * taper * (0.45 + 0.25 * round);
      const lower = centre - openness * taper * (0.55 + 0.35 * round);

      const zBulge = MOUTH_Z - 0.004 * s * s;
      const base = i * 6;
      array[base] = x;
      array[base + 1] = MOUTH_Y - HEAD_Y + upper;
      array[base + 2] = zBulge;
      array[base + 3] = x;
      array[base + 4] = MOUTH_Y - HEAD_Y + lower;
      array[base + 5] = zBulge;
    }
    this.mouthPositions.needsUpdate = true;
    this.mouth.geometry.computeBoundingSphere();
  }

  private updateOutfit(dt: number): void {
    if (Math.abs(this.outfitBlend - this.outfitTarget) < 0.001) {
      if (this.outfitBlend !== this.outfitTarget) {
        this.outfitBlend = this.outfitTarget;
        this.writeOutfit();
      }
      return;
    }
    const step = this.outfitRate * dt;
    this.outfitBlend +=
      Math.sign(this.outfitTarget - this.outfitBlend) *
      Math.min(step, Math.abs(this.outfitTarget - this.outfitBlend));

    this.writeOutfit();
  }

  /**
   * Cross-fades the two garments.
   *
   * Both meshes are only transparent *while the fade is running*. Left
   * permanently transparent they sort against each other every frame, and the
   * casual top — which used to settle at 0.15 rather than zero — showed through
   * the coat as dark chevrons down her chest. Two translucent lathes 5mm apart
   * cannot be made to look like one garment; the fix is for exactly one of them
   * to be solid whenever the transition is not actually in flight.
   */
  private writeOutfit(): void {
    const blend = this.outfitBlend;
    const coat = this.clinicalCoat.material as THREE.MeshLambertMaterial;
    const top = this.casualTop.material as THREE.MeshLambertMaterial;
    const crossing = blend > 0.001 && blend < 0.999;

    coat.transparent = crossing;
    coat.opacity = crossing ? blend : 1;
    coat.depthWrite = !crossing || blend > 0.5;

    top.transparent = crossing;
    top.opacity = crossing ? 1 - blend : 1;
    top.depthWrite = !crossing || blend <= 0.5;

    this.clinicalCoat.visible = blend > 0.001;
    this.casualTop.visible = blend < 0.999;
  }

  /** Exposed for the transition director's beat 4. */
  get currentOutfit(): Outfit {
    return this.outfit;
  }
}
