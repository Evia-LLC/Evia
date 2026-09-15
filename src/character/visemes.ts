/**
 * Giving a generated character a mouth.
 *
 * Meshy's auto-rigger produces a 24-joint body skeleton — hips, spine, limbs,
 * neck, head — and nothing else. There is no jaw bone and there are no facial
 * blendshapes, so a character who is meant to talk to you arrives unable to
 * move her mouth at all. For a product whose whole premise is a consultant you
 * have a conversation with, that is not a detail.
 *
 * Rather than wait for an asset pipeline that can author blendshapes, this
 * builds them. The mesh already contains a face; what it lacks is any
 * description of which vertices belong to the mouth and how they should move.
 * That description can be derived: the head's own vertices are identifiable
 * from the skin weights, and within that bounding box the mouth sits at a
 * predictable place, because human faces have proportions.
 *
 * Three targets are generated — a jaw that rotates open about a pivot near the
 * ears, a spread, and a purse — and every viseme is a mix of the three. Nothing
 * here is a substitute for a hand-authored face rig. It is the difference
 * between a character who talks and a character who does not.
 */
import * as THREE from 'three';
import type { Viseme } from '@shared/types.ts';

export type MorphName = 'jaw' | 'wide' | 'round';

const MORPH_ORDER: MorphName[] = ['jaw', 'wide', 'round'];

/**
 * Each viseme as a mix of the three shapes.
 *
 * Weights rather than shapes because a mouth is not a set of discrete poses:
 * "oh" is mostly a purse with some jaw, "ee" is mostly a spread with almost
 * none. Driving three continuous channels also means the blend between two
 * visemes is automatically a real shape rather than a cross-fade between two
 * unrelated ones.
 */
const VISEME_MIX: Record<Viseme, [number, number, number]> = {
  //     jaw   wide  round
  sil: [0, 0, 0],
  AA: [1, 0.18, 0],
  EE: [0.24, 0.92, 0],
  IH: [0.34, 0.52, 0],
  OH: [0.6, 0, 0.78],
  OU: [0.28, 0, 1],
  // Lips together. The jaw closes *past* rest, which is what makes a 'm'
  // read as a closed mouth rather than simply an absent one.
  MBP: [-0.12, 0, 0.12],
  FV: [0.14, 0.34, 0],
  L: [0.42, 0.2, 0],
  S: [0.1, 0.48, 0],
};

export interface FaceMorphs {
  mesh: THREE.SkinnedMesh;
  /** Index of each shape within `morphTargetInfluences`. */
  index: Record<MorphName, number>;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * Builds the mouth shapes onto a skinned mesh, in place.
 *
 * Returns null when the mesh has no identifiable head — a different rig, a
 * different joint naming convention — because a silent no-op is better than a
 * character whose face tears.
 */
export function buildVisemeMorphs(mesh: THREE.SkinnedMesh): FaceMorphs | null {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const skinIndex = geometry.attributes.skinIndex;
  const skinWeight = geometry.attributes.skinWeight;
  if (!position || !skinIndex || !skinWeight || !mesh.skeleton) return null;

  const headBone = mesh.skeleton.bones.findIndex((b) => b.name === 'Head');
  if (headBone < 0) return null;

  // --- find the head --------------------------------------------------------
  // How much of each vertex belongs to the head. Used both to locate the face
  // and to fade every deformation out at the jawline, so nothing pulls on the
  // neck or the collar of her coat.
  const headWeight = new Float32Array(position.count);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let found = 0;

  for (let i = 0; i < position.count; i++) {
    let w = 0;
    if (skinIndex.getX(i) === headBone) w += skinWeight.getX(i);
    if (skinIndex.getY(i) === headBone) w += skinWeight.getY(i);
    if (skinIndex.getZ(i) === headBone) w += skinWeight.getZ(i);
    if (skinIndex.getW(i) === headBone) w += skinWeight.getW(i);
    headWeight[i] = w;
    if (w < 0.5) continue;
    found++;
    min.x = Math.min(min.x, position.getX(i));
    min.y = Math.min(min.y, position.getY(i));
    min.z = Math.min(min.z, position.getZ(i));
    max.x = Math.max(max.x, position.getX(i));
    max.y = Math.max(max.y, position.getY(i));
    max.z = Math.max(max.z, position.getZ(i));
  }
  if (found < 200) return null;

  const height = max.y - min.y;
  const depth = max.z - min.z;
  if (height < 1e-4 || depth < 1e-4) return null;

  // --- face landmarks, as proportions of the head ---------------------------
  // Guessed from anatomy rather than measured from this particular mesh, which
  // is what makes this work on a character it has never seen. A head is about
  // as tall as it is from chin to crown, and within that the mouth sits a
  // little above a quarter of the way up.
  const mouthY = min.y + 0.27 * height;
  const jawPivotY = min.y + 0.46 * height;
  const jawPivotZ = min.z + 0.28 * depth;
  const chinY = min.y + 0.05 * height;
  const frontZ = min.z + 0.55 * depth;
  const mouthRadiusX = 0.052 * height;
  const mouthRadiusY = 0.075 * height;

  const jaw = new Float32Array(position.count * 3);
  const wide = new Float32Array(position.count * 3);
  const round = new Float32Array(position.count * 3);

  /**
   * Deliberately small.
   *
   * The generated mesh has no mouth cavity — her lips are one continuous
   * surface with no interior behind them — so a jaw rotation cannot open a
   * mouth, it can only stretch a chin. At 0.3 radians it visibly lengthened her
   * face and the lips stayed shut regardless. What actually reads as speech on
   * a mesh like this is the *lip line* changing shape, so the jaw is reduced to
   * a hint of mass moving and the work is done below, by parting the lips.
   */
  const openAngle = 0.075;

  for (let i = 0; i < position.count; i++) {
    const head = smooth((headWeight[i] - 0.35) / 0.45);
    if (head <= 0) continue;

    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    // --- jaw -----------------------------------------------------------------
    // Rotated about a pivot near the ears rather than translated down, because
    // a jaw is hinged. Translating it slides the chin through the neck.
    if (y < jawPivotY) {
      const t = smooth((jawPivotY - y) / Math.max(1e-5, jawPivotY - chinY));
      const w = t * head;
      if (w > 0) {
        const dy = y - jawPivotY;
        const dz = z - jawPivotZ;
        const a = openAngle * w;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        // Rotation about +X: the chin swings down and back.
        const ny = dy * cos - dz * sin;
        const nz = dy * sin + dz * cos;
        jaw[i * 3 + 1] = ny - dy;
        jaw[i * 3 + 2] = nz - dz;
      }
    }

    // --- lips ---------------------------------------------------------------
    // A soft ellipse around the mouth, front of the face only, so the spread
    // and the purse cannot reach round to her cheeks or the back of her head.
    if (z > frontZ) {
      const dx = x / mouthRadiusX;
      const dy = (y - mouthY) / mouthRadiusY;
      const lip = smooth(1 - Math.sqrt(dx * dx + dy * dy)) * head;
      if (lip > 0) {
        const side = x >= 0 ? 1 : -1;
        const corner = Math.min(1, Math.abs(dx));

        // Part: the upper lip lifts and the lower drops, strongest at the
        // centre and vanishing at the corners. On a sealed mesh this is what
        // opening looks like — the lip line thickens and separates, and the
        // darker lip texture between them reads as a mouth. It rides on the
        // jaw channel so a viseme asking to open gets both at once.
        const centre = 1 - Math.min(1, Math.abs(dx));
        jaw[i * 3 + 1] += Math.sign(y - mouthY || 1) * 0.052 * height * lip * centre;

        // Spread: corners pull outwards and the lips thin slightly.
        wide[i * 3] = side * 0.05 * height * lip * corner;
        wide[i * 3 + 1] = -0.008 * height * lip;

        // Purse: corners draw in and the lips push forward.
        round[i * 3] = -side * 0.042 * height * lip * corner;
        round[i * 3 + 2] = 0.035 * height * lip * (1 - corner * 0.6);
      }
    }
  }

  // Deltas, not absolute positions — otherwise every untouched vertex would
  // have to be written into every target, tripling the memory for nothing.
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute(jaw, 3),
    new THREE.Float32BufferAttribute(wide, 3),
    new THREE.Float32BufferAttribute(round, 3),
  ];

  mesh.morphTargetInfluences = [0, 0, 0];
  mesh.morphTargetDictionary = { jaw: 0, wide: 1, round: 2 };

  const index = { jaw: 0, wide: 1, round: 2 } as Record<MorphName, number>;
  return { mesh, index };
}

/** The three influences a viseme asks for, before any smoothing. */
export function visemeMix(viseme: Viseme, weight: number): [number, number, number] {
  const mix = VISEME_MIX[viseme] ?? VISEME_MIX.sil;
  return [mix[0] * weight, mix[1] * weight, mix[2] * weight];
}

export { MORPH_ORDER };
