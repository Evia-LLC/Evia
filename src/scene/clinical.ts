/** The clinical studio: real shelving, treatment furniture and inset architecture. */
import * as THREE from 'three';
import { LIGHTING } from '@/character/palette.ts';
import type { EnvironmentLights, ElohimEnvironment } from './environment.ts';
import { clamp } from '@/lib/math.ts';
import { RoomGeometry } from './room-geometry.ts';
import type { XYZ } from './room-geometry.ts';

export class ClinicalEnvironment implements ElohimEnvironment {
  readonly group = new THREE.Group();
  readonly lights: EnvironmentLights;
  readonly background = new THREE.Color(0x090a12);
  private room = new RoomGeometry();
  private presence = 0;
  private baseIntensities: readonly [number, number, number];
  private particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private disposed = false;

  constructor(opts: { particles?: boolean } = {}) {
    const cfg = LIGHTING.clinical;
    const key = new THREE.DirectionalLight(cfg.key.color, 0);
    key.position.set(...cfg.key.position); key.target.position.set(0, 1.2, -3.1);
    const rim = new THREE.DirectionalLight(cfg.rim.color, 0);
    rim.position.set(...cfg.rim.position); rim.target.position.set(-.4, 1.2, -4.2);
    const ambient = new THREE.AmbientLight(0xb0b8d0, 0);
    this.lights = { key, rim, ambient };
    this.baseIntensities = [cfg.key.intensity, cfg.rim.intensity, 1.02];
    this.group.name = 'ClinicalEnvironment';
    this.group.add(key, key.target, rim, rim.target, ambient, this.room.group);
    this.buildRoom(); this.room.finish('Clinical studio');
    if (opts.particles !== false) this.buildParticles();
    this.setPresence(0);
  }

  private buildRoom(): void {
    const r = this.room;
    const wall = r.surface('Indigo architectural plaster', 0x343444, .76);
    const dark = r.surface('Shadow recesses', 0x0c0e19, .66);
    const floor = r.surface('Polished graphite floor', 0x313747, .18, .25, .045);
    const ceiling = r.surface('Satin indigo ceiling', 0x353449, .44, .12, .16);
    const trim = r.surface('Satin titanium', 0x697888, .31, .58);
    const bronze = r.surface('Champagne alcove trim', 0x9a887e, .4, .30);
    const cushion = r.surface('Lavender upholstery', 0xaaa5b4, .78, 0, .035);
    const seam = r.surface('Upholstery piping', 0x484958, .83);
    const ivory = r.surface('Porcelain products', 0xc2c9d0, .31);
    const bottle = r.surface('Blue glass products', 0x446176, .20, .26);
    const leaf = r.surface('Deep green plants', 0x253e3f, .81);
    const cyan = r.light('Cyan shelf and ceiling diffusers', 0xa8e9f3);
    const violet = r.light('Violet inset diffusers', 0xb6a6ed);
    const warm = r.light('Warm white alcove diffusers', 0xe4c9b0);
    const panel = r.surface('Violet wave panel', 0x36314f, .40, .12, .27);
    const wave = r.light('Fine violet wave tracery', 0x8f82bd);
    const reflected = r.light('Soft reflected architectural light', 0xffffff, .56, true);
    const shadow = r.light('Furniture contact shading', 0xffffff, .58);
    r.grain(floor, 18, .010); r.grain(wall, 9, .006); r.grain(cushion, 14, .004);
    r.marble(floor, 0x343945, 0x9d9ca8);

    // Thick shell, panel joints, recessed skirting, and open camera-side wall.
    r.box(floor, [6.1, .14, 9.5], [0, -.085, -2.1]);
    r.box(wall, [6, 3.43, .17], [0, 1.69, -6.42]);
    r.box(wall, [.16, 3.43, 8.8], [-2.98, 1.69, -2.0]);
    r.box(wall, [.16, 3.43, 8.8], [2.98, 1.69, -2.0]);
    r.box(ceiling, [6.1, .17, 9.2], [0, 3.45, -2.1]);
    for (const x of [-2.83, 2.83]) {
      r.box(dark, [.065, .115, 8.6], [x, .08, -2.0]);
      r.box(trim, [.018, .024, 8.6], [x, .144, -2.0]);
    }
    for (const z of [-5.8, -3.15, -.6]) for (const x of [-2.86, 2.86]) r.box(dark, [.008, 2.85, .014], [x, 1.69, z]);

    // The left illuminated rounded display is a deep recess, not a shelf image.
    r.box(dark, [.23, 3.00, 3.85], [-2.82, 1.68, -3.87], .12);
    r.box(bottle, [.025, 2.73, 3.54], [-2.682, 1.69, -3.87], .008, [0, 0, 0], .35);
    r.frame(trim, 3.77, 2.94, .25, .066, [-2.54, 1.68, -3.87], [0, Math.PI / 2, 0]);
    r.frame(cyan, 3.69, 2.87, .23, .015, [-2.494, 1.68, -3.87], [0, Math.PI / 2, 0]);
    r.box(wall, [.43, .44, 3.44], [-2.48, .48, -3.87], .025);
    for (let i = 0; i < 5; i++) r.box(dark, [.008, .33, .009], [-2.259, .49, -5.31 + i * .70]);
    const levels = [.76, 1.27, 1.83, 2.40];
    for (let row = 0; row < levels.length; row++) {
      const y = levels[row];
      r.box(trim, [.46, .027, 3.43], [-2.475, y, -3.87], .004);
      r.box(cyan, [.017, .017, 3.43], [-2.235, y - .026, -3.87]);
      r.recessShade(shadow, 3.44, .46, [-2.662, y + .255, -3.87], [0, Math.PI / 2, 0], .86);
      for (let i = 0; i < 8; i++) {
        const z = -5.36 + i * .416;
        r.bottle((i + row) % 3 ? ivory : bottle, trim, ivory, [-2.40 + (i % 2) * .06, y + .017, z], .18 + ((i + row) % 3) * .069, .040 + (i % 3) * .008, i + row);
      }
    }
    // The slim neighboring column and its illuminated niche.
    r.box(wall, [.36, 3.25, .31], [-2.16, 1.63, -5.94], .12);
    r.box(panel, [.045, 1.70, .54], [-2.40, 1.77, -1.59], .02);
    r.frame(violet, .55, 1.81, .19, .016, [-2.361, 1.77, -1.59], [0, Math.PI / 2, 0]);

    // Rear treatment alcove: fluted wall, nested light and solid padded couch.
    r.box(dark, [3.15, 2.45, .24], [.59, 1.67, -6.23], .13);
    r.frame(warm, 3.10, 2.36, .37, .018, [.59, 1.70, -6.068]);
    r.recessShade(shadow, 3.02, 2.24, [.59, 1.70, -6.025], [0, 0, 0], .72);
    for (let i = 0; i < 53; i++) r.box(bronze, [.020, 2.16, .045], [-.86 + i * .056, 1.70, -6.058], .006, [0, 0, 0], .52 + (i % 4) * .09);
    r.box(panel, [1.34, 2.20, .15], [.57, 1.73, -5.955], .05);
    r.frame(cyan, 1.35, 2.20, .025, .012, [.57, 1.73, -5.866]);
    r.box(dark, [.93, 1.34, .06], [.57, 1.91, -5.835], .11);
    r.frame(violet, .91, 1.30, .15, .010, [.57, 1.91, -5.791]);
    // A restrained raised infinity motif, with no raster labels baked into the room.
    const emblem: XYZ[] = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40 * Math.PI * 2; emblem.push([.57 + .19 * Math.cos(t), 2.15 + .075 * Math.sin(2 * t), -5.778]); }
    r.curve(violet, emblem, .009, 48, 5);
    for (let i = 0; i < 4; i++) r.box(trim, [.34 - i * .04, .006, .008], [.57, 1.76 - i * .075, -5.79]);

    // Narrow rear product shelving, recessed and softly warm-lit.
    r.box(dark, [.81, 2.51, .30], [-1.62, 1.56, -6.17], .12);
    r.frame(trim, .75, 2.44, .20, .025, [-1.62, 1.56, -5.991]);
    for (let row = 0; row < 4; row++) {
      const y = .71 + row * .47;
      r.box(trim, [.62, .027, .31], [-1.62, y, -5.97], .005);
      r.box(warm, [.59, .012, .012], [-1.62, y + .031, -5.797]);
      r.recessShade(shadow, .62, .43, [-1.62, y + .245, -5.996]);
      for (let i = 0; i < 3; i++) r.bottle(i % 2 ? bottle : ivory, trim, ivory, [-1.81 + i * .18, y + .019, -5.91], .15 + i * .035, .027, row + i);
    }
    // Adjustable treatment couch: floating padded sections, frame and pedestal.
    r.box(trim, [1.10, .09, .71], [.13, .12, -5.10], .035);
    r.box(wall, [.54, .39, .40], [.13, .35, -5.10], .045, [0, 0, -.08]);
    r.box(dark, [2.65, .13, .80], [-.11, .62, -5.10], .04);
    r.box(cushion, [1.82, .23, .84], [.32, .77, -5.10], .10, [0, 0, 0], 1, 2);
    r.box(cushion, [.84, .23, .84], [-1.01, .84, -5.10], .09, [0, 0, -.19], 1, 2);
    r.box(cushion, [.42, .14, .56], [-1.12, 1.01, -5.10], .06, [0, 0, -.19], 1, 2);
    r.box(seam, [.012, .006, .74], [-.61, .903, -5.10]);
    r.cylinder(cushion, .22, .09, [-1.57, .62, -4.50], .22);
    r.cylinder(trim, .026, .47, [-1.57, .33, -4.50]);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      r.rod(trim, [-1.57, .10, -4.50], [-1.57 + Math.cos(a) * .27, .07, -4.50 + Math.sin(a) * .27], .018);
    }
    r.floorPatch(shadow, [-.05, -.005, -5.06], [1.7, .72], 0x000000, 1);
    r.plant(dark, trim, leaf, [1.99, 0, -5.53], 1.11);

    // Right violet wave inset: its curved molding and every wave are geometry.
    r.box(panel, [.15, 1.90, 3.08], [2.80, 2.06, -4.06], .12);
    r.frame(violet, 3.02, 1.82, .27, .019, [2.705, 2.06, -4.06], [0, -Math.PI / 2, 0]);
    r.recessShade(shadow, 2.82, 1.63, [2.713, 2.06, -4.06], [0, -Math.PI / 2, 0], .67);
    for (let line = 0; line < 12; line++) {
      const points: XYZ[] = [];
      for (let i = 0; i <= 18; i++) {
        const t = i / 18;
        points.push([2.692, 1.76 + line * .034 + .23 * Math.sin(t * Math.PI * 2 + .35) + .25 * t, -5.43 + t * 2.72]);
      }
      r.curve(wave, points, .0048, 34, 4);
    }
    // Soft, curved upholstered seating under the panel.
    r.box(dark, [1.07, .17, 2.56], [2.05, .17, -3.94], .08);
    r.box(cushion, [1.18, .35, 2.63], [2.03, .40, -3.94], .15, [0, 0, 0], 1, 2);
    r.box(cushion, [1.02, .17, 1.16], [1.96, .62, -4.55], .08, [0, 0, 0], 1, 2);
    r.box(cushion, [1.02, .17, 1.16], [1.96, .62, -3.33], .08, [0, 0, 0], 1, 2);
    const back: XYZ[] = [[2.12, .77, -5.25], [2.56, .84, -5.0], [2.65, .90, -4.08], [2.55, .84, -3.08], [2.14, .76, -2.66]];
    r.curve(cushion, back, .185, 40, 8);
    r.curve(seam, back.map(([x, y, z]) => [x - .035, y + .175, z] as XYZ), .009, 40, 5);
    r.box(seam, [1.01, .009, .012], [1.95, .671, -3.94]);
    r.floorPatch(shadow, [2, -.005, -3.90], [.94, 1.55], 0x000000, 1);

    // Low console and botanical details echo the foreground of the reference.
    r.box(wall, [1.15, .58, .61], [2.27, .38, -2.10], .09);
    r.box(trim, [1.20, .035, .65], [2.27, .692, -2.10], .025);
    r.box(warm, [1.04, .018, .018], [2.27, .11, -1.784]);
    r.box(dark, [.012, .40, .010], [2.27, .39, -1.79]);
    r.plant(bottle, trim, leaf, [2.10, .72, -2.09], .55);
    r.sphere(bottle, [2.54, .89, -2.06], [.079, .17, .079], [0, 0, .16]);
    r.box(dark, [.24, .018, .18], [2.56, .728, -1.98], .006);

    // Sculpted ceiling with cyan inner and champagne/violet outer rails.
    r.box(ceiling, [5.62, .15, 8.53], [0, 3.28, -2.11]);
    r.box(ceiling, [2.85, .08, 7.66], [0, 3.17, -2.03], .18, [0, 0, 0], .66);
    r.frame(warm, 2.92, 7.69, .38, .017, [0, 3.12, -2.03], [Math.PI / 2, 0, 0]);
    r.frame(trim, 2.33, 7.30, .37, .055, [0, 3.13, -2.03], [Math.PI / 2, 0, 0]);
    r.frame(cyan, 2.25, 7.25, .35, .026, [0, 3.086, -2.03], [Math.PI / 2, 0, 0]);
    r.frame(violet, 1.70, 6.73, .37, .009, [0, 3.075, -2.03], [Math.PI / 2, 0, 0]);
    for (const x of [-2.17, 2.17]) for (const z of [-5.70, -4.45, -2.65, -.60]) {
      r.cylinder(trim, .055, .021, [x, 3.189, z], .055, [0, 0, 0], 12);
      r.cylinder(warm, .039, .005, [x, 3.17, z], .039, [0, 0, 0], 12);
    }
    for (const x of [-2.82, 2.82]) r.box(violet, [.014, .025, 8.0], [x, 3.20, -2.20]);

    // Floor is actual dark stone; soft geometry-only reflection pools keep it
    // legible on the mobile tier without a planar-reflection render pass.
    for (let x = -2.7; x < 3; x += .90) r.box(dark, [.005, .002, 8.5], [x, -.011, -2.1]);
    for (let z = -6.15; z < 2.5; z += 1.17) r.box(dark, [5.6, .002, .005], [0, -.010, z]);
    for (let i = 0; i < 5; i++) {
      r.floorPatch(reflected, [-1.98, -.004, -5.30 + i * .64], [.58, .37], 0x6bb5d4, .36);
      r.floorPatch(reflected, [2.07, -.003, -5.10 + i * .58], [.48, .32], 0x9b7bd9, .28);
    }
    r.floorPatch(reflected, [.55, -.002, -5.52], [1.24, .53], 0xbaadbb, .24);
    for (const x of [-.92, .92]) {
      r.reflectionStrip(reflected, x, -1.65, .48, 6.4, 0x729eaf, .28);
      r.reflectionStrip(reflected, x, -1.65, .16, 6.35, 0xb5cdda, .62);
    }
  }

  private buildParticles(): void {
    const positions = new Float32Array(48 * 3);
    for (let i = 0; i < 48; i++) { positions[i * 3] = -2.4 + (i * .217) % 4.7; positions[i * 3 + 1] = .35 + (i * .271) % 2.7; positions[i * 3 + 2] = -5.6 + (i * .411) % 4.8; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb0cef8, size: .009, transparent: true, opacity: .12, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.particles.name = 'Clinical dust'; this.group.add(this.particles);
  }

  update(dt: number, _elapsed: number): void {
    if (this.presence < .01 || !this.particles) return;
    const attr = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i++) attr.setY(i, .25 + ((attr.getY(i) - .25 + dt * (.006 + (i % 4) * .002)) % 2.9));
    attr.needsUpdate = true;
  }

  setPresence(value: number): void {
    this.presence = clamp(value); this.group.visible = this.presence > .001;
    this.room.setPresence(this.presence);
    if (this.particles) this.particles.material.opacity = .12 * this.presence;
    this.lights.key.intensity = this.baseIntensities[0] * this.presence;
    this.lights.rim.intensity = this.baseIntensities[1] * this.presence;
    this.lights.ambient.intensity = this.baseIntensities[2] * this.presence;
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.room.dispose(); this.particles?.geometry.dispose(); this.particles?.material.dispose();
    this.lights.key.dispose(); this.lights.rim.dispose(); this.lights.ambient.dispose();
    this.particles = null; this.group.clear(); this.group.removeFromParent();
  }
}
